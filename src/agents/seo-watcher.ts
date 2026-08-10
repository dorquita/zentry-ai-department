import * as fs from "fs";
import * as path from "path";
import {
  AgentMode,
  SearchConsoleRow,
  SeoJob,
  SeoJobMeta,
  SeoOpportunity,
  TargetKeyword,
  Thresholds,
  Priority,
} from "../core/types";
import { getSeoData, resolveDataSource } from "../adapters";
import { createJob, appendJob, getJobsFilePath } from "../core/job-registry";
import { buildRunId } from "../core/run-id";
import { writeReport } from "../core/report";
import { emitEvent } from "../core/department-events";
import { buildDepartmentRunId } from "../core/department-run-id";
import { loadActiveClientSeoConfig, resolveProjectPath } from "../core/client-config";

const AGENT_NAME = "seo-watcher";
import { logger } from "../core/logger";

const CONFIG_DIR = path.join(__dirname, "..", "..", "config");

/**
 * SEO Watcher Agent — READ + PROPOSE only.
 * Never calls WordPress, Google Ads, GA4/GTM, or n8n. Never writes to
 * production. Its only side effect is appending rows to data/jobs.jsonl.
 *
 * Fase O16.1: `thresholds.json`/`seo-target-keywords.json` se resuelven
 * ahora via `configPaths.seo` del ClientConfig ACTIVO
 * (`clients/<id>/seo.json` -> `thresholdsConfigPath`/
 * `targetKeywordsConfigPath`), con fallback a la ruta legacy de
 * `config/` si el cliente no define una ruta propia (ninguno lo hace
 * hoy — para "zentry" ambas rutas siguen apuntando a `config/`, ver
 * `clients/zentry/seo.json`).
 */
export const AGENT_MODE: AgentMode = "PROPOSE";

function loadThresholds(): Thresholds {
  const seoConfig = loadActiveClientSeoConfig();
  const filePath = seoConfig.thresholdsConfigPath
    ? resolveProjectPath(seoConfig.thresholdsConfigPath)
    : path.join(CONFIG_DIR, "thresholds.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Thresholds;
}

function loadTargetKeywords(): TargetKeyword[] {
  const seoConfig = loadActiveClientSeoConfig();
  const filePath = seoConfig.targetKeywordsConfigPath
    ? resolveProjectPath(seoConfig.targetKeywordsConfigPath)
    : path.join(CONFIG_DIR, "seo-target-keywords.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as { keywords: TargetKeyword[] };
  return parsed.keywords;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function findTargetKeyword(
  keyword: string,
  targets: TargetKeyword[]
): TargetKeyword | undefined {
  return targets.find((t) => normalize(t.keyword) === normalize(keyword));
}

function nextReviewDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function priorityFor(
  kind: SeoOpportunity["kind"],
  keyword: string,
  targets: TargetKeyword[]
): Priority {
  if (kind === "position_drop") return "high";
  const target = findTargetKeyword(keyword, targets);
  if (target) return target.priority;
  return kind === "future_opportunity" ? "low" : "medium";
}

function buildQuickWin(
  row: SearchConsoleRow,
  thresholds: Thresholds,
  targets: TargetKeyword[]
): SeoOpportunity {
  const target =
    row.position <= thresholds.top10TargetPosition
      ? thresholds.top3TargetPosition
      : thresholds.top10TargetPosition;
  return {
    kind: "quick_win",
    keyword: row.query,
    page: row.page,
    currentPosition: row.position,
    targetPosition: target,
    recommendedAction: `Optimizar on-page para "${row.query}" en ${row.page}: reforzar el contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno desde paginas relacionadas y actualizar meta title/description. Objetivo: pasar de posicion ${row.position.toFixed(
      1
    )} a top ${target}.`,
    priority: priorityFor("quick_win", row.query, targets),
    risk: "low",
    requiresApproval: true,
    nextReviewDate: nextReviewDate(thresholds.reviewCycleDays),
    evidence: {
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      previousPosition: row.previousPosition,
    },
  };
}

function buildLowCtr(
  row: SearchConsoleRow,
  thresholds: Thresholds,
  targets: TargetKeyword[]
): SeoOpportunity {
  return {
    kind: "low_ctr",
    keyword: row.query,
    page: row.page,
    currentPosition: row.position,
    targetPosition: row.position,
    recommendedAction: `Reescribir meta title y meta description de ${row.page} para "${row.query}" (CTR actual ${(row.ctr * 100).toFixed(
      2
    )}%, muy por debajo del umbral). Probar mensajes mas atractivos (precio, garantia, CTA) y valorar datos estructurados/rich snippets.`,
    priority: priorityFor("low_ctr", row.query, targets),
    risk: "low",
    requiresApproval: true,
    nextReviewDate: nextReviewDate(thresholds.reviewCycleDays),
    evidence: {
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      previousPosition: row.previousPosition,
    },
  };
}

function buildPositionDrop(
  row: SearchConsoleRow,
  thresholds: Thresholds,
  targets: TargetKeyword[]
): SeoOpportunity {
  return {
    kind: "position_drop",
    keyword: row.query,
    page: row.page,
    currentPosition: row.position,
    targetPosition: row.previousPosition ?? thresholds.top10TargetPosition,
    recommendedAction: `Investigar la caida de posicion para "${row.query}" en ${row.page} (de ${row.previousPosition?.toFixed(
      1
    )} a ${row.position.toFixed(
      1
    )}). Revisar cambios recientes de contenido, nueva competencia, perdida de enlaces internos/externos o problemas tecnicos (velocidad, indexacion, canonical).`,
    priority: priorityFor("position_drop", row.query, targets),
    risk: "medium",
    requiresApproval: true,
    nextReviewDate: nextReviewDate(thresholds.reviewCycleDays),
    evidence: {
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      previousPosition: row.previousPosition,
    },
  };
}

function buildFutureOpportunity(
  row: SearchConsoleRow,
  thresholds: Thresholds,
  targets: TargetKeyword[]
): SeoOpportunity {
  return {
    kind: "future_opportunity",
    keyword: row.query,
    page: row.page,
    currentPosition: row.position,
    targetPosition: thresholds.top10TargetPosition,
    recommendedAction: `Oportunidad futura / requiere landing fuerte: crear o reforzar una landing o articulo dedicado para "${row.query}" (posicion actual ${row.position.toFixed(
      1
    )}, fuera de las primeras 3 paginas de resultados). No es un quick win: requiere contenido nuevo robusto, arquitectura de enlazado interno y posible cluster de contenido de soporte.`,
    priority: priorityFor("future_opportunity", row.query, targets),
    risk: "medium",
    requiresApproval: true,
    nextReviewDate: nextReviewDate(thresholds.reviewCycleDays),
    evidence: {
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      previousPosition: row.previousPosition,
    },
  };
}

export function analyzeRow(
  row: SearchConsoleRow,
  thresholds: Thresholds,
  targets: TargetKeyword[]
): SeoOpportunity[] {
  const opportunities: SeoOpportunity[] = [];
  const hasEnoughImpressions = row.impressions >= thresholds.opportunityMinImpressions;

  if (
    hasEnoughImpressions &&
    row.position >= thresholds.opportunityMinPosition &&
    row.position <= thresholds.opportunityMaxPosition
  ) {
    opportunities.push(buildQuickWin(row, thresholds, targets));
  }

  if (hasEnoughImpressions && row.position > thresholds.futureOpportunityMinPosition) {
    opportunities.push(buildFutureOpportunity(row, thresholds, targets));
  }

  if (hasEnoughImpressions && row.ctr < thresholds.lowCtrThreshold) {
    opportunities.push(buildLowCtr(row, thresholds, targets));
  }

  if (
    row.previousPosition !== undefined &&
    row.position - row.previousPosition >= thresholds.positionDropAlertDelta
  ) {
    opportunities.push(buildPositionDrop(row, thresholds, targets));
  }

  return opportunities;
}

export interface SeoWatcherRunResult {
  runId: string;
  departmentRunId: string;
  jobs: SeoJob[];
  rowsRead: number;
  reportPath: string;
}

function dedupeKey(opportunity: SeoOpportunity): string {
  return `${opportunity.kind}|${normalize(opportunity.keyword)}|${opportunity.page}`;
}

export async function runSeoWatcher(departmentRunId?: string): Promise<SeoWatcherRunResult> {
  const dataSource = resolveDataSource();
  const runId = buildRunId();
  const deptRunId = departmentRunId ?? buildDepartmentRunId();
  logger.info("SEO Watcher Agent iniciado", { mode: AGENT_MODE, dataSource, runId, departmentRunId: deptRunId });
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_started",
    summary: "SEO Watcher Agent iniciado",
    payload: { runId, dataSource },
  });

  const thresholds = loadThresholds();
  const targets = loadTargetKeywords();
  const { rows, siteUrl, analysisStartDate, analysisEndDate } = await getSeoData();

  logger.info(`Filas de datos SEO cargadas: ${rows.length}`, {
    dataSource,
    siteUrl,
    analysisStartDate,
    analysisEndDate,
  });

  const meta: SeoJobMeta = { runId, analysisStartDate, analysisEndDate, siteUrl, dataSource };

  // Evita duplicados EXACTOS (mismo tipo+keyword+pagina) dentro de esta
  // misma ejecucion. No toca el historico ya escrito en jobs.jsonl.
  const seenInThisRun = new Set<string>();
  const jobsThisRun: SeoJob[] = [];

  for (const row of rows) {
    const opportunities = analyzeRow(row, thresholds, targets);
    for (const opportunity of opportunities) {
      const key = dedupeKey(opportunity);
      if (seenInThisRun.has(key)) {
        logger.info("Oportunidad duplicada omitida en esta ejecucion", {
          kind: opportunity.kind,
          keyword: opportunity.keyword,
          page: opportunity.page,
        });
        continue;
      }
      seenInThisRun.add(key);

      const job = createJob(opportunity, AGENT_MODE, meta);
      appendJob(job);
      jobsThisRun.push(job);
      logger.info(`Tarea propuesta creada: ${job.title}`, {
        jobId: job.id,
        runId,
        kind: opportunity.kind,
        priority: opportunity.priority,
        requiresApproval: opportunity.requiresApproval,
      });
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "opportunity_detected",
        priority: opportunity.priority,
        summary: job.title,
        payload: {
          jobId: job.id,
          kind: opportunity.kind,
          keyword: opportunity.keyword,
          page: opportunity.page,
          currentPosition: opportunity.currentPosition,
          targetPosition: opportunity.targetPosition,
        },
      });
    }
  }

  const reportPath = writeReport({
    runId,
    generatedAt: new Date().toISOString(),
    dataSource,
    siteUrl,
    analysisStartDate,
    analysisEndDate,
    rowsRead: rows.length,
    jobs: jobsThisRun,
  });

  logger.info(
    `SEO Watcher Agent finalizado. Oportunidades detectadas: ${jobsThisRun.length}. Jobs escritos en: ${getJobsFilePath()}. Informe: ${reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `SEO Watcher Agent finalizado: ${jobsThisRun.length} oportunidad(es) detectada(s)`,
    payload: { runId, rowsRead: rows.length, jobsCreated: jobsThisRun.length, reportPath },
  });

  return { runId, departmentRunId: deptRunId, jobs: jobsThisRun, rowsRead: rows.length, reportPath };
}
