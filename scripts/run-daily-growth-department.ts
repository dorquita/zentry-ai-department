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
import { runPipelineStep } from "../src/core/pipeline-step";
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

/**
 * Fase O49.7 -- el cuerpo del email ya NO es el informe ejecutivo completo
 * envuelto en un `<pre>` (ilegible, parecia un log). Ahora es el resumen
 * compacto de 8 bloques que growth-director.ts ya construyo (`emailHtml`/
 * `emailText`, ver src/core/executive-report.ts) -- el informe completo
 * sigue existiendo integro en `executiveReportPath` para quien quiera el
 * detalle, solo que ya no es lo que llega al correo.
 */
function buildEmailContent(
  departmentRunId: string,
  emailHtml: string,
  emailText: string,
  preparedForReviewCount: number,
  pendingDecisionCount: number
): EmailContent {
  const dateLabel =
    departmentRunId.match(/growth-department-(\d{4}-\d{2}-\d{2})T/)?.[1] ?? new Date().toISOString().slice(0, 10);
  const subject =
    pendingDecisionCount > 0
      ? `Web & Growth — Informe diario ${dateLabel}: ${preparedForReviewCount} propuesta(s) preparada(s), ${pendingDecisionCount} por aprobar`
      : `Web & Growth — Informe diario ${dateLabel}: ${preparedForReviewCount} propuesta(s) preparada(s), sin decisiones pendientes`;
  return { subject, text: emailText, html: emailHtml };
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

/**
 * Fase O49 — email de emergencia cuando Growth Director (paso 25) fallo
 * de verdad (no solo su fallback interno, que ya existia desde la Fase
 * O9 — esto es el caso mas raro: una excepcion que ni su propio fallback
 * pudo absorber). Nunca deja el dia sin ningun email. Cero IDs/rutas/
 * nombres de agente, igual que exige el resto del informe ejecutivo.
 */
function buildEmergencyEmailContent(dateLabel: string, failedStepCount: number): EmailContent {
  const subject = `Web & Growth — Informe diario ${dateLabel}: fallo al generar el informe, revision tecnica pendiente`;
  const text = [
    `El pase diario del departamento Web & Growth se ejecuto el ${dateLabel}, pero el paso final de generacion del informe fallo de forma inesperada.`,
    "",
    `${failedStepCount} paso(s) del pase de hoy tambien fallaron y quedaron aislados (no bloquearon al resto).`,
    "",
    "Esto es un fallo tecnico del propio sistema de informes, no una decision de negocio pendiente. Se necesita revision manual de los logs del servidor antes del proximo pase.",
  ].join("\n");
  return { subject, text, html: `<pre style="font-family: monospace; white-space: pre-wrap; font-size: 13px;">${escapeHtml(text)}</pre>` };
}

/**
 * Fase O52 — opciones para poder ejecutar este mismo pase DENTRO de la
 * pasada de GitHub Actions, no solo desde el timer del VPS.
 *
 * Sin ellas, este script solo sabia abrir su propio departmentRunId,
 * releer las tres fuentes Google por su cuenta y enviar su propio email
 * — tres cosas que en Actions ya hace la pasada coordinada, y que
 * duplicadas darian dos identificadores de pasada distintos, el doble de
 * llamadas a la API de Google y dos correos al dia.
 */
export interface RealPassOptions {
  /** Cuelga los 26 pasos de una pasada YA ABIERTA en vez de abrir otra. */
  departmentRunId?: string;
  /**
   * Salta los pasos 1/6/7 (SEO/SEM/Analytics Watcher). En Actions esos
   * tres ya han corrido en la FASE 0.5 con `--require-live`, que ademas
   * es MAS estricta que este pase: aqui un watcher sin credenciales cae
   * a su respaldo documentado, alli falla explicitamente.
   */
  skipWatchers?: boolean;
  /** No envia el email final: en Actions lo manda el Daily Brief coordinado. */
  noEmail?: boolean;
}

async function runRealPass(options: RealPassOptions = {}): Promise<void> {
  // Con --skip-watchers no se lee Search Console aqui, asi que
  // SEO_DATA_SOURCE no aplica a este proceso: exigirlo bloquearia el
  // pase en Actions por una variable que ya valido la FASE 0.5.
  if (!options.skipWatchers) {
    assertRealDataSource();
  }

  const departmentRunId = options.departmentRunId ?? buildDepartmentRunId();
  logger.info("Pase diario del departamento Web & Growth: inicio", {
    departmentRunId,
    skipWatchers: Boolean(options.skipWatchers),
    noEmail: Boolean(options.noEmail),
  });
  console.log(`departmentRunId: ${departmentRunId}`);
  if (options.skipWatchers) {
    console.log("Pasos 1/6/7 (SEO/SEM/Analytics Watcher) SALTADOS: ya los ejecuto la FASE 0.5 de esta misma pasada, con lectura live exigida.");
  }

  let failedStepCount = 0;
  const step = async <T>(stepNumber: number, agentName: string, label: string, fn: () => Promise<T>): Promise<T | null> => {
    const result = await runPipelineStep(departmentRunId, stepNumber, TOTAL_STEPS, agentName, label, fn);
    if (result === null) failedStepCount += 1;
    return result;
  };

  /** Igual que `step`, pero se omite entero si se pidio --skip-watchers. */
  const watcherStep = async <T>(stepNumber: number, agentName: string, label: string, fn: () => Promise<T>): Promise<T | null> => {
    if (options.skipWatchers) {
      console.log(`[${stepNumber}/${TOTAL_STEPS}] ${label}: SALTADO (ya ejecutado en la FASE 0.5 de esta pasada).`);
      return null;
    }
    return step(stepNumber, agentName, label, fn);
  };

  // Fase O49 — cada paso 1-24 esta aislado: si uno lanza, se registra
  // (step_failed en el bus + credential-health.jsonl para errores de
  // auth) y el pase CONTINUA con el siguiente paso. Antes de esta fase,
  // un solo fallo (ej. invalid_grant, ver 2026-08-10) tiraba las 26
  // etapas y no se enviaba ningun email ese dia.

  const seoWatcherResult = await watcherStep(1, "seo-watcher", "SEO Watcher", () => runSeoWatcher(departmentRunId));
  if (seoWatcherResult) console.log(`  ${seoWatcherResult.jobs.length} oportunidad(es), ${seoWatcherResult.rowsRead} fila(s) leidas.`);

  const seoDirectorResult = await step(2, "seo-director", "SEO Director", () => runSeoDirector(departmentRunId));
  if (seoDirectorResult) console.log(`  ${seoDirectorResult.items.length} accion(es) agrupada(s).`);

  const competitorResult = await step(3, "competitor-intelligence", "Competitor Intelligence", () => runCompetitorIntelligence(departmentRunId));
  if (competitorResult)
    console.log(
      `  ${competitorResult.pages.filter((p) => p.status === "ok").length}/${competitorResult.pages.length} paginas leidas, ${competitorResult.keywordGaps.length} gap(s) de keyword.`
    );

  const contentResult = await step(4, "content-planner", "Content Planner", () => runContentPlanner(departmentRunId));
  if (contentResult) console.log(`  ${contentResult.items.length} propuesta(s) de contenido.`);

  const croResult = await step(5, "cro-landing-reviewer", "CRO / Landing Reviewer", () => runCroLandingReviewer(departmentRunId));
  if (croResult) console.log(`  ${croResult.reviews.length} landing(s) revisada(s).`);

  const semResult = await watcherStep(6, "sem-watcher", "SEM Watcher", () => runSemWatcher(departmentRunId));
  if (semResult) console.log(`  conectado=${semResult.connected}, campana=${semResult.campaignState.status}.`);

  const analyticsResult = await watcherStep(7, "analytics-watcher", "Analytics Watcher", () => runAnalyticsWatcher(departmentRunId));
  if (analyticsResult) console.log(`  GA4 conectado=${analyticsResult.ga4Connected}, GTM conectado=${analyticsResult.gtmConnected}.`);

  const approvalQueueResult = await step(8, "approval-queue", "Approval Queue (deduplicando y aplicando la politica de autonomia)", () =>
    runApprovalQueue(departmentRunId)
  );
  if (approvalQueueResult)
    console.log(
      `  auto_procesadas=${approvalQueueResult.autoProcessedActions.length} auto_aprobadas_planificacion=${approvalQueueResult.autoApprovedForPlanningActions.length} pend_aprobacion=${approvalQueueResult.waitingApprovalActions.length} bloqueadas=${approvalQueueResult.blockedActionsThisRun.length}`
    );

  const approvedActionPlannerResult = await step(9, "approved-action-planner", "Approved Action Planner (creando work orders draft)", () =>
    runApprovedActionPlanner(departmentRunId)
  );
  if (approvedActionPlannerResult)
    console.log(
      `  planificables=${approvedActionPlannerResult.approvedActionCount} (humanas=${approvedActionPlannerResult.humanApprovedCount}, auto=${approvedActionPlannerResult.autoApprovedForPlanningCount}) nuevas_work_orders=${approvedActionPlannerResult.newWorkOrders.length}`
    );

  const seoWorkOrderResult = await step(10, "seo-work-order-builder", "SEO Work Order Builder", () => runSeoWorkOrderBuilder(departmentRunId));
  if (seoWorkOrderResult) console.log(`  ${seoWorkOrderResult.enrichedWorkOrders.length} work order(s) SEO ampliada(s).`);

  const contentWorkOrderResult = await step(11, "content-work-order-builder", "Content Work Order Builder", () =>
    runContentWorkOrderBuilder(departmentRunId)
  );
  if (contentWorkOrderResult) console.log(`  ${contentWorkOrderResult.enrichedWorkOrders.length} brief(s) de contenido generado(s).`);

  const croWorkOrderResult = await step(12, "cro-work-order-builder", "CRO Work Order Builder", () => runCroWorkOrderBuilder(departmentRunId));
  if (croWorkOrderResult) console.log(`  ${croWorkOrderResult.enrichedWorkOrders.length} propuesta(s) CRO generada(s).`);

  const seoChangePackResult = await step(13, "seo-change-pack-builder", "SEO Change Pack Builder", () => runSeoChangePackBuilder(departmentRunId));
  if (seoChangePackResult) console.log(`  ${seoChangePackResult.newChangePacks.length} change pack(s) SEO nuevo(s).`);

  const contentChangePackResult = await step(14, "content-change-pack-builder", "Content Change Pack Builder", () =>
    runContentChangePackBuilder(departmentRunId)
  );
  if (contentChangePackResult) console.log(`  ${contentChangePackResult.newChangePacks.length} change pack(s) de contenido nuevo(s).`);

  const croChangePackResult = await step(15, "cro-change-pack-builder", "CRO Change Pack Builder", () => runCroChangePackBuilder(departmentRunId));
  if (croChangePackResult) console.log(`  ${croChangePackResult.newChangePacks.length} change pack(s) CRO nuevo(s).`);

  const uxUiResult = await step(
    16,
    "ux-ui-landing-architect",
    "UX/UI Landing Architect (estructura visual ANTES de escribir HTML, Fase O13.6b)",
    () => runUxUiLandingArchitect(departmentRunId)
  );
  if (uxUiResult) console.log(`  blueprints_nuevos=${uxUiResult.newBlueprints.length} total_blueprints=${uxUiResult.totalBlueprintCount}`);

  const wordpressDraftResult = await step(
    17,
    "wordpress-draft-agent",
    `WordPress Draft Agent (previews locales${process.env.WORDPRESS_DRAFTS_ENABLED === "true" ? " + borradores reales si hay aprobacion" : ""})`,
    () => runWordpressDraftAgent(departmentRunId)
  );
  if (wordpressDraftResult)
    console.log(
      `  wordpress_drafts_enabled=${wordpressDraftResult.wordpressDraftsEnabled} wordpress_backend=${wordpressDraftResult.wordpressBackend} wordpress_env=${wordpressDraftResult.wordpressEnv} destino=${wordpressDraftResult.wordpressTargetUrl ?? "(no configurado)"} previews_nuevos=${wordpressDraftResult.newLocalPreviews.length} borradores_wp_nuevos=${wordpressDraftResult.newWordpressDrafts.length} pendientes_aprobacion=${wordpressDraftResult.pendingApprovalCount}`
    );

  const visualTemplateResult = await step(18, "visual-template-builder", "Visual Template Builder (previews visuales, planificacion)", () =>
    runVisualTemplateBuilder(departmentRunId)
  );
  if (visualTemplateResult)
    console.log(
      `  previews_visuales_nuevos=${visualTemplateResult.newVisualPreviews.length} total=${visualTemplateResult.totalVisualPreviewCount}`
    );

  const visualAssetResult = await step(19, "visual-asset-planner", "Visual Asset Planner (propuesta de assets, n8n NO se ejecuta)", () =>
    runVisualAssetPlanner(departmentRunId)
  );
  if (visualAssetResult)
    console.log(
      `  asset_requests_nuevas=${visualAssetResult.newAssetRequests.length} total_propuestas=${visualAssetResult.totalAssetRequestCount} n8n_configurado=${visualAssetResult.n8nConfigured} (no llamado)`
    );

  const stagingExecutorResult = await step(
    20,
    "staging-executor",
    `Staging Executor (ejecucion controlada${process.env.STAGING_EXECUTION_ENABLED === "true" ? ", real si hay aprobacion" : " — desactivado, solo cola de aprobacion"})`,
    () => runStagingExecutor(departmentRunId)
  );
  if (stagingExecutorResult)
    console.log(
      `  puede_escribir=${stagingExecutorResult.canAttemptRealWrites} en_cola_nuevas=${stagingExecutorResult.newPendingExecutions.length} aplicadas=${stagingExecutorResult.appliedThisPass.length} fallidas=${stagingExecutorResult.failedThisPass.length} pendientes_aprobacion=${stagingExecutorResult.pendingApprovalCount}`
    );

  const stagingQaResult = await step(21, "staging-qa-agent", "Staging QA Agent (solo lectura)", () => runStagingQaAgent(departmentRunId));
  if (stagingQaResult)
    console.log(
      `  staging_200=${stagingQaResult.siteHealth.status200} noindex=${stagingQaResult.siteHealth.noindexPresent} verificados=${stagingQaResult.checkedCount} pasan=${stagingQaResult.passCount} fallan=${stagingQaResult.failCount}`
    );

  const approvalGatewayResult = await step(
    22,
    "approval-gateway",
    "Approval Gateway (notificando lo que requiera aprobacion real)",
    () => runApprovalGateway(departmentRunId)
  );
  if (approvalGatewayResult)
    console.log(
      `  telegram_activo=${approvalGatewayResult.telegramEnabled} nuevas_solicitudes=${approvalGatewayResult.newRequests.length} enviadas=${approvalGatewayResult.sentViaTelegram.length}`
    );

  const productionPlannerResult = await step(
    23,
    "production-deployment-planner",
    "Production Deployment Planner (solo planificacion, produccion no se toca)",
    () => runProductionDeploymentPlanner(departmentRunId)
  );
  if (productionPlannerResult)
    console.log(
      `  planes_nuevos=${productionPlannerResult.newPlans.length} total_planes=${productionPlannerResult.totalPlanCount} omitidos_sin_qa_pass=${productionPlannerResult.skippedNoQaPass} nuevas_solicitudes_aprobacion=${productionPlannerResult.newApprovalRequests} produccion_tocada=false`
    );

  const productionExecutorResult = await step(
    24,
    "production-draft-executor",
    "Production Draft Executor (ejecucion controlada de produccion, gateada)",
    () => runProductionDraftExecutor(departmentRunId)
  );
  if (productionExecutorResult)
    console.log(
      `  can_attempt_real_writes=${productionExecutorResult.canAttemptRealWrites} pendientes_nuevas=${productionExecutorResult.newPendingExecutions.length} aplicadas=${productionExecutorResult.appliedThisPass.length} fallidas=${productionExecutorResult.failedThisPass.length} pendientes_aprobacion_ejecucion=${productionExecutorResult.pendingApprovalCount}`
    );

  // Fase O49 — pasos 25/26 SIEMPRE se intentan si se llego hasta aqui,
  // pase lo que pase con los pasos anteriores: el email tiene que salir
  // si o si. Growth Director ya tenia su propio fallback interno desde
  // la Fase O9 (buildFallbackExecutiveReportMarkdown); aqui anadimos una
  // ultima red de seguridad para el caso, mas raro, de que el propio
  // paso 25 lance una excepcion no capturada dentro.
  const dateLabelForEmergency = departmentRunId.match(/growth-department-(\d{4}-\d{2}-\d{2})T/)?.[1] ?? new Date().toISOString().slice(0, 10);
  const growthResult = await step(25, "growth-director", "Growth Director (consolidando informe ejecutivo + tecnico)", () =>
    runGrowthDirector(departmentRunId)
  );

  if (!growthResult) {
    if (options.noEmail) {
      console.log(`[26/${TOTAL_STEPS}] Growth Director fallo. Email OMITIDO (--no-email): lo reporta el Daily Brief coordinado.`);
    } else {
      console.log(`[26/${TOTAL_STEPS}] Growth Director fallo — enviando email de emergencia igualmente...`);
      await sendReportEmail(buildEmergencyEmailContent(dateLabelForEmergency, failedStepCount));
    }
    logger.error("Pase diario del departamento Web & Growth: Growth Director fallo, se envio email de emergencia", {
      departmentRunId,
      failedStepCount,
    });
    console.log(`\nPase diario finalizado con fallo en Growth Director. departmentRunId=${departmentRunId}. Pasos fallidos: ${failedStepCount}.`);
    return;
  }

  console.log(
    `  Informe ejecutivo: ${growthResult.executiveReportPath}${growthResult.executiveFallbackUsed ? " (fallback seguro, ver logs)" : ""}`
  );
  console.log(`  Informe tecnico: ${growthResult.technicalReportPath}`);

  if (options.noEmail) {
    console.log(`[26/${TOTAL_STEPS}] Email final OMITIDO (--no-email): en Actions lo envia el Daily Brief coordinado, y dos correos al dia por la misma pasada seria una regresion.`);
  } else {
    console.log(`[26/${TOTAL_STEPS}] Enviando email final unico...`);
    const emailContent = buildEmailContent(
      departmentRunId,
      growthResult.emailHtml,
      growthResult.emailText,
      growthResult.preparedForReviewCount,
      growthResult.pendingDecisionCount
    );
    await sendReportEmail(emailContent);
  }

  logger.info("Pase diario del departamento Web & Growth: finalizado, email enviado", {
    departmentRunId,
    executiveReportPath: growthResult.executiveReportPath,
    technicalReportPath: growthResult.technicalReportPath,
    failedStepCount,
  });

  console.log(`\nPase diario completo. departmentRunId=${departmentRunId}. Pasos fallidos y aislados: ${failedStepCount}.`);
  console.log(`Informe ejecutivo (email): ${growthResult.executiveReportPath}`);
  console.log(`Informe tecnico (interno): ${growthResult.technicalReportPath}`);
  if (approvalQueueResult) console.log(`Informe Approval Queue: ${approvalQueueResult.reportPath}`);
  if (approvedActionPlannerResult) console.log(`Informe Approved Action Planner: ${approvedActionPlannerResult.reportPath}`);
  if (approvalGatewayResult) console.log(`Informe Approval Gateway: ${approvalGatewayResult.reportPath}`);
  console.log(
    `Change packs nuevos hoy: SEO=${seoChangePackResult?.newChangePacks.length ?? "(paso fallido)"} Content=${contentChangePackResult?.newChangePacks.length ?? "(paso fallido)"} CRO=${croChangePackResult?.newChangePacks.length ?? "(paso fallido)"}`
  );
  if (uxUiResult) console.log(`Informe UX/UI Landing Architect: ${uxUiResult.reportPath}`);
  if (wordpressDraftResult) console.log(`Informe WordPress Draft Agent: ${wordpressDraftResult.reportPath}`);
  if (visualTemplateResult) console.log(`Informe Visual Template Builder: ${visualTemplateResult.reportPath}`);
  if (visualAssetResult) console.log(`Informe Visual Asset Planner: ${visualAssetResult.reportPath}`);
  if (stagingExecutorResult) console.log(`Informe Staging Executor: ${stagingExecutorResult.reportPath}`);
  if (stagingQaResult) console.log(`Informe Staging QA: ${stagingQaResult.reportPath}`);
  if (productionPlannerResult)
    console.log(`Informe Production Deployment Planner: ${productionPlannerResult.reportPath} (planificacion — produccion no se toco)`);
  if (productionExecutorResult)
    console.log(
      `Informe Production Draft Executor: ${productionExecutorResult.reportPath} (can_attempt_real_writes=${productionExecutorResult.canAttemptRealWrites})`
    );
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

  const departmentRunIdFlagIndex = argv.indexOf("--departmentRunId");
  const departmentRunIdFlag =
    departmentRunIdFlagIndex !== -1 && argv[departmentRunIdFlagIndex + 1] && !argv[departmentRunIdFlagIndex + 1].startsWith("--")
      ? argv[departmentRunIdFlagIndex + 1]
      : undefined;

  await runRealPass({
    departmentRunId: departmentRunIdFlag,
    skipWatchers: argv.includes("--skip-watchers"),
    noEmail: argv.includes("--no-email"),
  });
  process.exit(0);
}

main().catch((err) => {
  console.error("Pase diario del departamento Web & Growth fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
