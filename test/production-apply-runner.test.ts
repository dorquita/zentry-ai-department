import * as assert from "node:assert/strict";
import { Approval, ApprovalStore, TransitionInput, TransitionOutcome } from "../src/approvals/store";
import { EnvironmentApplyRecord, HumanDecisionRecord, TelegramApprovalRecord } from "../src/department/apply/change-types";
import { ProductionApplyGuards } from "../src/department/apply/guards";
import { ProductionApplyResult, ProductionExecutorDeps, ProductionPageState } from "../src/department/apply/production-executor";
import { ChangeTransitionPort } from "../src/department/apply/staging-executor";
import { checkTransition, DepartmentChangeStatus } from "../src/department/apply/state-machine";
import { computeVersionHash } from "../src/department/apply/version";
import { runProductionApply } from "../scripts/run-production-apply";
import { change, NEW_META, NEW_TITLE, NOW, stagingPage, STAGING_URL } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

/**
 * Tests del runner de produccion (el script que ejecuta el workflow
 * department-production-apply.yml). Sin red y sin ficheros: el store, los
 * adaptadores de WordPress y Telegram se inyectan.
 *
 * Lo que se comprueba es la GUARDIA, no el executor (que tiene su propia
 * suite): que no se publique nada si la aprobacion no existe, si el
 * estado no es el encolado, si staging cambio, si los interruptores estan
 * apagados o si otro run reclamo antes el apply.
 */

const GUARDS_OK: ProductionApplyGuards = {
  departmentProductionApplyEnabled: true,
  productionExecutionEnabled: true,
  productionWritesEnabled: true,
  productionBackend: "rest",
};

const RUN_ID = "12345678";
const STAGING_AFTER = stagingPage({ title: NEW_TITLE, excerpt: NEW_META });
const APPROVED_HASH = computeVersionHash({
  status: STAGING_AFTER.status,
  title: STAGING_AFTER.title,
  metaDescription: STAGING_AFTER.excerpt,
  contentHtml: STAGING_AFTER.contentHtml,
});

function stagingRecord(): EnvironmentApplyRecord {
  return {
    environment: "staging",
    applyId: "staging::dept#change-1-v1",
    wordpressPageId: 2091,
    url: STAGING_URL,
    pageSlug: "taquillas-melamina",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    snapshot: null,
    changedFields: [
      { field: "title", before: "Titulo antiguo", after: NEW_TITLE, changed: true },
      { field: "meta description", before: "Meta antigua", after: NEW_META, changed: true },
      { field: "contenido (cuerpo)", before: "(sin cambios)", after: "(sin cambios)", changed: false },
    ],
    validationStatus: "passed",
    validationDetail: "ok",
    rollbackStatus: "not_needed",
    rollbackDetail: "",
    resultingVersionHash: APPROVED_HASH,
  };
}

function telegramRecord(): TelegramApprovalRecord {
  return { telegramApprovalId: "req-1", telegramMessageId: 4242, chatId: "123", sentAt: NOW.toISOString(), stagingVersionHash: APPROVED_HASH };
}

function humanDecision(): HumanDecisionRecord {
  return { decision: "approved", decidedBy: "telegram:123", decidedAt: NOW.toISOString(), rejectionReason: "", channel: "telegram" };
}

function queuedApproval(overrides: Partial<Approval> = {}): Approval {
  return change({
    status: "production_queued",
    staging: stagingRecord(),
    telegram: telegramRecord(),
    humanDecision: humanDecision(),
    ...overrides,
  });
}

function productionPage(overrides: Partial<ProductionPageState> = {}): ProductionPageState {
  return {
    id: 900,
    status: "publish",
    title: "Titulo antiguo produccion",
    contentHtml: "<p>Produccion</p>",
    excerpt: "Meta antigua produccion",
    slug: "taquillas-melamina",
    link: "https://zentrylockers.com/taquillas-melamina/",
    ...overrides,
  };
}

// --- Store en memoria con las MISMAS garantias que el real ------------------

interface FakeStore extends ApprovalStore {
  /** Transiciones ACEPTADAS, en orden. */
  applied: { from: DepartmentChangeStatus; to: DepartmentChangeStatus; patch: TransitionInput["patch"] }[];
  /** Todas las transiciones intentadas (aceptadas o no). */
  attempts: TransitionInput[];
  current: () => Approval | null;
}

/**
 * Igual que el store real en lo que importa: la transicion es CONDICIONAL
 * (solo se aplica si el estado actual esta en `expectedFrom`) y se
 * comprueba contra la maquina de estados. `beforeTransition` permite
 * simular que otro actor gana la carrera.
 */
function fakeStore(initial: Approval | null, options: { beforeTransition?: (attempt: number) => void } = {}): FakeStore {
  let stored = initial ? { ...initial } : null;
  const applied: { from: DepartmentChangeStatus; to: DepartmentChangeStatus; patch: TransitionInput["patch"] }[] = [];
  const attempts: TransitionInput[] = [];
  const unsupported = (name: string) => {
    throw new Error(`El test no espera ninguna llamada a ${name}.`);
  };
  return {
    applied,
    attempts,
    current: () => (stored ? { ...stored } : null),
    async get() {
      return stored ? { ...stored } : null;
    },
    async transition(input: TransitionInput): Promise<TransitionOutcome> {
      attempts.push(input);
      if (options.beforeTransition) options.beforeTransition(attempts.length);
      if (!stored) return { ok: false, reason: "not_found", currentStatus: null, approval: null };
      if (!input.expectedFrom.includes(stored.status)) {
        return { ok: false, reason: "conflict", currentStatus: stored.status, approval: { ...stored } };
      }
      const check = checkTransition(stored.status, input.to);
      if (!check.allowed) {
        return { ok: false, reason: "illegal_transition", currentStatus: stored.status, approval: { ...stored } };
      }
      applied.push({ from: stored.status, to: input.to, patch: input.patch });
      stored = {
        ...stored,
        ...(input.patch?.production !== undefined ? { production: input.patch.production } : {}),
        status: input.to,
        auditTrail: [...stored.auditTrail, { at: input.at, event: input.audit.event, detail: input.audit.detail }],
        updatedAt: input.at,
      };
      return { ok: true, approval: { ...stored } };
    },
    async listByRun() {
      return unsupported("listByRun");
    },
    async listByRecommendation() {
      return unsupported("listByRecommendation");
    },
    async create() {
      return unsupported("create");
    },
    async annotate() {
      return unsupported("annotate");
    },
    async markUpdateProcessed() {
      return unsupported("markUpdateProcessed");
    },
    async openRejectionPrompt() {
      return unsupported("openRejectionPrompt");
    },
    async findOpenRejectionPrompt() {
      return unsupported("findOpenRejectionPrompt");
    },
    async findRejectionPromptByMessageId() {
      return unsupported("findRejectionPromptByMessageId");
    },
    async closeRejectionPrompt() {
      return unsupported("closeRejectionPrompt");
    },
    async listHumanFeedback() {
      return unsupported("listHumanFeedback");
    },
  };
}

// --- Adaptadores de WordPress falsos ---------------------------------------

interface FakeWordpress {
  deps: ProductionExecutorDeps;
  writes: number;
  prod: () => ProductionPageState;
}

function fakeWordpress(options: { staging?: ReturnType<typeof stagingPage>; failRollback?: boolean; ignoreApply?: boolean } = {}): FakeWordpress {
  const state = { prod: productionPage(), writes: 0 };
  const staging = options.staging ?? STAGING_AFTER;
  const original = { title: state.prod.title, excerpt: state.prod.excerpt };
  return {
    get writes() {
      return state.writes;
    },
    prod: () => state.prod,
    deps: {
      getStagingPage: async () => ({ ...staging }),
      findProductionPagesBySlug: async (slug) => [{ id: state.prod.id, slug, status: state.prod.status }],
      getProductionPage: async () => ({ ...state.prod }),
      updateProductionPublishedPage: async (input) => {
        const isRollback = input.title === original.title;
        if (options.failRollback && isRollback) throw new Error("500 revirtiendo produccion");
        state.writes += 1;
        if (options.ignoreApply && !isRollback) return;
        state.prod = { ...state.prod, title: input.title, excerpt: input.excerpt };
      },
    },
  };
}

// --- Executor falso: solo para comprobar el cableado del runner ------------

function productionRecordFor(overrides: Partial<EnvironmentApplyRecord> = {}): EnvironmentApplyRecord {
  return {
    environment: "production",
    applyId: "production::dept#change-1-v1",
    wordpressPageId: 900,
    url: "https://zentrylockers.com/taquillas-melamina/",
    pageSlug: "taquillas-melamina",
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    snapshot: null,
    changedFields: [],
    validationStatus: "passed",
    validationDetail: "ok",
    rollbackStatus: "not_needed",
    rollbackDetail: "",
    resultingVersionHash: "hash-produccion",
    ...overrides,
  };
}

interface ExecutorSpy {
  calls: number;
  apply: (
    approval: Approval,
    deps: ProductionExecutorDeps,
    guards: ProductionApplyGuards,
    port: ChangeTransitionPort
  ) => Promise<ProductionApplyResult>;
}

/** Reproduce la CADENA de transiciones del executor real sin repetir su logica. */
function executorSpy(outcome: "applied" | "rollback_failed"): ExecutorSpy {
  const spy = { calls: 0 } as ExecutorSpy;
  spy.apply = async (approval, _deps, _guards, port) => {
    spy.calls += 1;
    const started = port.transition(approval, "production_applying", { production: productionRecordFor({ validationStatus: "not_run" }) }, {
      event: "production_apply_started",
      detail: "Publicando en PRODUCCION.",
    });
    if (outcome === "applied") {
      const applied = port.transition(started.change, "production_applied", { production: productionRecordFor() }, {
        event: "production_applied",
        detail: "Cambio PUBLICADO y validado.",
      });
      return {
        change: applied.change,
        externalWritePerformed: true,
        message: "✅ CAMBIO PUBLICADO\n\nReescribir metas\n\nhttps://zentrylockers.com/taquillas-melamina/",
      };
    }
    const failed = port.transition(started.change, "production_validation_failed", { production: productionRecordFor({ validationStatus: "failed" }) }, {
      event: "production_validation_failed",
      detail: "La validacion fallo.",
    });
    const blocked = port.transition(
      failed.change,
      "blocked",
      { production: productionRecordFor({ validationStatus: "failed", rollbackStatus: "rollback_failed", rollbackDetail: "CRITICO" }) },
      { event: "production_rollback_failed", detail: "CRITICO: el rollback fallo." }
    );
    return {
      change: blocked.change,
      externalWritePerformed: true,
      message: "🚨 PUBLICACION FALLIDA\n\nReescribir metas\n\nREQUIERE INTERVENCION HUMANA INMEDIATA.",
    };
  };
  return spy;
}

interface RunHarness {
  store: FakeStore;
  wordpress: FakeWordpress;
  sent: string[];
  logs: string[];
}

function harness(approval: Approval | null, options: { wordpress?: FakeWordpress; beforeTransition?: (attempt: number) => void } = {}): RunHarness {
  return {
    store: fakeStore(approval, { beforeTransition: options.beforeTransition }),
    wordpress: options.wordpress ?? fakeWordpress(),
    sent: [],
    logs: [],
  };
}

function runWith(h: RunHarness, extra: { guards?: ProductionApplyGuards; spy?: ExecutorSpy; githubRunId?: string | null } = {}) {
  return runProductionApply({
    approvalId: change().changeId,
    store: h.store,
    executorDeps: h.wordpress.deps,
    guards: extra.guards ?? GUARDS_OK,
    githubRunId: extra.githubRunId === undefined ? RUN_ID : extra.githubRunId,
    now: () => NOW,
    log: (line) => h.logs.push(line),
    notify: async (text) => {
      h.sent.push(text);
    },
    ...(extra.spy ? { applyToProduction: extra.spy.apply } : {}),
  });
}

export function runProductionApplyRunnerTests(): TestCase[] {
  return [
    {
      name: "Sin aprobacion en el registro no se publica nada y el run acaba en error",
      fn: async () => {
        const h = harness(null);
        const spy = executorSpy("applied");
        const result = await runWith(h, { spy });

        assert.equal(result.exitCode, 1);
        assert.equal(spy.calls, 0);
        assert.equal(h.wordpress.writes, 0);
        assert.equal(h.store.attempts.length, 0, "ni siquiera se intenta mover un estado que no existe");
      },
    },
    {
      name: "Estado terminal coherente (ya publicado) = dispatch duplicado: no publica, sale 0 y no avisa",
      fn: async () => {
        const h = harness(queuedApproval({ status: "production_applied" }));
        const spy = executorSpy("applied");
        const result = await runWith(h, { spy });

        assert.equal(result.exitCode, 0);
        assert.equal(spy.calls, 0);
        assert.equal(h.store.applied.length, 0);
        assert.equal(h.sent.length, 0, "el resultado real ya se conto en su momento: no se repite el aviso");
      },
    },
    {
      name: "Estado incoherente (todavia esperando a una persona) -> no publica y sale 1",
      fn: async () => {
        for (const status of ["awaiting_approval", "approved", "staging_applied"] as DepartmentChangeStatus[]) {
          const h = harness(queuedApproval({ status }));
          const spy = executorSpy("applied");
          const result = await runWith(h, { spy });

          assert.equal(result.exitCode, 1, `estado ${status}`);
          assert.equal(spy.calls, 0);
          assert.equal(h.wordpress.writes, 0);
          assert.equal(h.store.applied.length, 0);
        }
      },
    },
    {
      name: "TOCTOU: si staging cambio -> approval_stale, aviso por Telegram y CERO escrituras",
      fn: async () => {
        const wordpress = fakeWordpress({ staging: stagingPage({ title: "Otro title puesto a mano", excerpt: NEW_META }) });
        const h = harness(queuedApproval(), { wordpress });
        const spy = executorSpy("applied");
        const result = await runWith(h, { spy });

        assert.equal(result.exitCode, 0, "caducar no es un fallo del sistema: es la proteccion funcionando");
        assert.equal(result.status, "approval_stale");
        assert.equal(spy.calls, 0);
        assert.equal(wordpress.writes, 0);
        assert.deepEqual(
          h.store.applied.map((t) => t.to),
          ["approval_stale"]
        );
        assert.equal(h.store.current()?.status, "approval_stale");
        assert.match(h.sent.join("\n"), /No publico nada/);
        assert.match(h.sent.join("\n"), /aprobacion nueva/i);
      },
    },
    {
      name: "Sin hash de la version aprobada tampoco se publica (fail-closed, no se asume que siga igual)",
      fn: async () => {
        const h = harness(queuedApproval({ telegram: null, staging: { ...stagingRecord(), resultingVersionHash: null } }));
        const spy = executorSpy("applied");
        const result = await runWith(h, { spy });

        assert.equal(result.status, "approval_stale");
        assert.equal(spy.calls, 0);
        assert.equal(h.wordpress.writes, 0);
      },
    },
    {
      name: "Sin registro de staging no hay nada que comprobar: no publica y sale 1",
      fn: async () => {
        const h = harness(queuedApproval({ staging: null }));
        const spy = executorSpy("applied");
        const result = await runWith(h, { spy });

        assert.equal(result.exitCode, 1);
        assert.equal(spy.calls, 0);
        assert.equal(h.store.applied.length, 0);
      },
    },
    {
      name: "Interruptores de produccion apagados -> NO se reclama el apply (la aprobacion sigue encolada)",
      fn: async () => {
        for (const guards of [
          { ...GUARDS_OK, departmentProductionApplyEnabled: false },
          { ...GUARDS_OK, productionExecutionEnabled: false },
          { ...GUARDS_OK, productionWritesEnabled: false },
          { ...GUARDS_OK, productionBackend: "local_preview" },
        ]) {
          const h = harness(queuedApproval());
          const spy = executorSpy("applied");
          const result = await runWith(h, { guards, spy });

          assert.equal(result.exitCode, 1);
          assert.equal(spy.calls, 0);
          assert.equal(h.store.applied.length, 0, "no se saca de la cola algo que este entorno no puede publicar");
          assert.equal(h.store.current()?.status, "production_queued");
        }
      },
    },
    {
      name: "Un apply anterior que se quedo a medias (production_applying) NO se reintenta a ciegas",
      fn: async () => {
        const h = harness(queuedApproval({ status: "production_applying" }));
        const spy = executorSpy("applied");
        const result = await runWith(h, { spy });

        assert.equal(result.exitCode, 1, "production_applying no es un terminal coherente: alguien tiene que mirarlo");
        assert.equal(spy.calls, 0);
        assert.equal(h.wordpress.writes, 0);
        assert.equal(h.store.applied.length, 0);
      },
    },
    {
      name: "Reclamacion perdida en la carrera (409 del store) -> no publica y sale 0",
      fn: async () => {
        const approval = queuedApproval();
        // La primera transicion que intenta el runner es la reclamacion:
        // justo antes, otro actor la gana.
        const store = fakeStore(approval);
        const original = store.transition.bind(store);
        let first = true;
        store.transition = async (input: TransitionInput) => {
          if (first) {
            first = false;
            store.attempts.push(input);
            return { ok: false, reason: "conflict", currentStatus: "production_applying", approval: null };
          }
          return original(input);
        };
        const wordpress = fakeWordpress();
        const spy = executorSpy("applied");
        const sent: string[] = [];
        const result = await runProductionApply({
          approvalId: approval.changeId,
          store,
          executorDeps: wordpress.deps,
          guards: GUARDS_OK,
          githubRunId: RUN_ID,
          now: () => NOW,
          log: () => undefined,
          notify: async (text) => {
            sent.push(text);
          },
          applyToProduction: spy.apply,
        });

        assert.equal(result.exitCode, 0, "un cambio se publica UNA vez: perder la carrera es normal");
        assert.equal(spy.calls, 0);
        assert.equal(wordpress.writes, 0);
        assert.equal(sent.length, 0);
      },
    },
    {
      name: "Hash igual -> reclama, llama al executor, persiste la cadena de estados y guarda el githubRunId",
      fn: async () => {
        const h = harness(queuedApproval());
        const spy = executorSpy("applied");
        const result = await runWith(h, { spy });

        assert.equal(spy.calls, 1);
        assert.equal(result.exitCode, 0);
        assert.equal(result.externalWritePerformed, true);
        assert.deepEqual(
          h.store.applied.map((t) => t.to),
          ["production_applying", "production_applied"],
          "la reclamacion la hace el runner por HTTP ANTES de escribir; el resto se persiste despues"
        );
        assert.equal(h.store.current()?.status, "production_applied");
        assert.equal(h.store.current()?.production?.githubRunId, RUN_ID, "trazabilidad decision humana -> run que publico");
        assert.equal(h.store.applied[0].patch?.productionRunId, RUN_ID);
        assert.match(h.sent.join("\n"), /CAMBIO PUBLICADO/);
        assert.match(h.sent.join("\n"), /zentrylockers\.com/);
      },
    },
    {
      name: "Rollback fallido -> mensaje critico por Telegram y exit code 1",
      fn: async () => {
        const h = harness(queuedApproval());
        const spy = executorSpy("rollback_failed");
        const result = await runWith(h, { spy });

        assert.equal(result.exitCode, 1);
        assert.equal(h.store.current()?.status, "blocked");
        assert.equal(h.store.current()?.production?.rollbackStatus, "rollback_failed");
        assert.match(h.sent.join("\n"), /PUBLICACION FALLIDA/);
        assert.match(h.sent.join("\n"), /INTERVENCION HUMANA INMEDIATA/i);
      },
    },
    {
      name: "Con el executor REAL: publica, valida releyendo y deja el registro en production_applied",
      fn: async () => {
        const wordpress = fakeWordpress();
        const h = harness(queuedApproval(), { wordpress });
        const result = await runWith(h);

        assert.equal(result.exitCode, 0);
        assert.equal(wordpress.writes, 1);
        assert.equal(wordpress.prod().title, NEW_TITLE);
        assert.equal(wordpress.prod().excerpt, NEW_META);
        assert.equal(h.store.current()?.status, "production_applied");
        assert.equal(h.store.current()?.production?.validationStatus, "passed");
        assert.equal(h.store.current()?.production?.snapshot?.previousTitle, "Titulo antiguo produccion", "el snapshot previo REAL se persiste");
        assert.equal(h.store.current()?.production?.githubRunId, RUN_ID);
        assert.match(h.sent.join("\n"), /CAMBIO PUBLICADO/);
      },
    },
    {
      name: "Con el executor REAL: si la validacion falla, se revierte y el registro lo cuenta entero",
      fn: async () => {
        const wordpress = fakeWordpress({ ignoreApply: true });
        const h = harness(queuedApproval(), { wordpress });
        const result = await runWith(h);

        assert.equal(h.store.current()?.status, "production_rolled_back");
        assert.equal(h.store.current()?.production?.rollbackStatus, "rolled_back");
        assert.equal(wordpress.prod().title, "Titulo antiguo produccion");
        assert.deepEqual(
          h.store.applied.map((t) => t.to),
          ["production_applying", "production_validation_failed", "production_rolled_back"]
        );
        assert.match(result.message, /PUBLICACION FALLIDA/);
      },
    },
    {
      name: "Si Telegram falla, el resultado real no cambia pero el run acaba en rojo",
      fn: async () => {
        const h = harness(queuedApproval());
        const spy = executorSpy("applied");
        const result = await runProductionApply({
          approvalId: change().changeId,
          store: h.store,
          executorDeps: h.wordpress.deps,
          guards: GUARDS_OK,
          githubRunId: RUN_ID,
          now: () => NOW,
          log: (line) => h.logs.push(line),
          notify: async () => {
            throw new Error("Telegram caido");
          },
          applyToProduction: spy.apply,
        });

        assert.equal(result.exitCode, 1);
        assert.equal(h.store.current()?.status, "production_applied", "lo que paso de verdad se persiste igual");
        assert.match(h.logs.join("\n"), /no se pudo notificar/i);
      },
    },
  ];
}
