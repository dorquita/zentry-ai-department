import { DepartmentChangeRequest } from "./change-types";
import { ChangeTransitionPort } from "./staging-executor";
import {
  authorizeTelegramActor,
  checkApprovalPreconditions,
  checkApprovedVersionStillCurrent,
  checkRejectionAllowed,
  validateRejectionReason,
} from "./telegram-decisions";
import { buildRejectionRecordedMessage, buildRejectionReasonPrompt, buildViewChangesMessage, parseDepartmentCallbackData } from "./telegram-message";

/**
 * ORQUESTACION del flujo de botones de Telegram para los cambios del
 * departamento (✅ APROBAR / ❌ RECHAZAR / 👁 VER CAMBIOS).
 *
 * Toda la logica de "se puede o no" vive en telegram-decisions.ts
 * (puro); todos los efectos (leer el registro, escribir, releer staging,
 * publicar en produccion, responder en el chat) llegan INYECTADOS. Este
 * modulo solo los encadena en el orden correcto, que es donde estan las
 * garantias:
 *
 *   autorizar -> localizar el cambio -> precondiciones (estado, doble
 *   aprobacion, caducidad) -> releer staging y comprobar que sigue
 *   siendo la version aprobada -> registrar la decision humana ->
 *   publicar.
 *
 * Ninguna de esas etapas se puede saltar, y ninguna se puede reordenar
 * sin que los tests lo canten.
 */

export interface DepartmentTelegramUpdate {
  updateId: number;
  chatId: string;
  fromUserId?: string;
  /** `callback_data` (pulsacion de boton) o texto del mensaje. */
  data: string;
}

export interface DepartmentTelegramPorts {
  authorizedChatId: string;
  /** Vacio = no configurado; entonces la autorizacion se apoya solo en el chat. */
  authorizedUserId: string;
  findChangeByApprovalId: (approvalRequestId: string) => DepartmentChangeRequest | undefined;
  changes: ChangeTransitionPort;
  /** Sincroniza el registro comun de aprobaciones del proyecto (no se mantiene un segundo sistema). */
  setSharedApprovalStatus: (approvalRequestId: string, status: "approved" | "rejected", detail: { answeredBy: string; reason: string }) => void;
  /** Relee staging y devuelve el hash de la version actual. `null` = no se pudo leer (fail-closed). */
  readStagingVersionHash: (change: DepartmentChangeRequest) => Promise<string | null>;
  /** Publica en produccion el cambio ya aprobado. Devuelve el mensaje a enviar (nunca esconde un fallo). */
  runProductionApply: (change: DepartmentChangeRequest) => Promise<{ change: DepartmentChangeRequest; message: string }>;
  reply: (text: string) => Promise<void>;
  /** Abre la pregunta persistente "¿por que lo rechazas?" para este chat. */
  openRejectionPrompt: (approvalRequestId: string, chatId: string) => void;
  /** Prompt de rechazo ACTIVO de este chat, si lo hay. */
  findActiveRejectionPrompt: (chatId: string) => { promptId: string; approvalRequestId: string } | undefined;
  closeRejectionPrompt: (promptId: string) => void;
  /** Guarda el motivo como feedback humano consultable por los agentes. */
  recordFeedback: (input: { approvalRequestId: string; changeId: string; feedback: string }) => void;
  /** Identidad del autor para el registro (nunca inventada). */
  actorLabel: (update: DepartmentTelegramUpdate) => string;
  now?: () => Date;
}

export type DepartmentTelegramOutcome =
  | "department_view_changes"
  | "department_approved"
  | "department_production_reported"
  | "department_approval_stale"
  | "department_rejected_awaiting_reason"
  | "department_rejection_reason_recorded"
  | "department_ignored_unauthorized"
  | "department_ignored";

export interface DepartmentTelegramResult {
  outcome: DepartmentTelegramOutcome;
  changeId: string | null;
  approvalRequestId: string | null;
  detail: string;
}

/**
 * Procesa una pulsacion de boton del departamento. Devuelve `null` si el
 * callback NO es de este flujo -- asi el receiver puede seguir con su
 * logica de siempre para el resto de aprobaciones del proyecto.
 */
export async function handleDepartmentCallback(
  update: DepartmentTelegramUpdate,
  ports: DepartmentTelegramPorts
): Promise<DepartmentTelegramResult | null> {
  const parsed = parseDepartmentCallbackData(update.data);
  if (!parsed) return null;

  const auth = authorizeTelegramActor({
    chatId: update.chatId,
    authorizedChatId: ports.authorizedChatId,
    fromUserId: update.fromUserId,
    authorizedUserId: ports.authorizedUserId,
  });
  if (!auth.authorized) {
    // No se responde NADA al chat no autorizado: contestar confirmaria
    // que el bot existe y que ese id es valido.
    return { outcome: "department_ignored_unauthorized", changeId: null, approvalRequestId: parsed.approvalRequestId, detail: auth.reason };
  }

  const change = ports.findChangeByApprovalId(parsed.approvalRequestId);

  if (parsed.action === "view") {
    if (!change) {
      await ports.reply("No encuentro ningun cambio del departamento asociado a ese boton. Puede ser un mensaje antiguo.");
      return { outcome: "department_ignored", changeId: null, approvalRequestId: parsed.approvalRequestId, detail: "Cambio no encontrado." };
    }
    await ports.reply(buildViewChangesMessage(change));
    return {
      outcome: "department_view_changes",
      changeId: change.changeId,
      approvalRequestId: parsed.approvalRequestId,
      detail: "Detalle del cambio enviado (URL de staging y before/after reales del apply).",
    };
  }

  if (parsed.action === "reject") return handleReject(change, parsed.approvalRequestId, update, ports);
  return handleApprove(change, parsed.approvalRequestId, update, ports);
}

async function handleReject(
  change: DepartmentChangeRequest | undefined,
  approvalRequestId: string,
  update: DepartmentTelegramUpdate,
  ports: DepartmentTelegramPorts
): Promise<DepartmentTelegramResult> {
  const check = checkRejectionAllowed(change);
  if (!check.allowed || !change) {
    await ports.reply(check.reply);
    return { outcome: "department_ignored", changeId: change?.changeId ?? null, approvalRequestId, detail: check.reason };
  }

  const result = ports.changes.transition(
    change,
    "awaiting_rejection_reason",
    {},
    {
      event: "rejection_started",
      detail: `Rechazo iniciado desde Telegram por ${ports.actorLabel(update)}. El rechazo NO se cierra hasta que haya un motivo escrito.`,
    }
  );
  if (!result.ok) {
    await ports.reply(`No he podido registrar el rechazo: ${result.reason}`);
    return { outcome: "department_ignored", changeId: change.changeId, approvalRequestId, detail: result.reason };
  }

  ports.openRejectionPrompt(approvalRequestId, update.chatId);
  await ports.reply(buildRejectionReasonPrompt(change));
  return {
    outcome: "department_rejected_awaiting_reason",
    changeId: change.changeId,
    approvalRequestId,
    detail: "Rechazo abierto: esperando el motivo. Produccion no se ha tocado.",
  };
}

async function handleApprove(
  change: DepartmentChangeRequest | undefined,
  approvalRequestId: string,
  update: DepartmentTelegramUpdate,
  ports: DepartmentTelegramPorts
): Promise<DepartmentTelegramResult> {
  const now = (ports.now ?? (() => new Date()))();

  const pre = checkApprovalPreconditions(change, now);
  if (!pre.proceed || !change) {
    if (pre.nextStatus && change) {
      ports.changes.transition(change, pre.nextStatus, {}, { event: "approval_refused", detail: pre.reason });
    }
    await ports.reply(pre.reply);
    return {
      outcome: pre.nextStatus === "approval_stale" ? "department_approval_stale" : "department_ignored",
      changeId: change?.changeId ?? null,
      approvalRequestId,
      detail: pre.reason,
    };
  }

  // Anti-TOCTOU: la aprobacion vale para la version que se enseño, no
  // para "lo que haya ahora" en staging.
  const currentHash = await ports.readStagingVersionHash(change);
  const versionCheck = checkApprovedVersionStillCurrent(change, currentHash);
  if (versionCheck.outcome === "stale") {
    ports.changes.transition(change, "approval_stale", {}, { event: "approval_stale", detail: versionCheck.reason });
    await ports.reply(versionCheck.reply);
    return { outcome: "department_approval_stale", changeId: change.changeId, approvalRequestId, detail: versionCheck.reason };
  }

  const actor = ports.actorLabel(update);
  const approved = ports.changes.transition(
    change,
    "approved",
    {
      humanDecision: {
        decision: "approved",
        decidedBy: actor,
        decidedAt: now.toISOString(),
        rejectionReason: "",
        channel: "telegram",
      },
    },
    {
      event: "approved_by_human",
      detail: `Aprobacion humana explicita registrada (${actor}) para la version que hay ahora mismo en staging. ${versionCheck.reason}`,
    }
  );
  if (!approved.ok) {
    await ports.reply(`No he podido registrar la aprobacion: ${approved.reason}`);
    return { outcome: "department_ignored", changeId: change.changeId, approvalRequestId, detail: approved.reason };
  }

  // El registro COMUN de aprobaciones del proyecto se sincroniza siempre:
  // los dos registros tienen que decir lo mismo, y el apply de produccion
  // exige que asi sea.
  ports.setSharedApprovalStatus(approvalRequestId, "approved", { answeredBy: "telegram", reason: `Aprobado via Telegram por ${actor}` });

  const production = await ports.runProductionApply(approved.change);
  await ports.reply(production.message);
  return {
    outcome: "department_production_reported",
    changeId: approved.change.changeId,
    approvalRequestId,
    detail: `Aprobado por ${actor}. Resultado de produccion: ${production.change.status}.`,
  };
}

/**
 * Procesa un mensaje de texto que puede ser la respuesta a un rechazo
 * abierto de este flujo. Devuelve `null` si no hay ningun rechazo del
 * departamento esperando motivo en este chat.
 */
export async function handleDepartmentRejectionReason(
  update: DepartmentTelegramUpdate,
  ports: DepartmentTelegramPorts
): Promise<DepartmentTelegramResult | null> {
  const prompt = ports.findActiveRejectionPrompt(update.chatId);
  if (!prompt) return null;

  const change = ports.findChangeByApprovalId(prompt.approvalRequestId);
  // No es un rechazo del departamento: lo gestiona el flujo existente.
  if (!change) return null;

  const auth = authorizeTelegramActor({
    chatId: update.chatId,
    authorizedChatId: ports.authorizedChatId,
    fromUserId: update.fromUserId,
    authorizedUserId: ports.authorizedUserId,
  });
  if (!auth.authorized) {
    return { outcome: "department_ignored_unauthorized", changeId: change.changeId, approvalRequestId: prompt.approvalRequestId, detail: auth.reason };
  }

  if (change.status !== "awaiting_rejection_reason") {
    // El prompt quedo huerfano (el cambio avanzo por otra via): se cierra
    // sin tocar nada, y el mensaje sigue su curso normal.
    ports.closeRejectionPrompt(prompt.promptId);
    return null;
  }

  const validation = validateRejectionReason(update.data);
  if (!validation.accepted) {
    await ports.reply(`${validation.reason} Escribeme el motivo del rechazo y lo guardo.`);
    return {
      outcome: "department_rejected_awaiting_reason",
      changeId: change.changeId,
      approvalRequestId: prompt.approvalRequestId,
      detail: validation.reason,
    };
  }

  const now = (ports.now ?? (() => new Date()))();
  const reason = update.data.trim();
  const actor = ports.actorLabel(update);

  const rejected = ports.changes.transition(
    change,
    "rejected",
    {
      humanDecision: {
        decision: "rejected",
        decidedBy: actor,
        decidedAt: now.toISOString(),
        rejectionReason: reason,
        channel: "telegram",
      },
    },
    {
      event: "rejected_by_human",
      detail: `Rechazo cerrado con motivo por ${actor}: "${reason}". El motivo queda disponible para las siguientes propuestas de esta recomendacion. Produccion no se ha tocado.`,
    }
  );
  if (!rejected.ok) {
    await ports.reply(`No he podido cerrar el rechazo: ${rejected.reason}`);
    return { outcome: "department_ignored", changeId: change.changeId, approvalRequestId: prompt.approvalRequestId, detail: rejected.reason };
  }

  ports.closeRejectionPrompt(prompt.promptId);
  ports.setSharedApprovalStatus(prompt.approvalRequestId, "rejected", { answeredBy: "telegram", reason });
  ports.recordFeedback({ approvalRequestId: prompt.approvalRequestId, changeId: change.changeId, feedback: reason });
  await ports.reply(buildRejectionRecordedMessage(change, reason));

  return {
    outcome: "department_rejection_reason_recorded",
    changeId: change.changeId,
    approvalRequestId: prompt.approvalRequestId,
    detail: `Motivo guardado: "${reason}".`,
  };
}
