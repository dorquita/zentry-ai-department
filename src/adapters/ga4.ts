import { google, analyticsdata_v1beta } from "googleapis";
import { logger } from "../core/logger";
import { recordCredentialFailure, recordCredentialSuccess } from "../core/credential-health";
import {
  loadActiveClientAnalyticsConfig,
  resolveActiveClientId,
  resolveClientSecret,
  resolveClientServiceCredentials,
} from "../core/client-config";

/**
 * REAL adapter para GA4 — SOLO LECTURA. Unicamente usa el metodo
 * `properties.runReport` de la GA4 Data API (`analyticsdata`). No importa
 * `analyticsadmin` ni ningun metodo de escritura (crear key events,
 * modificar streams, etc.) — no existe ninguna funcion en este fichero
 * que pueda modificar la propiedad GA4.
 *
 * Fase O11 — Analytics Watcher pasa de placeholder a lectura real cuando
 * estas credenciales existen en `.env`.
 */

const ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DEFAULT_LOOKBACK_DAYS = 28;

/**
 * Fase O16.2: gate client-aware (via `resolveClientServiceCredentials`,
 * que ya comprueba `<CLIENTID>_<var>` con fallback legacy solo para
 * "zentry") — sigue mirando SOLO variables de entorno, nunca
 * `clients/<id>/analytics.json` (que no contiene secretos).
 */
export function hasGa4Credentials(clientId: string = resolveActiveClientId()): { ok: boolean; missing: string[] } {
  const status = resolveClientServiceCredentials(clientId, "ga4");
  return { ok: status.complete, missing: status.missing };
}

/** Fase O16.1/O16.2: prefiere `clients/<id>/analytics.json`, luego `<CLIENTID>_GA4_PROPERTY_ID`, luego `.env` legacy. */
function resolvePropertyId(): string {
  return loadActiveClientAnalyticsConfig().ga4PropertyId ?? resolveClientSecret(resolveActiveClientId(), "GA4_PROPERTY_ID");
}

/** Fase O16.1: idem, opcional (puede quedar null en ambas fuentes). */
function resolveMeasurementId(): string | null {
  return loadActiveClientAnalyticsConfig().ga4MeasurementId ?? optionalEnv("GA4_MEASUREMENT_ID") ?? null;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(
    /((?:access_token|refresh_token|client_secret|api[_-]?key|private_key|authorization|bearer)\s*[:=]?\s*)["']?[A-Za-z0-9\-_./+=]{8,}["']?/gi,
    "$1[REDACTED]"
  );
  return stripped.length > 500 ? stripped.slice(0, 500) + "...[truncated]" : stripped;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function resolveDateRange(): { startDate: string; endDate: string } {
  const lookbackRaw = optionalEnv("GA4_LOOKBACK_DAYS");
  const lookbackDays = lookbackRaw !== undefined ? Number(lookbackRaw) : DEFAULT_LOOKBACK_DAYS;
  const today = new Date().toISOString().slice(0, 10);
  const endDate = shiftDate(today, -1);
  const startDate = shiftDate(endDate, -(Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : DEFAULT_LOOKBACK_DAYS));
  return { startDate, endDate };
}

function buildAuthClient() {
  const activeClientId = resolveActiveClientId();
  const clientId = resolveClientSecret(activeClientId, "GOOGLE_ANALYTICS_OAUTH_CLIENT_ID");
  const clientSecret = resolveClientSecret(activeClientId, "GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET");
  const refreshToken = resolveClientSecret(activeClientId, "GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN");
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export interface Ga4ChannelRow {
  channel: string;
  sessions: number;
  activeUsers: number;
  conversions: number;
}

export interface Ga4LandingPageRow {
  landingPage: string;
  sessions: number;
  conversions: number;
  bounceRate: number;
}

export interface Ga4EventRow {
  eventName: string;
  eventCount: number;
  conversions: number;
}

export interface Ga4SourceMediumRow {
  source: string;
  medium: string;
  sessions: number;
  conversions: number;
}

export interface Ga4Snapshot {
  propertyId: string;
  measurementId: string | null;
  startDate: string;
  endDate: string;
  channelTraffic: Ga4ChannelRow[];
  topLandingPages: Ga4LandingPageRow[];
  events: Ga4EventRow[];
  sourceMedium: Ga4SourceMediumRow[];
}

async function runReport(
  analyticsdata: analyticsdata_v1beta.Analyticsdata,
  propertyId: string,
  request: analyticsdata_v1beta.Schema$RunReportRequest
): Promise<analyticsdata_v1beta.Schema$RunReportResponse> {
  const response = await analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: request,
  });
  return response.data;
}

function cellValue(row: analyticsdata_v1beta.Schema$Row, index: number, kind: "dim" | "metric"): string {
  const list = kind === "dim" ? row.dimensionValues : row.metricValues;
  return list?.[index]?.value ?? "";
}

/**
 * Lee trafico por canal, landing pages, eventos (incluidos los eventos
 * clave documentados en config/analytics-key-events.json) y fuentes/
 * medios de los ultimos GA4_LOOKBACK_DAYS dias (28 por defecto). Solo
 * lectura: `runReport` es un metodo de consulta, no de escritura.
 */
export async function getGa4Snapshot(): Promise<Ga4Snapshot> {
  const propertyId = resolvePropertyId();
  const measurementId = resolveMeasurementId();
  const { startDate, endDate } = resolveDateRange();

  logger.info("Consultando GA4 Data API (solo lectura, properties.runReport)", {
    propertyId,
    startDate,
    endDate,
  });

  const auth = buildAuthClient();
  const analyticsdata = google.analyticsdata({ version: "v1beta", auth });
  const dateRanges = [{ startDate, endDate }];

  try {
    const [channelResp, landingResp, eventResp, sourceMediumResp] = await Promise.all([
      runReport(analyticsdata, propertyId, {
        dateRanges,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "conversions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: "20",
      }),
      runReport(analyticsdata, propertyId, {
        dateRanges,
        dimensions: [{ name: "landingPage" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "bounceRate" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: "20",
      }),
      runReport(analyticsdata, propertyId, {
        dateRanges,
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "conversions" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: "50",
      }),
      runReport(analyticsdata, propertyId, {
        dateRanges,
        dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: "15",
      }),
    ]);

    const channelTraffic: Ga4ChannelRow[] = (channelResp.rows ?? []).map((row) => ({
      channel: cellValue(row, 0, "dim"),
      sessions: Number(cellValue(row, 0, "metric") || 0),
      activeUsers: Number(cellValue(row, 1, "metric") || 0),
      conversions: Number(cellValue(row, 2, "metric") || 0),
    }));

    const topLandingPages: Ga4LandingPageRow[] = (landingResp.rows ?? []).map((row) => ({
      landingPage: cellValue(row, 0, "dim"),
      sessions: Number(cellValue(row, 0, "metric") || 0),
      conversions: Number(cellValue(row, 1, "metric") || 0),
      bounceRate: Number(cellValue(row, 2, "metric") || 0),
    }));

    const events: Ga4EventRow[] = (eventResp.rows ?? []).map((row) => ({
      eventName: cellValue(row, 0, "dim"),
      eventCount: Number(cellValue(row, 0, "metric") || 0),
      conversions: Number(cellValue(row, 1, "metric") || 0),
    }));

    const sourceMedium: Ga4SourceMediumRow[] = (sourceMediumResp.rows ?? []).map((row) => ({
      source: cellValue(row, 0, "dim"),
      medium: cellValue(row, 1, "dim"),
      sessions: Number(cellValue(row, 0, "metric") || 0),
      conversions: Number(cellValue(row, 1, "metric") || 0),
    }));

    logger.info("GA4: lectura completada", {
      channels: channelTraffic.length,
      landingPages: topLandingPages.length,
      events: events.length,
      sourceMediumRows: sourceMedium.length,
    });

    recordCredentialSuccess("ga4");
    return { propertyId, measurementId, startDate, endDate, channelTraffic, topLandingPages, events, sourceMedium };
  } catch (err) {
    const safeMessage = sanitizeError(err);
    logger.error("Fallo la lectura de GA4", { error: safeMessage });
    recordCredentialFailure("ga4", safeMessage);
    throw new Error(`Lectura de GA4 fallo: ${safeMessage}`);
  }
}
