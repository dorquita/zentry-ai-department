/**
 * PROBE READ-ONLY del MCP de Novamira. Diagnostico, no un cliente.
 *
 * Lo unico que hace: abrir la sesion MCP, listar los tools que el
 * servidor expone de verdad, y pedir el censo de abilities. Tres
 * llamadas, todas de lectura. No escribe en WordPress, no ejecuta
 * ninguna ability de escritura y no toca produccion.
 *
 * Por que `fetch` a pelo y no el SDK oficial: el transporte de este
 * servidor (WP\MCP\Transport\HttpTransport, mcp-adapter v0.5.0)
 * implementa POST + sesiones y responde 405 al GET -- su propio codigo
 * dice "SSE (GET streaming) is not yet implemented". Un cliente que
 * intente abrir la pata SSE se choca contra ese 405. POST JSON-RPC es
 * exactamente lo que este servidor habla, y no arrastra ninguna
 * dependencia nueva.
 *
 * SECRETOS: este script nunca imprime el valor de WP_API_URL,
 * WP_API_USERNAME ni WP_API_PASSWORD. Reporta la FORMA de la URL
 * (si ya era el endpoint MCP o hubo que derivarlo) y su host, nunca la
 * cadena completa con credenciales ni la ruta entera. Antes de imprimir
 * nada comprueba que el texto no contiene ninguno de los tres valores.
 */
import * as dotenv from "dotenv";
dotenv.config();

/** Ruta canonica que Novamira registra para clientes con Application Password. */
const NOVAMIRA_MCP_PATH = "/wp-json/mcp/novamira";

/** Version del protocolo que declara el transporte de mcp-adapter v0.5.0. */
const MCP_PROTOCOL_VERSION = "2025-11-25";

const REQUIRED_VARS = ["WP_API_URL", "WP_API_USERNAME", "WP_API_PASSWORD"] as const;

interface ProbeResult {
  connection: "OK" | "FAIL";
  endpointForm: string;
  host: string;
  transport: string;
  httpStatus: number | null;
  protocolVersion: string | null;
  serverName: string | null;
  sessionId: "present" | "absent";
  tools: string[];
  abilities: string[];
  error: string | null;
}

function requireEnv(): { url: string; username: string; password: string } {
  const missing = REQUIRED_VARS.filter((name) => !(process.env[name] ?? "").trim());
  if (missing.length > 0) {
    // Solo NOMBRES, jamas valores.
    throw new Error(`Faltan variables de configuracion: ${missing.join(", ")}. No se intenta ninguna conexion.`);
  }
  return {
    url: (process.env.WP_API_URL ?? "").trim(),
    username: (process.env.WP_API_USERNAME ?? "").trim(),
    password: (process.env.WP_API_PASSWORD ?? "").trim(),
  };
}

/**
 * WP_API_URL puede venir ya como endpoint MCP completo o como URL base
 * del sitio. Se acepta cualquiera de las dos y se REPORTA cual era, sin
 * exponer el valor -- asi no hay que preguntar por un secret que ya
 * existe.
 */
export function resolveMcpEndpoint(raw: string): { endpoint: string; form: string } {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.includes("/wp-json/mcp/")) {
    return { endpoint: trimmed, form: "WP_API_URL ya era el endpoint MCP completo (contiene /wp-json/mcp/...)" };
  }
  return {
    endpoint: `${trimmed}${NOVAMIRA_MCP_PATH}`,
    form: `WP_API_URL era la URL base del sitio; se le ha anadido la ruta canonica ${NOVAMIRA_MCP_PATH}`,
  };
}

/** Nunca dejar salir por consola el valor de un secreto, ni por accidente. */
function assertNoSecretLeak(text: string, secrets: string[]): void {
  for (const secret of secrets) {
    if (secret.length > 0 && text.includes(secret)) {
      throw new Error("Abortado antes de imprimir: la salida contenia el valor de un secreto. Esto nunca debe ocurrir.");
    }
  }
}

interface JsonRpcCall {
  endpoint: string;
  authHeader: string;
  sessionId: string | null;
  method: string;
  params?: Record<string, unknown>;
  id?: number | null;
}

async function jsonRpc(call: JsonRpcCall): Promise<{ status: number; sessionId: string | null; body: Record<string, unknown> | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // El transporte responde JSON; se declara tambien event-stream porque
    // es lo que pide la forma HTTP del protocolo.
    Accept: "application/json, text/event-stream",
    Authorization: call.authHeader,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  if (call.sessionId) headers["Mcp-Session-Id"] = call.sessionId;

  const payload: Record<string, unknown> = { jsonrpc: "2.0", method: call.method };
  if (call.params) payload.params = call.params;
  // Una notificacion (id ausente) no lleva id; una peticion si.
  if (call.id !== null && call.id !== undefined) payload.id = call.id;

  const response = await fetch(call.endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const sessionId = response.headers.get("mcp-session-id");
  const text = await response.text();

  let body: Record<string, unknown> | null = null;
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Respuesta enmarcada como SSE (`data: {...}`): se extrae el primer
      // evento con JSON, que es lo unico que este probe necesita.
      const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
      if (dataLine) {
        try {
          body = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        } catch {
          body = null;
        }
      }
    }
  }
  return { status: response.status, sessionId, body };
}

function describeHttpFailure(status: number): string {
  if (status === 401) return "401 Unauthorized: las credenciales de Application Password no han sido aceptadas (usuario o password incorrectos, o Application Passwords deshabilitado).";
  if (status === 403) return "403 Forbidden: autenticado, pero el usuario no supera el capability check del transporte (current_user_can, por defecto 'read').";
  if (status === 404) return "404 Not Found: no hay ningun servidor MCP registrado en esa ruta. Revisa que el plugin Novamira este activo y que la ruta sea /wp-json/mcp/novamira.";
  if (status === 405) return "405 Method Not Allowed: el servidor rechaza el metodo. Este transporte solo acepta POST (GET/SSE no esta implementado en mcp-adapter v0.5.0).";
  return `HTTP ${status}: respuesta inesperada del endpoint MCP.`;
}

function extractToolNames(body: Record<string, unknown> | null): string[] {
  const result = (body?.result ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(result.tools) ? result.tools : [];
  return tools.map((tool) => String((tool as Record<string, unknown>)?.name ?? "")).filter((name) => name.length > 0);
}

/**
 * El despachador `mcp-adapter/execute-ability` envuelve toda respuesta en
 * `{ success: true, data: ... }` y el resultado MCP llega como bloques de
 * contenido. Se busca el censo de abilities sin asumir una sola forma:
 * si no se reconoce, se devuelve vacio y se dice, en vez de inventarlo.
 */
function extractAbilityNames(body: Record<string, unknown> | null): string[] {
  const result = (body?.result ?? {}) as Record<string, unknown>;
  const content = Array.isArray(result.content) ? result.content : [];
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
      return;
    }
  };

  for (const block of content) {
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") {
      try {
        harvest(JSON.parse(record.text));
      } catch {
        // Texto no-JSON: no se fuerza ninguna interpretacion.
      }
    }
    harvest(record.structuredContent);
  }
  harvest(result.structuredContent);
  return [...names].sort();
}

async function main(): Promise<void> {
  const { url, username, password } = requireEnv();
  const secrets = [url, username, password];
  const { endpoint, form } = resolveMcpEndpoint(url);
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  let host = "(no parseable)";
  try {
    host = new URL(endpoint).host;
  } catch {
    throw new Error("WP_API_URL no es una URL valida. No se intenta ninguna conexion.");
  }

  const probe: ProbeResult = {
    connection: "FAIL",
    endpointForm: form,
    host,
    transport: "HTTP POST (JSON-RPC 2.0), sin SSE -- GET no implementado en este transporte",
    httpStatus: null,
    protocolVersion: null,
    serverName: null,
    sessionId: "absent",
    tools: [],
    abilities: [],
    error: null,
  };

  try {
    // 1. initialize -- abre la sesion y devuelve la version de protocolo real.
    const init = await jsonRpc({
      endpoint,
      authHeader,
      sessionId: null,
      method: "initialize",
      id: 1,
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "zentry-ai-department-probe", version: "1.0.0" },
      },
    });
    probe.httpStatus = init.status;

    if (init.status >= 400 || !init.body) {
      probe.error = describeHttpFailure(init.status);
      throw new Error(probe.error);
    }
    if (init.body.error) {
      probe.error = `El servidor MCP devolvio un error en initialize: ${JSON.stringify(init.body.error)}`;
      throw new Error(probe.error);
    }

    const initResult = (init.body.result ?? {}) as Record<string, unknown>;
    probe.protocolVersion = typeof initResult.protocolVersion === "string" ? initResult.protocolVersion : null;
    const serverInfo = (initResult.serverInfo ?? {}) as Record<string, unknown>;
    probe.serverName = typeof serverInfo.name === "string" ? serverInfo.name : null;
    const sessionId = init.sessionId;
    probe.sessionId = sessionId ? "present" : "absent";

    // 2. notificacion de sesion iniciada (sin id: no espera respuesta).
    await jsonRpc({ endpoint, authHeader, sessionId, method: "notifications/initialized" });

    // 3. tools/list -- que expone REALMENTE el servidor.
    const toolsResponse = await jsonRpc({ endpoint, authHeader, sessionId, method: "tools/list", id: 2, params: {} });
    probe.tools = extractToolNames(toolsResponse.body);

    // 4. censo de abilities via el despachador, en modo lectura.
    if (probe.tools.includes("mcp-adapter/discover-abilities")) {
      const abilities = await jsonRpc({
        endpoint,
        authHeader,
        sessionId,
        method: "tools/call",
        id: 3,
        params: { name: "mcp-adapter/discover-abilities", arguments: {} },
      });
      probe.abilities = extractAbilityNames(abilities.body);
    }

    probe.connection = "OK";
  } catch (err) {
    probe.connection = "FAIL";
    probe.error = probe.error ?? (err instanceof Error ? err.message : String(err));
  }

  const output = JSON.stringify(probe, null, 2);
  assertNoSecretLeak(output, secrets);
  console.log("NOVAMIRA_PROBE_JSON=" + JSON.stringify(probe));
  console.log(output);

  if (probe.connection !== "OK") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Probe abortado: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
