import * as fs from "fs";
import * as path from "path";
import { BacklogAction } from "../core/types";
import { readCurrentActions } from "../core/action-backlog";
import { readCurrentSeoClusters, upsertSeoCluster } from "../core/seo-clusters";
import { readCurrentVisualQaApprovals } from "../core/visual-qa";
import {
  SeoCluster,
  SeoClusterAction,
  SeoClusterCannibalizationRisk,
  SeoClusterPriority,
  SeoClusterStatus,
  SeoSearchIntent,
} from "../core/types";

/**
 * SEO Strategy & Keyword Clustering Agent (Fase O29).
 *
 * Regla base pedida por Pau: "Una keyword NO equivale a una pagina. Una
 * intencion de busqueda clara puede equivaler a una pagina." Este agente
 * es la capa que va ENTRE `data/action-backlog.jsonl` (keywords sueltas,
 * muy duplicadas, detectadas por seo-watcher/competitor-intelligence) y
 * cualquier ejecucion real (Carril A / staging-executor): agrupa
 * keywords en clusters de intencion, decide una URL objetivo por
 * cluster, detecta canibalizacion real (misma keyword apuntando a dos
 * paginas de produccion distintas) y da una accion/prioridad/motivo por
 * cluster -- nunca crea paginas ni ejecuta nada por si mismo.
 *
 * El vocabulario de clusters conocidos vive en
 * config/seo-clusters-catalog.json (editable, igual que
 * brand-positioning.json/competitors.json) -- este fichero es la logica
 * de matching + scoring, no el contenido de negocio.
 */

// --- Catalogo canonico (config/seo-clusters-catalog.json) ---

interface CatalogClusterEntry {
  clusterKey: string;
  label: string;
  matchPatterns: string[];
  excludePatterns: string[];
  searchIntent: SeoSearchIntent;
  targetUrl: string | null;
  targetPageId: number | null;
  relatedStagingPageIds: number[];
  action: SeoClusterAction;
  reason: string;
  cannibalizationRiskOverride?: SeoClusterCannibalizationRisk;
  recommendedTitle?: string;
  recommendedMetaDescription?: string;
}

interface SeoClustersCatalog {
  updatedAt: string;
  clusters: CatalogClusterEntry[];
}

const CATALOG_PATH = path.join(__dirname, "..", "..", "config", "seo-clusters-catalog.json");

let cachedCatalog: SeoClustersCatalog | undefined;

function loadCatalog(): SeoClustersCatalog {
  if (!cachedCatalog) {
    const raw = fs.readFileSync(CATALOG_PATH, "utf-8");
    cachedCatalog = JSON.parse(raw) as SeoClustersCatalog;
  }
  return cachedCatalog;
}

/** Solo para tests: fuerza una relectura del catalogo en el siguiente loadCatalog(). */
export function resetSeoClustersCatalogCache(): void {
  cachedCatalog = undefined;
}

// Rango Unicode de marcas diacriticas combinantes (U+0300-U+036F),
// construido por codigo (no tecleado literal) para evitar que un editor
// o pipeline de texto corrompa en silencio los bytes combinantes.
const COMBINING_DIACRITICS_PATTERN = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_PATTERN, "")
    .toLowerCase()
    .trim();
}

function matchesPattern(normalizedKeyword: string, pattern: string): boolean {
  if (pattern.startsWith("^") && pattern.endsWith("$")) {
    return new RegExp(pattern).test(normalizedKeyword);
  }
  return normalizedKeyword.includes(pattern);
}

function findCatalogEntry(keyword: string): CatalogClusterEntry | undefined {
  const normalizedKeyword = normalize(keyword);
  const { clusters } = loadCatalog();
  return clusters.find((entry) => {
    const included = entry.matchPatterns.some((p) => matchesPattern(normalizedKeyword, p));
    if (!included) return false;
    const excluded = entry.excludePatterns.some((p) => matchesPattern(normalizedKeyword, p));
    return !excluded;
  });
}

/**
 * Fase O30 -- version publica de findCatalogEntry, para que otros
 * scripts (ej. clasificacion de change packs contra el catalogo de
 * clusters) puedan resolver "esta keyword, a que cluster pertenece"
 * sin duplicar la logica de matching.
 */
export function resolveCatalogEntryForKeyword(keyword: string): { clusterKey: string; label: string } | undefined {
  const entry = findCatalogEntry(keyword);
  return entry ? { clusterKey: entry.clusterKey, label: entry.label } : undefined;
}

// --- Agrupacion de la backlog real en grupos por cluster ---

interface RawGroup {
  clusterKey: string;
  catalogEntry: CatalogClusterEntry | undefined;
  label: string;
  keywords: Set<string>;
  actions: BacklogAction[];
}

function groupActionsIntoClusters(actions: BacklogAction[]): RawGroup[] {
  const groups = new Map<string, RawGroup>();

  for (const action of actions) {
    const catalogEntry = findCatalogEntry(action.keyword);
    const clusterKey = catalogEntry ? catalogEntry.clusterKey : `unmatched:${normalize(action.keyword)}`;
    const label = catalogEntry ? catalogEntry.label : `Sin clasificar: "${action.keyword}"`;

    let group = groups.get(clusterKey);
    if (!group) {
      group = { clusterKey, catalogEntry, label, keywords: new Set(), actions: [] };
      groups.set(clusterKey, group);
    }
    group.keywords.add(action.keyword);
    group.actions.push(action);
  }

  return [...groups.values()];
}

// --- Metricas, canibalizacion, prioridad, estado ---

function computeMetrics(actions: BacklogAction[], keywordCount: number, distinctTargetPages: number) {
  let maxImpressions = 0;
  let bestPosition: number | null = null;
  for (const action of actions) {
    const evidence = action.evidence as { totalImpressions?: number; currentPosition?: number } | undefined;
    if (!evidence) continue;
    if (typeof evidence.totalImpressions === "number") {
      maxImpressions = Math.max(maxImpressions, evidence.totalImpressions);
    }
    if (typeof evidence.currentPosition === "number") {
      bestPosition = bestPosition === null ? evidence.currentPosition : Math.min(bestPosition, evidence.currentPosition);
    }
  }
  return { maxImpressions, bestPosition, keywordCount, distinctTargetPages };
}

function distinctTargetPagesOf(actions: BacklogAction[]): string[] {
  const pages = new Set<string>();
  for (const action of actions) {
    if (action.page) pages.add(action.page);
  }
  return [...pages];
}

/**
 * Fase O29.1 -- actionIds cuyo `page` real es distinto de la URL objetivo
 * decidida para el cluster. Es la version accionable (por keyword+URL) de
 * la canibalizacion: no basta con saber que hay >1 pagina distinta, hace
 * falta saber CUALES actionIds estan mal enrutados para poder cerrarlos.
 */
function computeMisroutedActionIds(actions: BacklogAction[], targetUrl: string | undefined): string[] {
  if (!targetUrl) return [];
  return actions.filter((a) => a.page && a.page !== targetUrl).map((a) => a.actionId);
}

function computeCannibalizationRisk(input: {
  targetUrl: string | undefined;
  distinctPages: string[];
  misroutedActionIds: string[];
  override: SeoClusterCannibalizationRisk | undefined;
}): SeoClusterCannibalizationRisk {
  // Sin URL objetivo declarada, solo podemos mirar si el backlog en si
  // mismo ya apunta a paginas distintas (senal debil, cluster todavia sin
  // decision de URL).
  const hasRoutingConflict = input.targetUrl ? input.misroutedActionIds.length > 0 : input.distinctPages.length > 1;
  if (!hasRoutingConflict) return input.override ?? "bajo";
  // Hay conflicto de enrutado: si el catalogo ya trae una decision
  // explicita (differentiate + override), el conflicto esta RESUELTO a
  // nivel de cluster -- los actionIds mal enrutados se cierran aparte,
  // no bloquean el cluster entero.
  return input.override ?? "alto";
}

function scorePriority(input: {
  action: SeoClusterAction;
  maxImpressions: number;
  bestPosition: number | null;
  searchIntent: SeoSearchIntent;
  hasTargetUrl: boolean;
  cannibalizationRisk: SeoClusterCannibalizationRisk;
}): { priority: SeoClusterPriority; priorityScore: number } {
  if (input.action === "reject" || input.action === "postpone") {
    return { priority: "rechazar_postponer", priorityScore: 0 };
  }

  let score = 0;
  if (input.maxImpressions > 0) score += 2;
  if (input.bestPosition !== null && input.bestPosition >= 8 && input.bestPosition <= 30) score += 3;
  if (["comercial", "producto", "sector", "transaccional"].includes(input.searchIntent)) score += 2;
  if (input.hasTargetUrl) score += 2;
  if (input.cannibalizationRisk === "bajo") score += 1;
  if (input.cannibalizationRisk === "alto") score -= 2;
  if (input.action === "new_page_candidate") score -= 1;

  const priority: SeoClusterPriority = score >= 7 ? "alta" : score >= 4 ? "media" : "baja";
  return { priority, priorityScore: score };
}

function deriveStatus(input: {
  action: SeoClusterAction;
  cannibalizationRisk: SeoClusterCannibalizationRisk;
  relatedStagingPageIds: number[];
  visuallyApprovedPageIds: Set<number>;
}): SeoClusterStatus {
  if (input.action === "reject") return "rejected";
  if (input.action === "postpone") return "postponed";
  if (input.cannibalizationRisk === "alto") return "cannibalization_risk";

  if (input.relatedStagingPageIds.length > 0) {
    const allApproved = input.relatedStagingPageIds.every((id) => input.visuallyApprovedPageIds.has(id));
    return allApproved ? "visually_approved" : "visual_review_needed";
  }

  return input.action === "new_page_candidate" ? "mapped_to_new_page_candidate" : "mapped_to_existing_page";
}

// --- Punto de entrada principal ---

export interface RunSeoStrategyClusteringAgentResult {
  clusters: SeoCluster[];
  newClusterCount: number;
  updatedClusterCount: number;
  unmatchedKeywordCount: number;
}

export function runSeoStrategyClusteringAgent(): RunSeoStrategyClusteringAgentResult {
  const actions = readCurrentActions();
  const visuallyApprovedPageIds = new Set(
    readCurrentVisualQaApprovals()
      .filter((a) => a.approved)
      .map((a) => a.wordpressPageId)
  );

  const groups = groupActionsIntoClusters(actions);
  let current = readCurrentSeoClusters();

  const resultClusters: SeoCluster[] = [];
  let newClusterCount = 0;
  let updatedClusterCount = 0;
  let unmatchedKeywordCount = 0;

  for (const group of groups) {
    const keywords = [...group.keywords].sort();
    const distinctPages = distinctTargetPagesOf(group.actions);
    const catalogEntry = group.catalogEntry;

    if (!catalogEntry) unmatchedKeywordCount += keywords.length;

    const action: SeoClusterAction = catalogEntry ? catalogEntry.action : "postpone";
    const searchIntent: SeoSearchIntent = catalogEntry ? catalogEntry.searchIntent : "mixta";
    const targetUrl = catalogEntry?.targetUrl ?? undefined;
    const targetPageId = catalogEntry?.targetPageId ?? undefined;
    const relatedStagingPageIds = catalogEntry?.relatedStagingPageIds ?? [];
    const reason = catalogEntry
      ? catalogEntry.reason
      : `Keyword sin clasificar en el catalogo canonico (config/seo-clusters-catalog.json) -- agrupada como cluster provisional de 1 sola keyword. No se crea pagina ni se decide URL hasta revision manual.`;

    const misroutedActionIds = computeMisroutedActionIds(group.actions, targetUrl);
    const cannibalizationRisk = computeCannibalizationRisk({
      targetUrl,
      distinctPages,
      misroutedActionIds,
      override: catalogEntry?.cannibalizationRiskOverride,
    });
    const { priority, priorityScore } = scorePriority({
      action,
      maxImpressions: 0,
      bestPosition: null,
      searchIntent,
      hasTargetUrl: Boolean(targetUrl),
      cannibalizationRisk,
    });
    const metrics = computeMetrics(group.actions, keywords.length, distinctPages.length);
    // priorityScore se recalcula ya con metricas reales (arriba se hizo un
    // primer paso sin impresiones/posicion porque hacian falta las metrics).
    const scored = scorePriority({
      action,
      maxImpressions: metrics.maxImpressions,
      bestPosition: metrics.bestPosition,
      searchIntent,
      hasTargetUrl: Boolean(targetUrl),
      cannibalizationRisk,
    });

    const status = deriveStatus({
      action,
      cannibalizationRisk,
      relatedStagingPageIds,
      visuallyApprovedPageIds,
    });

    const coveredActionIds = group.actions.map((a) => a.actionId);
    const duplicateActionCount = Math.max(0, coveredActionIds.length - 1);

    const { cluster, isNew } = upsertSeoCluster(
      {
        label: group.label,
        keywords,
        searchIntent,
        targetUrl,
        targetPageId,
        relatedStagingPageIds,
        action,
        priority: scored.priority,
        priorityScore: scored.priorityScore,
        cannibalizationRisk,
        reason,
        status,
        coveredActionIds,
        duplicateActionCount,
        misroutedActionIds,
        recommendedTitle: catalogEntry?.recommendedTitle,
        recommendedMetaDescription: catalogEntry?.recommendedMetaDescription,
        metrics,
      },
      current
    );

    if (isNew) newClusterCount += 1;
    else updatedClusterCount += 1;
    resultClusters.push(cluster);
    current = [...current.filter((c) => c.clusterId !== cluster.clusterId), cluster];
  }

  return { clusters: resultClusters, newClusterCount, updatedClusterCount, unmatchedKeywordCount };
}

// --- Interfaz de integracion con Carril A (diseñada, NO invocada desde
// ningun pipeline todavia -- Fase O29 es solo inteligencia, no volumen) ---

export interface CarrilATaskGroup {
  category:
    | "mejora_pagina_existente"
    | "pagina_nueva_candidata"
    | "enlazado_interno"
    | "mejora_title_meta"
    | "contenido_visual"
    | "consolidacion_canibalizacion";
  clusterId: string;
  clusterLabel: string;
  targetUrl?: string;
  priority: SeoClusterPriority;
  description: string;
}

/**
 * Traduce clusters YA limpios (con accion decidida y sin canibalizacion
 * sin resolver) en tareas concretas que Carril A podria ejecutar en el
 * futuro. Deliberadamente NO escribe en action-backlog.jsonl ni en
 * ningun otro registro ejecutable -- es una funcion pura, pensada para
 * que un futuro paso de integracion (fuera de esta fase) decida cuando
 * y como materializar estas tareas. "Carril A no debe recibir 30
 * keywords sueltas": Carril A solo deberia ver la salida de esta
 * funcion, nunca action-backlog.jsonl directamente.
 */
export function planCarrilATasks(clusters: SeoCluster[]): CarrilATaskGroup[] {
  const tasks: CarrilATaskGroup[] = [];

  for (const cluster of clusters) {
    if (cluster.status === "cannibalization_risk") {
      tasks.push({
        category: "consolidacion_canibalizacion",
        clusterId: cluster.clusterId,
        clusterLabel: cluster.label,
        targetUrl: cluster.targetUrl,
        priority: cluster.priority,
        description: `Consolidar "${cluster.label}": la misma keyword apunta a ${cluster.metrics.distinctTargetPages} paginas de produccion distintas. Decidir UNA pagina objetivo antes de tocar contenido.`,
      });
      continue;
    }
    if (cluster.status === "rejected" || cluster.status === "postponed") continue;

    if (cluster.action === "new_page_candidate") {
      tasks.push({
        category: "pagina_nueva_candidata",
        clusterId: cluster.clusterId,
        clusterLabel: cluster.label,
        priority: cluster.priority,
        description: `Candidata a pagina nueva: "${cluster.label}" (${cluster.keywords.length} keywords agrupadas).`,
      });
    } else if (cluster.action === "update_existing_page" || cluster.action === "differentiate" || cluster.action === "merge") {
      tasks.push({
        category: "mejora_pagina_existente",
        clusterId: cluster.clusterId,
        clusterLabel: cluster.label,
        targetUrl: cluster.targetUrl,
        priority: cluster.priority,
        description: `Mejorar pagina existente ${cluster.targetUrl ?? "(sin URL confirmada)"} para "${cluster.label}".`,
      });
      if (cluster.priority === "alta") {
        tasks.push({
          category: "mejora_title_meta",
          clusterId: cluster.clusterId,
          clusterLabel: cluster.label,
          targetUrl: cluster.targetUrl,
          priority: cluster.priority,
          description: `Revisar title/meta de ${cluster.targetUrl ?? "(sin URL)"} para "${cluster.label}" (posicion cercana a top 10 o con CTR bajo).`,
        });
      }
    }
  }

  return tasks;
}
