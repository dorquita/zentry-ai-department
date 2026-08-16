/**
 * TRANSPORTE JSON-RPC del MCP de Novamira.
 *
 * Solo transporte: abre sesion, llama a un tool y devuelve el resultado
 * en crudo. No decide si una llamada esta permitida -- de eso se encargan
 * `novamira-guard.ts`, `novamira-profiles.ts` y `execute-php-guard.ts`, y
 * el unico modulo que puede usar este transporte es
 * `novamira-mcp-client.ts`, que los invoca antes.
 *
 * Por que `fetch` a pelo y no el SDK oficial: el transporte de este
 * servidor (WP\MCP\Transport\HttpTransport, mcp-adapter v0.5.0) implementa
 * POST + sesiones y responde 405 al GET -- su propio codigo dice que SSE
 * no esta implementado. POST JSON-RPC es exactamente lo que habla, y no
 * arrastra ninguna dependencia nueva. Es el mismo camino que ya usa y
 * valida `scripts/probe-novamira-mcp.ts` contra el servidor real.
 *
 * SECRETOS: este modulo nunca imprime nada. Las credenciales solo se usan
 * para construir la cabecera Authorization.
 */

/** Ruta canonica que Novamira registra para clientes con Application Password. */
const NOVAMIRA_MCP_PATH = "/wp-json/mcp/novamira";

/** Version del protocolo que declara el transporte de mcp-adapter v0.5.0. */
const MCP_PROTOCOL_VERSION = "2025-11-25";

export const REQUIRED_NOVAMIRA_VARS = ["WP_API_URL", "WP_API_USERNAME", "WP_API_PASSWORD"] as const;

export interface NovamiraCredentials {
  url: string;
  username: string;
  password: string;
}

/**
 * Resuelve credenciales desde el entorno. Fail-closed: si falta alguna,
 * lanza con los NOMBRES de las variables, jamas con sus valores.
 */
export function resolveNovamiraCredentials(env: Record<string, string | undefined> = process.env): NovamiraCredentials {
  const missing = REQUIRED_NOVAMIRA_VARS.filter((name) => !(env[name] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(`Faltan variables de configuracion de Novamira: ${missing.join(", ")}. No se intenta ninguna conexion.`);
  }
  return {
    url: (env.WP_API_URL ?? "").trim(),
    username: (env.WP_API_USERNAME ?? "").trim(),
    password: (env.WP_API_PASSWORD ?? "").trim(),
  };
}

/** `WP_API_URL` puede venir ya como endpoint MCP completo o como URL base del sitio. */
export function resolveMcpEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.includes("/wp-json/mcp/") ? trimmed : `${trimmed}${NOVAMIRA_MCP_PATH}`;
}

interface JsonRpcResponse {
  status: number;
  sessionId: string | null;
  body: Record<string, unknown> | null;
}

async function jsonRpc(input: {
  endpoint: string;
  authHeader: string;
  sessionId: string | null;
  method: string;
  params?: Record<string, unknown>;
  id?: number | null;
}): Promise<JsonRpcResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: input.authHeader,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  if (input.sessionId) headers["Mcp-Session-Id"] = input.sessionId;

  const payload: Record<string, unknown> = { jsonrpc: "2.0", method: input.method };
  if (input.params) payload.params = input.params;
  if (input.id !== null && input.id !== undefined) payload.id = input.id;

  const response = await fetch(input.endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  const sessionId = response.headers.get("mcp-session-id");
  const text = await response.text();

  let body: Record<string, unknown> | null = null;
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
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

export interface NovamiraSession {
  endpoint: string;
  authHeader: string;
  sessionId: string | null;
}

/** Abre sesion MCP (`initialize` + `notifications/initialized`). */
export async function openNovamiraSession(credentials: NovamiraCredentials): Promise<NovamiraSession> {
  const endpoint = resolveMcpEndpoint(credentials.url);
  const authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;

  const init = await jsonRpc({
    endpoint,
    authHeader,
    sessionId: null,
    method: "initialize",
    id: 1,
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "zentry-ai-department", version: "1.0" },
    },
  });
  if (init.status !== 200 || !init.body) {
    throw new Error(`No se pudo abrir la sesion MCP de Novamira (HTTP ${init.status}).`);
  }

  const session: NovamiraSession = { endpoint, authHeader, sessionId: init.sessionId };
  await jsonRpc({ endpoint, authHeader, sessionId: init.sessionId, method: "notifications/initialized", id: null });
  return session;
}

/**
 * Llama a un tool MCP. Devuelve el cuerpo JSON-RPC crudo: interpretarlo
 * es responsabilidad de quien llama, que sabe que ability pidio.
 */
export async function callMcpTool(session: NovamiraSession, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const response = await jsonRpc({
    endpoint: session.endpoint,
    authHeader: session.authHeader,
    sessionId: session.sessionId,
    method: "tools/call",
    id: 2,
    params: { name: toolName, arguments: args },
  });
  if (response.status !== 200) {
    throw new Error(`La llamada al tool MCP "${toolName}" devolvio HTTP ${response.status}.`);
  }
  return response.body;
}

/**
 * Extrae el texto plano que devuelve una ability. El despachador envuelve
 * la respuesta en bloques de contenido; aqui se concatena todo el texto
 * disponible sin forzar ninguna interpretacion: quien llama decide que
 * hacer con el.
 */
export function extractTextContent(body: Record<string, unknown> | null): string {
  const result = (body?.result ?? {}) as Record<string, unknown>;
  const content = Array.isArray(result.content) ? result.content : [];
  const parts: string[] = [];
  for (const block of content) {
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") parts.push(record.text);
  }
  if (typeof result.structuredContent === "string") parts.push(result.structuredContent);
  else if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  return parts.join("\n");
}
