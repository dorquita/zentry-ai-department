import * as fs from "fs";
import * as path from "path";
import { readCurrentStagingExecutions } from "../core/staging-executions";
import { findChangePackById } from "../core/change-packs";
import { extractPreviewFields } from "./wordpress-draft-agent";
import { readCurrentAssetRequests } from "../core/asset-requests";
import {
  readCurrentProductionDeploymentPlans,
  upsertProposedDeploymentPlan,
  findPlanByStagingExecutionId,
} from "../core/production-deployment-plans";
import {
  CreateApprovalRequestInput,
  findAnyRequestByRelatedId,
  readCurrentApprovalRequests,
  upsertApprovalRequest,
  markApprovalRequestSent,
} from "../core/approval-requests";
import { setDeploymentPlanStatus } from "../core/production-deployment-plans";
import { isTelegramApprovalsEnabled, sendTelegramApprovalRequest } from "../core/telegram-gateway";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ProductionDeploymentPlan, StagingExecution } from "../core/types";
import { runStagingQaAgent, StagingQaAgentRunResult } from "./staging-qa-agent";
import { getWordpressPage } from "../adapters/wordpress";
import { AutonomyRiskLevel } from "../core/autonomy-policy";
import { resolveActiveClientPaths } from "../core/client-paths";
import { isVisuallyApproved, readCurrentVisualQaApprovals } from "../core/visual-qa";
import { findExistingPageAudit, readCurrentExistingPageAudits } from "../core/existing-page-audit";

/**
 * Production Deployment Planner (Fase O13.0, aprobaciones separadas
 * desde la Fase O13.1) — 100% PLANIFICACION. Este agente NUNCA llama a
 * WordPress produccion, NUNCA publica nada, NUNCA escribe en staging
 * tampoco (solo lee). Su unico trabajo es: por cada draft de staging ya
 * `applied_to_staging` Y que pasa el Staging QA (pass, con o sin warning
 * -- nunca un draft que falla QA), proponer un `ProductionDeploymentPlan`
 * con checklist humano + plan de rollback.
 *
 * Fase O13.1 — DOS aprobaciones humanas distintas, nunca una sola
 * ambigua (ver src/core/types.ts para el comentario completo sobre
 * `DeploymentPlanStatus`). Este agente SOLO gestiona la PRIMERA:
 *   1. Aprobacion de PLAN (`plan_ready_for_review` ->
 *      `plan_approved`/`plan_rejected`): confirma que el DISENO del plan
 *      esta bien. NO autoriza ninguna escritura real.
 *
 * La SEGUNDA aprobacion (Aprobacion de EJECUCION,
 * `execution_pending_approval` -> `execution_approved`/
 * `execution_rejected`) y cualquier intento (gateado) de escritura real
 * son responsabilidad exclusiva de
 * `src/agents/production-draft-executor.ts` (Fase O13.2) — este agente
 * NUNCA la pide ni la gestiona, para que quede claro que "planificar" y
 * "ejecutar" son responsabilidades de agentes distintos, no solo de
 * estados distintos. Ver docs/production-deployment-strategy.md y
 * docs/manual-production-publish.md.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "production-deployments");
const AGENT_NAME = "production-deployment-planner";
const DEPLOYMENT_RISK_LEVEL = "critical" as const;
const APPROVAL_OPTIONS = ["approved", "rejected", "snoozed"];

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function buildChecklist(execution: StagingExecution, qaHasWarnings: boolean, hasOptimizedMedia: boolean): string[] {
  const items = [
    `Revisar visualmente el draft en staging antes de nada: ${execution.wordpressDraftUrl ?? "(sin URL registrada)"}`,
    "Confirmar que el Staging QA esta en PASA (con o sin warning) -- nunca desplegar un draft que FALLA QA.",
    "Confirmar el titulo y meta description definitivos (seoMeta de este plan) -- no son necesariamente los finales de marketing/SEO.",
    "Confirmar que no queda ningun texto de prueba/placeholder visible en el contenido.",
    hasOptimizedMedia
      ? "Confirmar que las imagenes incluidas estan en formato WebP y con peso razonable (ver Visual QA, Fase O12.9)."
      : "Este draft no tiene ninguna imagen optimizada asociada todavia -- decidir si hace falta antes de desplegar.",
    "Decidir manualmente el deploymentType real: pagina NUEVA en produccion (create_draft) o actualizacion de una pagina YA existente (update_existing_draft) -- este plan no lo decide solo.",
    "Si es una actualizacion de pagina existente: guardar un snapshot del contenido actual de produccion ANTES de tocar nada (ver rollbackPlan de este plan).",
    "Aprobar el DISENO del plan primero (Telegram/chat) -- esto NO autoriza todavia ninguna escritura real.",
    "Aprobar DESPUES, por separado, la AUTORIZACION DE EJECUCION (segunda pregunta de Telegram/chat, distinta de la anterior) ANTES de cualquier accion real en produccion.",
    "Aplicar el cambio en produccion siempre como DRAFT primero (nunca publish directo) -- revisar de nuevo en produccion antes de publicar.",
    "Confirmar que la URL/slug final en produccion es la correcta (puede diferir del slug usado en staging).",
  ];
  if (qaHasWarnings) {
    items.push("Este draft paso el QA CON warning(s) no bloqueante(s) -- revisar el informe de Staging QA para ver el detalle antes de decidir.");
  }
  return items;
}

function buildRisks(qaHasWarnings: boolean): string[] {
  const risks = [
    "Este sistema NO tiene todavia capacidad de escritura real contra produccion -- aplicar este plan hoy es siempre una accion manual fuera de este proyecto (ver docs/manual-production-publish.md).",
    "Actualizar una pagina YA existente en produccion puede pisar contenido/SEO ya indexado si no se revisa con cuidado antes de guardar.",
    "El slug/URL final en produccion puede no coincidir con el de staging -- cambiarlo despues de indexado tiene coste SEO.",
    "Las credenciales/entorno de produccion son distintos de staging -- cualquier automatizacion futura debe volver a verificar `WORDPRESS_ENV` antes de escribir.",
  ];
  if (qaHasWarnings) {
    risks.push("El Staging QA reporto al menos un warning no bloqueante para este draft -- revisar antes de decidir si bloquea el deploy o no.");
  }
  return risks;
}

function buildRollbackPlan(execution: StagingExecution): string[] {
  return [
    "Produccion no se toca por este sistema en esta fase -- no hay nada que revertir automaticamente hoy.",
    "Si en el futuro se aplica MANUALMENTE via wp-admin: copiar/guardar el HTML del editor de la pagina de produccion ANTES de pegar el contenido nuevo (snapshot manual), y no publicar hasta confirmar visualmente el resultado.",
    "Si en el futuro existe un adapter de escritura selectiva a produccion (Opcion B, REST): debe seguir el mismo patron ya usado en staging -- snapshot completo del contenido anterior antes de escribir (ver src/core/draft-image-insertions.ts / src/core/staging-executions.ts), y una funcion de rollback que restaure ese snapshot tal cual.",
    `Snapshot de origen disponible: draft de staging \`${execution.wordpressPageId}\` (${execution.wordpressDraftUrl ?? "sin URL"}), que en si mismo queda intacto y sigue sirviendo de referencia pase lo que pase en produccion.`,
  ];
}

export interface ProductionDeploymentPlannerRunResult {
  departmentRunId: string;
  newPlans: ProductionDeploymentPlan[];
  existingPlans: ProductionDeploymentPlan[];
  skippedNoQaPass: number;
  skippedVisualReviewNeeded: number;
  skippedDuplicateCanonicalKey: number;
  skippedDuplicatePage: number;
  newApprovalRequests: number;
  sentViaTelegram: number;
  planApprovedThisPass: number;
  planRejectedThisPass: number;
  telegramEnabled: boolean;
  totalPlanCount: number;
  reportPath: string;
}

function buildReportMarkdown(result: ProductionDeploymentPlannerRunResult, allPlans: ProductionDeploymentPlan[], generatedAt: string): string {
  const lines: string[] = [];
  const executionDate = generatedAt.slice(0, 10);

  lines.push(`# Production Deployment Planner — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");
  lines.push(
    "**Recordatorio de seguridad: este informe es PURA PLANIFICACION. Ningun plan de este fichero, este agente ni este pase de `growth:daily` ha escrito nada en WordPress produccion. Produccion sigue intacta.**"
  );
  lines.push("");
  lines.push(`- Planes nuevos esta pasada: **${result.newPlans.length}**`);
  lines.push(`- Planes ya existentes (sin cambios): **${result.existingPlans.length}**`);
  lines.push(`- Drafts de staging sin QA pass todavia (omitidos, no se les propone plan): **${result.skippedNoQaPass}**`);
  lines.push(`- Omitidos por falta de revision visual humana (Fase O27.3 -- QA tecnico pasado no es lo mismo que listo para producción, ver src/core/visual-qa.ts): **${result.skippedVisualReviewNeeded}**`);
  lines.push(`- Omitidos por ya existir un plan sin resolver para el mismo canonicalKey (Fase O27, evita duplicados por Telegram): **${result.skippedDuplicateCanonicalKey}**`);
  lines.push(`- Omitidos por ya existir un plan sin resolver para la misma pagina real (Fase O27.2, otro change pack distinto sobre la misma URL): **${result.skippedDuplicatePage}**`);
  lines.push(`- Nuevas solicitudes de aprobacion: **${result.newApprovalRequests}** (enviadas por Telegram: ${result.sentViaTelegram})`);
  lines.push(
    `- Aprobaciones de PLAN esta pasada: ${result.planApprovedThisPass} aprobados / ${result.planRejectedThisPass} rechazados`
  );
  lines.push("");
  lines.push(
    "**Recordatorio de semantica (Fase O13.1/O13.2):** \"aprobar el plan\" (`plan_approved`) NUNCA autoriza una escritura real -- solo confirma que el DISENO esta bien. La aprobacion de EJECUCION (segunda pregunta, distinta) y cualquier intento de escritura real son responsabilidad de `production-draft-executor.ts` (`npm run production:execute`), no de este agente."
  );
  lines.push("");

  lines.push(`## Todos los planes (${allPlans.length})`);
  lines.push("");
  if (allPlans.length === 0) {
    lines.push("Ninguno todavia.");
  } else {
    for (const p of allPlans) {
      lines.push(`### [${p.status}] ${p.keyword}${p.page ? ` (${p.page})` : ""} — \`${p.deploymentPlanId}\``);
      lines.push("");
      lines.push(`- sourceDraftId (staging): \`${p.sourceDraftId}\` — ${p.sourceDraftUrl}`);
      lines.push(`- targetPageId (produccion): ${p.targetPageId ?? "(ninguno todavia -- pagina nueva)"}`);
      lines.push(`- deploymentType propuesto: \`${p.deploymentType}\` (a confirmar manualmente, ver checklist)`);
      lines.push(`- seoMeta: title="${p.seoMeta.title}" | metaDescription="${p.seoMeta.metaDescription}"`);
      lines.push(`- media incluida: ${p.includedMediaIds.length > 0 ? p.includedMediaIds.join(", ") : "(ninguna)"}`);
      lines.push(`- approvalRequestId: ${p.approvalRequestId ?? "(pendiente de crear)"}`);
      lines.push("");
      lines.push("**Checklist antes de produccion:**");
      for (const item of p.checklist) lines.push(`- [ ] ${item}`);
      lines.push("");
      lines.push("**Riesgos:**");
      for (const risk of p.risks) lines.push(`- ${risk}`);
      lines.push("");
      lines.push("**Plan de rollback:**");
      for (const step of p.rollbackPlan) lines.push(`- ${step}`);
      lines.push("");
    }
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- Este agente es 100% planificacion: no existe ninguna llamada de escritura a WordPress produccion en todo el fichero.");
  lines.push("- Tampoco escribe en staging -- solo lee ejecuciones ya aplicadas y resultados de QA ya generados/recalculados en memoria.");
  lines.push("- Ni \"plan_approved\" NI \"execution_approved\" ejecutan nada por si solos -- no existe todavia ningun codigo en este proyecto que aplique un plan a produccion.");
  lines.push("- Produccion no se ha tocado: este agente no conoce ninguna variable de produccion de WordPress ni le hace ninguna peticion.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: ProductionDeploymentPlannerRunResult, allPlans: ProductionDeploymentPlan[], generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `production-deployments-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, allPlans, generatedAt), "utf-8");
  return filePath;
}

export async function runProductionDeploymentPlanner(departmentRunId?: string): Promise<ProductionDeploymentPlannerRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Production Deployment Planner iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Production Deployment Planner iniciado" });

  // Reutiliza el Staging QA Agent en memoria (mismo patron que otros
  // agentes de este proyecto que reusan la funcion pura de otro agente)
  // para saber, sin volver a implementar el criterio, que drafts pasan
  // QA. Vuelve a escribir su propio informe de QA (idempotente, solo
  // lectura, sin efecto real) -- no hay otro registro persistente de
  // resultados de QA todavia.
  const qaResult: StagingQaAgentRunResult = await runStagingQaAgent(deptRunId);

  const executions = readCurrentStagingExecutions().filter(
    (e): e is StagingExecution & { wordpressPageId: number } => e.status === "applied_to_staging" && typeof e.wordpressPageId === "number"
  );

  let current = readCurrentProductionDeploymentPlans();
  const newPlans: ProductionDeploymentPlan[] = [];
  const existingPlans: ProductionDeploymentPlan[] = [];
  let skippedNoQaPass = 0;
  let skippedVisualReviewNeeded = 0;
  let skippedDuplicateCanonicalKey = 0;
  let skippedDuplicatePage = 0;
  const visualApprovals = readCurrentVisualQaApprovals();

  // Fase O27 -- corrige el bug real de "Plan de deploy a produccion"
  // duplicado por Telegram (mismo canonicalKey, dos stagingExecutionId
  // distintos -- ej. "taquillas escolares" con dos executionId porque el
  // change pack de origen se regenero una vez). findPlanByStagingExecutionId()
  // dedupe por executionId, que es correcto para ACTUALIZAR el plan de
  // UNA ejecucion concreta, pero no evita crear un SEGUNDO plan cuando la
  // ejecucion de origen es distinta pero representa, para un humano, la
  // MISMA pagina/decision. Antes de crear un plan nuevo, comprobamos si ya
  // hay un plan sin resolver (no `plan_rejected`/`cancelled`/
  // `applied_to_production_draft`/`rolled_back`) para OTRA ejecucion con
  // el mismo canonicalKey -- si lo hay, no se crea un segundo, se cuenta
  // aparte y se deja constancia en el informe.
  const canonicalKeyByExecutionId = new Map(executions.map((e) => [e.executionId, e.canonicalKey]));
  const UNRESOLVED_PLAN_STATUSES = new Set(["draft", "plan_ready_for_review", "plan_approved", "execution_pending_approval", "execution_approved"]);

  // Fase O27.2 -- segundo bug real encontrado en el primer batch escalado
  // de 15 tareas: 4 paginas recibieron DOS change packs distintos (uno
  // seo_on_page_update, otro content_update) el mismo dia -- canonicalKey
  // distinto a proposito (son propuestas de contenido diferentes), pero
  // para Pau son "la misma pagina pidiendo aprobacion dos veces" en su
  // Telegram. Ademas del dedup por canonicalKey de arriba, tambien se
  // comprueba por PAGINA REAL (`execution.page`): si ya hay un plan sin
  // resolver para la misma pagina (de OTRO canonicalKey), tampoco se crea
  // un segundo -- se avisa en el log/informe para que se revisen juntos
  // cuando llegue el momento, en vez de mandar 2 decisiones separadas por
  // la misma URL.
  const pageByExecutionId = new Map(executions.map((e) => [e.executionId, e.page]));

  for (const execution of executions) {
    const qaForThis = qaResult.draftResults.find((d) => d.wordpressPageId === execution.wordpressPageId);
    // Fase O13.6b (postmortem): QA tecnico YA no es suficiente para
    // proponer un plan de deploy a produccion -- hace falta ADEMAS que
    // la checklist visual/SEO/CRO (botones reales, bloques visuales, CTA
    // above the fold, estructura de encabezados, contenido suficiente,
    // sin placeholders) pase tambien. Bloquea la promocion a produccion
    // de cualquier landing "plana", aunque el QA tecnico la deje pasar.
    if (!qaForThis || !qaForThis.overallPass || !qaForThis.landingQa.pass) {
      skippedNoQaPass += 1;
      continue;
    }

    // Fase O27.3 (postmortem visual de Pau): "el QA tecnico paso" NO
    // significa "esta lista para producción" -- los borradores pasaban
    // QA estructural pero visualmente parecian bocetos (encabezados
    // "H2:" literales, parrafos repetidos, sin jerarquia visual clara).
    // A partir de ahora, ademas del QA tecnico, hace falta que una
    // persona haya confirmado explicitamente la pagina via
    // markVisuallyApproved() (ver src/core/visual-qa.ts) antes de
    // proponerle a Pau un plan de deploy a produccion. Si no esta
    // aprobada visualmente, el change pack se queda en qa_passed --
    // disponible, pero sin generar todavia una decision de producción.
    if (!isVisuallyApproved(execution.wordpressPageId, visualApprovals)) {
      skippedVisualReviewNeeded += 1;
      logger.info("Production Deployment Planner: plan no creado, falta revision visual humana (QA tecnico OK, visual pendiente)", {
        wordpressPageId: execution.wordpressPageId,
        executionId: execution.executionId,
        keyword: execution.keyword,
      });
      continue;
    }

    const existing = findPlanByStagingExecutionId(execution.executionId, current);
    if (existing) {
      existingPlans.push(existing);
      continue;
    }

    const duplicateUnresolvedPlan = current.find(
      (p) =>
        UNRESOLVED_PLAN_STATUSES.has(p.status) &&
        p.stagingExecutionId !== execution.executionId &&
        canonicalKeyByExecutionId.get(p.stagingExecutionId) === execution.canonicalKey
    );
    if (duplicateUnresolvedPlan) {
      skippedDuplicateCanonicalKey += 1;
      logger.info("Production Deployment Planner: plan no creado, ya existe uno sin resolver para el mismo canonicalKey", {
        canonicalKey: execution.canonicalKey,
        executionId: execution.executionId,
        existingPlanId: duplicateUnresolvedPlan.deploymentPlanId,
        existingPlanStagingExecutionId: duplicateUnresolvedPlan.stagingExecutionId,
      });
      continue;
    }

    const duplicateUnresolvedPlanForPage =
      execution.page &&
      current.find(
        (p) =>
          UNRESOLVED_PLAN_STATUSES.has(p.status) &&
          p.stagingExecutionId !== execution.executionId &&
          Boolean(pageByExecutionId.get(p.stagingExecutionId)) &&
          pageByExecutionId.get(p.stagingExecutionId) === execution.page
      );
    if (duplicateUnresolvedPlanForPage) {
      skippedDuplicatePage += 1;
      logger.info("Production Deployment Planner: plan no creado, ya existe uno sin resolver para la misma pagina real (otro changePack)", {
        page: execution.page,
        executionId: execution.executionId,
        existingPlanId: duplicateUnresolvedPlanForPage.deploymentPlanId,
        existingPlanStagingExecutionId: duplicateUnresolvedPlanForPage.stagingExecutionId,
      });
      continue;
    }

    const changePack = findChangePackById(execution.changePackId);
    const previewFields = changePack ? extractPreviewFields(changePack) : undefined;

    const assetRequestsForPack = readCurrentAssetRequests().filter(
      (r) => r.changePackId === execution.changePackId && r.status === "uploaded_to_wordpress" && typeof r.wordpressMediaId === "number"
    );
    const includedAssetRequests = assetRequestsForPack.map((r) => r.assetRequestId);

    // No nos fiamos del wordpressMediaId guardado en el asset request:
    // puede haberse sustituido despues (p.ej. PNG -> WebP, Fase O12.9) sin
    // que ese registro se actualice. Leemos el contenido REAL y actual
    // del draft (misma fuente de verdad que usa Staging QA) y extraemos
    // los media IDs realmente en uso hoy.
    let includedMediaIds: number[] = [];
    try {
      const livePage = await getWordpressPage(execution.wordpressPageId);
      const mediaMatches = [...livePage.contentHtml.matchAll(/wp-image-(\d+)/g)].map((m) => Number(m[1]));
      includedMediaIds = [...new Set(mediaMatches)];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("No se pudo leer el contenido actual del draft para detectar los media IDs reales -- usando los del registro de asset requests como respaldo", {
        wordpressPageId: execution.wordpressPageId,
        error: message,
      });
      includedMediaIds = assetRequestsForPack
        .map((r) => r.wordpressMediaId)
        .filter((id): id is number => typeof id === "number");
    }

    const checklist = buildChecklist(execution, qaForThis.hasWarnings, includedMediaIds.length > 0);
    const risks = buildRisks(qaForThis.hasWarnings);
    const rollbackPlan = buildRollbackPlan(execution);

    const { plan } = upsertProposedDeploymentPlan(
      {
        changePackId: execution.changePackId,
        stagingExecutionId: execution.executionId,
        keyword: execution.keyword,
        page: execution.page,
        sourceDraftId: execution.wordpressPageId,
        sourceDraftUrl: execution.wordpressDraftUrl ?? "",
        deploymentType: "create_draft",
        includedMediaIds,
        includedAssetRequests,
        seoMeta: { title: previewFields?.title ?? "", metaDescription: previewFields?.metaDescription ?? "" },
        checklist,
        risks,
        rollbackPlan,
        requiredApprovals: ["plan_design_review", "production_execution_authorization"],
      },
      current
    );
    newPlans.push(plan);

    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "recommendation_created",
      summary: `Nuevo plan de deploy a produccion propuesto (solo planificacion): ${execution.keyword}`,
      payload: { deploymentPlanId: plan.deploymentPlanId, stagingExecutionId: execution.executionId },
    });
  }

  // --- Aprobacion, mismo patron que staging-executor.ts, pero en DOS
  // ETAPAS SEPARADAS (Fase O13.1) para eliminar la ambiguedad entre
  // "aprobar que el plan esta bien disenado" y "autorizar una escritura
  // real". Cada etapa tiene su propio relatedId (evita que la segunda
  // pregunta se confunda con la dedup de la primera) y su propio texto
  // explicito enviado por Telegram. ---
  const telegramEnabled = isTelegramApprovalsEnabled();
  let newApprovalRequests = 0;
  let sentViaTelegram = 0;
  let planApprovedThisPass = 0;
  let planRejectedThisPass = 0;
  let executionApprovedThisPass = 0;
  let executionRejectedThisPass = 0;

  async function sendApproval(
    request: {
      approvalRequestId: string;
      relatedType: string;
      title: string;
      summary: string;
      riskLevel: AutonomyRiskLevel;
      requestedAction: string;
      options: string[];
    },
    context?: { stagingUrl?: string; productionUrl?: string; pageType?: "update_existing_page" | "new_page_candidate" }
  ): Promise<boolean> {
    try {
      await sendTelegramApprovalRequest({
        approvalRequestId: request.approvalRequestId,
        relatedType: request.relatedType,
        title: request.title,
        summary: request.summary,
        riskLevel: request.riskLevel,
        requestedAction: request.requestedAction,
        options: request.options,
        stagingUrl: context?.stagingUrl,
        productionUrl: context?.productionUrl,
        pageType: context?.pageType,
      });
      const updated = markApprovalRequestSent(request.approvalRequestId, "telegram");
      return Boolean(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Fallo al enviar por Telegram una aprobacion de deploy a produccion", {
        approvalRequestId: request.approvalRequestId,
        error: message,
      });
      return false;
    }
  }

  // --- ETAPA 1: aprobacion de PLAN ---
  let currentApprovalRequests = readCurrentApprovalRequests();
  const plansAwaitingPlanReview = readCurrentProductionDeploymentPlans().filter((p) => p.status === "plan_ready_for_review");

  for (const plan of plansAwaitingPlanReview) {
    let approvalRequest = findAnyRequestByRelatedId(plan.deploymentPlanId, currentApprovalRequests);
    if (!approvalRequest) {
      const input: CreateApprovalRequestInput = {
        relatedType: "production_deployment_plan",
        relatedId: plan.deploymentPlanId,
        title: `${plan.keyword}${plan.page ? ` (${plan.page})` : ""}`,
        summary: `Draft de staging \`${plan.sourceDraftId}\` (${plan.sourceDraftUrl}) tiene un plan de deploy a produccion propuesto. Esto es una APROBACION DE PLAN: confirma que el DISENO (checklist, media, SEO, rollback) esta bien -- NO autoriza ninguna escritura real. Si apruebas esto, se pedira DESPUES una segunda aprobacion, distinta, para autorizar la ejecucion real.`,
        riskLevel: DEPLOYMENT_RISK_LEVEL,
        requestedAction: "Revisar y aprobar el diseno del plan (no autoriza escribir en produccion).",
        options: APPROVAL_OPTIONS,
        channel: "telegram",
      };
      const { request, isNew } = upsertApprovalRequest(input, currentApprovalRequests);
      approvalRequest = request;
      currentApprovalRequests = readCurrentApprovalRequests();
      if (isNew) {
        newApprovalRequests += 1;
        emitEvent({
          departmentRunId: deptRunId,
          agent: AGENT_NAME,
          type: "approval_required",
          priority: "high",
          summary: `Nueva solicitud de APROBACION DE PLAN para un deploy a produccion: ${plan.keyword}`,
          payload: { approvalRequestId: request.approvalRequestId, deploymentPlanId: plan.deploymentPlanId, stage: "plan_review" },
        });
        if (telegramEnabled) {
          const audit = findExistingPageAudit(plan.sourceDraftId, readCurrentExistingPageAudits());
          const pageType = audit?.matchType ?? (plan.page ? "update_existing_page" : "new_page_candidate");
          if (
            await sendApproval(request, {
              stagingUrl: plan.sourceDraftUrl,
              productionUrl: audit?.productionUrl ?? plan.page,
              pageType,
            })
          ) {
            sentViaTelegram += 1;
          }
        }
      }
    }

    if (approvalRequest.status === "approved") {
      setDeploymentPlanStatus(plan.deploymentPlanId, "plan_approved", { approvalRequestId: approvalRequest.approvalRequestId });
      planApprovedThisPass += 1;
    } else if (approvalRequest.status === "rejected") {
      setDeploymentPlanStatus(plan.deploymentPlanId, "plan_rejected", { approvalRequestId: approvalRequest.approvalRequestId });
      planRejectedThisPass += 1;
    }
    // pending/snoozed: el plan se queda en plan_ready_for_review, se reintenta la siguiente pasada.
  }

  current = readCurrentProductionDeploymentPlans();
  const generatedAt = new Date().toISOString();
  const result: ProductionDeploymentPlannerRunResult = {
    departmentRunId: deptRunId,
    newPlans,
    existingPlans,
    skippedNoQaPass,
    skippedVisualReviewNeeded,
    skippedDuplicateCanonicalKey,
    skippedDuplicatePage,
    newApprovalRequests,
    sentViaTelegram,
    planApprovedThisPass,
    planRejectedThisPass,
    telegramEnabled,
    totalPlanCount: current.length,
    reportPath: "",
  };
  result.reportPath = writeReport(result, current, generatedAt);

  logger.info(
    `Production Deployment Planner finalizado. Planes nuevos: ${newPlans.length}. Total: ${current.length}. Produccion NO tocada.`,
    { reportPath: result.reportPath }
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Production Deployment Planner finalizado: ${newPlans.length} plan(es) nuevo(s), ${current.length} en total. Produccion no tocada.`,
    payload: { newPlanCount: newPlans.length, totalPlanCount: current.length, reportPath: result.reportPath },
  });

  return result;
}
