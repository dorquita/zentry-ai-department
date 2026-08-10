/**
 * Fase O16 — Client Config. Primera capa de abstraccion multi-cliente:
 * separa la CONFIGURACION de negocio (que hoy vive mezclada entre
 * config/*.json y variables sueltas de .env) de la logica del CORE.
 *
 * Estado honesto de esta fase (ver docs/multi-client-architecture.md):
 * este modulo define el esquema, lo carga y lo valida, y ya lo usa de
 * verdad el orquestador diario (`scripts/run-daily-growth-department.ts`)
 * para decidir cliente + modo sandbox. Los 26 agentes/adaptadores
 * individuales SIGUEN leyendo `config/*.json` y variables de entorno
 * directamente, exactamente igual que antes — todavia NO consultan
 * `ClientConfig`. Migrarlos es la Fase O16.1, deliberadamente pospuesta
 * para no arriesgar comportamiento ya verificado en produccion.
 *
 * Compatibilidad: si CLIENT_ID no esta definido (ni --client), el
 * sistema usa "zentry" — el comportamiento de hoy no cambia para nadie
 * que no pase el flag explicitamente.
 */
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const CLIENTS_DIR = path.join(PROJECT_ROOT, "clients");
export const DEFAULT_CLIENT_ID = "zentry";

/**
 * Catalogo cerrado de servicios/agentes conocidos por la plataforma hoy
 * (coincide 1:1 con los pasos de `scripts/run-daily-growth-department.ts`
 * mas el Telegram Gateway). Sirve para validar `allowedServices` de
 * cualquier cliente contra nombres reales, nunca contra texto libre.
 */
export const KNOWN_SERVICES = [
  "seo_watcher",
  "seo_director",
  "competitor_intelligence",
  "content_planner",
  "cro_landing_reviewer",
  "sem_watcher",
  "analytics_watcher",
  "approval_queue",
  "approved_action_planner",
  "seo_work_order_builder",
  "content_work_order_builder",
  "cro_work_order_builder",
  "seo_change_pack_builder",
  "content_change_pack_builder",
  "cro_change_pack_builder",
  "ux_ui_landing_architect",
  "wordpress_draft_agent",
  "visual_template_builder",
  "visual_asset_planner",
  "staging_executor",
  "staging_qa_agent",
  "approval_gateway",
  "production_deployment_planner",
  "production_draft_executor",
  "growth_director",
  "telegram_gateway",
] as const;

export type KnownService = (typeof KNOWN_SERVICES)[number];

export interface ClientConfigPaths {
  brandPositioning: string;
  competitors: string;
  autonomyPolicy: string;
  notificationPolicy: string;
  templates: string;
  seo: string;
  analytics: string;
  ads: string;
  wordpress: string;
}

export interface ClientNotificationSettings {
  telegramEnabledEnvVar: string;
  telegramBotTokenEnvVar: string;
  telegramChatIdEnvVar: string;
  reportEmailToEnvVar: string;
}

export interface ClientConfig {
  clientId: string;
  clientName: string;
  brandName: string;
  secondaryBrands: string[];
  productionUrl: string;
  stagingUrl: string | null;
  /**
   * true = cliente de demostracion/sandbox: el orquestador diario nunca
   * invoca ningun agente real para este cliente, solo valida estructura
   * y config (ver runDryRunOnlyPass en run-daily-growth-department.ts).
   */
  isSandbox: boolean;
  allowedServices: KnownService[];
  configPaths: ClientConfigPaths;
  notificationSettings: ClientNotificationSettings;
  wiringStatus: "not_wired" | "orchestrator_only";
  createdAt: string;
  notes?: string;
}

export class ClientConfigError extends Error {}

function clientDir(clientId: string): string {
  return path.join(CLIENTS_DIR, clientId);
}

function clientConfigFile(clientId: string): string {
  return path.join(clientDir(clientId), "client.config.json");
}

/** Solo lectura de disco: no crea ni modifica nada. */
export function listClientIds(): string[] {
  if (!fs.existsSync(CLIENTS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(CLIENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function clientExists(clientId: string): boolean {
  return fs.existsSync(clientConfigFile(clientId));
}

/**
 * Resuelve el clientId activo: `--client <id>` (argv) tiene prioridad
 * sobre `CLIENT_ID` (env), que a su vez tiene prioridad sobre el
 * fallback fijo "zentry". Nunca lanza — siempre devuelve un string.
 */
export function resolveClientId(argv: string[] = process.argv.slice(2)): string {
  const flagIndex = argv.indexOf("--client");
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (value && !value.startsWith("--")) {
      return value.trim();
    }
  }
  const envValue = (process.env.CLIENT_ID ?? "").trim();
  if (envValue) {
    return envValue;
  }
  return DEFAULT_CLIENT_ID;
}

/**
 * Carga el ClientConfig de `clientId`. Si `strict` es false (por
 * defecto — el modo que usa el pase diario automatico) y el cliente
 * pedido no existe, cae de forma segura a "zentry" con un warning, en
 * vez de romper una ejecucion automatica por un CLIENT_ID mal escrito.
 * Si `strict` es true (comandos de validacion/listado invocados a
 * mano), un cliente inexistente es un error explicito.
 */
export function loadClientConfig(clientId: string, options: { strict?: boolean } = {}): ClientConfig {
  const strict = options.strict ?? false;
  const file = clientConfigFile(clientId);

  if (!fs.existsSync(file)) {
    if (strict) {
      throw new ClientConfigError(
        `No existe clients/${clientId}/client.config.json. Clientes disponibles: ${listClientIds().join(", ") || "(ninguno)"}.`
      );
    }
    if (clientId === DEFAULT_CLIENT_ID) {
      throw new ClientConfigError(
        `No existe clients/${DEFAULT_CLIENT_ID}/client.config.json — falta la configuracion base del sistema.`
      );
    }
    console.warn(
      `[client-config] Aviso: clients/${clientId}/client.config.json no existe. Fallback seguro a "${DEFAULT_CLIENT_ID}".`
    );
    return loadClientConfig(DEFAULT_CLIENT_ID, { strict: true });
  }

  const raw = fs.readFileSync(file, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ClientConfigError(
      `clients/${clientId}/client.config.json no es JSON valido: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return parsed as ClientConfig;
}

export interface ClientValidationIssue {
  clientId: string;
  field: string;
  message: string;
}

const SECRET_LOOKING_KEY = /(token|secret|pass|api[_-]?key|key(?!word)|password)/i;
const PLACEHOLDER_VALUE_RE = /env_var|not[_-]?set|todo|pending|\.invalid$|\.example$|\.test$/i;

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Recorre recursivamente un objeto JSON en busca de valores con pinta de secreto real bajo una clave sensible. */
function scanForLeakedSecrets(obj: unknown, filePath: string, trail: string[] = []): ClientValidationIssue[] {
  const issues: ClientValidationIssue[] = [];
  if (obj === null || typeof obj !== "object") {
    return issues;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const nextTrail = [...trail, key];
    if (typeof value === "string" && SECRET_LOOKING_KEY.test(key) && !key.toLowerCase().endsWith("envvar")) {
      const looksLikePlaceholder = value.length === 0 || PLACEHOLDER_VALUE_RE.test(value);
      if (!looksLikePlaceholder) {
        issues.push({
          clientId: "",
          field: `${filePath}#${nextTrail.join(".")}`,
          message: `Clave con nombre sensible ("${key}") tiene un valor literal en el JSON del repo — los secretos van solo en variables de entorno, nunca en clients/**/*.json.`,
        });
      }
    } else if (typeof value === "object" && value !== null) {
      issues.push(...scanForLeakedSecrets(value, filePath, nextTrail));
    }
  }
  return issues;
}

/**
 * Valida un ClientConfig ya cargado: campos obligatorios, URLs bien
 * formadas, servicios permitidos contra el catalogo cerrado, ficheros
 * de config referenciados que existen de verdad, y ausencia de
 * secretos literales en el JSON. Pura funcion de lectura — nunca
 * escribe ni ejecuta nada.
 */
export function validateClientConfig(config: ClientConfig): ClientValidationIssue[] {
  const issues: ClientValidationIssue[] = [];
  const push = (field: string, message: string) => issues.push({ clientId: config.clientId ?? "(desconocido)", field, message });

  if (!config.clientId) push("clientId", "clientId es obligatorio.");
  if (!config.clientName) push("clientName", "clientName es obligatorio.");
  if (!config.brandName) push("brandName", "brandName es obligatorio.");
  if (typeof config.isSandbox !== "boolean") push("isSandbox", "isSandbox debe ser boolean explicito.");

  if (!config.productionUrl || !isValidUrl(config.productionUrl)) {
    push("productionUrl", `productionUrl invalida o ausente: "${config.productionUrl}".`);
  }
  if (config.stagingUrl !== null && config.stagingUrl !== undefined && !isValidUrl(config.stagingUrl)) {
    push("stagingUrl", `stagingUrl invalida: "${config.stagingUrl}".`);
  }

  if (config.isSandbox) {
    const prodHost = (() => {
      try {
        return new URL(config.productionUrl).hostname;
      } catch {
        return "";
      }
    })();
    if (prodHost && !/\.(invalid|example|test)$/i.test(prodHost) && prodHost !== "localhost") {
      push(
        "productionUrl",
        `Cliente sandbox (isSandbox:true) con productionUrl a un dominio real ("${prodHost}"). Usa un dominio .invalid/.example/.test para clientes de demostracion.`
      );
    }
  }

  if (!Array.isArray(config.allowedServices)) {
    push("allowedServices", "allowedServices debe ser un array.");
  } else {
    for (const service of config.allowedServices) {
      if (!(KNOWN_SERVICES as readonly string[]).includes(service)) {
        push("allowedServices", `Servicio desconocido "${service}". Catalogo valido: ${KNOWN_SERVICES.join(", ")}.`);
      }
    }
    if (config.isSandbox && config.allowedServices.length > 0) {
      push("allowedServices", "Cliente sandbox (isSandbox:true) no deberia tener servicios reales habilitados.");
    }
  }

  const dir = clientDir(config.clientId ?? "");
  if (config.configPaths) {
    for (const [key, relPath] of Object.entries(config.configPaths)) {
      if (!relPath) {
        push(`configPaths.${key}`, "Ruta vacia.");
        continue;
      }
      const abs = path.isAbsolute(relPath) ? relPath : path.join(PROJECT_ROOT, relPath);
      if (!fs.existsSync(abs)) {
        push(`configPaths.${key}`, `No existe el fichero referenciado: ${relPath}`);
      }
    }
  } else {
    push("configPaths", "configPaths es obligatorio.");
  }

  if (!config.notificationSettings) {
    push("notificationSettings", "notificationSettings es obligatorio.");
  } else {
    for (const field of [
      "telegramEnabledEnvVar",
      "telegramBotTokenEnvVar",
      "telegramChatIdEnvVar",
      "reportEmailToEnvVar",
    ] as const) {
      const value = config.notificationSettings[field];
      if (!value || typeof value !== "string") {
        push(`notificationSettings.${field}`, "Debe ser el NOMBRE de una variable de entorno (nunca el valor/secreto).");
      } else if (value !== value.toUpperCase()) {
        push(
          `notificationSettings.${field}`,
          `"${value}" no parece nombre de variable de entorno (deberia ir en MAYUSCULAS_CON_GUION_BAJO).`
        );
      }
    }
  }

  // Escaneo de secretos: sobre el propio client.config.json y sobre cada
  // fichero JSON referenciado en configPaths que viva dentro de clients/<id>/.
  issues.push(...scanForLeakedSecrets(config, `clients/${config.clientId}/client.config.json`).map((i) => ({ ...i, clientId: config.clientId })));
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const full = path.join(dir, entry);
      try {
        const parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
        issues.push(...scanForLeakedSecrets(parsed, `clients/${config.clientId}/${entry}`).map((i) => ({ ...i, clientId: config.clientId })));
      } catch (err) {
        push(entry, `JSON invalido: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return issues;
}

export function isServiceAllowed(config: ClientConfig, service: KnownService): boolean {
  return !config.isSandbox && config.allowedServices.includes(service);
}

let cachedActiveConfig: ClientConfig | null = null;

/**
 * Fase O16.1 — ClientConfig del cliente ACTIVO del proceso actual
 * (mismo `resolveClientId()` que usa `resolveActiveClientPaths()` en
 * client-paths.ts), memoizado una sola vez por proceso. No estricto:
 * si el cliente pedido no existe, cae de forma segura a "zentry" (ver
 * `loadClientConfig`).
 */
export function resolveActiveClientConfig(): ClientConfig {
  if (cachedActiveConfig) {
    return cachedActiveConfig;
  }
  cachedActiveConfig = loadClientConfig(resolveClientId());
  return cachedActiveConfig;
}

/**
 * Fase O16.1 — resuelve un fichero de `configPaths` del ClientConfig
 * ACTIVO a una ruta absoluta. Punto de entrada compartido que usan los
 * modulos que antes leian `config/<algo>.json` con una ruta fija
 * relativa a `__dirname` (brand-intent-router.ts, competitor-
 * intelligence.ts, y los que se vayan migrando en lotes sucesivos).
 * Para "zentry" apunta hoy a `clients/zentry/<algo>.json` (una copia
 * mantenida en sincronia manual con `config/<algo>.json` — ver nota en
 * cada fichero de `clients/zentry/`), no al `config/` original.
 */
export function resolveActiveClientConfigPath(key: keyof ClientConfigPaths): string {
  const config = resolveActiveClientConfig();
  const relPath = config.configPaths[key];
  return path.join(PROJECT_ROOT, relPath);
}

/** Fase O16.1 — resuelve una ruta relativa a la raiz del proyecto (util para rutas leidas de dentro de un fichero de cliente, ej. seo.json). */
export function resolveProjectPath(relPath: string): string {
  return path.join(PROJECT_ROOT, relPath);
}

/** Fase O16.1 — forma de `clients/<id>/seo.json` (ver Lote 4, docs/multi-client-architecture.md). */
export interface ClientSeoConfig {
  searchConsoleSiteUrl: string | null;
  lookbackDays: number;
  targetKeywordsConfigPath: string | null;
  thresholdsConfigPath: string | null;
}

let cachedActiveSeoConfig: ClientSeoConfig | null = null;

/** Lee `configPaths.seo` del ClientConfig ACTIVO, memoizado una sola vez por proceso. */
export function loadActiveClientSeoConfig(): ClientSeoConfig {
  if (cachedActiveSeoConfig) {
    return cachedActiveSeoConfig;
  }
  const raw = fs.readFileSync(resolveActiveClientConfigPath("seo"), "utf-8");
  cachedActiveSeoConfig = JSON.parse(raw) as ClientSeoConfig;
  return cachedActiveSeoConfig;
}

/** Fase O16.1 Lote 5 — forma de `clients/<id>/analytics.json`. */
export interface ClientAnalyticsConfig {
  ga4PropertyId: string | null;
  ga4MeasurementId: string | null;
  gtmContainerId: string | null;
  gtmWorkspaceId: string | null;
  trackedEventsConfigPath: string | null;
}

let cachedActiveAnalyticsConfig: ClientAnalyticsConfig | null = null;

/** Lee `configPaths.analytics` del ClientConfig ACTIVO, memoizado una sola vez por proceso. */
export function loadActiveClientAnalyticsConfig(): ClientAnalyticsConfig {
  if (cachedActiveAnalyticsConfig) {
    return cachedActiveAnalyticsConfig;
  }
  const raw = fs.readFileSync(resolveActiveClientConfigPath("analytics"), "utf-8");
  cachedActiveAnalyticsConfig = JSON.parse(raw) as ClientAnalyticsConfig;
  return cachedActiveAnalyticsConfig;
}

/** Fase O16.1 Lote 5 — forma de `clients/<id>/ads.json`. */
export interface ClientAdsConfig {
  customerId: string | null;
  loginCustomerId: string | null;
  apiVersion: string | null;
  campaignStateConfigPath: string | null;
}

let cachedActiveAdsConfig: ClientAdsConfig | null = null;

/** Lee `configPaths.ads` del ClientConfig ACTIVO, memoizado una sola vez por proceso. */
export function loadActiveClientAdsConfig(): ClientAdsConfig {
  if (cachedActiveAdsConfig) {
    return cachedActiveAdsConfig;
  }
  const raw = fs.readFileSync(resolveActiveClientConfigPath("ads"), "utf-8");
  cachedActiveAdsConfig = JSON.parse(raw) as ClientAdsConfig;
  return cachedActiveAdsConfig;
}

/** Fase O16.2 — atajo para `resolveActiveClientConfig().clientId`. */
export function resolveActiveClientId(): string {
  return resolveActiveClientConfig().clientId;
}

/**
 * Fase O16.2 — Esquema de credenciales multi-cliente.
 *
 * Convencion: `<CLIENTID_MAYUSCULAS>_<NOMBRE_EXACTO_DE_HOY>` — NUNCA se
 * renombra la clave (ej. `ZENTRY_GOOGLE_ADS_DEVELOPER_TOKEN`, no una
 * forma abreviada tipo `ZENTRY_GOOGLE_ADS_TOKEN`), para que anadir el
 * prefijo sea la UNICA diferencia y cero riesgo de mapear mal una
 * credencial. (El enunciado de O16.2 daba un ejemplo con nombres algo
 * mas cortos tipo `ZENTRY_GSC_CLIENT_ID` — se interpreta como ejemplo
 * ilustrativo, no como los nombres exactos exigidos, dado que ademas
 * incluye variables que hoy no existen en ningun adaptador real, ej.
 * `GTM_ACCOUNT_ID`.)
 *
 * `TELEGRAM_*`/`REPORT_EMAIL_TO` NO usan este prefijo: ya tienen su
 * propio mecanismo, mas flexible (nombre de variable completo
 * configurable via `notificationSettings`, Fase O16.1 Lote 6) — anadir
 * un prefijo aqui ademas crearia dos convenciones compitiendo sobre el
 * mismo dato.
 */
export function resolveClientEnvVarName(clientId: string, key: string): string {
  return `${clientId.toUpperCase()}_${key}`;
}

/**
 * Prefiere `<CLIENTID>_<key>`; si no existe Y `clientId === "zentry"`
 * (el unico cliente con historico real hoy), cae a `<key>` sin prefijo
 * — asi el `.env` real de hoy sigue funcionando sin tocarlo. Para
 * cualquier otro cliente NO hay fallback: aislamiento real entre
 * clientes (un cliente nuevo nunca "hereda" por accidente la
 * credencial de otro).
 */
export function resolveClientEnvVar(clientId: string, key: string): string | undefined {
  const prefixed = process.env[resolveClientEnvVarName(clientId, key)];
  if (prefixed) {
    return prefixed;
  }
  if (clientId === DEFAULT_CLIENT_ID) {
    return process.env[key];
  }
  return undefined;
}

/** Como `resolveClientEnvVar`, pero lanza con un mensaje claro (nunca imprime el valor) si falta. */
export function resolveClientSecret(clientId: string, key: string): string {
  const value = resolveClientEnvVar(clientId, key);
  if (!value) {
    const prefixedName = resolveClientEnvVarName(clientId, key);
    const legacyNote =
      clientId === DEFAULT_CLIENT_ID ? ` (o, como fallback legacy, la variable sin prefijo "${key}")` : "";
    throw new Error(
      `Falta la variable de entorno ${prefixedName}${legacyNote} para el cliente "${clientId}". Revisa .env.example.`
    );
  }
  return value;
}

/**
 * Catalogo cerrado de que variables (nombres SIN prefijo, el prefijo se
 * añade en `resolveClientServiceCredentials`) hacen falta para cada
 * servicio externo. Deliberadamente NO incluye Telegram/email "to" (ver
 * nota de arriba).
 */
export const CLIENT_SERVICE_CREDENTIAL_KEYS = {
  wordpress_staging: ["WORDPRESS_USERNAME", "WORDPRESS_APP_PASSWORD"],
  wordpress_production: ["WORDPRESS_PRODUCTION_USERNAME", "WORDPRESS_PRODUCTION_APP_PASSWORD"],
  search_console: ["GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET", "GSC_OAUTH_REFRESH_TOKEN"],
  google_ads: [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_OAUTH_CLIENT_ID",
    "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
    "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  ],
  ga4: [
    "GOOGLE_ANALYTICS_OAUTH_CLIENT_ID",
    "GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET",
    "GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN",
    "GA4_PROPERTY_ID",
  ],
  gtm: [
    "GOOGLE_ANALYTICS_OAUTH_CLIENT_ID",
    "GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET",
    "GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN",
    "GTM_CONTAINER_ID",
    "GTM_WORKSPACE_ID",
  ],
  smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "REPORT_EMAIL_FROM"],
} as const;

export type ClientCredentialService = keyof typeof CLIENT_SERVICE_CREDENTIAL_KEYS;

export interface ClientServiceCredentialsStatus {
  service: ClientCredentialService;
  complete: boolean;
  /** Nombres de variable YA PREFIJADOS que faltan — nunca valores. */
  missing: string[];
}

/**
 * Comprueba si `clientId` tiene TODAS las variables que necesita
 * `service`, sin exponer ningun valor. Pura funcion de lectura de
 * `process.env`, nunca lanza (a diferencia de `resolveClientSecret`) —
 * pensada para gates tipo "conectado=true/false", no para resolver el
 * valor en si.
 */
export function resolveClientServiceCredentials(
  clientId: string,
  service: ClientCredentialService
): ClientServiceCredentialsStatus {
  const keys = CLIENT_SERVICE_CREDENTIAL_KEYS[service];
  const missing: string[] = [];
  for (const key of keys) {
    if (!resolveClientEnvVar(clientId, key)) {
      missing.push(resolveClientEnvVarName(clientId, key));
    }
  }
  return { service, complete: missing.length === 0, missing };
}
