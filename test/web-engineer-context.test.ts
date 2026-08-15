import * as assert from "node:assert/strict";
import { buildWebEngineerContext, NO_PLUGIN_THEME_API_INVENTORY_NOTICE } from "../src/employees/web-engineer/context";
import { ExistingPageAuditSnapshot } from "../src/core/existing-page-audit";
import { StagingQaResultSnapshot } from "../src/core/staging-qa-results";
import { ChangePack } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

function makeChangePack(overrides: Partial<ChangePack> = {}): ChangePack {
  return {
    changePackId: "cp-1",
    workOrderId: "wo-1",
    actionId: "action-1",
    canonicalKey: "key-1",
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    keyword: "taquillas de ejemplo",
    changeType: "cro_conversion_update",
    priority: "medium",
    status: "ready_for_review",
    proposedChanges: { newCta: "Solicitar presupuesto" },
    currentAssumptions: ["Se asume que la pagina sigue existiendo."],
    implementationSteps: ["Actualizar el CTA."],
    humanReviewChecklist: ["Confirmar antes de publicar."],
    risks: ["Bajo riesgo."],
    rollbackNotes: ["Guardar copia antes de aplicar."],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAudit(overrides: Partial<ExistingPageAuditSnapshot> = {}): ExistingPageAuditSnapshot {
  return {
    wordpressPageId: 100,
    keyword: "taquillas de ejemplo",
    matchType: "update_existing_page",
    productionPageId: 200,
    productionUrl: "https://example-client.test/taquillas-ejemplo/",
    confidence: "exact",
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeQaResult(overrides: Partial<StagingQaResultSnapshot> = {}): StagingQaResultSnapshot {
  return {
    executionId: "exec-1",
    keyword: "taquillas de ejemplo",
    changeType: "cro_conversion_update",
    wordpressPageId: 100,
    overallPass: true,
    hasWarnings: false,
    failures: [],
    warnings: [],
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function runWebEngineerContextTests(): TestCase[] {
  return [
    {
      name: "sin targetWordpressPageId: existingPageAudit y stagingQaResult ausentes, confirmedExistingPageUrls vacio",
      fn: () => {
        const changePack = makeChangePack({ targetWordpressPageId: undefined });
        const context = buildWebEngineerContext(changePack, [makeAudit()], [makeQaResult()]);
        assert.equal(context.existingPageAudit, undefined);
        assert.equal(context.stagingQaResult, undefined);
        assert.deepEqual(context.confirmedExistingPageUrls, []);
      },
    },
    {
      name: "targetWordpressPageId con match update_existing_page: existingPageAudit presente y su URL entra en confirmedExistingPageUrls",
      fn: () => {
        const changePack = makeChangePack({ targetWordpressPageId: 100 });
        const context = buildWebEngineerContext(changePack, [makeAudit({ wordpressPageId: 100, matchType: "update_existing_page", productionUrl: "https://example-client.test/pagina-real/" })], []);
        assert.ok(context.existingPageAudit);
        assert.equal(context.existingPageAudit!.matchType, "update_existing_page");
        assert.deepEqual(context.confirmedExistingPageUrls, ["https://example-client.test/pagina-real/"]);
      },
    },
    {
      name: "targetWordpressPageId con match new_page_candidate: existingPageAudit presente PERO confirmedExistingPageUrls sigue vacio (no hay URL real que confirmar)",
      fn: () => {
        const changePack = makeChangePack({ targetWordpressPageId: 101 });
        const context = buildWebEngineerContext(changePack, [makeAudit({ wordpressPageId: 101, matchType: "new_page_candidate", productionUrl: undefined, productionPageId: undefined })], []);
        assert.ok(context.existingPageAudit);
        assert.equal(context.existingPageAudit!.matchType, "new_page_candidate");
        assert.deepEqual(context.confirmedExistingPageUrls, [], "new_page_candidate nunca debe alimentar confirmedExistingPageUrls");
      },
    },
    {
      name: "targetWordpressPageId sin ningun registro de auditoria coincidente: existingPageAudit ausente (nunca se asume ni existencia ni novedad)",
      fn: () => {
        const changePack = makeChangePack({ targetWordpressPageId: 999 });
        const context = buildWebEngineerContext(changePack, [makeAudit({ wordpressPageId: 100 })], []);
        assert.equal(context.existingPageAudit, undefined);
        assert.deepEqual(context.confirmedExistingPageUrls, []);
      },
    },
    {
      name: "stagingQaResult: entre varios executionId que apuntan a la misma pagina, se elige el mas reciente por checkedAt",
      fn: () => {
        const changePack = makeChangePack({ targetWordpressPageId: 100 });
        const older = makeQaResult({ executionId: "exec-old", wordpressPageId: 100, overallPass: false, checkedAt: "2026-01-01T00:00:00.000Z" });
        const newer = makeQaResult({ executionId: "exec-new", wordpressPageId: 100, overallPass: true, checkedAt: "2026-02-01T00:00:00.000Z" });
        const context = buildWebEngineerContext(changePack, [], [older, newer]);
        assert.ok(context.stagingQaResult);
        assert.equal(context.stagingQaResult!.overallPass, true);
        assert.equal(context.stagingQaResult!.checkedAt, "2026-02-01T00:00:00.000Z");
      },
    },
    {
      name: "stagingQaResult: ignora resultados de otras paginas (wordpressPageId distinto)",
      fn: () => {
        const changePack = makeChangePack({ targetWordpressPageId: 100 });
        const context = buildWebEngineerContext(changePack, [], [makeQaResult({ wordpressPageId: 555 })]);
        assert.equal(context.stagingQaResult, undefined);
      },
    },
    {
      name: "copia tal cual proposedChanges/implementationSteps/humanReviewChecklist/risks/rollbackNotes/currentAssumptions del ChangePack",
      fn: () => {
        const changePack = makeChangePack({
          proposedChanges: { a: 1 },
          implementationSteps: ["paso 1"],
          humanReviewChecklist: ["check 1"],
          risks: ["riesgo 1"],
          rollbackNotes: ["nota 1"],
          currentAssumptions: ["supuesto 1"],
        });
        const context = buildWebEngineerContext(changePack, [], []);
        assert.deepEqual(context.proposedChangesFromChangePack, { a: 1 });
        assert.deepEqual(context.implementationSteps, ["paso 1"]);
        assert.deepEqual(context.humanReviewChecklist, ["check 1"]);
        assert.deepEqual(context.risks, ["riesgo 1"]);
        assert.deepEqual(context.rollbackNotes, ["nota 1"]);
        assert.deepEqual(context.currentAssumptions, ["supuesto 1"]);
      },
    },
    {
      name: "noPluginThemeApiInventoryNotice es siempre el texto fijo NO_PLUGIN_THEME_API_INVENTORY_NOTICE, nunca derivado de datos",
      fn: () => {
        const changePack = makeChangePack();
        const context = buildWebEngineerContext(changePack, [], []);
        assert.equal(context.noPluginThemeApiInventoryNotice, NO_PLUGIN_THEME_API_INVENTORY_NOTICE);
      },
    },
  ];
}
