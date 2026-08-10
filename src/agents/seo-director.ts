import * as fs from "fs";
import * as path from "path";
import { OpportunityKind, Priority, SeoJob } from "../core/types";
import { readAllJobs } from "../core/job-registry";
import { emitEvent } from "../core/department-events";
import { buildDepartmentRunId } from "../core/department-run-id";
import { logger } from "../core/logger";
import { resolveActiveClientPaths } from "../core/client-paths";

const AGENT_NAME = "seo-director";

/**
 * SEO Director Agent — READ + PROPOSE only, igual que SEO Watcher.
 * Solo lee reports/seo/ y data/jobs.jsonl (ambos ya generados por el SEO
 * Watcher Agent) y escribe un nuevo informe en reports/seo-director/.
 * No llama a ninguna API externa, no necesita credenciales, no toca .env.
 * Nunca toca WordPress, Google Ads, GA4, GTM, n8n ni qdrant.
 */

const REPORTS_SEO_DIR = path.join(resolveActiveClientPaths().reportsDir, "seo");
const REPORTS_DIRECTOR_DIR = path.join(resolveActiveClientPaths().reportsDir, "seo-director");

export type Effort = "low" | "medium" | "high";
export type Impact = "low" | "medium" | "high";

export interface ActionItem {
  keyword: string;
  page: string;
  kinds: OpportunityKind[];
  priority: Priority;
  currentPosition: number;
  targetPosition: number;
  totalImpressions: number;
  action: string;
  rationale: string;
  effort: Effort;
  impact: Impact;
  requiresWordPress: boolean;
  requiresNewContent: boolean;
  requiresHumanReview: boolean;
  sourceJobIds: string[];
}

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const EFFORT_RANK: Record<Effort, number> = { low: 1, medium: 2, high: 3 };
const IMPACT_RANK: Record<Impact, number> = { low: 1, medium: 2, high: 3 };

// Esfuerzo base por tipo de oportunidad: CTR es solo retocar meta tags
// (barato); quick_win/caida son trabajo on-page/investigacion; una
// oportunidad futura implica contenido nuevo (caro).
const KIND_EFFORT: Record<OpportunityKind, Effort> = {
  low_ctr: "low",
  quick_win: "medium",
  position_drop: "medium",
  future_opportunity: "high",
};

// Orden en el que se combinan los textos de accion cuando una misma
// keyword+pagina tiene varias oportunidades: diagnostico primero, luego la
// accion de contenido principal, CTR al final (es el ajuste mas rapido).
const ACTION_TEXT_ORDER: OpportunityKind[] = [
  "position_drop",
  "quick_win",
  "future_opportunity",
  "low_ctr",
];

function groupKey(o: { keyword: string; page: string }): string {
  return `${o.keyword.trim().toLowerCase()}|${o.page}`;
}

function estimateImpact(priority: Priority, impressions: number): Impact {
  if (priority === "high" && impressions >= 100) return "high";
  if (priority === "high" || (priority === "medium" && impressions >= 150)) return "medium";
  return "low";
}

function estimateEffort(kinds: OpportunityKind[]): Effort {
  return kinds.reduce<Effort>((max, k) => {
    const e = KIND_EFFORT[k];
    return EFFORT_RANK[e] > EFFORT_RANK[max] ? e : max;
  }, "low");
}

function buildAction(kinds: OpportunityKind[], jobsInGroup: SeoJob[]): string {
  const byKind = new Map<OpportunityKind, string>();
  for (const job of jobsInGroup) {
    if (!byKind.has(job.opportunity.kind)) {
      byKind.set(job.opportunity.kind, job.opportunity.recommendedAction);
    }
  }
  return ACTION_TEXT_ORDER.filter((k) => byKind.has(k))
    .map((k) => byKind.get(k)!)
    .join(" Ademas, ");
}

function buildRationale(kinds: OpportunityKind[], impressions: number, currentPosition: number): string {
  const bits: string[] = [`${impressions} impresiones en el periodo analizado`];
  if (kinds.includes("quick_win")) {
    bits.push(`posicion actual ${currentPosition.toFixed(1)}, a un empujon de primera pagina`);
  }
  if (kinds.includes("low_ctr")) {
    bits.push("el listado ya aparece pero apenas convierte clics (CTR bajo) — suele ser la mejora mas barata");
  }
  if (kinds.includes("position_drop")) {
    bits.push("ha empeorado de posicion recientemente: riesgo de seguir cayendo si no se investiga pronto");
  }
  if (kinds.includes("future_opportunity")) {
    bits.push("esta lejos de primera pagina, pero ya hay volumen de busqueda real para justificar contenido nuevo");
  }
  return bits.join("; ") + ".";
}

/**
 * Agrupa jobs (de UNA ejecucion) por keyword+pagina y sintetiza cada grupo
 * en una unica accion recomendada. Pura funcion de datos en memoria: no
 * lee ni escribe nada en disco.
 */
export function buildActionPlan(jobs: SeoJob[]): ActionItem[] {
  const groups = new Map<string, SeoJob[]>();
  for (const job of jobs) {
    const key = groupKey(job.opportunity);
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }

  const items: ActionItem[] = [];
  for (const jobsInGroup of groups.values()) {
    const kinds = [...new Set(jobsInGroup.map((j) => j.opportunity.kind))];
    const priority = jobsInGroup.reduce<Priority>(
      (max, j) => (PRIORITY_RANK[j.opportunity.priority] > PRIORITY_RANK[max] ? j.opportunity.priority : max),
      "low"
    );
    const first = jobsInGroup[0].opportunity;
    const totalImpressions = Math.max(...jobsInGroup.map((j) => j.opportunity.evidence.impressions));
    // targetPosition: preferir el de quick_win/future_opportunity (objetivo
    // de posicion real) sobre el de low_ctr (que es igual a la posicion
    // actual, no es un objetivo de posicion de verdad).
    const targetSource =
      jobsInGroup.find(
        (j) => j.opportunity.kind === "quick_win" || j.opportunity.kind === "future_opportunity"
      ) ?? jobsInGroup[0];

    items.push({
      keyword: first.keyword,
      page: first.page,
      kinds,
      priority,
      currentPosition: first.currentPosition,
      targetPosition: targetSource.opportunity.targetPosition,
      totalImpressions,
      action: buildAction(kinds, jobsInGroup),
      rationale: buildRationale(kinds, totalImpressions, first.currentPosition),
      effort: estimateEffort(kinds),
      impact: estimateImpact(priority, totalImpressions),
      // position_drop puro puede ser un problema tecnico/de indexacion, no
      // necesariamente de contenido: solo asumimos WordPress si hay ademas
      // alguna otra senal de contenido/CTR.
      requiresWordPress: kinds.some((k) => k !== "position_drop"),
      requiresNewContent: kinds.includes("future_opportunity"),
      requiresHumanReview: true,
      sourceJobIds: jobsInGroup.map((j) => j.id),
    });
  }

  return items.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (rankDiff !== 0) return rankDiff;
    const impactDiff = IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact];
    if (impactDiff !== 0) return impactDiff;
    return b.totalImpressions - a.totalImpressions;
  });
}

export interface SeoDirectorReportInput {
  generatedAt: string;
  sourceRunId: string;
  sourceReportPath: string;
  items: ActionItem[];
}

function formatTarget(target: number): number {
  return Number(target.toFixed(1));
}

export function buildDirectorReportMarkdown(input: SeoDirectorReportInput): string {
  const executionDate = input.generatedAt.slice(0, 10);
  const top5 = input.items.slice(0, 5);
  const highCount = input.items.filter((i) => i.priority === "high").length;

  const lines: string[] = [];
  lines.push(`# Plan de accion SEO — ${executionDate}`);
  lines.push("");
  lines.push(`- **Basado en:** SEO Watcher runId \`${input.sourceRunId}\``);
  lines.push(`- **Informe base:** ${input.sourceReportPath}`);
  lines.push(`- **Generado:** ${input.generatedAt}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `A partir del ultimo informe del SEO Watcher se agruparon las oportunidades por keyword y pagina en **${input.items.length}** accion(es) concreta(s) (**${highCount}** de prioridad alta). Esto es un plan, no una ejecucion: cada accion indica que tocar, por que y cuanto cuesta — pero ninguna se aplica sola. Todo pasa por revision humana antes de tocar produccion.`
  );
  lines.push("");

  lines.push(`## Top ${top5.length} acciones recomendadas para hoy/esta semana`);
  lines.push("");
  if (top5.length === 0) {
    lines.push("No hay acciones que recomendar en este momento.");
  } else {
    top5.forEach((item, i) => {
      lines.push(`### ${i + 1}. [${item.priority}] "${item.keyword}"`);
      lines.push("");
      lines.push(`- **Pagina a tocar:** ${item.page}`);
      lines.push(`- **Keyword a atacar:** ${item.keyword}`);
      lines.push(
        `- **Posicion actual -> objetivo:** ${item.currentPosition.toFixed(1)} -> ${formatTarget(item.targetPosition)}`
      );
      lines.push(`- **Por que merece la pena:** ${item.rationale}`);
      lines.push(`- **Accion sugerida:** ${item.action}`);
      lines.push(`- **Esfuerzo estimado:** ${item.effort}`);
      lines.push(`- **Impacto estimado:** ${item.impact}`);
      lines.push(`- **Requiere WordPress:** ${item.requiresWordPress ? "si" : "no"}`);
      lines.push(`- **Requiere contenido nuevo:** ${item.requiresNewContent ? "si" : "no"}`);
      lines.push(`- **Requiere revision humana:** ${item.requiresHumanReview ? "si" : "no"}`);
      lines.push("");
    });
  }

  lines.push("## Todas las acciones agrupadas");
  lines.push("");
  lines.push("| # | Prioridad | Keyword | Pagina | Tipos | Esfuerzo | Impacto | WordPress | Contenido nuevo |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  input.items.forEach((item, i) => {
    lines.push(
      `| ${i + 1} | ${item.priority} | ${item.keyword} | ${item.page} | ${item.kinds.join(", ")} | ${item.effort} | ${item.impact} | ${item.requiresWordPress ? "si" : "no"} | ${item.requiresNewContent ? "si" : "no"} |`
    );
  });
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- No se ha ejecutado ningun cambio SEO real; este agente solo lee informes/jobs existentes y propone.");
  lines.push("- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.");
  lines.push("");

  return lines.join("\n");
}

export function writeDirectorReport(input: SeoDirectorReportInput): string {
  fs.mkdirSync(REPORTS_DIRECTOR_DIR, { recursive: true });
  const executionDate = input.generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIRECTOR_DIR, `seo-director-${executionDate}.md`);
  fs.writeFileSync(filePath, buildDirectorReportMarkdown(input), "utf-8");
  return filePath;
}

function findLatestRunId(jobs: SeoJob[]): string {
  const runId = jobs.reduce<string | undefined>((max, j) => {
    if (!max || j.meta.runId > max) return j.meta.runId;
    return max;
  }, undefined);
  if (!runId) {
    throw new Error('No se encontro ningun runId en data/jobs.jsonl. Ejecuta primero "npm run seo:watch".');
  }
  return runId;
}

/**
 * Localiza el informe de SEO Watcher correspondiente a un runId. Como
 * fallback (por si el nombre no calza exactamente), usa el .md mas
 * reciente de reports/seo/.
 */
function findSeoWatcherReportForRunId(runId: string): string {
  const dateMatch = runId.match(/seo-watcher-(\d{4}-\d{2}-\d{2})T/);
  if (dateMatch) {
    const candidate = path.join(REPORTS_SEO_DIR, `seo-watcher-${dateMatch[1]}.md`);
    if (fs.existsSync(candidate)) return candidate;
  }

  if (!fs.existsSync(REPORTS_SEO_DIR)) {
    throw new Error(`No existe ${REPORTS_SEO_DIR}. Ejecuta primero "npm run seo:watch".`);
  }
  const files = fs
    .readdirSync(REPORTS_SEO_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ name: f, mtimeMs: fs.statSync(path.join(REPORTS_SEO_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (files.length === 0) {
    throw new Error(`No se encontro ningun informe de SEO Watcher (.md) en ${REPORTS_SEO_DIR}.`);
  }
  return path.join(REPORTS_SEO_DIR, files[0].name);
}

export interface SeoDirectorRunResult {
  departmentRunId: string;
  sourceRunId: string;
  sourceReportPath: string;
  items: ActionItem[];
  reportPath: string;
}

/**
 * Version standalone (npm run seo:director): lee data/jobs.jsonl del
 * disco, detecta la ejecucion mas reciente del SEO Watcher (por runId) y
 * el informe correspondiente en reports/seo/, agrupa y escribe el plan en
 * reports/seo-director/.
 */
export async function runSeoDirector(departmentRunId?: string): Promise<SeoDirectorRunResult> {
  const deptRunId = departmentRunId ?? buildDepartmentRunId();
  logger.info("SEO Director Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_started",
    summary: "SEO Director Agent iniciado",
  });

  const jobs = readAllJobs();
  if (jobs.length === 0) {
    throw new Error('data/jobs.jsonl esta vacio. Ejecuta primero "npm run seo:watch".');
  }

  const sourceRunId = findLatestRunId(jobs);
  const sourceReportPath = findSeoWatcherReportForRunId(sourceRunId);
  const latestRunJobs = jobs.filter((j) => j.meta.runId === sourceRunId);

  logger.info(`SEO Director: usando ${latestRunJobs.length} tarea(s) del runId ${sourceRunId}`, {
    sourceRunId,
    sourceReportPath,
  });

  const items = buildActionPlan(latestRunJobs);

  for (const item of items) {
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "recommendation_created",
      priority: item.priority,
      summary: `[${item.priority}] "${item.keyword}" (${item.page}) — esfuerzo=${item.effort} impacto=${item.impact}`,
      payload: { ...item } as unknown as Record<string, unknown>,
    });
  }

  const reportPath = writeDirectorReport({
    generatedAt: new Date().toISOString(),
    sourceRunId,
    sourceReportPath,
    items,
  });

  logger.info(`SEO Director Agent finalizado. Acciones generadas: ${items.length}. Informe: ${reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `SEO Director Agent finalizado: ${items.length} accion(es) recomendada(s)`,
    payload: { sourceRunId, itemCount: items.length, reportPath },
  });

  return { departmentRunId: deptRunId, sourceRunId, sourceReportPath, items, reportPath };
}
