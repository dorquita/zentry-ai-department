import * as assert from "node:assert/strict";
import { EnvironmentApplyRecord, HumanDecisionRecord, TelegramApprovalRecord } from "../src/department/apply/change-types";
import { checkProductionApplyGuards } from "../src/department/apply/guards";
import { applyApprovedChangeToProduction, ProductionExecutorDeps, ProductionPageState } from "../src/department/apply/production-executor";
import { computeVersionHash } from "../src/department/apply/version";
import { change, memoryPort, MemoryPort, NEW_META, NEW_TITLE, NOW, stagingPage, STAGING_URL } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const GUARDS_OK = {
  departmentProductionApplyEnabled: true,
  productionExecutionEnabled: true,
  productionWritesEnabled: true,
  productionBackend: "rest",
};

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
    snapshot: {
      takenAt: NOW.toISOString(),
      environment: "staging",
      wordpressPageId: 2091,
      previousStatus: "publish",
      previousTitle: "Titulo antiguo",
      previousMetaDescription: "Meta antigua",
      previousContentHash: "hash",
      previousVersionHash: "prev",
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
    resultingVersionHash: APPROVED_HASH,
  };
}

function telegramRecord(): TelegramApprovalRecord {
  return {
    telegramApprovalId: "req-1",
    telegramMessageId: 4242,
    chatId: "123",
    sentAt: NOW.toISOString(),
    stagingVersionHash: APPROVED_HASH,
  };
}

function humanDecision(): HumanDecisionRecord {
  return { decision: "approved", decidedBy: "telegram:123", decidedAt: NOW.toISOString(), rejectionReason: "", channel: "telegram" };
}

function approvedChange(overrides = {}) {
  return change({
    status: "approved",
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

interface Harness {
  prod: ProductionPageState;
  writes: number;
  deps: ProductionExecutorDeps;
  port: MemoryPort;
}

function harness(
  options: {
    staging?: ReturnType<typeof stagingPage>;
    production?: ProductionPageState;
    candidates?: { id: number; slug: string; status: string }[];
    ignoreApply?: boolean;
    failWrite?: boolean;
    failRollback?: boolean;
  } = {}
): Harness {
  const state = { prod: options.production ?? productionPage(), writes: 0 };
  const staging = options.staging ?? STAGING_AFTER;
  const original = { title: state.prod.title, excerpt: state.prod.excerpt };
  const port = memoryPort();
  return {
    get prod() {
      return state.prod;
    },
    get writes() {
      return state.writes;
    },
    port,
    deps: {
      getStagingPage: async () => ({ ...staging }),
      findProductionPagesBySlug: async (slug) => options.candidates ?? [{ id: state.prod.id, slug, status: state.prod.status }],
      getProductionPage: async () => ({ ...state.prod }),
      updateProductionPublishedPage: async (input) => {
        const isRollback = input.title === original.title;
        if (options.failWrite && !isRollback) throw new Error("403 produccion");
        if (options.failRollback && isRollback) throw new Error("500 revirtiendo produccion");
        state.writes += 1;
        if (options.ignoreApply && !isRollback) return;
        state.prod = { ...state.prod, title: input.title, excerpt: input.excerpt };
      },
    },
  };
}

export function runDepartmentApplyProductionTests(): TestCase[] {
  return [
    // --- La regla central ---
    {
      name: "SIN aprobacion humana no hay produccion: un cambio en staging_applied no escribe nada",
      fn: async () => {
        const h = harness();
        const result = await applyApprovedChangeToProduction(change({ status: "staging_applied", staging: stagingRecord() }), h.deps, GUARDS_OK, h.port);
        assert.equal(h.writes, 0);
        assert.equal(result.externalWritePerformed, false);
        assert.match(result.message, /solo se llega desde "approved"/i);
      },
    },
    {
      name: 'Estado "approved" sin decision humana registrada -> blocked (incoherencia, fail-closed)',
      fn: async () => {
        const h = harness();
        const result = await applyApprovedChangeToProduction(approvedChange({ humanDecision: null }), h.deps, GUARDS_OK, h.port);
        assert.equal(result.change.status, "blocked");
        assert.equal(h.writes, 0);
      },
    },
    {
      name: "Aprobacion valida -> publica en produccion, valida releyendo y reporta la URL real",
      fn: async () => {
        const h = harness();
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "production_applied");
        assert.equal(result.externalWritePerformed, true);
        assert.equal(h.prod.title, NEW_TITLE);
        assert.equal(h.prod.excerpt, NEW_META);
        assert.equal(result.change.production?.validationStatus, "passed");
        assert.match(result.message, /CAMBIO PUBLICADO/);
        assert.match(result.message, /zentrylockers\.com/);
        // Snapshot previo REAL de produccion.
        assert.equal(result.change.production?.snapshot?.previousTitle, "Titulo antiguo produccion");
      },
    },
    {
      name: "TOCTOU: si staging cambio desde el mensaje -> approval_stale y NO se publica nada",
      fn: async () => {
        const h = harness({ staging: stagingPage({ title: "Otro title puesto a mano", excerpt: NEW_META }) });
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "approval_stale");
        assert.equal(h.writes, 0);
        assert.match(result.message, /staging ha cambiado/i);
        assert.match(result.message, /aprobacion nueva/i);
      },
    },
    {
      name: "Si no se puede releer staging, no se publica: fail-closed, nunca se asume que sigue igual",
      fn: async () => {
        const h = harness();
        h.deps.getStagingPage = async () => {
          throw new Error("staging caido");
        };
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);
        assert.equal(result.change.status, "blocked");
        assert.equal(h.writes, 0);
      },
    },
    {
      name: "Interruptores de produccion apagados -> la aprobacion se conserva, pero no se escribe nada",
      fn: async () => {
        for (const guards of [
          { ...GUARDS_OK, departmentProductionApplyEnabled: false },
          { ...GUARDS_OK, productionExecutionEnabled: false },
          { ...GUARDS_OK, productionWritesEnabled: false },
          { ...GUARDS_OK, productionBackend: "local_preview" },
        ]) {
          const h = harness();
          const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, guards, h.port);
          assert.equal(h.writes, 0);
          assert.equal(result.change.status, "approved", "la aprobacion no se pierde por un interruptor apagado");
          assert.equal(checkProductionApplyGuards(guards).allowed, false);
        }
      },
    },
    {
      name: "Destino ambiguo en produccion (0 o varias coincidencias exactas de slug) -> blocked, nunca se adivina",
      fn: async () => {
        const none = harness({ candidates: [] });
        const r1 = await applyApprovedChangeToProduction(approvedChange(), none.deps, GUARDS_OK, none.port);
        assert.equal(r1.change.status, "blocked");
        assert.equal(none.writes, 0);

        const many = harness({
          candidates: [
            { id: 900, slug: "taquillas-melamina", status: "publish" },
            { id: 901, slug: "taquillas-melamina", status: "publish" },
          ],
        });
        const r2 = await applyApprovedChangeToProduction(approvedChange(), many.deps, GUARDS_OK, many.port);
        assert.equal(r2.change.status, "blocked");
        assert.equal(many.writes, 0);
        assert.match(r2.message, /UN destino/i);
      },
    },
    {
      name: "Una coincidencia de slug PARCIAL no cuenta: solo el slug exacto y publicado es destino valido",
      fn: async () => {
        const h = harness({ candidates: [{ id: 900, slug: "taquillas-melamina-2", status: "publish" }] });
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);
        assert.equal(result.change.status, "blocked");
        assert.equal(h.writes, 0);
      },
    },
    {
      name: "Una pagina de produccion que no esta publicada nunca se toca",
      fn: async () => {
        const h = harness({ production: productionPage({ status: "draft" }), candidates: [{ id: 900, slug: "taquillas-melamina", status: "publish" }] });
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);
        assert.equal(result.change.status, "blocked");
        assert.equal(h.writes, 0);
      },
    },
    {
      name: "Validacion de produccion fallida -> ROLLBACK verificado y mensaje que NO esconde el fallo",
      fn: async () => {
        const h = harness({ ignoreApply: true });
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "production_rolled_back");
        assert.equal(result.change.production?.validationStatus, "failed");
        assert.equal(result.change.production?.rollbackStatus, "rolled_back");
        assert.equal(h.prod.title, "Titulo antiguo produccion", "produccion vuelve a su estado previo");
        assert.match(result.message, /PUBLICACION FALLIDA/);
        assert.match(result.message, /Rollback ejecutado correctamente/i);
      },
    },
    {
      name: "Rollback de produccion fallido -> blocked CRITICO con aviso de intervencion humana inmediata",
      fn: async () => {
        const h = harness({ ignoreApply: true, failRollback: true });
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "blocked");
        assert.equal(result.change.production?.rollbackStatus, "rollback_failed");
        assert.match(result.message, /PUBLICACION FALLIDA/);
        assert.match(result.message, /INTERVENCION HUMANA INMEDIATA/i);
      },
    },
    {
      name: "Un fallo de escritura en produccion tambien dispara rollback y nunca queda como aplicado",
      fn: async () => {
        const h = harness({ failWrite: true });
        const result = await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);
        assert.notEqual(result.change.status, "production_applied");
        assert.equal(result.change.production?.validationStatus, "failed");
      },
    },
    {
      name: "Sin staging validado no se publica nada, aunque el estado diga approved",
      fn: async () => {
        const h = harness();
        const result = await applyApprovedChangeToProduction(approvedChange({ staging: { ...stagingRecord(), validationStatus: "failed" } }), h.deps, GUARDS_OK, h.port);
        assert.equal(result.change.status, "blocked");
        assert.equal(h.writes, 0);
      },
    },
    {
      name: "Un cambio aprobado que no modifica nada NO se publica: no se escribe una publicacion vacia",
      fn: async () => {
        const h = harness();
        const noop = approvedChange({
          staging: {
            ...stagingRecord(),
            changedFields: [
              { field: "title", before: NEW_TITLE, after: NEW_TITLE, changed: false },
              { field: "meta description", before: NEW_META, after: NEW_META, changed: false },
            ],
          },
        });
        const result = await applyApprovedChangeToProduction(noop, h.deps, GUARDS_OK, h.port);
        assert.equal(result.change.status, "blocked");
        assert.equal(h.writes, 0);
        assert.match(result.message, /no modifica ningun campo/i);
      },
    },
    {
      name: "Se publica EXACTAMENTE lo aprobado (lo que se enseño en Telegram), no lo que haya en staging ahora",
      fn: async () => {
        const h = harness();
        await applyApprovedChangeToProduction(approvedChange(), h.deps, GUARDS_OK, h.port);
        assert.equal(h.prod.title, NEW_TITLE);
        assert.equal(h.prod.excerpt, NEW_META);
        assert.equal(h.prod.contentHtml, "<p>Produccion</p>", "el cuerpo de produccion nunca se sustituye por el de staging");
      },
    },
  ];
}
