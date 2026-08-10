import * as fs from "fs";
import * as path from "path";
import { readCurrentProductionDeploymentPlans, setDeploymentPlanStatus } from "../core/production-deployment-plans";
import {
  readCurrentProductionExecutions,
  findExecutionByDeploymentPlanId,
  createPendingExecution,
  setProductionExecutionStatus,
} from "../core/production-executions";
import {
  CreateApprovalRequestInput,
  findAnyRequestByRelatedId,
  readCurrentApprovalRequests,
  upsertApprovalRequest,
  markApprovalRequestSent,
} from "../core/approval-requests";
import { isTelegramApprovalsEnabled, sendTelegramApprovalRequest } from "../core/telegram-gateway";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ProductionExecution, ProductionMediaMapping } from "../core/types";
import { getWordpressPage, getWordpressMedia } from "../adapters/wordpress";
import {
  canAttemptProductionWrites,
  createProductionDraftPage,
  uploadMediaToProduction,
  getProductionStatusForReport,
} from "../adapters/wordpress-production";
import { AutonomyRiskLevel } from "../core/autonomy-policy";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Production Draft Executor (Fase O13.2) — el UNICO agente de todo el
 * proyecto con capacidad (gateada, hoy siempre desactivada) de escribir
 * de verdad en WordPress PRODUCCION. Retoma exactamente donde lo deja
 * `production-deployment-planner.ts`: solo procesa planes YA
 * `plan_approved` (la aprobacion de DISENO, gestionada por el planner).
 *
 * Tres fases, cada una capaz de pararse sola sin tocar nada:
 *
 * 1. Por cada plan `plan_approved` sin ejecucion todavia, crea una
 *    `ProductionExecution` en `pending_approval` (dedup por
 *    deploymentPlanId) y una solicitud de aprobacion de EJECUCION REAL
 *    por Telegram (`relatedType: "production_execution"`, texto
 *    explicito "[Aprobacion de ejecucion real]"). El plan pasa a
 *    `execution_pending_approval`.
 * 2. Si la solicitud ya esta respondida: `approved` -> la ejecucion pasa
 *    a `approved` (el plan a `execution_approved`); `rejected` -> la
 *    ejecucion pasa a `cancelled` (el plan a `execution_rejected`). Ni
 *    lo uno ni lo otro toca produccion todavia.
 * 3. SOLO si TODAS estas condiciones se cumplen a la vez intenta una
 *    escritura real: (a) la ejecucion esta `approved`, (b)
 *    `PRODUCTION_EXECUTION_ENABLED=true`, (c) `PRODUCTION_DRAFTS_ENABLED=true`,
 *    (d) `PRODUCTION_BACKEND=rest` (las 3 ultimas se comprueban con
 *    `canAttemptProductionWrites()`, ver
 *    src/adapters/wordpress-production.ts). Si falta cualquiera, la
 *    ejecucion se queda `approved` sin tocar nada -- NUNCA se auto-activa
 *    ni se fuerza. Guarda SIEMPRE un snapshot del contenido exacto que
 *    se envio ANTES de intentar la escritura (obligatorio, incluso para
 *    una pagina nueva). Nunca publica -- siempre `status: draft`.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "production-executions");
const AGENT_NAME = "production-draft-executor";
const EXECUTION_RISK_LEVEL: AutonomyRiskLevel = "critical";
const APPROVAL_OPTIONS = ["approved", "rejected", "snoozed"];

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function remapMediaInContent(contentHtml: string, mappings: ProductionMediaMapping[]): string {
  let result = contentHtml;
  for (const mapping of mappings) {
    if (!mapping.targetMediaId || !mapping.targetMediaUrl) continue;
    const blockRegex = new RegExp(`<!-- wp:image \\{[^}]*"id":${mapping.sourceMediaId}[^}]*\\} -->[\\s\\S]*?<!-- /wp:image -->`);
    const match = blockRegex.exec(result);
    if (!match) continue;
    const newBlock = match[0]
      .replace(new RegExp(`"id":${mapping.sourceMediaId}`), `"id":${mapping.targetMediaId}`)
      .replace(/src="[^"]*"/, `src="${mapping.targetMediaUrl}"`)
      .replace(new RegExp(`wp-image-${mapping.sourceMediaId}\\b`), `wp-image-${mapping.targetMediaId}`);
    result = result.replace(match[0], newBlock);
  }
  return result;
}

export interface ProductionDraftExecutorRunResult {
  departmentRunId: string;
  newPendingExecutions: ProductionExecution[];
  newApprovalRequests: number;
  sentViaTelegram: number;
  approvedThisPass: number;
  cancelledThisPass: number;
  appliedThisPass: ProductionExecution[];
  failedThisPass: ProductionExecution[];
  pendingApprovalCount: number;
  canAttemptRealWrites: boolean;
  productionExecutionEnabled: boolean;
  productionDraftsEnabled: boolean;
  productionBackend: string;
  telegramEnabled: boolean;
  reportPath: string;
}

function buildReportMarkdown(result: ProductionDraftExecutorRunResult, allExecutions: ProductionExecution[], generatedAt: string): string {
  const lines: string[] = [];
  const executionDate = generatedAt.slice(0, 10);

  lines.push(`# Production Draft Executor — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");
  lines.push(
    `- **PRODUCTION_EXECUTION_ENABLED:** ${result.productionExecutionEnabled} | **PRODUCTION_DRAFTS_ENABLED:** ${result.productionDraftsEnabled} | **PRODUCTION_BACKEND:** ${result.productionBackend}`
  );
  lines.push(`- **canAttemptRealWrites (las 3 a la vez):** ${result.canAttemptRealWrites}`);
  lines.push(
    result.canAttemptRealWrites
      ? "**AVISO: las 3 condiciones de escritura real estan activas.** Cualquier ejecucion `approved` se aplicaria de verdad en esta pasada."
      : "Escritura real BLOQUEADA (al menos una de las 3 condiciones no esta activa) -- ninguna ejecucion `approved` se aplica, pase lo que pase."
  );
  lines.push("");
  lines.push(`- Ejecuciones nuevas (pending_approval) esta pasada: **${result.newPendingExecutions.length}**`);
  lines.push(`- Nuevas solicitudes de aprobacion de EJECUCION: **${result.newApprovalRequests}** (enviadas por Telegram: ${result.sentViaTelegram})`);
  lines.push(`- Aprobadas esta pasada: ${result.approvedThisPass} | Canceladas/rechazadas esta pasada: ${result.cancelledThisPass}`);
  lines.push(`- Aplicadas de verdad esta pasada: ${result.appliedThisPass.length} | Fallidas: ${result.failedThisPass.length}`);
  lines.push(`- Pendientes de aprobacion de ejecucion (total): ${result.pendingApprovalCount}`);
  lines.push("");

  lines.push(`## Todas las ejecuciones (${allExecutions.length})`);
  lines.push("");
  if (allExecutions.length === 0) {
    lines.push("Ninguna todavia.");
  } else {
    for (const e of allExecutions) {
      lines.push(`### [${e.status}] ${e.keyword}${e.page ? ` (${e.page})` : ""} — \`${e.executionId}\``);
      lines.push("");
      lines.push(`- deploymentPlanId: \`${e.deploymentPlanId}\``);
      lines.push(`- sourceDraftId (staging): \`${e.sourceDraftId}\` — ${e.sourceDraftUrl}`);
      lines.push(`- targetPageId (produccion): ${e.targetPageId ?? "(ninguno todavia)"}`);
      lines.push(`- targetDraftUrl: ${e.targetDraftUrl ?? "(ninguno todavia)"}`);
      lines.push(`- media: ${e.mediaMappings.map((m) => `${m.sourceMediaId}->${m.targetMediaId ?? "?"}`).join(", ") || "(ninguna)"}`);
      lines.push(`- approvalRequestId: ${e.approvalRequestId ?? "(pendiente de crear)"}`);
      lines.push(`- attempts: ${e.attempts}`);
      if (e.lastError) lines.push(`- lastError: ${e.lastError}`);
      lines.push("");
    }
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- Escritura real SOLO si: ejecucion `approved` (segunda aprobacion, distinta de la de plan) + las 3 condiciones de entorno a la vez.");
  lines.push("- Nunca publica -- toda pagina creada en produccion queda siempre en `status: draft`.");
  lines.push("- Nunca actualiza una pagina publicada existente, nunca borra, nunca toca WooCommerce/formularios/precios/checkout.");
  lines.push("- Snapshot del contenido exacto enviado guardado SIEMPRE antes de cualquier intento de escritura real.");
  lines.push("- No usa Novamira, execute-php ni run-wp-cli en ningun punto.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: ProductionDraftExecutorRunResult, allExecutions: ProductionExecution[], generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `production-executions-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, allExecutions, generatedAt), "utf-8");
  return filePath;
}

export async function runProductionDraftExecutor(departmentRunId?: string): Promise<ProductionDraftExecutorRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Production Draft Executor iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Production Draft Executor iniciado" });

  const prodStatus = getProductionStatusForReport();
  const telegramEnabled = isTelegramApprovalsEnabled();

  // --- Fase 1: crear ProductionExecution "pending_approval" para planes plan_approved ---
  let currentExecutions = readCurrentProductionExecutions();
  const newPendingExecutions: ProductionExecution[] = [];
  const approvedPlans = readCurrentProductionDeploymentPlans().filter((p) => p.status === "plan_approved");

  for (const plan of approvedPlans) {
    const existing = findExecutionByDeploymentPlanId(plan.deploymentPlanId, currentExecutions);
    if (existing) continue;

    const mediaMappings: ProductionMediaMapping[] = plan.includedMediaIds.map((sourceMediaId) => ({ sourceMediaId }));

    const { execution } = createPendingExecution(
      {
        deploymentPlanId: plan.deploymentPlanId,
        changePackId: plan.changePackId,
        keyword: plan.keyword,
        page: plan.page,
        backend: prodStatus.backend,
        sourceDraftId: plan.sourceDraftId,
        sourceDraftUrl: plan.sourceDraftUrl,
        seoMeta: plan.seoMeta,
        mediaMappings,
        rollbackPlan: plan.rollbackPlan,
      },
      currentExecutions
    );
    newPendingExecutions.push(execution);
    setDeploymentPlanStatus(plan.deploymentPlanId, "execution_pending_approval", {});

    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "recommendation_created",
      summary: `Nueva ejecucion de produccion pendiente de aprobacion (solo se creo el registro, produccion no se toco): ${plan.keyword}`,
      payload: { executionId: execution.executionId, deploymentPlanId: plan.deploymentPlanId },
    });
  }

  // --- Fase 2: aprobacion de EJECUCION REAL por Telegram ---
  let newApprovalRequests = 0;
  let sentViaTelegram = 0;
  let approvedThisPass = 0;
  let cancelledThisPass = 0;

  let currentApprovalRequests = readCurrentApprovalRequests();
  const pendingExecutions = readCurrentProductionExecutions().filter((e) => e.status === "pending_approval");

  for (const execution of pendingExecutions) {
    let approvalRequest = findAnyRequestByRelatedId(execution.executionId, currentApprovalRequests);
    if (!approvalRequest) {
      const input: CreateApprovalRequestInput = {
        relatedType: "production_execution",
        relatedId: execution.executionId,
        title: `${execution.keyword}${execution.page ? ` (${execution.page})` : ""}`,
        summary: `El plan \`${execution.deploymentPlanId}\` ya tiene el DISENO aprobado. Esta es la SEGUNDA aprobacion, distinta: autorizar una escritura REAL en produccion (crear un draft nuevo, sin publicar). Incluso aprobando esto, la escritura solo se intentaria si ademas estan activos PRODUCTION_EXECUTION_ENABLED, PRODUCTION_DRAFTS_ENABLED y PRODUCTION_BACKEND=rest -- hoy estan desactivados.`,
        riskLevel: EXECUTION_RISK_LEVEL,
        requestedAction: "Crear un BORRADOR nuevo en produccion.",
        options: APPROVAL_OPTIONS,
        channel: "telegram",
      };
      const { request, isNew } = upsertApprovalRequest(input, currentApprovalRequests);
      approvalRequest = request;
      currentApprovalRequests = readCurrentApprovalRequests();
      if (isNew) {
        newApprovalRequests += 1;
        setProductionExecutionStatus(execution.executionId, "pending_approval", { approvalRequestId: request.approvalRequestId });
        emitEvent({
          departmentRunId: deptRunId,
          agent: AGENT_NAME,
          type: "approval_required",
          priority: "high",
          summary: `Nueva solicitud de APROBACION DE EJECUCION REAL en produccion: ${execution.keyword}`,
          payload: { approvalRequestId: request.approvalRequestId, executionId: execution.executionId },
        });
        if (telegramEnabled) {
          try {
            await sendTelegramApprovalRequest({
              approvalRequestId: request.approvalRequestId,
              relatedType: request.relatedType,
              title: request.title,
              summary: request.summary,
              riskLevel: request.riskLevel,
              requestedAction: request.requestedAction,
              options: request.options,
              stagingUrl: execution.sourceDraftUrl,
              productionUrl: execution.page,
              onApproveText:
                "Se autoriza intentar crear un BORRADOR real en producción (nunca publicar). Solo se intentaría si además PRODUCTION_EXECUTION_ENABLED, PRODUCTION_DRAFTS_ENABLED y PRODUCTION_BACKEND=rest están activos -- hoy están desactivados.",
            });
            const updated = markApprovalRequestSent(request.approvalRequestId, "telegram");
            if (updated) sentViaTelegram += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error("Fallo al enviar por Telegram la aprobacion de ejecucion real en produccion", {
              approvalRequestId: request.approvalRequestId,
              error: message,
            });
          }
        }
      }
    }

    if (approvalRequest.status === "approved") {
      setProductionExecutionStatus(execution.executionId, "approved", { approvalRequestId: approvalRequest.approvalRequestId });
      setDeploymentPlanStatus(execution.deploymentPlanId, "execution_approved", {});
      approvedThisPass += 1;
    } else if (approvalRequest.status === "rejected") {
      setProductionExecutionStatus(execution.executionId, "cancelled", {
        approvalRequestId: approvalRequest.approvalRequestId,
        lastError: "Aprobacion de ejecucion real rechazada via Telegram.",
      });
      setDeploymentPlanStatus(execution.deploymentPlanId, "execution_rejected", {});
      cancelledThisPass += 1;
    }
    // pending/snoozed: se queda pending_approval, se reintenta la siguiente pasada. Nunca se toca produccion.
  }

  // --- Fase 3: escritura real, SOLO si approved + las 3 condiciones de entorno ---
  const canAttemptRealWrites = canAttemptProductionWrites();
  const appliedThisPass: ProductionExecution[] = [];
  const failedThisPass: ProductionExecution[] = [];

  if (canAttemptRealWrites) {
    const approvedExecutions = readCurrentProductionExecutions().filter((e) => e.status === "approved");
    for (const execution of approvedExecutions) {
      try {
        const sourcePage = await getWordpressPage(execution.sourceDraftId);

        const resolvedMappings: ProductionMediaMapping[] = [];
        for (const mapping of execution.mediaMappings) {
          const sourceMedia = await getWordpressMedia(mapping.sourceMediaId);
          const fileResponse = await fetch(sourceMedia.sourceUrl);
          if (!fileResponse.ok) {
            throw new Error(`No se pudo descargar la media de staging ${mapping.sourceMediaId} (HTTP ${fileResponse.status}).`);
          }
          const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
          const uploaded = await uploadMediaToProduction({
            fileBuffer,
            filename: sourceMedia.sourceUrl.split("/").pop() ?? `media-${mapping.sourceMediaId}`,
            mimeType: sourceMedia.mimeType,
            altText: sourceMedia.altText,
          });
          resolvedMappings.push({
            sourceMediaId: mapping.sourceMediaId,
            targetMediaId: uploaded.wordpressMediaId,
            targetMediaUrl: uploaded.wordpressMediaUrl,
          });
        }

        const remappedContent = remapMediaInContent(sourcePage.contentHtml, resolvedMappings);

        // Snapshot obligatorio del contenido exacto ANTES de crear la pagina.
        setProductionExecutionStatus(execution.executionId, "approved", {
          mediaMappings: resolvedMappings,
          submittedContentSnapshot: remappedContent,
        });

        const created = await createProductionDraftPage({
          title: execution.seoMeta.title || sourcePage.title,
          contentHtml: remappedContent,
          excerpt: execution.seoMeta.metaDescription,
        });

        const updated = setProductionExecutionStatus(execution.executionId, "applied_to_production_draft", {
          targetPageId: created.wordpressPageId,
          targetDraftUrl: created.wordpressDraftUrl,
          mediaMappings: resolvedMappings,
          incrementAttempts: true,
        });
        if (updated) appliedThisPass.push(updated);
        setDeploymentPlanStatus(execution.deploymentPlanId, "applied_to_production_draft", { targetPageId: created.wordpressPageId });

        logger.info("Production Draft Executor: ejecucion aplicada en PRODUCCION (siempre draft, nunca publicado)", {
          executionId: execution.executionId,
          targetPageId: created.wordpressPageId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const updated = setProductionExecutionStatus(execution.executionId, "failed", { lastError: message, incrementAttempts: true });
        if (updated) failedThisPass.push(updated);
        logger.error("Production Draft Executor: fallo al aplicar una ejecucion en produccion", {
          executionId: execution.executionId,
          error: message,
        });
      }
    }
  }

  currentExecutions = readCurrentProductionExecutions();
  const pendingApprovalCount = currentExecutions.filter((e) => e.status === "pending_approval").length;
  const generatedAt = new Date().toISOString();

  const result: ProductionDraftExecutorRunResult = {
    departmentRunId: deptRunId,
    newPendingExecutions,
    newApprovalRequests,
    sentViaTelegram,
    approvedThisPass,
    cancelledThisPass,
    appliedThisPass,
    failedThisPass,
    pendingApprovalCount,
    canAttemptRealWrites,
    productionExecutionEnabled: prodStatus.executionEnabled,
    productionDraftsEnabled: prodStatus.draftsEnabled,
    productionBackend: prodStatus.backend,
    telegramEnabled,
    reportPath: "",
  };
  result.reportPath = writeReport(result, currentExecutions, generatedAt);

  logger.info(
    `Production Draft Executor finalizado. Pendientes nuevas: ${newPendingExecutions.length}. Aplicadas: ${appliedThisPass.length}. Fallidas: ${failedThisPass.length}. canAttemptRealWrites: ${canAttemptRealWrites}.`,
    { reportPath: result.reportPath }
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Production Draft Executor finalizado: ${newPendingExecutions.length} pendiente(s) nueva(s), ${appliedThisPass.length} aplicada(s), canAttemptRealWrites=${canAttemptRealWrites}.`,
    payload: { newPendingCount: newPendingExecutions.length, appliedCount: appliedThisPass.length, canAttemptRealWrites, reportPath: result.reportPath },
  });

  return result;
}
