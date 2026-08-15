import * as assert from "node:assert/strict";
import { API_ROUTES, ENV_VAR_NAMES } from "../src/approvals/api-contract";
import { ApprovalsApiError, FetchLike, HttpApprovalStore, HttpRequestInit } from "../src/approvals/http-store";
import { change, NOW } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

/**
 * Tests del cliente HTTP del Worker de aprobaciones. Sin red: `fetch` se
 * inyecta. Lo que se comprueba aqui no es "que llame bien a una API", es
 * que NUNCA convierta una respuesta ambigua en un permiso para publicar
 * en produccion, y que un token de servicio no acabe en los logs.
 */

const BASE_URL = "https://zentry-approvals.example.workers.dev";
// Valor inventado para el test. Se usa a proposito uno reconocible para
// poder afirmar que NO aparece en ningun mensaje de error.
const TOKEN = "token-de-servicio-secretisimo-1234";

const APPROVAL = change({ status: "production_queued" });

interface FakeCall {
  url: string;
  init: HttpRequestInit;
}

type ScriptedResponse = { status: number; body?: string } | { networkError: string };

function fakeFetch(script: ScriptedResponse[]): { fetchImpl: FetchLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = script[Math.min(index, script.length - 1)];
    index += 1;
    if ("networkError" in next) throw new Error(next.networkError);
    return { status: next.status, text: async () => next.body ?? "" };
  };
  return { fetchImpl, calls };
}

function storeWith(script: ScriptedResponse[]): { store: HttpApprovalStore; calls: FakeCall[] } {
  const { fetchImpl, calls } = fakeFetch(script);
  return {
    // `sleep` a cero: el backoff se comprueba por el NUMERO de intentos,
    // no haciendo esperar al test.
    store: new HttpApprovalStore({ baseUrl: BASE_URL, token: TOKEN, fetchImpl, retryDelayMs: 0, sleep: async () => {} }),
    calls,
  };
}

function transitionInput() {
  return {
    approvalId: APPROVAL.changeId,
    expectedFrom: ["production_queued" as const],
    to: "production_applying" as const,
    audit: { event: "production_apply_claimed", detail: "Reclamando el apply." },
    at: NOW.toISOString(),
  };
}

async function captureError(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
  throw new Error("Se esperaba un error y no lo hubo.");
}

export function runApprovalsHttpStoreTests(): TestCase[] {
  return [
    // --- La regla central: perder una carrera NO es un error ---
    {
      name: "transition con 409 -> { ok:false, reason:'conflict' } SIN excepcion",
      fn: async () => {
        const { store, calls } = storeWith([
          { status: 409, body: JSON.stringify({ ok: false, reason: "conflict", currentStatus: "production_applied" }) },
        ]);
        const outcome = await store.transition(transitionInput());

        assert.equal(outcome.ok, false);
        assert.equal(outcome.ok === false && outcome.reason, "conflict");
        assert.equal(outcome.ok === false && outcome.currentStatus, "production_applied");
        assert.equal(calls.length, 1, "un 409 es una decision del Worker: no se reintenta");
      },
    },
    {
      name: "transition con 200 -> ok con la aprobacion ya movida",
      fn: async () => {
        const applying = { ...APPROVAL, status: "production_applying" };
        const { store } = storeWith([{ status: 200, body: JSON.stringify({ ok: true, approval: applying }) }]);
        const outcome = await store.transition(transitionInput());

        assert.equal(outcome.ok, true);
        assert.equal(outcome.ok === true && outcome.approval.status, "production_applying");
      },
    },
    {
      name: "transition con 200 pero ok:false se trata como conflicto, no como exito",
      fn: async () => {
        const { store } = storeWith([{ status: 200, body: JSON.stringify({ ok: false, reason: "conflict", currentStatus: "approval_stale" }) }]);
        const outcome = await store.transition(transitionInput());
        assert.equal(outcome.ok === false && outcome.reason, "conflict");
      },
    },
    {
      name: "transition con 404 -> not_found, y un 400 sin motivo conocido LANZA (fail-closed)",
      fn: async () => {
        const notFound = storeWith([{ status: 404, body: "" }]);
        const outcome = await notFound.store.transition(transitionInput());
        assert.equal(outcome.ok === false && outcome.reason, "not_found");

        const bad = storeWith([{ status: 400, body: JSON.stringify({ error: "bad_request", detail: "patch invalido" }) }]);
        const err = await captureError(() => bad.store.transition(transitionInput()));
        assert.match(err.message, /400/);
        assert.equal(bad.calls.length, 1);
      },
    },

    // --- El token no se filtra NUNCA ---
    {
      name: "401 -> error claro que nombra la variable de entorno y NUNCA incluye el token",
      fn: async () => {
        const { store } = storeWith([{ status: 401, body: JSON.stringify({ error: "unauthorized", detail: `bearer ${TOKEN} rechazado` }) }]);
        const err = await captureError(() => store.get(APPROVAL.changeId));

        assert.ok(err instanceof ApprovalsApiError);
        assert.match(err.message, /401/);
        assert.match(err.message, new RegExp(ENV_VAR_NAMES.approvalsApiToken));
        assert.equal(err.message.includes(TOKEN), false, "el token no puede aparecer en un mensaje que acaba en los logs de Actions");
        assert.match(err.message, /TOKEN REDACTADO/, "si el servidor lo devuelve, se redacta");
      },
    },
    {
      name: "El token viaja en la cabecera Authorization, nunca en la URL",
      fn: async () => {
        const { store, calls } = storeWith([{ status: 200, body: JSON.stringify(APPROVAL) }]);
        await store.get(APPROVAL.changeId);

        assert.equal(calls[0].url, `${BASE_URL}${API_ROUTES.approval(APPROVAL.changeId)}`);
        assert.equal(calls[0].url.includes(TOKEN), false);
        assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
      },
    },

    // --- Reintentos: solo lo que el servidor no llego a decidir ---
    {
      name: "5xx se reintenta hasta 3 intentos y, si el ultimo va bien, la operacion vale",
      fn: async () => {
        const { store, calls } = storeWith([
          { status: 500, body: "boom" },
          { status: 503, body: "boom" },
          { status: 200, body: JSON.stringify({ approval: APPROVAL }) },
        ]);
        const approval = await store.get(APPROVAL.changeId);

        assert.equal(calls.length, 3);
        assert.equal(approval?.changeId, APPROVAL.changeId);
      },
    },
    {
      name: "5xx persistente -> 3 intentos y despues LANZA (nunca se asume nada del estado)",
      fn: async () => {
        const { store, calls } = storeWith([{ status: 500, body: "boom" }]);
        const err = await captureError(() => store.get(APPROVAL.changeId));

        assert.equal(calls.length, 3);
        assert.match(err.message, /500|fallando/i);
      },
    },
    {
      name: "Un error de RED se reintenta (el Worker no llego a decidir nada)",
      fn: async () => {
        const { store, calls } = storeWith([
          { networkError: "ECONNRESET" },
          { status: 200, body: JSON.stringify({ approval: APPROVAL }) },
        ]);
        const approval = await store.get(APPROVAL.changeId);
        assert.equal(calls.length, 2);
        assert.equal(approval?.changeId, APPROVAL.changeId);
      },
    },
    {
      name: "Un error de RED persistente LANZA tras 3 intentos y no filtra el token",
      fn: async () => {
        const { store, calls } = storeWith([{ networkError: `fallo llamando con ${TOKEN}` }]);
        const err = await captureError(() => store.transition(transitionInput()));

        assert.equal(calls.length, 3);
        assert.equal(err.message.includes(TOKEN), false);
        assert.match(err.message, /Fail-closed/);
      },
    },
    {
      name: "Un 4xx NUNCA se reintenta: es una decision del Worker, no un fallo transitorio",
      fn: async () => {
        for (const status of [400, 401, 403, 404, 409, 422]) {
          const { store, calls } = storeWith([{ status, body: JSON.stringify({ error: "no" }) }]);
          const err = await captureError(() => store.create(APPROVAL));
          assert.match(err.message, new RegExp(String(status)));
          assert.equal(calls.length, 1, `status ${status} no debe reintentarse`);
        }
      },
    },

    // --- Lecturas y creacion ---
    {
      name: "get con 404 -> null (no existir es un dato, no un fallo)",
      fn: async () => {
        const { store } = storeWith([{ status: 404, body: "" }]);
        assert.equal(await store.get("no-existe"), null);
      },
    },
    {
      name: "create: 201 = creada ahora, 200 = ya existia (idempotencia por changeId)",
      fn: async () => {
        const created = storeWith([{ status: 201, body: JSON.stringify({ approval: APPROVAL }) }]);
        assert.equal((await created.store.create(APPROVAL)).created, true);

        const existing = storeWith([{ status: 200, body: JSON.stringify(APPROVAL) }]);
        const result = await existing.store.create(APPROVAL);
        assert.equal(result.created, false);
        assert.equal(result.approval.changeId, APPROVAL.changeId);
      },
    },
    {
      name: "Un 200 con un cuerpo que no es una aprobacion valida LANZA",
      fn: async () => {
        const noJson = storeWith([{ status: 200, body: "<html>gateway</html>" }]);
        assert.match((await captureError(() => noJson.store.get(APPROVAL.changeId))).message, /aprobacion valida|JSON/);

        const wrongStatus = storeWith([{ status: 200, body: JSON.stringify({ ...APPROVAL, status: "inventado" }) }]);
        assert.match((await captureError(() => wrongStatus.store.get(APPROVAL.changeId))).message, /aprobacion valida/);
      },
    },
    {
      name: "listByRun y listHumanFeedback aceptan lista suelta o envuelta, y 404 = lista vacia",
      fn: async () => {
        const wrapped = storeWith([{ status: 200, body: JSON.stringify({ approvals: [APPROVAL] }) }]);
        assert.equal((await wrapped.store.listByRun(APPROVAL.departmentRunId)).length, 1);

        const bare = storeWith([{ status: 200, body: JSON.stringify([APPROVAL]) }]);
        assert.equal((await bare.store.listByRun(APPROVAL.departmentRunId)).length, 1);

        const empty = storeWith([{ status: 404, body: "" }]);
        assert.deepEqual(await empty.store.listHumanFeedback(APPROVAL.recommendationId), []);
      },
    },

    // --- Lo que este cliente NO puede hacer ---
    {
      name: "Las operaciones del carril de Telegram LANZAN: no existen en el contrato HTTP",
      fn: async () => {
        const { store, calls } = storeWith([{ status: 200, body: "{}" }]);
        for (const call of [
          () => store.markUpdateProcessed(1, NOW.toISOString()),
          () => store.annotate(APPROVAL.changeId, {}, { event: "x", detail: "y" }, NOW.toISOString()),
          () => store.closeRejectionPrompt(APPROVAL.changeId),
          () => store.findOpenRejectionPrompt("1", "2"),
          () => store.listByRecommendation(APPROVAL.recommendationId),
        ]) {
          const err = await captureError(call as () => Promise<unknown>);
          assert.match(err.message, /Fail-closed/);
        }
        assert.equal(calls.length, 0, "ni siquiera se intenta una peticion inventada");
      },
    },
    {
      name: "Sin URL https o sin token, el store no llega a construirse",
      fn: () => {
        assert.throws(() => new HttpApprovalStore({ baseUrl: "http://inseguro.example", token: TOKEN }), /https/);
        assert.throws(() => new HttpApprovalStore({ baseUrl: BASE_URL, token: "  " }), new RegExp(ENV_VAR_NAMES.approvalsApiToken));
        assert.throws(() => new HttpApprovalStore({ baseUrl: "", token: TOKEN }), new RegExp(ENV_VAR_NAMES.approvalsApiUrl));
      },
    },
  ];
}
