import * as fs from "fs";
import * as path from "path";
import { readCurrentActions } from "../core/action-backlog";
import { readCurrentWorkOrders } from "../core/work-orders";
import { classifyNotification, NotifiableSubject } from "../core/notification-policy";
import {
  CreateApprovalRequestInput,
  readCurrentApprovalRequests,
  upsertApprovalRequest,
  markApprovalRequestSent,
} from "../core/approval-requests";
import {
  getTelegramStatusForReport,
  isTelegramApprovalsEnabled,
  sendTelegramApprovalRequest,
} from "../core/telegram-gateway";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ApprovalRequest, BacklogAction, WorkOrder } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Approval Gateway Agent (Fase O8) — READ + PROPOSE only. Lee acciones y
 * work orders que la politica de notificacion clasifica como
 * INSTANT_APPROVAL_REQUIRED, crea una solicitud de aprobacion deduplicada
 * por cada una, y la envia por Telegram SOLO si
 * TELEGRAM_APPROVALS_ENABLED=true. Si esta desactivado, la solicitud se
 * crea igualmente (para que quede constancia local y aparezca en el
 * email diario) pero no se envia nada por ningun canal externo.
 *
 * NUNCA ejecuta la accion/work order relacionada. Solo cambia el status
 * de una solicitud cuando llega una respuesta valida via
 * `npm run approvals:update` (ver scripts/update-approval-request.ts) —
 * este agente nunca resuelve sus propias solicitudes.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "approval-gateway");
const AGENT_NAME = "approval-gateway";

// Estados de accion que ya estan "decididos" (por un humano o por la
// politica de autonomia) y por tanto nunca necesitan una nueva solicitud
// de aprobacion instantanea.
const ACTION_STATUSES_TO_SKIP = new Set([
  "approved",
  "rejected",
  "snoozed",
  "done",
  "blocked",
  "auto_processed",
  "auto_approved_for_planning",
]);

// Estados de work order ya resueltos.
const WORK_ORDER_STATUSES_TO_SKIP = new Set(["approved_to_prepare", "rejected", "applied_manually", "superseded"]);

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error(
      "No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento."
    );
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function buildActionRequestContent(action: BacklogAction): { title: string; summary: string; requestedAction: string } {
  return {
    title: action.title,
    summary: action.description || action.recommendation,
    requestedAction: action.recommendation,
  };
}

function buildWorkOrderRequestContent(wo: WorkOrder): { title: string; summary: string; requestedAction: string } {
  return {
    title: wo.sourceActionTitle,
    summary: `Work order de categoria "${wo.actionType}" para "${wo.keyword}"${wo.page ? ` (${wo.page})` : ""}. Impacto real: revisar antes de preparar o ejecutar nada.`,
    requestedAction: "Revisar el plan detallado (work-orders:list) y decidir si se aprueba, rechaza o pospone.",
  };
}

const APPROVAL_OPTIONS = ["approved", "rejected", "snoozed"];

export interface ApprovalGatewayRunResult {
  departmentRunId: string;
  newRequests: ApprovalRequest[];
  alreadyPending: ApprovalRequest[];
  sentViaTelegram: ApprovalRequest[];
  telegramEnabled: boolean;
  telegramConfigured: boolean;
  sendErrors: Array<{ approvalRequestId: string; error: string }>;
  reportPath: string;
}

function buildReportMarkdown(result: ApprovalGatewayRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Approval Gateway — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **Telegram activo (TELEGRAM_APPROVALS_ENABLED):** ${result.telegramEnabled ? "si" : "no"}`);
  lines.push(`- **Telegram configurado (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID presentes):** ${result.telegramConfigured ? "si" : "no"}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se crearon **${result.newRequests.length}** solicitud(es) de aprobacion nueva(s) (**${result.sentViaTelegram.length}** enviada(s) por Telegram). **${result.alreadyPending.length}** ya existian de pasadas anteriores (no se duplican). Ninguna solicitud ejecuta nada: solo registra que se pidio permiso y, cuando la haya, la respuesta.`
  );
  lines.push("");
  if (!result.telegramEnabled) {
    lines.push(
      "**TELEGRAM_APPROVALS_ENABLED no esta activo.** Las solicitudes nuevas se han creado localmente para que aparezcan en `npm run approvals:list` y en el email diario, pero no se ha enviado ningun mensaje. Ver `docs/telegram-approvals.md` para activarlo."
    );
    lines.push("");
  }

  const section = (title: string, requests: ApprovalRequest[]): void => {
    lines.push(`## ${title} (${requests.length})`);
    lines.push("");
    if (requests.length === 0) {
      lines.push("Ninguna.");
    } else {
      for (const r of requests) {
        lines.push(
          `- [${r.riskLevel}] \`${r.approvalRequestId}\` ${r.title} (${r.relatedType}: \`${r.relatedId}\`) — canal: ${r.channel}${r.sentAt ? `, enviada ${r.sentAt}` : ", sin enviar"}`
        );
      }
    }
    lines.push("");
  };

  section("Solicitudes nuevas", result.newRequests);
  section("Enviadas por Telegram", result.sentViaTelegram);
  section("Ya pendientes de pasadas anteriores", result.alreadyPending);

  if (result.sendErrors.length > 0) {
    lines.push(`## Errores de envio por Telegram (${result.sendErrors.length})`);
    lines.push("");
    for (const e of result.sendErrors) {
      lines.push(`- \`${e.approvalRequestId}\`: ${e.error}`);
    }
    lines.push("");
    lines.push(
      "La solicitud queda creada localmente (`pending`) aunque el envio haya fallado — no se pierde, solo no llego el aviso. Revisar con `npm run approvals:list -- --status pending`."
    );
    lines.push("");
  }

  lines.push("## Como responder");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run approvals:list -- --status pending");
  lines.push("npm run approvals:update -- --approvalRequestId <id> --answer approved");
  lines.push("npm run approvals:update -- --approvalRequestId <id> --answer rejected --reason \"...\"");
  lines.push("npm run approvals:update -- --approvalRequestId <id> --answer snoozed --reason \"...\"");
  lines.push("```");
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Ninguna solicitud de aprobacion ejecuta nada por si misma, apruebe quien apruebe.");
  lines.push("- No se ha impreso ni registrado TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID ni ningun otro secreto en este informe ni en los logs de esta ejecucion.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: ApprovalGatewayRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `approval-gateway-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runApprovalGateway(departmentRunId?: string): Promise<ApprovalGatewayRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Approval Gateway Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Approval Gateway Agent iniciado" });

  const currentRequests = readCurrentApprovalRequests();
  const newRequests: ApprovalRequest[] = [];
  const alreadyPending: ApprovalRequest[] = [];

  const createIfNeeded = (input: CreateApprovalRequestInput): void => {
    const { request, isNew } = upsertApprovalRequest(input, currentRequests);
    if (isNew) {
      newRequests.push(request);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "approval_required",
        priority: "high",
        summary: `Nueva solicitud de aprobacion: ${request.title}`,
        payload: { approvalRequestId: request.approvalRequestId, relatedType: request.relatedType, relatedId: request.relatedId },
      });
    } else {
      alreadyPending.push(request);
    }
  };

  for (const action of readCurrentActions()) {
    if (ACTION_STATUSES_TO_SKIP.has(action.status)) continue;
    const subject: NotifiableSubject = {
      subjectKind: "action",
      autonomyLevel: action.autonomyLevel,
      riskLevel: action.riskLevel,
      status: action.status,
      actionType: action.actionType,
    };
    if (classifyNotification(subject).notificationLevel !== "INSTANT_APPROVAL_REQUIRED") continue;

    const content = buildActionRequestContent(action);
    createIfNeeded({
      relatedType: "action",
      relatedId: action.actionId,
      title: content.title,
      summary: content.summary,
      riskLevel: action.riskLevel,
      requestedAction: content.requestedAction,
      options: APPROVAL_OPTIONS,
      channel: classifyNotification(subject).channel,
    });
  }

  for (const wo of readCurrentWorkOrders()) {
    if (WORK_ORDER_STATUSES_TO_SKIP.has(wo.status)) continue;
    const subject: NotifiableSubject = {
      subjectKind: "work_order",
      autonomyLevel: wo.autonomyLevel,
      riskLevel: wo.riskLevel,
      status: wo.status,
      actionType: wo.actionType,
    };
    if (classifyNotification(subject).notificationLevel !== "INSTANT_APPROVAL_REQUIRED") continue;

    const content = buildWorkOrderRequestContent(wo);
    createIfNeeded({
      relatedType: "work_order",
      relatedId: wo.workOrderId,
      title: content.title,
      summary: content.summary,
      riskLevel: wo.riskLevel,
      requestedAction: content.requestedAction,
      options: APPROVAL_OPTIONS,
      channel: classifyNotification(subject).channel,
    });
  }

  const telegramEnabled = isTelegramApprovalsEnabled();
  const { configured: telegramConfigured } = getTelegramStatusForReport();
  const sentViaTelegram: ApprovalRequest[] = [];
  const sendErrors: Array<{ approvalRequestId: string; error: string }> = [];

  if (telegramEnabled) {
    for (const request of newRequests) {
      try {
        await sendTelegramApprovalRequest({
          approvalRequestId: request.approvalRequestId,
          relatedType: request.relatedType,
          title: request.title,
          summary: request.summary,
          riskLevel: request.riskLevel,
          requestedAction: request.requestedAction,
          options: request.options,
        });
        const updated = markApprovalRequestSent(request.approvalRequestId, "telegram");
        if (updated) sentViaTelegram.push(updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendErrors.push({ approvalRequestId: request.approvalRequestId, error: message });
        logger.error("Fallo al enviar approval request por Telegram", { approvalRequestId: request.approvalRequestId, error: message });
      }
    }
  } else if (newRequests.length > 0) {
    logger.info(
      `TELEGRAM_APPROVALS_ENABLED no esta activo: ${newRequests.length} solicitud(es) nueva(s) se quedan solo en el informe local, no se envia nada.`
    );
  }

  const generatedAt = new Date().toISOString();
  const result: ApprovalGatewayRunResult = {
    departmentRunId: deptRunId,
    newRequests,
    alreadyPending,
    sentViaTelegram,
    telegramEnabled,
    telegramConfigured,
    sendErrors,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `Approval Gateway Agent finalizado. Nuevas: ${newRequests.length}, enviadas por Telegram: ${sentViaTelegram.length}. Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Approval Gateway Agent finalizado: ${newRequests.length} solicitud(es) nueva(s), ${sentViaTelegram.length} enviada(s) por Telegram`,
    payload: {
      newCount: newRequests.length,
      sentCount: sentViaTelegram.length,
      telegramEnabled,
      reportPath: result.reportPath,
    },
  });

  return result;
}
