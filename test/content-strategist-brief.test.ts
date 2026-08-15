import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { buildBriefArtifact, buildRunnerResultSummary, ContentStrategistBriefArtifact, ContentStrategistResult, renderBriefMarkdown } from "../src/employees/content-strategist/brief";
import { auditContentStrategistOutputForUnsupportedClaims } from "../src/employees/content-strategist/audit";
import { extractAndParseRunnerResult, extractLastRunnerResultJsonLine, parseRunnerResultJson } from "../src/employees/content-strategist/runner-result";
import { ContentStrategistOutput } from "../src/employees/content-strategist/output";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseOutput(): ContentStrategistOutput {
  return {
    contentOpportunity: { title: "t", summary: "s" },
    targetAudience: "a",
    searchIntent: "commercial",
    commercialIntent: "c",
    angle: "ang",
    contentType: "article",
    targetBrand: "zentry",
    recommendedStructure: { h1: "h1", sections: [] },
    ctaStrategy: { primaryCta: "cta", rationale: "r" },
    internalLinks: [],
    supportingEvidence: [],
    priority: "medium",
    risksAndUnknowns: [],
    reasoningNotes: [],
  };
}

export function runContentStrategistBriefTests(): TestCase[] {
  return [
    // --- buildRunnerResultSummary: estructura FIJA en los 4 estados ---
    {
      name: "buildRunnerResultSummary con no_eligible_work deja todos los campos string vacios y auditWarningCount null",
      fn: () => {
        const result: ContentStrategistResult = { status: "no_eligible_work" };
        const summary = buildRunnerResultSummary(undefined, undefined, result);
        assert.equal(summary.status, "no_eligible_work");
        assert.equal(summary.changePackId, "");
        assert.equal(summary.keyword, "");
        assert.equal(summary.promptFilePath, "");
        assert.equal(summary.expectedOutputPath, "");
        assert.equal(summary.artifactJsonPath, "");
        assert.equal(summary.artifactMdPath, "");
        assert.equal(summary.auditWarningCount, null);
      },
    },
    {
      name: "buildRunnerResultSummary con pending_execution incluye promptFilePath",
      fn: () => {
        const result: ContentStrategistResult = { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" };
        const summary = buildRunnerResultSummary({ changePackId: "cp-1", keyword: "kw" }, { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/output.json", artifactJsonPath: "/tmp/x/brief.json", artifactMdPath: "/tmp/x/brief.md" }, result);
        assert.equal(summary.changePackId, "cp-1");
        assert.equal(summary.promptFilePath, "/tmp/x/prompt.md");
        assert.equal(summary.auditWarningCount, null);
      },
    },
    {
      name: "buildRunnerResultSummary reporta auditWarningCount solo en executed",
      fn: () => {
        const paths = { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/output.json", artifactJsonPath: "/tmp/x/brief.json", artifactMdPath: "/tmp/x/brief.md" };
        const executed: ContentStrategistResult = { status: "executed", output: baseOutput(), auditWarnings: ["w1", "w2", "w3"] };
        const summaryExecuted = buildRunnerResultSummary({ changePackId: "cp-1", keyword: "kw" }, paths, executed);
        assert.equal(summaryExecuted.auditWarningCount, 3);

        const invalid: ContentStrategistResult = { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/output-raw-invalid.json" };
        const summaryInvalid = buildRunnerResultSummary({ changePackId: "cp-1", keyword: "kw" }, paths, invalid);
        assert.equal(summaryInvalid.auditWarningCount, null);
      },
    },
    {
      name: "buildRunnerResultSummary mantiene la misma forma de objeto (mismas claves) en los 4 estados",
      fn: () => {
        const paths = { promptFilePath: "/tmp/x/prompt.md", expectedOutputPath: "/tmp/x/output.json", artifactJsonPath: "/tmp/x/brief.json", artifactMdPath: "/tmp/x/brief.md" };
        const cp = { changePackId: "cp-1", keyword: "kw" };
        const results: ContentStrategistResult[] = [
          { status: "no_eligible_work" },
          { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" },
          { status: "executed", output: baseOutput(), auditWarnings: [] },
          { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/x/output-raw-invalid.json" },
        ];
        const keySets = results.map((r) => Object.keys(buildRunnerResultSummary(r.status === "no_eligible_work" ? undefined : cp, r.status === "no_eligible_work" ? undefined : paths, r)).sort());
        for (const ks of keySets) assert.deepEqual(ks, keySets[0]);
      },
    },
    // --- buildBriefArtifact / renderBriefMarkdown ---
    {
      name: "renderBriefMarkdown para no_eligible_work no lanza y menciona explicitamente que no se ha inventado nada",
      fn: () => {
        const artifact = buildBriefArtifact(undefined, { status: "no_eligible_work" });
        const markdown = renderBriefMarkdown(artifact);
        assert.match(markdown, /sin trabajo elegible/i);
        assert.match(markdown, /no se ha inventado ninguna oportunidad/i);
      },
    },
    {
      name: "renderBriefMarkdown para pending_execution incluye la ruta del prompt",
      fn: () => {
        const artifact = buildBriefArtifact(undefined, { status: "pending_execution", promptFilePath: "/tmp/x/prompt.md" });
        const markdown = renderBriefMarkdown(artifact);
        assert.match(markdown, /pendiente de ejecucion/i);
        assert.match(markdown, /\/tmp\/x\/prompt\.md/);
      },
    },
    {
      name: "renderBriefMarkdown para invalid_output incluye el mensaje de error",
      fn: () => {
        const artifact = buildBriefArtifact(undefined, { status: "invalid_output", error: "falta targetAudience", rawOutputPath: "/tmp/x/output-raw-invalid.json" });
        const markdown = renderBriefMarkdown(artifact);
        assert.match(markdown, /salida invalida/i);
        assert.match(markdown, /falta targetAudience/);
      },
    },
    // --- Fixture sanitizado: smoke test + consistencia con la auditoria real ---
    {
      name: "el fixture sanitizado test/fixtures/content-strategist-brief-example.json se renderiza sin lanzar y contiene las secciones esperadas",
      fn: () => {
        const fixturePath = path.join(__dirname, "fixtures", "content-strategist-brief-example.json");
        const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as ContentStrategistBriefArtifact;

        const markdown = renderBriefMarkdown(artifact);

        assert.match(markdown, /Estructura propuesta/);
        assert.match(markdown, /CTA/);
        assert.match(markdown, /Enlaces internos propuestos/);
        assert.match(markdown, /Evidencia de soporte/);
        assert.match(markdown, /Riesgos \/ incognitas/);
        // El fixture no contiene ningun changePackId/keyword real del dataset de produccion.
        assert.doesNotMatch(markdown, /zentrylockers\.com/);
      },
    },
    {
      name: "el fixture sanitizado es internamente consistente: sus auditWarnings coinciden con lo que produciria auditContentStrategistOutputForUnsupportedClaims sobre su propio input/output",
      fn: () => {
        const fixturePath = path.join(__dirname, "fixtures", "content-strategist-brief-example.json");
        const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as ContentStrategistBriefArtifact;
        assert.equal(artifact.result.status, "executed");
        if (artifact.result.status !== "executed" || !artifact.input) return;

        const recomputedWarnings = auditContentStrategistOutputForUnsupportedClaims(artifact.input, artifact.result.output);
        assert.ok(recomputedWarnings.length > 0, "el fixture ilustra un caso CON warning -- si esto falla, el fixture quedo desincronizado con la logica de auditoria real");
        assert.equal(recomputedWarnings.length, artifact.result.auditWarnings.length, `el numero de warnings recalculado deberia coincidir con el guardado en el fixture, recalculado: ${JSON.stringify(recomputedWarnings)}`);
        assert.ok(
          recomputedWarnings.some((w) => /garant/i.test(w)),
          "el fixture ilustra especificamente un caso de garantia no respaldada"
        );
      },
    },
    // --- runner-result.ts: parseo fail-closed del RUNNER_RESULT_JSON ---
    {
      name: "extractLastRunnerResultJsonLine devuelve la ULTIMA linea RUNNER_RESULT_JSON entre ruido de npm/ts-node",
      fn: () => {
        const log = ["> some npm noise", 'RUNNER_RESULT_JSON={"status":"pending_execution"}', "more noise", 'RUNNER_RESULT_JSON={"status":"executed"}'].join("\n");
        assert.equal(extractLastRunnerResultJsonLine(log), '{"status":"executed"}');
      },
    },
    {
      name: "extractLastRunnerResultJsonLine devuelve undefined si no hay ninguna linea",
      fn: () => {
        assert.equal(extractLastRunnerResultJsonLine("solo ruido, sin la linea esperada"), undefined);
      },
    },
    {
      name: "parseRunnerResultJson FAIL-CLOSED: JSON invalido lanza",
      fn: () => {
        assert.throws(() => parseRunnerResultJson("{no es json valido"), /no es JSON valido/);
      },
    },
    {
      name: "parseRunnerResultJson FAIL-CLOSED: falta un campo string requerido lanza",
      fn: () => {
        const incomplete = { status: "no_eligible_work", changePackId: "", keyword: "", promptFilePath: "", expectedOutputPath: "", artifactJsonPath: "", auditWarningCount: null };
        assert.throws(() => parseRunnerResultJson(JSON.stringify(incomplete)), /artifactMdPath/);
      },
    },
    {
      name: "parseRunnerResultJson FAIL-CLOSED: status fuera de los 4 valores esperados lanza",
      fn: () => {
        const bad = { status: "something_else", changePackId: "", keyword: "", promptFilePath: "", expectedOutputPath: "", artifactJsonPath: "", artifactMdPath: "", auditWarningCount: null };
        assert.throws(() => parseRunnerResultJson(JSON.stringify(bad)), /status/);
      },
    },
    {
      name: "parseRunnerResultJson FAIL-CLOSED: auditWarningCount ni number ni null lanza",
      fn: () => {
        const bad = { status: "executed", changePackId: "cp", keyword: "kw", promptFilePath: "p", expectedOutputPath: "e", artifactJsonPath: "j", artifactMdPath: "m", auditWarningCount: "2" };
        assert.throws(() => parseRunnerResultJson(JSON.stringify(bad)), /auditWarningCount/);
      },
    },
    {
      name: "extractAndParseRunnerResult combina extraccion + parseo sobre un log realista",
      fn: () => {
        const summary = buildRunnerResultSummary({ changePackId: "cp-1", keyword: "taquillas melamina" }, { promptFilePath: "/tmp/prompt.md", expectedOutputPath: "/tmp/output.json", artifactJsonPath: "/tmp/brief.json", artifactMdPath: "/tmp/brief.md" }, { status: "pending_execution", promptFilePath: "/tmp/prompt.md" });
        const log = `npm ruido\ncontent-strategist: prompt preparado.\nRUNNER_RESULT_JSON=${JSON.stringify(summary)}\n`;
        const parsed = extractAndParseRunnerResult(log);
        assert.equal(parsed.changePackId, "cp-1");
        assert.equal(parsed.status, "pending_execution");
      },
    },
    {
      name: "extractAndParseRunnerResult lanza si no hay ninguna linea RUNNER_RESULT_JSON",
      fn: () => {
        assert.throws(() => extractAndParseRunnerResult("log sin la linea esperada"), /No se encontro ninguna linea/);
      },
    },
  ];
}
