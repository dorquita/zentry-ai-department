/**
 * Responde a una solicitud de aprobacion local. NO ejecuta ningun cambio
 * real: actualiza el estado de la solicitud (nueva instantanea
 * append-only) y, si la respuesta es approved/rejected/snoozed, cascada
 * esa misma decision al Action Backlog o al Work Order Registry
 * relacionado (mismo mecanismo que actions:update/work-orders:update,
 * con su propio registro de auditoria) — nunca publica en WordPress, ni
 * activa Ads, ni toca GA4/GTM/n8n/qdrant.
 *
 * Uso:
 *   npm run approvals:update -- --approvalRequestId <id> --answer approved
 *   npm run approvals:update -- --approvalRequestId <id> --answer rejected --reason "no aplica"
 *   npm run approvals:update -- --approvalRequestId <id> --answer snoozed --reason "revisar en septiembre"
 */
import * as dotenv from "dotenv";
dotenv.config();

import {
  findApprovalRequestById,
  isValidApprovalRequestStatus,
  setApprovalRequestStatus,
} from "../src/core/approval-requests";
import { findActionById, setActionStatus } from "../src/core/action-backlog";
import { recordStatusChange } from "../src/core/action-audit";
import { findWorkOrderById, setWorkOrderStatus } from "../src/core/work-orders";
import { recordWorkOrderStatusChange } from "../src/core/work-order-audit";
import { logger } from "../src/core/logger";
import { ActionStatus, APPROVAL_REQUEST_STATUSES, WorkOrderStatus } from "../src/core/types";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

// A que status del Action Backlog / Work Order Registry cascada cada
// respuesta valida. "snoozed" no tiene equivalente en WorkOrderStatus
// (no existe ese estado para work orders) — en ese caso solo se actualiza
// la solicitud de aprobacion, no la work order.
const ANSWER_TO_ACTION_STATUS: Partial<Record<string, ActionStatus>> = {
  approved: "approved",
  rejected: "rejected",
  snoozed: "snoozed",
};
const ANSWER_TO_WORK_ORDER_STATUS: Partial<Record<string, WorkOrderStatus>> = {
  approved: "approved_to_prepare",
  rejected: "rejected",
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const approvalRequestId = args.approvalRequestId;
  const answer = args.answer;
  const reason = args.reason;
  const answeredBy = args.by ?? "cli";

  if (!approvalRequestId) {
    console.error('Falta --approvalRequestId <id>. Usa "npm run approvals:list" para ver los IDs disponibles.');
    process.exit(1);
  }

  if (!answer || !isValidApprovalRequestStatus(answer)) {
    console.error(`--answer invalido o ausente. Validos: ${APPROVAL_REQUEST_STATUSES.join(", ")} (normalmente approved, rejected o snoozed).`);
    process.exit(1);
  }

  const existing = findApprovalRequestById(approvalRequestId);
  if (!existing) {
    console.error(`No existe ninguna solicitud con approvalRequestId="${approvalRequestId}".`);
    process.exit(1);
  }

  if (existing.status !== "pending") {
    console.log(`Sin cambios: "${approvalRequestId}" ya estaba resuelta con status "${existing.status}" (answer: ${existing.answer ?? "-"}).`);
    process.exit(0);
  }

  const updated = setApprovalRequestStatus(approvalRequestId, answer, { answer, reason, answeredBy });
  if (!updated) {
    console.error("No se pudo actualizar la solicitud (inesperado).");
    process.exit(1);
  }

  logger.info(`Solicitud de aprobacion respondida: ${approvalRequestId} -> ${answer}`, {
    approvalRequestId,
    answer,
    answeredBy,
    reason,
  });
  console.log(`OK: "${approvalRequestId}" -> "${answer}".`);
  if (reason) console.log(`Motivo: ${reason}`);

  // Cascada la decision al Action Backlog o al Work Order Registry
  // relacionado. Nunca ejecuta nada real: es el mismo mecanismo local que
  // usan actions:update / work-orders:update.
  if (existing.relatedType === "action") {
    const cascadeStatus = ANSWER_TO_ACTION_STATUS[answer];
    if (cascadeStatus) {
      const action = findActionById(existing.relatedId);
      if (!action) {
        console.warn(`Aviso: la accion relacionada "${existing.relatedId}" ya no existe en el backlog. Solo se actualizo la solicitud.`);
      } else {
        const previousStatus = action.status;
        const updatedAction = setActionStatus(existing.relatedId, cascadeStatus, answeredBy);
        if (updatedAction) {
          recordStatusChange({
            actionId: existing.relatedId,
            previousStatus,
            newStatus: cascadeStatus,
            reason: reason ?? `Via approval request ${approvalRequestId}`,
            changedBy: answeredBy,
          });
          console.log(`Accion relacionada "${existing.relatedId}" actualizada: "${previousStatus}" -> "${cascadeStatus}".`);
        }
      }
    }
  } else if (existing.relatedType === "work_order") {
    const cascadeStatus = ANSWER_TO_WORK_ORDER_STATUS[answer];
    if (cascadeStatus) {
      const workOrder = findWorkOrderById(existing.relatedId);
      if (!workOrder) {
        console.warn(`Aviso: la work order relacionada "${existing.relatedId}" ya no existe. Solo se actualizo la solicitud.`);
      } else {
        const previousStatus = workOrder.status;
        const updatedWorkOrder = setWorkOrderStatus(existing.relatedId, cascadeStatus, answeredBy);
        if (updatedWorkOrder) {
          recordWorkOrderStatusChange({
            workOrderId: existing.relatedId,
            previousStatus,
            newStatus: cascadeStatus,
            reason: reason ?? `Via approval request ${approvalRequestId}`,
            changedBy: answeredBy,
          });
          console.log(`Work order relacionada "${existing.relatedId}" actualizada: "${previousStatus}" -> "${cascadeStatus}".`);
        }
      }
    } else if (answer === "snoozed") {
      console.log('"snoozed" no tiene estado equivalente en la work order (no existe ese status) — solo queda registrado en la solicitud de aprobacion.');
    }
  } else if (existing.relatedType === "change_pack") {
    // Deliberadamente SIN cascada (a diferencia de "action"/"work_order"):
    // esta respuesta no cambia el status del change pack relacionado, solo
    // desbloquea que el WordPress Draft Agent intente crear (si "approved")
    // o marque rejected (si "rejected") el borrador real en su siguiente
    // pasada (npm run wordpress:drafts). Ver docs/wordpress-draft-agent.md.
    console.log(
      `Respuesta registrada para el change pack "${existing.relatedId}". No cascada ningun cambio de estado aqui: el WordPress Draft Agent leera esta respuesta en su siguiente pasada (npm run wordpress:drafts) para decidir si crea el borrador real (approved) o lo marca rejected.`
    );
  } else if (existing.relatedType === "staging_execution") {
    // Fase O12 — mismo patron sin cascada que "change_pack": esta
    // respuesta no toca data/staging-executions.jsonl directamente. Solo
    // desbloquea que el Staging Executor, en su siguiente pasada (npm run
    // staging:execute), lea la respuesta y pase la ejecucion a "approved"
    // (e intente aplicarla de verdad, solo si ademas los interruptores de
    // entorno lo permiten) o a "rejected". Ver docs/staging-execution.md.
    console.log(
      `Respuesta registrada para la ejecucion de staging "${existing.relatedId}". No cascada ningun cambio de estado aqui: el Staging Executor leera esta respuesta en su siguiente pasada (npm run staging:execute) para decidir si aplica la ejecucion real (approved) o la marca rejected.`
    );
  }

  console.log("");
  console.log(
    "Recordatorio: esto NO ejecuta ningun cambio real (no publica en WordPress, no toca Ads/GA4/GTM/n8n). Solo actualiza estado local."
  );

  process.exit(0);
}

main();
