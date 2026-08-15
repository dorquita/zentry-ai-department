import * as assert from "node:assert/strict";
import {
  ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY,
  ELIGIBLE_STATUSES_FOR_CONTENT_STRATEGY,
  filterEligibleChangePacksForContentStrategy,
  isContentChangePack,
  selectRandomEligibleChangePackForContentStrategy,
} from "../src/employees/content-strategist/selection";
import { readCurrentChangePacks } from "../src/core/change-packs";
import { ChangePack, ChangePackStatus } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

function makeChangePack(id: string, status: ChangePackStatus, changeType: string): ChangePack {
  return {
    changePackId: id,
    workOrderId: `wo-${id}`,
    actionId: `action-${id}`,
    canonicalKey: `key-${id}`,
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    keyword: `keyword ${id}`,
    changeType,
    priority: "medium",
    status,
    proposedChanges: {},
    currentAssumptions: [],
    implementationSteps: [],
    humanReviewChecklist: [],
    risks: [],
    rollbackNotes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

export function runContentStrategistSelectionTests(): TestCase[] {
  return [
    {
      name: "isContentChangePack acepta new_content_page y content_update, rechaza otros changeType",
      fn: () => {
        assert.equal(isContentChangePack(makeChangePack("a", "ready_for_review", "new_content_page")), true);
        assert.equal(isContentChangePack(makeChangePack("b", "ready_for_review", "content_update")), true);
        assert.equal(isContentChangePack(makeChangePack("c", "ready_for_review", "seo_on_page_update")), false);
        assert.equal(isContentChangePack(makeChangePack("d", "ready_for_review", "cro_conversion_update")), false);
      },
    },
    {
      name: "filterEligibleChangePacksForContentStrategy solo incluye changeType de contenido en status ready_for_review/approved_to_execute",
      fn: () => {
        const packs = [
          makeChangePack("a", "ready_for_review", "new_content_page"),
          makeChangePack("b", "approved_to_execute", "content_update"),
          makeChangePack("c", "rejected", "content_update"),
          makeChangePack("d", "ready_for_review", "seo_on_page_update"),
          makeChangePack("e", "superseded", "new_content_page"),
        ];
        const eligible = filterEligibleChangePacksForContentStrategy(packs);
        assert.deepEqual(
          eligible.map((p) => p.changePackId),
          ["a", "b"]
        );
      },
    },
    {
      name: "ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY y ELIGIBLE_STATUSES_FOR_CONTENT_STRATEGY tienen los valores documentados",
      fn: () => {
        assert.deepEqual(ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY, ["new_content_page", "content_update"]);
        assert.deepEqual(ELIGIBLE_STATUSES_FOR_CONTENT_STRATEGY, ["ready_for_review", "approved_to_execute"]);
      },
    },
    {
      name: "selectRandomEligibleChangePackForContentStrategy devuelve undefined si no hay ninguno elegible (sin trabajo -> no_eligible_work, nunca fabricar)",
      fn: () => {
        const packs = [makeChangePack("a", "rejected", "content_update"), makeChangePack("b", "ready_for_review", "seo_on_page_update")];
        assert.equal(selectRandomEligibleChangePackForContentStrategy(packs), undefined);
      },
    },
    {
      name: "selectRandomEligibleChangePackForContentStrategy con randomFn=0 devuelve el primer elegible",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review", "new_content_page"), makeChangePack("b", "approved_to_execute", "content_update"), makeChangePack("c", "ready_for_review", "content_update")];
        const result = selectRandomEligibleChangePackForContentStrategy(packs, () => 0);
        assert.equal(result?.changePackId, "a");
      },
    },
    {
      name: "selectRandomEligibleChangePackForContentStrategy con randomFn cercano a 1 devuelve el ultimo elegible",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review", "new_content_page"), makeChangePack("b", "approved_to_execute", "content_update"), makeChangePack("c", "ready_for_review", "content_update")];
        const result = selectRandomEligibleChangePackForContentStrategy(packs, () => 0.999999);
        assert.equal(result?.changePackId, "c");
      },
    },
    {
      name: "selectRandomEligibleChangePackForContentStrategy se blinda ante randomFn que devuelva exactamente 1 (fuera de rango)",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review", "new_content_page"), makeChangePack("b", "approved_to_execute", "content_update")];
        const result = selectRandomEligibleChangePackForContentStrategy(packs, () => 1);
        assert.equal(result?.changePackId, "b");
      },
    },
    // --- Sanity contra el dataset REAL del repo (data/change-packs.jsonl esta committeado, ver
    // docs/claude-employee-runtime.md) -- no debe lanzar y debe respetar el filtro documentado. ---
    {
      name: "REAL DATA: filterEligibleChangePacksForContentStrategy sobre data/change-packs.jsonl no lanza y solo devuelve changeType/status elegibles",
      fn: () => {
        const current = readCurrentChangePacks();
        const eligible = filterEligibleChangePacksForContentStrategy(current);
        for (const cp of eligible) {
          assert.ok(ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY.includes(cp.changeType), `changeType inesperado: ${cp.changeType}`);
          assert.ok(ELIGIBLE_STATUSES_FOR_CONTENT_STRATEGY.includes(cp.status), `status inesperado: ${cp.status}`);
        }
      },
    },
  ];
}
