import * as assert from "node:assert/strict";
import {
  auditGrowthDirectorV2Output,
  buildRunnerResultSummary,
  GrowthDirectorV2Result,
  validateGrowthDirectorV2Output,
} from "../src/employees/growth-director-v2/domain";
import { GrowthDirectorV2Context } from "../src/employees/growth-director-v2/context";
import { GrowthDirectorV2Output } from "../src/employees/growth-director-v2/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(overrides: Partial<GrowthDirectorV2Context> = {}): GrowthDirectorV2Context {
  return {
    departmentRunId: "growth-department-2026-08-15T000000Z",
    hasDepartmentRunData: true,
    generatedAt: "2026-08-15T00:00:00.000Z",
    agentActivity: [],
    warnings: [],
    actionsSummary: { totalActions: 0, liveActionCount: 0, byStatus: {}, byPriority: {}, topOpenActions: [] },
    workOrdersSummary: { total: 0, readyForReviewCount: 0, byCategory: {}, byBrand: {} },
    changePacksSummary: { total: 0, readyForReviewCount: 0, byType: {} },
    approvalRequestsSummary: { pendingCount: 0, byRiskLevel: {}, topPending: [] },
    jobsSummary: { totalJobSnapshots: 0, latestRunId: null, latestRunJobCount: 0 },
    knownDependencies: [],
    evidenceCatalog: [{ ref: "actions-live", description: "0 acciones vivas en el backlog." }],
    ...overrides,
  };
}

function baseOutput(overrides: Partial<GrowthDirectorV2Output> = {}): GrowthDirectorV2Output {
  return {
    growthSummary: "Concentrar esfuerzo en SEO on-page mientras SEM/Analytics siguen sin conectar.",
    currentSignals: [],
    bottlenecks: [],
    opportunities: [],
    experiments: [],
    recommendedPriorities: [],
    dependencies: [],
    risks: [],
    evidence: [],
    unknowns: [],
    ...overrides,
  };
}

export function runGrowthDirectorV2DomainTests(): TestCase[] {
  return [
    // --- validateGrowthDirectorV2Output: fail-closed ---
    {
      name: "validateGrowthDirectorV2Output acepta una salida minima valida",
      fn: () => {
        assert.doesNotThrow(() => validateGrowthDirectorV2Output(baseOutput()));
      },
    },
    {
      name: "validateGrowthDirectorV2Output rechaza un valor que no es objeto",
      fn: () => {
        assert.throws(() => validateGrowthDirectorV2Output("not an object"), /se esperaba un objeto JSON/);
        assert.throws(() => validateGrowthDirectorV2Output(null), /se esperaba un objeto JSON/);
        assert.throws(() => validateGrowthDirectorV2Output(42), /se esperaba un objeto JSON/);
      },
    },
    {
      name: "validateGrowthDirectorV2Output rechaza si falta growthSummary",
      fn: () => {
        const raw = baseOutput() as unknown as Record<string, unknown>;
        delete raw.growthSummary;
        assert.throws(() => validateGrowthDirectorV2Output(raw), /growthSummary/);
      },
    },
    {
      name: "validateGrowthDirectorV2Output rechaza recommendedPriorities con impact invalido",
      fn: () => {
        const raw = baseOutput({
          recommendedPriorities: [
            {
              title: "Foo",
              rationale: "Bar",
              impact: "urgentisimo" as never,
              confidence: "high",
              effort: "low",
              dependsOn: [],
              evidenceRefs: ["actions-live"],
            },
          ],
        });
        assert.throws(() => validateGrowthDirectorV2Output(raw), /impact/);
      },
    },
    {
      name: "validateGrowthDirectorV2Output rechaza currentSignals con channel invalido",
      fn: () => {
        const raw = baseOutput({ currentSignals: [{ channel: "witchcraft" as never, description: "x", evidenceRefs: [] }] });
        assert.throws(() => validateGrowthDirectorV2Output(raw), /channel/);
      },
    },
    {
      name: "validateGrowthDirectorV2Output rechaza dependencies con status invalido",
      fn: () => {
        const raw = baseOutput({ dependencies: [{ name: "seo-specialist", status: "half-there" as never, note: "x" }] });
        assert.throws(() => validateGrowthDirectorV2Output(raw), /status/);
      },
    },
    {
      name: "validateGrowthDirectorV2Output rechaza evidence[] con ref no string",
      fn: () => {
        const raw = baseOutput({ evidence: [{ ref: 123 as never, description: "x" }] });
        assert.throws(() => validateGrowthDirectorV2Output(raw), /evidence\[0\]\.ref/);
      },
    },
    {
      name: "validateGrowthDirectorV2Output rechaza unknowns que no es string[]",
      fn: () => {
        const raw = { ...baseOutput(), unknowns: [1, 2, 3] };
        assert.throws(() => validateGrowthDirectorV2Output(raw), /unknowns/);
      },
    },

    // --- auditGrowthDirectorV2Output: regla central "no priority ranking without a stated reason" ---
    {
      name: "auditGrowthDirectorV2Output marca rationale vacio en recommendedPriorities",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          recommendedPriorities: [
            { title: "Prioridad sin razon", rationale: "   ", impact: "high", confidence: "high", effort: "low", dependsOn: [], evidenceRefs: ["actions-live"] },
          ],
        });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.ok(warnings.some((w) => /rationale vacio/.test(w)), `deberia avisar de rationale vacio: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "auditGrowthDirectorV2Output marca evidenceRefs vacio en recommendedPriorities",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          recommendedPriorities: [{ title: "Prioridad sin evidencia", rationale: "Impacto alto segun backlog.", impact: "high", confidence: "medium", effort: "low", dependsOn: [], evidenceRefs: [] }],
        });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.ok(warnings.some((w) => /evidenceRefs vacio/.test(w)), `deberia avisar de evidenceRefs vacio: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "auditGrowthDirectorV2Output NO marca nada para una prioridad con rationale y evidenceRefs validos resolubles",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          recommendedPriorities: [
            { title: "SEO on-page", rationale: "Hay acciones vivas sin trabajar.", impact: "high", confidence: "high", effort: "medium", dependsOn: [], evidenceRefs: ["actions-live"] },
          ],
        });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "auditGrowthDirectorV2Output marca un evidenceRef que no existe ni en el catalogo ni en evidence[] de la salida",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          currentSignals: [{ channel: "seo", description: "Senal inventada", evidenceRefs: ["ref-que-no-existe"] }],
        });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.ok(warnings.some((w) => /ref-que-no-existe/.test(w)), `deberia avisar de evidenceRef no resoluble: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "auditGrowthDirectorV2Output acepta un evidenceRef declarado por el propio evidence[] de la salida (no solo el catalogo del contexto)",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          currentSignals: [{ channel: "seo", description: "Cruce propio de datos", evidenceRefs: ["mi-evidencia-propia"] }],
          evidence: [{ ref: "mi-evidencia-propia", description: "Cruce entre actions-live y jobs-latest-run del contexto." }],
        });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.deepEqual(warnings, []);
      },
    },

    // --- auditGrowthDirectorV2Output: anti-fabricacion de dependencias ausentes ---
    {
      name: "auditGrowthDirectorV2Output marca una dependencia ausente conocida que la salida no reconoce",
      fn: () => {
        const context = baseContext({
          knownDependencies: [{ name: "seo-specialist", status: "missing", note: ".claude/agents/seo-specialist.md no existe todavia." }],
        });
        const output = baseOutput({ dependencies: [] });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.ok(warnings.some((w) => /seo-specialist/.test(w) && /no aparece declarada/.test(w)), `deberia avisar de dependencia sin reconocer: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "auditGrowthDirectorV2Output NO marca nada cuando la dependencia ausente SI aparece reconocida en dependencies[] de la salida",
      fn: () => {
        const context = baseContext({
          knownDependencies: [{ name: "seo-specialist", status: "missing", note: ".claude/agents/seo-specialist.md no existe todavia." }],
        });
        const output = baseOutput({
          dependencies: [{ name: "seo-specialist", status: "missing", note: "Todavia no existe en este checkout." }],
        });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "auditGrowthDirectorV2Output reconoce el matching tolerante a mayusculas/guiones/espacios entre el nombre de dependencia del contexto y el de la salida",
      fn: () => {
        const context = baseContext({
          knownDependencies: [{ name: "sem-watcher (V1 deterministico)", status: "missing", note: "Sin evento agent_finished." }],
        });
        const output = baseOutput({ dependencies: [{ name: "SEM Watcher", status: "partial", note: "Sin datos recientes de SEM." }] });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "auditGrowthDirectorV2Output NO cuenta como reconocida una dependencia marcada available en la salida (fail-closed: available no es un reconocimiento del hueco)",
      fn: () => {
        const context = baseContext({
          knownDependencies: [{ name: "seo-specialist", status: "missing", note: "No existe todavia." }],
        });
        const output = baseOutput({ dependencies: [{ name: "seo-specialist", status: "available", note: "Inventado -- no deberia contar." }] });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.ok(warnings.some((w) => /seo-specialist/.test(w)), `una dependencia marcada "available" sin serlo de verdad no debe contar como reconocimiento: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "auditGrowthDirectorV2Output marca growthSummary vacio",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ growthSummary: "   " });
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.ok(warnings.some((w) => /growthSummary vacio/.test(w)));
      },
    },
    {
      name: "auditGrowthDirectorV2Output con contexto sparse (sin knownDependencies, sin evidenceCatalog salvo lo minimo) y salida minima no lanza y no exige nada que no aplique",
      fn: () => {
        const context = baseContext({ knownDependencies: [], evidenceCatalog: [] });
        const output = baseOutput();
        assert.doesNotThrow(() => auditGrowthDirectorV2Output(context, output));
        const warnings = auditGrowthDirectorV2Output(context, output);
        assert.deepEqual(warnings, []);
      },
    },

    // --- buildRunnerResultSummary: contrato RUNNER_RESULT_JSON (estructura fija en los 3 estados) ---
    {
      name: "buildRunnerResultSummary incluye promptFilePath y expectedOutputPath en pending_execution",
      fn: () => {
        const result: GrowthDirectorV2Result = { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" };
        const summary = buildRunnerResultSummary(
          "growth-department-2026-08-15T000000Z",
          { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/output.json", artifactJsonPath: "/tmp/x/artifact.json", artifactMdPath: "/tmp/x/artifact.md" },
          result
        );
        assert.equal(summary.departmentRunId, "growth-department-2026-08-15T000000Z");
        assert.equal(summary.status, "pending_execution");
        assert.equal(summary.promptFilePath, "/tmp/x/prompt.md");
        assert.equal(summary.expectedOutputPath, "/tmp/x/output.json");
        assert.equal(summary.artifactJsonPath, "/tmp/x/artifact.json");
        assert.equal(summary.artifactMdPath, "/tmp/x/artifact.md");
        assert.equal(summary.auditWarningCount, null);
      },
    },
    {
      name: "buildRunnerResultSummary reporta auditWarningCount solo en executed",
      fn: () => {
        const paths = { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/output.json", artifactJsonPath: "/tmp/x/artifact.json", artifactMdPath: "/tmp/x/artifact.md" };
        const executed: GrowthDirectorV2Result = { status: "executed", output: baseOutput(), auditWarnings: ["w1", "w2", "w3"] };
        const summaryExecuted = buildRunnerResultSummary("run-1", paths, executed);
        assert.equal(summaryExecuted.auditWarningCount, 3);

        const invalid: GrowthDirectorV2Result = { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/output-raw-invalid.json" };
        const summaryInvalid = buildRunnerResultSummary("run-1", paths, invalid);
        assert.equal(summaryInvalid.auditWarningCount, null);
      },
    },
    {
      name: "buildRunnerResultSummary mantiene la misma forma de objeto (mismas claves) en los 3 estados",
      fn: () => {
        const paths = { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/output.json", artifactJsonPath: "/tmp/x/artifact.json", artifactMdPath: "/tmp/x/artifact.md" };
        const results: GrowthDirectorV2Result[] = [
          { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" },
          { status: "executed", output: baseOutput(), auditWarnings: [] },
          { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/output-raw-invalid.json" },
        ];
        const keySets = results.map((r) => Object.keys(buildRunnerResultSummary("run-1", paths, r)).sort());
        assert.deepEqual(keySets[0], keySets[1]);
        assert.deepEqual(keySets[1], keySets[2]);
      },
    },
  ];
}
