import * as dotenv from "dotenv";
dotenv.config();
import { runSeoStrategyClusteringAgent, planCarrilATasks } from "../src/agents/seo-strategy-clustering-agent";
import { SeoCluster } from "../src/core/types";

/**
 * Fase O29 -- ejecuta el SEO Strategy & Keyword Clustering Agent sobre
 * el backlog REAL (data/action-backlog.jsonl), persiste los clusters en
 * data/seo-clusters.jsonl y muestra un informe legible en consola.
 *
 * Esto NO toca produccion, NO publica nada, NO ejecuta ningun deploy ni
 * batch de Carril A -- solo lee action-backlog.jsonl/visual-qa-approvals.jsonl
 * y escribe en el registro nuevo seo-clusters.jsonl.
 *
 * Uso: npx ts-node scripts/o29-run-seo-clustering.ts
 */

function fmtPct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}

function main(): void {
  const { clusters, newClusterCount, updatedClusterCount, unmatchedKeywordCount } = runSeoStrategyClusteringAgent();

  console.log(`\n=== O29 -- SEO Strategy & Keyword Clustering Agent ===`);
  console.log(`Clusters totales: ${clusters.length} (nuevos: ${newClusterCount}, actualizados: ${updatedClusterCount})`);
  console.log(`Keywords sin clasificar en el catalogo (fallback singleton): ${unmatchedKeywordCount}`);

  const totalActions = clusters.reduce((sum, c) => sum + c.coveredActionIds.length, 0);
  const totalDuplicates = clusters.reduce((sum, c) => sum + c.duplicateActionCount, 0);
  console.log(`\nBacklog cubierto: ${totalActions} actionIds -> ${clusters.length} clusters (${totalDuplicates} actionIds duplicados que se pueden cerrar una vez se actue sobre el cluster, ${fmtPct(totalDuplicates, totalActions)} del backlog).`);

  const byStatus = new Map<string, number>();
  for (const c of clusters) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
  console.log(`\n-- Por estado --`);
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  const byPriority = new Map<string, number>();
  for (const c of clusters) byPriority.set(c.priority, (byPriority.get(c.priority) ?? 0) + 1);
  console.log(`\n-- Por prioridad --`);
  for (const [priority, count] of [...byPriority.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${priority}: ${count}`);
  }

  const cannibalized = clusters.filter((c) => c.cannibalizationRisk === "alto");
  console.log(`\n-- Canibalizacion detectada (riesgo alto): ${cannibalized.length} --`);
  for (const c of cannibalized) {
    console.log(`  [${c.clusterId.slice(0, 18)}...] "${c.label}" -- ${c.metrics.distinctTargetPages} paginas distintas objetivo, ${c.keywords.length} keywords, ${c.coveredActionIds.length} actionIds`);
  }

  console.log(`\n-- Detalle completo por cluster --`);
  const sorted = [...clusters].sort((a, b) => b.priorityScore - a.priorityScore);
  for (const c of sorted) {
    printCluster(c);
  }

  const tasks = planCarrilATasks(clusters);
  const byCategory = new Map<string, number>();
  for (const t of tasks) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
  console.log(`\n=== Interfaz Carril A (diseñada, NO ejecutada en esta fase) ===`);
  console.log(`Tareas limpias que Carril A podria recibir en el futuro: ${tasks.length}`);
  for (const [category, count] of byCategory.entries()) {
    console.log(`  ${category}: ${count}`);
  }

  const rejectedOrPostponed = clusters.filter((c) => c.status === "rejected" || c.status === "postponed");
  console.log(`\n=== Tareas antiguas del backlog que quedan cubiertas por clusters rechazados/pospuestos (no se deben ejecutar) ===`);
  for (const c of rejectedOrPostponed) {
    console.log(`  "${c.label}" (${c.status}) -- ${c.coveredActionIds.length} actionIds cubiertos, razon: ${c.reason.slice(0, 140)}...`);
  }

  console.log(`\nOK -- no se ha tocado produccion, no se ha publicado nada, no se ha ejecutado ningun batch de Carril A.`);
}

function printCluster(c: SeoCluster): void {
  console.log(`\n[${c.priority.toUpperCase()} | score ${c.priorityScore} | ${c.status}] ${c.label}`);
  console.log(`  clusterId: ${c.clusterId}`);
  console.log(`  keywords (${c.keywords.length}): ${c.keywords.join(" | ")}`);
  console.log(`  intencion: ${c.searchIntent} | accion: ${c.action} | canibalizacion: ${c.cannibalizationRisk}`);
  console.log(`  URL objetivo: ${c.targetUrl ?? "(sin URL)"}${c.targetPageId ? ` (pageId ${c.targetPageId})` : ""}`);
  if (c.relatedStagingPageIds.length > 0) console.log(`  staging relacionado: ${c.relatedStagingPageIds.join(", ")}`);
  console.log(`  metrics: maxImpressions=${c.metrics.maxImpressions}, bestPosition=${c.metrics.bestPosition ?? "n/a"}, distinctTargetPages=${c.metrics.distinctTargetPages}`);
  console.log(`  actionIds cubiertos: ${c.coveredActionIds.length} (duplicados a cerrar: ${c.duplicateActionCount})`);
  console.log(`  motivo: ${c.reason}`);
}

main();
