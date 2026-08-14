import * as assert from "node:assert/strict";
import { extractAndParseRunnerResult, extractLastRunnerResultJsonLine, parseRunnerResultJson } from "../src/core/runner-result-parser";

export interface TestCase {
  name: string;
  fn: () => void;
}

function validResultJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    changePackId: "cp-1",
    keyword: "taquillas melamina",
    v2Status: "pending_execution",
    promptFilePath: "reports/ux-ui-landing-comparison/cp-1/v2-prompt.md",
    expectedV2OutputPath: "reports/ux-ui-landing-comparison/cp-1/v2-output.json",
    comparisonJsonPath: "reports/ux-ui-landing-comparison/cp-1/comparison.json",
    comparisonMdPath: "reports/ux-ui-landing-comparison/cp-1/comparison.md",
    fabricationWarningCount: null,
    ...overrides,
  });
}

export function runRunnerResultParserTests(): TestCase[] {
  return [
    {
      name: "extractLastRunnerResultJsonLine encuentra la linea entre ruido de npm/ts-node",
      fn: () => {
        const log = ["> zentry-ai-department@0.1.0 landing-architect:compare", "> ts-node scripts/run-landing-architect-comparison.ts", "", "V2: prompt preparado en /tmp/x/v2-prompt.md.", `RUNNER_RESULT_JSON=${validResultJson()}`, ""].join("\n");
        const line = extractLastRunnerResultJsonLine(log);
        assert.equal(line, validResultJson());
      },
    },
    {
      name: "extractLastRunnerResultJsonLine devuelve undefined si no hay ninguna linea",
      fn: () => {
        const line = extractLastRunnerResultJsonLine("solo ruido de npm, sin resultado\n");
        assert.equal(line, undefined);
      },
    },
    {
      name: "extractLastRunnerResultJsonLine usa la ULTIMA coincidencia si aparece mas de una",
      fn: () => {
        const log = [`RUNNER_RESULT_JSON=${validResultJson({ changePackId: "cp-viejo" })}`, "ruido intermedio", `RUNNER_RESULT_JSON=${validResultJson({ changePackId: "cp-nuevo" })}`].join("\n");
        const line = extractLastRunnerResultJsonLine(log);
        assert.ok(line);
        assert.equal(JSON.parse(line!).changePackId, "cp-nuevo");
      },
    },
    {
      name: "parseRunnerResultJson acepta un RUNNER_RESULT_JSON valido con fabricationWarningCount null",
      fn: () => {
        const result = parseRunnerResultJson(validResultJson());
        assert.equal(result.changePackId, "cp-1");
        assert.equal(result.v2Status, "pending_execution");
        assert.equal(result.fabricationWarningCount, null);
      },
    },
    {
      name: "parseRunnerResultJson acepta fabricationWarningCount numerico (estado executed)",
      fn: () => {
        const result = parseRunnerResultJson(validResultJson({ v2Status: "executed", fabricationWarningCount: 3 }));
        assert.equal(result.fabricationWarningCount, 3);
      },
    },
    {
      name: "parseRunnerResultJson (fail-closed) lanza con texto que no es JSON",
      fn: () => {
        assert.throws(() => parseRunnerResultJson("esto no es JSON"), /JSON valido/);
      },
    },
    {
      name: "parseRunnerResultJson (fail-closed) lanza si falta un campo string requerido",
      fn: () => {
        const broken = JSON.stringify({ changePackId: "cp-1", keyword: "kw", v2Status: "pending_execution" });
        assert.throws(() => parseRunnerResultJson(broken), /promptFilePath/);
      },
    },
    {
      name: "parseRunnerResultJson (fail-closed) lanza si v2Status no es uno de los 3 valores esperados",
      fn: () => {
        assert.throws(() => parseRunnerResultJson(validResultJson({ v2Status: "algo_inventado" })), /v2Status/);
      },
    },
    {
      name: "parseRunnerResultJson (fail-closed) lanza si fabricationWarningCount no es number ni null",
      fn: () => {
        assert.throws(() => parseRunnerResultJson(validResultJson({ fabricationWarningCount: "3" })), /fabricationWarningCount/);
      },
    },
    {
      name: "extractAndParseRunnerResult combina extraccion + parseo sobre un log completo realista",
      fn: () => {
        const log = ["npm WARN algo", `RUNNER_RESULT_JSON=${validResultJson({ v2Status: "executed", fabricationWarningCount: 0 })}`].join("\n");
        const result = extractAndParseRunnerResult(log);
        assert.equal(result.v2Status, "executed");
        assert.equal(result.fabricationWarningCount, 0);
      },
    },
    {
      name: "extractAndParseRunnerResult (fail-closed) lanza si el log no contiene ninguna linea RUNNER_RESULT_JSON",
      fn: () => {
        assert.throws(() => extractAndParseRunnerResult("build ok, sin resultado del runner"), /RUNNER_RESULT_JSON=/);
      },
    },
  ];
}
