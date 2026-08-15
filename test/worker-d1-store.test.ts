import * as assert from "node:assert/strict";
import { Approval } from "../src/approvals/store";
import { D1Database, D1PreparedStatement, D1Result } from "../src/worker/env";
import { D1ApprovalStore, buildMergePatch, changedRows, normalizeApproval } from "../src/worker/d1-store";
import { change } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

/**
 * TESTS DEL STORE D1.
 *
 * No hace falta una D1 real: lo que hay que verificar es la SEMANTICA
 * CONDICIONAL -- que una transicion perdida no escriba nada, que un
 * `update_id` repetido choque contra la clave primaria, que un motivo de
 * rechazo se correlacione con SU aprobacion. Todo eso se reproduce fiel
 * con un doble en memoria que cuente filas cambiadas igual que SQLite.
 *
 * El doble interpreta las sentencias por su etiqueta `-- stmt:<nombre>`
 * (ver d1-store.ts) y emula a mano lo que hacen `json_patch` (merge patch
 * de RFC 7386) y `json_set`, INCLUIDO el detalle que importa: `json_set`
 * no crea contenedores intermedios, asi que escribir
 * `$.production.githubRunId` sobre un `production` nulo no hace nada.
 */

// --- Doble en memoria de D1 -------------------------------------------------

interface ApprovalRow {
  approval_id: string;
  recommendation_id: string;
  department_run_id: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  record: string;
}

interface PromptRow {
  approval_id: string;
  chat_id: string;
  user_id: string;
  prompt_message_id: number | null;
  created_at: string;
  closed_at: string | null;
}

export interface FakeD1 extends D1Database {
  approvals: Map<string, ApprovalRow>;
  processedUpdates: Map<number, string>;
  prompts: Map<string, PromptRow>;
  /** Etiqueta de cada sentencia ejecutada, en orden. Permite afirmar "esto fue UN solo UPDATE". */
  executed: string[];
  /** SQL completo de cada sentencia ejecutada, para comprobar la forma de la sentencia critica. */
  executedSql: string[];
  seed(approval: Approval): void;
}

/** Merge patch de RFC 7386, que es lo que implementa `json_patch`: un `null` BORRA la clave. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const base: Record<string, unknown> =
    target !== null && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete base[key];
    else base[key] = mergePatch(base[key], value);
  }
  return base;
}

function tagOf(sql: string): string {
  const match = /^--\s*stmt:([a-zA-Z]+)/.exec(sql.trim());
  return match ? match[1] : "unknown";
}

function result<T>(rows: T[], changes: number): D1Result<T> {
  return { results: rows, success: true, meta: { changes } };
}

export function createFakeD1(): FakeD1 {
  const approvals = new Map<string, ApprovalRow>();
  const processedUpdates = new Map<number, string>();
  const prompts = new Map<string, PromptRow>();
  const executed: string[] = [];
  const executedSql: string[] = [];

  function rowOf(approval: Approval): ApprovalRow {
    return {
      approval_id: approval.changeId,
      recommendation_id: approval.recommendationId,
      department_run_id: approval.departmentRunId,
      status: approval.status,
      version: approval.version,
      created_at: approval.createdAt,
      updated_at: approval.updatedAt,
      record: JSON.stringify(approval),
    };
  }

  /** Reconstruye el registro nuevo igual que hace la expresion SQL del store. */
  function applyRecordExpression(
    current: string,
    patchJson: string,
    at: string,
    auditJson: string,
    status: string | null,
    runId: unknown | undefined
  ): string {
    const record = mergePatch(JSON.parse(current), JSON.parse(patchJson)) as Record<string, unknown>;
    if (status !== null) record.status = status;
    record.updatedAt = at;
    const audit = Array.isArray(record.auditTrail) ? (record.auditTrail as unknown[]) : [];
    record.auditTrail = [...audit, JSON.parse(auditJson)];
    if (runId !== undefined) {
      // json_set NO crea el objeto intermedio: si `production` no es un
      // objeto, la escritura no tiene efecto.
      const production = record.production;
      if (production !== null && typeof production === "object" && !Array.isArray(production)) {
        (production as Record<string, unknown>).githubRunId = runId;
      }
    }
    return JSON.stringify(record);
  }

  function execute(sql: string, bindings: unknown[]): D1Result<Record<string, unknown>> {
    const tag = tagOf(sql);
    executed.push(tag);
    executedSql.push(sql);

    switch (tag) {
      case "get": {
        const row = approvals.get(String(bindings[0]));
        return result(row ? [{ record: row.record }] : [], 0);
      }
      case "listByRecommendation": {
        const rows = [...approvals.values()]
          .filter((r) => r.recommendation_id === String(bindings[0]))
          .sort((a, b) => a.version - b.version || a.created_at.localeCompare(b.created_at))
          .map((r) => ({ record: r.record }));
        return result(rows, 0);
      }
      case "listByRun": {
        const rows = [...approvals.values()]
          .filter((r) => r.department_run_id === String(bindings[0]))
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.approval_id.localeCompare(b.approval_id))
          .map((r) => ({ record: r.record }));
        return result(rows, 0);
      }
      case "create": {
        const id = String(bindings[0]);
        if (approvals.has(id)) return result([], 0); // ON CONFLICT DO NOTHING
        approvals.set(id, {
          approval_id: id,
          recommendation_id: String(bindings[1]),
          department_run_id: String(bindings[2]),
          status: String(bindings[3]),
          version: Number(bindings[4]),
          created_at: String(bindings[5]),
          updated_at: String(bindings[6]),
          record: String(bindings[7]),
        });
        return result([], 1);
      }
      case "transition": {
        // [to, at, patchJson, to, at, auditJson, (runId)?, approvalId, ...expected]
        const hasRunId = /\$\.production\.githubRunId/.test(sql);
        const to = String(bindings[0]);
        const at = String(bindings[1]);
        const patchJson = String(bindings[2]);
        const auditJson = String(bindings[5]);
        const runId = hasRunId ? bindings[6] : undefined;
        const idIndex = hasRunId ? 7 : 6;
        const approvalId = String(bindings[idIndex]);
        const expected = bindings.slice(idIndex + 1).map(String);

        const row = approvals.get(approvalId);
        // ESTA es la condicion del WHERE: sin fila o sin estado esperado,
        // cero filas cambiadas y ningun efecto.
        if (!row || !expected.includes(row.status)) return result([], 0);

        const record = applyRecordExpression(row.record, patchJson, at, auditJson, to, runId);
        approvals.set(approvalId, { ...row, status: to, updated_at: at, record });
        return result([{ record }], 1);
      }
      case "annotate": {
        // [at, patchJson, at, auditJson, (runId)?, approvalId]
        const hasRunId = /\$\.production\.githubRunId/.test(sql);
        const at = String(bindings[0]);
        const patchJson = String(bindings[1]);
        const auditJson = String(bindings[3]);
        const runId = hasRunId ? bindings[4] : undefined;
        const approvalId = String(bindings[hasRunId ? 5 : 4]);

        const row = approvals.get(approvalId);
        if (!row) return result([], 0);
        const record = applyRecordExpression(row.record, patchJson, at, auditJson, null, runId);
        approvals.set(approvalId, { ...row, updated_at: at, record });
        return result([{ record }], 1);
      }
      case "markUpdate": {
        const updateId = Number(bindings[0]);
        if (processedUpdates.has(updateId)) return result([], 0); // colision de PK = replay
        processedUpdates.set(updateId, String(bindings[1]));
        return result([], 1);
      }
      case "openPrompt": {
        const id = String(bindings[0]);
        const messageId = bindings[3];
        prompts.set(id, {
          approval_id: id,
          chat_id: String(bindings[1]),
          user_id: String(bindings[2]),
          prompt_message_id: typeof messageId === "number" ? messageId : null,
          created_at: String(bindings[4]),
          closed_at: null,
        });
        return result([], 1);
      }
      case "findOpenPrompt": {
        const rows = [...prompts.values()]
          .filter((p) => p.chat_id === String(bindings[0]) && p.user_id === String(bindings[1]) && p.closed_at === null)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.approval_id.localeCompare(a.approval_id));
        return result(rows.slice(0, 1) as unknown as Record<string, unknown>[], 0);
      }
      case "findPromptByMessage": {
        const rows = [...prompts.values()].filter(
          (p) => p.chat_id === String(bindings[0]) && p.prompt_message_id === Number(bindings[1]) && p.closed_at === null
        );
        return result(rows.slice(0, 1) as unknown as Record<string, unknown>[], 0);
      }
      case "closePrompt": {
        const row = prompts.get(String(bindings[1]));
        if (!row || row.closed_at !== null) return result([], 0);
        prompts.set(row.approval_id, { ...row, closed_at: String(bindings[0]) });
        return result([], 1);
      }
      case "feedback": {
        const rows = [...approvals.values()]
          .filter((r) => r.recommendation_id === String(bindings[0]) && r.status === "rejected")
          .sort((a, b) => a.version - b.version)
          .map((r) => ({ record: r.record }));
        return result(rows, 0);
      }
      default:
        throw new Error(`El doble de D1 no conoce la sentencia "${tag}". Si el store añade una, hay que enseñarsela aqui.`);
    }
  }

  function prepare(sql: string): D1PreparedStatement {
    let bindings: unknown[] = [];
    const statement: D1PreparedStatement = {
      bind(...values: unknown[]) {
        bindings = values;
        return statement;
      },
      async first<T>() {
        const res = execute(sql, bindings);
        return ((res.results ?? [])[0] ?? null) as T | null;
      },
      async run<T>() {
        return execute(sql, bindings) as unknown as D1Result<T>;
      },
      async all<T>() {
        return execute(sql, bindings) as unknown as D1Result<T>;
      },
    };
    return statement;
  }

  return {
    approvals,
    processedUpdates,
    prompts,
    executed,
    executedSql,
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      const out: D1Result<T>[] = [];
      for (const s of statements) out.push((await s.run()) as unknown as D1Result<T>);
      return out;
    },
    seed(approval: Approval) {
      approvals.set(approval.changeId, rowOf(approval));
    },
  };
}

// --- Fixtures ---------------------------------------------------------------

const AT = "2026-08-15T13:00:00.000Z";

function awaiting(overrides: Partial<Approval> = {}): Approval {
  return change({
    status: "awaiting_approval",
    telegram: { telegramApprovalId: "t-1", telegramMessageId: 500, chatId: "-100", sentAt: "2026-08-15T11:00:00.000Z", stagingVersionHash: "hash-a" },
    ...overrides,
  });
}

function storeOf(db: ReturnType<typeof createFakeD1>): D1ApprovalStore {
  return new D1ApprovalStore(db, { now: () => new Date(AT) });
}

const AUDIT = { event: "test_event", detail: "Motivo de la transicion." };

// --- Suite ------------------------------------------------------------------

export function runWorkerD1StoreTests(): TestCase[] {
  return [
    {
      name: "create es idempotente por approvalId: el segundo intento devuelve LA GUARDADA, no la entrante",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        const first = await store.create(awaiting());
        assert.equal(first.created, true);

        // Segundo intento con el MISMO id pero contenido distinto: un
        // reintento del workflow no puede pisar una decision ya tomada.
        const second = await store.create(awaiting({ title: "Titulo distinto", status: "rejected" }));
        assert.equal(second.created, false);
        assert.equal(second.approval.title, "Reescribir metas de la familia melamina");
        assert.equal(second.approval.status, "awaiting_approval");
      },
    },
    {
      name: "transition ok: un UNICO UPDATE con `status IN (...)`, sin leer antes",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting());

        const outcome = await store.transition({ approvalId: awaiting().changeId, expectedFrom: ["awaiting_approval"], to: "approved", audit: AUDIT, at: AT });

        assert.equal(outcome.ok, true);
        // Ni un SELECT previo: la unica sentencia es la condicional.
        assert.deepEqual(db.executed, ["transition"]);
        const sql = db.executedSql[0];
        assert.ok(/^--\s*stmt:transition\nUPDATE approvals SET/.test(sql), "la transicion tiene que ser un UPDATE directo");
        assert.ok(/WHERE approval_id = \? AND status IN \(\?\)/.test(sql), "la condicion de estado tiene que ir en el WHERE");
        assert.ok(!/SELECT/.test(sql), "la transicion no puede llevar un SELECT dentro");
      },
    },
    {
      name: "transition ok: aplica el patch y APPENDEA la auditoria sin perder el historico",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting({ auditTrail: [{ at: "2026-08-15T10:00:00.000Z", event: "creado", detail: "Alta." }] }));

        const outcome = await store.transition({
          approvalId: awaiting().changeId,
          expectedFrom: ["awaiting_approval"],
          to: "approved",
          patch: { humanDecision: { decision: "approved", decidedBy: "telegram:42", decidedAt: AT, rejectionReason: "", channel: "telegram" } },
          audit: { event: "telegram_approved", detail: "Aprobacion humana." },
          at: AT,
        });

        assert.equal(outcome.ok, true);
        if (!outcome.ok) return;
        assert.equal(outcome.approval.status, "approved");
        assert.equal(outcome.approval.humanDecision?.decidedBy, "telegram:42");
        assert.equal(outcome.approval.updatedAt, AT);
        assert.equal(outcome.approval.auditTrail.length, 2, "la entrada nueva se añade, no sustituye");
        assert.equal(outcome.approval.auditTrail[0].event, "creado");
        assert.equal(outcome.approval.auditTrail[1].event, "telegram_approved");
        // El estado indexado y el del blob no pueden divergir.
        assert.equal(db.approvals.get(outcome.approval.changeId)?.status, "approved");
      },
    },
    {
      name: "transition sobre un estado que NO esta en expectedFrom -> conflict y CERO escrituras",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting({ status: "rejected" }));
        const before = db.approvals.get(awaiting().changeId)?.record;

        const outcome = await store.transition({ approvalId: awaiting().changeId, expectedFrom: ["approved"], to: "production_queued", audit: AUDIT, at: AT });

        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, "conflict");
        assert.equal(outcome.currentStatus, "rejected");
        assert.equal(db.approvals.get(awaiting().changeId)?.record, before, "un conflict no puede haber tocado el registro");
      },
    },
    {
      name: "transition sobre una aprobacion inexistente -> not_found (no se confunde con conflict)",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        const outcome = await store.transition({ approvalId: "no-existe", expectedFrom: ["awaiting_approval"], to: "approved", audit: AUDIT, at: AT });
        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, "not_found");
        assert.equal(outcome.currentStatus, null);
      },
    },
    {
      name: "transicion ILEGAL en la maquina de estados -> illegal_transition SIN ejecutar ningun UPDATE",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting({ status: "staging_applied" }));

        // staging_applied -> production_queued no existe: a produccion
        // solo se llega desde `approved`, con decision humana.
        const outcome = await store.transition({ approvalId: awaiting().changeId, expectedFrom: ["staging_applied"], to: "production_queued", audit: AUDIT, at: AT });

        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, "illegal_transition");
        assert.equal(outcome.currentStatus, "staging_applied");
        assert.ok(!db.executed.includes("transition"), "una transicion ilegal no puede llegar a la base de datos");
      },
    },
    {
      name: "expectedFrom vacio -> illegal_transition: no existen las transiciones incondicionales",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting());
        const outcome = await store.transition({ approvalId: awaiting().changeId, expectedFrom: [], to: "approved", audit: AUDIT, at: AT });
        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, "illegal_transition");
        assert.ok(!db.executed.includes("transition"));
      },
    },
    {
      name: "expectedFrom con UN origen ilegal invalida la transicion entera (fail-closed)",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting({ status: "approved" }));

        // `approved` si puede encolar; `staging_applied` no. Si se
        // aceptara la lista, el UPDATE podria ganar por el origen malo.
        const outcome = await store.transition({
          approvalId: awaiting().changeId,
          expectedFrom: ["approved", "staging_applied"],
          to: "production_queued",
          audit: AUDIT,
          at: AT,
        });

        assert.equal(outcome.ok, false);
        if (outcome.ok) return;
        assert.equal(outcome.reason, "illegal_transition");
        assert.ok(!db.executed.includes("transition"));
      },
    },
    {
      name: "dos transiciones approved -> production_queued sobre la misma aprobacion: solo UNA gana",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting({ status: "approved" }));
        const id = awaiting().changeId;

        const [a, b] = await Promise.all([
          store.transition({ approvalId: id, expectedFrom: ["approved"], to: "production_queued", audit: AUDIT, at: AT }),
          store.transition({ approvalId: id, expectedFrom: ["approved"], to: "production_queued", audit: AUDIT, at: AT }),
        ]);

        const wins = [a, b].filter((r) => r.ok).length;
        assert.equal(wins, 1, "dos encolados simultaneos serian dos publicaciones");
        const loser = [a, b].find((r) => !r.ok);
        assert.equal(loser && !loser.ok ? loser.reason : "", "conflict");
      },
    },
    {
      name: "markUpdateProcessed: la primera vez es nueva, la segunda es replay (colision de clave primaria)",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        assert.deepEqual(await store.markUpdateProcessed(9001, AT), { isNew: true });
        assert.deepEqual(await store.markUpdateProcessed(9001, AT), { isNew: false });
        assert.deepEqual(await store.markUpdateProcessed(9002, AT), { isNew: true });
      },
    },
    {
      name: "prompts de rechazo: con DOS abiertos, el message_id distingue y chat+usuario no",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        await store.openRejectionPrompt({ approvalId: "cambio-A", chatId: "-100", userId: "42", promptMessageId: 111, createdAt: "2026-08-15T12:00:00.000Z" });
        await store.openRejectionPrompt({ approvalId: "cambio-B", chatId: "-100", userId: "42", promptMessageId: 222, createdAt: "2026-08-15T12:05:00.000Z" });

        assert.equal((await store.findRejectionPromptByMessageId("-100", 111))?.approvalId, "cambio-A");
        assert.equal((await store.findRejectionPromptByMessageId("-100", 222))?.approvalId, "cambio-B");
        // Otro chat no ve nada, aunque el message_id coincida.
        assert.equal(await store.findRejectionPromptByMessageId("-999", 111), null);
      },
    },
    {
      name: "closeRejectionPrompt cierra SOLO el suyo y deja de aparecer en las busquedas",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        await store.openRejectionPrompt({ approvalId: "cambio-A", chatId: "-100", userId: "42", promptMessageId: 111, createdAt: "2026-08-15T12:00:00.000Z" });
        await store.openRejectionPrompt({ approvalId: "cambio-B", chatId: "-100", userId: "42", promptMessageId: 222, createdAt: "2026-08-15T12:05:00.000Z" });

        await store.closeRejectionPrompt("cambio-A");

        assert.equal(await store.findRejectionPromptByMessageId("-100", 111), null);
        assert.equal((await store.findRejectionPromptByMessageId("-100", 222))?.approvalId, "cambio-B");
        assert.equal((await store.findOpenRejectionPrompt("-100", "42"))?.approvalId, "cambio-B");
        assert.equal(db.prompts.get("cambio-A")?.closed_at, AT);
      },
    },
    {
      name: "openRejectionPrompt reabre con el mensaje NUEVO: el motivo se correlaciona con la ultima pregunta",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        await store.openRejectionPrompt({ approvalId: "cambio-A", chatId: "-100", userId: "42", promptMessageId: 111, createdAt: "2026-08-15T12:00:00.000Z" });
        await store.openRejectionPrompt({ approvalId: "cambio-A", chatId: "-100", userId: "42", promptMessageId: 333, createdAt: "2026-08-15T12:10:00.000Z" });

        assert.equal(db.prompts.size, 1, "una sola pregunta abierta por aprobacion");
        assert.equal(await store.findRejectionPromptByMessageId("-100", 111), null);
        assert.equal((await store.findRejectionPromptByMessageId("-100", 333))?.approvalId, "cambio-A");
      },
    },
    {
      name: "listHumanFeedback devuelve solo rechazos CON motivo, ordenados por version",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        const recommendationId = "run#rec-1";
        db.seed(
          change({
            changeId: "v1",
            recommendationId,
            version: 1,
            status: "rejected",
            humanDecision: { decision: "rejected", decidedBy: "telegram:42", decidedAt: "2026-08-10T10:00:00.000Z", rejectionReason: "El H1 no encaja.", channel: "telegram" },
          })
        );
        // Rechazo ABIERTO sin motivo: es una pregunta, no feedback.
        db.seed(
          change({
            changeId: "v2",
            recommendationId,
            version: 2,
            status: "rejected",
            humanDecision: { decision: "rejected", decidedBy: "telegram:42", decidedAt: "2026-08-12T10:00:00.000Z", rejectionReason: "   ", channel: "telegram" },
          })
        );
        // Aprobado: no es feedback de rechazo.
        db.seed(change({ changeId: "v3", recommendationId, version: 3, status: "approved" }));

        const feedback = await store.listHumanFeedback(recommendationId);
        assert.equal(feedback.length, 1);
        assert.equal(feedback[0].approvalId, "v1");
        assert.equal(feedback[0].rejectionReason, "El H1 no encaja.");
        assert.equal(feedback[0].rejectedAt, "2026-08-10T10:00:00.000Z");
      },
    },
    {
      name: "listByRecommendation ordena por version y listByRun agrupa por pasada",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(change({ changeId: "c-v2", recommendationId: "rec-1", departmentRunId: "run-A", version: 2 }));
        db.seed(change({ changeId: "c-v1", recommendationId: "rec-1", departmentRunId: "run-A", version: 1 }));
        db.seed(change({ changeId: "otro", recommendationId: "rec-2", departmentRunId: "run-B", version: 1 }));

        assert.deepEqual((await store.listByRecommendation("rec-1")).map((a) => a.changeId), ["c-v1", "c-v2"]);
        assert.equal((await store.listByRun("run-B")).length, 1);
        assert.equal((await store.listByRun("run-A")).length, 2);
      },
    },
    {
      name: "productionRunId NO fabrica un registro de produccion a medias si `production` es null",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting({ status: "production_queued", production: null }));

        const outcome = await store.transition({
          approvalId: awaiting().changeId,
          expectedFrom: ["production_queued"],
          to: "production_applying",
          patch: { productionRunId: "run-777" },
          audit: AUDIT,
          at: AT,
        });

        assert.equal(outcome.ok, true);
        if (!outcome.ok) return;
        // Fail-closed: antes un `production` inventado con un solo campo,
        // mejor ninguno. El apply real lo creara entero.
        assert.equal(outcome.approval.production, null);
      },
    },
    {
      name: "productionRunId se anota cuando `production` ya existe (cierra la trazabilidad con el run)",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(
          awaiting({
            status: "production_applying",
            production: {
              environment: "production",
              applyId: "production::c1",
              wordpressPageId: 2091,
              url: "https://zentrylockers.com/taquillas-melamina/",
              pageSlug: "taquillas-melamina",
              startedAt: AT,
              finishedAt: null,
              snapshot: null,
              changedFields: [],
              validationStatus: "not_run",
              validationDetail: "",
              rollbackStatus: "not_needed",
              rollbackDetail: "",
              resultingVersionHash: null,
              githubRunId: null,
            },
          })
        );

        const outcome = await store.transition({
          approvalId: awaiting().changeId,
          expectedFrom: ["production_applying"],
          to: "production_applied",
          patch: { productionRunId: "run-777" },
          audit: AUDIT,
          at: AT,
        });

        assert.equal(outcome.ok, true);
        if (!outcome.ok) return;
        assert.equal(outcome.approval.production?.githubRunId, "run-777");
      },
    },
    {
      name: "annotate cambia datos y auditoria pero NUNCA el estado",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting());

        const annotated = await store.annotate(
          awaiting().changeId,
          { telegram: { telegramApprovalId: "t-9", telegramMessageId: 777, chatId: "-100", sentAt: AT, stagingVersionHash: "hash-b" } },
          { event: "telegram_request_sent", detail: "Solicitud enviada." },
          AT
        );

        assert.equal(annotated?.status, "awaiting_approval", "annotate no puede mover el estado");
        assert.equal(annotated?.telegram?.telegramMessageId, 777);
        assert.equal(annotated?.auditTrail.at(-1)?.event, "telegram_request_sent");
        assert.ok(!db.executedSql.some((sql) => /stmt:annotate[\s\S]*SET status/.test(sql)), "la sentencia de annotate no puede tocar la columna status");
      },
    },
    {
      name: "un campo puesto a null por el merge patch se lee como null, no como ausente",
      fn: async () => {
        const db = createFakeD1();
        const store = storeOf(db);
        db.seed(awaiting());

        // RFC 7386: un null en el parche BORRA la clave. El contrato la
        // declara `X | null`, asi que se normaliza al leer.
        const outcome = await store.transition({
          approvalId: awaiting().changeId,
          expectedFrom: ["awaiting_approval"],
          to: "blocked",
          patch: { telegram: null },
          audit: AUDIT,
          at: AT,
        });

        assert.equal(outcome.ok, true);
        if (!outcome.ok) return;
        assert.equal(outcome.approval.telegram, null);
        assert.ok("telegram" in outcome.approval);
      },
    },
    {
      name: "buildMergePatch ignora lo que no es un campo del registro y deja fuera productionRunId",
      fn: () => {
        const merge = buildMergePatch({ productionRunId: "run-1", inheritedFeedback: ["motivo previo"] });
        assert.deepEqual(merge, { inheritedFeedback: ["motivo previo"] });
        assert.deepEqual(buildMergePatch(undefined), {});
      },
    },
    {
      name: "changedRows: `changes` manda y `rows_written` es el respaldo",
      fn: () => {
        assert.equal(changedRows({ success: true, meta: { changes: 0, rows_written: 5 } }), 0);
        assert.equal(changedRows({ success: true, meta: { rows_written: 3 } }), 3);
        assert.equal(changedRows({ success: true, meta: {} }), 0);
      },
    },
    {
      name: "normalizeApproval rellena los opcionales ausentes en vez de dejarlos undefined",
      fn: () => {
        const approval = normalizeApproval({ changeId: "c1" });
        assert.equal(approval.staging, null);
        assert.equal(approval.telegram, null);
        assert.equal(approval.humanDecision, null);
        assert.equal(approval.production, null);
        assert.deepEqual(approval.inheritedFeedback, []);
        assert.deepEqual(approval.auditTrail, []);
      },
    },
  ];
}
