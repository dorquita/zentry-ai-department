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

/**
 * Llama a un metodo del Bot API y devuelve el cuerpo YA parseado. Se
 * devuelve el JSON (y no `void`, como hasta ahora) para poder registrar
 * el `message_id` real de las solicitudes de aprobacion: sin el, el
 * registro persistente tendria que inventarselo o dejarlo vacio, y la
 * trazabilidad pedida incluye ese dato.
 */
async function callTelegramApi(botToken: string, method: string, payload: Record<string, unknown>): Promise<unknown> {
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

  try {
    return await response.json();
  } catch {
    // Una respuesta 2xx no parseable no invalida el envio (Telegram ya lo
    // acepto): se devuelve `null` y quien llama lo trata como "sin
    // message_id confirmado", nunca como un fallo del envio.
    return null;
  }
}

// Fase O28.5 -- Telegram SI soporta teclados inline (botones) con
// cualquier bot token normal, sin nada especial que activar -- es parte
// del Bot API estandar (`reply_markup.inline_keyboard`). `callbackData`
// va en texto plano dentro del propio mensaje (nunca contiene secretos,
// solo el approvalRequestId/accion), y Telegram lo devuelve tal cual en
// el `callback_query` cuando alguien pulsa el boton (ver fetchTelegramUpdates).
export interface TelegramInlineButton {
  text: string;
  url?: string;
  callbackData?: string;
}

export interface SendTelegramMessageOptions {
  buttons?: TelegramInlineButton[][];
  /**
   * Fase O28.8 -- bug real encontrado en pruebas: un texto plano con un
   * placeholder tipo "approve <id>" rompia el parser HTML de Telegram
   * ("Unsupported start tag") y la respuesta nunca llegaba. `plainText:
   * true` omite `parse_mode` (Telegram trata el texto tal cual, sin
   * negrita/etc, pero nunca falla por `<`/`>`/`&` sueltos) -- para
   * usarlo en cualquier mensaje que no necesite negrita real. Los
   * mensajes que SI usan `<b>` (sendTelegramApprovalRequest) siguen en
   * HTML, con sus valores dinamicos ya escapados con escapeHtml().
   */
  plainText?: boolean;
}

/** Resultado de un envio: el `message_id` real de Telegram cuando se pudo confirmar. */
export interface SentTelegramMessage {
  /** `null` = Telegram acepto el envio pero no se pudo leer el id (nunca se inventa uno). */
  messageId: number | null;
  chatId: string;
}

/** Envia un mensaje de texto simple, con botones inline opcionales. Sanitiza el contenido antes de enviarlo. */
export async function sendTelegramMessage(text: string, options: SendTelegramMessageOptions = {}): Promise<SentTelegramMessage> {
  const config = resolveTelegramConfig();
  const safeText = sanitizeOutgoingText(text);
  const payload: Record<string, unknown> = {
    chat_id: config.chatId,
    text: safeText,
    ...(options.plainText ? {} : { parse_mode: "HTML" }),
  };
  if (options.buttons && options.buttons.length > 0) {
    payload.reply_markup = {
      inline_keyboard: options.buttons.map((row) =>
        row.map((btn) => (btn.url ? { text: btn.text, url: btn.url } : { text: btn.text, callback_data: btn.callbackData ?? "" }))
      ),
    };
  }
  try {
    const response = (await callTelegramApi(config.botToken, "sendMessage", payload)) as { result?: { message_id?: number } } | null;
    const messageId = typeof response?.result?.message_id === "number" ? response.result.message_id : null;
    logger.info("Mensaje de Telegram enviado", { textLength: safeText.length, withButtons: Boolean(options.buttons?.length), messageId });
    return { messageId, chatId: config.chatId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const safeMessage = sanitizeTelegramError(raw, config.botToken);
    logger.error("Fallo el envio del mensaje de Telegram", { error: safeMessage });
    throw new Error(`Envio de Telegram fallo: ${safeMessage}`);
  }
}

/**
 * Responde a la pulsacion de un boton (quita el "reloj de carga" que
 * Telegram muestra en el cliente hasta que se llama esto). Nunca lanza --
 * si falla, solo se registra: la accion real ya se proceso en el sistema
 * antes de llamar aqui, esto es puramente cosmetico del lado de Telegram.
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const config = resolveTelegramConfig();
  try {
    await callTelegramApi(config.botToken, "answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text: sanitizeOutgoingText(text).slice(0, 200) } : {}),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.error("Fallo al responder callback_query de Telegram", { error: sanitizeTelegramError(raw, config.botToken) });
  }
}

export interface TelegramIncomingMessage {
  kind: "message";
  updateId: number;
  chatId: string;
  fromUsername?: string;
  /** id numerico del autor, tal cual lo reporta Telegram. Ausente = Telegram no lo mando. */
  fromUserId?: string;
  text: string;
  date: number;
}

// Fase O28.5 -- pulsar un boton inline no manda un "mensaje" normal,
// manda un `callback_query` (update_id distinto, sin `.text`). Se captura
// como su propio tipo para no confundirlo con texto libre.
export interface TelegramIncomingCallback {
  kind: "callback";
  updateId: number;
  chatId: string;
  fromUsername?: string;
  /** id numerico de quien pulso el boton, tal cual lo reporta Telegram. */
  fromUserId?: string;
  callbackQueryId: string;
  callbackData: string;
  date: number;
}

export type TelegramIncomingUpdate = TelegramIncomingMessage | TelegramIncomingCallback;

/**
 * Lee actualizaciones nuevas del bot via `getUpdates` (Fase O13.2b,
 * ampliado en O28.5 para incluir pulsaciones de boton ademas de texto).
 * Solo lectura del lado de Telegram -- no modifica nada en Telegram ni en
 * este proyecto por si sola. `offset` es el `update_id` a partir del
 * cual pedir actualizaciones (evita repetir las ya vistas); quien llama
 * es responsable de llevar la cuenta (ver
 * src/agents/telegram-approval-receiver.ts).
 *
 * `longPollSeconds` (Fase O28.8, por defecto 0 = comportamiento historico
 * de sondeo manual/instantaneo): si se pasa >0, usa el `timeout` real de
 * Telegram para long polling -- la peticion HTTP queda ABIERTA en el
 * servidor de Telegram hasta que llega una actualizacion nueva o pasa ese
 * tiempo, lo que da respuesta casi instantanea sin necesitar sondear en
 * bucle corto. Usado por el servicio systemd permanente
 * (scripts/telegram-approvals-service.ts); el poll manual bajo peticion
 * sigue usando 0 (instantaneo, nunca bloquea la terminal).
 */
export async function fetchTelegramUpdates(offset?: number, longPollSeconds = 0): Promise<TelegramIncomingUpdate[]> {
  const config = resolveTelegramConfig();
  const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/getUpdates`;
  const payload: Record<string, unknown> = { timeout: longPollSeconds, allowed_updates: ["message", "callback_query"] };
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
      message?: { chat?: { id?: number | string }; from?: { username?: string; id?: number | string }; text?: string; date?: number };
      callback_query?: {
        id: string;
        data?: string;
        message?: { chat?: { id?: number | string }; message_id?: number };
        from?: { username?: string; id?: number | string };
      };
    }>;
  };
  const results = json.result ?? [];

  const updates: TelegramIncomingUpdate[] = [];
  for (const u of results) {
    if (u.message && typeof u.message.text === "string") {
      updates.push({
        kind: "message",
        updateId: u.update_id,
        chatId: String(u.message.chat?.id ?? ""),
        fromUsername: u.message.from?.username,
        fromUserId: u.message.from?.id === undefined ? undefined : String(u.message.from.id),
        text: u.message.text,
        date: u.message.date ?? 0,
      });
    } else if (u.callback_query && typeof u.callback_query.data === "string") {
      updates.push({
        kind: "callback",
        updateId: u.update_id,
        chatId: String(u.callback_query.message?.chat?.id ?? ""),
        fromUsername: u.callback_query.from?.username,
        fromUserId: u.callback_query.from?.id === undefined ? undefined : String(u.callback_query.from.id),
        callbackQueryId: u.callback_query.id,
        callbackData: u.callback_query.data,
        date: 0,
      });
    }
  }
  return updates;
}

/** Nunca expone el chatId configurado -- solo dice si coincide. */
export function isAuthorizedTelegramChat(chatId: string): boolean {
  const config = resolveTelegramConfig();
  return chatId === config.chatId;
}

/**
 * Chat autorizado, para pasarselo a las funciones PURAS de decision (que
 * no leen `process.env` por diseño). Sigue sin exponerse en ningun log ni
 * mensaje: quien lo recibe solo lo usa para comparar.
 */
export function getAuthorizedTelegramChatId(): string {
  return resolveTelegramConfig().chatId;
}

/**
 * Usuario de Telegram autorizado (`TELEGRAM_USER_ID`), OPCIONAL. Si esta
 * configurado, las decisiones que no vengan de ese user id se rechazan
 * -- capa adicional sobre el chat autorizado, util si el bot alguna vez
 * acaba en un chat con mas de una persona. Vacio = no configurado, y la
 * autorizacion se apoya solo en el chat.
 */
export function getAuthorizedTelegramUserId(): string {
  return (process.env.TELEGRAM_USER_ID ?? "").trim();
}

// Fase O28.5 -- rediseno completo del mensaje de aprobacion (postmortem
// de Pau: "Aprobacion critica — Produccion" para algo que "solo crea un
// draft nuevo" es contradictorio). `messageCategory` se deriva del
// `relatedType` de la ApprovalRequest (ver buildMessageCategory), NUNCA
// del `riskLevel` -- el riskLevel sigue gobernando la doble confirmacion
// de seguridad (sin cambios ahi), pero ya no decide el TEXTO que Pau lee.
export type TelegramApprovalMessageCategory = "staging_review" | "production_candidate" | "production_deploy";

export function deriveMessageCategory(relatedType: string): TelegramApprovalMessageCategory {
  if (relatedType === "production_execution") return "production_deploy";
  if (relatedType === "production_deployment_plan") return "production_candidate";
  // action / work_order / change_pack / staging_execution / novamira_staging_write
  return "staging_review";
}

export interface TelegramApprovalRequestContent {
  approvalRequestId: string;
  relatedType: string;
  title: string;
  summary: string;
  riskLevel: string;
  requestedAction: string;
  options: string[];
  /** Fase O28.5 -- contexto opcional para el formato nuevo; si falta, el mensaje se degrada mostrando menos detalle pero nunca inventa datos. */
  pageType?: "update_existing_page" | "new_page_candidate";
  stagingUrl?: string;
  productionUrl?: string;
  onApproveText?: string;
  onRejectText?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CATEGORY_HEADER: Record<TelegramApprovalMessageCategory, string> = {
  staging_review: "🟦 Revision visual — Staging",
  production_candidate: "🟨 Candidato a produccion",
  production_deploy: "🟥 Aprobacion produccion — Deploy",
};

const CATEGORY_RISK_LABEL: Record<TelegramApprovalMessageCategory, string> = {
  staging_review: "Bajo — solo staging, no produccion.",
  production_candidate: "Alto — prepara un plan, todavia no toca produccion.",
  production_deploy: "Critico — esta aprobacion, si se confirma dos veces, autorizaria una escritura real en produccion.",
};

const PAGE_TYPE_LABEL: Record<"update_existing_page" | "new_page_candidate", string> = {
  update_existing_page: "Actualizacion de pagina existente",
  new_page_candidate: "Pagina nueva candidata",
};

function defaultApproveText(category: TelegramApprovalMessageCategory): string {
  if (category === "production_deploy") return "Se autoriza intentar la escritura real en produccion (pedira una segunda confirmacion explicita antes de ejecutar nada).";
  if (category === "production_candidate") return "Se aprueba el DISENO del plan como candidato a produccion. No se publica nada todavia -- falta la aprobacion de EJECUCION, aparte.";
  return "Se marca como revisado/aprobado en staging. No se toca produccion.";
}

function defaultRejectText(): string {
  return "Te pedire el motivo y quedara marcado para revision, sin avanzar.";
}

/**
 * Formatea y envia una solicitud de aprobacion legible por Telegram
 * (Fase O13.2c, rediseñada en O28.5). Diferencia 3 categorias de mensaje
 * segun `relatedType` (nunca segun riskLevel, que sigue gobernando solo
 * la seguridad interna de doble confirmacion): revision de staging,
 * candidato a produccion, y deploy a produccion -- cada una con su
 * propio titulo, y SIEMPRE con: pagina, tipo, URL de staging si existe,
 * URL objetivo de produccion si existe, resumen, riesgo real, que pasa
 * si apruebas, que pasa si rechazas. Incluye botones inline
 * [Aprobar]/[Rechazar]/[Ver staging] -- el texto `approve <id>`/
 * `reject <id>` se mantiene como alternativa (funciona igual si Telegram
 * no muestra botones en el cliente que use Pau), y ademas se acepta
 * lenguaje natural ("ok", "aprobar", "rechazar"...) -- ver
 * telegram-approval-receiver.ts.
 */
export async function sendTelegramApprovalRequest(content: TelegramApprovalRequestContent): Promise<void> {
  const category = deriveMessageCategory(content.relatedType);
  const header = CATEGORY_HEADER[category];
  const riskLine = CATEGORY_RISK_LABEL[category];
  const approveText = content.onApproveText ?? defaultApproveText(category);
  const rejectText = content.onRejectText ?? defaultRejectText();

  const lines: string[] = [`<b>${header}</b>`, ""];
  lines.push("<b>Pagina:</b>", escapeHtml(content.title), "");
  if (content.pageType) {
    lines.push("<b>Tipo:</b>", escapeHtml(PAGE_TYPE_LABEL[content.pageType]), "");
  }
  if (content.stagingUrl) {
    lines.push("<b>Revisar aqui:</b>", escapeHtml(content.stagingUrl), "");
  }
  if (content.productionUrl) {
    lines.push("<b>Pagina objetivo:</b>", escapeHtml(content.productionUrl), "");
  }
  lines.push("<b>Resumen:</b>", escapeHtml(content.summary), "");
  lines.push("<b>Riesgo:</b>", riskLine, "");
  lines.push("<b>Si apruebas:</b>", escapeHtml(approveText), "");
  lines.push("<b>Si rechazas:</b>", escapeHtml(rejectText), "");
  lines.push(
    `<b>Responde:</b> "ok"/"aprobar" para aprobar, o "rechazar"/"no" para rechazar -- o usa los botones si tu Telegram los muestra. (Tambien acepta <code>approve ${escapeHtml(
      content.approvalRequestId
    )}</code> / <code>reject ${escapeHtml(content.approvalRequestId)}</code>.)`
  );

  const buttons: TelegramInlineButton[][] = [
    [
      { text: "✅ Aprobar", callbackData: `appr:approve:${content.approvalRequestId}` },
      { text: "❌ Rechazar", callbackData: `appr:reject:${content.approvalRequestId}` },
    ],
  ];
  if (content.stagingUrl) {
    buttons.push([{ text: "👀 Ver staging", url: content.stagingUrl }]);
  }

  await sendTelegramMessage(lines.join("\n"), { buttons });
}
