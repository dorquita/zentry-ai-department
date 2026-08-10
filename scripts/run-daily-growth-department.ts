/**
 * Pase diario UNICO del departamento Web & Growth. Ejecuta, en orden, a
 * todos los agentes bajo un mismo departmentRunId compartido, y termina
 * enviando UN SOLO email con el informe EJECUTIVO de Growth Director
 * (Fase O9): lenguaje natural, deduplicado, priorizado, sin IDs ni
 * detalle tecnico. El informe tecnico completo (para auditoria/
 * debugging) se genera en paralelo pero nunca se envia por email — ver
 * docs/daily-growth-report.md.
 *
 * Orden:
 *   1. SEO Watcher              (Search Console real, solo lectura)
 *   2. SEO Director             (agrupa/prioriza)
 *   3. Competitor Intelligence  (HTML publico de competidores, solo lectura)
 *   4. Content Planner          (propuestas de contenido)
 *   5. CRO / Landing Reviewer   (propuestas de conversion)
 *   6. SEM Watcher              (Google Ads real si hay credenciales, Fase O11)
 *   7. Analytics Watcher        (GA4/GTM real si hay credenciales, Fase O11)
 *   8. Approval Queue           (deduplica y clasifica todo lo anterior en el Action Backlog,
 *                                 aplicando la politica de autonomia, Fase O7)
 *   9. Approved Action Planner  (crea work orders draft para acciones `approved` Y
 *                                 `auto_approved_for_planning`, Fase O7)
 *   10. SEO Work Order Builder  (amplia work orders draft de categoria SEO)
 *   11. Content Work Order Builder (amplia las de categoria content)
 *   12. CRO Work Order Builder  (amplia las de categoria CRO)
 *   13. SEO Change Pack Builder     (convierte work orders SEO elegibles en change packs)
 *   14. Content Change Pack Builder (convierte work orders de contenido elegibles en change packs)
 *   15. CRO Change Pack Builder     (convierte work orders CRO elegibles en change packs)
 *   16. WordPress Draft Agent   (convierte change packs listos en previews locales, y en
 *                                 borradores REALES de WordPress -siempre `draft`, nunca
 *                                 publicados- solo si WORDPRESS_DRAFTS_ENABLED=true, el
 *                                 change pack esta approved_to_execute y hay aprobacion
 *                                 explicita de Telegram para ese borrador concreto)
 *   17. Visual Template Builder (Fase O12.4: genera un preview VISUAL adicional -.md,
 *                                 mismo directorio de previews- mapeando el change pack sobre
 *                                 una de las 5 plantillas de src/core/visual-templates.ts.
 *                                 Nunca toca WordPress, nunca genera una imagen real)
 *   18. Visual Asset Planner    (Fase O12.4: propone que imagenes necesitaria cada change
 *                                 pack -data/asset-requests.jsonl, status "proposed"-. NUNCA
 *                                 llama a n8n, NUNCA genera ni sube una imagen real)
 *   19. Staging Executor        (Fase O12: unica via de ejecucion controlada REAL contra
 *                                 staging -crear/actualizar un borrador, nunca publicar,
 *                                 nunca produccion- solo si STAGING_EXECUTION_ENABLED=true
 *                                 ademas de los interruptores del paso 16, y con su propia
 *                                 aprobacion de Telegram por ejecucion)
 *   20. Staging QA Agent        (Fase O12: solo lectura, verifica lo que el Staging Executor
 *                                 aplico -carga, sin errores PHP, noindex, sin <form>...-)
 *   21. Approval Gateway        (Fase O8: crea solicitudes de aprobacion para lo que
 *                                 clasifique como INSTANT_APPROVAL_REQUIRED y las envia
 *                                 por Telegram si TELEGRAM_APPROVALS_ENABLED=true)
 *   22. Production Deployment Planner (Fase O13.0/O13.1: PURA PLANIFICACION -- propone
 *                                 como se aplicaria a produccion un draft de staging ya
 *                                 `applied_to_staging` y que pasa Staging QA -checklist +
 *                                 plan de rollback-, y gestiona la aprobacion de PLAN
 *                                 -confirma el diseno, nunca autoriza escribir-. NUNCA
 *                                 escribe en WordPress produccion)
 *   23. Production Draft Executor (Fase O13.2: unica via de ejecucion controlada real
 *                                 contra produccion -crear SOLO un draft nuevo + subir su
 *                                 media, nunca publicar, nunca produccion sin las 3
 *                                 condiciones de entorno a la vez- con su propia
 *                                 aprobacion de EJECUCION de Telegram, distinta de la de
 *                                 plan, y solo para planes ya `plan_approved`. Con los
 *                                 flags por defecto -false/false/rest- nunca llega a
 *                                 llamar a WordPress produccion, pase lo que pase con las
 *                                 aprobaciones)
 *   24. Growth Director         (Fase O9: consolida todo en un informe ejecutivo +
 *                                 un informe tecnico, ambos en reports/daily/)
 *   25. Email final unico (cuerpo = informe ejecutivo)
 *
 * Uso:
 *   npm run growth:daily                              (== --client zentry, comportamiento identico a antes de la Fase O16)
 *   npm run growth:daily -- --client zentry            (identico al de arriba, explicito)
 *   npm run growth:daily -- --client demo --dry-run    (Fase O16: solo valida ClientConfig + estructura, CERO agentes reales)
 *   npm run growth:daily -- --dry-run                  (dry-run tambien disponible para zentry como valvula de seguridad)
 *
 * No toca WordPress salvo los tres casos controlados de arriba (pasos 16,
 * 19 y 23), todos siempre `draft`, nunca publicados. Los pasos 16 y 19
 * son SOLO staging; el paso 23 es el UNICO que podria llegar a tocar
 * produccion, y solo si las 3 condiciones de entorno
 * (PRODUCTION_EXECUTION_ENABLED, PRODUCTION_DRAFTS_ENABLED,
 * PRODUCTION_BACKEND=rest) Y las 2 aprobaciones de Telegram (plan +
 * ejecucion) ya se cumplen — con los valores por defecto de hoy, nunca
 * se cumplen las 3 condiciones de entorno a la vez. No toca Google Ads,
 * GA4, GTM, n8n ni qdrant (mas alla de la lectura ya descrita en los
 * pasos 6/7). Los pasos 17/18 (Fase O12.4) son PURA PLANIFICACION: ni
 * generan imagenes reales ni llaman a n8n bajo ninguna circunstancia. No
 * publica nunca ninguna pagina, no modifica ninguna pagina existente
 * salvo un borrador que el propio Staging Executor haya creado antes, no
 * toca home/formularios/WooCommerce/precios/checkout. Los change packs
 * tampoco ejecutan nada por si mismos, ni siquiera en
 * `approved_to_execute` — necesitan pasar por el Staging Executor Y su
 * propia aprobacion de Telegram. Ver docs/autonomy-policy.md,
 * docs/notification-gateway.md, docs/change-packs.md,
 * docs/wordpress-draft-agent.md, docs/wordpress-safety-policy.md,
 * docs/staging-execution.md, docs/staging-rollback.md,
 * docs/visual-template-system.md, docs/asset-generation-workflow.md,
 * docs/n8n-asset-webhook-contract.md, docs/daily-growth-report.md,
 * docs/production-deployment-strategy.md, docs/production-rollback.md
 * y docs/multi-client-architecture.md (Fase O16).
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { buildDepartmentRunId } from "../src/core/department-run-id";
import { runSeoWatcher } from "../src/agents/seo-watcher";
import { runSeoDirector } from "../src/agents/seo-director";
import { runCompetitorIntelligence } from "../src/agents/competitor-intelligence";
import { runContentPlanner } from "../src/agents/content-planner";
import { runCroLandingReviewer } from "../src/agents/cro-landing-reviewer";
import { runSemWatcher } from "../src/agents/sem-watcher";
import { runAnalyticsWatcher } from "../src/agents/analytics-watcher";
import { runApprovalQueue } from "../src/agents/approval-queue";
import { runApprovedActionPlanner } from "../src/agents/approved-action-planner";
import { runSeoWorkOrderBuilder } from "../src/agents/seo-work-order-builder";
import { runContentWorkOrderBuilder } from "../src/agents/content-work-order-builder";
import { runCroWorkOrderBuilder } from "../src/agents/cro-work-order-builder";
import { runSeoChangePackBuilder } from "../src/agents/seo-change-pack-builder";
import { runContentChangePackBuilder } from "../src/agents/content-change-pack-builder";
import { runCroChangePackBuilder } from "../src/agents/cro-change-pack-builder";
import { runUxUiLandingArchitect } from "../src/agents/ux-ui-landing-architect";
import { runWordpressDraftAgent } from "../src/agents/wordpress-draft-agent";
import { runVisualTemplateBuilder } from "../src/agents/visual-template-builder";
import { runVisualAssetPlanner } from "../src/agents/visual-asset-planner";
import { runStagingExecutor } from "../src/agents/staging-executor";
import { runStagingQaAgent } from "../src/agents/staging-qa-agent";
import { runApprovalGateway } from "../src/agents/approval-gateway";
import { runProductionDeploymentPlanner } from "../src/agents/production-deployment-planner";
import { runProductionDraftExecutor } from "../src/agents/production-draft-executor";
import { runGrowthDirector } from "../src/agents/growth-director";
import { resolveDataSource } from "../src/adapters";
import { sendReportEmail, EmailContent } from "../src/core/mailer";
import { logger } from "../src/core/logger";
import { resolveClientId, loadClientConfig, DEFAULT_CLIENT_ID, ClientConfig } from "../src/core/client-config";
import { ensureClientDirsExist } from "../src/core/client-paths";

const TOTAL_STEPS = 26;

function assertRealDataSource(): void {
  const dataSource = resolveDataSource();
  if (dataSource !== "search_console") {
    throw new Error(
      `El pase diario del departamento requiere SEO_DATA_SOURCE=search_console (valor actual: "${dataSource}"). Ajusta .env antes de ejecutar npm run growth:daily.`
    );
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEmailContent(
  departmentRunId: string,
  executiveReportPath: string,
  preparedForReviewCount: number,
  pendingDecisionCount: number
): EmailContent {
  const dateLabel =
    departmentRunId.match(/growth-department-(\d{4}-\d{2}-\d{2})T/)?.[1] ?? new Date().toISOString().slice(0, 10);
  const subject =
    pendingDecisionCount > 0
      ? `Web & Growth — Informe diario ${dateLabel}: ${preparedForReviewCount} propuesta(s) preparada(s), ${pendingDecisionCount} por aprobar`
      : `Web & Growth — Informe diario ${dateLabel}: ${preparedForReviewCount} propuesta(s) preparada(s), sin decisiones pendientes`;
  const reportMarkdown = fs.readFileSync(executiveReportPath, "utf-8");
  const text = reportMarkdown;
  const html = `<pre style="font-family: monospace; white-space: pre-wrap; font-size: 13px;">${escapeHtml(reportMarkdown)}</pre>`;
  return { subject, text, html };
}

/**
 * Fase O16 — pase "seco": ni un solo agente real se invoca. Usado para
 * cualquier cliente sandbox (isSandbox=true, ej. "demo") o cuando se
 * pasa --dry-run explicitamente para cualquier cliente. Solo valida el
 * ClientConfig, confirma/crea el esqueleto de carpetas del cliente (si
 * no es "zentry", que usa las carpetas legacy de la raiz sin tocarlas)
 * y escribe un marcador de texto plano — cero red, cero WordPress, cero
 * email, cero Ads/GA4/GTM/n8n/Telegram.
 */
function runDryRunPass(clientConfig: ClientConfig): void {
  console.log(`\nModo dry-run (Fase O16) para cliente "${clientConfig.clientId}".`);
  console.log(`  clientName: ${clientConfig.clientName}`);
  console.log(`  brandName: ${clientConfig.brandName}`);
  console.log(`  isSandbox: ${clientConfig.isSandbox}`);
  console.log(`  allowedServices: ${clientConfig.allowedServices.length}`);
  console.log(`  wiringStatus: ${clientConfig.wiringStatus}`);

  const paths = ensureClientDirsExist(clientConfig.clientId);
  console.log(`  dataDir: ${paths.dataDir} (legacy=${paths.usesLegacyRootPaths})`);
  console.log(`  reportsDir: ${paths.reportsDir}`);
  console.log(`  logsDir: ${paths.logsDir}`);

  if (!paths.usesLegacyRootPaths) {
    const marker = path.join(paths.reportsDir, `dry-run-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    const content = [
      `# Dry-run — cliente ${clientConfig.clientId}`,
      "",
      `Generado: ${new Date().toISOString()}`,
      "",
      "Este pase NO invoco ningun agente real (SEO Watcher, WordPress, Ads, GA4, GTM, Telegram, n8n...). Solo confirma que la estructura ClientConfig del cliente carga y valida correctamente.",
      "",
      `- clientName: ${clientConfig.clientName}`,
      `- brandName: ${clientConfig.brandName}`,
      `- isSandbox: ${clientConfig.isSandbox}`,
      `- allowedServices: ${clientConfig.allowedServices.length}`,
    ].join("\n");
    fs.writeFileSync(marker, content, "utf-8");
    console.log(`  Marcador de dry-run escrito: ${marker}`);
  } else {
    console.log("  (cliente con carpetas legacy: no se escribe ningun marcador para no tocar reports/ de zentry)");
  }

  console.log("\nDry-run completo. Ningun agente real se ejecuto, ningun email se envio, ninguna red se toco.");
}

async function runRealPass(): Promise<void> {
  assertRealDataSource();

  const departmentRunId = buildDepartmentRunId();
  logger.info("Pase diario del departamento Web & Growth: inicio", { departmentRunId });
  console.log(`departmentRunId: ${departmentRunId}`);

  console.log(`\n[1/${TOTAL_STEPS}] SEO Watcher...`);
  const seoWatcherResult = await runSeoWatcher(departmentRunId);
  console.log(`  ${seoWatcherResult.jobs.length} oportunidad(es), ${seoWatcherResult.rowsRead} fila(s) leidas.`);

  console.log(`[2/${TOTAL_STEPS}] SEO Director...`);
  const seoDirectorResult = await runSeoDirector(departmentRunId);
  console.log(`  ${seoDirectorResult.items.length} accion(es) agrupada(s).`);

  console.log(`[3/${TOTAL_STEPS}] Competitor Intelligence...`);
  const competitorResult = await runCompetitorIntelligence(departmentRunId);
  console.log(
    `  ${competitorResult.pages.filter((p) => p.status === "ok").length}/${competitorResult.pages.length} paginas leidas, ${competitorResult.keywordGaps.length} gap(s) de keyword.`
  );

  console.log(`[4/${TOTAL_STEPS}] Content Planner...`);
  const contentResult = await runContentPlanner(departmentRunId);
  console.log(`  ${contentResult.items.length} propuesta(s) de contenido.`);

  console.log(`[5/${TOTAL_STEPS}] CRO / Landing Reviewer...`);
  const croResult = await runCroLandingReviewer(departmentRunId);
  console.log(`  ${croResult.reviews.length} landing(s) revisada(s).`);

  console.log(`[6/${TOTAL_STEPS}] SEM Watcher...`);
  const semResult = await runSemWatcher(departmentRunId);
  console.log(`  conectado=${semResult.connected}, campana=${semResult.campaignState.status}.`);

  console.log(`[7/${TOTAL_STEPS}] Analytics Watcher...`);
  const analyticsResult = await runAnalyticsWatcher(departmentRunId);
  console.log(`  GA4 conectado=${analyticsResult.ga4Connected}, GTM conectado=${analyticsResult.gtmConnected}.`);

  console.log(`[8/${TOTAL_STEPS}] Approval Queue (deduplicando y aplicando la politica de autonomia)...`);
  const approvalQueueResult = await runApprovalQueue(departmentRunId);
  console.log(
    `  auto_procesadas=${approvalQueueResult.autoProcessedActions.length} auto_aprobadas_planificacion=${approvalQueueResult.autoApprovedForPlanningActions.length} pend_aprobacion=${approvalQueueResult.waitingApprovalActions.length} bloqueadas=${approvalQueueResult.blockedActionsThisRun.length}`
  );

  console.log(`[9/${TOTAL_STEPS}] Approved Action Planner (creando work orders draft)...`);
  const approvedActionPlannerResult = await runApprovedActionPlanner(departmentRunId);
  console.log(
    `  planificables=${approvedActionPlannerResult.approvedActionCount} (humanas=${approvedActionPlannerResult.humanApprovedCount}, auto=${approvedActionPlannerResult.autoApprovedForPlanningCount}) nuevas_work_orders=${approvedActionPlannerResult.newWorkOrders.length}`
  );

  console.log(`[10/${TOTAL_STEPS}] SEO Work Order Builder...`);
  const seoWorkOrderResult = await runSeoWorkOrderBuilder(departmentRunId);
  console.log(`  ${seoWorkOrderResult.enrichedWorkOrders.length} work order(s) SEO ampliada(s).`);

  console.log(`[11/${TOTAL_STEPS}] Content Work Order Builder...`);
  const contentWorkOrderResult = await runContentWorkOrderBuilder(departmentRunId);
  console.log(`  ${contentWorkOrderResult.enrichedWorkOrders.length} brief(s) de contenido generado(s).`);

  console.log(`[12/${TOTAL_STEPS}] CRO Work Order Builder...`);
  const croWorkOrderResult = await runCroWorkOrderBuilder(departmentRunId);
  console.log(`  ${croWorkOrderResult.enrichedWorkOrders.length} propuesta(s) CRO generada(s).`);

  console.log(`[13/${TOTAL_STEPS}] SEO Change Pack Builder...`);
  const seoChangePackResult = await runSeoChangePackBuilder(departmentRunId);
  console.log(`  ${seoChangePackResult.newChangePacks.length} change pack(s) SEO nuevo(s).`);

  console.log(`[14/${TOTAL_STEPS}] Content Change Pack Builder...`);
  const contentChangePackResult = await runContentChangePackBuilder(departmentRunId);
  console.log(`  ${contentChangePackResult.newChangePacks.length} change pack(s) de contenido nuevo(s).`);

  console.log(`[15/${TOTAL_STEPS}] CRO Change Pack Builder...`);
  const croChangePackResult = await runCroChangePackBuilder(departmentRunId);
  console.log(`  ${croChangePackResult.newChangePacks.length} change pack(s) CRO nuevo(s).`);

  console.log(`[16/${TOTAL_STEPS}] UX/UI Landing Architect (estructura visual ANTES de escribir HTML, Fase O13.6b)...`);
  const uxUiResult = await runUxUiLandingArchitect(departmentRunId);
  console.log(`  blueprints_nuevos=${uxUiResult.newBlueprints.length} total_blueprints=${uxUiResult.totalBlueprintCount}`);

  console.log(`[17/${TOTAL_STEPS}] WordPress Draft Agent (previews locales${process.env.WORDPRESS_DRAFTS_ENABLED === "true" ? " + borradores reales si hay aprobacion" : ""})...`);
  const wordpressDraftResult = await runWordpressDraftAgent(departmentRunId);
  console.log(
    `  wordpress_drafts_enabled=${wordpressDraftResult.wordpressDraftsEnabled} wordpress_backend=${wordpressDraftResult.wordpressBackend} wordpress_env=${wordpressDraftResult.wordpressEnv} destino=${wordpressDraftResult.wordpressTargetUrl ?? "(no configurado)"} previews_nuevos=${wordpressDraftResult.newLocalPreviews.length} borradores_wp_nuevos=${wordpressDraftResult.newWordpressDrafts.length} pendientes_aprobacion=${wordpressDraftResult.pendingApprovalCount}`
  );

  console.log(`[18/${TOTAL_STEPS}] Visual Template Builder (previews visuales, planificacion)...`);
  const visualTemplateResult = await runVisualTemplateBuilder(departmentRunId);
  console.log(
    `  previews_visuales_nuevos=${visualTemplateResult.newVisualPreviews.length} total=${visualTemplateResult.totalVisualPreviewCount}`
  );

  console.log(`[19/${TOTAL_STEPS}] Visual Asset Planner (propuesta de assets, n8n NO se ejecuta)...`);
  const visualAssetResult = await runVisualAssetPlanner(departmentRunId);
  console.log(
    `  asset_requests_nuevas=${visualAssetResult.newAssetRequests.length} total_propuestas=${visualAssetResult.totalAssetRequestCount} n8n_configurado=${visualAssetResult.n8nConfigured} (no llamado)`
  );

  console.log(`[20/${TOTAL_STEPS}] Staging Executor (ejecucion controlada${process.env.STAGING_EXECUTION_ENABLED === "true" ? ", real si hay aprobacion" : " — desactivado, solo cola de aprobacion"})...`);
  const stagingExecutorResult = await runStagingExecutor(departmentRunId);
  console.log(
    `  puede_escribir=${stagingExecutorResult.canAttemptRealWrites} en_cola_nuevas=${stagingExecutorResult.newPendingExecutions.length} aplicadas=${stagingExecutorResult.appliedThisPass.length} fallidas=${stagingExecutorResult.failedThisPass.length} pendientes_aprobacion=${stagingExecutorResult.pendingApprovalCount}`
  );

  console.log(`[21/${TOTAL_STEPS}] Staging QA Agent (solo lectura)...`);
  const stagingQaResult = await runStagingQaAgent(departmentRunId);
  console.log(
    `  staging_200=${stagingQaResult.siteHealth.status200} noindex=${stagingQaResult.siteHealth.noindexPresent} verificados=${stagingQaResult.checkedCount} pasan=${stagingQaResult.passCount} fallan=${stagingQaResult.failCount}`
  );

  console.log(`[22/${TOTAL_STEPS}] Approval Gateway (notificando lo que requiera aprobacion real)...`);
  const approvalGatewayResult = await runApprovalGateway(departmentRunId);
  console.log(
    `  telegram_activo=${approvalGatewayResult.telegramEnabled} nuevas_solicitudes=${approvalGatewayResult.newRequests.length} enviadas=${approvalGatewayResult.sentViaTelegram.length}`
  );

  console.log(`[23/${TOTAL_STEPS}] Production Deployment Planner (solo planificacion, produccion no se toca)...`);
  const productionPlannerResult = await runProductionDeploymentPlanner(departmentRunId);
  console.log(
    `  planes_nuevos=${productionPlannerResult.newPlans.length} total_planes=${productionPlannerResult.totalPlanCount} omitidos_sin_qa_pass=${productionPlannerResult.skippedNoQaPass} nuevas_solicitudes_aprobacion=${productionPlannerResult.newApprovalRequests} produccion_tocada=false`
  );

  console.log(`[24/${TOTAL_STEPS}] Production Draft Executor (ejecucion controlada de produccion, gateada)...`);
  const productionExecutorResult = await runProductionDraftExecutor(departmentRunId);
  console.log(
    `  can_attempt_real_writes=${productionExecutorResult.canAttemptRealWrites} pendientes_nuevas=${productionExecutorResult.newPendingExecutions.length} aplicadas=${productionExecutorResult.appliedThisPass.length} fallidas=${productionExecutorResult.failedThisPass.length} pendientes_aprobacion_ejecucion=${productionExecutorResult.pendingApprovalCount}`
  );

  console.log(`[25/${TOTAL_STEPS}] Growth Director (consolidando informe ejecutivo + tecnico)...`);
  const growthResult = await runGrowthDirector(departmentRunId);
  console.log(
    `  Informe ejecutivo: ${growthResult.executiveReportPath}${growthResult.executiveFallbackUsed ? " (fallback seguro, ver logs)" : ""}`
  );
  console.log(`  Informe tecnico: ${growthResult.technicalReportPath}`);

  console.log(`[26/${TOTAL_STEPS}] Enviando email final unico...`);
  const emailContent = buildEmailContent(
    departmentRunId,
    growthResult.executiveReportPath,
    growthResult.preparedForReviewCount,
    growthResult.pendingDecisionCount
  );
  await sendReportEmail(emailContent);

  logger.info("Pase diario del departamento Web & Growth: finalizado, email enviado", {
    departmentRunId,
    executiveReportPath: growthResult.executiveReportPath,
    technicalReportPath: growthResult.technicalReportPath,
  });

  console.log(`\nPase diario completo. departmentRunId=${departmentRunId}`);
  console.log(`Informe ejecutivo (email): ${growthResult.executiveReportPath}`);
  console.log(`Informe tecnico (interno): ${growthResult.technicalReportPath}`);
  console.log(`Informe Approval Queue: ${approvalQueueResult.reportPath}`);
  console.log(`Informe Approved Action Planner: ${approvedActionPlannerResult.reportPath}`);
  console.log(`Informe Approval Gateway: ${approvalGatewayResult.reportPath}`);
  console.log(`Change packs nuevos hoy: SEO=${seoChangePackResult.newChangePacks.length} Content=${contentChangePackResult.newChangePacks.length} CRO=${croChangePackResult.newChangePacks.length}`);
  console.log(`Informe UX/UI Landing Architect: ${uxUiResult.reportPath}`);
  console.log(`Informe WordPress Draft Agent: ${wordpressDraftResult.reportPath}`);
  console.log(`Informe Visual Template Builder: ${visualTemplateResult.reportPath}`);
  console.log(`Informe Visual Asset Planner: ${visualAssetResult.reportPath}`);
  console.log(`Informe Staging Executor: ${stagingExecutorResult.reportPath}`);
  console.log(`Informe Staging QA: ${stagingQaResult.reportPath}`);
  console.log(`Informe Production Deployment Planner: ${productionPlannerResult.reportPath} (planificacion — produccion no se toco)`);
  console.log(`Informe Production Draft Executor: ${productionExecutorResult.reportPath} (can_attempt_real_writes=${productionExecutorResult.canAttemptRealWrites})`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const explicitDryRun = argv.includes("--dry-run");
  const clientId = resolveClientId(argv);
  const clientConfig = loadClientConfig(clientId);

  console.log(`Cliente activo (Fase O16): ${clientConfig.clientId}${clientId !== clientConfig.clientId ? ` (fallback desde "${clientId}")` : ""}`);

  if (clientConfig.isSandbox || explicitDryRun) {
    runDryRunPass(clientConfig);
    process.exit(0);
  }

  if (clientConfig.clientId !== DEFAULT_CLIENT_ID) {
    console.error(
      `El pase real (sin --dry-run) solo esta soportado hoy para "${DEFAULT_CLIENT_ID}" — los 26 agentes todavia leen config/.env compartidos, no ClientConfig (Fase O16.1 pendiente). Usa --dry-run para "${clientConfig.clientId}".`
    );
    process.exit(1);
  }

  await runRealPass();
  process.exit(0);
}

main().catch((err) => {
  console.error("Pase diario del departamento Web & Growth fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
