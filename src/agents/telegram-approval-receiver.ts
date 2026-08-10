import {
  fetchTelegramUpdates,
  isAuthorizedTelegramChat,
  isTelegramApprovalsEnabled,
  sendTelegramMessage,
  answerCallbackQuery,
  TelegramIncomingUpdate,
} from "../core/telegram-gateway";
import { findApprovalRequestById, readCurrentApprovalRequests, setApprovalRequestStatus } from "../core/approval-requests";
import {
  createProductionConfirmation,
  findActiveConfirmationForApprovalRequest,
  findActiveConfirmationsByShortId,
  setProductionConfirmationStatus,
} from "../core/telegram-production-confirmations";
import {
  createRejectReasonPrompt,
  findActiveRejectReasonPromptForChat,
  isRejectReasonPromptExpired,
  setRejectReasonPromptStatus,
} from "../core/telegram-reject-prompts";
import { recordVisualReviewFeedback } from "../core/visual-review-feedback";
import { getNextUpdateOffset, recordProcessedUpdate } from "../core/telegram-processed-updates";
import { logger } from "../core/logger";
import { ApprovalRequest, TelegramProcessedUpdate } from "../core/types";

/**
 * Telegram Approval Receiver (Fase O13.2b, rediseñado en O28.5) —
 * permite responder a una aprobacion de 3 formas: pulsando un boton
 * inline, escribiendo lenguaje natural ("ok"/"aprobar"/"rechazar"/"no"),
 * o el comando explicito "approve <id>"/"reject <id>" de siempre. SOLO
 * polling manual bajo peticion (`npm run telegram:approvals:poll`) -- NO
 * es un servicio permanente (nada de cron/systemd/loop infinito).
 *
 * Este modulo NUNCA toca WordPress, produccion, Ads/GA4/GTM, n8n ni
 * qdrant -- lo unico que hace es leer actualizaciones de Telegram
 * (mensajes de texto O pulsaciones de boton) y, si corresponden a un
 * comando reconocido, cambiar el status de un `ApprovalRequest` local.
 * Ni siquiera aprobar una ejecucion de produccion ejecuta nada por si
 * solo -- solo desbloquea que un agente intente algo en su proxima
 * pasada, y solo si ademas los flags de entorno estan activos.
 *
 * Limitacion conocida: las solicitudes `relatedType: "action"`/
 * "work_order"` necesitan cascada al Action Backlog / Work Order
 * Registry (ver `scripts/update-approval-request.ts`) -- este receiver
 * NO la replica todavia. Si llega un "approve"/"reject" para ese tipo,
 * se rechaza con un mensaje pidiendo usar el CLI desde el VPS.
 */

export const APPROVAL_EXPIRY_HOURS = 72;
export const PRODUCTION_CONFIRMATION_WINDOW_MINUTES = 15;
const CASCADE_REQUIRED_TYPES = new Set(["action", "work_order"]);

export type ParsedTelegramCommand =
  | { type: "approve"; id: string }
  | { type: "reject"; id: string }
  | { type: "confirm_production"; shortId: string };

/** Pura, sin efectos secundarios -- facil de testear sin tocar la red. */
export function parseTelegramCommand(rawText: string): ParsedTelegramCommand | null {
  const text = rawText.trim();

  const confirmMatch = /^APROBAR\s+PRODUCCION\s+(\S+)$/i.exec(text);
  if (confirmMatch) {
    return { type: "confirm_production", shortId: confirmMatch[1].trim() };
  }
  const approveMatch = /^approve\s+(\S+)$/i.exec(text);
  if (approveMatch) {
    return { type: "approve", id: approveMatch[1].trim() };
  }
  const rejectMatch = /^reject\s+(\S+)$/i.exec(text);
  if (rejectMatch) {
    return { type: "reject", id: rejectMatch[1].trim() };
  }
  return null;
}

// Fase O28.5 -- lenguaje natural pedido explicitamente por Pau: nunca
// obligar a copiar un UUID para responder. Solo tiene sentido cuando hay
// EXACTAMENTE una solicitud pendiente y enviada -- si hay varias, no hay
// forma honesta de adivinar a cual se refiere (ver resolveNaturalLanguageTarget).
const APPROVE_PHRASES = new Set(["ok", "okay", "vale", "aprobar", "aprobado", "adelante", "me gusta", "correcto", "si", "sí", "dale"]);
const REJECT_PHRASES = new Set(["cancelar", "rechazar", "rechazado", "no", "mejorar", "no me gusta", "para", "cancelado"]);

/** Pura -- normaliza y compara contra las listas de frases reconocidas. */
export function parseNaturalLanguageIntent(rawText: string): "approve" | "reject" | null {
  const normalized = rawText
    .trim()
    .toLowerCase()
    .replace(/[¡!¿?.]/g, "");
  if (APPROVE_PHRASES.has(normalized)) return "approve";
  if (REJECT_PHRASES.has(normalized)) return "reject";
  return null;
}

// Fase O28.5 -- callback_data de los botones inline, formato
// "appr:approve:<id>" / "appr:reject:<id>" (ver telegram-gateway.ts
// sendTelegramApprovalRequest). Nunca contiene secretos, solo el mismo
// id que ya viaja en texto plano en el propio mensaje.
export function parseCallbackData(data: string): { type: "approve" | "reject"; id: string } | null {
  const match = /^appr:(approve|reject):(.+)$/.exec(data);
  if (!match) return null;
  return { type: match[1] as "approve" | "reject", id: match[2] };
}

/** Primeros 8 caracteres hexadecimales del UUID dentro del id (approvalRequestId, prod-exec-..., prod-deploy-..., staging-exec-...). */
export function deriveShortId(id: string): string {
  const match = /([0-9a-fA-F]{8})-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.exec(id);
  if (match) return match[1].toLowerCase();
  return id.slice(0, 8).toLowerCase();
}

export interface ResolveResult {
  request?: ApprovalRequest;
  ambiguous: boolean;
}

/**
 * Resuelve un id que puede ser el approvalRequestId directamente, o el
 * relatedId (deploymentPlanId / executionId de staging o produccion) de
 * la solicitud asociada -- pura, sin efectos secundarios.
 */
export function resolveApprovalRequestByIdOrRelatedId(id: string, current: ApprovalRequest[]): ResolveResult {
  const byId = findApprovalRequestById2(id, current);
  if (byId) return { request: byId, ambiguous: false };

  const byRelated = current.filter((r) => r.relatedId === id);
  if (byRelated.length === 1) return { request: byRelated[0], ambiguous: false };
  if (byRelated.length > 1) return { ambiguous: true };
  return { ambiguous: false };
}

function findApprovalRequestById2(id: string, current: ApprovalRequest[]): ApprovalRequest | undefined {
  return current.find((r) => r.approvalRequestId === id);
}

export function isApprovalExpired(request: ApprovalRequest, nowMs: number): boolean {
  const createdMs = new Date(request.createdAt).getTime();
  return nowMs - createdMs > APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000;
}

function isConfirmationExpired(createdAt: string, nowMs: number): boolean {
  const createdMs = new Date(createdAt).getTime();
  return nowMs - createdMs > PRODUCTION_CONFIRMATION_WINDOW_MINUTES * 60 * 1000;
}

async function reply(text: string): Promise<void> {
  try {
    await sendTelegramMessage(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Telegram Approval Receiver: fallo al responder en el chat", { error: message });
  }
}

/** Forma comun a un mensaje de texto real o a un comando sintetizado desde un boton -- ver runTelegramApprovalReceiver. */
interface UpdateBase {
  updateId: number;
  chatId: string;
  text: string;
}

async function handleApproveOrReject(command: { type: "approve" | "reject"; id: string }, update: UpdateBase): Promise<TelegramProcessedUpdate> {
  const now = Date.now();
  const base = { updateId: update.updateId, chatId: update.chatId, text: update.text, processedAt: new Date().toISOString() };
  const current = readCurrentApprovalRequests();
  const { request, ambiguous } = resolveApprovalRequestByIdOrRelatedId(command.id, current);

  if (ambiguous) {
    await reply(`⚠️ El id "${command.id}" coincide con mas de una solicitud. Usa el approvalRequestId completo.`);
    return { ...base, outcome: "ignored_ambiguous_id" };
  }
  if (!request) {
    await reply(`No encontre ninguna solicitud pendiente con id "${command.id}".`);
    return { ...base, outcome: "ignored_not_found" };
  }
  if (CASCADE_REQUIRED_TYPES.has(request.relatedType)) {
    await reply(
      `Esta solicitud (${request.relatedType}) todavia necesita "npm run approvals:update" desde el VPS para sincronizar el backlog. No la resuelvo desde aqui.`
    );
    return { ...base, outcome: "ignored_requires_cli_cascade", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
  }
  if (request.status !== "pending") {
    await reply(`Esa solicitud ya estaba resuelta (status: "${request.status}"). No se duplica.`);
    return { ...base, outcome: "ignored_already_resolved", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
  }
  if (isApprovalExpired(request, now)) {
    setApprovalRequestStatus(request.approvalRequestId, "expired", { answeredBy: "telegram", reason: "Expirada (72h) al recibir respuesta por Telegram" });
    await reply(`Esa solicitud ya caduco (mas de ${APPROVAL_EXPIRY_HOURS}h). Hay que generar una nueva.`);
    return { ...base, outcome: "ignored_expired", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
  }

  if (command.type === "reject") {
    setApprovalRequestStatus(request.approvalRequestId, "rejected", { answer: "rejected", answeredBy: "telegram", reason: "Rechazado via Telegram" });
    // Fase O28.5 -- Pau: "Entendido. ¿Que quieres que mejore?" -- se
    // abre un prompt de motivo; el SIGUIENTE mensaje de texto libre de
    // este chat (si no es otro comando) se guarda como feedback (ver
    // runTelegramApprovalReceiver).
    createRejectReasonPrompt(request.approvalRequestId, update.chatId);
    await reply(
      `❌ Rechazado: "${request.title}".\n\nEntendido. ¿Que quieres que mejore? Puedes responder con una frase corta (ej: "se ve muy plano", "falta imagen", "el CTA no destaca", "el copy parece generico").`
    );
    return { ...base, outcome: "rejected", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
  }

  // command.type === "approve"
  if (request.riskLevel.trim().toLowerCase() === "critical") {
    const existingConfirmation = findActiveConfirmationForApprovalRequest(request.approvalRequestId);
    if (existingConfirmation && !isConfirmationExpired(existingConfirmation.createdAt, now)) {
      await reply(`Ya te pedi confirmacion para esto. Responde: APROBAR PRODUCCION ${existingConfirmation.shortId}`);
      return { ...base, outcome: "production_confirmation_requested", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
    }
    const shortId = deriveShortId(request.relatedId || request.approvalRequestId);
    createProductionConfirmation(request.approvalRequestId, shortId);
    await reply(
      `⚠️ Esto es una accion CRITICA de produccion. Para confirmar de verdad, responde en los proximos ${PRODUCTION_CONFIRMATION_WINDOW_MINUTES} minutos:\nAPROBAR PRODUCCION ${shortId}`
    );
    return { ...base, outcome: "production_confirmation_requested", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
  }

  setApprovalRequestStatus(request.approvalRequestId, "approved", { answer: "approved", answeredBy: "telegram", reason: "Aprobado via Telegram" });
  await reply(`✅ Aprobado: "${request.title}".`);
  return { ...base, outcome: "approved", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
}

async function handleConfirmProduction(shortId: string, update: UpdateBase): Promise<TelegramProcessedUpdate> {
  const now = Date.now();
  const base = { updateId: update.updateId, chatId: update.chatId, text: update.text, processedAt: new Date().toISOString() };

  const matches = findActiveConfirmationsByShortId(shortId);
  if (matches.length > 1) {
    await reply(`⚠️ Ese identificador corto ("${shortId}") coincide con mas de una confirmacion pendiente. Usa mas caracteres.`);
    return { ...base, outcome: "ignored_ambiguous_id" };
  }
  const confirmation = matches[0];
  if (!confirmation || isConfirmationExpired(confirmation.createdAt, now)) {
    if (confirmation) setProductionConfirmationStatus(confirmation.confirmationId, "expired");
    await reply(`No hay ninguna confirmacion pendiente con "${shortId}" (o ya caduco). Envia primero "approve <id>".`);
    return { ...base, outcome: "ignored_confirmation_not_found_or_expired" };
  }

  const current = readCurrentApprovalRequests();
  const request = findApprovalRequestById2(confirmation.approvalRequestId, current);
  if (!request || request.status !== "pending" || isApprovalExpired(request, now)) {
    setProductionConfirmationStatus(confirmation.confirmationId, "cancelled");
    await reply("La solicitud original ya no esta disponible (resuelta o caducada). No se aprueba nada.");
    return { ...base, outcome: "ignored_not_found" };
  }

  setProductionConfirmationStatus(confirmation.confirmationId, "confirmed");
  setApprovalRequestStatus(request.approvalRequestId, "approved", {
    answer: "approved",
    answeredBy: "telegram",
    reason: "Doble confirmacion via Telegram (produccion critica)",
  });
  await reply(`✅ Confirmado y aprobado: "${request.title}".`);
  return { ...base, outcome: "production_confirmed_approved", approvalRequestId: request.approvalRequestId, relatedType: request.relatedType };
}

/**
 * Fase O28.5 -- si hay un prompt de motivo de rechazo activo para este
 * chat, el mensaje se trata como la respuesta: se guarda como feedback
 * (ver src/core/visual-review-feedback.ts) y se cierra el prompt. Se
 * comprueba ANTES que cualquier otro tipo de comando, para que un motivo
 * como "no me gusta" no se reinterprete como un rechazo nuevo.
 */
async function tryHandleRejectReasonAnswer(update: UpdateBase): Promise<TelegramProcessedUpdate | null> {
  const prompt = findActiveRejectReasonPromptForChat(update.chatId);
  if (!prompt) return null;
  const now = Date.now();
  if (isRejectReasonPromptExpired(prompt, now)) {
    setRejectReasonPromptStatus(prompt.promptId, "expired");
    return null;
  }

  setRejectReasonPromptStatus(prompt.promptId, "answered");
  const current = readCurrentApprovalRequests();
  const request = findApprovalRequestById2(prompt.approvalRequestId, current);
  const wordpressPageId = request ? Number(request.relatedId) : undefined;
  recordVisualReviewFeedback({
    approvalRequestId: prompt.approvalRequestId,
    wordpressPageId: Number.isFinite(wordpressPageId) ? wordpressPageId : undefined,
    feedback: update.text.trim(),
    source: "telegram",
  });
  await reply("Gracias, lo tengo en cuenta para las proximas paginas.");
  return {
    updateId: update.updateId,
    chatId: update.chatId,
    text: update.text,
    outcome: "feedback_recorded",
    approvalRequestId: prompt.approvalRequestId,
    relatedType: request?.relatedType,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Fase O28.5 -- resuelve a que solicitud se refiere una frase en
 * lenguaje natural SIN id ("ok", "rechazar"...): solo si hay
 * EXACTAMENTE una solicitud pendiente y ya enviada por Telegram. Con 0 o
 * 2+, no hay forma honesta de adivinar -- se le dice a Pau que aclare.
 */
async function tryHandleNaturalLanguage(update: UpdateBase): Promise<TelegramProcessedUpdate | null> {
  const intent = parseNaturalLanguageIntent(update.text);
  if (!intent) return null;

  const pending = readCurrentApprovalRequests().filter((r) => r.status === "pending" && Boolean(r.sentAt));
  const base = { updateId: update.updateId, chatId: update.chatId, text: update.text, processedAt: new Date().toISOString() };

  if (pending.length === 0) {
    await reply("No hay ninguna aprobacion pendiente ahora mismo.");
    return { ...base, outcome: "ignored_no_pending_requests" };
  }
  if (pending.length > 1) {
    const list = pending
      .slice(0, 5)
      .map((r) => `- ${r.title} (${r.approvalRequestId.slice(0, 8)})`)
      .join("\n");
    await reply(`Hay ${pending.length} aprobaciones pendientes, no se a cual te refieres. Usa los botones del mensaje concreto, o "approve <id>"/"reject <id>":\n${list}`);
    return { ...base, outcome: "ignored_multiple_pending_needs_id" };
  }

  return handleApproveOrReject({ type: intent, id: pending[0].approvalRequestId }, update);
}

export interface TelegramApprovalReceiverRunResult {
  updatesFetched: number;
  updatesProcessed: number;
  approved: number;
  rejected: number;
  productionConfirmationsRequested: number;
  productionConfirmed: number;
  feedbackRecorded: number;
  ignored: number;
}

export async function runTelegramApprovalReceiver(): Promise<TelegramApprovalReceiverRunResult> {
  const result: TelegramApprovalReceiverRunResult = {
    updatesFetched: 0,
    updatesProcessed: 0,
    approved: 0,
    rejected: 0,
    productionConfirmationsRequested: 0,
    productionConfirmed: 0,
    feedbackRecorded: 0,
    ignored: 0,
  };

  if (!isTelegramApprovalsEnabled()) {
    logger.info("Telegram Approval Receiver: TELEGRAM_APPROVALS_ENABLED != true. No se hace nada.");
    return result;
  }

  const offset = getNextUpdateOffset();
  const updates: TelegramIncomingUpdate[] = await fetchTelegramUpdates(offset);
  result.updatesFetched = updates.length;

  for (const update of updates) {
    let processed: TelegramProcessedUpdate;

    if (!isAuthorizedTelegramChat(update.chatId)) {
      processed = {
        updateId: update.updateId,
        chatId: update.chatId,
        text: update.kind === "message" ? update.text : update.callbackData,
        outcome: "ignored_unauthorized_chat",
        processedAt: new Date().toISOString(),
      };
    } else if (update.kind === "callback") {
      // Fase O28.5 -- pulsar un boton: se responde al callback (quita el
      // "reloj" en el cliente de Telegram) y se reusa EXACTAMENTE la
      // misma logica que "approve <id>"/"reject <id>" en texto, solo que
      // el id ya viene sin ambiguedad en el callback_data -- nunca hace
      // falta que Pau escriba nada.
      await answerCallbackQuery(update.callbackQueryId, "Procesando...");
      const command = parseCallbackData(update.callbackData);
      const base: UpdateBase = { updateId: update.updateId, chatId: update.chatId, text: update.callbackData };
      if (!command) {
        processed = { updateId: update.updateId, chatId: update.chatId, text: update.callbackData, outcome: "ignored_no_command_match", processedAt: new Date().toISOString() };
      } else {
        processed = await handleApproveOrReject(command, base);
      }
    } else {
      // update.kind === "message"
      const base: UpdateBase = { updateId: update.updateId, chatId: update.chatId, text: update.text };
      const feedbackHandled = await tryHandleRejectReasonAnswer(base);
      if (feedbackHandled) {
        processed = feedbackHandled;
      } else {
        const command = parseTelegramCommand(update.text);
        if (command?.type === "confirm_production") {
          processed = await handleConfirmProduction(command.shortId, base);
        } else if (command) {
          processed = await handleApproveOrReject(command, base);
        } else {
          const naturalLanguageHandled = await tryHandleNaturalLanguage(base);
          processed =
            naturalLanguageHandled ?? {
              updateId: update.updateId,
              chatId: update.chatId,
              text: update.text,
              outcome: "ignored_no_command_match",
              processedAt: new Date().toISOString(),
            };
        }
      }
    }

    recordProcessedUpdate(processed);
    result.updatesProcessed += 1;
    switch (processed.outcome) {
      case "approved":
        result.approved += 1;
        break;
      case "rejected":
        result.rejected += 1;
        break;
      case "production_confirmation_requested":
        result.productionConfirmationsRequested += 1;
        break;
      case "production_confirmed_approved":
        result.productionConfirmed += 1;
        break;
      case "feedback_recorded":
        result.feedbackRecorded += 1;
        break;
      default:
        result.ignored += 1;
    }
  }

  logger.info("Telegram Approval Receiver finalizado", { ...result });
  return result;
}
