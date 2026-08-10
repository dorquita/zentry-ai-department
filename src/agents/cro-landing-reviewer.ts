import * as fs from "fs";
import * as path from "path";
import { classifyOpportunity, BRAND_INTENT_CATEGORY_LABELS } from "../core/brand-intent-router";
import { readAllJobs } from "../core/job-registry";
import { emitEvent } from "../core/department-events";
import { buildDepartmentRunId } from "../core/department-run-id";
import { logger } from "../core/logger";
import { BrandIntentCategory, Priority, SeoJob } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * CRO / Landing Reviewer Agent — READ + PROPOSE only. Nunca escribe en
 * WordPress: solo lee oportunidades ya detectadas y propone mejoras de
 * conversion por landing.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "cro");
const AGENT_NAME = "cro-landing-reviewer";

export type CroArea = "cta" | "formulario" | "faq" | "confianza" | "estructura_visual" | "enlaces_internos";

export interface CroRecommendation {
  area: CroArea;
  recommendation: string;
}

export interface LandingReview {
  page: string;
  primaryKeywords: string[];
  brandCategory: BrandIntentCategory;
  brandReason: string;
  opportunityKinds: string[];
  priority: Priority;
  recommendations: CroRecommendation[];
}

const AREA_LABELS: Record<CroArea, string> = {
  cta: "CTA",
  formulario: "Formulario",
  faq: "FAQ",
  confianza: "Bloques de confianza",
  estructura_visual: "Estructura visual",
  enlaces_internos: "Enlaces internos",
};

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

function priorityFromJobs(jobs: SeoJob[]): Priority {
  return jobs.reduce<Priority>(
    (max, j) => (PRIORITY_RANK[j.opportunity.priority] > PRIORITY_RANK[max] ? j.opportunity.priority : max),
    "low"
  );
}

/**
 * Reglas deterministas de CRO segun la intencion de marca detectada para
 * la landing. No son ejecutables: son propuestas para que una persona las
 * revise e implemente.
 */
function recommendationsFor(category: BrandIntentCategory, hasB2bSignal: boolean): CroRecommendation[] {
  const recs: CroRecommendation[] = [];

  switch (category) {
    case "zentry_locker_core":
      recs.push({
        area: "cta",
        recommendation: 'CTA principal orientado a "Solicitar presupuesto" o "Configurar mi taquilla", no solo "Contactar".',
      });
      recs.push({
        area: "formulario",
        recommendation: "Formulario corto con selector de cantidad/medidas/material para acelerar el presupuesto.",
      });
      recs.push({
        area: "estructura_visual",
        recommendation: "Tabla comparativa de materiales (metalica/fenolica/melamina) si la pagina no la tiene ya.",
      });
      break;
    case "zentry_smart_locker":
      recs.push({
        area: "cta",
        recommendation: 'CTA que ofrezca explicitamente la solucion completa: "Taquilla + cerradura inteligente", no solo el mueble.',
      });
      recs.push({
        area: "enlaces_internos",
        recommendation: "Enlazar desde/hacia contenido de cerraduras inteligentes (Tukandado) para reforzar la venta cruzada.",
      });
      recs.push({
        area: "confianza",
        recommendation: "Bloque de confianza especifico sobre la parte tecnologica (garantia de la cerradura, casos de exito de digitalizacion).",
      });
      break;
    case "tukandado_lock_core":
      recs.push({
        area: "cta",
        recommendation: 'CTA orientado a integradores/fabricantes: "Hablar con un tecnico" o "Solicitar ficha tecnica", no un CTA generico de venta al por menor.',
      });
      recs.push({
        area: "formulario",
        recommendation: "Formulario B2B con campo de volumen/proyecto, no solo contacto simple.",
      });
      recs.push({
        area: "enlaces_internos",
        recommendation: "Enlazar hacia el catalogo de taquillas de Zentry para los visitantes que en realidad quieren el mueble completo.",
      });
      break;
    case "mixed_cross_sell":
      recs.push({
        area: "estructura_visual",
        recommendation: "Landing ambigua: aclarar arriba del todo si el visitante busca mueble, cerradura o ambos, con dos CTAs diferenciados.",
      });
      break;
    case "irrelevant_or_low_fit":
      recs.push({
        area: "estructura_visual",
        recommendation: "Trafico de bajo valor esperado; no priorizar CRO aqui hasta revisar si merece la pena mantener la pagina indexada.",
      });
      break;
  }

  // FAQ y confianza son casi siempre utiles, salvo trafico irrelevante.
  if (category !== "irrelevant_or_low_fit") {
    recs.push({
      area: "faq",
      recommendation: "Anadir/revisar seccion de FAQ (plazos de entrega, garantia, instalacion) — reduce friccion antes del formulario.",
    });
  }

  if (hasB2bSignal) {
    recs.push({
      area: "confianza",
      recommendation: "Bloque de logos/casos de exito de clientes B2B (empresas, centros deportivos, colegios) si el sector aplica a esta landing.",
    });
  }

  return recs;
}

function buildLandingReviews(jobs: SeoJob[]): LandingReview[] {
  const byPage = new Map<string, SeoJob[]>();
  for (const job of jobs) {
    const list = byPage.get(job.opportunity.page) ?? [];
    list.push(job);
    byPage.set(job.opportunity.page, list);
  }

  const reviews: LandingReview[] = [];
  for (const [page, pageJobs] of byPage.entries()) {
    const primaryKeywords = [...new Set(pageJobs.map((j) => j.opportunity.keyword))];
    const intent = classifyOpportunity({ keyword: primaryKeywords[0], page });
    const opportunityKinds = [...new Set(pageJobs.map((j) => j.opportunity.kind))];

    reviews.push({
      page,
      primaryKeywords,
      brandCategory: intent.category,
      brandReason: intent.reason,
      opportunityKinds,
      priority: priorityFromJobs(pageJobs),
      recommendations: recommendationsFor(intent.category, intent.signals.matchedB2bSectors.length > 0),
    });
  }

  return reviews.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
}

export interface CroReviewReportInput {
  departmentRunId: string;
  generatedAt: string;
  reviews: LandingReview[];
}

function buildReportMarkdown(input: CroReviewReportInput): string {
  const executionDate = input.generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# CRO / Landing Review — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${input.departmentRunId}\``);
  lines.push(`- **Generado:** ${input.generatedAt}`);
  lines.push(`- **Landings revisadas:** ${input.reviews.length}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se revisaron ${input.reviews.length} landing(s) afectadas por oportunidades SEO/contenido detectadas, y se propusieron mejoras de conversion diferenciando si el visitante busca mueble (Zentry), cerradura (Tukandado) o la solucion completa. Ninguna propuesta se ha aplicado: requieren revision humana antes de tocar WordPress.`
  );
  lines.push("");

  for (const review of input.reviews) {
    lines.push(`## [${review.priority}] ${review.page}`);
    lines.push("");
    lines.push(`- **Keywords relacionadas:** ${review.primaryKeywords.join(", ")}`);
    lines.push(`- **Intencion detectada:** ${BRAND_INTENT_CATEGORY_LABELS[review.brandCategory]} — ${review.brandReason}`);
    lines.push(`- **Oportunidades que la afectan:** ${review.opportunityKinds.join(", ")}`);
    lines.push("- **Recomendaciones CRO:**");
    for (const rec of review.recommendations) {
      lines.push(`  - **${AREA_LABELS[rec.area]}:** ${rec.recommendation}`);
    }
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress ni ninguna landing.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee oportunidades existentes y propone.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(input: CroReviewReportInput): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = input.generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `cro-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(input), "utf-8");
  return filePath;
}

export interface CroLandingReviewerRunResult {
  departmentRunId: string;
  reviews: LandingReview[];
  reportPath: string;
}

export async function runCroLandingReviewer(departmentRunId?: string): Promise<CroLandingReviewerRunResult> {
  const deptRunId = departmentRunId ?? buildDepartmentRunId();
  logger.info("CRO / Landing Reviewer Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_started",
    summary: "CRO / Landing Reviewer Agent iniciado",
  });

  const jobs = readAllJobs();
  const latestRunId = jobs.reduce<string | undefined>(
    (max, j) => (!max || j.meta.runId > max ? j.meta.runId : max),
    undefined
  );
  const latestRunJobs = latestRunId ? jobs.filter((j) => j.meta.runId === latestRunId) : [];

  const reviews = buildLandingReviews(latestRunJobs);

  for (const review of reviews) {
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "recommendation_created",
      priority: review.priority,
      summary: `CRO: ${review.page} (${review.recommendations.length} recomendacion(es))`,
      payload: { ...review } as unknown as Record<string, unknown>,
    });
  }

  const generatedAt = new Date().toISOString();
  const reportPath = writeReport({ departmentRunId: deptRunId, generatedAt, reviews });

  logger.info(`CRO / Landing Reviewer Agent finalizado. Landings revisadas: ${reviews.length}. Informe: ${reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `CRO / Landing Reviewer Agent finalizado: ${reviews.length} landing(s) revisada(s)`,
    payload: { reviewCount: reviews.length, reportPath },
  });

  return { departmentRunId: deptRunId, reviews, reportPath };
}
