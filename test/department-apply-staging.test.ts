import * as assert from "node:assert/strict";
import { checkStagingApplyGuards } from "../src/department/apply/guards";
import { applyChangeToStaging, StagingMetaUpdateTarget } from "../src/department/apply/staging-executor";
import { computeVersionHash } from "../src/department/apply/version";
import { change, FakeStagingPage, memoryPort, MemoryPort, NEW_META, NEW_TITLE, stagingPage, STAGING_URL } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const GUARDS_OK = { stagingApplyEnabled: true, wordpressWritesEnabled: true, wordpressBackend: "rest", wordpressEnv: "staging" };
const TARGET: StagingMetaUpdateTarget = { wordpressPageId: 2091, newTitle: NEW_TITLE, newMetaDescription: NEW_META };

interface Harness {
  page: FakeStagingPage;
  writes: { pageId: number; title: string; excerpt: string; contentHtml: string }[];
  deps: Parameters<typeof applyChangeToStaging>[2];
  port: MemoryPort;
}

/**
 * WordPress falso. `behaviour` permite simular los fallos reales que
 * importan: que ignore la escritura (validacion fallida), que reviente al
 * escribir, o que reviente tambien al revertir.
 */
function harness(
  initial: Partial<FakeStagingPage> = {},
  behaviour: { ignoreApply?: boolean; failWrite?: boolean; failRollback?: boolean; failRead?: boolean } = {}
): Harness {
  const state = { page: stagingPage(initial) };
  const writes: Harness["writes"] = [];
  const port = memoryPort();
  return {
    get page() {
      return state.page;
    },
    writes,
    port,
    deps: {
      getPage: async () => {
        if (behaviour.failRead) throw new Error("WordPress no responde");
        return { ...state.page };
      },
      updatePublishedPage: async (input) => {
        const isRollback = input.title === stagingPage(initial).title;
        if (behaviour.failWrite && !isRollback) throw new Error("403 desde WordPress");
        if (behaviour.failRollback && isRollback) throw new Error("500 revirtiendo");
        writes.push({ pageId: input.pageId, title: input.title, excerpt: input.excerpt, contentHtml: input.contentHtml });
        if (behaviour.ignoreApply && !isRollback) return;
        state.page = { ...state.page, title: input.title, excerpt: input.excerpt, contentHtml: input.contentHtml };
      },
    },
  };
}

export function runDepartmentApplyStagingTests(): TestCase[] {
  return [
    {
      name: "Cambio soportado -> se aplica en STAGING, con snapshot previo y validacion correcta",
      fn: async () => {
        const h = harness();
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "staging_applied");
        assert.equal(result.externalWritePerformed, true);
        assert.equal(result.change.staging?.validationStatus, "passed");
        assert.equal(result.change.staging?.rollbackStatus, "not_needed");
        // Snapshot ANTES de escribir, con los valores REALES previos.
        assert.equal(result.change.staging?.snapshot?.previousTitle, "Titulo antiguo");
        assert.equal(result.change.staging?.snapshot?.previousMetaDescription, "Meta antigua");
        assert.equal(result.change.staging?.snapshot?.previousStatus, "publish");
        // El snapshot se persiste antes que la escritura.
        const events = h.port.snapshots.map((s) => s.auditTrail[s.auditTrail.length - 1].event);
        assert.ok(events.indexOf("staging_snapshot_taken") < events.indexOf("staging_applied"), `orden inesperado: ${events.join(", ")}`);
        assert.equal(h.port.refused.length, 0, "ninguna transicion deberia ser rechazada en el flujo feliz");
      },
    },
    {
      name: "NO se usa ningun borrador: la pagina queda PUBLICADA y con URL revisable",
      fn: async () => {
        const h = harness();
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);

        assert.equal(h.page.status, "publish", "el executor nunca cambia el status de la pagina");
        assert.equal(result.change.staging?.url, STAGING_URL);
        assert.match(String(result.change.staging?.url), /^https:\/\//, "la URL de revision es una URL normal, abrible desde el movil");
        // Ninguna escritura intenta poner la pagina en draft.
        for (const write of h.writes) assert.ok(!("status" in write), "el executor solo manda title/contenido/excerpt");
      },
    },
    {
      name: "Una pagina en borrador se BLOQUEA con el motivo exacto: no es revisable, asi que no es aprobable",
      fn: async () => {
        const h = harness({ status: "draft" });
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "blocked");
        assert.equal(result.externalWritePerformed, false);
        assert.equal(h.writes.length, 0, "no se escribe NADA sobre un borrador");
        assert.match(result.change.auditTrail[result.change.auditTrail.length - 1].detail, /NO usa borradores/i);
      },
    },
    {
      name: "El cuerpo de la pagina no se toca: se reenvia el HTML leido tal cual",
      fn: async () => {
        const h = harness();
        await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);
        assert.equal(h.writes.length, 1);
        assert.equal(h.writes[0].contentHtml, "<p>Contenido de la pagina</p>");
        assert.equal(h.page.contentHtml, "<p>Contenido de la pagina</p>");
      },
    },
    {
      name: "Validacion fallida -> ROLLBACK verificado al snapshot",
      fn: async () => {
        const h = harness({}, { ignoreApply: true });
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "staging_rolled_back");
        assert.equal(result.change.staging?.validationStatus, "failed");
        assert.equal(result.change.staging?.rollbackStatus, "rolled_back");
        assert.equal(h.page.title, "Titulo antiguo", "la pagina vuelve al estado previo");
        assert.equal(h.page.excerpt, "Meta antigua");
        assert.match(String(result.change.staging?.rollbackDetail), /verificado/i);
      },
    },
    {
      name: "Si el rollback falla -> blocked CRITICO, y se dice que requiere una persona",
      fn: async () => {
        const h = harness({}, { ignoreApply: true, failRollback: true });
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "blocked");
        assert.equal(result.change.staging?.rollbackStatus, "rollback_failed");
        assert.match(result.change.auditTrail[result.change.auditTrail.length - 1].detail, /CRITICO/);
        assert.match(result.change.auditTrail[result.change.auditTrail.length - 1].detail, /intervencion humana/i);
      },
    },
    {
      name: "Un fallo de escritura no se esconde: intenta rollback y nunca queda como aplicado",
      fn: async () => {
        const h = harness({}, { failWrite: true });
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);

        assert.notEqual(result.change.status, "staging_applied");
        assert.equal(result.change.status, "staging_rolled_back");
        assert.equal(result.change.staging?.validationStatus, "failed");
      },
    },
    {
      name: "Sin snapshot no se escribe nada: si no se puede leer la pagina, queda blocked",
      fn: async () => {
        const h = harness({}, { failRead: true });
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);

        assert.equal(result.change.status, "blocked");
        assert.equal(h.writes.length, 0);
        assert.equal(result.externalWritePerformed, false);
      },
    },
    {
      name: "Interruptores apagados -> no se intenta nada y el cambio sigue proposed con el motivo",
      fn: async () => {
        for (const guards of [
          { ...GUARDS_OK, stagingApplyEnabled: false },
          { ...GUARDS_OK, wordpressWritesEnabled: false },
          { ...GUARDS_OK, wordpressBackend: "local_preview" },
          { ...GUARDS_OK, wordpressEnv: "production" },
        ]) {
          const h = harness();
          const result = await applyChangeToStaging(change(), TARGET, h.deps, guards, h.port);
          assert.equal(result.change.status, "proposed", `los interruptores ${JSON.stringify(guards)} no deberian permitir escribir`);
          assert.equal(h.writes.length, 0);
          assert.equal(result.externalWritePerformed, false);
          assert.equal(checkStagingApplyGuards(guards).allowed, false);
        }
      },
    },
    {
      name: "WORDPRESS_ENV=production nunca permite este apply, ni con el resto de interruptores puestos",
      fn: () => {
        const check = checkStagingApplyGuards({ ...GUARDS_OK, wordpressEnv: "production" });
        assert.equal(check.allowed, false);
        assert.match(check.reason, /SOLO escribe en staging/i);
      },
    },
    {
      name: "PRODUCCION no se toca en ningun caso: el executor de staging no tiene ninguna dependencia de produccion",
      fn: async () => {
        const h = harness();
        await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);
        // Las unicas dependencias inyectadas son de staging, y el cambio
        // no adquiere ningun registro de produccion al aplicarse.
        assert.deepEqual(Object.keys(h.deps).sort(), ["getPage", "updatePublishedPage"]);
        assert.equal(h.port.snapshots.every((s) => s.production === null), true);
      },
    },
    {
      name: "La version resultante se calcula releyendo staging y sirve de identidad anti-TOCTOU",
      fn: async () => {
        const h = harness();
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);
        const expected = computeVersionHash({
          status: h.page.status,
          title: h.page.title,
          metaDescription: h.page.excerpt,
          contentHtml: h.page.contentHtml,
        });
        assert.equal(result.change.staging?.resultingVersionHash, expected);
      },
    },
    {
      name: "changedFields refleja el before/after REAL, y declara explicitamente lo que no cambia",
      fn: async () => {
        const h = harness();
        const result = await applyChangeToStaging(change(), TARGET, h.deps, GUARDS_OK, h.port);
        const fields = result.change.staging?.changedFields ?? [];
        const title = fields.find((f) => f.field === "title");
        assert.equal(title?.before, "Titulo antiguo");
        assert.equal(title?.after, NEW_TITLE);
        assert.equal(title?.changed, true);
        assert.equal(fields.find((f) => f.field === "contenido (cuerpo)")?.changed, false);
      },
    },
    {
      name: "Un cambio que no esta en proposed no se vuelve a aplicar (idempotencia)",
      fn: async () => {
        const h = harness();
        const result = await applyChangeToStaging(change({ status: "awaiting_approval" }), TARGET, h.deps, GUARDS_OK, h.port);
        assert.equal(result.change.status, "awaiting_approval");
        assert.equal(h.writes.length, 0);
      },
    },
  ];
}
