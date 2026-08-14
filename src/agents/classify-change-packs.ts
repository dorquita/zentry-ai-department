import { readCurrentChangePacks } from "../core/change-packs";
import { runSeoStrategyClusteringAgent, resolveCatalogEntryForKeyword } from "./seo-strategy-clustering-agent";
import { readCurrentStagingExecutions } from "../core/staging-executions";
import { SeoCluster } from "../core/types";

/**
 * Fase O30 -- clasifica los change packs "ready_for_review" contra los
 * clusters SEO para decidir cuales son seguros de promocionar y cuales
 * son duplicados de staging ya existente / pertenecen a un cluster
 * rechazado. Funcion pura de solo lectura, compartida entre el script
 * de informe (scripts/o30-classify-change-packs.ts) y el script que
 * aplica los cierres (scripts/o30-apply-classification.ts) -- para que
 * ambos usen exactamente la misma logica.
 */

export type ChangePackVerdict = "eligible" | "supersede_duplicate" | "reject_cluster" | "unmatched";

export interface ClassifiedChangePack {
  changePackId: string;
  changeType: string;
  keyword: string;
  page?: string;
  priority: string;
  clusterLabel: string;
  clusterStatus?: string;
  clusterAction?: string;
  relatedStagingPageIds: number[];
  verdict: ChangePackVerdict;
  reason: string;
}

export function classifyReadyForReviewChangePacks(): { results: ClassifiedChangePack[]; clusters: SeoCluster[] } {
  const { clusters } = runSeoStrategyClusteringAgent();
  const clusterByLabel = new Map(clusters.map((c) => [c.label, c]));

  const changePacks = readCurrentChangePacks().filter((cp) => cp.status === "ready_for_review");
  const executions = readCurrentStagingExecutions();
  const appliedCanonicalKeys = new Set(
    executions.filter((e) => e.status === "applied_to_staging" && e.wordpressPageId).map((e) => e.canonicalKey)
  );

  const results: ClassifiedChangePack[] = [];

  for (const cp of changePacks) {
    const catalogMatch = resolveCatalogEntryForKeyword(cp.keyword);
    if (!catalogMatch) {
      results.push({
        changePackId: cp.changePackId,
        changeType: cp.changeType,
        keyword: cp.keyword,
        page: cp.page,
        priority: cp.priority,
        clusterLabel: "(sin cluster)",
        relatedStagingPageIds: [],
        verdict: "unmatched",
        reason: "Keyword no reconocida en el catalogo de clusters -- no promocionar sin revision manual.",
      });
      continue;
    }

    const cluster = clusterByLabel.get(catalogMatch.label);
    if (!cluster) {
      results.push({
        changePackId: cp.changePackId,
        changeType: cp.changeType,
        keyword: cp.keyword,
        page: cp.page,
        priority: cp.priority,
        clusterLabel: catalogMatch.label,
        relatedStagingPageIds: [],
        verdict: "unmatched",
        reason: "Cluster del catalogo sin instancia persistida todavia -- no deberia pasar, revisar.",
      });
      continue;
    }

    if (appliedCanonicalKeys.has(cp.canonicalKey)) {
      results.push({
        changePackId: cp.changePackId,
        changeType: cp.changeType,
        keyword: cp.keyword,
        page: cp.page,
        priority: cp.priority,
        clusterLabel: cluster.label,
        clusterStatus: cluster.status,
        clusterAction: cluster.action,
        relatedStagingPageIds: cluster.relatedStagingPageIds,
        verdict: "supersede_duplicate",
        reason: "Su propia canonicalKey ya esta aplicada en staging -- reejecutar es un no-op, se puede cerrar como superseded.",
      });
      continue;
    }

    if (cluster.status === "rejected" || cluster.status === "postponed") {
      results.push({
        changePackId: cp.changePackId,
        changeType: cp.changeType,
        keyword: cp.keyword,
        page: cp.page,
        priority: cp.priority,
        clusterLabel: cluster.label,
        clusterStatus: cluster.status,
        clusterAction: cluster.action,
        relatedStagingPageIds: cluster.relatedStagingPageIds,
        verdict: "reject_cluster",
        reason: `El cluster "${cluster.label}" esta ${cluster.status} (${cluster.reason.slice(0, 160)}...) -- no ejecutar.`,
      });
      continue;
    }

    if (cluster.relatedStagingPageIds.length > 0) {
      results.push({
        changePackId: cp.changePackId,
        changeType: cp.changeType,
        keyword: cp.keyword,
        page: cp.page,
        priority: cp.priority,
        clusterLabel: cluster.label,
        clusterStatus: cluster.status,
        clusterAction: cluster.action,
        relatedStagingPageIds: cluster.relatedStagingPageIds,
        verdict: "supersede_duplicate",
        reason: `El cluster "${cluster.label}" ya tiene borrador(es) de staging (${cluster.relatedStagingPageIds.join(", ")}). Este change pack usa una canonicalKey distinta -- ejecutarlo crearia una pagina NUEVA duplicada, no actualizaria el borrador existente (staging-executor solo reutiliza por canonicalKey exacta). Se cierra como superseded.`,
      });
      continue;
    }

    results.push({
      changePackId: cp.changePackId,
      changeType: cp.changeType,
      keyword: cp.keyword,
      page: cp.page,
      priority: cp.priority,
      clusterLabel: cluster.label,
      clusterStatus: cluster.status,
      clusterAction: cluster.action,
      relatedStagingPageIds: cluster.relatedStagingPageIds,
      verdict: "eligible",
      reason: `Cluster "${cluster.label}" limpio (${cluster.action}) y SIN borrador de staging previo -- trabajo genuinamente nuevo.`,
    });
  }

  return { results, clusters };
}
