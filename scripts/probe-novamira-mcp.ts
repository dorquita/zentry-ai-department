/**
 * DIAGNOSTICO READ-ONLY de la conexion con Novamira. Dos probes
 * separados y una interpretacion. No escribe nada, en ningun sistema.
 *
 * El primer intento devolvio 401 contra el endpoint MCP, y un 401 a
 * secas no distingue entre "la credencial no vale" y "la credencial no
 * llega / esa ruta espera otro esquema". Por eso se separan:
 *
 *   A. WORDPRESS CORE AUTH -- GET /wp-json/wp/v2/users/me?context=edit
 *      con las MISMAS credenciales. Responde a una unica pregunta:
 *      ¿WordPress reconoce usuario + Application Password?
 *
 *   B. NOVAMIRA MCP -- POST `initialize` al endpoint configurado.
 *
 * Cruzar las dos respuestas es lo que convierte un 401 opaco en un
 * diagnostico: si CORE pasa y MCP no, el problema esta en la ruta MCP o
 * en su permission callback, no en la credencial.
 *
 * SECRETOS -- reglas duras de este fichero:
 * - No se imprime jamas la URL, el host, el username, el password ni la
 *   cabecera Authorization.
 * - Del endpoint MCP solo se reporta el ULTIMO SEGMENTO de la ruta, y
 *   solo si encaja en un charset seguro. Nunca query params.
 * - La respuesta de /users/me trae nombre y email: NO se imprime ni se
 *   guarda. Solo se deriva un booleano.
 * - No se reportan longitudes de credenciales: no hay ninguna razon
 *   tecnica demostrada para hacerlo.
 * - Antes de imprimir, se verifica que la salida no contiene el valor de
 *   ninguno de los tres secretos.
 */
import * as dotenv from "dotenv";
dotenv.config();

/** Version del protocolo que declara el transporte de mcp-adapter v0.5.0. */
const MCP_PROTOCOL_VERSION = "2025-11-25";

/** Ruta canonica de Novamira para clientes con Application Password. */
const NOVAMIRA_MCP_PATH = "/wp-json/mcp/novamira";

/** Endpoint de core, autenticado y de SOLO LECTURA, para verificar la credencial. */
const CORE_AUTH_PATH = "/wp-json/wp/v2/users/me?context=edit";

const REQUIRED_VARS = ["WP_API_URL", "WP_API_USERNAME", "WP_API_PASSWORD"] as const;

export interface CoreAuthProbe {
  result: "OK" | "FAIL";
  httpStatus: number | null;
  authenticatedUserDetected: "YES" | "NO";
  /** Campo `code` del error de WordPress, saneado. Es un enum fijo, nunca datos del usuario. */
  errorCode: string;
  /** Esquema anunciado en WWW-Authenticate (Basic/Bearer/...), sin el realm. */
  authChallenge: string;
  note: string;
}

export interface McpProbe {
  result: "OK" | "FAIL";
  httpStatus: number | null;
  /** Ultimo segmento de la ruta, saneado. Distingue novamira / novamira-oauth / mcp-adapter-default-server. */
  routeSegment: string;
  errorCode: string;
  authChallenge: string;
  protocolVersion: string | null;
  serverName: string | null;
  sessionId: "present" | "absent";
  tools: string[];
  abilities: string[];
  note: string;
}

function requireEnv(): { url: string; username: string; password: string } {
  const missing = REQUIRED_VARS.filter((name) => !(process.env[name] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(`Faltan variables de configuracion: ${missing.join(", ")}. No se intenta ninguna conexion.`);
  }
  return {
    url: (process.env.WP_API_URL ?? "").trim(),
    username: (process.env.WP_API_USERNAME ?? "").trim(),
    password: (process.env.WP_API_PASSWORD ?? "").trim(),
  };
}

export function resolveMcpEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.includes("/wp-json/mcp/") ? trimmed : `${trimmed}${NOVAMIRA_MCP_PATH}`;
}

/** Origen del sitio (esquema + host), derivado de WP_API_URL. NUNCA se imprime. */
export function deriveSiteOrigin(raw: string): string {
  return new URL(raw.trim()).origin;
}

/**
 * Ultimo segmento de la ruta, saneado. Solo se reporta si encaja en un
 * charset conservador; cualquier otra cosa se oculta en vez de arriesgar
 * filtrar parte de la URL. Los query params se descartan siempre.
 */
export function sanitizeRouteSegment(raw: string): string {
  let pathname: string;
  try {
    pathname = new URL(raw.trim()).pathname;
  } catch {
    return "(ruta no parseable)";
  }
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1] ?? "";
  if (last.length === 0) return "(sin segmento final)";
  return /^[A-Za-z0-9._-]{1,64}$/.test(last) ? `/${last}` : "(segmento no reportable)";
}

function assertNoSecretLeak(text: string, secrets: string[]): void {
  for (const secret of secrets) {
    if (secret.length > 0 && text.includes(secret)) {
      throw new Error("Abortado antes de imprimir: la salida contenia el valor de un secreto. Esto nunca debe ocurrir.");
    }
  }
}

/**
 * Codigo de error de la respuesta, saneado. WordPress devuelve en `code`
 * un identificador de un enum fijo (`rest_not_logged_in`,
 * `incorrect_password`, ...): no lleva datos del usuario ni del sitio.
 * Aun asi se filtra contra un charset conservador, y el `message` -- que
 * SI puede llevar texto libre -- no se toca nunca.
 */
export function extractErrorCode(body: Record<string, unknown> | null): string {
  if (!body) return "(sin cuerpo)";
  const direct = body.code;
  const nested = ((body.error ?? {}) as Record<string, unknown>).code;
  const raw = typeof direct === "string" ? direct : typeof nested === "string" ? nested : typeof nested === "number" ? String(nested) : "";
  if (raw.length === 0) return "(sin code)";
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(raw) ? raw : "(code no reportable)";
}

/**
 * Esquema anunciado en WWW-Authenticate, SIN el realm: el realm puede
 * llevar el nombre del sitio, el esquema no lleva nada.
 */
export function extractAuthChallenge(header: string | null): string {
  if (!header) return "(sin cabecera WWW-Authenticate)";
  const scheme = header.trim().split(/[\s,]+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(scheme) ? scheme : "(esquema no reportable)";
}

/**
 * Interpreta el codigo REAL que devolvio WordPress. No se presupone
 * ninguno: un codigo que no este en esta tabla se reporta como no
 * reconocido, en vez de forzarlo dentro de una hipotesis.
 */
export function interpretErrorCode(code: string): string {
  const known: Record<string, string> = {
    rest_not_logged_in:
      "WordPress no vio NINGUNA credencial en la peticion. Apunta a que la cabecera Authorization se elimina antes de llegar a PHP (proxy, servidor web o WAF), no a que la credencial sea mala.",
    rest_cannot_view: "La credencial autentico, pero al usuario le falta el permiso para ese recurso. No es un problema de contrasena.",
    incorrect_password: "La credencial SI llego a WordPress y fue rechazada: la Application Password no es valida para ese usuario.",
    invalid_username: "La credencial SI llego a WordPress: el usuario indicado no existe.",
    invalid_email: "La credencial SI llego a WordPress: no hay ninguna cuenta con ese identificador.",
    application_passwords_disabled: "Las Application Passwords estan DESACTIVADAS en el sitio. Ninguna credencial de este tipo funcionara hasta habilitarlas.",
    application_passwords_disabled_for_user: "Las Application Passwords estan desactivadas PARA ESE USUARIO concreto.",
    invalid_application_password: "La Application Password no es valida o fue revocada.",
    application_password_not_allowed: "El sitio no permite Application Passwords en esta conexion (habitualmente por exigir HTTPS).",
    rest_no_route: "No hay ninguna ruta REST registrada ahi.",
    rest_forbidden: "Autenticado, pero sin permiso para esa operacion.",
  };
  return known[code] ?? `Codigo "${code}" no reconocido por este probe: NO se interpreta. Hay que mirarlo contra la documentacion de WordPress/Novamira antes de sacar conclusiones.`;
}

function describeStatus(status: number): string {
  if (status === 401) return "401 Unauthorized: la credencial no ha sido aceptada, o no ha llegado hasta WordPress.";
  if (status === 403) return "403 Forbidden: autenticado, pero sin el permiso que exige ese endpoint.";
  if (status === 404) return "404 Not Found: no hay nada registrado en esa ruta.";
  if (status === 405) return "405 Method Not Allowed: el metodo no esta permitido en esa ruta.";
  if (status >= 200 && status < 300) return `HTTP ${status}.`;
  return `HTTP ${status}: respuesta inesperada.`;
}

// --- A. WordPress Core -------------------------------------------------------

async function probeWordpressCoreAuth(origin: string, authHeader: string): Promise<CoreAuthProbe> {
  const probe: CoreAuthProbe = {
    result: "FAIL",
    httpStatus: null,
    authenticatedUserDetected: "NO",
    errorCode: "(no evaluado)",
    authChallenge: "(no evaluado)",
    note: "",
  };
  try {
    const response = await fetch(`${origin}${CORE_AUTH_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authHeader },
    });
    probe.httpStatus = response.status;
    probe.note = describeStatus(response.status);
    probe.authChallenge = extractAuthChallenge(response.headers.get("www-authenticate"));

    // El cuerpo trae nombre y email del usuario en el caso 2xx, y texto
    // libre en `message` en el caso de error: se lee para derivar UN
    // booleano y UN codigo de enum, y se descarta. Nada mas sale de aqui.
    const body = parseBody(await response.text());

    if (!response.ok) {
      probe.errorCode = extractErrorCode(body);
      return probe;
    }
    probe.errorCode = "(sin error)";
    const id = typeof body?.id === "number" ? body.id : 0;
    probe.authenticatedUserDetected = id > 0 ? "YES" : "NO";
    probe.result = id > 0 ? "OK" : "FAIL";
    if (id <= 0) probe.note = "Respuesta 2xx pero sin usuario identificable: no se puede afirmar que la credencial autentique.";
  } catch (err) {
    probe.note = `No se pudo completar la peticion: ${err instanceof Error ? err.message : String(err)}`;
  }
  return probe;
}

// --- B. Novamira MCP ---------------------------------------------------------

function parseBody(text: string): Record<string, unknown> | null {
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine) return null;
    try {
      return JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

async function jsonRpc(
  endpoint: string,
  authHeader: string,
  sessionId: string | null,
  method: string,
  id: number | null,
  params?: Record<string, unknown>
): Promise<{ status: number; sessionId: string | null; authChallenge: string | null; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: authHeader,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params) payload.params = params;
  if (id !== null) payload.id = id;

  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id"),
    authChallenge: response.headers.get("www-authenticate"),
    body: parseBody(await response.text()),
  };
}

function extractToolNames(body: Record<string, unknown> | null): string[] {
  const result = (body?.result ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(result.tools) ? result.tools : [];
  return tools.map((tool) => String((tool as Record<string, unknown>)?.name ?? "")).filter((name) => name.length > 0);
}

function extractAbilityNames(body: Record<string, unknown> | null): string[] {
  const result = (body?.result ?? {}) as Record<string, unknown>;
  const names = new Set<string>();
  const harvest = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) harvest(entry);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.name === "string" && record.name.includes("/")) names.add(record.name);
      for (const nested of Object.values(record)) harvest(nested);
    }
  };
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content) {
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") {
      try {
        harvest(JSON.parse(record.text));
      } catch {
        /* texto no-JSON: no se fuerza ninguna interpretacion */
      }
    }
    harvest(record.structuredContent);
  }
  harvest(result.structuredContent);
  return [...names].sort();
}

async function probeNovamiraMcp(endpoint: string, authHeader: string, routeSegment: string): Promise<McpProbe> {
  const probe: McpProbe = {
    result: "FAIL",
    httpStatus: null,
    routeSegment,
    errorCode: "(no evaluado)",
    authChallenge: "(no evaluado)",
    protocolVersion: null,
    serverName: null,
    sessionId: "absent",
    tools: [],
    abilities: [],
    note: "",
  };

  try {
    const init = await jsonRpc(endpoint, authHeader, null, "initialize", 1, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "zentry-ai-department-probe", version: "1.0.0" },
    });
    probe.httpStatus = init.status;
    probe.note = describeStatus(init.status);
    probe.authChallenge = extractAuthChallenge(init.authChallenge);
    probe.errorCode = init.status >= 400 ? extractErrorCode(init.body) : "(sin error)";

    if (init.status >= 400 || !init.body) return probe;
    if (init.body.error) {
      probe.note = `El servidor MCP respondio con error de protocolo en initialize: ${JSON.stringify(init.body.error)}`;
      return probe;
    }

    const initResult = (init.body.result ?? {}) as Record<string, unknown>;
    probe.protocolVersion = typeof initResult.protocolVersion === "string" ? initResult.protocolVersion : null;
    const serverInfo = (initResult.serverInfo ?? {}) as Record<string, unknown>;
    probe.serverName = typeof serverInfo.name === "string" ? serverInfo.name : null;
    probe.sessionId = init.sessionId ? "present" : "absent";
    probe.result = "OK";

    // Solo si initialize paso: censo real, todo lectura.
    await jsonRpc(endpoint, authHeader, init.sessionId, "notifications/initialized", null);
    probe.tools = extractToolNames((await jsonRpc(endpoint, authHeader, init.sessionId, "tools/list", 2, {})).body);
    if (probe.tools.includes("mcp-adapter/discover-abilities")) {
      const abilities = await jsonRpc(endpoint, authHeader, init.sessionId, "tools/call", 3, {
        name: "mcp-adapter/discover-abilities",
        arguments: {},
      });
      probe.abilities = extractAbilityNames(abilities.body);
    }
  } catch (err) {
    probe.note = `No se pudo completar la peticion: ${err instanceof Error ? err.message : String(err)}`;
  }
  return probe;
}

// --- Interpretacion ----------------------------------------------------------

export function interpret(core: CoreAuthProbe, mcp: McpProbe): string {
  if (core.result === "OK" && mcp.result === "OK") {
    return "Credencial valida y MCP operativo. Continuar con el censo completo de abilities.";
  }
  if (core.result === "OK" && mcp.result === "FAIL") {
    return (
      "La credencial es VALIDA y la cabecera Authorization SI llega a WordPress (core la acepto). " +
      "El fallo es especifico de la ruta MCP: investigar la ruta configurada, el esquema de auth que espera esa ruta " +
      "(la ruta -oauth espera Bearer, no Basic), el permission callback del transporte (current_user_can, por defecto 'read') " +
      "y la configuracion de Novamira/MCP Adapter. NO es un problema de credenciales."
    );
  }
  if (core.result === "FAIL" && mcp.result === "FAIL") {
    return (
      "Core tambien rechaza la credencial, asi que todavia no se puede culpar a Novamira. " +
      "Investigar: Application Password revocado o incorrecto, username incorrecto, o la cabecera Authorization " +
      "eliminada por un proxy, el servidor web o un WAF antes de llegar a PHP."
    );
  }
  return (
    "Caso inesperado: el MCP responde pero core no. Sugiere que la ruta MCP acepta un esquema de auth distinto " +
    "del que core exige, o que hay una capa intermedia tratando ambas rutas de forma diferente."
  );
}

async function main(): Promise<void> {
  const { url, username, password } = requireEnv();
  const secrets = [url, username, password];
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  let origin: string;
  let endpoint: string;
  let routeSegment: string;
  try {
    origin = deriveSiteOrigin(url);
    endpoint = resolveMcpEndpoint(url);
    routeSegment = sanitizeRouteSegment(endpoint);
  } catch {
    throw new Error("WP_API_URL no es una URL valida. No se intenta ninguna conexion.");
  }

  const core = await probeWordpressCoreAuth(origin, authHeader);
  const mcp = await probeNovamiraMcp(endpoint, authHeader, routeSegment);

  const report = {
    WORDPRESS_CORE_AUTH: core.result,
    CORE_HTTP_STATUS: core.httpStatus,
    authenticatedUserDetected: core.authenticatedUserDetected,
    CORE_ERROR_CODE: core.errorCode,
    CORE_ERROR_CODE_SIGNIFICADO: core.errorCode.startsWith("(") ? "(sin code que interpretar)" : interpretErrorCode(core.errorCode),
    CORE_AUTH_CHALLENGE: core.authChallenge,
    CORE_NOTE: core.note,
    NOVAMIRA_MCP_AUTH: mcp.result,
    MCP_HTTP_STATUS: mcp.httpStatus,
    MCP_ROUTE_SEGMENT: mcp.routeSegment,
    MCP_ERROR_CODE: mcp.errorCode,
    MCP_ERROR_CODE_SIGNIFICADO: mcp.errorCode.startsWith("(") ? "(sin code que interpretar)" : interpretErrorCode(mcp.errorCode),
    MCP_AUTH_CHALLENGE: mcp.authChallenge,
    MCP_PROTOCOL_VERSION: mcp.protocolVersion,
    MCP_SERVER_NAME: mcp.serverName,
    MCP_SESSION: mcp.sessionId,
    MCP_TOOLS: mcp.tools,
    MCP_ABILITIES: mcp.abilities,
    MCP_NOTE: mcp.note,
    INTERPRETACION: interpret(core, mcp),
    escrituras: { staging: 0, produccion: 0 },
  };

  const output = JSON.stringify(report, null, 2);
  assertNoSecretLeak(output, secrets);
  console.log("NOVAMIRA_PROBE_JSON=" + JSON.stringify(report));
  console.log(output);

  if (core.result !== "OK" || mcp.result !== "OK") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Probe abortado: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
