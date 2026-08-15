import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { DepartmentChangeRequest, EnvironmentApplyRecord } from "../src/department/apply/change-types";
import {
  authorizeTelegramActor,
  checkApprovalPreconditions,
  checkApprovedVersionStillCurrent,
  checkRejectionAllowed,
  validateRejectionReason,
} from "../src/department/apply/telegram-decisions";
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
      name: "El flujo historico NO puede resolver un cambio del departamento (ni por texto libre ni por el callback viejo)",
      fn: () => {
        // El receiver rechaza `relatedType: "department_apply_item"` en su
        // ruta historica: aprobarlo ahi marcaria la solicitud comun como
        // aprobada sin comprobacion anti-TOCTOU ni decision registrada en
        // el registro de cambios -- los dos registros acabarian diciendo
        // cosas distintas.
        const receiver = fs.readFileSync(path.join(__dirname, "..", "src", "agents", "telegram-approval-receiver.ts"), "utf-8");
        assert.ok(
          /request\.relatedType === "department_apply_item"/.test(receiver),
          "el receiver debe rechazar explicitamente los cambios del departamento en su ruta historica"
        );
        assert.ok(/se decide con los botones/.test(receiver), "y debe decir por que, remitiendo a los botones");
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
