/**
 * CLIENTE DEL BOT API DE TELEGRAM para el Worker.
 *
 * Deliberadamente NO se reutiliza `src/core/telegram-gateway.ts`: aquel
 * lee `process.env` y arrastra `client-config` -> `fs`, cosas que no
 * existen en el runtime de Cloudflare. Aqui el token llega por parametro
 * y lo unico global que se usa es `fetch`.
 *
 * Reglas duras:
 *
 *  - El token NUNCA sale de este modulo: ni en un log, ni en un error, ni
 *    en una respuesta HTTP. Todo texto de error pasa por `redactToken`
 *    antes de propagarse (la URL del Bot API LLEVA el token dentro, asi
 *    que un mensaje de error de `fetch` sin redactar lo filtraria).
 *  - Un fallo de Telegram NO lanza: devuelve un resultado con `ok: false`.
 *    Quien decide no puede quedarse a medias porque el bot no respondiera
 *    -- el estado en D1 manda, el mensaje es solo el acuse.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

/** Telegram corta `sendMessage` en 4096 caracteres; se recorta antes para no perder el mensaje entero. */
const MAX_MESSAGE_LENGTH = 3500;

/** Cualquier `/bot<token>/` que aparezca dentro de un texto de error se tapa. */
const BOT_TOKEN_IN_URL = /\/bot[^/\s]+\//g;

export interface SendMessageInput {
  chatId: string;
  text: string;
  /** Responde EN HILO al mensaje indicado. Es lo que hace correlacionable el motivo de un rechazo. */
  replyToMessageId?: number | null;
  /** Teclado inline. Opcional: el webhook responde en texto plano, el envio de la solicitud si lleva botones. */
  buttons?: TelegramButton[][];
}

export interface TelegramButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface SendMessageResult {
  ok: boolean;
  /** `message_id` que devolvio Telegram. `null` si no se pudo confirmar (y entonces no se correlaciona por hilo). */
  messageId: number | null;
  /** Motivo legible, ya redactado. Nunca vacio. */
  detail: string;
}

export interface EditMessageInput {
  chatId: string;
  messageId: number;
  text: string;
}

export interface AnswerCallbackInput {
  callbackQueryId: string;
  /** Aviso corto que Telegram muestra encima del teclado. Opcional. */
  text?: string;
}

export interface TelegramResult {
  ok: boolean;
  detail: string;
}

/**
 * PUERTO que consume la logica del webhook. `webhook.ts` depende de esta
 * interfaz, nunca de la implementacion: por eso se puede testear entero
 * sin red.
 */
export interface TelegramPort {
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  editMessageText(input: EditMessageInput): Promise<TelegramResult>;
  answerCallbackQuery(input: AnswerCallbackInput): Promise<TelegramResult>;
}

/** Quita caracteres de control y recorta. No interpreta el contenido: los textos son ya de confianza (los construye el propio codigo). */
export function sanitizeOutgoingText(text: string): string {
  const clean = String(text ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH)}\n...[truncado]` : clean;
}

/** Tapa el token en cualquier texto antes de que pueda acabar en un log. */
export function redactToken(raw: string, botToken: string): string {
  let safe = String(raw ?? "");
  if (botToken && botToken.length >= 6) safe = safe.split(botToken).join("[REDACTED]");
  safe = safe.replace(BOT_TOKEN_IN_URL, "/bot[REDACTED]/");
  return safe.length > 400 ? `${safe.slice(0, 400)}...[truncado]` : safe;
}

function toInlineKeyboard(buttons: TelegramButton[][] | undefined): unknown | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((button) => (button.url ? { text: button.text, url: button.url } : { text: button.text, callback_data: button.callbackData ?? "" }))
    ),
  };
}

export function createTelegramClient(botToken: string): TelegramPort {
  /** Llama a un metodo del Bot API. Nunca lanza: traduce cualquier fallo a `{ok:false}` ya redactado. */
  async function call(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; detail: string; result?: Record<string, unknown> }> {
    if (!botToken || botToken.trim().length === 0) {
      // Fail-closed y sin nombrar el secreto que falta.
      return { ok: false, detail: "El bot de Telegram no esta configurado en este Worker: no se envia nada." };
    }
    let response: Response;
    try {
      response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `Fallo de red llamando a Telegram ${method}: ${redactToken(raw, botToken)}` };
    }

    let body: { ok?: boolean; description?: string; result?: Record<string, unknown> } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = {};
    }

    if (!response.ok || body.ok !== true) {
      return { ok: false, detail: `Telegram ${method} respondio ${response.status}: ${redactToken(body.description ?? "(sin descripcion)", botToken)}` };
    }
    return { ok: true, detail: `Telegram ${method} correcto.`, result: body.result };
  }

  return {
    async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
      const payload: Record<string, unknown> = {
        chat_id: input.chatId,
        // Texto PLANO a proposito: los titles y metas reales llevan
        // comillas, `<` y `&`, y el parser HTML de Telegram ya ha roto
        // envios reales de este proyecto por eso.
        text: sanitizeOutgoingText(input.text),
        disable_web_page_preview: true,
      };
      if (typeof input.replyToMessageId === "number") payload.reply_to_message_id = input.replyToMessageId;
      const keyboard = toInlineKeyboard(input.buttons);
      if (keyboard) payload.reply_markup = keyboard;

      const outcome = await call("sendMessage", payload);
      const messageId = outcome.result && typeof outcome.result.message_id === "number" ? (outcome.result.message_id as number) : null;
      return { ok: outcome.ok, messageId, detail: outcome.detail };
    },

    async editMessageText(input: EditMessageInput): Promise<TelegramResult> {
      const outcome = await call("editMessageText", {
        chat_id: input.chatId,
        message_id: input.messageId,
        text: sanitizeOutgoingText(input.text),
        disable_web_page_preview: true,
      });
      return { ok: outcome.ok, detail: outcome.detail };
    },

    async answerCallbackQuery(input: AnswerCallbackInput): Promise<TelegramResult> {
      const payload: Record<string, unknown> = { callback_query_id: input.callbackQueryId };
      // Telegram limita este aviso a 200 caracteres.
      if (input.text) payload.text = sanitizeOutgoingText(input.text).slice(0, 200);
      const outcome = await call("answerCallbackQuery", payload);
      return { ok: outcome.ok, detail: outcome.detail };
    },
  };
}
