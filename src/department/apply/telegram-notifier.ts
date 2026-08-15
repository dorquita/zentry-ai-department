import { sendTelegramMessage } from "../../core/telegram-gateway";
import { DepartmentChangeRequest } from "./change-types";
import { ChangeTransitionPort } from "./staging-executor";
import { buildApprovalButtons, buildApprovalRequestMessage, isCallbackDataWithinLimit } from "./telegram-message";

/**
 * ENVIO de la solicitud de aprobacion por Telegram.
 *
 * Reutiliza el gateway de Telegram YA existente del proyecto (con su
 * sanitizado, su redaccion de secretos y su manejo de errores) y el
 * registro comun de aprobaciones (`data/approval-requests.jsonl`): NO se
 * crea un segundo canal ni un segundo registro de aprobaciones.
 *
 * Orden deliberado, para que no exista jamas un mensaje aprobable sin
 * registro persistente detras:
 *
 *   1. Crear/recuperar la solicitud en el registro comun (persistente).
 *   2. Comprobar que los `callback_data` caben en el limite de Telegram.
 *   3. Enviar el mensaje con los tres botones.
 *   4. Solo si el envio funciono: transicionar a `awaiting_approval` y
 *      guardar telegramApprovalId + messageId + hash de la version.
 *
 * Si el envio falla, el cambio se queda en `staging_applied` y se
 * reintentara en la siguiente pasada: nunca queda "esperando una
 * aprobacion" que nadie ha recibido.
 */

export interface ApprovalRequestPort {
  /** Crea (o recupera, si ya existia) la solicitud en el registro comun del proyecto. */
  upsertApprovalRequest: (input: { relatedId: string; title: string; summary: string; requestedAction: string }) => {
    approvalRequestId: string;
    isNew: boolean;
  };
  /** Marca que la solicitud se envio de verdad por el canal. */
  markSent: (approvalRequestId: string) => void;
  /** Inyectable para tests; por defecto, el gateway real. */
  send?: (text: string, buttons: { text: string; callbackData?: string; url?: string }[][]) => Promise<{ messageId: number | null; chatId: string }>;
  now?: () => Date;
}

export interface SendApprovalResult {
  change: DepartmentChangeRequest;
  sent: boolean;
  reason: string;
}

export async function sendChangeApprovalRequest(
  change: DepartmentChangeRequest,
  port: ChangeTransitionPort,
  approvals: ApprovalRequestPort
): Promise<SendApprovalResult> {
  const clock = approvals.now ?? (() => new Date());

  if (change.status !== "staging_applied") {
    return { change, sent: false, reason: `El cambio esta en "${change.status}": solo se pide aprobacion de algo aplicado y validado en staging.` };
  }
  const staging = change.staging;
  if (!staging || staging.validationStatus !== "passed" || !staging.resultingVersionHash) {
    return { change, sent: false, reason: "El apply de staging no esta validado: no se pide aprobacion de algo que no se ha verificado." };
  }
  if (!staging.url) {
    return { change, sent: false, reason: "El cambio no tiene URL de staging registrada, asi que no seria revisable desde el movil. No se pide aprobacion." };
  }

  const { approvalRequestId } = approvals.upsertApprovalRequest({
    relatedId: change.changeId,
    title: `Cambio del departamento: ${change.title}`,
    summary: `Pasada ${change.departmentRunId}, recomendacion #${change.recommendationRank} (v${change.version}). Aplicado y validado en staging: ${staging.url}. Aprobar publica ESTA version en produccion, con snapshot previo, validacion posterior y rollback automatico si la validacion falla.`,
    requestedAction: "Aprobar o rechazar la publicacion en PRODUCCION de la version que esta ahora mismo en staging.",
  });

  const buttons = buildApprovalButtons(approvalRequestId, staging.url);
  const oversized = buttons.flat().filter((b) => b.callbackData && !isCallbackDataWithinLimit(b.callbackData));
  if (oversized.length > 0) {
    return {
      change,
      sent: false,
      reason: `El identificador de la solicitud no cabe en el limite de callback_data de Telegram (${oversized.length} boton(es) fuera de rango). No se envia un mensaje con botones que no funcionarian.`,
    };
  }

  const send =
    approvals.send ??
    (async (text, rows) => sendTelegramMessage(text, { plainText: true, buttons: rows }));

  let sentMessage: { messageId: number | null; chatId: string };
  try {
    sentMessage = await send(buildApprovalRequestMessage(change), buttons);
  } catch (err) {
    const reason = `Fallo enviando la solicitud por Telegram: ${err instanceof Error ? err.message : String(err)}. El cambio sigue en staging y se reintentara.`;
    return { change: port.note(change, {}, { event: "approval_request_send_failed", detail: reason }), sent: false, reason };
  }

  approvals.markSent(approvalRequestId);

  const result = port.transition(
    change,
    "awaiting_approval",
    {
      telegram: {
        telegramApprovalId: approvalRequestId,
        telegramMessageId: sentMessage.messageId,
        chatId: sentMessage.chatId,
        sentAt: clock().toISOString(),
        stagingVersionHash: staging.resultingVersionHash,
      },
    },
    {
      event: "approval_requested",
      detail: `Solicitud de aprobacion enviada por Telegram (approvalRequestId=${approvalRequestId}, message_id=${sentMessage.messageId ?? "no confirmado"}). La aprobacion vale UNICAMENTE para la version ${staging.resultingVersionHash.slice(0, 12)} que hay ahora en staging.`,
    }
  );

  return {
    change: result.ok ? result.change : change,
    sent: result.ok,
    reason: result.ok ? `approvalRequestId=${approvalRequestId}` : result.reason,
  };
}
