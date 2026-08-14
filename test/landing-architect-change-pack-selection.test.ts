import * as assert from "node:assert/strict";
import { filterEligibleChangePacksForComparison, selectRandomEligibleChangePack } from "../src/core/landing-architect-change-pack-selection";
import { ChangePack, ChangePackStatus } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

function makeChangePack(id: string, status: ChangePackStatus): ChangePack {
  return {
    changePackId: id,
    workOrderId: `wo-${id}`,
    actionId: `action-${id}`,
    canonicalKey: `key-${id}`,
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    keyword: `keyword ${id}`,
    changeType: "seo_on_page_update",
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

export function runLandingArchitectChangePackSelectionTests(): TestCase[] {
  return [
    {
      name: "filterEligibleChangePacksForComparison solo incluye ready_for_review y approved_to_execute",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute"), makeChangePack("c", "rejected"), makeChangePack("d", "superseded")];
        const eligible = filterEligibleChangePacksForComparison(packs);
        assert.deepEqual(
          eligible.map((p) => p.changePackId),
          ["a", "b"]
        );
      },
    },
    {
      name: "selectRandomEligibleChangePack devuelve undefined si no hay ninguno elegible",
      fn: () => {
        const packs = [makeChangePack("a", "rejected"), makeChangePack("b", "superseded")];
        assert.equal(selectRandomEligibleChangePack(packs), undefined);
      },
    },
    {
      name: "selectRandomEligibleChangePack con randomFn=0 devuelve el primer elegible",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute"), makeChangePack("c", "ready_for_review")];
        const result = selectRandomEligibleChangePack(packs, () => 0);
        assert.equal(result?.changePackId, "a");
      },
    },
    {
      name: "selectRandomEligibleChangePack con randomFn cercano a 1 devuelve el ultimo elegible",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute"), makeChangePack("c", "ready_for_review")];
        const result = selectRandomEligibleChangePack(packs, () => 0.999999);
        assert.equal(result?.changePackId, "c");
      },
    },
    {
      name: "selectRandomEligibleChangePack se blinda ante un randomFn que devuelva exactamente 1 (fuera de rango)",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute")];
        const result = selectRandomEligibleChangePack(packs, () => 1);
        assert.equal(result?.changePackId, "b");
      },
    },
    {
      name: "selectRandomEligibleChangePack ignora change packs no elegibles al elegir indice",
      fn: () => {
        const packs = [makeChangePack("rejected-1", "rejected"), makeChangePack("only-eligible", "ready_for_review"), makeChangePack("superseded-1", "superseded")];
        const result = selectRandomEligibleChangePack(packs, () => 0.5);
        assert.equal(result?.changePackId, "only-eligible");
      },
    },
  ];
}
