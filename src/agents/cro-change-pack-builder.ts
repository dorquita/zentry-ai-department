import * as fs from "fs";
import * as path from "path";
import {
  buildGenericRollbackNotes,
  isEligibleWorkOrder,
  PRODUCTION_SAFETY_CHECKLIST_ITEMS,
  readCurrentChangePacks,
  upsertChangePack,
} from "../core/change-packs";
import { categorizeActionType, readCurrentWorkOrders } from "../core/work-orders";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ChangePack } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";
import { evaluateClusterGateForWorkOrder } from "./cluster-gate";

/**
 * CRO Change Pack Builder — READ + PROPOSE only. Convierte work orders de
 * conversion ya detalladas (`auto_prepared`/`ready_for_review`/
 * `approved_to_prepare`) en un change pack: el mismo CTA/formulario/
 * bloque de confianza/FAQ de la work order, mas pasos de implementacion,
 * checklist de revision y notas de reversion. NUNCA toca WordPress.
 *
 * Fase O31 -- cada work order pasa por `evaluateClusterGateForWorkOrder()`
 * (src/agents/cluster-gate.ts) antes de convertirse en change pack. Ver
 * seo-change-pack-builder.ts para el detalle de la regla.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "cro-change-packs");
const AGENT_NAME = "cro-change-pack-builder";
const CHANGE_TYPE = "cro_conversion_update";

interface CroProposedChanges {
  page: string;
  newCta: string;
  ctaPlacement: string;
  form: string;
  trustBlock: string;
  faqSection: string;
  visualImprovements: string[];
  suggestedAbTest?: string;
  risk: string;
}

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function buildImplementationSteps(proposal: CroProposedChanges): string[] {
  const steps = [
    "Actualizar el CTA segun la propuesta.",
    "Reubicar el CTA segun la ubicacion sugerida.",
    "Actualizar el formulario segun la propuesta.",
    "Anadir o actualizar el bloque de confianza con datos reales.",
    "Revisar o anadir la seccion de FAQ sugerida.",
    "Aplicar las mejoras visuales sugeridas.",
  ];
  if (proposal.suggestedAbTest) {
    steps.push("Si se lanza el test A/B sugerido, definir metrica de exito y duracion minima antes de empezar.");
  }
  steps.push("Publicar SOLO tras aprobacion humana explicita — este paquete no publica nada por si mismo.");
  return steps;
}

function buildHumanReviewChecklist(): string[] {
  return [
    "Validar el nuevo CTA/formulario con el equipo antes de implementar.",
    "Confirmar que el bloque de confianza usa datos reales (no inventados).",
    "Si hay test A/B sugerido, confirmar metrica de exito y duracion antes de lanzarlo.",
    ...PRODUCTION_SAFETY_CHECKLIST_ITEMS,
  ];
}

function buildRisks(proposal: CroProposedChanges): string[] {
  return [
    proposal.risk,
    "Cambios de CTA/formulario pueden afectar temporalmente a la tasa de conversion mientras se valida el resultado.",
  ];
}

function buildCurrentAssumptions(proposal: CroProposedChanges): string[] {
  return [
    `Se asume que la pagina ${proposal.page} sigue existiendo en esa URL con una estructura similar.`,
    "Se asume que el formulario/CTA actual de la pagina no ha cambiado desde que se genero la work order origen.",
  ];
}

export interface BlockedByClusterGate {
  keyword: string;
  page?: string;
  reason: string;
}

export interface CroChangePackBuilderRunResult {
  departmentRunId: string;
  newChangePacks: ChangePack[];
  alreadyExisting: ChangePack[];
  blockedByClusterGate: BlockedByClusterGate[];
  reportPath: string;
}

function buildReportMarkdown(result: CroChangePackBuilderRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# CRO Change Packs — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se crearon **${result.newChangePacks.length}** change pack(s) CRO nuevo(s) y **${result.alreadyExisting.length}** ya existian (no se duplican). Ninguno se ha aplicado en WordPress: son paquetes de cambio concretos para revision humana.`
  );
  lines.push("");

  lines.push(`## Change packs nuevos (${result.newChangePacks.length})`);
  lines.push("");
  if (result.newChangePacks.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const cp of result.newChangePacks) {
      const target = cp.targetWordpressPageId ? ` — actualiza borrador existente ${cp.targetWordpressPageId}` : "";
      lines.push(`- [${cp.priority}] \`${cp.changePackId}\` ${cp.keyword} (${cp.page ?? "sin pagina"}) — status: ${cp.status}${target}`);
    }
  }
  lines.push("");

  lines.push(`## Bloqueadas por el cluster gate (${result.blockedByClusterGate.length})`);
  lines.push("");
  if (result.blockedByClusterGate.length === 0) {
    lines.push("Ninguna.");
  } else {
    for (const b of result.blockedByClusterGate) {
      lines.push(`- "${b.keyword}" (${b.page ?? "sin pagina"}): ${b.reason}`);
    }
  }
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado ni publicado nada en WordPress.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee work orders existentes y las repaqueta.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: CroChangePackBuilderRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `cro-change-packs-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runCroChangePackBuilder(departmentRunId?: string): Promise<CroChangePackBuilderRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("CRO Change Pack Builder iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "CRO Change Pack Builder iniciado" });

  const eligibleWorkOrders = readCurrentWorkOrders().filter(
    (w) => isEligibleWorkOrder(w) && categorizeActionType(w.actionType) === "cro"
  );
  const currentChangePacks = readCurrentChangePacks();

  const newChangePacks: ChangePack[] = [];
  const alreadyExisting: ChangePack[] = [];
  const blockedByClusterGate: BlockedByClusterGate[] = [];

  for (const workOrder of eligibleWorkOrders) {
    const gate = evaluateClusterGateForWorkOrder(workOrder);
    if (gate.verdict === "block") {
      blockedByClusterGate.push({ keyword: workOrder.keyword, page: workOrder.page, reason: gate.reason });
      logger.info("CRO Change Pack Builder: work order bloqueada por el cluster gate", {
        workOrderId: workOrder.workOrderId,
        keyword: workOrder.keyword,
        reason: gate.reason,
      });
      continue;
    }

    const proposal = workOrder.proposedChanges as unknown as CroProposedChanges;
    const { changePack, isNew } = upsertChangePack(
      {
        workOrder,
        changeType: CHANGE_TYPE,
        proposedChanges: workOrder.proposedChanges,
        currentAssumptions: buildCurrentAssumptions(proposal),
        implementationSteps: buildImplementationSteps(proposal),
        humanReviewChecklist: buildHumanReviewChecklist(),
        risks: buildRisks(proposal),
        rollbackNotes: buildGenericRollbackNotes(workOrder.page ?? "la pagina afectada"),
        sourceAgent: AGENT_NAME,
        targetWordpressPageId: gate.verdict === "allow_update_existing" ? gate.reuseWordpressPageId : undefined,
      },
      currentChangePacks
    );

    if (isNew) {
      newChangePacks.push(changePack);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "recommendation_created",
        priority: changePack.priority,
        summary: `Change pack CRO listo para revisar: ${changePack.keyword}`,
        payload: { changePackId: changePack.changePackId, workOrderId: changePack.workOrderId },
      });
    } else {
      alreadyExisting.push(changePack);
    }
  }

  const generatedAt = new Date().toISOString();
  const result: CroChangePackBuilderRunResult = { departmentRunId: deptRunId, newChangePacks, alreadyExisting, blockedByClusterGate, reportPath: "" };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `CRO Change Pack Builder finalizado. Nuevos: ${newChangePacks.length}. Bloqueados por cluster gate: ${blockedByClusterGate.length}. Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `CRO Change Pack Builder finalizado: ${newChangePacks.length} change pack(s) nuevo(s), ${blockedByClusterGate.length} bloqueado(s) por cluster gate`,
    payload: {
      newCount: newChangePacks.length,
      alreadyExistingCount: alreadyExisting.length,
      blockedByClusterGateCount: blockedByClusterGate.length,
      reportPath: result.reportPath,
    },
  });

  return result;
}
