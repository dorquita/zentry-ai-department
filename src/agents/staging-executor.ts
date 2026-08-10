import {
  CreateApprovalRequestInput,
  findAnyRequestByRelatedId,
  readCurrentApprovalRequests,
  upsertApprovalRequest,
  markApprovalRequestSent,
  setApprovalRequestStatus,
} from "../core/approval-requests";
import { canAutoApproveStagingExecution } from "../core/staging-autonomy-policy";
import { findChangePackById, readCurrentChangePacks } from "../core/change-packs";
import {
  findStagingExecutionByChangePackId,
  markExecutionApproved,
  markExecutionRejected,
  readCurrentStagingExecutions,
  recordExecutionApplied,
  recordExecutionFailed,
  upsertPendingExecution,
} from "../core/staging-executions";
import {
  createWordpressDraftPage,
  getWordpressPage,
  getWordpressStatusForReport,
  isWordpressDraftsEnabled,
  updateWordpressDraftPage,
} from "../adapters/wordpress";
import { resolveWordpressBackend, resolveWordpressEnv, WordpressBackend, WordpressEnv } from "../adapters/wordpress-backend";
import { isTelegramApprovalsEnabled, sendTelegramApprovalRequest, sendTelegramMessage } from "../core/telegram-gateway";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { extractPreviewFields, buildWordpressContentHtml } from "./wordpress-draft-agent";
import { findLandingBlueprintByChangePackId, readCurrentLandingBlueprints } from "../core/landing-blueprints";
import { resolveActiveClientConfig } from "../core/client-config";
import { ApprovalRequest, StagingExecution, StagingExecutionSnapshot } from "../core/types";
import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Staging Executor Agent (Fase O12) — la UNICA via de todo el proyecto
 * para una ejecucion controlada (crear O actualizar un borrador, siempre
 * `status: draft`, nunca publicar) contra WordPress STAGING. Nunca toca
 * produccion (bloqueado de forma incondicional en
 * src/adapters/wordpress-backend.ts#assertWordpressWriteAllowed, sin
 * excepcion posible desde este agente). Ver docs/staging-execution.md.
 *
 * Flujo, en dos fases separadas dentro de la misma pasada:
 *
 * 1. SIEMPRE (no requiere ningun interruptor activado): por cada change
 *    pack `approved_to_execute` sin ejecucion todavia, crea un registro
 *    `pending_approval` en data/staging-executions.jsonl. Por cada
 *    ejecucion `pending_approval` (de hoy o de pasadas anteriores), si no
 *    existe ya una solicitud de aprobacion de Telegram
 *    (`relatedType: "staging_execution"`), la crea (y la envia si
 *    TELEGRAM_APPROVALS_ENABLED=true). Si la solicitud ya esta
 *    respondida, la ejecucion pasa a `approved` o `rejected`. Nada de
 *    esto llama a WordPress.
 *
 * 2. SOLO si TODAS estas condiciones se cumplen a la vez: (a)
 *    STAGING_EXECUTION_ENABLED=true, (b) WORDPRESS_DRAFTS_ENABLED=true,
 *    (c) WORDPRESS_BACKEND="rest", (d) WORDPRESS_ENV="staging" — intenta
 *    aplicar de verdad las ejecuciones en status `approved`. Si la misma
 *    `canonicalKey` ya tiene una ejecucion `applied_to_staging` anterior
 *    con `wordpressPageId`, ACTUALIZA ese borrador (verificando primero
 *    que sigue en `draft`); si no, CREA una pagina nueva en `draft`.
 *    Siempre guarda un snapshot previo (para poder revertir despues) y
 *    copia las `rollbackNotes` del change pack. Un fallo en una ejecucion
 *    nunca bloquea las demas ni hace crashear el agente.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "staging-executions");
const AGENT_NAME = "staging-executor";
const STAGING_EXECUTION_RISK_LEVEL = "high" as const;
const APPROVAL_OPTIONS = ["approved", "rejected", "snoozed"];
const PREVIOUS_CONTENT_MAX_CHARS = 5000;

export function isStagingExecutionEnabled(): boolean {
  return (process.env.STAGING_EXECUTION_ENABLED ?? "").trim().toLowerCase() === "true";
}

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function truncateContent(value: string): string {
  return value.length > PREVIOUS_CONTENT_MAX_CHARS ? value.slice(0, PREVIOUS_CONTENT_MAX_CHARS) + "...[truncated]" : value;
}

export interface StagingExecutorRunResult {
  departmentRunId: string;
  newPendingExecutions: StagingExecution[];
  newApprovalRequests: ApprovalRequest[];
  sentViaTelegram: ApprovalRequest[];
  approvedThisPass: StagingExecution[];
  autoApprovedCarrilAThisPass: StagingExecution[];
  rejectedThisPass: StagingExecution[];
  appliedThisPass: StagingExecution[];
  failedThisPass: StagingExecution[];
  skippedByBatchLimit: StagingExecution[];
  pendingApprovalCount: number;
  totalAppliedCount: number;
  stagingExecutionEnabled: boolean;
  wordpressDraftsEnabled: boolean;
  wordpressBackend: WordpressBackend;
  wordpressEnv: WordpressEnv;
  wordpressTargetUrl?: string;
  telegramEnabled: boolean;
  canAttemptRealWrites: boolean;
  reportPath: string;
}

function buildReportMarkdown(result: StagingExecutorRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Staging Executor — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **STAGING_EXECUTION_ENABLED:** ${result.stagingExecutionEnabled ? "true" : "false"}`);
  lines.push(`- **WORDPRESS_DRAFTS_ENABLED:** ${result.wordpressDraftsEnabled ? "true" : "false"}`);
  lines.push(`- **WORDPRESS_BACKEND:** ${result.wordpressBackend}`);
  lines.push(`- **WORDPRESS_ENV:** ${result.wordpressEnv}${result.wordpressEnv === "production" ? " (escritura SIEMPRE bloqueada)" : ""}`);
  lines.push(`- **Destino resuelto:** ${result.wordpressTargetUrl ?? "(no configurado)"}`);
  lines.push(`- **Telegram activo:** ${result.telegramEnabled ? "si" : "no"}`);
  lines.push(`- **Se pueden intentar escrituras reales en esta pasada:** ${result.canAttemptRealWrites ? "si" : "no"}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Ejecuciones nuevas puestas en cola: **${result.newPendingExecutions.length}**. Solicitudes de aprobacion nuevas: **${result.newApprovalRequests.length}** (enviadas por Telegram: **${result.sentViaTelegram.length}**). Auto-aprobadas por el Carril A (sin esperar Telegram, Fase O27): **${result.autoApprovedCarrilAThisPass.length}**. Aprobadas en esta pasada: **${result.approvedThisPass.length}**. Rechazadas: **${result.rejectedThisPass.length}**. Aplicadas de verdad en staging en esta pasada: **${result.appliedThisPass.length}** (total acumulado: **${result.totalAppliedCount}**). Fallidas: **${result.failedThisPass.length}**. Pospuestas por limite de batch (Fase O27.1): **${result.skippedByBatchLimit.length}**. Pendientes de aprobacion: **${result.pendingApprovalCount}**.`
  );
  if (result.skippedByBatchLimit.length > 0) {
    lines.push("");
    lines.push(
      `**Limite de batch activo:** \`STAGING_EXECUTION_BATCH_LIMIT\` esta definida en \`.env\` -- ${result.skippedByBatchLimit.length} ejecucion(es) ya aprobada(s) se quedan en \`approved\` para la siguiente pasada (o para cuando se suba/quite el limite). No se pierden ni se rechazan.`
    );
  }
  lines.push("");
  if (!result.canAttemptRealWrites) {
    lines.push(
      "**No se ha intentado ninguna escritura real en esta pasada.** Hacen falta las 4 variables a la vez: `STAGING_EXECUTION_ENABLED=true`, `WORDPRESS_DRAFTS_ENABLED=true`, `WORDPRESS_BACKEND=rest`, `WORDPRESS_ENV=staging` — y aun asi, cada ejecucion concreta sigue necesitando su propia aprobacion de Telegram. Ver `docs/staging-execution.md`."
    );
    lines.push("");
  }

  lines.push(`## Ejecuciones aplicadas en esta pasada (${result.appliedThisPass.length})`);
  lines.push("");
  if (result.appliedThisPass.length === 0) {
    lines.push("Ninguna.");
  } else {
    for (const e of result.appliedThisPass) {
      lines.push(`- \`${e.executionId}\` ${e.keyword} — wordpressPageId=${e.wordpressPageId} — ${e.wordpressDraftUrl} (${e.snapshot?.existedBefore ? "actualizacion de borrador existente" : "pagina nueva"})`);
    }
  }
  lines.push("");

  if (result.failedThisPass.length > 0) {
    lines.push(`## Ejecuciones fallidas (${result.failedThisPass.length})`);
    lines.push("");
    for (const e of result.failedThisPass) {
      lines.push(`- \`${e.executionId}\` ${e.keyword}: ${e.lastError}`);
    }
    lines.push("");
    lines.push("Se reintentan en la siguiente pasada. No se ha modificado nada en WordPress para estas ejecuciones.");
    lines.push("");
  }

  lines.push(`## Pendientes de aprobacion por Telegram (${result.pendingApprovalCount})`);
  lines.push("");
  lines.push(
    result.pendingApprovalCount === 0
      ? "Ninguna."
      : "Revisa `npm run staging-executions:list -- --status pending_approval` y responde con `npm run approvals:update -- --approvalRequestId <id> --answer approved` (o `rejected`/`snoozed`)."
  );
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha publicado ninguna pagina. Cualquier escritura queda siempre en `status: draft`.");
  lines.push("- No se ha escrito nada en produccion (bloqueo incondicional por `WORDPRESS_ENV`, ver `docs/wordpress-safety-policy.md`).");
  lines.push("- No se ha tocado home, formularios, WooCommerce, precios, checkout, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- No se ha usado Novamira ni MCP en ningun momento (backend REST unicamente, Fase O12).");
  lines.push("- No se ha impreso ni registrado WORDPRESS_APP_PASSWORD ni ningun otro secreto en este informe ni en los logs de esta ejecucion.");
  lines.push("- `data/staging-executions.jsonl` es append-only.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: StagingExecutorRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `staging-executions-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runStagingExecutor(departmentRunId?: string): Promise<StagingExecutorRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Staging Executor Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Staging Executor Agent iniciado" });

  // --- Fase 1: poner en cola las ejecuciones pendientes (nunca toca WordPress) ---
  const eligibleChangePacks = readCurrentChangePacks().filter((cp) => cp.status === "approved_to_execute");
  let currentExecutions = readCurrentStagingExecutions();
  const newPendingExecutions: StagingExecution[] = [];

  for (const changePack of eligibleChangePacks) {
    const existing = findStagingExecutionByChangePackId(changePack.changePackId, currentExecutions);
    if (existing) continue;

    const { execution, isNew } = upsertPendingExecution(
      {
        changePackId: changePack.changePackId,
        workOrderId: changePack.workOrderId,
        actionId: changePack.actionId,
        canonicalKey: changePack.canonicalKey,
        targetBrand: changePack.targetBrand,
        changeType: changePack.changeType,
        page: changePack.page,
        keyword: changePack.keyword,
        rollbackNotes: [...changePack.rollbackNotes],
      },
      currentExecutions
    );
    if (isNew) {
      newPendingExecutions.push(execution);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "recommendation_created",
        priority: changePack.priority,
        summary: `Nueva ejecucion de staging en cola de aprobacion: ${changePack.keyword}`,
        payload: { executionId: execution.executionId, changePackId: changePack.changePackId },
      });
    }
  }
  currentExecutions = readCurrentStagingExecutions();

  // --- Estado de los interruptores (solo lectura, sin secretos) ---
  const stagingExecutionEnabled = isStagingExecutionEnabled();
  const wordpressDraftsEnabled = isWordpressDraftsEnabled();
  const { targetUrl: wordpressTargetUrl } = getWordpressStatusForReport();
  const wordpressBackend: WordpressBackend = resolveWordpressBackend();
  const wordpressEnv: WordpressEnv = resolveWordpressEnv();
  const telegramEnabled = isTelegramApprovalsEnabled();
  const canAttemptRealWrites =
    stagingExecutionEnabled && wordpressDraftsEnabled && wordpressBackend === "rest" && wordpressEnv === "staging";

  logger.info("Staging Executor: estado de escritura real para esta pasada", {
    stagingExecutionEnabled,
    wordpressDraftsEnabled,
    wordpressBackend,
    wordpressEnv,
    canAttemptRealWrites,
    targetUrl: wordpressTargetUrl ?? "(no configurado)",
  });

  // --- Fase 2: gestionar aprobaciones para ejecuciones pending_approval (nunca toca WordPress) ---
  const currentApprovalRequests = readCurrentApprovalRequests();
  const newApprovalRequests: ApprovalRequest[] = [];
  const sentViaTelegram: ApprovalRequest[] = [];
  const approvedThisPass: StagingExecution[] = [];
  const rejectedThisPass: StagingExecution[] = [];
  const autoApprovedCarrilAThisPass: StagingExecution[] = [];

  const pendingExecutions = currentExecutions.filter((e) => e.status === "pending_approval");
  for (const execution of pendingExecutions) {
    let approvalRequest = findAnyRequestByRelatedId(execution.executionId, currentApprovalRequests);
    if (!approvalRequest) {
      const input: CreateApprovalRequestInput = {
        relatedType: "staging_execution",
        relatedId: execution.executionId,
        title: `Ejecutar en staging: "${execution.keyword}"${execution.page ? ` (${execution.page})` : ""}`,
        summary: `El change pack \`${execution.changePackId}\` esta approved_to_execute. Esto crearia o actualizaria un borrador (status: draft, sin publicar) SOLO en ${resolveActiveClientConfig().stagingUrl ?? "staging"} — nunca en produccion.`,
        riskLevel: STAGING_EXECUTION_RISK_LEVEL,
        requestedAction: "Aprobar la ejecucion controlada en staging (crear o actualizar un borrador, nunca publicar, nunca produccion).",
        options: APPROVAL_OPTIONS,
        channel: "telegram",
      };
      const { request, isNew } = upsertApprovalRequest(input, currentApprovalRequests);
      approvalRequest = request;
      if (isNew) {
        // Fase O27 -- Carril A: si el changeType del change pack de origen
        // esta en config/staging-autonomy-policy.json, la ejecucion se
        // auto-aprueba AQUI MISMO (nunca espera a Pau) en vez de mandar
        // una solicitud de aprobacion por Telegram. Sigue quedando un
        // registro completo y auditable en approval-requests.jsonl
        // (answeredBy="carril_a_staging_autonomy", nunca un humano) y
        // Pau recibe igualmente un aviso por Telegram -- informativo, no
        // bloqueante: no hace falta que responda nada para que avance.
        const carrilA = canAutoApproveStagingExecution(execution.changeType);
        if (carrilA.autoApprove) {
          const autoApproved = setApprovalRequestStatus(request.approvalRequestId, "approved", {
            answer: "approved",
            reason: carrilA.reason,
            answeredBy: "carril_a_staging_autonomy",
          });
          if (autoApproved) approvalRequest = autoApproved;
          logger.info("Staging Executor: ejecucion auto-aprobada por el Carril A (sin esperar Telegram)", {
            executionId: execution.executionId,
            changeType: execution.changeType,
            approvalRequestId: request.approvalRequestId,
          });

          if (telegramEnabled) {
            try {
              await sendTelegramMessage(
                `Carril A (staging, sin aprobacion diaria): "${execution.keyword}"${execution.page ? ` (${execution.page})` : ""} se va a aplicar automaticamente en staging (borrador, sin publicar). No hace falta que respondas nada.`
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              logger.error("Fallo al enviar por Telegram el aviso informativo de Carril A", { executionId: execution.executionId, error: message });
            }
          }
        } else {
          newApprovalRequests.push(request);
          emitEvent({
            departmentRunId: deptRunId,
            agent: AGENT_NAME,
            type: "approval_required",
            priority: "high",
            summary: `Nueva solicitud de aprobacion para ejecutar en staging: ${execution.keyword}`,
            payload: { approvalRequestId: request.approvalRequestId, executionId: execution.executionId, changePackId: execution.changePackId },
          });

          if (telegramEnabled) {
            try {
              await sendTelegramApprovalRequest({
                approvalRequestId: request.approvalRequestId,
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
              logger.error("Fallo al enviar por Telegram la aprobacion de ejecucion en staging", {
                approvalRequestId: request.approvalRequestId,
                error: message,
              });
            }
          }
        }
      }
    }

    if (approvalRequest.status === "approved") {
      const updated = markExecutionApproved(execution.executionId, approvalRequest.approvalRequestId);
      if (updated) {
        approvedThisPass.push(updated);
        if (approvalRequest.answeredBy === "carril_a_staging_autonomy") autoApprovedCarrilAThisPass.push(updated);
      }
    } else if (approvalRequest.status === "rejected") {
      const updated = markExecutionRejected(execution.executionId, approvalRequest.approvalRequestId);
      if (updated) rejectedThisPass.push(updated);
    }
    // pending/snoozed/expired: la ejecucion se queda en pending_approval, se reintenta la siguiente pasada.
  }

  // --- Fase 3: aplicar de verdad las ejecuciones "approved", solo si los 4 interruptores lo permiten ---
  const appliedThisPass: StagingExecution[] = [];
  const failedThisPass: StagingExecution[] = [];
  const skippedByBatchLimit: StagingExecution[] = [];

  if (canAttemptRealWrites) {
    let approvedExecutions = readCurrentStagingExecutions().filter((e) => e.status === "approved");
    // Fase O27.1 -- limite de batch OPCIONAL para el primer arranque
    // controlado del Carril A (smoke test). Nunca hardcodeado: si
    // STAGING_EXECUTION_BATCH_LIMIT no esta definida (o no es un entero
    // positivo), se procesan TODAS las ejecuciones "approved" de esta
    // pasada, exactamente como siempre -- quitar la variable de .env
    // vuelve a la escala completa sin tocar ni una linea de codigo. Las
    // ejecuciones que se queden fuera del batch NO se pierden ni se
    // rechazan: siguen en "approved" y se recogen en la siguiente pasada
    // (o en la siguiente subida del limite).
    const batchLimitRaw = (process.env.STAGING_EXECUTION_BATCH_LIMIT ?? "").trim();
    const batchLimit = batchLimitRaw ? Number.parseInt(batchLimitRaw, 10) : NaN;
    if (Number.isInteger(batchLimit) && batchLimit > 0 && approvedExecutions.length > batchLimit) {
      skippedByBatchLimit.push(...approvedExecutions.slice(batchLimit));
      approvedExecutions = approvedExecutions.slice(0, batchLimit);
      logger.info("Staging Executor: limite de batch activo (Fase O27.1), aplicando solo un subconjunto esta pasada", {
        batchLimit,
        aplicandoEstaPasada: approvedExecutions.length,
        pospuestasSiguientePasada: skippedByBatchLimit.length,
      });
    }
    for (const execution of approvedExecutions) {
      const changePack = findChangePackById(execution.changePackId);
      if (!changePack) {
        const updated = recordExecutionFailed(execution.executionId, "El change pack de origen ya no existe en el registro local.");
        if (updated) failedThisPass.push(updated);
        continue;
      }

      try {
        const priorApplied = readCurrentStagingExecutions().find(
          (e) => e.canonicalKey === execution.canonicalKey && e.status === "applied_to_staging" && typeof e.wordpressPageId === "number"
        );

        const fields = extractPreviewFields(changePack);
        const blueprint = findLandingBlueprintByChangePackId(changePack.changePackId, readCurrentLandingBlueprints());
        const contentHtml = buildWordpressContentHtml(fields, blueprint);

        let snapshot: StagingExecutionSnapshot;
        let result: { wordpressDraftId: number; wordpressDraftUrl: string };

        if (priorApplied?.wordpressPageId) {
          const before = await getWordpressPage(priorApplied.wordpressPageId);
          snapshot = {
            existedBefore: true,
            wordpressPageId: before.id,
            previousStatus: before.status,
            previousTitle: before.title,
            previousContent: truncateContent(before.contentHtml),
          };
          result = await updateWordpressDraftPage({
            pageId: priorApplied.wordpressPageId,
            title: fields.title,
            contentHtml,
            excerpt: fields.metaDescription,
          });
        } else {
          snapshot = { existedBefore: false };
          result = await createWordpressDraftPage({
            title: fields.title,
            contentHtml,
            excerpt: fields.metaDescription,
          });
        }

        const updated = recordExecutionApplied(execution.executionId, {
          wordpressBackend,
          wordpressPageId: result.wordpressDraftId,
          wordpressDraftUrl: result.wordpressDraftUrl,
          snapshot,
        });
        if (updated) appliedThisPass.push(updated);
        logger.info("Staging Executor: ejecucion aplicada en staging (sin publicar)", {
          executionId: execution.executionId,
          wordpressPageId: result.wordpressDraftId,
          existedBefore: snapshot.existedBefore,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const updated = recordExecutionFailed(execution.executionId, message);
        if (updated) failedThisPass.push(updated);
        logger.error("Staging Executor: fallo al aplicar una ejecucion", { executionId: execution.executionId, error: message });
      }
    }
  }

  const totalAppliedCount = readCurrentStagingExecutions().filter((e) => e.status === "applied_to_staging").length;
  const pendingApprovalCount = readCurrentStagingExecutions().filter((e) => e.status === "pending_approval").length;

  const generatedAt = new Date().toISOString();
  const result: StagingExecutorRunResult = {
    departmentRunId: deptRunId,
    newPendingExecutions,
    newApprovalRequests,
    sentViaTelegram,
    approvedThisPass,
    autoApprovedCarrilAThisPass,
    rejectedThisPass,
    appliedThisPass,
    failedThisPass,
    skippedByBatchLimit,
    pendingApprovalCount,
    totalAppliedCount,
    stagingExecutionEnabled,
    wordpressDraftsEnabled,
    wordpressBackend,
    wordpressEnv,
    wordpressTargetUrl,
    telegramEnabled,
    canAttemptRealWrites,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `Staging Executor Agent finalizado. En cola: ${newPendingExecutions.length}. Aplicadas: ${appliedThisPass.length}. Fallidas: ${failedThisPass.length}. Pendientes de aprobacion: ${pendingApprovalCount}. Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Staging Executor Agent finalizado: ${appliedThisPass.length} ejecucion(es) aplicada(s), ${pendingApprovalCount} pendiente(s) de aprobacion`,
    payload: {
      newPendingExecutionCount: newPendingExecutions.length,
      appliedCount: appliedThisPass.length,
      failedCount: failedThisPass.length,
      pendingApprovalCount,
      totalAppliedCount,
      canAttemptRealWrites,
      reportPath: result.reportPath,
    },
  });

  return result;
}
