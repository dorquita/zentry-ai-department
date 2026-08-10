import * as fs from "fs";
import * as path from "path";
import { OpportunityKind, Priority, SeoDataSource, SeoJob } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "seo");

export interface ReportInput {
  runId: string;
  generatedAt: string;
  dataSource: SeoDataSource;
  siteUrl: string;
  analysisStartDate: string;
  analysisEndDate: string;
  rowsRead: number;
  jobs: SeoJob[]; // jobs de ESTA ejecucion (ya deduplicados)
}

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const KIND_ORDER: OpportunityKind[] = [
  "quick_win",
  "low_ctr",
  "position_drop",
  "future_opportunity",
];
const KIND_LABEL: Record<OpportunityKind, string> = {
  quick_win: "Quick win",
  low_ctr: "CTR bajo",
  position_drop: "Caida de posicion",
  future_opportunity: "Oportunidad futura",
};

function countByKind(jobs: SeoJob[]): Record<OpportunityKind, number> {
  const counts: Record<OpportunityKind, number> = {
    quick_win: 0,
    low_ctr: 0,
    position_drop: 0,
    future_opportunity: 0,
  };
  for (const job of jobs) counts[job.opportunity.kind]++;
  return counts;
}

function topOpportunities(jobs: SeoJob[], limit: number): SeoJob[] {
  return [...jobs]
    .sort((a, b) => {
      const rankDiff = PRIORITY_RANK[b.opportunity.priority] - PRIORITY_RANK[a.opportunity.priority];
      if (rankDiff !== 0) return rankDiff;
      return b.opportunity.evidence.impressions - a.opportunity.evidence.impressions;
    })
    .slice(0, limit);
}

function buildRecommendations(jobs: SeoJob[], counts: Record<OpportunityKind, number>): string[] {
  const recs: string[] = [];
  const highCount = jobs.filter((j) => j.opportunity.priority === "high").length;

  if (highCount > 0) {
    recs.push(
      `Revisar y aprobar manualmente las ${highCount} tarea(s) de prioridad **high** en \`data/jobs.jsonl\` antes de mover cualquiera a ejecucion real.`
    );
  }
  if (counts.quick_win > 0) {
    recs.push(
      `Priorizar las ${counts.quick_win} oportunidad(es) \`quick_win\`: son las de menor esfuerzo y mayor probabilidad de impacto a corto plazo (posicion 8-30, cerca de primera pagina).`
    );
  }
  if (counts.position_drop > 0) {
    recs.push(
      `Investigar cuanto antes las ${counts.position_drop} caida(s) de posicion (\`position_drop\`): pueden indicar un problema tecnico o de contenido reciente, no solo falta de optimizacion.`
    );
  }
  if (counts.future_opportunity > 0) {
    recs.push(
      `Planificar contenido nuevo (landing/articulo) para las ${counts.future_opportunity} oportunidad(es) \`future_opportunity\`: no son quick wins, requieren inversion de contenido a medio plazo.`
    );
  }
  if (counts.low_ctr > 0) {
    recs.push(
      `Revisar meta title/description en las ${counts.low_ctr} pagina(s) con CTR bajo (\`low_ctr\`): a menudo es la mejora mas barata de aplicar.`
    );
  }
  recs.push(
    "Ninguna tarea de este informe se ejecuta sola: todas quedan en `data/jobs.jsonl` como propuestas, pendientes de revision y aprobacion humana (ver `docs/approval-policy.md`)."
  );
  return recs;
}

export function buildReportMarkdown(input: ReportInput): string {
  const counts = countByKind(input.jobs);
  const highCount = input.jobs.filter((j) => j.opportunity.priority === "high").length;
  const mediumCount = input.jobs.filter((j) => j.opportunity.priority === "medium").length;
  const lowCount = input.jobs.filter((j) => j.opportunity.priority === "low").length;
  const top = topOpportunities(input.jobs, 10);
  const recommendations = buildRecommendations(input.jobs, counts);
  const executionDate = input.generatedAt.slice(0, 10);

  const lines: string[] = [];
  lines.push(`# Informe SEO Watcher — ${executionDate}`);
  lines.push("");
  lines.push(`- **runId:** \`${input.runId}\``);
  lines.push(`- **Generado:** ${input.generatedAt}`);
  lines.push(`- **Fuente de datos:** \`${input.dataSource}\``);
  lines.push(`- **Sitio:** \`${input.siteUrl}\``);
  lines.push(`- **Rango analizado:** ${input.analysisStartDate} a ${input.analysisEndDate}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se analizaron **${input.rowsRead}** fila(s) de rendimiento SEO (\`${input.dataSource}\`) y se detectaron **${input.jobs.length}** oportunidad(es): **${highCount}** de prioridad alta, **${mediumCount}** de prioridad media y **${lowCount}** de prioridad baja. Ninguna se ha ejecutado — todas quedan como tareas propuestas en \`data/jobs.jsonl\`, pendientes de revision y aprobacion humana.`
  );
  lines.push("");

  lines.push("## Filas leidas y oportunidades");
  lines.push("");
  lines.push("| Metrica | Valor |");
  lines.push("|---|---|");
  lines.push(`| Filas leidas | ${input.rowsRead} |`);
  lines.push(`| Oportunidades detectadas | ${input.jobs.length} |`);
  lines.push("");

  lines.push("## Oportunidades por tipo");
  lines.push("");
  lines.push("| Tipo | Cantidad |");
  lines.push("|---|---|");
  for (const kind of KIND_ORDER) {
    lines.push(`| ${KIND_LABEL[kind]} (\`${kind}\`) | ${counts[kind]} |`);
  }
  lines.push("");

  lines.push(`## Top ${top.length} oportunidades priorizadas`);
  lines.push("");
  if (top.length === 0) {
    lines.push("No se detectaron oportunidades en esta ejecucion.");
  } else {
    top.forEach((job, i) => {
      const o = job.opportunity;
      lines.push(
        `### ${i + 1}. [${o.priority}] "${o.keyword}" — ${KIND_LABEL[o.kind]} (\`${o.kind}\`)`
      );
      lines.push("");
      lines.push(`- **Pagina:** ${o.page}`);
      lines.push(`- **Posicion actual:** ${o.currentPosition.toFixed(1)} → **Objetivo:** ${o.targetPosition}`);
      lines.push(
        `- **Evidencia:** ${o.evidence.impressions} impresiones, ${o.evidence.clicks} clics, CTR ${(o.evidence.ctr * 100).toFixed(2)}%${o.evidence.previousPosition !== undefined ? `, posicion anterior ${o.evidence.previousPosition.toFixed(1)}` : ""}`
      );
      lines.push(`- **Accion recomendada:** ${o.recommendedAction}`);
      lines.push(
        `- **Riesgo:** ${o.risk} · **Requiere aprobacion:** ${o.requiresApproval ? "si" : "no"} · **Siguiente revision:** ${o.nextReviewDate}`
      );
      lines.push("");
    });
  }

  lines.push("## Recomendaciones siguientes");
  lines.push("");
  for (const rec of recommendations) lines.push(`- ${rec}`);
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- No se ha ejecutado ningun cambio SEO real; este agente solo audita y propone.");
  lines.push("- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.");
  lines.push("");

  return lines.join("\n");
}

export function writeReport(input: ReportInput): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  // Nombre del fichero = fecha de EJECUCION (hoy), no la fecha de analisis
  // (que en real puede ser "ayer"). Si se ejecuta mas de una vez el mismo
  // dia, el informe de ese dia se sobrescribe con la ejecucion mas reciente
  // (el runId completo, con hora, queda dentro del contenido del informe).
  const executionDate = input.generatedAt.slice(0, 10);
  const fileName = `seo-watcher-${executionDate}.md`;
  const filePath = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(filePath, buildReportMarkdown(input), "utf-8");
  return filePath;
}
