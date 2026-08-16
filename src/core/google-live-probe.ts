import {
  CLIENT_SERVICE_CREDENTIAL_KEYS,
  ClientCredentialService,
  resolveClientEnvVarName,
} from "./client-config";

/**
 * Fase O50 — auditoria de dependencias externas.
 *
 * Logica PURA (sin I/O, sin red, sin `process.env`) del probe de solo
 * lectura de las cuatro integraciones Google del departamento. El script
 * `scripts/probe-google-live.ts` hace las llamadas reales y usa este
 * modulo para: clasificar cada variable (secreto real vs configuracion
 * no sensible), decidir el codigo de salida, y renderizar el informe.
 *
 * Regla invariante de todo este modulo: NUNCA se maneja el VALOR de una
 * credencial, solo su NOMBRE. Las funciones de aqui reciben nombres de
 * variable y estados, jamas valores.
 */

export type GoogleProbeService = Extract<
  ClientCredentialService,
  "search_console" | "ga4" | "gtm" | "google_ads"
>;

/** Orden fijo y deliberado: el mismo del informe de auditoria. */
export const GOOGLE_PROBE_SERVICES: readonly GoogleProbeService[] = [
  "search_console",
  "ga4",
  "gtm",
  "google_ads",
] as const;

export const GOOGLE_PROBE_SERVICE_LABELS: Record<GoogleProbeService, string> = {
  search_console: "Google Search Console",
  ga4: "GA4 (Analytics Data API)",
  gtm: "Google Tag Manager",
  google_ads: "Google Ads",
};

/**
 * `live` = la API respondio de verdad en esta pasada.
 * `missing_credentials` = falta al menos una variable, NO se llamo a la API.
 * `failed` = habia credenciales completas pero la llamada real fallo.
 * `skipped` = el servicio no estaba en la lista pedida en esta ejecucion.
 */
export type GoogleProbeStatus = "live" | "missing_credentials" | "failed" | "skipped";

export interface GoogleProbeServiceResult {
  service: GoogleProbeService;
  status: GoogleProbeStatus;
  /** Nombres YA PREFIJADOS de variables que faltan — nunca valores. */
  missing: string[];
  /**
   * Dato minimo y verificable devuelto por la API (p.ej. numero de sitios
   * accesibles, sesiones de los ultimos 7 dias). Nunca contiene
   * credenciales.
   */
  evidence: Record<string, string | number | boolean> | null;
  /** Mensaje de error YA SANEADO por el adaptador — nunca crudo. */
  error: string | null;
}

export interface GoogleProbeReport {
  clientId: string;
  probedAt: string;
  results: GoogleProbeServiceResult[];
}

/**
 * Sensibilidad real de cada variable Google, para poder decidir en la
 * migracion si algo debe ser un GitHub *secret* o basta un *repository
 * variable*.
 *
 * `secret`: revela o permite obtener acceso (client secret, refresh
 *   token, developer token).
 * `config`: identificadores no sensibles que ya son visibles para
 *   cualquiera con acceso a la cuenta (property/container/customer ids) o
 *   que aparecen en el HTML publico del sitio. Se pueden guardar como
 *   repository variable; guardarlos como secret tampoco rompe nada, solo
 *   dificulta depurar porque GitHub los enmascara en los logs.
 *
 * `GOOGLE_ADS_OAUTH_CLIENT_ID`/`GSC_OAUTH_CLIENT_ID` se clasifican como
 * `secret` a proposito: aunque un client ID de OAuth no es por si solo
 * suficiente para autenticarse, Google lo trata como parte de la
 * credencial y no hay ninguna ventaja en exponerlo.
 */
export type GoogleEnvSensitivity = "secret" | "config";

export const GOOGLE_ENV_SENSITIVITY: Record<string, GoogleEnvSensitivity> = {
  GSC_OAUTH_CLIENT_ID: "secret",
  GSC_OAUTH_CLIENT_SECRET: "secret",
  GSC_OAUTH_REFRESH_TOKEN: "secret",
  GSC_SITE_URL: "config",
  GOOGLE_ANALYTICS_OAUTH_CLIENT_ID: "secret",
  GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET: "secret",
  GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN: "secret",
  GA4_PROPERTY_ID: "config",
  GA4_MEASUREMENT_ID: "config",
  GTM_CONTAINER_ID: "config",
  GTM_WORKSPACE_ID: "config",
  GOOGLE_ADS_DEVELOPER_TOKEN: "secret",
  GOOGLE_ADS_OAUTH_CLIENT_ID: "secret",
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret",
  GOOGLE_ADS_OAUTH_REFRESH_TOKEN: "secret",
  GOOGLE_ADS_CUSTOMER_ID: "config",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "config",
};

/** Nombres SIN prefijo que son secretos de verdad (lo que nunca puede acabar en un log). */
export function listGoogleSecretEnvVarNames(): string[] {
  return Object.keys(GOOGLE_ENV_SENSITIVITY)
    .filter((name) => GOOGLE_ENV_SENSITIVITY[name] === "secret")
    .sort();
}

/**
 * Todos los nombres que hay que vigilar al comprobar que un texto no
 * filtra un secreto: la forma sin prefijo Y la forma
 * `<CLIENTID>_<key>` de la convencion multi-cliente (Fase O16.2).
 */
export function listGoogleSecretEnvVarNamesForClient(clientId: string): string[] {
  const base = listGoogleSecretEnvVarNames();
  return [...base, ...base.map((name) => resolveClientEnvVarName(clientId, name))];
}

/**
 * Variables que consume cada servicio, en su forma sin prefijo. Deriva
 * del catalogo unico `CLIENT_SERVICE_CREDENTIAL_KEYS` a proposito: si
 * manana un adaptador necesita una variable mas, este modulo la hereda
 * sin tener que acordarse de duplicarla aqui.
 */
export function listServiceEnvVarNames(service: GoogleProbeService): string[] {
  return [...CLIENT_SERVICE_CREDENTIAL_KEYS[service]];
}

/**
 * Codigo de salida del probe. `required` son los servicios que el
 * llamante declara CRITICOS en esa ejecucion: si alguno no queda en
 * `live`, el probe falla de forma explicita (fail-closed). Sin
 * `required`, el probe es puramente informativo y siempre sale 0 — la
 * ausencia de credenciales se reporta, no se disfraza de exito ni de
 * fallo.
 */
export function resolveProbeExitCode(
  report: GoogleProbeReport,
  required: readonly GoogleProbeService[]
): number {
  if (required.length === 0) return 0;
  const byService = new Map(report.results.map((r) => [r.service, r]));
  const notLive = required.filter((service) => byService.get(service)?.status !== "live");
  return notLive.length > 0 ? 1 : 0;
}

/** Servicios pedidos que no quedaron `live` — para el mensaje de error del script. */
export function listNotLiveRequiredServices(
  report: GoogleProbeReport,
  required: readonly GoogleProbeService[]
): GoogleProbeService[] {
  const byService = new Map(report.results.map((r) => [r.service, r]));
  return required.filter((service) => byService.get(service)?.status !== "live");
}

function renderEvidence(evidence: Record<string, string | number | boolean> | null): string {
  if (!evidence) return "-";
  const entries = Object.entries(evidence);
  if (entries.length === 0) return "-";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

/**
 * Informe Markdown del probe. Solo imprime NOMBRES de variables y datos
 * devueltos por la API — nunca un valor de credencial (los mensajes de
 * error ya llegan saneados desde los adaptadores).
 */
export function renderGoogleProbeMarkdown(report: GoogleProbeReport): string {
  const lines: string[] = [];
  lines.push("## Probe LIVE de Google (solo lectura)");
  lines.push("");
  lines.push(`- **Cliente:** \`${report.clientId}\``);
  lines.push(`- **Ejecutado:** ${report.probedAt}`);
  lines.push("");
  lines.push("| Servicio | Estado | Dato leido | Variables que faltan |");
  lines.push("|---|---|---|---|");
  for (const result of report.results) {
    const missing = result.missing.length > 0 ? result.missing.map((m) => `\`${m}\``).join(", ") : "-";
    const detail = result.status === "failed" ? `ERROR: ${result.error ?? "(sin detalle)"}` : renderEvidence(result.evidence);
    lines.push(
      `| ${GOOGLE_PROBE_SERVICE_LABELS[result.service]} | \`${result.status}\` | ${detail} | ${missing} |`
    );
  }
  lines.push("");
  lines.push(
    "Leyenda: `live` = la API respondio en esta pasada. `missing_credentials` = falta configuracion, no se llamo a la API. `failed` = habia credenciales pero la llamada fallo. Ninguna llamada de este probe escribe nada en ningun sistema Google."
  );
  lines.push("");
  lines.push(
    `Los nombres que faltan se listan en su forma prefijada por cliente (\`${report.clientId.toUpperCase()}_<VARIABLE>\`), que es la convencion multi-cliente. Para el cliente por defecto sirve tambien la forma SIN prefijo (\`<VARIABLE>\`), que es la que ya usa el \`.env\` del VPS — configurar el secreto de GitHub con ese nombre corto es suficiente y evita renombrados.`
  );
  return lines.join("\n");
}
