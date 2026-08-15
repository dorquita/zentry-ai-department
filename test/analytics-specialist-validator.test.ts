import * as assert from "node:assert/strict";
import { validateAnalyticsSpecialistOutput } from "../src/employees/analytics-specialist/validator";

export interface TestCase {
  name: string;
  fn: () => void;
}

function validOutput(): Record<string, unknown> {
  return {
    runSummary: { departmentRunId: "run-1", reportGeneratedAt: "2026-08-10T09:00:00.000Z", ga4Connected: true, gtmConnected: true },
    measurementFindings: [{ claimType: "FACT", statement: "x", evidenceIds: [] }],
    funnelObservations: [],
    trafficObservations: [],
    conversionObservations: [],
    trackingIssues: [],
    anomalyCandidates: [],
    hypotheses: [{ claimType: "HYPOTHESIS", statement: "podria deberse a x", evidenceIds: [] }],
    recommendedMeasurements: [{ claimType: "RECOMMENDATION", statement: "medir x", evidenceIds: [] }],
    prioritizedActions: [{ claimType: "RECOMMENDATION", statement: "hacer x", evidenceIds: [], priority: "medium" }],
    evidence: [{ id: "ev1", source: "ga4_channel_traffic", description: "x" }],
    unknowns: ["no se sabe y"],
  };
}

/**
 * Cobertura fail-closed dedicada de validateAnalyticsSpecialistOutput()
 * (mas alla de la deriva schema/TypeScript que ya cubre
 * test/analytics-specialist-output-schema.test.ts): entradas
 * estructuralmente rotas que un JSON Schema draft-07 tambien rechazaria,
 * pero probadas aqui directamente contra el validador hand-rolled --
 * mismo principio fail-closed que validateV2Output() en
 * src/core/landing-architect-comparison.ts.
 */
export function runAnalyticsSpecialistValidatorTests(): TestCase[] {
  return [
    {
      name: "acepta una salida valida completa sin lanzar",
      fn: () => {
        assert.doesNotThrow(() => validateAnalyticsSpecialistOutput(validOutput()));
      },
    },
    {
      name: "rechaza null",
      fn: () => {
        assert.throws(() => validateAnalyticsSpecialistOutput(null), /se esperaba un objeto JSON/);
      },
    },
    {
      name: "rechaza un array en vez de un objeto",
      fn: () => {
        assert.throws(() => validateAnalyticsSpecialistOutput([]), /se esperaba un objeto JSON/);
      },
    },
    {
      name: "rechaza un string",
      fn: () => {
        assert.throws(() => validateAnalyticsSpecialistOutput("no es un objeto"), /se esperaba un objeto JSON/);
      },
    },
    {
      name: "rechaza runSummary ausente",
      fn: () => {
        const output = validOutput();
        delete output.runSummary;
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /runSummary/);
      },
    },
    {
      name: "rechaza un claimType fuera del enum en un Finding",
      fn: () => {
        const output = validOutput();
        output.measurementFindings = [{ claimType: "MAYBE", statement: "x", evidenceIds: [] }];
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /claimType/);
      },
    },
    {
      name: "rechaza evidenceIds que no es un array de strings",
      fn: () => {
        const output = validOutput();
        output.measurementFindings = [{ claimType: "FACT", statement: "x", evidenceIds: "no-es-array" }];
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /evidenceIds/);
      },
    },
    {
      name: "rechaza prioritizedActions sin priority",
      fn: () => {
        const output = validOutput();
        output.prioritizedActions = [{ claimType: "RECOMMENDATION", statement: "x", evidenceIds: [] }];
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /priority/);
      },
    },
    {
      name: "rechaza prioritizedActions con priority fuera del enum",
      fn: () => {
        const output = validOutput();
        output.prioritizedActions = [{ claimType: "RECOMMENDATION", statement: "x", evidenceIds: [], priority: "asap" }];
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /priority/);
      },
    },
    {
      name: "rechaza evidence con source fuera del catalogo conocido",
      fn: () => {
        const output = validOutput();
        output.evidence = [{ id: "ev1", source: "search_console_pages", description: "x" }];
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /source/);
      },
    },
    {
      name: "rechaza unknowns que no es string[]",
      fn: () => {
        const output = validOutput();
        output.unknowns = [42];
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /unknowns/);
      },
    },
    {
      name: "rechaza measurementFindings que no es un array",
      fn: () => {
        const output = validOutput();
        output.measurementFindings = { not: "an array" };
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /measurementFindings/);
      },
    },
    {
      name: "nunca lanza al aceptar arrays vacios en todas las categorias (una pasada sin hallazgos sigue siendo valida)",
      fn: () => {
        const output = validOutput();
        output.measurementFindings = [];
        output.hypotheses = [];
        output.recommendedMeasurements = [];
        output.prioritizedActions = [];
        output.evidence = [];
        assert.doesNotThrow(() => validateAnalyticsSpecialistOutput(output));
      },
    },
  ];
}
