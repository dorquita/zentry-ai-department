import { logger } from "./logger";
import { resolveActiveClientConfig } from "./client-config";

/**
 * Telegram Gateway (Fase O8): unico canal de notificacion/aprobacion
 * instantanea implementado hoy (WhatsApp queda documentado como fase
 * futura, ver docs/telegram-approvals.md). Nunca imprime ni loguea
 * TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ni el `.env` completo.
 *
 * Quien llama a este modulo (src/agents/approval-gateway.ts) es
 * responsable de comprobar `isTelegramApprovalsEnabled()` ANTES de
 * intentar enviar nada — si esta desactivado, este modulo ni siquiera se
 * invoca, no hace falta tener las credenciales configuradas.
 *
 * Fase O16.1: los NOMBRES de las 3 variables de entorno (nunca sus
 * valores) se leen de `notificationSettings` del ClientConfig ACTIVO
 * (`telegramEnabledEnvVar`/`telegramBotTokenEnvVar`/
 * `telegramChatIdEnvVar`) en vez de estar fijados como literales
 * `"TELEGRAM_APPROVALS_ENABLED"`/`"TELEGRAM_BOT_TOKEN"`/
 * `"TELEGRAM_CHAT_ID"`. Para "zentry" esos NOMBRES son exactamente esos
 * tres (ver `clients/zentry/client.config.json`), asi que el
 * comportamiento no cambia — el secreto en si SIGUE viviendo solo en
 * `.env`, esto solo hace que el NOMBRE de la variable sea configurable
 * por cliente.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";
// Cualquier URL que contenga el token (p.ej. si aparece dentro de un
// mensaje de error de fetch) se redacta con esta expresion ANTES de
// loguear o relanzar el error.
const BOT_TOKEN_IN_URL_RE = /\/bot[^/\s]+\//g;

export function isTelegramApprovalsEnabled(): boolean {
  const varName = resolveActiveClientConfig().notificationSettings.telegramEnabledEnvVar;
  return (process.env[varName] ?? "").trim().toLowerCase() === "true";
}

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisa .env.example (seccion Telegram) y docs/telegram-approvals.md antes de activar TELEGRAM_APPROVALS_ENABLED=true.`
    );
  }
  return value;
}

/** Nunca loguea ni expone el token/chatId fuera de esta funcion. */
function resolveTelegramConfig(): TelegramConfig {
  const names = resolveActiveClientConfig().notificationSettings;
  const botToken = requireEnv(names.telegramBotTokenEnvVar);
  const chatId = requireEnv(names.telegramChatIdEnvVar);
  return { botToken, chatId };
}

/** Para informes/CLI: nunca devuelve los valores, solo si estan presentes. */
export function getTelegramStatusForReport(): { enabled: boolean; configured: boolean } {
  const names = resolveActiveClientConfig().notificationSettings;
  const enabled = isTelegramApprovalsEnabled();
  const configured = Boolean(process.env[names.telegramBotTokenEnvVar]) && Boolean(process.env[names.telegramChatIdEnvVar]);
  return { enabled, configured };
}

// Nombres de variables de entorno cuyo VALOR real, si apareciera
// literalmente dentro de un texto a punto de enviarse por Telegram (o de
// loguearse), debe redactarse — defensa en profundidad, igual que
// mailer.ts hace con SMTP_PASS en sus mensajes de error.
const SECRET_ENV_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "SMTP_PASS",
  "GSC_OAUTH_CLIENT_SECRET",
  "GSC_OAUTH_REFRESH_TOKEN",
  // Fase O11 — Google Ads (nombres OAUTH_* desde esta fase)
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  // Fase O11 — GA4 + GTM comparten un unico cliente OAuth
  "GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN",
  "WORDPRESS_APP_PASSWORD",
  "N8N_API_KEY",
];

/**
 * Sanitiza cualquier texto ANTES de mandarlo por Telegram: quita
 * caracteres de control, redacta cualquier valor real de las variables de
 * SECRET_ENV_VARS que apareciera literalmente en el texto (nunca deberia
 * pasar en uso normal, es defensa en profundidad), y trunca longitudes
 * absurdas (Telegram limita sendMessage a 4096 caracteres).
 */
export function sanitizeOutgoingText(text: string): string {
  let safe = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  // Fase O16.1: ademas de la lista fija de arriba, tambien se redacta el
  // NOMBRE de variable que el ClientConfig activo diga que guarda el bot
  // token (por si un cliente futuro lo renombra) -- Set() para no
  // redactar dos veces el mismo valor si coincide con la lista fija.
  const varNames = new Set(SECRET_ENV_VARS);
  varNames.add(resolveActiveClientConfig().notificationSettings.telegramBotTokenEnvVar);
  for (const varName of varNames) {
    const value = process.env[varName];
    if (value && value.length >= 6) {
      safe = safe.split(value).join("[REDACTED]");
    }
  }
  return safe.length > 3500 ? safe.slice(0, 3500) + "\n...[truncado]" : safe;
}

function sanitizeTelegramError(raw: string, botToken: string): string {
  const withoutToken = botToken ? raw.split(botToken).join("[REDACTED]") : raw;
  const withoutBotUrl = withoutToken.replace(BOT_TOKEN_IN_URL_RE, "/bot[REDACTED]/");
  return withoutBotUrl.length > 500 ? withoutBotUrl.slice(0, 500) + "...[truncated]" : withoutBotUrl;
}

async function callTelegramApi(botToken: string, method: string, payload: Record<string, unknown>): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/${method}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red llamando a Telegram: ${sanitizeTelegramError(raw, botToken)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(`Telegram API respondio ${response.status}: ${sanitizeTelegramError(bodyText, botToken)}`);
  }
}

/** Envia un mensaje de texto simple. Sanitiza el contenido antes de enviarlo. */
export async function sendTelegramMessage(text: string): Promise<void> {
  const config = resolveTelegramConfig();
  const safeText = sanitizeOutgoingText(text);
  try {
    await callTelegramApi(config.botToken, "sendMessage", {
      chat_id: config.chatId,
      text: safeText,
      parse_mode: "HTML",
    });
    logger.info("Mensaje de Telegram enviado", { textLength: safeText.length });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const safeMessage = sanitizeTelegramError(raw, config.botToken);
    logger.error("Fallo el envio del mensaje de Telegram", { error: safeMessage });
    throw new Error(`Envio de Telegram fallo: ${safeMessage}`);
  }
}

export interface TelegramIncomingMessage {
  updateId: number;
  chatId: string;
  fromUsername?: string;
  text: string;
  date: number;
}

/**
 * Lee mensajes nuevos del bot via `getUpdates` (Fase O13.2b). Solo
 * lectura del lado de Telegram -- no modifica nada en Telegram ni en
 * este proyecto por si sola. `offset` es el `update_id` a partir del
 * cual pedir mensajes (evita repetir los ya vistos); quien llama es
 * responsable de llevar la cuenta (ver
 * src/agents/telegram-approval-receiver.ts). `timeout: 0` -- long
 * polling explicitamente desactivado, esto es para invocacion manual
 * bajo peticion, nunca un proceso en segundo plano permanente.
 */
export async function fetchTelegramUpdates(offset?: number): Promise<TelegramIncomingMessage[]> {
  const config = resolveTelegramConfig();
  const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/getUpdates`;
  const payload: Record<string, unknown> = { timeout: 0, allowed_updates: ["message"] };
  if (typeof offset === "number") payload.offset = offset;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red llamando a Telegram getUpdates: ${sanitizeTelegramError(raw, config.botToken)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(`Telegram getUpdates respondio ${response.status}: ${sanitizeTelegramError(bodyText, config.botToken)}`);
  }

  const json = (await response.json()) as {
    ok?: boolean;
    result?: Array<{
      update_id: number;
      message?: { chat?: { id?: number | string }; from?: { username?: string }; text?: string; date?: number };
    }>;
  };
  const results = json.result ?? [];

  return results
    .filter((u) => u.message && typeof u.message.text === "string")
    .map((u) => ({
      updateId: u.update_id,
      chatId: String(u.message?.chat?.id ?? ""),
      fromUsername: u.message?.from?.username,
      text: u.message?.text ?? "",
      date: u.message?.date ?? 0,
    }));
}

/** Nunca expone el chatId configurado -- solo dice si coincide. */
export function isAuthorizedTelegramChat(chatId: string): boolean {
  const config = resolveTelegramConfig();
  return chatId === config.chatId;
}

export interface TelegramApprovalRequestContent {
  approvalRequestId: string;
  title: string;
  summary: string;
  riskLevel: string;
  requestedAction: string;
  options: string[];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const VPS_RECEIVER_NOTE =
  "Responde en este chat: no ejecuta nada por si solo, solo desbloquea el siguiente paso.";

/**
 * Formatea y envia una solicitud de aprobacion legible por Telegram
 * (Fase O13.2c: mensajes breves, sin "snoozed", sin comandos npm largos,
 * sin explicar flags de entorno -- solo aprobar/rechazar con un comando
 * corto). Distingue dos formatos:
 *
 * - `riskLevel === "critical"` (planes/ejecuciones de deploy a
 *   produccion): formato reducido especifico, con una lista fija de
 *   garantias de seguridad ("Importante: no publica nada...") en vez de
 *   repetir la explicacion tecnica de cada agente.
 * - cualquier otro riesgo: formato generico igual de corto.
 *
 * Esta fase no acepta respuestas directamente en el chat -- ver
 * docs/telegram-approvals.md.
 */
export async function sendTelegramApprovalRequest(content: TelegramApprovalRequestContent): Promise<void> {
  const isCritical = content.riskLevel.trim().toLowerCase() === "critical";

  const lines = isCritical
    ? [
        "⚠️ <b>Aprobacion critica — Produccion</b>",
        "",
        "<b>Accion:</b>",
        escapeHtml(content.requestedAction),
        "",
        "<b>Pagina:</b>",
        escapeHtml(content.title),
        "",
        "<b>Importante:</b>",
        "- No publica nada",
        "- No modifica paginas publicadas",
        "- Solo crea un draft nuevo",
        "- Sube/remapea la imagen necesaria",
        "",
        "<b>Riesgo:</b>",
        "Critico",
        "",
        "<b>Para aprobar:</b>",
        `<code>approve ${escapeHtml(content.approvalRequestId)}</code>`,
        "",
        "<b>Para rechazar:</b>",
        `<code>reject ${escapeHtml(content.approvalRequestId)}</code>`,
        "",
        `<b>Nota:</b> ${VPS_RECEIVER_NOTE}`,
      ]
    : [
        "✅ <b>Aprobacion pendiente</b>",
        "",
        `<b>${escapeHtml(content.title)}</b>`,
        escapeHtml(content.summary),
        "",
        `Riesgo: <b>${escapeHtml(content.riskLevel)}</b>`,
        "",
        "<b>Para aprobar:</b>",
        `<code>approve ${escapeHtml(content.approvalRequestId)}</code>`,
        "",
        "<b>Para rechazar:</b>",
        `<code>reject ${escapeHtml(content.approvalRequestId)}</code>`,
        "",
        `<b>Nota:</b> ${VPS_RECEIVER_NOTE}`,
      ];

  await sendTelegramMessage(lines.join("\n"));
}
