import * as assert from "node:assert/strict";
import { auditWebEngineerOutputForUnconfirmedCapabilities, validateWebEngineerOutput } from "../src/employees/web-engineer/validator";
import { WebEngineerContext, NO_PLUGIN_THEME_API_INVENTORY_NOTICE } from "../src/employees/web-engineer/context";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(overrides: Partial<WebEngineerContext> = {}): WebEngineerContext {
  return {
    changePackId: "test-change-pack",
    keyword: "taquillas de ejemplo",
    page: "https://example-client.test/taquillas-ejemplo/",
    changeType: "cro_conversion_update",
    priority: "medium",
    status: "approved_to_execute",
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    targetWordpressPageId: undefined,
    proposedChangesFromChangePack: {},
    implementationSteps: [],
    humanReviewChecklist: [],
    risks: [],
    rollbackNotes: [],
    currentAssumptions: [],
    existingPageAudit: undefined,
    stagingQaResult: undefined,
    confirmedExistingPageUrls: [],
    noPluginThemeApiInventoryNotice: NO_PLUGIN_THEME_API_INVENTORY_NOTICE,
    ...overrides,
  };
}

function baseOutput(overrides: Partial<WebEngineerOutput> = {}): WebEngineerOutput {
  return {
    implementationSummary: "Actualizar el CTA principal.",
    targetPages: [],
    targetComponents: ["hero"],
    proposedChanges: [{ description: "Mover el CTA.", rationale: "Mejora conversion.", targetPageOrComponent: "hero" }],
    filesOrSystemsAffected: [],
    acceptanceCriteria: [],
    validationPlan: [],
    rollbackPlan: [],
    dependencies: [],
    risks: [],
    approvalRequired: true,
    unknowns: [],
    ...overrides,
  };
}

export function runWebEngineerValidatorTests(): TestCase[] {
  return [
    // --- validateWebEngineerOutput: fail-closed estructural ---
    {
      name: "acepta una salida minima valida",
      fn: () => {
        assert.doesNotThrow(() => validateWebEngineerOutput(baseOutput()));
      },
    },
    {
      name: "rechaza null/no-objeto",
      fn: () => {
        assert.throws(() => validateWebEngineerOutput(null), /se esperaba un objeto/);
        assert.throws(() => validateWebEngineerOutput("string"), /se esperaba un objeto/);
      },
    },
    {
      name: "rechaza implementationSummary ausente",
      fn: () => {
        const output = baseOutput() as unknown as Record<string, unknown>;
        delete output.implementationSummary;
        assert.throws(() => validateWebEngineerOutput(output), /implementationSummary/);
      },
    },
    {
      name: "rechaza targetPages que no es string[]",
      fn: () => {
        const output = { ...baseOutput(), targetPages: [123] };
        assert.throws(() => validateWebEngineerOutput(output), /targetPages/);
      },
    },
    {
      name: "rechaza proposedChanges con forma incorrecta (falta rationale)",
      fn: () => {
        const output = { ...baseOutput(), proposedChanges: [{ description: "x", targetPageOrComponent: "hero" }] };
        assert.throws(() => validateWebEngineerOutput(output), /proposedChanges/);
      },
    },
    {
      name: "rechaza dependencies/risks/unknowns con tipo incorrecto",
      fn: () => {
        assert.throws(() => validateWebEngineerOutput({ ...baseOutput(), dependencies: "no es array" }), /dependencies/);
        assert.throws(() => validateWebEngineerOutput({ ...baseOutput(), risks: [1, 2] }), /risks/);
        assert.throws(() => validateWebEngineerOutput({ ...baseOutput(), unknowns: null }), /unknowns/);
      },
    },

    // --- Regla de negocio central: approvalRequired SIEMPRE true ---
    {
      name: "REGLA CENTRAL: rechaza approvalRequired: false, aunque el resto de la salida sea perfectamente valida",
      fn: () => {
        const output = { ...baseOutput(), approvalRequired: false };
        assert.throws(() => validateWebEngineerOutput(output), /approvalRequired debe ser SIEMPRE true/);
      },
    },
    {
      name: "rechaza approvalRequired ausente o de tipo incorrecto",
      fn: () => {
        const withoutField = baseOutput() as unknown as Record<string, unknown>;
        delete withoutField.approvalRequired;
        assert.throws(() => validateWebEngineerOutput(withoutField), /approvalRequired debe ser boolean/);
        assert.throws(() => validateWebEngineerOutput({ ...baseOutput(), approvalRequired: "true" }), /approvalRequired debe ser boolean/);
      },
    },

    // --- auditWebEngineerOutputForUnconfirmedCapabilities: plugin/tema ---
    {
      name: "plugin instalado afirmado con confianza, sin ningun respaldo posible en el contexto => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ filesOrSystemsAffected: ["El plugin de formularios ya esta instalado en el sitio."] });
        const warnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
        assert.ok(warnings.some((w) => /plugin/i.test(w)), `deberia haber warning de plugin, warnings: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "plugin mencionado pero con lenguaje de incertidumbre en la misma clausula => NO genera warning (ruta correcta: hedge en el propio texto)",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          dependencies: ["Confirmar con un humano si el plugin de formularios esta instalado antes de continuar (pendiente de confirmar)."],
        });
        const warnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
        assert.ok(!warnings.some((w) => /plugin/i.test(w)), `no deberia haber warning de plugin, warnings: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "dependencies/unknowns quedan EXCLUIDOS del escaneo de afirmaciones confiadas (aunque no usen lenguaje de incertidumbre explicito)",
      fn: () => {
        const context = baseContext();
        // Frase deliberadamente SIN hedge, colocada en unknowns/dependencies (el sitio correcto segun la mision del agente).
        const output = baseOutput({
          unknowns: ["El plugin de reservas esta instalado en el sitio."],
          dependencies: ["El tema actual tiene disponible un editor visual."],
        });
        const warnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
        assert.deepEqual(warnings, [], "dependencies/unknowns nunca deben generar warnings de esta auditoria");
      },
    },

    // --- auditWebEngineerOutputForUnconfirmedCapabilities: API/integracion ---
    {
      name: "API afirmada como disponible sin respaldo => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ risks: ["La API de reservas ya esta disponible para integrar el nuevo formulario."] });
        const warnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
        assert.ok(warnings.some((w) => /API/i.test(w)));
      },
    },

    // --- auditWebEngineerOutputForUnconfirmedCapabilities: existencia de pagina ---
    {
      name: "afirmar que una pagina ya existe SIN respaldo (confirmedExistingPageUrls vacio) => warning",
      fn: () => {
        const context = baseContext({ confirmedExistingPageUrls: [] });
        const output = baseOutput({ acceptanceCriteria: ["La pagina ya existe en produccion con la estructura actual."] });
        const warnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
        assert.ok(warnings.some((w) => /existencia de pagina/i.test(w)));
      },
    },
    {
      name: "afirmar que una pagina ya existe CON respaldo (confirmedExistingPageUrls no vacio) => sin warning",
      fn: () => {
        const context = baseContext({ confirmedExistingPageUrls: ["https://example-client.test/taquillas-ejemplo/"] });
        const output = baseOutput({ acceptanceCriteria: ["La pagina ya existe en produccion con la estructura actual."] });
        const warnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
        assert.ok(!warnings.some((w) => /existencia de pagina/i.test(w)));
      },
    },

    // --- Sanity: salida sin ninguna afirmacion de capacidad no genera ningun warning ---
    {
      name: "salida sin afirmaciones de capacidad tecnica no genera ningun warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          implementationSummary: "Actualizar el texto del CTA principal segun el ChangePack de origen.",
          acceptanceCriteria: ["El CTA es visible sin hacer scroll en movil."],
        });
        const warnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
        assert.deepEqual(warnings, []);
      },
    },
  ];
}
