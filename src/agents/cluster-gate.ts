import { readCurrentSeoClusters } from "../core/seo-clusters";
import { resolveCatalogEntryForKeyword } from "./seo-strategy-clustering-agent";
import { SeoCluster, WorkOrder } from "../core/types";

/**
 * Fase O31 -- puerta de entrada por cluster SEO para los 3 change pack
 * builders (seo/content/cro). Antes de O31, los builders convertian
 * cualquier work order elegible en un change pack sin mirar si esa
 * keyword ya estaba cubierta por otro cluster/pagina de staging -- eso
 * es exactamente lo que produjo los 42 change packs duplicados que O30
 * tuvo que cerrar sin ejecutar. Esta funcion es el punto unico donde se
 * decide, por keyword, si procede crear un change pack y contra que
 * pagina.
 *
 * Regla base (O29): una keyword no equivale a una pagina. Aqui se aplica
 * literalmente: ninguna work order pasa a change pack sin pasar antes
 * por su cluster.
 */

export type ClusterGateVerdict = "allow_new_page" | "allow_update_existing" | "block";

export interface ClusterGateDecision {
  verdict: ClusterGateVerdict;
  reason: string;
  cluster?: SeoCluster;
  /** Puesto solo cuando verdict === "allow_update_existing": la pagina de staging que hay que actualizar en vez de crear una nueva. */
  reuseWordpressPageId?: number;
  targetUrl?: string;
  recommendedTitle?: string;
  recommendedMetaDescription?: string;
}

export function evaluateClusterGateForWorkOrder(workOrder: Pick<WorkOrder, "keyword">, clusters?: SeoCluster[]): ClusterGateDecision {
  const currentClusters = clusters ?? readCurrentSeoClusters();

  const catalogMatch = resolveCatalogEntryForKeyword(workOrder.keyword);
  if (!catalogMatch) {
    return {
      verdict: "block",
      reason: `Keyword "${workOrder.keyword}" no esta reconocida en config/seo-clusters-catalog.json -- no esta clustered todavia, no se crea change pack (regla O29: una keyword no equivale a una pagina).`,
    };
  }

  const cluster = currentClusters.find((c) => c.label === catalogMatch.label);
  if (!cluster) {
    return {
      verdict: "block",
      reason: `El cluster "${catalogMatch.label}" existe en el catalogo pero no tiene instancia persistida en data/seo-clusters.jsonl todavia -- ejecutar el SEO Strategy & Keyword Clustering Agent (npx ts-node scripts/o29-run-seo-clustering.ts) antes de que este builder pueda usarlo.`,
    };
  }

  if (cluster.status === "rejected" || cluster.status === "postponed") {
    return {
      verdict: "block",
      reason: `El cluster "${cluster.label}" esta "${cluster.status}" -- ${cluster.reason}`,
      cluster,
    };
  }

  if (cluster.cannibalizationRisk === "alto") {
    return {
      verdict: "block",
      reason: `El cluster "${cluster.label}" tiene canibalizacion sin resolver (cannibalizationRisk=alto, ${cluster.metrics.distinctTargetPages} paginas de produccion distintas detectadas) -- no se crea change pack hasta que se decida una URL objetivo unica.`,
      cluster,
    };
  }

  if (cluster.relatedStagingPageIds.length > 0) {
    // El cluster ya tiene un borrador de staging para esta intencion. NO
    // se crea una pagina nueva -- se reapunta a la pagina existente
    // (StagingExecutor la actualiza via targetWordpressPageId en vez de
    // buscar por canonicalKey, que siempre seria distinta para una work
    // order nueva).
    return {
      verdict: "allow_update_existing",
      reason: `El cluster "${cluster.label}" ya tiene borrador(es) de staging (${cluster.relatedStagingPageIds.join(", ")}) -- se actualiza ese borrador, no se crea uno nuevo.`,
      cluster,
      reuseWordpressPageId: cluster.relatedStagingPageIds[0],
      targetUrl: cluster.targetUrl,
      recommendedTitle: cluster.recommendedTitle,
      recommendedMetaDescription: cluster.recommendedMetaDescription,
    };
  }

  if (cluster.action !== "new_page_candidate") {
    // update_existing_page/differentiate/merge sin borrador de staging
    // todavia: el objetivo real es una pagina de PRODUCCION existente,
    // pero este builder solo trabaja contra staging. No se crea una
    // pagina nueva para no competir con la pagina real -- se deja
    // bloqueada hasta que exista un borrador de staging que actualizar
    // (p.ej. creado a mano o por otra fase, como paso con 2091-2111).
    return {
      verdict: "block",
      reason: `El cluster "${cluster.label}" apunta a actualizar ${cluster.targetUrl ?? "una pagina de produccion existente"} pero todavia no tiene borrador de staging asociado -- no se crea una pagina nueva para evitar competir con la pagina real. Requiere borrador de staging previo.`,
      cluster,
    };
  }

  // action === "new_page_candidate" y SIN borrador de staging previo:
  // unico caso legitimo para crear una pagina nueva.
  return {
    verdict: "allow_new_page",
    reason: `Cluster "${cluster.label}" limpio, con intencion clara y sin borrador de staging previo -- pagina nueva candidata.`,
    cluster,
    targetUrl: cluster.targetUrl,
    recommendedTitle: cluster.recommendedTitle,
    recommendedMetaDescription: cluster.recommendedMetaDescription,
  };
}
