import * as assert from "node:assert/strict";
import { buildSemRunnerResultSummary, buildSemSpecialistArtifact, renderSemSpecialistMarkdown, SemResult, SemSpecialistOutput } from "../src/employees/sem-specialist/sem-specialist-output";
import { SemSpecialistContext } from "../src/employees/sem-specialist/sem-specialist-context";
import { classifySnapshotFreshness } from "../src/core/snapshot-freshness";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(): SemSpecialistContext {
  return {
    sourceEventId: "evt-1",
    sourceDepartmentRunId: "growth-department-2026-08-14T111247Z",
    sourceGeneratedAt: "2026-08-14T11:13:30.858Z",
    connectedToGoogleAdsAtSourceTime: true,
    campaignName: "SEM | ES | Compra | Taquillas / Gimnasios",
    campaignStatus: "PAUSED",
    adGroups: 1,
    positiveKeywords: 60,
    negativeKeywords: 115,
    responsiveSearchAds: 11,
    semCandidateCount: 70,
    metricsWindow: "LAST_30_DAYS",
    metricsStartDate: "2026-07-16",
    metricsEndDate: "2026-08-14",
    freshness: classifySnapshotFreshness({
      sourceGeneratedAt: "2026-08-14T11:13:30.858Z",
      now: "2026-08-14T11:20:00.000Z",
    }),
    metrics: [],
    searchTerms: [],
    searchTermCount: 0,
    departmentSummary: null,
    evidenceCatalog: [],
  };
}

function emptyOutput(): SemSpecialistOutput {
  return {
    summary: "Resumen.",
    campaignFindings: [],
    searchTermOpportunities: [],
    negativeKeywordRecommendations: [],
    budgetObservations: [],
    biddingObservations: [],
    adLandingAlignment: [],
    conversionRiskFindings: [],
    prioritizedExperiments: [],
    evidence: [],
    unknowns: ["sin dato suficiente para X"],
  };
}

const PATHS = {
  promptFilePath: "reports/sem-specialist/2026-08-15/sem-specialist-prompt.md",
  expectedOutputPath: "reports/sem-specialist/2026-08-15/sem-specialist-output.json",
  artifactJsonPath: "reports/sem-specialist/2026-08-15/sem-specialist-result.json",
  artifactMdPath: "reports/sem-specialist/2026-08-15/sem-specialist-result.md",
};

export function runSemSpecialistArtifactTests(): TestCase[] {
  return [
    {
      name: "buildSemRunnerResultSummary (no_data): promptFilePath/expectedOutputPath vacios, sourceEventId vacio, unsupportedClaimCount null",
      fn: () => {
        const result: SemResult = { status: "no_data" };
        const summary = buildSemRunnerResultSummary(null, PATHS, result);
        assert.equal(summary.status, "no_data");
        assert.equal(summary.sourceEventId, "");
        assert.equal(summary.promptFilePath, "");
        assert.equal(summary.expectedOutputPath, "");
        assert.equal(summary.artifactJsonPath, PATHS.artifactJsonPath, "el artifact SIEMPRE se escribe, incluso en no_data");
        assert.equal(summary.unsupportedClaimCount, null);
      },
    },
    {
      name: "buildSemRunnerResultSummary (pending_execution): promptFilePath/expectedOutputPath poblados, sourceEventId del contexto",
      fn: () => {
        const context = baseContext();
        const result: SemResult = { status: "pending_execution", promptFilePath: PATHS.promptFilePath };
        const summary = buildSemRunnerResultSummary(context, PATHS, result);
        assert.equal(summary.status, "pending_execution");
        assert.equal(summary.sourceEventId, "evt-1");
        assert.equal(summary.promptFilePath, PATHS.promptFilePath);
        assert.equal(summary.expectedOutputPath, PATHS.expectedOutputPath);
        assert.equal(summary.unsupportedClaimCount, null);
      },
    },
    {
      name: "buildSemRunnerResultSummary (executed): unsupportedClaimCount siempre 0 (una violacion fuerza invalid_output, nunca executed)",
      fn: () => {
        const context = baseContext();
        const result: SemResult = { status: "executed", output: emptyOutput(), uncitedClaims: [] };
        const summary = buildSemRunnerResultSummary(context, PATHS, result);
        assert.equal(summary.status, "executed");
        assert.equal(summary.unsupportedClaimCount, 0);
      },
    },
    {
      name: "buildSemRunnerResultSummary (invalid_output): unsupportedClaimCount refleja el numero real de violaciones",
      fn: () => {
        const context = baseContext();
        const result: SemResult = { status: "invalid_output", error: "2 violaciones", rawOutputPath: "raw.json", violations: ["v1", "v2"] };
        const summary = buildSemRunnerResultSummary(context, PATHS, result);
        assert.equal(summary.status, "invalid_output");
        assert.equal(summary.unsupportedClaimCount, 2);
      },
    },
    {
      name: "renderSemSpecialistMarkdown (no_data): menciona explicitamente que no hay datos y que no se invoco a Claude",
      fn: () => {
        const artifact = buildSemSpecialistArtifact(null, { status: "no_data" });
        const md = renderSemSpecialistMarkdown(artifact);
        assert.match(md, /no_data/);
        assert.match(md, /no se ha invocado a Claude|sin invocar a Claude/i);
      },
    },
    {
      name: "renderSemSpecialistMarkdown (pending_execution): incluye la ruta del prompt preparado",
      fn: () => {
        const context = baseContext();
        const artifact = buildSemSpecialistArtifact(context, { status: "pending_execution", promptFilePath: PATHS.promptFilePath });
        const md = renderSemSpecialistMarkdown(artifact);
        assert.match(md, /pendiente de ejecucion/i);
        assert.ok(md.includes(PATHS.promptFilePath));
      },
    },
    {
      name: "renderSemSpecialistMarkdown (invalid_output): incluye las violaciones listadas",
      fn: () => {
        const context = baseContext();
        const artifact = buildSemSpecialistArtifact(context, { status: "invalid_output", error: "1 violacion", rawOutputPath: "raw.json", violations: ["CPC inventado sin respaldo"] });
        const md = renderSemSpecialistMarkdown(artifact);
        assert.match(md, /salida invalida/i);
        assert.ok(md.includes("CPC inventado sin respaldo"));
      },
    },
    {
      name: "renderSemSpecialistMarkdown (executed): incluye el summary, unknowns declarados y las 7 secciones de findings",
      fn: () => {
        const context = baseContext();
        const output = emptyOutput();
        output.campaignFindings = [{ title: "Hallazgo", description: "Detalle.", evidenceRefs: [], severity: "high" }];
        const artifact = buildSemSpecialistArtifact(context, { status: "executed", output, uncitedClaims: [] });
        const md = renderSemSpecialistMarkdown(artifact);
        assert.ok(md.includes(output.summary));
        assert.ok(md.includes("sin dato suficiente para X"));
        assert.ok(md.includes("Hallazgo"));
        for (const heading of [
          "Campaign findings",
          "Search-term / keyword opportunities",
          "Negative keyword recommendations",
          "Budget observations",
          "Bidding observations",
          "Ad / landing alignment",
          "Conversion-risk findings",
          "Prioritized experiments",
          "Evidence",
          "Unknowns",
        ]) {
          assert.ok(md.includes(heading), `deberia incluir la seccion "${heading}"`);
        }
      },
    },
    {
      name: "renderSemSpecialistMarkdown siempre incluye la nota de solo lectura/propuesta (ninguna escritura a Google Ads)",
      fn: () => {
        const mdNoData = renderSemSpecialistMarkdown(buildSemSpecialistArtifact(null, { status: "no_data" }));
        const mdExecuted = renderSemSpecialistMarkdown(buildSemSpecialistArtifact(baseContext(), { status: "executed", output: emptyOutput(), uncitedClaims: [] }));
        for (const md of [mdNoData, mdExecuted]) {
          assert.match(md, /NUNCA modifica campanas, presupuestos, keywords ni anuncios/);
        }
      },
    },
  ];
}
