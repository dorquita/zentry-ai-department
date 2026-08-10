import * as fs from "fs";
import * as path from "path";
import { classifyOpportunity, BRAND_INTENT_CATEGORY_LABELS } from "../core/brand-intent-router";
import { readAllJobs } from "../core/job-registry";
import { readCurrentActions } from "../core/action-backlog";
import { categorizeActionType, readCurrentWorkOrders } from "../core/work-orders";
import { readCurrentApprovalRequests } from "../core/approval-requests";
import { readCurrentChangePacks } from "../core/change-packs";
import { readCurrentWordpressDrafts } from "../core/wordpress-drafts";
import { readCurrentStagingExecutions } from "../core/staging-executions";
import { readCurrentAssetRequests } from "../core/asset-requests";
import { readCurrentStagingQaResults } from "../core/staging-qa-results";
import { readCurrentProductionDeploymentPlans } from "../core/production-deployment-plans";
import { readCurrentProductionExecutions } from "../core/production-executions";
import { deriveOpportunityState, buildOpportunityStateContext, buildOpportunityStateContextAsOf } from "../core/opportunity-state";
import { isVisuallyApproved, readCurrentVisualQaApprovals } from "../core/visual-qa";
import { findExistingPageAudit, readCurrentExistingPageAudits } from "../core/existing-page-audit";
import { getTelegramStatusForReport } from "../core/telegram-gateway";
import { getWordpressStatusForReport } from "../adapters/wordpress";
import {
  buildExecutiveReportData,
  buildFallbackExecutiveReportMarkdown,
  ExecutiveReportInput,
  ExecutiveReportExtrasV2,
  PendingDecisionV2,
  RealChangeToday,
  TaskAdvancedToday,
  VisualReviewPendingItem,
  renderExecutiveReportMarkdownV2,
  validateExecutiveReportCoherence,
} from "../core/executive-report";
import { emitEvent, readAllEvents, readEventsForRun } from "../core/department-events";
import { logger } from "../core/logger";
import { ActionStatus, ApprovalRequest, BacklogAction, ChangePack, DepartmentEvent, Priority, WordpressDraft, WorkOrder } from "../core/types";
import { ActionItem, buildActionPlan } from "./seo-director";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Growth Director Agent — READ + PROPOSE only. Consolida lo que hicieron
 * todos los demas agentes del departamento en la misma pasada
 * (departmentRunId) en DOS informes diarios distintos:
 *
 * - `reports/daily/executive-<fecha>.md` — el informe PRINCIPAL, pensado
 *   para el responsable del departamento (no tecnico): resumen en
 *   lenguaje natural, deduplicado y priorizado, sin IDs, sin rutas de
 *   servidor, sin comandos, sin nombres de agentes. Es el cuerpo del
 *   email diario. Ver src/core/executive-report.ts.
 * - `reports/daily/technical-<fecha>.md` — el informe TECNICO completo
 *   (el que existia antes de este rediseno): IDs, estados, work orders,
 *   change packs, agentes, warnings, rutas. Para auditoria/debugging/
 *   trazabilidad, nunca se envia como cuerpo del email.
 *
 * No ejecuta nada por si mismo. Si la generacion del informe ejecutivo
 * falla por cualquier motivo, usa un fallback minimo y seguro (ver
 * buildFallbackExecutiveReportMarkdown) en vez de arriesgarse a mandar
 * datos internos sin filtrar — el motivo real del fallo queda solo en el
 * log tecnico (logger.error), nunca en el informe que ve el responsable.
 */

const DAILY_REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "daily");
const AGENT_NAME = "growth-director";

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

// Estados de accion que siguen "vivos" (todavia relevantes para el
// informe ejecutivo de hoy). Excluye deliberadamente rejected/snoozed/
// done/blocked/auto_processed: esos ya estan resueltos o son mecanica
// interna sin contenido que mostrarle al responsable.
const LIVE_ACTION_STATUSES: ActionStatus[] = ["new", "open", "auto_approved_for_planning", "waiting_approval", "approved"];

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error(
      "No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento (p.ej. npm run seo:watch)."
    );
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function findAgentFinishedPayload(
  events: DepartmentEvent[],
  agent: string
): Record<string, unknown> | undefined {
  const matches = events.filter((e) => e.agent === agent && e.type === "agent_finished");
  return matches.length > 0 ? matches[matches.length - 1].payload : undefined;
}

function summarizeAgentActivity(events: DepartmentEvent[]): Array<{ agent: string; summary: string }> {
  const agents = [...new Set(events.map((e) => e.agent))];
  return agents.map((agent) => {
    const agentEvents = events.filter((e) => e.agent === agent);
    const started = agentEvents.some((e) => e.type === "agent_started");
    const finished = agentEvents.find((e) => e.type === "agent_finished");
    const warnings = agentEvents.filter((e) => e.type === "warning_detected").length;
    const status = finished ? "completado" : started ? "iniciado (sin finalizar)" : "sin agent_started/finished";
    const detail = finished ? finished.summary : agentEvents[agentEvents.length - 1]?.summary ?? "";
    const warningNote = warnings > 0 ? ` (${warnings} warning(s))` : "";
    return { agent, summary: `${status}${warningNote} — ${detail}` };
  });
}

function bucketByBrand(items: ActionItem[]): { zentry: ActionItem[]; tukandado: ActionItem[]; mixed: ActionItem[] } {
  const zentry: ActionItem[] = [];
  const tukandado: ActionItem[] = [];
  const mixed: ActionItem[] = [];
  for (const item of items) {
    const intent = classifyOpportunity({ keyword: item.keyword, page: item.page });
    if (intent.brand === "zentry") zentry.push(item);
    else if (intent.brand === "tukandado") tukandado.push(item);
    else mixed.push(item);
  }
  return { zentry, tukandado, mixed };
}

export interface GrowthDirectorRunResult {
  departmentRunId: string;
  executiveReportPath: string;
  technicalReportPath: string;
  executiveFallbackUsed: boolean;
  preparedForReviewCount: number;
  pendingDecisionCount: number;
  topActions: ActionItem[];
  zentryOpportunities: ActionItem[];
  tukandadoOpportunities: ActionItem[];
  mixedOpportunities: ActionItem[];
  competitorGapCount: number;
  contentProposalCount: number;
  croReviewCount: number;
  semConnected: boolean;
  analyticsGa4Connected: boolean;
  analyticsGtmConnected: boolean;
  warnings: string[];
  reportPaths: Record<string, string>;
  // Backlog (Fase O5): estado operativo de las acciones, no solo lo
  // detectado en esta pasada. Requiere que Approval Queue ya haya corrido
  // para este departmentRunId (ver scripts/run-daily-growth-department.ts).
  newActionsToday: BacklogAction[];
  recurringOpenActions: BacklogAction[];
  waitingApprovalActions: BacklogAction[];
  approvedNotDoneActions: BacklogAction[];
  discardedActions: BacklogAction[];
  // Autonomia (Fase O7): acciones que la politica proceso/aprobo sin
  // intervencion humana en ESTA pasada, y acciones bloqueadas (todas las
  // que hay, no solo de hoy — igual que approvedNotDoneActions).
  autoProcessedActionsToday: BacklogAction[];
  autoApprovedForPlanningActionsToday: BacklogAction[];
  blockedActions: BacklogAction[];
  // Work orders (Fase O6): requiere que Approved Action Planner + los 3
  // Work Order Builders ya hayan corrido para este departmentRunId.
  approvedActionCount: number;
  newWorkOrdersToday: WorkOrder[];
  readyForReviewWorkOrders: WorkOrder[];
  autoPreparedWorkOrderCount: number;
  humanReviewWorkOrderCount: number;
  workOrdersByBrand: { zentry: number; tukandado: number; mixed: number };
  workOrdersByCategory: Record<string, number>;
  // Approval Gateway / Telegram (Fase O8): requiere que Approval Gateway
  // ya haya corrido para este departmentRunId.
  pendingApprovalRequests: ApprovalRequest[];
  sentViaTelegramRequests: ApprovalRequest[];
  approvedApprovalRequests: ApprovalRequest[];
  rejectedApprovalRequests: ApprovalRequest[];
  snoozedApprovalRequests: ApprovalRequest[];
  telegramEnabled: boolean;
  telegramConfigured: boolean;
  // Change Packs: requiere que los 3 Change Pack Builders ya hayan
  // corrido para este departmentRunId.
  totalChangePackCount: number;
  newChangePacksToday: ChangePack[];
  readyForReviewChangePacks: ChangePack[];
  changePacksByType: Record<string, number>;
  // WordPress Draft Agent: requiere que ya haya corrido para este
  // departmentRunId.
  totalLocalPreviewCount: number;
  totalWordpressDraftCount: number;
  newLocalPreviewsToday: WordpressDraft[];
  pendingWordpressApprovalCount: number;
  wordpressDraftsEnabled: boolean;
  wordpressConfigured: boolean;
  // Staging Executor / Staging QA (Fase O12): requiere que ambos ya hayan
  // corrido para este departmentRunId.
  stagingExecutionEnabled: boolean;
  totalStagingAppliedCount: number;
  stagingPendingApprovalCount: number;
  stagingFailedCount: number;
  stagingQaCheckedCount: number;
  stagingQaPassCount: number;
  stagingQaFailCount: number;
  // Visual Template Builder / Visual Asset Planner (Fase O12.4): pura
  // planificacion -- ninguno de los dos toca WordPress ni n8n.
  totalVisualPreviewCount: number;
  totalAssetRequestCount: number;
  n8nAssetWebhookConfigured: boolean;
}

function buildTechnicalReportMarkdown(
  result: GrowthDirectorRunResult,
  agentActivity: Array<{ agent: string; summary: string }>,
  generatedAt: string
): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# [TECNICO] Informe diario — Web & Growth Department — ${executionDate}`);
  lines.push("");
  lines.push(
    "> Este es el informe tecnico interno (IDs, estados, work orders, change packs, agentes, trazabilidad). El informe para el responsable del departamento es el ejecutivo del mismo dia (`reports/daily/executive-<fecha>.md`), que es el que se envia por email."
  );
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");

  const totalActions =
    result.zentryOpportunities.length + result.tukandadoOpportunities.length + result.mixedOpportunities.length;

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `El departamento Web & Growth analizo datos reales de Search Console, priorizó acciones, reviso a la competencia, propuso contenido y mejoras de conversion, y reviso el estado de SEM/Analytics. Se detectaron **${totalActions}** acciones SEO priorizadas (**${result.zentryOpportunities.length}** Zentry, **${result.tukandadoOpportunities.length}** Tukandado, **${result.mixedOpportunities.length}** mixtas), **${result.competitorGapCount}** oportunidad(es) de competencia, **${result.contentProposalCount}** propuesta(s) de contenido y **${result.croReviewCount}** landing(s) revisada(s) para CRO. El departamento sigue trabajando solo en analisis, planificacion y work orders (nivel AUTO_PLAN, Fase O7) sin pedir nada a Pau; desde la Fase O8, solo interrumpe por Telegram cuando algo se acerca a produccion real. Ningun cambio real se ha ejecutado — eso sigue exigiendo aprobacion humana explicita, sin excepcion.`
  );
  lines.push("");

  lines.push("## Que ha hecho cada agente");
  lines.push("");
  for (const a of agentActivity) {
    lines.push(`- **${a.agent}**: ${a.summary}`);
  }
  lines.push("");

  const backlogList = (title: string, actions: BacklogAction[], note?: string): void => {
    lines.push(`## ${title} (${actions.length})`);
    lines.push("");
    if (note) {
      lines.push(note);
      lines.push("");
    }
    if (actions.length === 0) {
      lines.push("Ninguna.");
    } else {
      for (const a of actions) {
        lines.push(`- [${a.priority}] \`${a.actionId}\` ${a.title} (visto ${a.seenCount} vez/veces)`);
      }
    }
    lines.push("");
  };

  lines.push("## Autonomia (Fase O7) — que decidio el sistema solo hoy");
  lines.push("");
  lines.push(
    `Auto-procesadas: **${result.autoProcessedActionsToday.length}** · Auto-aprobadas para planificacion: **${result.autoApprovedForPlanningActionsToday.length}** · Pendientes de aprobacion humana: **${result.waitingApprovalActions.length}** · Bloqueadas: **${result.blockedActions.length}**. Ver \`docs/autonomy-policy.md\` para el detalle completo de la politica y como cambiarla.`
  );
  lines.push("");

  backlogList(
    "Acciones auto-procesadas hoy (AUTO_INTERNAL)",
    result.autoProcessedActionsToday,
    "Mecanica interna del propio sistema (dedup, priorizacion, informes) — no son recomendaciones sobre las que decidir."
  );
  backlogList(
    "Acciones auto-aprobadas para planificacion hoy (AUTO_PLAN)",
    result.autoApprovedForPlanningActionsToday,
    "SEO/contenido/CRO/SEM/Analytics/competencia de riesgo bajo o medio: el sistema ya las convirtio (o las convertira en el siguiente paso) en una work order, sin esperar aprobacion. Nunca implica ejecucion real."
  );
  backlogList(
    "Pendientes de aprobacion humana",
    result.waitingApprovalActions,
    "Acciones que tocarian produccion real (WordPress, Ads, GA4, GTM...) si se ejecutaran. Hoy ningun agente genera este tipo, pero la politica ya esta lista para cuando exista."
  );
  backlogList(
    "Acciones bloqueadas",
    result.blockedActions,
    "Nivel FORBIDDEN de la politica de autonomia: nunca se auto-ejecutan ni se auto-preparan, necesitan una decision explicita fuera de este sistema."
  );

  backlogList(
    "Acciones nuevas detectadas hoy",
    result.newActionsToday,
    "Primera vez que se detectan Y sin clasificacion de autonomia todavia (caso raro — casi siempre caeran en alguna de las categorias de arriba)."
  );
  backlogList(
    "Acciones repetidas / recurrentes sin clasificar",
    result.recurringOpenActions,
    "Ya se habian detectado en pasadas anteriores y siguen en 'open' sin que la politica las haya reclasificado todavia (caso raro tras la Fase O7)."
  );
  backlogList(
    "Aprobadas por un humano pero todavia no ejecutadas",
    result.approvedNotDoneActions,
    "Un humano acepto trabajarlas explicitamente (`status: approved`) — sigue sin haberse tocado produccion."
  );
  backlogList("Descartadas (rechazadas o snoozed)", result.discardedActions);

  lines.push(`## Work orders listas para revisar`);
  lines.push("");
  lines.push(
    `Acciones planificables (\`approved\` + \`auto_approved_for_planning\`): **${result.approvedActionCount}**. Work orders nuevas hoy: **${result.newWorkOrdersToday.length}**. Listas para revisar en total: **${result.readyForReviewWorkOrders.length}** (de las cuales **${result.autoPreparedWorkOrderCount}** \`auto_prepared\` y **${result.humanReviewWorkOrderCount}** \`ready_for_review\`).`
  );
  lines.push("");
  lines.push(
    `**Por marca:** Zentry ${result.workOrdersByBrand.zentry} · Tukandado ${result.workOrdersByBrand.tukandado} · Mixta ${result.workOrdersByBrand.mixed}.`
  );
  lines.push("");
  lines.push("**Por que requieren:**");
  lines.push("");
  lines.push("| Requiere | Cantidad |");
  lines.push("|---|---|");
  for (const [category, count] of Object.entries(result.workOrdersByCategory)) {
    lines.push(`| ${category} | ${count} |`);
  }
  lines.push("");
  lines.push("**Top work orders listas para revisar:**");
  lines.push("");
  if (result.readyForReviewWorkOrders.length === 0) {
    lines.push("Ninguna todavia.");
  } else {
    for (const wo of result.readyForReviewWorkOrders.slice(0, 5)) {
      lines.push(
        `- [${wo.priority}] \`${wo.workOrderId}\` ${wo.sourceActionTitle} (${categorizeActionType(wo.actionType)}, marca: ${wo.targetBrand}, status: ${wo.status})`
      );
    }
  }
  lines.push("");

  lines.push("## Change Packs — paquetes de cambio concretos");
  lines.push("");
  lines.push(
    `Total: **${result.totalChangePackCount}** · nuevos hoy: **${result.newChangePacksToday.length}** · listos para revisar (\`ready_for_review\`): **${result.readyForReviewChangePacks.length}**. Ninguno ejecuta nada — ni siquiera en \`approved_to_execute\`. Ver \`docs/change-packs.md\`.`
  );
  lines.push("");
  lines.push("**Por tipo de cambio:**");
  lines.push("");
  lines.push("| Tipo | Cantidad |");
  lines.push("|---|---|");
  for (const [changeType, count] of Object.entries(result.changePacksByType)) {
    lines.push(`| ${changeType} | ${count} |`);
  }
  lines.push("");
  lines.push("**Top 5 change packs listos para revisar:**");
  lines.push("");
  if (result.readyForReviewChangePacks.length === 0) {
    lines.push("Ninguno todavia.");
  } else {
    for (const cp of result.readyForReviewChangePacks.slice(0, 5)) {
      lines.push(
        `- [${cp.priority}] \`${cp.changePackId}\` ${cp.keyword} (${cp.changeType}, marca: ${cp.targetBrand}, status: ${cp.status})`
      );
    }
  }
  lines.push("");

  lines.push("## WordPress Draft Agent — previews y borradores");
  lines.push("");
  lines.push(
    `WORDPRESS_DRAFTS_ENABLED: **${result.wordpressDraftsEnabled ? "true" : "false"}**. WordPress configurado: **${result.wordpressConfigured ? "si" : "no"}**.`
  );
  lines.push("");
  lines.push(
    `Previews locales totales: **${result.totalLocalPreviewCount}** (nuevos hoy: **${result.newLocalPreviewsToday.length}**). Borradores reales creados en WordPress (siempre \`draft\`, nunca publicados): **${result.totalWordpressDraftCount}**. Pendientes de aprobacion por Telegram para crear un borrador real: **${result.pendingWordpressApprovalCount}**. Ver \`docs/wordpress-draft-agent.md\`.`
  );
  lines.push("");

  lines.push("## Staging Executor / Staging QA (Fase O12)");
  lines.push("");
  lines.push(
    `STAGING_EXECUTION_ENABLED: **${result.stagingExecutionEnabled ? "true" : "false"}**. Ejecuciones aplicadas de verdad en staging (total acumulado, siempre \`draft\`, nunca publicadas, nunca produccion): **${result.totalStagingAppliedCount}**. Fallidas: **${result.stagingFailedCount}**. Pendientes de aprobacion por Telegram: **${result.stagingPendingApprovalCount}**.`
  );
  lines.push(
    `Staging QA (solo lectura): **${result.stagingQaCheckedCount}** borrador(es) verificado(s), **${result.stagingQaPassCount}** pasan, **${result.stagingQaFailCount}** fallan. Ver \`docs/staging-execution.md\` y \`docs/staging-rollback.md\`.`
  );
  lines.push("");

  lines.push("## Visual Template System / Asset Planning (Fase O12.4)");
  lines.push("");
  lines.push(
    `Previews visuales generados (total acumulado, sobre las 5 plantillas de \`src/core/visual-templates.ts\`): **${result.totalVisualPreviewCount}**. Peticiones de imagen propuestas (total acumulado, status \`proposed\`): **${result.totalAssetRequestCount}**. N8N_ASSET_GENERATION_WEBHOOK_URL configurada: **${result.n8nAssetWebhookConfigured ? "si" : "no"}** — en cualquier caso, **n8n NO se ha ejecutado, ninguna imagen se ha generado ni subido a WordPress**. Ver \`docs/visual-template-system.md\`, \`docs/asset-generation-workflow.md\` y \`docs/n8n-asset-webhook-contract.md\`.`
  );
  lines.push("");

  lines.push("## Aprobaciones (Fase O8) — Notification & Approval Gateway");
  lines.push("");
  lines.push(
    `Telegram activo: **${result.telegramEnabled ? "si" : "no"}**. Telegram configurado: **${result.telegramConfigured ? "si" : "no"}**.`
  );
  lines.push("");
  lines.push(
    `Solicitudes pendientes: **${result.pendingApprovalRequests.length}** · enviadas por Telegram (total): **${result.sentViaTelegramRequests.length}** · aprobadas: **${result.approvedApprovalRequests.length}** · rechazadas: **${result.rejectedApprovalRequests.length}** · pospuestas: **${result.snoozedApprovalRequests.length}**.`
  );
  lines.push("");
  if (result.pendingApprovalRequests.length > 0) {
    for (const r of result.pendingApprovalRequests.slice(0, 10)) {
      lines.push(`- [${r.riskLevel}] \`${r.approvalRequestId}\` ${r.title} — canal: ${r.channel}${r.sentAt ? ", enviada" : ", sin enviar"}`);
    }
    lines.push("");
  }

  const allBucketed = [...result.zentryOpportunities, ...result.tukandadoOpportunities, ...result.mixedOpportunities];
  const top5 = [...allBucketed]
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    .slice(0, 5);

  lines.push(`## Top ${top5.length} acciones recomendadas`);
  lines.push("");
  if (top5.length === 0) {
    lines.push("No hay acciones que recomendar en este momento.");
  } else {
    top5.forEach((item, i) => {
      const intent = classifyOpportunity({ keyword: item.keyword, page: item.page });
      lines.push(`### ${i + 1}. [${item.priority}] "${item.keyword}"`);
      lines.push("");
      lines.push(`- **Pagina:** ${item.page}`);
      lines.push(`- **Marca:** ${BRAND_INTENT_CATEGORY_LABELS[intent.category]}`);
      lines.push(`- **Accion:** ${item.action}`);
      lines.push(`- **Esfuerzo:** ${item.effort} · **Impacto:** ${item.impact}`);
      lines.push(`- **Requiere WordPress:** ${item.requiresWordPress ? "si" : "no"} · **Requiere contenido nuevo:** ${item.requiresNewContent ? "si" : "no"}`);
      lines.push("");
    });
  }

  const brandSection = (title: string, items: ActionItem[]): void => {
    lines.push(`## ${title} (${items.length})`);
    lines.push("");
    if (items.length === 0) {
      lines.push("Sin oportunidades en esta categoria.");
    } else {
      for (const item of items) {
        lines.push(`- [${item.priority}] "${item.keyword}" (${item.page}) — ${item.action}`);
      }
    }
    lines.push("");
  };

  brandSection("Oportunidades Zentry", result.zentryOpportunities);
  brandSection("Oportunidades Tukandado", result.tukandadoOpportunities);
  brandSection("Oportunidades mixtas / cross-sell", result.mixedOpportunities);

  lines.push("## Estado SEM");
  lines.push("");
  lines.push(
    result.semConnected
      ? "Conectado a Google Ads."
      : "Sin credenciales de Google Ads en este proyecto: SEM Watcher opero en modo documentacion/config local. Campana conocida: PAUSED a proposito (no activar sin confirmacion explicita del cliente)."
  );
  lines.push(`Ver informe completo en \`${result.reportPaths["sem-watcher"] ?? "(no generado en esta pasada)"}\`.`);
  lines.push("");

  lines.push("## Estado Analytics");
  lines.push("");
  lines.push(
    result.analyticsGa4Connected || result.analyticsGtmConnected
      ? `GA4 conectado: ${result.analyticsGa4Connected ? "si" : "no"}. GTM conectado: ${result.analyticsGtmConnected ? "si" : "no"}.`
      : "Sin credenciales de GA4 ni GTM en este proyecto: Analytics Watcher solo documento los eventos clave esperados y propuso validaciones manuales."
  );
  lines.push(`Ver informe completo en \`${result.reportPaths["analytics-watcher"] ?? "(no generado en esta pasada)"}\`.`);
  lines.push("");

  if (result.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Como gestionar el backlog");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run actions:list -- --status waiting_approval");
  lines.push("npm run actions:update -- --actionId <id> --status approved");
  lines.push("npm run work-orders:list -- --status ready_for_review");
  lines.push("npm run change-packs:list -- --status ready_for_review");
  lines.push("npm run change-packs:update -- --changePackId <id> --status approved_to_execute");
  lines.push("npm run wordpress-drafts:list");
  lines.push("npm run approvals:list -- --status pending");
  lines.push("npm run approvals:update -- --approvalRequestId <id> --answer approved");
  lines.push("```");
  lines.push("");

  lines.push("## Rutas de informes completos");
  lines.push("");
  for (const [agent, reportPath] of Object.entries(result.reportPaths)) {
    lines.push(`- **${agent}:** \`${reportPath}\``);
  }
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- No se ha ejecutado ningun cambio real; todo el departamento opera en modo lectura + propuesta.");
  lines.push("- Los change packs tampoco ejecutan nada, ni siquiera en `approved_to_execute`.");
  lines.push("- Ningun borrador de WordPress se ha publicado. Ninguna pagina publicada existente se ha modificado (salvo un borrador que el propio Staging Executor haya creado antes).");
  lines.push("- Cualquier ejecucion real del Staging Executor solo pudo tocar STAGING, nunca produccion (bloqueo incondicional por WORDPRESS_ENV).");
  lines.push("- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.");
  lines.push("");

  return lines.join("\n");
}

function writeTechnicalReport(markdown: string, executionDate: string): string {
  fs.mkdirSync(DAILY_REPORTS_DIR, { recursive: true });
  const filePath = path.join(DAILY_REPORTS_DIR, `technical-${executionDate}.md`);
  fs.writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}

function writeExecutiveReport(markdown: string, executionDate: string): string {
  fs.mkdirSync(DAILY_REPORTS_DIR, { recursive: true });
  const filePath = path.join(DAILY_REPORTS_DIR, `executive-${executionDate}.md`);
  fs.writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}

export async function runGrowthDirector(departmentRunId?: string): Promise<GrowthDirectorRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Growth Director Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Growth Director Agent iniciado" });

  const events = readEventsForRun(deptRunId);
  const agentActivity = summarizeAgentActivity(events);
  const warnings = events.filter((e) => e.type === "warning_detected").map((e) => `[${e.agent}] ${e.summary}`);

  const jobs = readAllJobs();
  const latestRunId = jobs.reduce<string | undefined>(
    (max, j) => (!max || j.meta.runId > max ? j.meta.runId : max),
    undefined
  );
  const latestRunJobs = latestRunId ? jobs.filter((j) => j.meta.runId === latestRunId) : [];
  const actionItems = buildActionPlan(latestRunJobs);
  const { zentry, tukandado, mixed } = bucketByBrand(actionItems);

  const competitorGapCount = events.filter(
    (e) => e.agent === "competitor-intelligence" && e.type === "competitor_keyword_detected"
  ).length;
  const contentProposalCount = events.filter(
    (e) => e.agent === "content-planner" && e.type === "recommendation_created"
  ).length;
  const croReviewCount = events.filter(
    (e) => e.agent === "cro-landing-reviewer" && e.type === "recommendation_created"
  ).length;

  const semPayload = findAgentFinishedPayload(events, "sem-watcher");
  const analyticsPayload = findAgentFinishedPayload(events, "analytics-watcher");

  const allActions = readCurrentActions();
  const actionsSeenThisRun = allActions.filter((a) => a.runIds.includes(deptRunId));
  const newActionsToday = actionsSeenThisRun.filter((a) => a.status === "new");
  const recurringOpenActions = actionsSeenThisRun.filter((a) => a.status === "open");
  const autoProcessedActionsToday = actionsSeenThisRun.filter((a) => a.status === "auto_processed");
  const autoApprovedForPlanningActionsToday = actionsSeenThisRun.filter(
    (a) => a.status === "auto_approved_for_planning"
  );
  const waitingApprovalActions = allActions.filter((a) => a.status === "waiting_approval");
  const approvedNotDoneActions = allActions.filter((a) => a.status === "approved");
  const discardedActions = allActions.filter((a) => a.status === "rejected" || a.status === "snoozed");
  const blockedActions = allActions.filter((a) => a.status === "blocked");

  const approvedActionCount = allActions.filter(
    (a) => a.status === "approved" || a.status === "auto_approved_for_planning"
  ).length;
  const allWorkOrders = readCurrentWorkOrders();
  const executionDateForRunId = deptRunId.match(/growth-department-(\d{4}-\d{2}-\d{2})T/)?.[1] ?? deptRunId.slice(0, 10);
  const newWorkOrdersToday = allWorkOrders.filter((w) => w.createdAt.slice(0, 10) === executionDateForRunId);
  const readyForReviewWorkOrders = [
    ...allWorkOrders.filter((w) => w.status === "ready_for_review" || w.status === "auto_prepared"),
  ].sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  const autoPreparedWorkOrderCount = allWorkOrders.filter((w) => w.status === "auto_prepared").length;
  const humanReviewWorkOrderCount = allWorkOrders.filter((w) => w.status === "ready_for_review").length;
  const workOrdersByBrand = { zentry: 0, tukandado: 0, mixed: 0 };
  for (const wo of allWorkOrders) {
    if (wo.targetBrand === "zentry") workOrdersByBrand.zentry++;
    else if (wo.targetBrand === "tukandado") workOrdersByBrand.tukandado++;
    else workOrdersByBrand.mixed++;
  }
  const workOrdersByCategory: Record<string, number> = {};
  for (const wo of allWorkOrders) {
    const category = categorizeActionType(wo.actionType);
    workOrdersByCategory[category] = (workOrdersByCategory[category] ?? 0) + 1;
  }

  const allApprovalRequests = readCurrentApprovalRequests();
  const pendingApprovalRequestsRaw = allApprovalRequests.filter((r) => r.status === "pending");
  // Fase O27.3 (postmortem visual de Pau): filtrado en el ORIGEN, no solo
  // en la construccion de pendingDecisionsV2 -- si se filtrara solo alli,
  // el resumen inicial de V1 (data.summaryParagraph, que cuenta
  // decisiones por su propio camino independiente) se quedaria
  // desincronizado con la seccion 3 y el informe se volveria
  // incoherente (ej. "hay 3 decisiones" arriba pero "ninguna decision
  // pendiente" en la seccion 3, visto en la primera pasada de prueba de
  // este fix). Se filtra aqui, ANTES de que nada lo use, para que V1 y
  // V2 vean siempre los mismos datos.
  const planByIdForVisualGate = new Map(readCurrentProductionDeploymentPlans().map((p) => [p.deploymentPlanId, p]));
  const visualApprovalsForGate = readCurrentVisualQaApprovals();
  const pendingApprovalRequests = pendingApprovalRequestsRaw.filter((r) => {
    if (r.relatedType !== "production_deployment_plan") return true;
    const plan = planByIdForVisualGate.get(r.relatedId);
    if (!plan) return true;
    return isVisuallyApproved(plan.sourceDraftId, visualApprovalsForGate);
  });
  const sentViaTelegramRequests = allApprovalRequests.filter((r) => Boolean(r.sentAt) && r.channel === "telegram");
  const approvedApprovalRequests = allApprovalRequests.filter((r) => r.status === "approved");
  const rejectedApprovalRequests = allApprovalRequests.filter((r) => r.status === "rejected");
  const snoozedApprovalRequests = allApprovalRequests.filter((r) => r.status === "snoozed");
  const { enabled: telegramEnabled, configured: telegramConfigured } = getTelegramStatusForReport();

  const allChangePacks = readCurrentChangePacks();
  const newChangePacksToday = allChangePacks.filter((cp) => cp.createdAt.slice(0, 10) === executionDateForRunId);
  const readyForReviewChangePacks = [...allChangePacks.filter((cp) => cp.status === "ready_for_review")].sort(
    (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
  );
  const changePacksByType: Record<string, number> = {};
  for (const cp of allChangePacks) {
    changePacksByType[cp.changeType] = (changePacksByType[cp.changeType] ?? 0) + 1;
  }

  const allWordpressDrafts = readCurrentWordpressDrafts();
  const totalLocalPreviewCount = allWordpressDrafts.filter((d) => d.status === "local_preview").length;
  const totalWordpressDraftCount = allWordpressDrafts.filter((d) => d.status === "wp_draft_created").length;
  const newLocalPreviewsToday = allWordpressDrafts.filter((d) => d.createdAt.slice(0, 10) === executionDateForRunId);
  const pendingWordpressApprovalCount = allApprovalRequests.filter(
    (r) => r.relatedType === "change_pack" && r.status === "pending"
  ).length;
  const { enabled: wordpressDraftsEnabled, configured: wordpressConfigured } = getWordpressStatusForReport();

  // Staging Executor / Staging QA (Fase O12).
  const allStagingExecutions = readCurrentStagingExecutions();
  const totalStagingAppliedCount = allStagingExecutions.filter((e) => e.status === "applied_to_staging").length;
  const stagingPendingApprovalCount = allStagingExecutions.filter((e) => e.status === "pending_approval").length;
  const stagingFailedCount = allStagingExecutions.filter((e) => e.status === "failed").length;
  const stagingExecutionEnabled = (process.env.STAGING_EXECUTION_ENABLED ?? "").trim().toLowerCase() === "true";
  const stagingQaPayload = findAgentFinishedPayload(events, "staging-qa-agent");
  const stagingQaCheckedCount = Number(stagingQaPayload?.checkedCount ?? 0);
  const stagingQaPassCount = Number(stagingQaPayload?.passCount ?? 0);
  const stagingQaFailCount = Number(stagingQaPayload?.failCount ?? 0);

  // Visual Template Builder / Visual Asset Planner (Fase O12.4).
  const visualTemplatePayload = findAgentFinishedPayload(events, "visual-template-builder");
  const totalVisualPreviewCount = Number(visualTemplatePayload?.totalVisualPreviewCount ?? 0);
  const visualAssetPayload = findAgentFinishedPayload(events, "visual-asset-planner");
  const totalAssetRequestCount =
    typeof visualAssetPayload?.totalAssetRequestCount === "number"
      ? visualAssetPayload.totalAssetRequestCount
      : readCurrentAssetRequests().filter((r) => r.status === "proposed").length;
  const n8nAssetWebhookConfigured = Boolean(visualAssetPayload?.n8nConfigured);

  const reportPaths: Record<string, string> = {};
  for (const agent of [
    "seo-watcher",
    "seo-director",
    "competitor-intelligence",
    "content-planner",
    "cro-landing-reviewer",
    "sem-watcher",
    "analytics-watcher",
    "approval-queue",
    "approved-action-planner",
    "seo-work-order-builder",
    "content-work-order-builder",
    "cro-work-order-builder",
    "seo-change-pack-builder",
    "content-change-pack-builder",
    "cro-change-pack-builder",
    "wordpress-draft-agent",
    "visual-template-builder",
    "visual-asset-planner",
    "staging-executor",
    "staging-qa-agent",
    "approval-gateway",
  ]) {
    const payload = findAgentFinishedPayload(events, agent);
    const reportPath = payload?.reportPath;
    if (typeof reportPath === "string") reportPaths[agent] = reportPath;
  }

  const generatedAt = new Date().toISOString();
  const executionDate = generatedAt.slice(0, 10);

  // --- Fase O27: datos de EJECUCION REAL para el nuevo formato de 6
  // secciones (antes de esta fase, nada de esto se calculaba: el informe
  // solo sabia contar previews/change packs, nunca "que cambio de estado
  // hoy" ni "que se aplico de verdad en staging hoy"). ---
  const allQaResults = readCurrentStagingQaResults();
  const qaRunsToday = allQaResults.filter((r) => r.checkedAt.slice(0, 10) === executionDateForRunId).length;
  const allProductionPlans = readCurrentProductionDeploymentPlans();
  const allProductionExecutions = readCurrentProductionExecutions();

  const stagingExecutionsAppliedToday = allStagingExecutions.filter(
    (e) => e.status === "applied_to_staging" && e.updatedAt.slice(0, 10) === executionDateForRunId
  );
  const realChangesToday: RealChangeToday[] = stagingExecutionsAppliedToday.map((e) => ({
    description: `${e.snapshot?.existedBefore ? "Borrador actualizado" : "Borrador nuevo creado"} en staging ("${e.changeType}"): "${e.keyword}"${e.page ? ` (${e.page})` : ""}`,
    stagingUrl: e.wordpressDraftUrl,
  }));

  const tasksClosedToday = allActions.filter((a) => a.status === "done" && a.updatedAt.slice(0, 10) === executionDateForRunId).length;
  const carrilAAutoAppliedToday = allApprovalRequests.filter(
    (r) => r.answeredBy === "carril_a_staging_autonomy" && (r.answeredAt ?? "").slice(0, 10) === executionDateForRunId
  ).length;

  const startOfToday = `${executionDateForRunId}T00:00:00.000Z`;
  const tasksAdvancedToday: TaskAdvancedToday[] = [];
  for (const action of allActions) {
    const currentCtx = buildOpportunityStateContext(action, allChangePacks, allStagingExecutions, allQaResults, allProductionPlans, allProductionExecutions);
    const currentState = deriveOpportunityState(currentCtx);
    const priorCtx = buildOpportunityStateContextAsOf(
      startOfToday,
      action,
      allChangePacks,
      allStagingExecutions,
      allQaResults,
      allProductionPlans,
      allProductionExecutions
    );
    const priorState = deriveOpportunityState(priorCtx);
    if (currentState === priorState) continue;
    const latestExecution = [...currentCtx.stagingExecutions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    tasksAdvancedToday.push({
      title: action.title,
      previousState: priorState,
      newState: currentState,
      evidence: action.recommendation || action.description,
      stagingUrl: latestExecution?.wordpressDraftUrl,
    });
  }

  // Decisiones necesarias de Pau (Fase O27): deduplicadas por titulo
  // visible ADEMAS de por relatedId (que ya dedupe upsertApprovalRequest)
  // -- asi, aunque dos registros internos distintos representen "la misma
  // decision" para un humano (ej. el bug real de "Plan de deploy a
  // produccion: taquillas escolares" duplicado), Pau nunca ve la fila
  // repetida en el email.
  // Fase O27.1 -- orden deliberado: las solicitudes de aprobacion
  // (pendingApprovalRequests, ordenadas de mas reciente a mas antigua)
  // van ANTES que las acciones waiting_approval del backlog general. Una
  // aprobacion de PLAN/EJECUCION de produccion recien creada por un
  // batch de hoy es mas urgente y mas accionable que una decision de
  // backlog que lleva dias esperando -- sin este orden, las 3 plazas de
  // MAX_DECISIONS se llenaban con decisiones antiguas y las nuevas de
  // hoy quedaban invisibles (encontrado en el primer arranque real del
  // Carril A).
  // Nota (Fase O27.3): pendingApprovalRequests YA viene filtrado en el
  // origen (ver arriba) para excluir planes de deploy a produccion cuya
  // pagina todavia no tiene revision visual -- no hace falta repetir el
  // filtro aqui.
  const pendingDecisionsV2: PendingDecisionV2[] = [];
  const seenDecisionTitles = new Set<string>();
  const sortedPendingApprovalRequests = [...pendingApprovalRequests].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const request of sortedPendingApprovalRequests) {
    const prefix =
      request.relatedType === "production_deployment_plan"
        ? "Aprobar el PLAN de deploy a produccion"
        : request.relatedType === "production_execution"
          ? "Autorizar la EJECUCION real en produccion"
          : request.relatedType === "staging_execution"
            ? "Aprobar la ejecucion en staging"
            : "Responder";
    const title = `${prefix}: ${request.title}`;
    if (seenDecisionTitles.has(title)) continue;
    seenDecisionTitles.add(title);
    pendingDecisionsV2.push({
      title,
      impact: request.summary,
      risk:
        request.riskLevel === "critical"
          ? "Critico — toca produccion real si se aprueba."
          : request.riskLevel === "high"
            ? "Alto."
            : "Medio/bajo.",
    });
  }
  for (const action of waitingApprovalActions) {
    const title = `Aprobar o descartar: ${action.title}`;
    if (seenDecisionTitles.has(title)) continue;
    seenDecisionTitles.add(title);
    pendingDecisionsV2.push({
      title,
      impact: action.impact || action.recommendation || "Mejora de visibilidad/conversion en la pagina afectada.",
      risk: "Bajo — preparacion/mejora reversible, no toca produccion por si sola.",
      reviewUrl: action.page,
    });
  }

  const totalOpenOpportunityCount = allActions.filter(
    (a) => !["done", "rejected", "snoozed"].includes(a.status)
  ).length;
  // Fase O27 -- dedup por pagina+keyword (no por changePackId): varios
  // change packs (SEO/content/CRO) pueden apuntar a la MISMA pagina, y
  // sin este dedup el "Backlog resumido" repetia la misma oportunidad 3
  // veces (una por tipo de change pack) en vez de mostrar variedad real.
  const seenBacklogKeys = new Set<string>();
  const topBacklogSummary: string[] = [];
  for (const cp of readyForReviewChangePacks) {
    const key = `${cp.keyword}|${cp.page ?? ""}`;
    if (seenBacklogKeys.has(key)) continue;
    seenBacklogKeys.add(key);
    topBacklogSummary.push(`${cp.keyword}${cp.page ? ` (${cp.page})` : ""} — listo para revisar`);
    if (topBacklogSummary.length >= 6) break;
  }

  const carrilAOpenCount = allActions.filter((a) => a.status === "auto_approved_for_planning").length;

  // Fase O27.3 (postmortem visual de Pau): "QA tecnico pasado" no es lo
  // mismo que "lista para producción" -- se anade una lista explicita de
  // borradores que YA pasaron QA tecnico en staging pero que todavia
  // nadie ha revisado visualmente (ver src/core/visual-qa.ts). Se
  // deduplica por wordpressPageId: varias ejecuciones/QA runs pueden
  // apuntar a la misma pagina.
  const seenVisualReviewPageIds = new Set<number>();
  const existingPageAudits = readCurrentExistingPageAudits();
  const draftsPendingVisualReview: VisualReviewPendingItem[] = [];
  for (const execution of allStagingExecutions) {
    if (execution.status !== "applied_to_staging" || typeof execution.wordpressPageId !== "number") continue;
    if (seenVisualReviewPageIds.has(execution.wordpressPageId)) continue;
    const qa = allQaResults.find((r) => r.executionId === execution.executionId);
    if (!qa || !qa.overallPass) continue;
    if (isVisuallyApproved(execution.wordpressPageId, visualApprovalsForGate)) continue;
    seenVisualReviewPageIds.add(execution.wordpressPageId);
    const audit = findExistingPageAudit(execution.wordpressPageId, existingPageAudits);
    draftsPendingVisualReview.push({
      keyword: execution.keyword,
      page: execution.page,
      stagingUrl: execution.wordpressDraftUrl,
      existingPageMatch: audit ? { matchType: audit.matchType, productionUrl: audit.productionUrl } : undefined,
    });
  }

  // --- Informe ejecutivo (Fase O9, formato de 6 secciones desde la Fase
  // O27): deduplicado, priorizado, en lenguaje natural, diferenciando
  // SIEMPRE analisis de ejecucion real. Es el que se envia por email. Si
  // falla, se usa un fallback minimo y seguro — el motivo real del fallo
  // se registra aqui, nunca en el informe que ve el responsable.
  const actionableActions = allActions.filter((a) => LIVE_ACTION_STATUSES.includes(a.status));
  const executiveInput: ExecutiveReportInput = {
    dateLabel: executionDate,
    actionableActions,
    workOrders: allWorkOrders,
    waitingApprovalActions,
    pendingApprovalRequests,
    competitorGapCount,
    croReviewCount,
    changePackCount: allChangePacks.length,
    localPreviewCount: totalLocalPreviewCount,
    wordpressDraftCount: totalWordpressDraftCount,
    wordpressDraftsEnabled,
    stagingExecutionsAppliedCount: totalStagingAppliedCount,
    stagingExecutionsPendingApprovalCount: stagingPendingApprovalCount,
    semConnected: semPayload?.connected === true,
    analyticsGa4Connected: analyticsPayload?.ga4Connected === true,
    analyticsGtmConnected: analyticsPayload?.gtmConnected === true,
    warnings,
  };

  let executiveFallbackUsed = false;
  let preparedForReviewCount = 0;
  let pendingDecisionCount = 0;
  let executiveMarkdown: string;
  try {
    const executiveData = buildExecutiveReportData(executiveInput);
    // Revision final de coherencia (equivalente a que Growth Director
    // relea el informe antes de guardarlo): cifras, duplicados, fuente
    // real de los datos, atribucion de marca, trabajo nuevo frente a
    // backlog, decisiones requeridas. Si algo no cuadra, se trata como un
    // fallo de generacion y se usa el fallback seguro — nunca se guarda
    // ni se envia un informe que se sabe incoherente.
    const coherenceProblems = validateExecutiveReportCoherence(executiveData);
    if (coherenceProblems.length > 0) {
      throw new Error(`Informe ejecutivo incoherente, no se guarda: ${coherenceProblems.join("; ")}`);
    }
    const extrasV2: ExecutiveReportExtrasV2 = {
      realChangesToday,
      qaRunsToday,
      tasksClosedToday,
      tasksAdvancedToday: tasksAdvancedToday.slice(0, 12),
      pendingDecisionsV2,
      draftsPendingVisualReview,
      carrilAAutoAppliedToday,
      topBacklogSummary,
      totalOpenOpportunityCount,
      tomorrowIfNoResponse:
        pendingDecisionsV2.length > 0
          ? `Las ${Math.min(pendingDecisionsV2.length, 3)} decision(es) de arriba se mantienen pendientes (no se repiten como si fueran nuevas) y el Carril A sigue aplicando en staging cualquier otro cambio seguro que este listo, sin esperar a estas decisiones.`
          : "No hay ninguna decision bloqueada; el departamento sigue avanzando en staging con normalidad.",
      tomorrowIfApproved:
        pendingDecisionsV2.length > 0
          ? "Se aplica en la siguiente pasada (staging si es Carril A/B, o el siguiente paso del plan si es produccion) y aparece en 'Tareas avanzadas hoy' del proximo informe."
          : "No aplica — no hay ninguna decision esperando tu aprobacion hoy.",
      stagingKeepsAdvancing: `${carrilAOpenCount} oportunidad(es) mas siguen su curso normal en staging por el Carril A, sin necesitar tu aprobacion.`,
    };
    executiveMarkdown = renderExecutiveReportMarkdownV2(executiveData, extrasV2, generatedAt);
    preparedForReviewCount = executiveData.preparedForReviewCount;
    pendingDecisionCount = pendingDecisionsV2.length;
  } catch (err) {
    executiveFallbackUsed = true;
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    logger.error("Fallo la generacion del informe ejecutivo (o no paso la revision de coherencia): se usa el fallback seguro. Detalle interno (no se muestra en el informe ejecutivo):", {
      error: message,
    });
    executiveMarkdown = buildFallbackExecutiveReportMarkdown(executionDate);
  }
  const executiveReportPath = writeExecutiveReport(executiveMarkdown, executionDate);

  const result: GrowthDirectorRunResult = {
    departmentRunId: deptRunId,
    executiveReportPath,
    technicalReportPath: "",
    executiveFallbackUsed,
    preparedForReviewCount,
    pendingDecisionCount,
    topActions: [...zentry, ...tukandado, ...mixed]
      .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
      .slice(0, 5),
    zentryOpportunities: zentry,
    tukandadoOpportunities: tukandado,
    mixedOpportunities: mixed,
    competitorGapCount,
    contentProposalCount,
    croReviewCount,
    semConnected: semPayload?.connected === true,
    analyticsGa4Connected: analyticsPayload?.ga4Connected === true,
    analyticsGtmConnected: analyticsPayload?.gtmConnected === true,
    warnings,
    reportPaths,
    newActionsToday,
    recurringOpenActions,
    waitingApprovalActions,
    approvedNotDoneActions,
    discardedActions,
    autoProcessedActionsToday,
    autoApprovedForPlanningActionsToday,
    blockedActions,
    approvedActionCount,
    newWorkOrdersToday,
    readyForReviewWorkOrders,
    autoPreparedWorkOrderCount,
    humanReviewWorkOrderCount,
    workOrdersByBrand,
    workOrdersByCategory,
    pendingApprovalRequests,
    sentViaTelegramRequests,
    approvedApprovalRequests,
    rejectedApprovalRequests,
    snoozedApprovalRequests,
    telegramEnabled,
    telegramConfigured,
    totalChangePackCount: allChangePacks.length,
    newChangePacksToday,
    readyForReviewChangePacks,
    changePacksByType,
    totalLocalPreviewCount,
    totalWordpressDraftCount,
    newLocalPreviewsToday,
    pendingWordpressApprovalCount,
    wordpressDraftsEnabled,
    wordpressConfigured,
    stagingExecutionEnabled,
    totalStagingAppliedCount,
    stagingPendingApprovalCount,
    stagingFailedCount,
    stagingQaCheckedCount,
    stagingQaPassCount,
    stagingQaFailCount,
    totalVisualPreviewCount,
    totalAssetRequestCount,
    n8nAssetWebhookConfigured,
  };

  const technicalMarkdown = buildTechnicalReportMarkdown(result, agentActivity, generatedAt);
  result.technicalReportPath = writeTechnicalReport(technicalMarkdown, executionDate);

  logger.info(
    `Growth Director Agent finalizado. Top acciones: ${result.topActions.length}. Auto-aprobadas para planificacion hoy: ${autoApprovedForPlanningActionsToday.length}. Aprobaciones pendientes: ${pendingApprovalRequests.length}. Change packs listos: ${readyForReviewChangePacks.length}. Informe ejecutivo: ${result.executiveReportPath}${executiveFallbackUsed ? " (fallback)" : ""}. Informe tecnico: ${result.technicalReportPath}.`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Growth Director Agent finalizado: informes diarios consolidados (ejecutivo${executiveFallbackUsed ? " en modo fallback" : ""} + tecnico)`,
    payload: {
      executiveReportPath: result.executiveReportPath,
      technicalReportPath: result.technicalReportPath,
      executiveFallbackUsed,
      topActionCount: result.topActions.length,
    },
  });

  return result;
}
