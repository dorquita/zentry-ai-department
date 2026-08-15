import * as assert from "node:assert/strict";
import { filterEligibleChangePacksForWebEngineer, selectRandomEligibleChangePackForWebEngineer } from "../src/employees/web-engineer/change-pack-selection";
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
    changeType: "cro_conversion_update",
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

export function runWebEngineerChangePackSelectionTests(): TestCase[] {
  return [
    {
      name: "filterEligibleChangePacksForWebEngineer solo incluye ready_for_review y approved_to_execute",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute"), makeChangePack("c", "rejected"), makeChangePack("d", "superseded"), makeChangePack("e", "draft"), makeChangePack("f", "applied_manually")];
        const eligible = filterEligibleChangePacksForWebEngineer(packs);
        assert.deepEqual(
          eligible.map((p) => p.changePackId),
          ["a", "b"]
        );
      },
    },
    {
      name: "selectRandomEligibleChangePackForWebEngineer devuelve undefined si no hay ninguno elegible",
      fn: () => {
        const packs = [makeChangePack("a", "rejected"), makeChangePack("b", "superseded")];
        assert.equal(selectRandomEligibleChangePackForWebEngineer(packs), undefined);
      },
    },
    {
      name: "selectRandomEligibleChangePackForWebEngineer con randomFn=0 devuelve el primer elegible",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute"), makeChangePack("c", "ready_for_review")];
        const result = selectRandomEligibleChangePackForWebEngineer(packs, () => 0);
        assert.equal(result?.changePackId, "a");
      },
    },
    {
      name: "selectRandomEligibleChangePackForWebEngineer con randomFn cercano a 1 devuelve el ultimo elegible",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute"), makeChangePack("c", "ready_for_review")];
        const result = selectRandomEligibleChangePackForWebEngineer(packs, () => 0.999999);
        assert.equal(result?.changePackId, "c");
      },
    },
    {
      name: "selectRandomEligibleChangePackForWebEngineer se blinda ante un randomFn que devuelva exactamente 1 (fuera de rango)",
      fn: () => {
        const packs = [makeChangePack("a", "ready_for_review"), makeChangePack("b", "approved_to_execute")];
        const result = selectRandomEligibleChangePackForWebEngineer(packs, () => 1);
        assert.equal(result?.changePackId, "b");
      },
    },
    {
      name: "selectRandomEligibleChangePackForWebEngineer ignora change packs no elegibles al elegir indice",
      fn: () => {
        const packs = [makeChangePack("rejected-1", "rejected"), makeChangePack("only-eligible", "ready_for_review"), makeChangePack("superseded-1", "superseded")];
        const result = selectRandomEligibleChangePackForWebEngineer(packs, () => 0.5);
        assert.equal(result?.changePackId, "only-eligible");
      },
    },
  ];
}
