import * as assert from "node:assert/strict";
import {
  extractAndParseSemRunnerResult,
  extractLastSemRunnerResultJsonLine,
  parseSemRunnerResultJson,
} from "../src/employees/sem-specialist/sem-specialist-runner-result-parser";

export interface TestCase {
  name: string;
  fn: () => void;
}

function validResultJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "pending_execution",
    sourceEventId: "evt-1",
    sourceDepartmentRunId: "growth-department-2026-08-14T111247Z",
    promptFilePath: "reports/sem-specialist/2026-08-15/sem-specialist-prompt.md",
    expectedOutputPath: "reports/sem-specialist/2026-08-15/sem-specialist-output.json",
    artifactJsonPath: "reports/sem-specialist/2026-08-15/sem-specialist-result.json",
    artifactMdPath: "reports/sem-specialist/2026-08-15/sem-specialist-result.md",
    unsupportedClaimCount: null,
    ...overrides,
  });
}

export function runSemSpecialistRunnerResultParserTests(): TestCase[] {
  return [
    {
      name: "extractLastSemRunnerResultJsonLine encuentra la linea entre ruido de npm/ts-node",
      fn: () => {
        const log = ["> zentry-ai-department@0.1.0 sem-specialist:run", "> ts-node scripts/run-sem-specialist.ts", "", "sem-specialist: prompt preparado.", `RUNNER_RESULT_JSON=${validResultJson()}`, ""].join("\n");
        const line = extractLastSemRunnerResultJsonLine(log);
        assert.equal(line, validResultJson());
      },
    },
    {
      name: "extractLastSemRunnerResultJsonLine devuelve undefined si no hay ninguna linea",
      fn: () => {
        assert.equal(extractLastSemRunnerResultJsonLine("solo ruido de npm, sin resultado\n"), undefined);
      },
    },
    {
      name: "extractLastSemRunnerResultJsonLine usa la ULTIMA coincidencia si aparece mas de una",
      fn: () => {
        const log = [`RUNNER_RESULT_JSON=${validResultJson({ sourceEventId: "evt-viejo" })}`, "ruido intermedio", `RUNNER_RESULT_JSON=${validResultJson({ sourceEventId: "evt-nuevo" })}`].join("\n");
        const line = extractLastSemRunnerResultJsonLine(log);
        assert.ok(line);
        assert.equal(JSON.parse(line!).sourceEventId, "evt-nuevo");
      },
    },
    {
      name: "parseSemRunnerResultJson acepta un RUNNER_RESULT_JSON valido con unsupportedClaimCount null",
      fn: () => {
        const result = parseSemRunnerResultJson(validResultJson());
        assert.equal(result.status, "pending_execution");
        assert.equal(result.unsupportedClaimCount, null);
      },
    },
    {
      name: "parseSemRunnerResultJson acepta status no_data con campos de ruta vacios",
      fn: () => {
        const result = parseSemRunnerResultJson(
          validResultJson({ status: "no_data", sourceEventId: "", sourceDepartmentRunId: "", promptFilePath: "", expectedOutputPath: "", unsupportedClaimCount: null })
        );
        assert.equal(result.status, "no_data");
        assert.equal(result.sourceEventId, "");
      },
    },
    {
      name: "parseSemRunnerResultJson acepta unsupportedClaimCount numerico (estados executed/invalid_output)",
      fn: () => {
        const result = parseSemRunnerResultJson(validResultJson({ status: "invalid_output", unsupportedClaimCount: 2 }));
        assert.equal(result.unsupportedClaimCount, 2);
      },
    },
    {
      name: "parseSemRunnerResultJson (fail-closed) lanza con texto que no es JSON",
      fn: () => {
        assert.throws(() => parseSemRunnerResultJson("esto no es JSON"), /JSON valido/);
      },
    },
    {
      name: "parseSemRunnerResultJson (fail-closed) lanza si falta un campo string requerido",
      fn: () => {
        const broken = JSON.stringify({ status: "pending_execution", sourceEventId: "evt-1" });
        assert.throws(() => parseSemRunnerResultJson(broken), /sourceDepartmentRunId/);
      },
    },
    {
      name: "parseSemRunnerResultJson (fail-closed) lanza si status no es uno de los 4 valores esperados",
      fn: () => {
        assert.throws(() => parseSemRunnerResultJson(validResultJson({ status: "algo_inventado" })), /status/);
      },
    },
    {
      name: "parseSemRunnerResultJson (fail-closed) lanza si unsupportedClaimCount no es number ni null",
      fn: () => {
        assert.throws(() => parseSemRunnerResultJson(validResultJson({ unsupportedClaimCount: "2" })), /unsupportedClaimCount/);
      },
    },
    {
      name: "extractAndParseSemRunnerResult combina extraccion + parseo sobre un log completo realista",
      fn: () => {
        const log = ["npm WARN algo", `RUNNER_RESULT_JSON=${validResultJson({ status: "executed", unsupportedClaimCount: 0 })}`].join("\n");
        const result = extractAndParseSemRunnerResult(log);
        assert.equal(result.status, "executed");
        assert.equal(result.unsupportedClaimCount, 0);
      },
    },
    {
      name: "extractAndParseSemRunnerResult (fail-closed) lanza si el log no contiene ninguna linea RUNNER_RESULT_JSON",
      fn: () => {
        assert.throws(() => extractAndParseSemRunnerResult("build ok, sin resultado del runner"), /RUNNER_RESULT_JSON=/);
      },
    },
  ];
}
