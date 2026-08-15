import * as assert from "node:assert/strict";
import { buildContentStrategistContext } from "../src/employees/content-strategist/context";
import { filterEligibleChangePacksForContentStrategy } from "../src/employees/content-strategist/selection";
import { readCurrentChangePacks } from "../src/core/change-packs";
import { ChangePack } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseChangePack(overrides: Partial<ChangePack> = {}): ChangePack {
  return {
    changePackId: "cp-1",
    workOrderId: "wo-1",
    actionId: "action-1",
    canonicalKey: "key-1",
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    page: "https://zentrylockers.com/taquillas-melamina/",
    keyword: "taquillas melamina",
    changeType: "content_update",
    priority: "medium",
    status: "approved_to_execute",
    proposedChanges: {
      contentType: "Mejora de title/meta",
      recommendedTitle: "Taquillas Melamina",
      primaryKeyword: "taquillas melamina",
      secondaryKeywords: ["taquillas de melamina", "taquillas colegios"],
      structure: ["H2: Que es taquillas melamina", "H2: Precios y presupuesto"],
      intent: "Zentry principal — mobiliario/taquillas/lockers",
      targetBrand: "Zentry principal — mobiliario/taquillas/lockers",
      brandRationale: "Menciona mobiliario/taquillas sin mencionar cerraduras.",
      recommendedCta: 'CTA: "Solicitar presupuesto sin compromiso"',
      internalLinks: ["Enlazar hacia la landing/categoria principal relacionada"],
      clusterNote: "Posible cluster SEO con: taquillas de melamina, taquillas colegios.",
    },
    currentAssumptions: ['Se asume que "taquillas melamina" sigue siendo relevante para zentry.'],
    implementationSteps: [],
    humanReviewChecklist: [],
    risks: ["Publicar contenido nuevo sin revisar el cluster SEO puede generar canibalizacion."],
    rollbackNotes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function runContentStrategistContextTests(): TestCase[] {
  return [
    {
      name: "buildContentStrategistContext extrae los campos del ChangePack tal cual",
      fn: () => {
        const context = buildContentStrategistContext(baseChangePack());
        assert.equal(context.changePackId, "cp-1");
        assert.equal(context.workOrderId, "wo-1");
        assert.equal(context.keyword, "taquillas melamina");
        assert.equal(context.page, "https://zentrylockers.com/taquillas-melamina/");
        assert.equal(context.changeType, "content_update");
        assert.equal(context.priority, "medium");
        assert.equal(context.status, "approved_to_execute");
        assert.equal(context.targetBrand, "zentry");
        assert.equal(context.brandIntent, "zentry_locker_core");
      },
    },
    {
      name: "buildContentStrategistContext lee proposedChanges.contentType/recommendedTitle/primaryKeyword/secondaryKeywords/structure/intent/brandRationale/recommendedCta/internalLinks/clusterNote",
      fn: () => {
        const context = buildContentStrategistContext(baseChangePack());
        assert.equal(context.contentTypeHint, "Mejora de title/meta");
        assert.equal(context.recommendedTitleHint, "Taquillas Melamina");
        assert.equal(context.primaryKeyword, "taquillas melamina");
        assert.deepEqual(context.secondaryKeywords, ["taquillas de melamina", "taquillas colegios"]);
        assert.deepEqual(context.proposedStructureHint, ["H2: Que es taquillas melamina", "H2: Precios y presupuesto"]);
        assert.equal(context.intentHint, "Zentry principal — mobiliario/taquillas/lockers");
        assert.equal(context.brandRationale, "Menciona mobiliario/taquillas sin mencionar cerraduras.");
        assert.equal(context.recommendedCtaHint, 'CTA: "Solicitar presupuesto sin compromiso"');
        assert.deepEqual(context.internalLinkHints, ["Enlazar hacia la landing/categoria principal relacionada"]);
        assert.equal(context.clusterNote, "Posible cluster SEO con: taquillas de melamina, taquillas colegios.");
      },
    },
    {
      name: "buildContentStrategistContext preserva currentAssumptions y risks tal cual (unica fuente de respaldo para la auditoria anti-fabricacion)",
      fn: () => {
        const context = buildContentStrategistContext(baseChangePack());
        assert.deepEqual(context.currentAssumptions, ['Se asume que "taquillas melamina" sigue siendo relevante para zentry.']);
        assert.deepEqual(context.risks, ["Publicar contenido nuevo sin revisar el cluster SEO puede generar canibalizacion."]);
      },
    },
    {
      name: "buildContentStrategistContext es defensivo: proposedChanges vacio o con tipos equivocados nunca lanza, degrada a valores por defecto",
      fn: () => {
        const cp = baseChangePack({ proposedChanges: { secondaryKeywords: "no es un array", structure: 42 } });
        assert.doesNotThrow(() => buildContentStrategistContext(cp));
        const context = buildContentStrategistContext(cp);
        assert.deepEqual(context.secondaryKeywords, []);
        assert.deepEqual(context.proposedStructureHint, []);
        // Sin recommendedTitle/primaryKeyword en proposedChanges -> cae al keyword del change pack.
        assert.equal(context.recommendedTitleHint, "taquillas melamina");
        assert.equal(context.primaryKeyword, "taquillas melamina");
      },
    },
    {
      name: "buildContentStrategistContext con proposedChanges completamente vacio no lanza y usa los fallbacks del propio change pack",
      fn: () => {
        const cp = baseChangePack({ proposedChanges: {} });
        const context = buildContentStrategistContext(cp);
        assert.equal(context.contentTypeHint, "content_update");
        assert.equal(context.recommendedTitleHint, "taquillas melamina");
        assert.equal(context.primaryKeyword, "taquillas melamina");
        assert.deepEqual(context.secondaryKeywords, []);
        assert.deepEqual(context.proposedStructureHint, []);
        assert.equal(context.intentHint, "");
        assert.equal(context.brandRationale, "");
        assert.equal(context.recommendedCtaHint, "");
        assert.deepEqual(context.internalLinkHints, []);
        assert.equal(context.clusterNote, "");
      },
    },
    {
      name: "buildContentStrategistContext preserva page ausente (undefined) sin inventar una URL",
      fn: () => {
        const cp = baseChangePack({ page: undefined });
        const context = buildContentStrategistContext(cp);
        assert.equal(context.page, undefined);
      },
    },
    // --- Sanity contra el dataset REAL del repo (data/change-packs.jsonl esta committeado). ---
    {
      name: "REAL DATA: buildContentStrategistContext no lanza para NINGUN change pack de contenido elegible real",
      fn: () => {
        const current = readCurrentChangePacks();
        const eligible = filterEligibleChangePacksForContentStrategy(current);
        for (const cp of eligible) {
          assert.doesNotThrow(() => buildContentStrategistContext(cp), `buildContentStrategistContext lanzo para el change pack real ${cp.changePackId}`);
        }
      },
    },
    {
      name: "REAL DATA: si hay al menos un change pack de contenido elegible real, su contexto tiene keyword no vacia y currentAssumptions es un array",
      fn: () => {
        const current = readCurrentChangePacks();
        const eligible = filterEligibleChangePacksForContentStrategy(current);
        if (eligible.length === 0) return; // el dataset real puede quedarse sin elegibles en el futuro -- no es un fallo del context builder.
        const context = buildContentStrategistContext(eligible[0]);
        assert.ok(context.keyword.length > 0);
        assert.ok(Array.isArray(context.currentAssumptions));
      },
    },
  ];
}
