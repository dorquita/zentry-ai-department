import * as assert from "node:assert/strict";
import {
  AnalyticsSpecialistResult,
  buildAnalyticsSpecialistRunnerResultSummary,
  extractAndParseAnalyticsSpecialistRunnerResult,
  extractLastAnalyticsSpecialistRunnerResultJsonLine,
  parseAnalyticsSpecialistRunnerResultJson,
} from "../src/employees/analytics-specialist/runner-result";

export interface TestCase {
  name: string;
  fn: () => void;
}

const paths = { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/output.json", artifactJsonPath: "/tmp/x/artifact.json", artifactMdPath: "/tmp/x/artifact.md" };

export function runAnalyticsSpecialistRunnerResultTests(): TestCase[] {
  return [
    {
      name: "buildAnalyticsSpecialistRunnerResultSummary: no_analytics_data deja las rutas en null y expone reason",
      fn: () => {
        const result: AnalyticsSpecialistResult = { status: "no_analytics_data", reason: "sin eventos" };
        const summary = buildAnalyticsSpecialistRunnerResultSummary(paths, result);
        assert.equal(summary.status, "no_analytics_data");
        assert.equal(summary.reason, "sin eventos");
        assert.equal(summary.departmentRunId, null);
        assert.equal(summary.promptFilePath, null);
        assert.equal(summary.expectedOutputPath, null);
        assert.equal(summary.artifactJsonPath, null);
        assert.equal(summary.artifactMdPath, null);
        assert.equal(summary.auditWarningCount, null);
      },
    },
    {
      name: "buildAnalyticsSpecialistRunnerResultSummary: pending_execution incluye promptFilePath",
      fn: () => {
        const result: AnalyticsSpecialistResult = { status: "pending_execution", promptFilePath: paths.promptFilePath, departmentRunId: "run-1" };
        const summary = buildAnalyticsSpecialistRunnerResultSummary(paths, result);
        assert.equal(summary.status, "pending_execution");
        assert.equal(summary.departmentRunId, "run-1");
        assert.equal(summary.promptFilePath, paths.promptFilePath);
        assert.equal(summary.auditWarningCount, null);
        assert.equal(summary.reason, null);
      },
    },
    {
      name: "buildAnalyticsSpecialistRunnerResultSummary: auditWarningCount solo se rellena en executed",
      fn: () => {
        const executed: AnalyticsSpecialistResult = { status: "executed", output: {} as never, auditWarnings: ["w1", "w2", "w3"], departmentRunId: "run-1" };
        const summary = buildAnalyticsSpecialistRunnerResultSummary(paths, executed);
        assert.equal(summary.auditWarningCount, 3);

        const invalid: AnalyticsSpecialistResult = { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/raw.json", departmentRunId: "run-1" };
        const summaryInvalid = buildAnalyticsSpecialistRunnerResultSummary(paths, invalid);
        assert.equal(summaryInvalid.auditWarningCount, null);
      },
    },
    {
      name: "buildAnalyticsSpecialistRunnerResultSummary mantiene la misma forma de objeto (mismas claves) en los 4 estados",
      fn: () => {
        const results: AnalyticsSpecialistResult[] = [
          { status: "no_analytics_data", reason: "x" },
          { status: "pending_execution", promptFilePath: paths.promptFilePath, departmentRunId: "run-1" },
          { status: "executed", output: {} as never, auditWarnings: [], departmentRunId: "run-1" },
          { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/raw.json", departmentRunId: "run-1" },
        ];
        const keySets = results.map((r) => Object.keys(buildAnalyticsSpecialistRunnerResultSummary(paths, r)).sort());
        for (let i = 1; i < keySets.length; i++) assert.deepEqual(keySets[0], keySets[i]);
      },
    },
    {
      name: "extractLastAnalyticsSpecialistRunnerResultJsonLine usa la ULTIMA linea, ignora ruido antes/despues",
      fn: () => {
        const log = ['npm ruido previo', "RUNNER_RESULT_JSON=" + JSON.stringify({ status: "pending_execution" }), "algo mas", "RUNNER_RESULT_JSON=" + JSON.stringify({ status: "executed" })].join("\n");
        const jsonText = extractLastAnalyticsSpecialistRunnerResultJsonLine(log);
        assert.equal(JSON.parse(jsonText as string).status, "executed");
      },
    },
    {
      name: "extractLastAnalyticsSpecialistRunnerResultJsonLine devuelve undefined si no hay ninguna linea",
      fn: () => {
        assert.equal(extractLastAnalyticsSpecialistRunnerResultJsonLine("solo ruido, sin la linea esperada"), undefined);
      },
    },
    {
      name: "parseAnalyticsSpecialistRunnerResultJson: fail-closed ante JSON invalido",
      fn: () => {
        assert.throws(() => parseAnalyticsSpecialistRunnerResultJson("{ esto no es json"), /no es JSON valido/);
      },
    },
    {
      name: "parseAnalyticsSpecialistRunnerResultJson: fail-closed ante un status fuera de los 4 esperados",
      fn: () => {
        const json = JSON.stringify({ status: "algo_raro", departmentRunId: null, reason: null, promptFilePath: null, expectedOutputPath: null, artifactJsonPath: null, artifactMdPath: null, auditWarningCount: null });
        assert.throws(() => parseAnalyticsSpecialistRunnerResultJson(json), /no es uno de los estados esperados/);
      },
    },
    {
      name: "extractAndParseAnalyticsSpecialistRunnerResult: combina ambas funciones sobre un log realista",
      fn: () => {
        const summary = buildAnalyticsSpecialistRunnerResultSummary(paths, { status: "pending_execution", promptFilePath: paths.promptFilePath, departmentRunId: "run-1" });
        const log = ["> analytics-specialist:run", "algunas lineas de log", "RUNNER_RESULT_JSON=" + JSON.stringify(summary)].join("\n");
        const parsed = extractAndParseAnalyticsSpecialistRunnerResult(log);
        assert.equal(parsed.status, "pending_execution");
        assert.equal(parsed.departmentRunId, "run-1");
      },
    },
  ];
}
