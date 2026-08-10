import * as fs from "fs";
import { google, searchconsole_v1 } from "googleapis";
import { SearchConsoleRow, SeoDataResult } from "../core/types";
import { logger } from "../core/logger";
import { loadActiveClientSeoConfig, resolveActiveClientId, resolveClientSecret } from "../core/client-config";

const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * REAL adapter. Read-only against the Google Search Console API
 * (searchanalytics.query). It never calls a write/mutate endpoint of any
 * Google API (no sitemaps.submit, no sites.add/delete, nothing that
 * changes state) and it never touches WordPress, Google Ads, GA4, GTM or
 * n8n.
 *
 * Must implement the exact same signature as the placeholder adapter
 * (Promise<SearchConsoleRow[]>) so src/agents/seo-watcher.ts never has to
 * change when the data source is swapped.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisa .env.example para ver que hace falta configurar.`
    );
  }
  return value;
}

/**
 * A blank line in .env (p.ej. `GSC_START_DATE=`) hace que dotenv fije la
 * variable a "" en vez de dejarla sin definir. "" no es null/undefined, asi
 * que `??` NO la trata como "sin configurar" y el valor vacio se cuela.
 * Este helper trata "" (o solo espacios) igual que "no configurada".
 */
function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Removes anything shaped like a credential from an error message before
 * it can reach a log line or the console. Defense in depth on top of
 * logger.ts's own redaction, specifically for values embedded inside
 * third-party error strings (stack traces, HTTP error bodies) that the
 * generic key-based redaction in logger.ts wouldn't catch.
 */
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

const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Falla con un error claro ANTES de llamar a la API si la fecha no es
 * exactamente YYYY-MM-DD o no es una fecha de calendario real (p.ej. rechaza
 * "2026-02-30").
 */
function assertValidDate(label: string, value: string): void {
  if (!DATE_FORMAT_RE.test(value)) {
    throw new Error(
      `${label} invalida: "${value}". Debe tener formato YYYY-MM-DD (ej. 2026-08-01).`
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!isRealCalendarDate) {
    throw new Error(`${label} invalida: "${value}" no es una fecha de calendario real.`);
  }
}

function hasOAuthEnvVars(): boolean {
  return Boolean(
    process.env.GSC_OAUTH_CLIENT_ID &&
      process.env.GSC_OAUTH_CLIENT_SECRET &&
      process.env.GSC_OAUTH_REFRESH_TOKEN
  );
}

/**
 * GSC_AUTH_METHOD is optional. If unset, auto-detect: OAuth2 if its three
 * vars are present (the supported path today), otherwise service_account
 * (kept for a future setup that provides a key file; not used/requested
 * right now).
 */
function resolveAuthMethod(): "service_account" | "oauth2" {
  const explicit = process.env.GSC_AUTH_METHOD?.toLowerCase();
  if (explicit === "service_account" || explicit === "oauth2") return explicit;
  if (explicit) {
    throw new Error(
      `GSC_AUTH_METHOD desconocido: "${explicit}". Valores validos: "service_account" u "oauth2".`
    );
  }
  return hasOAuthEnvVars() ? "oauth2" : "service_account";
}

function buildAuthClient() {
  const method = resolveAuthMethod();

  if (method === "service_account") {
    const keyFilePath = requireEnv("GSC_SERVICE_ACCOUNT_JSON_PATH");
    if (!fs.existsSync(keyFilePath)) {
      throw new Error(
        `No se encuentra el fichero indicado por GSC_SERVICE_ACCOUNT_JSON_PATH. La ruta no se imprime por seguridad; revisa que el fichero exista y sea legible.`
      );
    }
    return new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes: [READONLY_SCOPE],
    });
  }

  if (method === "oauth2") {
    const activeClientId = resolveActiveClientId();
    const clientId = resolveClientSecret(activeClientId, "GSC_OAUTH_CLIENT_ID");
    const clientSecret = resolveClientSecret(activeClientId, "GSC_OAUTH_CLIENT_SECRET");
    const refreshToken = resolveClientSecret(activeClientId, "GSC_OAUTH_REFRESH_TOKEN");
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  // Inalcanzable: resolveAuthMethod() ya solo devuelve uno de estos dos valores.
  throw new Error(`Metodo de autenticacion no soportado: "${method}".`);
}

interface SearchConsoleQueryOptions {
  siteUrl: string;
  startDate: string;
  endDate: string;
  rowLimit: number;
}

/**
 * Fase O16.1: prefiere `configPaths.seo` del ClientConfig ACTIVO
 * (`clients/<id>/seo.json` -> `searchConsoleSiteUrl`); si el cliente no
 * define uno (valor `null`), cae a la variable de entorno legacy
 * `GSC_SITE_URL` — asi ningun cliente existente se rompe si su
 * `seo.json` todavia no trae el dato.
 */
function resolveSiteUrl(): string {
  const configured = loadActiveClientSeoConfig().searchConsoleSiteUrl;
  if (configured) {
    return configured;
  }
  return requireEnv("GSC_SITE_URL");
}

function resolveQueryOptions(): SearchConsoleQueryOptions {
  const siteUrl = resolveSiteUrl();

  const rowLimitRaw = optionalEnv("GSC_ROW_LIMIT");
  const rowLimit = rowLimitRaw !== undefined ? Number(rowLimitRaw) : 1000;
  if (!Number.isFinite(rowLimit) || rowLimit <= 0) {
    throw new Error(`GSC_ROW_LIMIT invalido: "${rowLimitRaw}". Debe ser un numero positivo.`);
  }

  const lookbackRaw = optionalEnv("GSC_LOOKBACK_DAYS");
  const lookbackDays = lookbackRaw !== undefined ? Number(lookbackRaw) : 28;
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    throw new Error(
      `GSC_LOOKBACK_DAYS invalido: "${lookbackRaw}". Debe ser un numero positivo.`
    );
  }

  // Por defecto, endDate = ayer (no hoy): Search Console tiene un lag de
  // datos de 1-3 dias, asi que "hoy" suele devolver filas incompletas o
  // vacias. startDate por defecto = endDate - GSC_LOOKBACK_DAYS.
  const today = new Date().toISOString().slice(0, 10);
  const defaultEndDate = shiftDate(today, -1);
  const endDate = optionalEnv("GSC_END_DATE") ?? defaultEndDate;
  assertValidDate("GSC_END_DATE", endDate);

  const startDate = optionalEnv("GSC_START_DATE") ?? shiftDate(endDate, -lookbackDays);
  assertValidDate("GSC_START_DATE", startDate);

  if (startDate > endDate) {
    throw new Error(
      `Rango de fechas invalido: GSC_START_DATE (${startDate}) es posterior a GSC_END_DATE (${endDate}).`
    );
  }

  return { siteUrl, startDate, endDate, rowLimit };
}

/**
 * Lists the sites the configured credentials can read. Read-only
 * (searchconsole.sites.list). Useful as a lightweight credential sanity
 * check before running a full searchanalytics query.
 */
export async function listAccessibleSites(): Promise<string[]> {
  const auth = buildAuthClient();
  const searchconsole = google.searchconsole({ version: "v1", auth });
  try {
    const response = await searchconsole.sites.list();
    return (response.data.siteEntry ?? []).map((s) => s.siteUrl ?? "").filter(Boolean);
  } catch (err) {
    const safeMessage = sanitizeError(err);
    logger.error("Fallo al listar sitios accesibles en Search Console", {
      error: safeMessage,
    });
    throw new Error(`No se pudo listar sitios en Search Console: ${safeMessage}`);
  }
}

export async function getSearchConsoleData(): Promise<SeoDataResult> {
  const { siteUrl, startDate, endDate, rowLimit } = resolveQueryOptions();

  logger.info("Consultando Google Search Console (solo lectura, searchanalytics.query)", {
    siteUrl,
    startDate,
    endDate,
    rowLimit,
  });

  const auth = buildAuthClient();
  const searchconsole = google.searchconsole({ version: "v1", auth });

  let response;
  try {
    response = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["query", "page"],
        rowLimit,
      } satisfies searchconsole_v1.Schema$SearchAnalyticsQueryRequest,
    });
  } catch (err) {
    const safeMessage = sanitizeError(err);
    logger.error("Fallo la consulta a Search Console", { error: safeMessage });
    throw new Error(`Search Console query fallo: ${safeMessage}`);
  }

  const apiRows = response.data.rows ?? [];
  logger.info(`Search Console devolvio ${apiRows.length} fila(s)`);

  const rows: SearchConsoleRow[] = apiRows.map((row) => ({
    query: row.keys?.[0] ?? "",
    page: row.keys?.[1] ?? "",
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
    // La API de Search Console no devuelve un "periodo anterior" en la
    // misma llamada. Sin un segundo query (periodo previo) para comparar,
    // no hay previousPosition real todavia -> position_drop no se activara
    // con datos reales hasta que se implemente esa comparacion (ver docs).
  }));

  return { rows, siteUrl, analysisStartDate: startDate, analysisEndDate: endDate };
}
