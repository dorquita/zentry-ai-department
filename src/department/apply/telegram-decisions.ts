import { DepartmentChangeRequest } from "./change-types";
import { DepartmentChangeStatus } from "./state-machine";
// Igual que en telegram-message.ts: este modulo corre TAMBIEN dentro del
// Worker, y `./version` arrastra `node:crypto`.
import { matchesApprovedVersion } from "../../approvals/version-compare";

/**
 * DECISIONES del flujo de aprobacion por Telegram, en un modulo PURO.
 *
 * Aqui vive TODA la logica de "se puede o no se puede": autorizacion,
 * caducidad, doble aprobacion, callback viejo, y la comprobacion
 * anti-TOCTOU de que staging siga siendo lo que se aprobo. El receiver
 * (src/agents/telegram-approval-receiver.ts) solo hace de cableado: lee
 * de Telegram, llama aqui, escribe en el registro y responde. Asi cada
 * regla de seguridad se puede testear sin red, sin ficheros y sin reloj
 * real.
 *
 * Todas las funciones son fail-closed: ante cualquier duda, `allowed:
 * false` con el motivo exacto.
 */

/** Ventana de validez de una solicitud de aprobacion (misma que el resto del proyecto). */
export const APPROVAL_VALIDITY_HOURS = 72;

export interface AuthorizationInput {
  /** chat del que llega la actualizacion. */
  chatId: string;
  /** chat autorizado (del `.env`, ya resuelto por quien llama -- nunca se lee aqui). */
  authorizedChatId: string;
  /** id numerico del usuario de Telegram que pulso el boton/escribio, si Telegram lo reporto. */
  fromUserId?: string;
  /**
   * Usuario autorizado, si esta configurado. `undefined`/vacio = no
   * configurado: la autorizacion se apoya solo en el chat (que ya es
   * privado). Si ESTA configurado, se exige que coincida.
   */
  authorizedUserId?: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  reason: string;
}

export function authorizeTelegramActor(input: AuthorizationInput): AuthorizationResult {
  const authorizedChat = String(input.authorizedChatId ?? "").trim();
  if (authorizedChat.length === 0) {
    return { authorized: false, reason: "No hay chat autorizado configurado. Fail-closed: no se acepta ninguna decision." };
  }
  if (String(input.chatId ?? "").trim() !== authorizedChat) {
    return { authorized: false, reason: "La actualizacion viene de un chat que no es el autorizado. Se ignora." };
  }
  const authorizedUser = String(input.authorizedUserId ?? "").trim();
  if (authorizedUser.length > 0) {
    const actor = String(input.fromUserId ?? "").trim();
    if (actor.length === 0) {
      return { authorized: false, reason: "Hay un usuario de Telegram autorizado configurado, pero la actualizacion no reporta autor. Fail-closed: se ignora." };
    }
    if (actor !== authorizedUser) {
      return { authorized: false, reason: "La decision viene de un usuario de Telegram distinto del autorizado. Se ignora." };
    }
  }
  return { authorized: true, reason: "Chat (y usuario, si esta configurado) autorizados." };
}

export type ApprovalPreconditionOutcome =
  | "ok"
  | "not_found"
  | "already_approved"
  | "already_rejected"
  | "already_resolved"
  | "expired"
  | "wrong_state";

export interface ApprovalPreconditionResult {
  outcome: ApprovalPreconditionOutcome;
  /** `true` solo si se puede seguir adelante y releer staging. */
  proceed: boolean;
  /** Estado al que hay que mover el cambio si el resultado no permite seguir. `null` = no se mueve nada. */
  nextStatus: DepartmentChangeStatus | null;
  /** Respuesta lista para enviar por Telegram. Siempre no vacia. */
  reply: string;
  reason: string;
}

function hoursSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return (now.getTime() - parsed) / (1000 * 60 * 60);
}

/**
 * Comprobaciones que NO necesitan tocar la red: estado del cambio,
 * doble aprobacion, callback de un mensaje ya resuelto, y caducidad.
 * Solo si devuelve `proceed: true` merece la pena releer staging.
 */
export function checkApprovalPreconditions(change: DepartmentChangeRequest | undefined, now: Date): ApprovalPreconditionResult {
  if (!change) {
    return {
      outcome: "not_found",
      proceed: false,
      nextStatus: null,
      reply: "No encuentro ningun cambio del departamento asociado a ese boton. Puede ser un mensaje antiguo de una version que ya no existe.",
      reason: "No hay ningun cambio con ese approvalRequestId en el registro persistente.",
    };
  }

  if (change.status === "approved" || change.status === "production_applying" || change.status === "production_applied") {
    return {
      outcome: "already_approved",
      proceed: false,
      nextStatus: null,
      reply: `Ese cambio ya estaba aprobado (estado actual: ${change.status}). No se aprueba dos veces ni se vuelve a publicar.`,
      reason: "Doble aprobacion: idempotente, no se repite ninguna escritura.",
    };
  }
  if (change.status === "rejected" || change.status === "awaiting_rejection_reason") {
    return {
      outcome: "already_rejected",
      proceed: false,
      nextStatus: null,
      reply: `Ese cambio ya estaba rechazado (estado actual: ${change.status}). Si quieres retomarlo, hara falta una propuesta nueva.`,
      reason: "El cambio ya tiene una decision humana de rechazo.",
    };
  }
  if (change.status !== "awaiting_approval") {
    return {
      outcome: change.status === "approval_stale" ? "already_resolved" : "wrong_state",
      proceed: false,
      nextStatus: null,
      reply: `Ese cambio no esta esperando aprobacion ahora mismo (estado: ${change.status}). No hago nada.`,
      reason: `Solo se puede aprobar desde "awaiting_approval"; el cambio esta en "${change.status}".`,
    };
  }

  const age = hoursSince(change.telegram?.sentAt ?? null, now);
  if (age === null) {
    return {
      outcome: "expired",
      proceed: false,
      nextStatus: "approval_stale",
      reply: "No puedo confirmar cuando se envio esta solicitud, asi que no la doy por valida. Hara falta una aprobacion nueva.",
      reason: "Sin fecha de envio fiable no se puede acotar la ventana de validez. Fail-closed.",
    };
  }
  if (age > APPROVAL_VALIDITY_HOURS) {
    return {
      outcome: "expired",
      proceed: false,
      nextStatus: "approval_stale",
      reply: `Esa solicitud ya caduco (enviada hace ${Math.floor(age)} h, limite ${APPROVAL_VALIDITY_HOURS} h). Hara falta una aprobacion nueva sobre la version actual.`,
      reason: "Aprobacion fuera de la ventana de validez.",
    };
  }

  return { outcome: "ok", proceed: true, nextStatus: null, reply: "", reason: "El cambio esta esperando aprobacion y la solicitud sigue vigente." };
}

export type ApprovalVersionOutcome = "approved" | "stale";

export interface ApprovalVersionResult {
  outcome: ApprovalVersionOutcome;
  nextStatus: DepartmentChangeStatus;
  reply: string;
  reason: string;
}

/**
 * Comprobacion anti-TOCTOU: la aprobacion solo vale para la version
 * EXACTA que se enseño en el mensaje. `currentStagingVersionHash` lo
 * calcula quien llama releyendo staging (o `null` si no pudo leerlo, que
 * tambien es motivo suficiente para no publicar).
 */
export function checkApprovedVersionStillCurrent(
  change: DepartmentChangeRequest,
  currentStagingVersionHash: string | null
): ApprovalVersionResult {
  const approvedHash = change.telegram?.stagingVersionHash ?? change.staging?.resultingVersionHash ?? null;
  const match = matchesApprovedVersion(approvedHash, currentStagingVersionHash);
  if (!match.matches) {
    return {
      outcome: "stale",
      nextStatus: "approval_stale",
      reply: `🚫 No publico nada.\n\n${match.reason}\n\nTe enviare una solicitud nueva cuando el departamento vuelva a dejar una version validada en staging.`,
      reason: match.reason,
    };
  }
  return {
    outcome: "approved",
    nextStatus: "approved",
    reply: "Aprobacion registrada. Publicando en produccion...",
    reason: match.reason,
  };
}

export interface RejectionResult {
  allowed: boolean;
  nextStatus: DepartmentChangeStatus | null;
  reply: string;
  reason: string;
}

/**
 * Pulsar RECHAZAR no cierra el rechazo: abre `awaiting_rejection_reason`.
 * El rechazo no esta completo hasta que hay un motivo escrito.
 */
export function checkRejectionAllowed(change: DepartmentChangeRequest | undefined): RejectionResult {
  if (!change) {
    return {
      allowed: false,
      nextStatus: null,
      reply: "No encuentro ningun cambio del departamento asociado a ese boton. Puede ser un mensaje antiguo.",
      reason: "No hay ningun cambio con ese approvalRequestId.",
    };
  }
  if (change.status === "awaiting_rejection_reason") {
    return {
      allowed: false,
      nextStatus: null,
      reply: "Ya te habia pedido el motivo del rechazo. Escribemelo y lo guardo.",
      reason: "Ya hay un rechazo abierto esperando motivo.",
    };
  }
  if (change.status !== "awaiting_approval") {
    return {
      allowed: false,
      nextStatus: null,
      reply: `Ese cambio no esta esperando decision ahora mismo (estado: ${change.status}). No hago nada.`,
      reason: `Solo se puede rechazar desde "awaiting_approval"; el cambio esta en "${change.status}".`,
    };
  }
  return {
    allowed: true,
    nextStatus: "awaiting_rejection_reason",
    reply: "",
    reason: "Rechazo abierto: falta el motivo para cerrarlo.",
  };
}

export interface RejectionReasonResult {
  accepted: boolean;
  reason: string;
}

/**
 * Valida el texto del motivo. Deliberadamente permisivo con el
 * CONTENIDO (cualquier motivo real vale, no se clasifica ni se juzga) y
 * estricto solo con lo vacio: un rechazo sin motivo no se cierra.
 */
export function validateRejectionReason(text: string): RejectionReasonResult {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length === 0) {
    return { accepted: false, reason: "El motivo esta vacio: el rechazo sigue abierto hasta que haya uno." };
  }
  if (trimmed.length < 3) {
    return { accepted: false, reason: "El motivo es demasiado corto para servir de feedback. Sigo esperando uno." };
  }
  return { accepted: true, reason: "Motivo valido: se guarda como feedback humano de esta version." };
}
