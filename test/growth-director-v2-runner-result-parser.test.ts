import * as assert from "node:assert/strict";
import { extractAndParseRunnerResult, extractLastRunnerResultJsonLine, parseRunnerResultJson } from "../src/employees/growth-director-v2/runner-result-parser";

export interface TestCase {
  name: string;
  fn: () => void;
}

function validSummaryJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    departmentRunId: "growth-department-2026-08-15T000000Z",
    status: "pending_execution",
    promptFilePath: "/tmp/x/prompt.md",
    expectedOutputPath: "/tmp/x/output.json",
    artifactJsonPath: "/tmp/x/artifact.json",
    artifactMdPath: "/tmp/x/artifact.md",
    auditWarningCount: null,
    ...overrides,
  });
}

export function runGrowthDirectorV2RunnerResultParserTests(): TestCase[] {
  return [
    {
      name: "extractLastRunnerResultJsonLine devuelve undefined si no hay ninguna linea RUNNER_RESULT_JSON",
      fn: () => {
        assert.equal(extractLastRunnerResultJsonLine("npm run algo\nsin nada relevante\n"), undefined);
      },
    },
    {
      name: "extractLastRunnerResultJsonLine ignora ruido antes/despues y devuelve la ULTIMA coincidencia",
      fn: () => {
        const log = ["> some npm noise", `RUNNER_RESULT_JSON=${validSummaryJson({ status: "pending_execution" })}`, "algo mas de ruido", `RUNNER_RESULT_JSON=${validSummaryJson({ status: "executed" })}`].join("\n");
        const jsonText = extractLastRunnerResultJsonLine(log);
        assert.ok(jsonText);
        const parsed = JSON.parse(jsonText!);
        assert.equal(parsed.status, "executed");
      },
    },
    {
      name: "parseRunnerResultJson lanza con JSON invalido",
      fn: () => {
        assert.throws(() => parseRunnerResultJson("{not valid json"), /no es JSON valido/);
      },
    },
    {
      name: "parseRunnerResultJson lanza si falta un campo string requerido",
      fn: () => {
        const raw = JSON.parse(validSummaryJson());
        delete raw.artifactMdPath;
        assert.throws(() => parseRunnerResultJson(JSON.stringify(raw)), /artifactMdPath/);
      },
    },
    {
      name: "parseRunnerResultJson lanza si status no es uno de los 3 valores esperados",
      fn: () => {
        assert.throws(() => parseRunnerResultJson(validSummaryJson({ status: "something_else" })), /status/);
      },
    },
    {
      name: "parseRunnerResultJson lanza si auditWarningCount no es number ni null",
      fn: () => {
        assert.throws(() => parseRunnerResultJson(validSummaryJson({ auditWarningCount: "3" })), /auditWarningCount/);
      },
    },
    {
      name: "parseRunnerResultJson acepta auditWarningCount number valido",
      fn: () => {
        const parsed = parseRunnerResultJson(validSummaryJson({ status: "executed", auditWarningCount: 2 }));
        assert.equal(parsed.auditWarningCount, 2);
        assert.equal(parsed.status, "executed");
      },
    },
    {
      name: "extractAndParseRunnerResult combina extraccion + parseo sobre un log realista",
      fn: () => {
        const log = `growth-director-v2 -- departmentRunId: growth-department-2026-08-15T000000Z\ngrowth-director-v2: prompt preparado.\nRUNNER_RESULT_JSON=${validSummaryJson()}\n`;
        const result = extractAndParseRunnerResult(log);
        assert.equal(result.departmentRunId, "growth-department-2026-08-15T000000Z");
        assert.equal(result.status, "pending_execution");
      },
    },
    {
      name: "extractAndParseRunnerResult lanza si el log no contiene ninguna linea RUNNER_RESULT_JSON",
      fn: () => {
        assert.throws(() => extractAndParseRunnerResult("nada relevante aqui\n"), /No se encontro ninguna linea/);
      },
    },
  ];
}
