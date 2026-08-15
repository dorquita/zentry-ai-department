import { DepartmentEvent } from "../../core/types";

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
  metrics: SemMetricSnapshot[];
  departmentSummary: SemDepartmentSummarySnapshot | null;
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
 * Punto de entrada de este modulo. `null` si no hay ningun snapshot SEM
 * real que leer -- el runner (scripts/run-sem-specialist.ts) trata eso
 * como un estado terminal "no_data" y NUNCA invoca al subagente sin
 * contexto real.
 */
export function buildSemSpecialistContext(events: DepartmentEvent[]): SemSpecialistContext | null {
  const event = findLatestSemWatcherFinishedEvent(events);
  if (!event) return null;
  const payload = asRecord(event.payload);
  return {
    sourceEventId: event.eventId,
    sourceDepartmentRunId: event.departmentRunId,
    sourceGeneratedAt: event.createdAt,
    connectedToGoogleAdsAtSourceTime: asBoolean(payload.connected),
    campaignName: asString(payload.campaignName),
    campaignStatus: asString(payload.campaignStatus),
    adGroups: asNumber(payload.adGroups),
    positiveKeywords: asNumber(payload.positiveKeywords),
    negativeKeywords: asNumber(payload.negativeKeywords),
    responsiveSearchAds: asNumber(payload.responsiveSearchAds),
    semCandidateCount: asNumber(payload.semCandidateCount),
    metricsWindow: typeof payload.metricsWindow === "string" ? payload.metricsWindow : null,
    metrics: parseMetrics(payload.metrics),
    departmentSummary: parseDepartmentSummary(payload.departmentSummary),
  };
}
