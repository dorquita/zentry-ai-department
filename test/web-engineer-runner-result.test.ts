import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  buildWebEngineerRunnerResultSummary,
  buildWebEngineerSpecArtifact,
  extractAndParseWebEngineerRunnerResult,
  extractLastWebEngineerRunnerResultJsonLine,
  parseWebEngineerRunnerResultJson,
  renderWebEngineerSpecMarkdown,
  WebEngineerResult,
  WebEngineerSpecArtifact,
} from "../src/employees/web-engineer/runner-result";
import { extractCapabilityAuditWarnings } from "../src/employees/web-engineer/spec-artifact-reader";
import { WebEngineerContext, NO_PLUGIN_THEME_API_INVENTORY_NOTICE } from "../src/employees/web-engineer/context";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(): WebEngineerContext {
  return {
    changePackId: "cp-1",
    keyword: "keyword de ejemplo",
    changeType: "cro_conversion_update",
    priority: "medium",
    status: "approved_to_execute",
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    proposedChangesFromChangePack: {},
    implementationSteps: [],
    humanReviewChecklist: [],
    risks: [],
    rollbackNotes: [],
    currentAssumptions: [],
    confirmedExistingPageUrls: [],
    noPluginThemeApiInventoryNotice: NO_PLUGIN_THEME_API_INVENTORY_NOTICE,
  };
}

const PATHS = { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/web-engineer-output.json", specJsonPath: "/tmp/x/spec.json", specMdPath: "/tmp/x/spec.md" };

function baseOutput() {
  return {
    implementationSummary: "Resumen.",
    targetPages: [],
    targetComponents: [],
    proposedChanges: [],
    filesOrSystemsAffected: [],
    acceptanceCriteria: [],
    validationPlan: [],
    rollbackPlan: [],
    dependencies: [],
    risks: [],
    approvalRequired: true as const,
    unknowns: [],
  };
}

export function runWebEngineerRunnerResultTests(): TestCase[] {
  return [
    // --- buildWebEngineerRunnerResultSummary: contrato RUNNER_RESULT_JSON (estructura fija en los 3 estados) ---
    {
      name: "buildWebEngineerRunnerResultSummary incluye promptFilePath y expectedOutputPath en pending_execution",
      fn: () => {
        const result: WebEngineerResult = { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" };
        const summary = buildWebEngineerRunnerResultSummary("cp-1", "keyword de ejemplo", PATHS, result);
        assert.equal(summary.changePackId, "cp-1");
        assert.equal(summary.status, "pending_execution");
        assert.equal(summary.promptFilePath, "/tmp/x/prompt.md");
        assert.equal(summary.capabilityAuditWarningCount, null);
      },
    },
    {
      name: "buildWebEngineerRunnerResultSummary reporta capabilityAuditWarningCount solo en executed",
      fn: () => {
        const executed: WebEngineerResult = { status: "executed", output: baseOutput(), capabilityAuditWarnings: ["w1", "w2", "w3"] };
        const summaryExecuted = buildWebEngineerRunnerResultSummary("cp-1", "kw", PATHS, executed);
        assert.equal(summaryExecuted.capabilityAuditWarningCount, 3);

        const invalid: WebEngineerResult = { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/raw.json" };
        const summaryInvalid = buildWebEngineerRunnerResultSummary("cp-1", "kw", PATHS, invalid);
        assert.equal(summaryInvalid.capabilityAuditWarningCount, null);
      },
    },
    {
      name: "buildWebEngineerRunnerResultSummary mantiene la misma forma de objeto (mismas claves) en los 3 estados",
      fn: () => {
        const results: WebEngineerResult[] = [
          { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" },
          { status: "executed", output: baseOutput(), capabilityAuditWarnings: [] },
          { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/raw.json" },
        ];
        const keySets = results.map((r) => Object.keys(buildWebEngineerRunnerResultSummary("cp-1", "kw", PATHS, r)).sort());
        assert.deepEqual(keySets[0], keySets[1]);
        assert.deepEqual(keySets[1], keySets[2]);
      },
    },

    // --- extractLastWebEngineerRunnerResultJsonLine / parseWebEngineerRunnerResultJson ---
    {
      name: "extractLastWebEngineerRunnerResultJsonLine devuelve undefined si no hay ninguna linea",
      fn: () => {
        assert.equal(extractLastWebEngineerRunnerResultJsonLine("solo ruido\nmas ruido"), undefined);
      },
    },
    {
      name: "extractLastWebEngineerRunnerResultJsonLine devuelve la ULTIMA coincidencia, no la primera",
      fn: () => {
        const log = ['ruido', 'RUNNER_RESULT_JSON={"changePackId":"primero"}', "mas ruido", 'RUNNER_RESULT_JSON={"changePackId":"ultimo"}'].join("\n");
        const jsonText = extractLastWebEngineerRunnerResultJsonLine(log);
        assert.equal(JSON.parse(jsonText!).changePackId, "ultimo");
      },
    },
    {
      name: "parseWebEngineerRunnerResultJson lanza con JSON invalido",
      fn: () => {
        assert.throws(() => parseWebEngineerRunnerResultJson("{not json"), /no es JSON valido/);
      },
    },
    {
      name: "parseWebEngineerRunnerResultJson lanza si falta un campo string requerido",
      fn: () => {
        const summary = buildWebEngineerRunnerResultSummary("cp-1", "kw", PATHS, { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" });
        const partial: Record<string, unknown> = { ...summary };
        delete partial.specJsonPath;
        assert.throws(() => parseWebEngineerRunnerResultJson(JSON.stringify(partial)), /specJsonPath/);
      },
    },
    {
      name: "parseWebEngineerRunnerResultJson lanza si status no es uno de los 3 valores esperados",
      fn: () => {
        const summary = buildWebEngineerRunnerResultSummary("cp-1", "kw", PATHS, { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" });
        const bad = { ...summary, status: "not_a_real_status" };
        assert.throws(() => parseWebEngineerRunnerResultJson(JSON.stringify(bad)), /status/);
      },
    },
    {
      name: "parseWebEngineerRunnerResultJson lanza si capabilityAuditWarningCount no es number ni null",
      fn: () => {
        const summary = buildWebEngineerRunnerResultSummary("cp-1", "kw", PATHS, { status: "executed", output: baseOutput(), capabilityAuditWarnings: [] });
        const bad = { ...summary, capabilityAuditWarningCount: "3" };
        assert.throws(() => parseWebEngineerRunnerResultJson(JSON.stringify(bad)), /capabilityAuditWarningCount/);
      },
    },
    {
      name: "extractAndParseWebEngineerRunnerResult combina extraccion + parseo de un log completo",
      fn: () => {
        const summary = buildWebEngineerRunnerResultSummary("cp-1", "kw", PATHS, { status: "executed", output: baseOutput(), capabilityAuditWarnings: ["w1"] });
        const log = `algo de ruido de npm\nRUNNER_RESULT_JSON=${JSON.stringify(summary)}\n`;
        const parsed = extractAndParseWebEngineerRunnerResult(log);
        assert.equal(parsed.changePackId, "cp-1");
        assert.equal(parsed.status, "executed");
        assert.equal(parsed.capabilityAuditWarningCount, 1);
      },
    },
    {
      name: "extractAndParseWebEngineerRunnerResult lanza si no hay ninguna linea RUNNER_RESULT_JSON",
      fn: () => {
        assert.throws(() => extractAndParseWebEngineerRunnerResult("solo ruido, sin ninguna linea relevante"), /No se encontro ninguna linea/);
      },
    },

    // --- renderWebEngineerSpecMarkdown: smoke test contra el fixture sanitizado ---
    {
      name: "el fixture sanitizado test/fixtures/web-engineer-spec-example.json se renderiza sin lanzar y contiene las secciones esperadas",
      fn: () => {
        const fixturePath = path.join(__dirname, "fixtures", "web-engineer-spec-example.json");
        const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as WebEngineerSpecArtifact;

        const markdown = renderWebEngineerSpecMarkdown(artifact);

        assert.match(markdown, /## Input/);
        assert.match(markdown, /## Especificacion tecnica/);
        assert.match(markdown, /### proposedChanges/);
        assert.match(markdown, /### acceptanceCriteria/);
        assert.match(markdown, /### validationPlan/);
        assert.match(markdown, /### rollbackPlan/);
        assert.match(markdown, /### dependencies/);
        assert.match(markdown, /### unknowns/);
        // El fixture no contiene ningun dato real del dataset de produccion.
        assert.doesNotMatch(markdown, /zentrylockers\.com/);
      },
    },
    {
      name: "buildWebEngineerSpecArtifact produce un objeto con approvalRequired=true visible en su output cuando el resultado es executed",
      fn: () => {
        const context = baseContext();
        const result: WebEngineerResult = { status: "executed", output: baseOutput(), capabilityAuditWarnings: [] };
        const artifact = buildWebEngineerSpecArtifact(context, result);
        assert.equal(artifact.result.status, "executed");
        if (artifact.result.status === "executed") {
          assert.equal(artifact.result.output.approvalRequired, true);
        }
      },
    },

    // --- extractCapabilityAuditWarnings ---
    {
      name: "extractCapabilityAuditWarnings devuelve [] para un artefacto con result.status distinto de executed",
      fn: () => {
        const artifact = { result: { status: "pending_execution" } };
        assert.deepEqual(extractCapabilityAuditWarnings(artifact), []);
      },
    },
    {
      name: "extractCapabilityAuditWarnings devuelve [] para un artefacto malformado (nunca lanza)",
      fn: () => {
        assert.deepEqual(extractCapabilityAuditWarnings(null), []);
        assert.deepEqual(extractCapabilityAuditWarnings("no es un objeto"), []);
        assert.deepEqual(extractCapabilityAuditWarnings({}), []);
      },
    },
    {
      name: "extractCapabilityAuditWarnings extrae los warnings reales de un artefacto executed",
      fn: () => {
        const artifact = { result: { status: "executed", capabilityAuditWarnings: ["w1", "w2"] } };
        assert.deepEqual(extractCapabilityAuditWarnings(artifact), ["w1", "w2"]);
      },
    },
  ];
}
