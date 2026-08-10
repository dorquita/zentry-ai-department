import * as fs from "fs";
import * as path from "path";
import { classifyKeyword, classifyOpportunity, BRAND_INTENT_CATEGORY_LABELS } from "../core/brand-intent-router";
import { readAllJobs } from "../core/job-registry";
import { emitEvent, readAllEvents } from "../core/department-events";
import { buildDepartmentRunId } from "../core/department-run-id";
import { logger } from "../core/logger";
import { BrandTarget, DepartmentEvent, Priority } from "../core/types";
import { ActionItem, buildActionPlan } from "./seo-director";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Content Planner Agent — READ + PROPOSE only. Nunca escribe en WordPress:
 * solo genera un informe con propuestas de contenido y eventos internos.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "content-planner");
const AGENT_NAME = "content-planner";

export type ContentType =
  | "article"
  | "faq"
  | "landing_block"
  | "title_meta_improvement"
  | "internal_link"
  | "new_landing";

export type ContentTargetBrand = "zentry" | "tukandado" | "mixed";

export interface ContentPlanItem {
  type: ContentType;
  targetBrand: ContentTargetBrand;
  title: string;
  relatedKeyword: string;
  relatedPage?: string;
  rationale: string;
  source: "seo_watcher" | "seo_director" | "competitor_intelligence";
  priority: Priority;
}

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  article: "Articulo nuevo",
  faq: "FAQ",
  landing_block: "Bloque nuevo para landing",
  title_meta_improvement: "Mejora de title/meta",
  internal_link: "Enlace interno",
  new_landing: "Landing nueva",
};

function brandTargetToContentBrand(brand: BrandTarget): ContentTargetBrand {
  if (brand === "zentry") return "zentry";
  if (brand === "tukandado") return "tukandado";
  return "mixed"; // "both" o "none" (ya filtrado antes de llegar aqui)
}

function itemsFromSeoDirector(actionItems: ActionItem[]): ContentPlanItem[] {
  const results: ContentPlanItem[] = [];

  for (const action of actionItems) {
    const intent = classifyOpportunity({ keyword: action.keyword, page: action.page });
    const targetBrand = brandTargetToContentBrand(intent.brand);
    const brandNote = `Clasificacion de marca: ${BRAND_INTENT_CATEGORY_LABELS[intent.category]} — ${intent.reason}`;

    if (action.requiresNewContent) {
      results.push({
        type: "new_landing",
        targetBrand,
        title: `Landing/articulo dedicado: "${action.keyword}"`,
        relatedKeyword: action.keyword,
        relatedPage: action.page,
        rationale: `${action.rationale} ${brandNote}`,
        source: "seo_director",
        priority: action.priority,
      });
    }

    if (action.kinds.includes("low_ctr")) {
      results.push({
        type: "title_meta_improvement",
        targetBrand,
        title: `Mejorar title/meta de ${action.page}`,
        relatedKeyword: action.keyword,
        relatedPage: action.page,
        rationale: `CTR bajo detectado para "${action.keyword}"; reescribir title/meta suele ser la mejora mas barata. ${brandNote}`,
        source: "seo_director",
        priority: action.priority,
      });
    }

    if (action.kinds.includes("quick_win")) {
      results.push({
        type: "internal_link",
        targetBrand,
        title: `Reforzar enlazado interno hacia ${action.page}`,
        relatedKeyword: action.keyword,
        relatedPage: action.page,
        rationale: `"${action.keyword}" esta cerca de primera pagina (quick win); enlazado interno desde paginas relacionadas ayuda a empujar la posicion. ${brandNote}`,
        source: "seo_director",
        priority: action.priority,
      });
    }
  }

  return results;
}

interface CompetitorKeywordPayload {
  [key: string]: unknown;
  gapType: "keyword";
  term: string;
  frequency: number;
  sourceCompetitors: string[];
  suggestedForSem: boolean;
}

interface CompetitorContentPayload {
  [key: string]: unknown;
  gapType: "content";
  term: string;
  contentKind: "sector" | "material";
  sourceCompetitors: string[];
}

function isCompetitorKeywordPayload(p: Record<string, unknown>): p is CompetitorKeywordPayload {
  return p.gapType === "keyword";
}

function isCompetitorContentPayload(p: Record<string, unknown>): p is CompetitorContentPayload {
  return p.gapType === "content";
}

/**
 * Competitor Intelligence no expone una funcion pura reutilizable (implica
 * llamadas de red), asi que aqui se lee su ultima ejecucion via el bus de
 * eventos (data/department-events.jsonl) en vez de releer HTML.
 */
function getLatestCompetitorIntelEvents(): DepartmentEvent[] {
  const events = readAllEvents().filter(
    (e) => e.agent === "competitor-intelligence" && e.type === "competitor_keyword_detected"
  );
  if (events.length === 0) return [];
  const latestRunId = events.reduce(
    (max, e) => (e.departmentRunId > max ? e.departmentRunId : max),
    events[0].departmentRunId
  );
  return events.filter((e) => e.departmentRunId === latestRunId);
}

function itemsFromCompetitorIntelligence(events: DepartmentEvent[]): ContentPlanItem[] {
  const results: ContentPlanItem[] = [];

  for (const event of events) {
    const payload = event.payload;

    if (isCompetitorKeywordPayload(payload)) {
      const intent = classifyKeyword(payload.term);
      if (intent.category === "irrelevant_or_low_fit") continue;
      results.push({
        type: payload.suggestedForSem ? "landing_block" : "article",
        targetBrand: brandTargetToContentBrand(intent.brand),
        title: `Contenido nuevo para "${payload.term}"`,
        relatedKeyword: payload.term,
        rationale: `La competencia (${payload.sourceCompetitors.join(", ")}) trabaja esta keyword y no esta cubierta hoy. ${intent.reason}`,
        source: "competitor_intelligence",
        priority: payload.suggestedForSem ? "high" : "medium",
      });
    } else if (isCompetitorContentPayload(payload)) {
      results.push({
        type: "new_landing",
        targetBrand: "zentry",
        title: `Landing para "${payload.term}" (${payload.contentKind})`,
        relatedKeyword: payload.term,
        rationale: `La competencia (${payload.sourceCompetitors.join(", ")}) cubre este ${payload.contentKind === "sector" ? "sector" : "material"} y Zentry no tiene keyword objetivo equivalente todavia.`,
        source: "competitor_intelligence",
        priority: "medium",
      });
    }
  }

  return results;
}

function dedupeItems(items: ContentPlanItem[]): ContentPlanItem[] {
  const seen = new Set<string>();
  const result: ContentPlanItem[] = [];
  for (const item of items) {
    const key = `${item.type}|${item.relatedKeyword.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const BRAND_ORDER: ContentTargetBrand[] = ["zentry", "tukandado", "mixed"];
const BRAND_LABELS: Record<ContentTargetBrand, string> = {
  zentry: "Contenido para Zentry",
  tukandado: "Contenido para Tukandado",
  mixed: "Contenido mixto / cross-sell",
};

export interface ContentPlannerReportInput {
  departmentRunId: string;
  generatedAt: string;
  items: ContentPlanItem[];
}

function buildReportMarkdown(input: ContentPlannerReportInput): string {
  const executionDate = input.generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Plan de contenido — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${input.departmentRunId}\``);
  lines.push(`- **Generado:** ${input.generatedAt}`);
  lines.push(`- **Propuestas de contenido:** ${input.items.length}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se generaron **${input.items.length}** propuesta(s) de contenido a partir de las oportunidades del SEO Watcher/Director y de los gaps detectados por Competitor Intelligence, clasificadas por marca con el Brand/Intent Router. Ninguna se ha escrito en WordPress: son propuestas para revisar y priorizar.`
  );
  lines.push("");

  for (const brand of BRAND_ORDER) {
    const brandItems = input.items
      .filter((i) => i.targetBrand === brand)
      .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
    lines.push(`## ${BRAND_LABELS[brand]} (${brandItems.length})`);
    lines.push("");
    if (brandItems.length === 0) {
      lines.push("Sin propuestas en esta categoria.");
      lines.push("");
      continue;
    }
    for (const item of brandItems) {
      lines.push(`### [${item.priority}] ${CONTENT_TYPE_LABELS[item.type]} — ${item.title}`);
      lines.push("");
      lines.push(`- **Keyword relacionada:** ${item.relatedKeyword}`);
      if (item.relatedPage) lines.push(`- **Pagina relacionada:** ${item.relatedPage}`);
      lines.push(`- **Por que:** ${item.rationale}`);
      lines.push(`- **Origen:** ${item.source}`);
      lines.push("");
    }
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha escrito ni publicado nada en WordPress.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee jobs/informes/eventos existentes y propone.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(input: ContentPlannerReportInput): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = input.generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `content-planner-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(input), "utf-8");
  return filePath;
}

export interface ContentPlannerRunResult {
  departmentRunId: string;
  items: ContentPlanItem[];
  reportPath: string;
}

export async function runContentPlanner(departmentRunId?: string): Promise<ContentPlannerRunResult> {
  const deptRunId = departmentRunId ?? buildDepartmentRunId();
  logger.info("Content Planner Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_started",
    summary: "Content Planner Agent iniciado",
  });

  const jobs = readAllJobs();
  const latestRunId = jobs.reduce<string | undefined>(
    (max, j) => (!max || j.meta.runId > max ? j.meta.runId : max),
    undefined
  );
  const latestRunJobs = latestRunId ? jobs.filter((j) => j.meta.runId === latestRunId) : [];
  const seoDirectorItems = buildActionPlan(latestRunJobs);

  const competitorEvents = getLatestCompetitorIntelEvents();

  const items = dedupeItems([
    ...itemsFromSeoDirector(seoDirectorItems),
    ...itemsFromCompetitorIntelligence(competitorEvents),
  ]);

  for (const item of items) {
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "recommendation_created",
      priority: item.priority,
      summary: `[${item.targetBrand}] ${CONTENT_TYPE_LABELS[item.type]}: ${item.title}`,
      payload: { ...item } as unknown as Record<string, unknown>,
    });
  }

  if (competitorEvents.length === 0) {
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "warning_detected",
      priority: "low",
      summary: "No se encontraron eventos de Competitor Intelligence; el plan se baso solo en SEO Watcher/Director.",
    });
  }

  const generatedAt = new Date().toISOString();
  const reportPath = writeReport({ departmentRunId: deptRunId, generatedAt, items });

  logger.info(`Content Planner Agent finalizado. Propuestas: ${items.length}. Informe: ${reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Content Planner Agent finalizado: ${items.length} propuesta(s) de contenido`,
    payload: { itemCount: items.length, reportPath },
  });

  return { departmentRunId: deptRunId, items, reportPath };
}
