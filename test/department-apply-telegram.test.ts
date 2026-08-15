import * as assert from "node:assert/strict";
import { DepartmentChangeRequest, EnvironmentApplyRecord } from "../src/department/apply/change-types";
import {
  authorizeTelegramActor,
  checkApprovalPreconditions,
  checkApprovedVersionStillCurrent,
  checkRejectionAllowed,
  validateRejectionReason,
} from "../src/department/apply/telegram-decisions";
import {
  DepartmentTelegramPorts,
  handleDepartmentCallback,
  handleDepartmentRejectionReason,
} from "../src/department/apply/telegram-handler";
import {
  buildApprovalButtons,
  buildApprovalRequestMessage,
  buildCallbackData,
  buildViewChangesMessage,
  isCallbackDataWithinLimit,
  parseDepartmentCallbackData,
} from "../src/department/apply/telegram-message";
import { sendChangeApprovalRequest } from "../src/department/apply/telegram-notifier";
import { change, memoryPort, MemoryPort, NEW_META, NEW_TITLE, NOW, STAGING_URL } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const APPROVAL_ID = "3f2a1b4c-1111-2222-3333-444455556666";
const HASH = "a".repeat(64);

function stagingRecord(overrides: Partial<EnvironmentApplyRecord> = {}): EnvironmentApplyRecord {
  return {
    environment: "staging",
    applyId: "staging::change-1",
    wordpressPageId: 2091,
    url: STAGING_URL,
    pageSlug: "taquillas-melamina",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    snapshot: {
      takenAt: NOW.toISOString(),
      environment: "staging",
      wordpressPageId: 2091,
      previousStatus: "publish",
      previousTitle: "Titulo antiguo",
      previousMetaDescription: "Meta antigua",
      previousContentHash: "h",
      previousVersionHash: "p",
    },
    changedFields: [
      { field: "title", before: "Titulo antiguo", after: NEW_TITLE, changed: true },
      { field: "meta description", before: "Meta antigua", after: NEW_META, changed: true },
      { field: "contenido (cuerpo)", before: "(sin cambios)", after: "(sin cambios)", changed: false },
    ],
    validationStatus: "passed",
    validationDetail: "ok",
    rollbackStatus: "not_needed",
    rollbackDetail: "",
    resultingVersionHash: HASH,
    ...overrides,
  };
}

function awaitingChange(overrides: Partial<DepartmentChangeRequest> = {}): DepartmentChangeRequest {
  return change({
    status: "awaiting_approval",
    staging: stagingRecord(),
    telegram: { telegramApprovalId: APPROVAL_ID, telegramMessageId: 77, chatId: "555", sentAt: NOW.toISOString(), stagingVersionHash: HASH },
    ...overrides,
  });
}

interface PortHarness {
  ports: DepartmentTelegramPorts;
  replies: string[];
  port: MemoryPort;
  sharedStatus: { approvalRequestId: string; status: string; reason: string }[];
  prompts: { promptId: string; approvalRequestId: string; chatId: string; closed: boolean }[];
  feedback: { changeId: string; feedback: string }[];
  productionCalls: number;
  state: { change: DepartmentChangeRequest | undefined };
}

function ports(
  initial: DepartmentChangeRequest | undefined,
  options: { currentHash?: string | null; authorizedUserId?: string; productionMessage?: string; activePrompt?: boolean } = {}
): PortHarness {
  const replies: string[] = [];
  const port = memoryPort();
  const sharedStatus: PortHarness["sharedStatus"] = [];
  const prompts: PortHarness["prompts"] = options.activePrompt
    ? [{ promptId: "p-1", approvalRequestId: APPROVAL_ID, chatId: "555", closed: false }]
    : [];
  const feedback: PortHarness["feedback"] = [];
  const state = { change: initial };
  const counters = { production: 0 };

  const harness: PortHarness = {
    replies,
    port,
    sharedStatus,
    prompts,
    feedback,
    get productionCalls() {
      return counters.production;
    },
    state,
    ports: {
      authorizedChatId: "555",
      authorizedUserId: options.authorizedUserId ?? "",
      findChangeByApprovalId: (id) => (state.change && state.change.telegram?.telegramApprovalId === id ? state.change : undefined),
      changes: {
        transition: (current, next, updates, audit) => {
          const result = port.transition(current, next, updates, audit);
          if (result.ok) state.change = result.change;
          return result;
        },
        note: (current, updates, audit) => {
          const updated = port.note(current, updates, audit);
          state.change = updated;
          return updated;
        },
      },
      setSharedApprovalStatus: (approvalRequestId, status, detail) => sharedStatus.push({ approvalRequestId, status, reason: detail.reason }),
      readStagingVersionHash: async () => (options.currentHash === undefined ? HASH : options.currentHash),
      runProductionApply: async (c) => {
        counters.production += 1;
        return { change: c, message: options.productionMessage ?? "✅ CAMBIO PUBLICADO" };
      },
      reply: async (text) => {
        replies.push(text);
      },
      openRejectionPrompt: (approvalRequestId, chatId) => prompts.push({ promptId: `p-${prompts.length + 1}`, approvalRequestId, chatId, closed: false }),
      findActiveRejectionPrompt: (chatId) => prompts.find((p) => p.chatId === chatId && !p.closed),
      closeRejectionPrompt: (promptId) => {
        const found = prompts.find((p) => p.promptId === promptId);
        if (found) found.closed = true;
      },
      recordFeedback: (input) => feedback.push({ changeId: input.changeId, feedback: input.feedback }),
      actorLabel: (u) => (u.fromUserId ? `telegram:${u.fromUserId}` : `telegram:chat:${u.chatId}`),
      now: () => NOW,
    },
  };
  return harness;
}

function update(overrides: { data?: string; chatId?: string; fromUserId?: string } = {}) {
  return { updateId: 1, chatId: overrides.chatId ?? "555", fromUserId: overrides.fromUserId, data: overrides.data ?? buildCallbackData("approve", APPROVAL_ID) };
}

export function runDepartmentApplyTelegramTests(): TestCase[] {
  return [
    // --- Mensaje y botones ---
    {
      name: "La solicitud lleva EXACTAMENTE los tres botones acordados, con su accion correcta",
      fn: () => {
        const rows = buildApprovalButtons(APPROVAL_ID, STAGING_URL);
        const flat = rows.flat();
        const byText = (needle: string) => flat.find((b) => b.text.includes(needle));
        assert.ok(byText("APROBAR")?.callbackData === `dept:approve:${APPROVAL_ID}`);
        assert.ok(byText("RECHAZAR")?.callbackData === `dept:reject:${APPROVAL_ID}`);
        assert.ok(byText("VER CAMBIOS")?.callbackData === `dept:view:${APPROVAL_ID}`);
        assert.equal(flat.filter((b) => b.callbackData).length, 3, "solo tres botones de accion");
        assert.equal(byText("Abrir en staging")?.url, STAGING_URL, "y un enlace directo para abrirlo desde el movil");
      },
    },
    {
      name: "Sin URL de staging no se ofrece el boton de abrir (nunca se inventa un enlace)",
      fn: () => {
        const flat = buildApprovalButtons(APPROVAL_ID, "").flat();
        assert.equal(flat.filter((b) => b.url).length, 0);
        assert.equal(flat.length, 3);
      },
    },
    {
      name: "El callback_data cabe en el limite de 64 bytes de Telegram",
      fn: () => {
        for (const button of buildApprovalButtons(APPROVAL_ID, STAGING_URL).flat()) {
          if (button.callbackData) assert.equal(isCallbackDataWithinLimit(button.callbackData), true, `no cabe: ${button.callbackData}`);
        }
        assert.equal(isCallbackDataWithinLimit(`dept:approve:${"x".repeat(80)}`), false);
      },
    },
    {
      name: "El callback del departamento se distingue del flujo historico `appr:`",
      fn: () => {
        assert.deepEqual(parseDepartmentCallbackData(`dept:view:${APPROVAL_ID}`), { action: "view", approvalRequestId: APPROVAL_ID });
        assert.equal(parseDepartmentCallbackData(`appr:approve:${APPROVAL_ID}`), null, "no secuestra los callbacks del flujo existente");
        assert.equal(parseDepartmentCallbackData("cualquier cosa"), null);
      },
    },
    {
      name: "El mensaje es corto, util desde el movil y solo contiene datos reales del apply",
      fn: () => {
        const text = buildApprovalRequestMessage(awaitingChange());
        assert.ok(text.includes("ZENTRY AI DEPARTMENT"));
        assert.ok(text.includes("PROPUESTA LISTA PARA REVISION"));
        assert.ok(text.includes(STAGING_URL), "la URL de staging real esta en el mensaje");
        assert.ok(text.includes(NEW_TITLE), "el before/after real del apply");
        assert.ok(text.includes("QA: PASS"));
        assert.ok(text.length < 1400, `el mensaje deberia ser breve, mide ${text.length}`);
      },
    },
    {
      name: "VER CAMBIOS muestra la URL exacta, el page id y el before -> after real, y dice que produccion no se ha tocado",
      fn: () => {
        const text = buildViewChangesMessage(awaitingChange());
        assert.ok(text.includes(STAGING_URL));
        assert.ok(text.includes("page_id: 2091"));
        assert.ok(text.includes("Titulo antiguo"));
        assert.ok(text.includes(NEW_TITLE));
        assert.ok(text.includes("sin cambio"), "los campos no tocados se declaran, no se ocultan");
        assert.match(text, /Produccion NO se ha tocado/i);
      },
    },

    // --- Autorizacion ---
    {
      name: "Chat no autorizado: se ignora y NO se responde nada",
      fn: async () => {
        const h = ports(awaitingChange());
        const result = await handleDepartmentCallback(update({ chatId: "999" }), h.ports);
        assert.equal(result?.outcome, "department_ignored_unauthorized");
        assert.equal(h.replies.length, 0, "no se contesta a un chat no autorizado");
        assert.equal(h.productionCalls, 0);
        assert.equal(h.state.change?.status, "awaiting_approval", "el cambio no se mueve");
      },
    },
    {
      name: "Usuario de Telegram distinto del autorizado: bloqueado aunque el chat sea el correcto",
      fn: async () => {
        const h = ports(awaitingChange(), { authorizedUserId: "111" });
        const result = await handleDepartmentCallback(update({ fromUserId: "222" }), h.ports);
        assert.equal(result?.outcome, "department_ignored_unauthorized");
        assert.equal(h.productionCalls, 0);
      },
    },
    {
      name: "Si hay usuario autorizado configurado y Telegram no reporta autor -> fail-closed",
      fn: () => {
        const auth = authorizeTelegramActor({ chatId: "555", authorizedChatId: "555", authorizedUserId: "111" });
        assert.equal(auth.authorized, false);
        assert.match(auth.reason, /no reporta autor/i);
      },
    },
    {
      name: "Sin chat autorizado configurado no se acepta ninguna decision",
      fn: () => {
        assert.equal(authorizeTelegramActor({ chatId: "555", authorizedChatId: "" }).authorized, false);
      },
    },

    // --- Aprobar ---
    {
      name: "APROBAR de usuario autorizado -> decision humana registrada y produccion lanzada",
      fn: async () => {
        const h = ports(awaitingChange(), { authorizedUserId: "111" });
        const result = await handleDepartmentCallback(update({ fromUserId: "111" }), h.ports);

        assert.equal(result?.outcome, "department_production_reported");
        assert.equal(h.state.change?.status, "approved");
        assert.equal(h.state.change?.humanDecision?.decision, "approved");
        assert.equal(h.state.change?.humanDecision?.decidedBy, "telegram:111");
        assert.equal(h.state.change?.humanDecision?.decidedAt, NOW.toISOString());
        assert.equal(h.productionCalls, 1);
        // El registro comun del proyecto se sincroniza: los dos deben decir lo mismo.
        assert.equal(h.sharedStatus[0]?.status, "approved");
        assert.ok(h.replies.some((r) => r.includes("CAMBIO PUBLICADO")));
      },
    },
    {
      name: "Doble APROBAR: la segunda pulsacion es idempotente y NO vuelve a publicar",
      fn: async () => {
        const h = ports(awaitingChange());
        await handleDepartmentCallback(update(), h.ports);
        const second = await handleDepartmentCallback(update(), h.ports);

        assert.equal(second?.outcome, "department_ignored");
        assert.equal(h.productionCalls, 1, "produccion se ejecuta UNA sola vez");
        assert.ok(h.replies[h.replies.length - 1].includes("ya estaba aprobado"));
      },
    },
    {
      name: "Callback de un mensaje viejo cuya solicitud ya caduco -> approval_stale, sin publicar",
      fn: async () => {
        const old = awaitingChange({
          telegram: { telegramApprovalId: APPROVAL_ID, telegramMessageId: 1, chatId: "555", sentAt: "2026-08-01T00:00:00.000Z", stagingVersionHash: HASH },
        });
        const h = ports(old);
        const result = await handleDepartmentCallback(update(), h.ports);

        assert.equal(result?.outcome, "department_approval_stale");
        assert.equal(h.state.change?.status, "approval_stale");
        assert.equal(h.productionCalls, 0);
      },
    },
    {
      name: "Callback de un cambio que ya no existe -> se ignora sin tocar nada",
      fn: async () => {
        const h = ports(undefined);
        const result = await handleDepartmentCallback(update(), h.ports);
        assert.equal(result?.outcome, "department_ignored");
        assert.equal(h.productionCalls, 0);
      },
    },
    {
      name: "TOCTOU: si staging cambio desde el mensaje, la aprobacion NO publica y queda approval_stale",
      fn: async () => {
        const h = ports(awaitingChange(), { currentHash: "b".repeat(64) });
        const result = await handleDepartmentCallback(update(), h.ports);

        assert.equal(result?.outcome, "department_approval_stale");
        assert.equal(h.state.change?.status, "approval_stale");
        assert.equal(h.productionCalls, 0);
        assert.equal(h.sharedStatus.length, 0, "no se marca como aprobada una version que ya no existe");
        assert.match(h.replies[0], /No publico nada/i);
      },
    },
    {
      name: "Si no se puede releer staging, tampoco se publica (fail-closed)",
      fn: async () => {
        const h = ports(awaitingChange(), { currentHash: null });
        const result = await handleDepartmentCallback(update(), h.ports);
        assert.equal(result?.outcome, "department_approval_stale");
        assert.equal(h.productionCalls, 0);
      },
    },
    {
      name: "Una version NUEVA necesita su propia aprobacion: la aprobacion vieja no le sirve",
      fn: () => {
        const v2 = awaitingChange({
          changeId: "dept#change-1-v2",
          version: 2,
          telegram: { telegramApprovalId: "otra", telegramMessageId: 9, chatId: "555", sentAt: NOW.toISOString(), stagingVersionHash: "c".repeat(64) },
        });
        // El hash de v2 no coincide con el de la version aprobada antes.
        const check = checkApprovedVersionStillCurrent(v2, HASH);
        assert.equal(check.outcome, "stale");
        assert.equal(check.nextStatus, "approval_stale");
      },
    },

    // --- Rechazar ---
    {
      name: "RECHAZAR abre awaiting_rejection_reason y pide el motivo: no basta con status=rejected",
      fn: async () => {
        const h = ports(awaitingChange());
        const result = await handleDepartmentCallback(update({ data: buildCallbackData("reject", APPROVAL_ID) }), h.ports);

        assert.equal(result?.outcome, "department_rejected_awaiting_reason");
        assert.equal(h.state.change?.status, "awaiting_rejection_reason");
        assert.notEqual(h.state.change?.status, "rejected", "el rechazo no se cierra sin motivo");
        assert.equal(h.prompts.filter((p) => !p.closed).length, 1, "queda una pregunta abierta persistente");
        assert.match(h.replies[0], /Indicame el motivo del rechazo/i);
        assert.equal(h.productionCalls, 0);
      },
    },
    {
      name: "El siguiente mensaje se guarda como rejectionReason y cierra el rechazo",
      fn: async () => {
        const h = ports(change({ status: "awaiting_rejection_reason", staging: stagingRecord(), telegram: awaitingChange().telegram }), { activePrompt: true });
        const reason = "No me gusta el H1. Quiero mantener el enfoque en cerraduras electronicas, no en control de acceso.";
        const result = await handleDepartmentRejectionReason(update({ data: reason }), h.ports);

        assert.equal(result?.outcome, "department_rejection_reason_recorded");
        assert.equal(h.state.change?.status, "rejected");
        assert.equal(h.state.change?.humanDecision?.rejectionReason, reason);
        assert.equal(h.state.change?.humanDecision?.decision, "rejected");
        assert.ok(h.state.change?.humanDecision?.decidedBy);
        assert.ok(h.state.change?.humanDecision?.decidedAt);
        // Feedback disponible para futuras ejecuciones de los agentes.
        assert.equal(h.feedback[0]?.feedback, reason);
        assert.equal(h.prompts[0].closed, true);
        assert.equal(h.sharedStatus[0]?.status, "rejected");
        assert.equal(h.productionCalls, 0, "un rechazo NUNCA ejecuta produccion");
      },
    },
    {
      name: "Un motivo vacio no cierra el rechazo: se sigue esperando",
      fn: async () => {
        const h = ports(change({ status: "awaiting_rejection_reason", staging: stagingRecord(), telegram: awaitingChange().telegram }), { activePrompt: true });
        const result = await handleDepartmentRejectionReason(update({ data: "   " }), h.ports);

        assert.equal(result?.outcome, "department_rejected_awaiting_reason");
        assert.equal(h.state.change?.status, "awaiting_rejection_reason");
        assert.equal(h.prompts[0].closed, false);
        assert.equal(validateRejectionReason("").accepted, false);
        assert.equal(validateRejectionReason("no").accepted, false);
        assert.equal(validateRejectionReason("H1 demasiado generico").accepted, true);
      },
    },
    {
      name: "Aprobar un cambio ya rechazado no hace nada",
      fn: async () => {
        const h = ports(change({ status: "rejected", staging: stagingRecord(), telegram: awaitingChange().telegram }));
        const result = await handleDepartmentCallback(update(), h.ports);
        assert.equal(result?.outcome, "department_ignored");
        assert.equal(h.productionCalls, 0);
        assert.equal(checkRejectionAllowed(change({ status: "rejected" })).allowed, false);
      },
    },
    {
      name: "Un callback que no es del departamento devuelve null y no interfiere con el flujo existente",
      fn: async () => {
        const h = ports(awaitingChange());
        assert.equal(await handleDepartmentCallback(update({ data: `appr:approve:${APPROVAL_ID}` }), h.ports), null);
        assert.equal(h.replies.length, 0);
      },
    },

    // --- Precondiciones puras ---
    {
      name: "checkApprovalPreconditions cubre no encontrado / doble aprobacion / estado incorrecto / caducidad",
      fn: () => {
        assert.equal(checkApprovalPreconditions(undefined, NOW).outcome, "not_found");
        assert.equal(checkApprovalPreconditions(change({ status: "approved" }), NOW).outcome, "already_approved");
        assert.equal(checkApprovalPreconditions(change({ status: "production_applied" }), NOW).outcome, "already_approved");
        assert.equal(checkApprovalPreconditions(change({ status: "rejected" }), NOW).outcome, "already_rejected");
        assert.equal(checkApprovalPreconditions(change({ status: "staging_applied" }), NOW).outcome, "wrong_state");
        const expired = checkApprovalPreconditions(awaitingChange({ telegram: { ...awaitingChange().telegram!, sentAt: "2026-01-01T00:00:00.000Z" } }), NOW);
        assert.equal(expired.outcome, "expired");
        assert.equal(expired.nextStatus, "approval_stale");
        assert.equal(checkApprovalPreconditions(awaitingChange(), NOW).proceed, true);
      },
    },

    // --- Envio de la solicitud ---
    {
      name: "Solo se pide aprobacion de un cambio APLICADO Y VALIDADO en staging, y con URL",
      fn: async () => {
        const port = memoryPort();
        const approvals = {
          upsertApprovalRequest: () => ({ approvalRequestId: APPROVAL_ID, isNew: true }),
          markSent: () => undefined,
          send: async () => ({ messageId: 4242, chatId: "555" }),
          now: () => NOW,
        };

        const notValidated = await sendChangeApprovalRequest(
          change({ status: "staging_applied", staging: stagingRecord({ validationStatus: "failed" }) }),
          port,
          approvals
        );
        assert.equal(notValidated.sent, false);

        const noUrl = await sendChangeApprovalRequest(change({ status: "staging_applied", staging: stagingRecord({ url: "" }) }), port, approvals);
        assert.equal(noUrl.sent, false);

        const rolledBack = await sendChangeApprovalRequest(change({ status: "staging_rolled_back", staging: stagingRecord() }), port, approvals);
        assert.equal(rolledBack.sent, false, "un cambio revertido nunca se envia como aprobable");
      },
    },
    {
      name: "Al enviar, el cambio pasa a awaiting_approval y guarda approvalId, message_id y hash de la version",
      fn: async () => {
        const port = memoryPort();
        const result = await sendChangeApprovalRequest(change({ status: "staging_applied", staging: stagingRecord() }), port, {
          upsertApprovalRequest: () => ({ approvalRequestId: APPROVAL_ID, isNew: true }),
          markSent: () => undefined,
          send: async () => ({ messageId: 4242, chatId: "555" }),
          now: () => NOW,
        });

        assert.equal(result.sent, true);
        assert.equal(result.change.status, "awaiting_approval");
        assert.equal(result.change.telegram?.telegramApprovalId, APPROVAL_ID);
        assert.equal(result.change.telegram?.telegramMessageId, 4242);
        assert.equal(result.change.telegram?.stagingVersionHash, HASH);
      },
    },
    {
      name: "Si el envio a Telegram falla, el cambio NO queda esperando una aprobacion que nadie ha recibido",
      fn: async () => {
        const port = memoryPort();
        const result = await sendChangeApprovalRequest(change({ status: "staging_applied", staging: stagingRecord() }), port, {
          upsertApprovalRequest: () => ({ approvalRequestId: APPROVAL_ID, isNew: true }),
          markSent: () => undefined,
          send: async () => {
            throw new Error("Telegram 502");
          },
          now: () => NOW,
        });

        assert.equal(result.sent, false);
        assert.equal(result.change.status, "staging_applied", "se reintentara en la siguiente pasada");
      },
    },
  ];
}
