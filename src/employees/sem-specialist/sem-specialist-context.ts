import { DepartmentEvent } from "../../core/types";
import {
  SnapshotFreshness,
  classifySnapshotFreshness,
  resolveSnapshotMaxAgeHours,
} from "../../core/snapshot-freshness";

/**
 * Context builder para el empleado Claude `sem-specialist` (ver
 * docs/claude-employee-runtime.md, seccion "Como anadir un nuevo
 * empleado").
 *
 * Separacion CLAUDE / TOOLS explicita: esta funcion es la parte TOOL
 * (deterministica, sin LLM) -- lee el bus de eventos del departamento
 * (`data/department-events.jsonl`, via `readAllEvents()` de
 * `src/core/department-events.ts`) y extrae el snapshot SEM del ULTIMO
 * evento `agent_finished` emitido por `sem-watcher` (ver
 * `src/agents/sem-watcher.ts`, `emitEvent({..., type: "agent_finished",
 * payload: { connected, campaignName, ..., metrics, departmentSummary }
 * })`).
 *
 * DELIBERADAMENTE no llama nunca a `src/adapters/google-ads.ts` ni a
 * `src/agents/sem-watcher.ts` -- ambos hacen (o podrian hacer, en el caso
 * de sem-watcher) una llamada de red real a Google Ads. Este modulo SOLO
 * lee lo que YA quedo persistido por una ejecucion anterior de
 * sem-watcher en el bus de eventos -- ninguna credencial de Google Ads
 * hace falta ni se usa aqui. Si nunca se ha ejecutado sem-watcher en este
 * repositorio (no hay ningun evento que leer), `buildSemSpecialistContext()`
 * devuelve `null` -- eso es una senal explicita de "no hay datos SEM
 * disponibles", nunca se rellena con datos inventados.
 */

export const SEM_WATCHER_AGENT_NAME = "sem-watcher";
const SEM_WATCHER_FINISHED_EVENT_TYPE = "agent_finished";

export interface SemMetricSnapshot {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  /** Convertido desde costMicros (division pura, ver microsToEurosLocal) -- nunca una llamada nueva a Google Ads. */
  costEUR: number;
  conversions: number;
  ctr: number;
  /**
   * Fase O51 -- CPC medio en euros. `null` cuando no hubo clics: la API
   * omite la metrica, y "sin clics" NO es lo mismo que "CPC de 0 €".
   * Antes de esta fase el catalogo de evidencia declaraba el CPC como
   * `not_available` de forma fija.
   */
  averageCpcEUR: number | null;
  /** Fase O51 -- valor de conversion acumulado en la ventana. */
  conversionsValue: number;
}

/** Fase O51 -- termino de busqueda real que disparo anuncios en la ventana. */
export interface SemSearchTermSnapshot {
  searchTerm: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  costEUR: number;
  conversions: number;
}

export interface SemCampaignSummarySnapshot {
  name: string;
  status: string;
  dailyBudgetEUR: number | null;
  adGroups: number;
  positiveKeywords: number;
}

export interface SemDepartmentSummarySnapshot {
  totalCampaigns: number;
  activeCampaignCount: number;
  pausedCampaignCount: number;
  allPaused: boolean;
  totalDailyBudgetIfActivatedEUR: number;
  totalMonthlyBudgetIfActivatedEUR: number;
  campaigns: SemCampaignSummarySnapshot[];
  totalPositiveKeywords: number;
  totalNegativeKeywords: number;
  realSpendEUR: number;
  primaryConversionActionNames: string[];
  unexpectedPrimaryConversionActionNames: string[];
  duplicateKeywordWarnings: string[];
}

/**
 * Categoria DETERMINISTA de una entrada del evidenceCatalog -- asignada
 * una unica vez, aqui, por codigo TOOL (nunca inferida por Claude ni
 * adivinada por el auditor via coincidencia de substring en el nombre
 * del campo). "cpc"/"conversiones"/"roas"/"gasto"/"presupuesto" son las
 * 5 categorias que auditSemSpecialistOutputForUnsupportedClaims()
 * exige ver respaldadas por una entrada de la MISMA categoria -- "other"
 * cubre el resto de datos reales citables (nombres, estados, contadores)
 * que no participan en esa auditoria de categorias cuantitativas.
 */
export type SemEvidenceCategory = "cpc" | "conversiones" | "roas" | "gasto" | "presupuesto" | "other";

/**
 * Una entrada FIJA del catalogo de evidencia determinista (ver
 * buildSemEvidenceCatalog() mas abajo). `id`/`contextField`/`value` son
 * EXACTAMENTE los mismos 3 campos que SemEvidenceItem
 * (sem-specialist-output.ts) -- el subagente solo puede construir su
 * propio `evidence[]` copiando entradas de este catalogo tal cual, nunca
 * inventando ni modificando ninguno de los 3 campos (ver
 * auditSemSpecialistOutputForUnsupportedClaims(), que rechaza cualquier
 * entrada de `evidence[]` que no coincida EXACTAMENTE con una entrada de
 * aqui).
 */
export interface SemEvidenceCatalogItem {
  id: string;
  contextField: string;
  value: string;
  category: SemEvidenceCategory;
}

/**
 * Paquete de contexto ESTRUCTURADO que el runner
 * (scripts/run-sem-specialist.ts) embebe en el prompt del subagente --
 * ver .claude/agents/sem-specialist.md, seccion "Que se te entrega", para
 * la descripcion exacta de cada campo desde el punto de vista del propio
 * subagente.
 */
export interface SemSpecialistContext {
  sourceEventId: string;
  sourceDepartmentRunId: string;
  sourceGeneratedAt: string;
  connectedToGoogleAdsAtSourceTime: boolean;
  campaignName: string;
  campaignStatus: string;
  adGroups: number;
  positiveKeywords: number;
  negativeKeywords: number;
  responsiveSearchAds: number;
  semCandidateCount: number;
  metricsWindow: string | null;
  /** Fase O51 -- limites exactos de la ventana de metricas (YYYY-MM-DD). `null` si el snapshot es anterior a esta fase. */
  metricsStartDate: string | null;
  metricsEndDate: string | null;
  /**
   * Fase O51 -- procedencia y antigüedad ya clasificadas. `sourceGeneratedAt`
   * dice CUANDO se leyo Google Ads; esto dice si esa lectura es de la
   * pasada en curso o de una anterior, y si es lo bastante reciente para
   * presentarla como estado actual.
   */
  freshness: SnapshotFreshness;
  metrics: SemMetricSnapshot[];
  /** Fase O51 -- terminos de busqueda reales (top 25 por impresiones) de la ventana. */
  searchTerms: SemSearchTermSnapshot[];
  /** Fase O51 -- cuantos terminos leyo el watcher en total (searchTerms esta recortado). */
  searchTermCount: number;
  departmentSummary: SemDepartmentSummarySnapshot | null;
  /**
   * Catalogo COMPLETO y determinista (TOOL, sin LLM) de toda la
   * evidencia citable en este snapshot -- unica fuente de verdad de "que
   * cifras/datos existen realmente". Ver buildSemEvidenceCatalog() para
   * como se construye y auditSemSpecialistOutputForUnsupportedClaims()
   * (sem-specialist-output.ts) para como se hace cumplir: cualquier
   * entrada de `evidence[]` que el subagente devuelva debe coincidir
   * EXACTAMENTE (id+contextField+value) con una entrada de aqui.
   */
  evidenceCatalog: SemEvidenceCatalogItem[];
}

// --- Parseo defensivo del payload (Record<string, unknown>) del evento ---
// `DepartmentEvent.payload` no esta tipado por contenido (cada agente
// escribe lo que quiere) -- estos helpers nunca lanzan ante un campo
// ausente o de tipo inesperado, solo caen a un valor por defecto seguro,
// para que un evento historico con una forma ligeramente distinta no
// tumbe el runner.
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asNullableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asBoolean(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Division pura euros<-micros -- NO es una llamada a src/adapters/google-ads.ts (que hace red real); mismo calculo, reimplementado localmente a proposito para no crear ninguna dependencia de este modulo hacia el adaptador. */
function microsToEurosLocal(micros: unknown): number {
  const n = asNumber(micros, 0);
  return Math.round((n / 1_000_000) * 100) / 100;
}

function parseMetrics(v: unknown): SemMetricSnapshot[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const r = asRecord(raw);
    return {
      campaignId: asString(r.campaignId),
      campaignName: asString(r.campaignName),
      impressions: asNumber(r.impressions),
      clicks: asNumber(r.clicks),
      costEUR: microsToEurosLocal(r.costMicros),
      conversions: asNumber(r.conversions),
      ctr: asNumber(r.ctr),
      // `null` a proposito si el campo no viene (snapshot anterior a la
      // Fase O51) o si la API lo omitio (sin clics): en ninguno de los
      // dos casos existe un CPC real que citar.
      averageCpcEUR: r.averageCpcMicros == null ? null : microsToEurosLocal(r.averageCpcMicros),
      conversionsValue: asNumber(r.conversionsValue),
    };
  });
}

/** Fase O51 -- terminos de busqueda del payload del evento. */
function parseSearchTerms(v: unknown): SemSearchTermSnapshot[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const r = asRecord(raw);
    return {
      searchTerm: asString(r.searchTerm),
      campaignName: asString(r.campaignName),
      impressions: asNumber(r.impressions),
      clicks: asNumber(r.clicks),
      costEUR: microsToEurosLocal(r.costMicros),
      conversions: asNumber(r.conversions),
    };
  });
}

function parseCampaignSummaries(v: unknown): SemCampaignSummarySnapshot[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const r = asRecord(raw);
    return {
      name: asString(r.name),
      status: asString(r.status),
      dailyBudgetEUR: asNullableNumber(r.dailyBudgetEUR),
      adGroups: asNumber(r.adGroups),
      positiveKeywords: asNumber(r.positiveKeywords),
    };
  });
}

function parseDepartmentSummary(v: unknown): SemDepartmentSummarySnapshot | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  return {
    totalCampaigns: asNumber(r.totalCampaigns),
    activeCampaignCount: asNumber(r.activeCampaignCount),
    pausedCampaignCount: asNumber(r.pausedCampaignCount),
    allPaused: asBoolean(r.allPaused),
    totalDailyBudgetIfActivatedEUR: asNumber(r.totalDailyBudgetIfActivatedEUR),
    totalMonthlyBudgetIfActivatedEUR: asNumber(r.totalMonthlyBudgetIfActivatedEUR),
    campaigns: parseCampaignSummaries(r.campaigns),
    totalPositiveKeywords: asNumber(r.totalPositiveKeywords),
    totalNegativeKeywords: asNumber(r.totalNegativeKeywords),
    realSpendEUR: asNumber(r.realSpendEUR),
    primaryConversionActionNames: asStringArray(r.primaryConversionActionNames),
    unexpectedPrimaryConversionActionNames: asStringArray(r.unexpectedPrimaryConversionActionNames),
    duplicateKeywordWarnings: asStringArray(r.duplicateKeywordWarnings),
  };
}

/**
 * Busca el evento `agent_finished` MAS RECIENTE emitido por `sem-watcher`
 * (por `createdAt`, no por posicion en el array -- aunque
 * `readAllEvents()` ya devuelve orden cronologico de escritura, comparar
 * por timestamp es mas robusto frente a cualquier reordenacion futura).
 * Devuelve `null` si `sem-watcher` nunca ha registrado ninguno -- esa es
 * la senal real de "no hay datos SEM disponibles todavia".
 */
export function findLatestSemWatcherFinishedEvent(events: DepartmentEvent[]): DepartmentEvent | null {
  const matches = events.filter((e) => e.agent === SEM_WATCHER_AGENT_NAME && e.type === SEM_WATCHER_FINISHED_EVENT_TYPE);
  if (matches.length === 0) return null;
  return matches.reduce((latest, e) => (Date.parse(e.createdAt) >= Date.parse(latest.createdAt) ? e : latest));
}

/**
 * Construye, de forma puramente deterministica (TOOL, sin LLM), el
 * catalogo COMPLETO de evidencia citable para un `SemSpecialistContext`
 * ya construido (recibe todos sus campos salvo `evidenceCatalog`, para
 * evitar una dependencia circular con el propio tipo que produce). Cada
 * numero/dato real del contexto obtiene EXACTAMENTE una entrada, con un
 * `id` estable (mismo input -> mismos ids, funcion pura) y una
 * `category` asignada aqui mismo -- nunca adivinada despues por
 * coincidencia de texto (ver comentario de SemEvidenceCategory).
 *
 * Incluye SIEMPRE dos entradas centinela para CPC y ROAS
 * (`sem-cpc-not-available` / `sem-roas-not-available`, value
 * "not_available"): hoy `SemSpecialistContext` no expone ningun campo
 * real de CPC ni de ROAS (sem-watcher no los reporta) -- sin estas dos
 * entradas, cualquier mencion de CPC/ROAS con una cifra quedaria
 * indefinida de forma ambigua; con ellas, el subagente tiene una via
 * VALIDA y explicita para declarar la ausencia de dato sin arriesgarse a
 * inventar una cifra (ver auditSemSpecialistOutputForUnsupportedClaims:
 * como ninguna entrada del catalogo tiene un valor NUMERICO de categoria
 * "cpc"/"roas", CUALQUIER cifra citada en esas categorias es rechazada
 * por diseno, siempre).
 */
export function buildSemEvidenceCatalog(ctx: Omit<SemSpecialistContext, "evidenceCatalog">): SemEvidenceCatalogItem[] {
  const catalog: SemEvidenceCatalogItem[] = [];
  const add = (id: string, contextField: string, value: string, category: SemEvidenceCategory): void => {
    catalog.push({ id, contextField, value, category });
  };

  add("sem-campaign-name", "campaignName", ctx.campaignName, "other");
  add("sem-campaign-status", "campaignStatus", ctx.campaignStatus, "other");
  add("sem-connected-to-google-ads", "connectedToGoogleAdsAtSourceTime", String(ctx.connectedToGoogleAdsAtSourceTime), "other");
  add("sem-ad-groups", "adGroups", String(ctx.adGroups), "other");
  add("sem-positive-keywords", "positiveKeywords", String(ctx.positiveKeywords), "other");
  add("sem-negative-keywords", "negativeKeywords", String(ctx.negativeKeywords), "other");
  add("sem-responsive-search-ads", "responsiveSearchAds", String(ctx.responsiveSearchAds), "other");
  add("sem-candidate-count", "semCandidateCount", String(ctx.semCandidateCount), "other");

  ctx.metrics.forEach((m, i) => {
    add(`sem-metrics-${i}-clicks`, `metrics[${i}].clicks`, String(m.clicks), "other");
    add(`sem-metrics-${i}-impressions`, `metrics[${i}].impressions`, String(m.impressions), "other");
    add(`sem-metrics-${i}-ctr`, `metrics[${i}].ctr`, String(m.ctr), "other");
    add(`sem-metrics-${i}-cost`, `metrics[${i}].costEUR`, String(m.costEUR), "gasto");
    add(`sem-metrics-${i}-conversions`, `metrics[${i}].conversions`, String(m.conversions), "conversiones");
    // Fase O51: el CPC real entra en el catalogo SOLO cuando la API lo
    // devolvio. Si no hubo clics no hay CPC, y una entrada con valor "0"
    // habilitaria al subagente a escribir "CPC de 0 €", que es falso.
    if (m.averageCpcEUR !== null) {
      add(`sem-metrics-${i}-cpc`, `metrics[${i}].averageCpcEUR`, String(m.averageCpcEUR), "cpc");
    }
    add(`sem-metrics-${i}-conversions-value`, `metrics[${i}].conversionsValue`, String(m.conversionsValue), "conversiones");
  });

  // Fase O51 -- terminos de busqueda reales, citables uno a uno.
  ctx.searchTerms.forEach((t, i) => {
    add(`sem-search-term-${i}-text`, `searchTerms[${i}].searchTerm`, t.searchTerm, "other");
    add(`sem-search-term-${i}-impressions`, `searchTerms[${i}].impressions`, String(t.impressions), "other");
    add(`sem-search-term-${i}-clicks`, `searchTerms[${i}].clicks`, String(t.clicks), "other");
    add(`sem-search-term-${i}-cost`, `searchTerms[${i}].costEUR`, String(t.costEUR), "gasto");
    add(`sem-search-term-${i}-conversions`, `searchTerms[${i}].conversions`, String(t.conversions), "conversiones");
  });

  if (ctx.departmentSummary) {
    const ds = ctx.departmentSummary;
    add("sem-spend-real", "departmentSummary.realSpendEUR", String(ds.realSpendEUR), "gasto");
    add("sem-budget-daily-total", "departmentSummary.totalDailyBudgetIfActivatedEUR", String(ds.totalDailyBudgetIfActivatedEUR), "presupuesto");
    add("sem-budget-monthly-total", "departmentSummary.totalMonthlyBudgetIfActivatedEUR", String(ds.totalMonthlyBudgetIfActivatedEUR), "presupuesto");
    add("sem-total-campaigns", "departmentSummary.totalCampaigns", String(ds.totalCampaigns), "other");
    add("sem-active-campaigns", "departmentSummary.activeCampaignCount", String(ds.activeCampaignCount), "other");
    add("sem-paused-campaigns", "departmentSummary.pausedCampaignCount", String(ds.pausedCampaignCount), "other");
    add("sem-total-positive-keywords", "departmentSummary.totalPositiveKeywords", String(ds.totalPositiveKeywords), "other");
    add("sem-total-negative-keywords", "departmentSummary.totalNegativeKeywords", String(ds.totalNegativeKeywords), "other");

    ds.campaigns.forEach((c, i) => {
      add(`sem-campaign-${i}-name`, `departmentSummary.campaigns[${i}].name`, c.name, "other");
      add(`sem-campaign-${i}-status`, `departmentSummary.campaigns[${i}].status`, c.status, "other");
      add(`sem-campaign-${i}-ad-groups`, `departmentSummary.campaigns[${i}].adGroups`, String(c.adGroups), "other");
      add(`sem-campaign-${i}-positive-keywords`, `departmentSummary.campaigns[${i}].positiveKeywords`, String(c.positiveKeywords), "other");
      if (c.dailyBudgetEUR !== null) {
        add(`sem-campaign-${i}-daily-budget`, `departmentSummary.campaigns[${i}].dailyBudgetEUR`, String(c.dailyBudgetEUR), "presupuesto");
      }
    });

    ds.primaryConversionActionNames.forEach((name, i) => add(`sem-primary-conversion-${i}`, `departmentSummary.primaryConversionActionNames[${i}]`, name, "other"));
    ds.unexpectedPrimaryConversionActionNames.forEach((name, i) => add(`sem-unexpected-conversion-${i}`, `departmentSummary.unexpectedPrimaryConversionActionNames[${i}]`, name, "other"));
    ds.duplicateKeywordWarnings.forEach((w, i) => add(`sem-duplicate-keyword-warning-${i}`, `departmentSummary.duplicateKeywordWarnings[${i}]`, w, "other"));

    // CUANTAS entradas tiene cada lista, no solo cuales. Sin estas tres
    // entradas, el catalogo incumplia su propia promesa ("cada numero
    // real del contexto tiene ya su entrada aqui"): los TAMANOS de lista
    // eran datos reales, perfectamente citables en prosa, y no existia
    // ninguna entrada que los respaldara. Fallo real: el run
    // 31960785519 se rechazo por la frase "3 conversiones primarias"
    // -- un recuento correcto de `primaryConversionActionNames`, que
    // era IMPOSIBLE de citar porque el catalogo solo traia los nombres
    // uno a uno, nunca su total.
    add("sem-primary-conversion-count", "departmentSummary.primaryConversionActionNames.length", String(ds.primaryConversionActionNames.length), "other");
    add(
      "sem-unexpected-conversion-count",
      "departmentSummary.unexpectedPrimaryConversionActionNames.length",
      String(ds.unexpectedPrimaryConversionActionNames.length),
      "other"
    );
    add("sem-duplicate-keyword-warning-count", "departmentSummary.duplicateKeywordWarnings.length", String(ds.duplicateKeywordWarnings.length), "other");
  }

  // Mismos recuentos, para las dos listas que no viven en
  // departmentSummary. `searchTermCount` es el total REAL leido por el
  // watcher (searchTerms viene recortado a 25), asi que decir "N terminos
  // de busqueda" solo es citable si ese total esta en el catalogo.
  add("sem-search-term-count", "searchTermCount", String(ctx.searchTermCount), "other");
  add("sem-metrics-count", "metrics.length", String(ctx.metrics.length), "other");

  // Fase O51: el CPC ya NO es "no disponible" por definicion -- lo es
  // solo cuando ninguna campana tuvo clics en la ventana. El ROAS sigue
  // sin calcularse aqui a proposito: seria valor_de_conversion / gasto, y
  // derivarlo en el catalogo lo convertiria en "evidencia" cuando en
  // realidad es un calculo. Si hace falta, se anade como campo propio del
  // watcher, no como derivada silenciosa.
  if (ctx.metrics.every((m) => m.averageCpcEUR === null)) {
    add("sem-cpc-not-available", "cpc", "not_available", "cpc");
  }
  add("sem-roas-not-available", "roas", "not_available", "roas");

  return catalog;
}

/**
 * Punto de entrada de este modulo. `null` si no hay ningun snapshot SEM
 * real que leer -- el runner (scripts/run-sem-specialist.ts) trata eso
 * como un estado terminal "no_data" y NUNCA invoca al subagente sin
 * contexto real.
 */
export interface BuildSemSpecialistContextOptions {
  /** Inyectable para tests -- por defecto, el ahora real. */
  now?: string;
  /** departmentRunId de la pasada EN CURSO; por defecto DEPARTMENT_RUN_ID. */
  currentDepartmentRunId?: string | null;
  /** Inyectable para tests; por defecto SNAPSHOT_MAX_AGE_HOURS. */
  maxAgeHours?: number;
}

export function buildSemSpecialistContext(
  events: DepartmentEvent[],
  options: BuildSemSpecialistContextOptions = {}
): SemSpecialistContext | null {
  const event = findLatestSemWatcherFinishedEvent(events);
  if (!event) return null;
  const payload = asRecord(event.payload);
  // Fase O51 -- `adsGeneratedAt` (cuando se hablo con la API de Google
  // Ads) es mas preciso que `event.createdAt` (cuando se escribio el
  // evento). Se prefiere el primero; el segundo es el respaldo para
  // snapshots anteriores a esta fase, que no lo traen.
  const sourceGeneratedAt =
    typeof payload.adsGeneratedAt === "string" && payload.adsGeneratedAt.length > 0
      ? payload.adsGeneratedAt
      : event.createdAt;
  const freshness = classifySnapshotFreshness({
    sourceGeneratedAt,
    now: options.now ?? new Date().toISOString(),
    maxAgeHours: options.maxAgeHours ?? resolveSnapshotMaxAgeHours(),
    currentDepartmentRunId:
      options.currentDepartmentRunId !== undefined
        ? options.currentDepartmentRunId
        : process.env.DEPARTMENT_RUN_ID ?? null,
    snapshotDepartmentRunId: event.departmentRunId,
  });
  const baseCtx = {
    sourceEventId: event.eventId,
    sourceDepartmentRunId: event.departmentRunId,
    sourceGeneratedAt,
    freshness,
    connectedToGoogleAdsAtSourceTime: asBoolean(payload.connected),
    campaignName: asString(payload.campaignName),
    campaignStatus: asString(payload.campaignStatus),
    adGroups: asNumber(payload.adGroups),
    positiveKeywords: asNumber(payload.positiveKeywords),
    negativeKeywords: asNumber(payload.negativeKeywords),
    responsiveSearchAds: asNumber(payload.responsiveSearchAds),
    semCandidateCount: asNumber(payload.semCandidateCount),
    metricsWindow: typeof payload.metricsWindow === "string" ? payload.metricsWindow : null,
    metricsStartDate: typeof payload.metricsStartDate === "string" ? payload.metricsStartDate : null,
    metricsEndDate: typeof payload.metricsEndDate === "string" ? payload.metricsEndDate : null,
    metrics: parseMetrics(payload.metrics),
    searchTerms: parseSearchTerms(payload.searchTerms),
    searchTermCount: asNumber(payload.searchTermCount),
    departmentSummary: parseDepartmentSummary(payload.departmentSummary),
  };
  return { ...baseCtx, evidenceCatalog: buildSemEvidenceCatalog(baseCtx) };
}
