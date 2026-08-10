import * as fs from "fs";
import * as path from "path";
import { classifyKeyword, classifyOpportunity } from "../core/brand-intent-router";
import { readCurrentActions, upsertAction, UpsertActionInput } from "../core/action-backlog";
import { emitEvent, readAllEvents, readEventsForRun } from "../core/department-events";
import { logger } from "../core/logger";
import { BacklogAction, DepartmentEvent, Priority } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Approval Queue Agent — READ + PROPOSE only. Convierte recomendaciones ya
 * generadas por otros agentes (via el bus de eventos) en acciones unicas y
 * deduplicadas del Action Backlog. Nunca ejecuta nada real: el status que
 * recibe una accion (incluidos los automaticos de la Fase O7,
 * `auto_processed`/`auto_approved_for_planning`) solo dice que se puede
 * seguir trabajando en ella (con o sin humano segun la politica de
 * autonomia), nunca que se ha publicado nada. Ver docs/autonomy-policy.md.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "approval-queue");
const AGENT_NAME = "approval-queue";

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error(
      "No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento."
    );
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

// --- Mapeo de cada tipo de evento/payload a una entrada del backlog ---
// NOTA (Fase O7): ninguno de estos mappers fija ya `requiresApproval` a
// mano — lo decide `classifyActionAutonomy()` dentro de `upsertAction()`
// segun el `actionType`, no el agente que propone la accion.

interface SeoActionItemPayload {
  keyword: string;
  page: string;
  kinds: string[];
  priority: Priority;
  currentPosition: number;
  targetPosition: number;
  totalImpressions: number;
  action: string;
  rationale: string;
  effort: string;
  impact: string;
  sourceJobIds: string[];
}

interface ContentPlanItemPayload {
  type: string;
  targetBrand: string;
  title: string;
  relatedKeyword: string;
  relatedPage?: string;
  rationale: string;
  priority: Priority;
}

interface LandingReviewPayload {
  page: string;
  primaryKeywords: string[];
  brandCategory: string;
  opportunityKinds: string[];
  priority: Priority;
  recommendations: Array<{ area: string; recommendation: string }>;
}

interface CompetitorGapPayload {
  gapType: "keyword" | "content";
  term: string;
  frequency?: number;
  contentKind?: "sector" | "material";
  sourceCompetitors: string[];
  suggestedForSem?: boolean;
}

function fromSeoDirectorEvent(event: DepartmentEvent, departmentRunId: string): UpsertActionInput | undefined {
  const p = event.payload as unknown as SeoActionItemPayload;
  if (!p.keyword || !p.page) return undefined;
  const intent = classifyOpportunity({ keyword: p.keyword, page: p.page });
  const actionType = `seo:${[...p.kinds].sort().join("+")}`;
  return {
    title: `SEO: "${p.keyword}" (${p.page})`,
    description: p.rationale,
    sourceAgent: "seo-director",
    brandIntent: intent.category,
    targetBrand: intent.brand,
    keyword: p.keyword,
    page: p.page,
    actionType,
    priority: p.priority,
    impact: p.impact,
    effort: p.effort,
    evidence: {
      currentPosition: p.currentPosition,
      targetPosition: p.targetPosition,
      totalImpressions: p.totalImpressions,
    },
    recommendation: p.action,
    departmentRunId,
    relatedJobIds: p.sourceJobIds ?? [],
  };
}

function fromContentPlannerEvent(event: DepartmentEvent, departmentRunId: string): UpsertActionInput | undefined {
  const p = event.payload as unknown as ContentPlanItemPayload;
  if (!p.relatedKeyword) return undefined;
  const intent = classifyKeyword(p.relatedKeyword);
  return {
    title: p.title,
    description: p.rationale,
    sourceAgent: "content-planner",
    brandIntent: intent.category,
    targetBrand: intent.brand,
    keyword: p.relatedKeyword,
    page: p.relatedPage,
    actionType: `content:${p.type}`,
    priority: p.priority,
    recommendation: p.rationale,
    departmentRunId,
  };
}

function fromCroEvent(event: DepartmentEvent, departmentRunId: string): UpsertActionInput | undefined {
  const p = event.payload as unknown as LandingReviewPayload;
  if (!p.page) return undefined;
  const keyword = p.primaryKeywords?.[0] ?? p.page;
  const intent = classifyOpportunity({ keyword, page: p.page });
  const recSummary = (p.recommendations ?? []).map((r) => `[${r.area}] ${r.recommendation}`).join(" ");
  return {
    title: `CRO: ${p.page}`,
    description: `Landing afectada por: ${p.opportunityKinds?.join(", ") ?? "oportunidades SEO"}.`,
    sourceAgent: "cro-landing-reviewer",
    brandIntent: intent.category,
    targetBrand: intent.brand,
    keyword,
    page: p.page,
    actionType: "cro:landing_review",
    priority: p.priority,
    recommendation: recSummary,
    departmentRunId,
  };
}

function fromCompetitorEvent(event: DepartmentEvent, departmentRunId: string): UpsertActionInput | undefined {
  const p = event.payload as unknown as CompetitorGapPayload;
  if (!p.term) return undefined;
  const intent = classifyKeyword(p.term);
  if (intent.category === "irrelevant_or_low_fit") return undefined;

  if (p.gapType === "content") {
    return {
      title: `Competencia: gap de ${p.contentKind} "${p.term}"`,
      description: `Detectado en: ${p.sourceCompetitors.join(", ")}.`,
      sourceAgent: "competitor-intelligence",
      brandIntent: intent.category,
      targetBrand: intent.brand,
      keyword: p.term,
      actionType: `competitor:content_gap_${p.contentKind}`,
      priority: "medium",
      recommendation: `Valorar landing/contenido para "${p.term}" (${p.contentKind}), que la competencia ya cubre.`,
      departmentRunId,
    };
  }

  return {
    title: `Competencia: keyword no cubierta "${p.term}"`,
    description: `Detectado en: ${p.sourceCompetitors.join(", ")} (frecuencia ${p.frequency ?? "?"}).`,
    sourceAgent: "competitor-intelligence",
    brandIntent: intent.category,
    targetBrand: intent.brand,
    keyword: p.term,
    actionType: p.suggestedForSem ? "competitor:keyword_gap_sem" : "competitor:keyword_gap_seo",
    priority: p.suggestedForSem ? "high" : "medium",
    recommendation: `Valorar contenido/campana para "${p.term}", trabajada por la competencia y sin cobertura hoy.`,
    departmentRunId,
  };
}

interface OperationalReviewPayload {
  kind: "sem_review" | "analytics_validation";
  keyword: string;
  recommendation: string;
}

/**
 * SEM Watcher y Analytics Watcher no proponen sobre una keyword de
 * producto: son revisiones operativas (revisar campana / validar
 * tracking) que afectan a ambas marcas por igual, asi que se clasifican
 * directamente como mixed_cross_sell/both en vez de pasar por el Brand
 * Router (que las marcaria irrelevant_or_low_fit al no mencionar
 * taquillas/cerraduras).
 */
function fromSemWatcherEvent(event: DepartmentEvent, departmentRunId: string): UpsertActionInput | undefined {
  const p = event.payload as unknown as OperationalReviewPayload;
  if (!p.keyword) return undefined;
  return {
    title: event.summary,
    description: p.recommendation,
    sourceAgent: "sem-watcher",
    brandIntent: "mixed_cross_sell",
    targetBrand: "both",
    keyword: p.keyword,
    actionType: "sem:campaign_review",
    priority: "medium",
    recommendation: p.recommendation,
    departmentRunId,
  };
}

function fromAnalyticsWatcherEvent(event: DepartmentEvent, departmentRunId: string): UpsertActionInput | undefined {
  const p = event.payload as unknown as OperationalReviewPayload;
  if (!p.keyword) return undefined;
  return {
    title: event.summary,
    description: p.recommendation,
    sourceAgent: "analytics-watcher",
    brandIntent: "mixed_cross_sell",
    targetBrand: "both",
    keyword: p.keyword,
    actionType: "analytics:tracking_validation",
    priority: "medium",
    recommendation: p.recommendation,
    departmentRunId,
  };
}

export interface ApprovalQueueRunResult {
  departmentRunId: string;
  // Fase O7 — buckets de esta pasada, segun a que status las llevo la
  // politica de autonomia (ver src/core/autonomy-policy.ts). Sustituyen
  // conceptualmente a "nuevas"/"recurrentes" de la Fase O5 para acciones
  // que la politica ya sabe clasificar; `newActions`/`recurringOpenActions`
  // se mantienen por compatibilidad pero, con la politica activa, deberian
  // salir vacios salvo un actionType sin clasificar.
  newActions: BacklogAction[];
  recurringOpenActions: BacklogAction[];
  autoProcessedActions: BacklogAction[];
  autoApprovedForPlanningActions: BacklogAction[];
  waitingApprovalActions: BacklogAction[];
  blockedActionsThisRun: BacklogAction[];
  approvedNotDoneActions: BacklogAction[];
  snoozedActions: BacklogAction[];
  rejectedActions: BacklogAction[];
  blockedActions: BacklogAction[];
  doneActions: BacklogAction[];
  reportPath: string;
}

function buildReportMarkdown(result: ApprovalQueueRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  const section = (title: string, actions: BacklogAction[]): void => {
    lines.push(`## ${title} (${actions.length})`);
    lines.push("");
    if (actions.length === 0) {
      lines.push("Ninguna.");
    } else {
      for (const a of actions) {
        lines.push(
          `- [${a.priority}] \`${a.actionId}\` ${a.title} — visto ${a.seenCount} vez/veces (desde ${a.firstSeenAt.slice(0, 10)})`
        );
      }
    }
    lines.push("");
  };

  lines.push(`# Approval Queue — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Auto-procesadas: **${result.autoProcessedActions.length}** · Auto-aprobadas para planificacion: **${result.autoApprovedForPlanningActions.length}** · Pendientes de aprobacion humana (esta pasada): **${result.waitingApprovalActions.length}** · Bloqueadas (esta pasada): **${result.blockedActionsThisRun.length}** · Aprobadas por humano sin ejecutar: **${result.approvedNotDoneActions.length}** · Snoozed: **${result.snoozedActions.length}** · Rechazadas: **${result.rejectedActions.length}** · Bloqueadas (total): **${result.blockedActions.length}** · Hechas: **${result.doneActions.length}**. Ninguna implica ejecucion real, ni siquiera las auto-aprobadas: ver docs/autonomy-policy.md.`
  );
  lines.push("");

  section("Auto-procesadas (AUTO_INTERNAL, sin aprobacion)", result.autoProcessedActions);
  section("Auto-aprobadas para planificacion (AUTO_PLAN, sin aprobacion)", result.autoApprovedForPlanningActions);
  section("Pendientes de aprobacion humana (esta pasada)", result.waitingApprovalActions);
  section("Bloqueadas (esta pasada)", result.blockedActionsThisRun);
  section("Aprobadas por un humano pero todavia no ejecutadas", result.approvedNotDoneActions);
  section("Snoozed", result.snoozedActions);
  section("Rechazadas", result.rejectedActions);
  section("Ya hechas", result.doneActions);

  lines.push("## Como gestionar el backlog");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run actions:list -- --status waiting_approval");
  lines.push("npm run actions:update -- --actionId <id> --status approved");
  lines.push("```");
  lines.push("");
  lines.push(
    "Las acciones `auto_approved_for_planning` y `auto_processed` NO necesitan este paso — la politica de autonomia (Fase O7) ya decidio que se pueden trabajar sin aprobacion. Solo las `waiting_approval` esperan una decision humana. Ver `docs/autonomy-policy.md`."
  );
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Ningun estado del backlog implica ejecucion real, incluidos los automaticos de la Fase O7.");
  lines.push("- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: ApprovalQueueRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `approval-queue-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runApprovalQueue(departmentRunId?: string): Promise<ApprovalQueueRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Approval Queue Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Approval Queue Agent iniciado" });

  const events = readEventsForRun(deptRunId);
  const current = readCurrentActions();

  const touchedActionIds = new Set<string>();

  for (const event of events) {
    if (event.type !== "recommendation_created" && event.type !== "competitor_keyword_detected") continue;

    let input: UpsertActionInput | undefined;
    if (event.agent === "seo-director") input = fromSeoDirectorEvent(event, deptRunId);
    else if (event.agent === "content-planner") input = fromContentPlannerEvent(event, deptRunId);
    else if (event.agent === "cro-landing-reviewer") input = fromCroEvent(event, deptRunId);
    else if (event.agent === "competitor-intelligence") input = fromCompetitorEvent(event, deptRunId);
    else if (event.agent === "sem-watcher") input = fromSemWatcherEvent(event, deptRunId);
    else if (event.agent === "analytics-watcher") input = fromAnalyticsWatcherEvent(event, deptRunId);

    if (!input) continue;

    const { action, isNew } = upsertAction(input, current);
    touchedActionIds.add(action.actionId);

    if (isNew) {
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "action_proposed",
        priority: action.priority,
        summary: `Nueva accion en el backlog: ${action.title} (${action.status})`,
        payload: { actionId: action.actionId, canonicalKey: action.canonicalKey, status: action.status, autonomyLevel: action.autonomyLevel },
      });
    }
  }

  const touchedActions = current.filter((a) => touchedActionIds.has(a.actionId));
  const newActions = touchedActions.filter((a) => a.status === "new");
  const recurringOpenActions = touchedActions.filter((a) => a.status === "open");
  const autoProcessedActions = touchedActions.filter((a) => a.status === "auto_processed");
  const autoApprovedForPlanningActions = touchedActions.filter((a) => a.status === "auto_approved_for_planning");
  const waitingApprovalActions = touchedActions.filter((a) => a.status === "waiting_approval");
  const blockedActionsThisRun = touchedActions.filter((a) => a.status === "blocked");
  const approvedNotDoneActions = current.filter((a) => a.status === "approved");
  const snoozedActions = current.filter((a) => a.status === "snoozed");
  const rejectedActions = current.filter((a) => a.status === "rejected");
  const blockedActions = current.filter((a) => a.status === "blocked");
  const doneActions = current.filter((a) => a.status === "done");

  const generatedAt = new Date().toISOString();
  const result: ApprovalQueueRunResult = {
    departmentRunId: deptRunId,
    newActions,
    recurringOpenActions,
    autoProcessedActions,
    autoApprovedForPlanningActions,
    waitingApprovalActions,
    blockedActionsThisRun,
    approvedNotDoneActions,
    snoozedActions,
    rejectedActions,
    blockedActions,
    doneActions,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `Approval Queue Agent finalizado. Auto-procesadas: ${autoProcessedActions.length}, auto-aprobadas para planificacion: ${autoApprovedForPlanningActions.length}, pendientes de aprobacion: ${waitingApprovalActions.length}. Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Approval Queue Agent finalizado: ${autoApprovedForPlanningActions.length} auto-aprobada(s) para planificacion, ${waitingApprovalActions.length} pendiente(s) de aprobacion`,
    payload: {
      autoProcessedCount: autoProcessedActions.length,
      autoApprovedForPlanningCount: autoApprovedForPlanningActions.length,
      waitingApprovalCount: waitingApprovalActions.length,
      blockedCount: blockedActionsThisRun.length,
      approvedNotDoneCount: approvedNotDoneActions.length,
      reportPath: result.reportPath,
    },
  });

  return result;
}
