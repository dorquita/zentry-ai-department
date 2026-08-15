import * as assert from "node:assert/strict";
import { ProductionDispatchInputs } from "../src/approvals/api-contract";
import { Approval } from "../src/approvals/store";
import { D1ApprovalStore } from "../src/worker/d1-store";
import { Env } from "../src/worker/env";
import { GithubDispatchPort, GithubDispatchResult } from "../src/worker/github-dispatch";
import { WorkerRuntime, constantTimeEquals, handleWorkerRequest, parseBearerToken, resolveRoute } from "../src/worker/index";
import { AnswerCallbackInput, SendMessageInput, TelegramPort } from "../src/worker/telegram-client";
import { TelegramUpdate, WorkerLogEvent, handleTelegramUpdate } from "../src/worker/webhook";
import { change } from "./department-apply-fixtures";
import { createFakeD1 } from "./worker-d1-store.test";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

/**
 * TESTS DEL WEBHOOK Y DEL ROUTING DEL WORKER.
 *
 * Lo que se verifica aqui no son detalles de implementacion, son las
 * reglas de las que depende que no se publique nada que nadie aprobo:
 *
 *   - Un secreto que no cuadra no llega ni a tocar la base de datos.
 *   - Un actor no autorizado no recibe NINGUNA respuesta (ni siquiera un
 *     "no puedes"): el bot no se delata.
 *   - Aprobar dos veces, o que Telegram reenvie el mismo update, produce
 *     como mucho UN dispatch de produccion.
 *   - Si el dispatch falla, el cambio NO se queda diciendo que esta
 *     encolado: queda `blocked` y se avisa de que no se ha publicado nada.
 *   - Con dos rechazos abiertos a la vez, el motivo va al que la persona
 *     respondio, jamas al otro.
 */

const NOW = "2026-08-15T12:00:00.000Z";
const WEBHOOK_SECRET = "secreto-del-webhook-de-telegram";
const SERVICE_TOKEN = "bearer-de-servicio-de-actions";
const CHAT_ID = "-1001234567890";
const USER_ID = "42";

// --- Harness ----------------------------------------------------------------

interface Harness {
  db: ReturnType<typeof createFakeD1>;
  runtime: WorkerRuntime;
  env: Env;
  sent: (SendMessageInput & { messageId: number })[];
  answered: AnswerCallbackInput[];
  dispatches: ProductionDispatchInputs[];
  logs: WorkerLogEvent[];
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
  webhook(update: TelegramUpdate, secret?: string): Promise<Response>;
  statusOf(approvalId: string): string | undefined;
  recordOf(approvalId: string): Approval;
}

function harness(options: { approvals?: Approval[]; dispatchFails?: boolean; now?: string; env?: Partial<Env> } = {}): Harness {
  const db = createFakeD1();
  for (const approval of options.approvals ?? []) db.seed(approval);

  const now = (): Date => new Date(options.now ?? NOW);
  const store = new D1ApprovalStore(db, { now });

  const sent: (SendMessageInput & { messageId: number })[] = [];
  const answered: AnswerCallbackInput[] = [];
  const dispatches: ProductionDispatchInputs[] = [];
  const logs: WorkerLogEvent[] = [];
  let nextMessageId = 1000;

  const telegram: TelegramPort = {
    async sendMessage(input) {
      nextMessageId += 1;
      sent.push({ ...input, messageId: nextMessageId });
      return { ok: true, messageId: nextMessageId, detail: "enviado" };
    },
    async editMessageText() {
      return { ok: true, detail: "editado" };
    },
    async answerCallbackQuery(input) {
      answered.push(input);
      return { ok: true, detail: "acusado" };
    },
  };

  const githubDispatch: GithubDispatchPort = {
    async dispatch(inputs): Promise<GithubDispatchResult> {
      dispatches.push(inputs);
      if (options.dispatchFails) return { ok: false, githubRunId: null, detail: "GitHub respondio 403 al disparar el workflow de produccion." };
      return { ok: true, githubRunId: null, detail: "Workflow disparado." };
    },
  };

  const runtime: WorkerRuntime = { store, telegram, githubDispatch, now, log: (entry) => logs.push(entry) };

  const env: Env = {
    DB: db,
    SERVICE_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_BOT_TOKEN: "no-se-usa-en-test",
    TELEGRAM_ALLOWED_CHAT_ID: CHAT_ID,
    TELEGRAM_ALLOWED_USER_ID: USER_ID,
    ...options.env,
  };

  return {
    db,
    runtime,
    env,
    sent,
    answered,
    dispatches,
    logs,
    post(path, body, headers = {}) {
      const request = new Request(`https://worker.example${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      return handleWorkerRequest(request, env, runtime);
    },
    webhook(update, secret = WEBHOOK_SECRET) {
      return this.post("/telegram/webhook", update, { "x-telegram-bot-api-secret-token": secret });
    },
    statusOf(approvalId) {
      return db.approvals.get(approvalId)?.status;
    },
    recordOf(approvalId) {
      return JSON.parse(db.approvals.get(approvalId)?.record ?? "{}") as Approval;
    },
  };
}

// --- Fixtures ---------------------------------------------------------------

/** Aprobacion viva: esperando decision y enviada hace una hora (dentro de la ventana de 72 h). */
function pending(overrides: Partial<Approval> = {}): Approval {
  return change({
    status: "awaiting_approval",
    staging: {
      environment: "staging",
      applyId: "staging::c1",
      wordpressPageId: 2091,
      url: "https://staging.zentrylockers.com/taquillas-melamina/",
      pageSlug: "taquillas-melamina",
      startedAt: "2026-08-15T10:00:00.000Z",
      finishedAt: "2026-08-15T10:01:00.000Z",
      snapshot: null,
      changedFields: [{ field: "title", before: "Titulo antiguo", after: "Titulo nuevo", changed: true }],
      validationStatus: "passed",
      validationDetail: "Releida la pagina y coincide.",
      rollbackStatus: "not_needed",
      rollbackDetail: "",
      resultingVersionHash: "hash-a",
      githubRunId: null,
    },
    telegram: { telegramApprovalId: "t-1", telegramMessageId: 500, chatId: CHAT_ID, sentAt: "2026-08-15T11:00:00.000Z", stagingVersionHash: "hash-a" },
    ...overrides,
  });
}

function callbackUpdate(updateId: number, data: string, over: { chatId?: string; userId?: string } = {}): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      data,
      from: { id: over.userId ?? USER_ID, username: "pau" },
      message: { message_id: 500, chat: { id: over.chatId ?? CHAT_ID } },
    },
  };
}

function textUpdate(updateId: number, text: string, replyToMessageId?: number, over: { chatId?: string; userId?: string } = {}): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 900 + updateId,
      chat: { id: over.chatId ?? CHAT_ID },
      from: { id: over.userId ?? USER_ID, username: "pau" },
      text,
      ...(typeof replyToMessageId === "number" ? { reply_to_message: { message_id: replyToMessageId } } : {}),
    },
  };
}

function approveData(approval: Approval): string {
  return `dept:approve:${approval.changeId}`;
}

// --- Suite ------------------------------------------------------------------

export function runWorkerWebhookTests(): TestCase[] {
  return [
    // --- Autenticacion y routing -----------------------------------------
    {
      name: "/health responde {ok:true} sin auth y sin filtrar NADA de la configuracion",
      fn: async () => {
        const h = harness();
        const response = await handleWorkerRequest(new Request("https://worker.example/health"), h.env, h.runtime);
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.deepEqual(body, { ok: true });
        // Un health check que dice que secretos hay es un oraculo.
        const raw = JSON.stringify(body);
        assert.ok(!raw.includes(WEBHOOK_SECRET) && !raw.includes(SERVICE_TOKEN) && !raw.includes(CHAT_ID));
      },
    },
    {
      name: "webhook con el secreto correcto -> 200",
      fn: async () => {
        const h = harness();
        const response = await h.webhook(callbackUpdate(1, "dept:view:no-existe"));
        assert.equal(response.status, 200);
      },
    },
    {
      name: "webhook con el secreto INCORRECTO -> 401 sin cuerpo y sin tocar la base de datos",
      fn: async () => {
        const h = harness({ approvals: [pending()] });
        const response = await h.webhook(callbackUpdate(1, approveData(pending())), "secreto-equivocado");
        assert.equal(response.status, 401);
        assert.equal(await response.text(), "", "un 401 no puede explicar por que ha fallado");
        assert.deepEqual(h.db.executed, [], "un secreto malo no llega ni a marcar el update como procesado");
        assert.equal(h.dispatches.length, 0);
        assert.equal(h.sent.length, 0);
      },
    },
    {
      name: "webhook SIN la cabecera del secreto -> 401",
      fn: async () => {
        const h = harness();
        const request = new Request("https://worker.example/telegram/webhook", { method: "POST", body: JSON.stringify(callbackUpdate(1, "dept:view:x")) });
        const response = await handleWorkerRequest(request, h.env, h.runtime);
        assert.equal(response.status, 401);
      },
    },
    {
      name: "si TELEGRAM_WEBHOOK_SECRET no esta configurado, NADIE pasa (fail-closed)",
      fn: async () => {
        const h = harness({ env: { TELEGRAM_WEBHOOK_SECRET: "" } });
        // Ni con la cabecera vacia, que es lo que "coincidiria" con un `===`.
        assert.equal((await h.webhook(callbackUpdate(1, "dept:view:x"), "")).status, 401);
        assert.equal((await h.webhook(callbackUpdate(2, "dept:view:x"), "lo-que-sea")).status, 401);
      },
    },
    {
      name: "la API de servicio exige el bearer: sin el o con uno equivocado, 401",
      fn: async () => {
        const h = harness({ approvals: [pending()] });
        const url = `https://worker.example/api/approvals/${encodeURIComponent(pending().changeId)}`;

        const sinAuth = await handleWorkerRequest(new Request(url), h.env, h.runtime);
        assert.equal(sinAuth.status, 401);

        const malAuth = await handleWorkerRequest(new Request(url, { headers: { authorization: "Bearer token-equivocado" } }), h.env, h.runtime);
        assert.equal(malAuth.status, 401);

        const bien = await handleWorkerRequest(new Request(url, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } }), h.env, h.runtime);
        assert.equal(bien.status, 200);
        const body = (await bien.json()) as { approval: Approval };
        assert.equal(body.approval.changeId, pending().changeId);
      },
    },
    {
      name: "el secreto del webhook NO sirve para la API de servicio (son secretos distintos a proposito)",
      fn: async () => {
        const h = harness({ approvals: [pending()] });
        const url = `https://worker.example/api/approvals/${encodeURIComponent(pending().changeId)}`;
        const response = await handleWorkerRequest(new Request(url, { headers: { authorization: `Bearer ${WEBHOOK_SECRET}` } }), h.env, h.runtime);
        assert.equal(response.status, 401);
      },
    },
    {
      name: "constantTimeEquals distingue contenido y longitud, y un secreto vacio nunca valida",
      fn: () => {
        assert.equal(constantTimeEquals("abc", "abc"), true);
        assert.equal(constantTimeEquals("abc", "abd"), false);
        assert.equal(constantTimeEquals("abc", "abcd"), false);
        assert.equal(constantTimeEquals("abcd", "abc"), false);
        assert.equal(constantTimeEquals("", ""), false, "un secreto sin configurar no autentica a nadie");
        assert.equal(constantTimeEquals("algo", ""), false);
      },
    },
    {
      name: "parseBearerToken y resolveRoute: solo las rutas declaradas existen",
      fn: () => {
        assert.equal(parseBearerToken("Bearer  abc123 "), "abc123");
        assert.equal(parseBearerToken("bearer abc123"), "abc123");
        assert.equal(parseBearerToken("abc123"), "");
        assert.equal(parseBearerToken(null), "");

        assert.equal(resolveRoute("GET", "/health").kind, "health");
        assert.equal(resolveRoute("POST", "/telegram/webhook").kind, "telegramWebhook");
        assert.equal(resolveRoute("POST", "/api/approvals").kind, "createApproval");
        assert.deepEqual(resolveRoute("GET", "/api/approvals/run%23c1"), { kind: "getApproval", id: "run#c1" });
        assert.equal(resolveRoute("POST", "/api/approvals/c1/transition").kind, "transition");
        assert.equal(resolveRoute("GET", "/api/runs/r1/approvals").kind, "runApprovals");
        assert.equal(resolveRoute("GET", "/api/feedback/rec1").kind, "feedback");
        // Metodo equivocado y ruta inventada: no hay comodines.
        assert.equal(resolveRoute("GET", "/telegram/webhook").kind, "unknown");
        assert.equal(resolveRoute("GET", "/api/approvals/c1/publicar").kind, "unknown");
      },
    },

    // --- Autorizacion del actor ------------------------------------------
    {
      name: "chat NO autorizado: no se hace nada y NO se responde (el bot no confirma que existe)",
      fn: async () => {
        const h = harness({ approvals: [pending()] });
        const response = await h.webhook(callbackUpdate(1, approveData(pending()), { chatId: "-999" }));

        assert.equal(response.status, 200, "se responde 200 para que Telegram no reintente");
        assert.equal(h.sent.length, 0, "ni un mensaje al chat intruso");
        assert.equal(h.answered.length, 0, "ni siquiera se acusa el callback");
        assert.equal(h.dispatches.length, 0);
        assert.equal(h.statusOf(pending().changeId), "awaiting_approval");
        assert.ok(h.logs.some((l) => l.event === "webhook_unauthorized"));
      },
    },
    {
      name: "usuario NO autorizado dentro del chat autorizado: tampoco decide ni recibe respuesta",
      fn: async () => {
        const h = harness({ approvals: [pending()] });
        await h.webhook(callbackUpdate(1, approveData(pending()), { userId: "99999" }));

        assert.equal(h.sent.length, 0);
        assert.equal(h.dispatches.length, 0);
        assert.equal(h.statusOf(pending().changeId), "awaiting_approval");
      },
    },

    // --- Callbacks --------------------------------------------------------
    {
      name: "callback_data desconocido: se acusa recibo y no se toca nada",
      fn: async () => {
        const h = harness({ approvals: [pending()] });
        await h.webhook({ update_id: 1, callback_query: { id: "cb-1", data: "appr:approve:otro-flujo", from: { id: USER_ID }, message: { message_id: 500, chat: { id: CHAT_ID } } } });

        assert.equal(h.answered.length, 1, "el boton no puede quedarse girando");
        assert.equal(h.sent.length, 0);
        assert.equal(h.dispatches.length, 0);
        assert.equal(h.statusOf(pending().changeId), "awaiting_approval");
      },
    },
    {
      name: "VER CAMBIOS responde con el detalle REAL del apply y no mueve el estado",
      fn: async () => {
        const h = harness({ approvals: [pending()] });
        await h.webhook(callbackUpdate(1, `dept:view:${pending().changeId}`));

        assert.equal(h.sent.length, 1);
        assert.ok(h.sent[0].text.includes("CAMBIOS APLICADOS EN STAGING"));
        assert.ok(h.sent[0].text.includes("https://staging.zentrylockers.com/taquillas-melamina/"));
        assert.ok(h.sent[0].text.includes("Produccion NO se ha tocado."));
        assert.equal(h.statusOf(pending().changeId), "awaiting_approval");
        assert.equal(h.dispatches.length, 0);
      },
    },

    // --- Aprobar ----------------------------------------------------------
    {
      name: "APROBAR: encola y dispara UN workflow cuyo unico input es el approvalId",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, approveData(approval)));

        assert.equal(h.statusOf(approval.changeId), "production_queued");
        assert.equal(h.dispatches.length, 1);
        // El Worker no conoce WordPress: no viaja NADA que se pueda publicar.
        assert.deepEqual(h.dispatches[0], { approvalId: approval.changeId });

        const record = h.recordOf(approval.changeId);
        assert.equal(record.humanDecision?.decision, "approved");
        assert.equal(record.humanDecision?.channel, "telegram");
        assert.ok(record.humanDecision?.decidedBy.includes("42"), "la identidad se toma tal cual la reporta Telegram");
        assert.ok(h.sent.some((m) => m.text.includes("ENCOLADO")));
        assert.ok(h.logs.some((l) => l.event === "production_dispatch_sent" && l.approvalId === approval.changeId));
      },
    },
    {
      name: "APROBAR dos veces (dos updates distintos): un solo dispatch, la segunda no publica nada",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });

        await h.webhook(callbackUpdate(1, approveData(approval)));
        await h.webhook(callbackUpdate(2, approveData(approval)));

        assert.equal(h.dispatches.length, 1, "una segunda pulsacion no puede producir una segunda publicacion");
        assert.equal(h.statusOf(approval.changeId), "production_queued");
      },
    },
    {
      name: "REPLAY de Telegram (mismo update_id): no se hace absolutamente nada",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });

        await h.webhook(callbackUpdate(7, approveData(approval)));
        const enviadosTrasPrimera = h.sent.length;
        await h.webhook(callbackUpdate(7, approveData(approval)));

        assert.equal(h.dispatches.length, 1);
        assert.equal(h.sent.length, enviadosTrasPrimera, "un reenvio no vuelve a escribir en el chat");
        assert.ok(h.logs.some((l) => l.event === "webhook_replay_ignored" && l.telegramUpdateId === 7));
      },
    },
    {
      name: "dos callbacks de APROBAR concurrentes: uno gana, el otro ve conflicto y no dispara",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });

        const deps = {
          store: h.runtime.store,
          telegram: h.runtime.telegram,
          githubDispatch: h.runtime.githubDispatch,
          now: h.runtime.now,
          config: { allowedChatId: CHAT_ID, allowedUserId: USER_ID },
          log: h.runtime.log,
        };
        const [a, b] = await Promise.all([
          handleTelegramUpdate(callbackUpdate(1, approveData(approval)), deps),
          handleTelegramUpdate(callbackUpdate(2, approveData(approval)), deps),
        ]);

        const dispatched = [a, b].filter((r) => r.dispatched).length;
        assert.equal(dispatched, 1, "dos pulsaciones simultaneas serian dos publicaciones");
        assert.equal(h.dispatches.length, 1);
        assert.equal(h.statusOf(approval.changeId), "production_queued");
      },
    },
    {
      name: "APROBAR algo ya RECHAZADO: no se aprueba, no se dispara y se dice por que",
      fn: async () => {
        const approval = pending({ status: "rejected" });
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, approveData(approval)));

        assert.equal(h.dispatches.length, 0);
        assert.equal(h.statusOf(approval.changeId), "rejected");
        assert.ok(h.sent.some((m) => m.text.includes("ya estaba rechazado")));
      },
    },
    {
      name: "APROBAR una solicitud CADUCADA: pasa a approval_stale y no se publica nada",
      fn: async () => {
        // Enviada hace mas de 72 h: la aprobacion ya no se refiere a lo que se vio.
        const approval = pending({
          telegram: { telegramApprovalId: "t-1", telegramMessageId: 500, chatId: CHAT_ID, sentAt: "2026-08-01T12:00:00.000Z", stagingVersionHash: "hash-a" },
        });
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, approveData(approval)));

        assert.equal(h.statusOf(approval.changeId), "approval_stale");
        assert.equal(h.dispatches.length, 0);
        assert.ok(h.sent.some((m) => m.text.includes("caduco")));
      },
    },
    {
      name: "APROBAR sin fecha de envio fiable: fail-closed, approval_stale y sin dispatch",
      fn: async () => {
        const approval = pending({ telegram: { telegramApprovalId: "t-1", telegramMessageId: 500, chatId: CHAT_ID, sentAt: null, stagingVersionHash: "hash-a" } });
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, approveData(approval)));

        assert.equal(h.statusOf(approval.changeId), "approval_stale");
        assert.equal(h.dispatches.length, 0);
      },
    },
    {
      name: "si el DISPATCH FALLA, el cambio queda blocked y se dice que NO se ha publicado nada",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval], dispatchFails: true });
        await h.webhook(callbackUpdate(1, approveData(approval)));

        // Nunca `production_queued` sin dispatch: ese estado significa
        // "hay un workflow en camino" y seria mentira.
        assert.equal(h.statusOf(approval.changeId), "blocked");
        assert.equal(h.dispatches.length, 1);
        const aviso = h.sent.at(-1)?.text ?? "";
        assert.ok(aviso.includes("NO se ha publicado nada"));
        assert.ok(aviso.includes("Produccion sigue exactamente como estaba."));
        assert.ok(h.logs.some((l) => l.event === "production_dispatch_failed" && l.statusAfter === "blocked"));

        // La decision humana SI queda registrada: se aprobo de verdad.
        assert.equal(h.recordOf(approval.changeId).humanDecision?.decision, "approved");
      },
    },
    {
      name: "APROBAR un id inexistente: no encuentra nada, no dispara y lo dice",
      fn: async () => {
        const h = harness();
        await h.webhook(callbackUpdate(1, "dept:approve:no-existe"));
        assert.equal(h.dispatches.length, 0);
        assert.ok(h.sent.some((m) => m.text.includes("No encuentro")));
      },
    },

    // --- Rechazar ---------------------------------------------------------
    {
      name: "RECHAZAR abre awaiting_rejection_reason y pide el motivo (el rechazo aun NO esta cerrado)",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, `dept:reject:${approval.changeId}`));

        assert.equal(h.statusOf(approval.changeId), "awaiting_rejection_reason");
        assert.ok(h.sent.at(-1)?.text.includes("Indicame el motivo del rechazo"));
        // El message_id de LA pregunta es lo que hara correlacionable la respuesta.
        const prompt = h.db.prompts.get(approval.changeId);
        assert.equal(prompt?.prompt_message_id, h.sent.at(-1)?.messageId);
        assert.equal(prompt?.closed_at, null);
        assert.equal(h.dispatches.length, 0);
      },
    },
    {
      name: "RECHAZAR dos veces: la segunda no reabre nada, recuerda que sigue esperando el motivo",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, `dept:reject:${approval.changeId}`));
        await h.webhook(callbackUpdate(2, `dept:reject:${approval.changeId}`));

        assert.equal(h.statusOf(approval.changeId), "awaiting_rejection_reason");
        assert.ok(h.sent.at(-1)?.text.includes("Ya te habia pedido el motivo"));
      },
    },
    {
      name: "con DOS rechazos abiertos, el motivo va al que se RESPONDIO, nunca al otro",
      fn: async () => {
        const a = pending({ changeId: "cambio-A", recommendationId: "rec-A" });
        const b = pending({ changeId: "cambio-B", recommendationId: "rec-B" });
        const h = harness({ approvals: [a, b] });

        await h.webhook(callbackUpdate(1, "dept:reject:cambio-A"));
        const promptA = h.sent.at(-1)?.messageId ?? 0;
        await h.webhook(callbackUpdate(2, "dept:reject:cambio-B"));
        const promptB = h.sent.at(-1)?.messageId ?? 0;
        assert.notEqual(promptA, promptB);

        // Se responde EN HILO a la pregunta de B.
        await h.webhook(textUpdate(3, "El H1 se aleja de cerraduras electronicas.", promptB));

        assert.equal(h.statusOf("cambio-B"), "rejected");
        assert.equal(h.recordOf("cambio-B").humanDecision?.rejectionReason, "El H1 se aleja de cerraduras electronicas.");
        // A no se ha tocado: sigue esperando SU motivo.
        assert.equal(h.statusOf("cambio-A"), "awaiting_rejection_reason");
        assert.equal(h.recordOf("cambio-A").humanDecision, null);
        assert.equal(h.db.prompts.get("cambio-A")?.closed_at, null);
        assert.notEqual(h.db.prompts.get("cambio-B")?.closed_at, null);
      },
    },
    {
      name: "motivo sin responder en hilo, con un unico rechazo abierto: se guarda tal cual se escribio",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, `dept:reject:${approval.changeId}`));
        await h.webhook(textUpdate(2, "  No me gusta el enfoque en control de acceso.  "));

        assert.equal(h.statusOf(approval.changeId), "rejected");
        const decision = h.recordOf(approval.changeId).humanDecision;
        // Ni se resume, ni se reinterpreta, ni se clasifica: solo se recorta el espacio.
        assert.equal(decision?.rejectionReason, "No me gusta el enfoque en control de acceso.");
        assert.equal(decision?.decision, "rejected");
        assert.equal(decision?.decidedAt, NOW);
        assert.ok(h.sent.at(-1)?.text.includes("Anotado. Rechazo cerrado."));
        assert.equal(h.dispatches.length, 0);
        // El motivo es contenido humano: vive en D1, no en los logs.
        assert.ok(!JSON.stringify(h.logs).includes("control de acceso"));
      },
    },
    {
      name: "responder a un mensaje que NO es una pregunta de rechazo no se atribuye por descarte",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, `dept:reject:${approval.changeId}`));

        // Se responde a OTRO mensaje cualquiera. Adivinar aqui seria
        // guardar el motivo en la aprobacion equivocada.
        await h.webhook(textUpdate(2, "Esto es otra conversacion.", 4242));

        assert.equal(h.statusOf(approval.changeId), "awaiting_rejection_reason");
        assert.equal(h.recordOf(approval.changeId).humanDecision, null);
        assert.ok(h.logs.some((l) => l.event === "rejection_reason_reply_unmatched"));
      },
    },
    {
      name: "motivo demasiado corto: el rechazo sigue ABIERTO y no se guarda nada",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, `dept:reject:${approval.changeId}`));
        await h.webhook(textUpdate(2, "no"));

        assert.equal(h.statusOf(approval.changeId), "awaiting_rejection_reason");
        assert.equal(h.recordOf(approval.changeId).humanDecision, null);
        assert.equal(h.db.prompts.get(approval.changeId)?.closed_at, null);
        assert.ok(h.sent.at(-1)?.text.includes("demasiado corto"));
      },
    },
    {
      name: "un mensaje de texto sin ningun rechazo abierto no es una decision: se ignora",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(textUpdate(1, "hola, como va la propuesta?"));

        assert.equal(h.statusOf(approval.changeId), "awaiting_approval");
        assert.equal(h.sent.length, 0);
        assert.equal(h.dispatches.length, 0);
      },
    },
    {
      name: "APROBAR despues de haber pulsado RECHAZAR: no se aprueba y no se publica nada",
      fn: async () => {
        const approval = pending();
        const h = harness({ approvals: [approval] });
        await h.webhook(callbackUpdate(1, `dept:reject:${approval.changeId}`));
        await h.webhook(callbackUpdate(2, approveData(approval)));

        assert.equal(h.statusOf(approval.changeId), "awaiting_rejection_reason");
        assert.equal(h.dispatches.length, 0);
      },
    },

    // --- API de servicio --------------------------------------------------
    {
      name: "POST /api/approvals crea y envia la solicitud con botones; el reintento no reenvia ningun mensaje",
      fn: async () => {
        const approval = pending({ telegram: null });
        const h = harness();

        const first = await h.post("/api/approvals", approval, { authorization: `Bearer ${SERVICE_TOKEN}` });
        assert.equal(first.status, 201);
        assert.equal(h.sent.length, 1);
        assert.ok(h.sent[0].text.includes("PROPUESTA LISTA PARA REVISION"));
        const buttons = (h.sent[0].buttons ?? []).flat();
        assert.ok(buttons.some((b) => b.callbackData === `dept:approve:${approval.changeId}`));
        assert.ok(buttons.some((b) => b.callbackData === `dept:reject:${approval.changeId}`));
        assert.ok(buttons.some((b) => b.url === approval.staging?.url));
        // `sentAt` real: es lo que acota la ventana de validez de 72 h.
        assert.equal(h.recordOf(approval.changeId).telegram?.sentAt, NOW);

        const retry = await h.post("/api/approvals", approval, { authorization: `Bearer ${SERVICE_TOKEN}` });
        assert.equal(retry.status, 200);
        assert.equal(h.sent.length, 1, "un reintento del workflow no puede dejar dos mensajes con botones vivos");
      },
    },
    {
      name: "POST /api/approvals/:id/transition: 409 cuando el estado ya no es el esperado, 400 si la transicion es ilegal",
      fn: async () => {
        const approval = pending({ status: "approved" });
        const h = harness({ approvals: [approval] });
        const path = `/api/approvals/${encodeURIComponent(approval.changeId)}/transition`;
        const auth = { authorization: `Bearer ${SERVICE_TOKEN}` };

        const conflicto = await h.post(path, { expectedFrom: ["production_queued"], to: "production_applying", audit: { event: "e", detail: "d" } }, auth);
        assert.equal(conflicto.status, 409);

        const ilegal = await h.post(path, { expectedFrom: ["staging_applied"], to: "production_queued", audit: { event: "e", detail: "d" } }, auth);
        assert.equal(ilegal.status, 400);

        const sinAudit = await h.post(path, { expectedFrom: ["approved"], to: "production_queued" }, auth);
        assert.equal(sinAudit.status, 400, "ningun cambio de estado se escribe sin dejar rastro de por que");

        const ok = await h.post(path, { expectedFrom: ["approved"], to: "production_queued", audit: { event: "e", detail: "d" } }, auth);
        assert.equal(ok.status, 200);
        assert.equal(h.statusOf(approval.changeId), "production_queued");
      },
    },
  ];
}
