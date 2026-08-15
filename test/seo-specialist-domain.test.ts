import * as assert from "node:assert/strict";
import {
  auditSeoSpecialistOutputForUnsupportedClaims,
  buildRunnerResultSummary,
  extractAndParseSeoSpecialistRunnerResult,
  parseSeoSpecialistRunnerResultJson,
  SeoSpecialistOutput,
  SeoSpecialistResult,
  validateSeoSpecialistOutput,
} from "../src/employees/seo-specialist/domain";
import { SeoSpecialistContext } from "../src/employees/seo-specialist/context";
import { ActionItem } from "../src/agents/seo-director";

export interface TestCase {
  name: string;
  fn: () => void;
}

function makeActionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    keyword: "cerraduras electronicas para taquillas",
    page: "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
    kinds: ["quick_win"],
    priority: "medium",
    currentPosition: 24.4,
    targetPosition: 10,
    totalImpressions: 27,
    action: "Optimizar on-page.",
    rationale: "27 impresiones en el periodo analizado.",
    effort: "medium",
    impact: "medium",
    requiresWordPress: true,
    requiresNewContent: false,
    requiresHumanReview: true,
    sourceJobIds: ["job-1"],
    ...overrides,
  };
}

function makeContext(overrides: Partial<SeoSpecialistContext> = {}): SeoSpecialistContext {
  return {
    generatedAt: "2026-08-15T00:00:00.000Z",
    dataAvailability: {
      hasJobData: true,
      hasTargetKeywordCatalog: true,
      hasClusterCatalog: true,
      latestRunId: "seo-watcher-2026-08-14T000000Z",
      totalJobsInLatestRun: 1,
    },
    actionItems: [makeActionItem()],
    targetKeywords: [{ keyword: "lockers inteligentes", type: "commercial", priority: "high" }],
    clusters: [
      {
        clusterKey: "taquillas_metalicas",
        label: "Taquillas metalicas",
        matchPatterns: ["taquillas metalicas"],
        excludePatterns: [],
        searchIntent: "producto",
        targetUrl: null,
        targetPageId: null,
        relatedStagingPageIds: [],
        action: "new_page_candidate",
        reason: "Hueco de contenido detectado.",
      },
    ],
    ...overrides,
  };
}

function makeEmptyOutput(overrides: Partial<SeoSpecialistOutput> = {}): SeoSpecialistOutput {
  return {
    executiveSummary: "Resumen.",
    findings: [],
    opportunities: [],
    technicalIssues: [],
    contentGaps: [],
    internalLinkRecommendations: [],
    prioritizedActions: [],
    evidence: [],
    unknowns: [],
    ...overrides,
  };
}

export function runSeoSpecialistDomainTests(): TestCase[] {
  return [
    // --- validateSeoSpecialistOutput: fail-closed ---
    {
      name: "validateSeoSpecialistOutput rechaza un valor que no es un objeto",
      fn: () => {
        assert.throws(() => validateSeoSpecialistOutput("no soy un objeto"), /objeto JSON/);
        assert.throws(() => validateSeoSpecialistOutput(null), /objeto JSON/);
        assert.throws(() => validateSeoSpecialistOutput(42), /objeto JSON/);
      },
    },
    {
      name: "validateSeoSpecialistOutput acepta una salida minima valida (arrays vacios)",
      fn: () => {
        assert.doesNotThrow(() => validateSeoSpecialistOutput(makeEmptyOutput()));
      },
    },
    {
      name: "validateSeoSpecialistOutput rechaza executiveSummary ausente",
      fn: () => {
        const raw = makeEmptyOutput() as unknown as Record<string, unknown>;
        delete raw.executiveSummary;
        assert.throws(() => validateSeoSpecialistOutput(raw), /executiveSummary/);
      },
    },
    {
      name: "validateSeoSpecialistOutput rechaza findings con category invalida",
      fn: () => {
        const raw = makeEmptyOutput({ findings: [{ id: "f1", category: "not_valid" as never, description: "x", basis: "inference", evidenceRefs: [] }] });
        assert.throws(() => validateSeoSpecialistOutput(raw), /findings/);
      },
    },
    {
      name: "validateSeoSpecialistOutput rechaza opportunities sin keyword (string)",
      fn: () => {
        const raw = makeEmptyOutput({ opportunities: [{ keyword: 42 as never, id: "o1", kind: "quick_win", priority: "low", recommendedAction: "x", rationale: "y", basis: "inference", evidenceRefs: [] }] });
        assert.throws(() => validateSeoSpecialistOutput(raw), /opportunities/);
      },
    },
    {
      name: "validateSeoSpecialistOutput rechaza prioritizedActions con rank no numerico",
      fn: () => {
        const raw = makeEmptyOutput({ prioritizedActions: [{ rank: "1" as unknown as number, title: "x", relatedIds: [], priority: "low", effort: "low", impact: "low" }] });
        assert.throws(() => validateSeoSpecialistOutput(raw), /prioritizedActions/);
      },
    },
    {
      name: "validateSeoSpecialistOutput rechaza unknowns que no es string[]",
      fn: () => {
        const raw = { ...makeEmptyOutput(), unknowns: [1, 2, 3] };
        assert.throws(() => validateSeoSpecialistOutput(raw), /unknowns/);
      },
    },
    {
      name: "validateSeoSpecialistOutput acepta campos opcionales (page/relatedKeyword) ausentes",
      fn: () => {
        const raw = makeEmptyOutput({
          contentGaps: [{ id: "g1", topic: "Taquillas metalicas", rationale: "x", basis: "inference", evidenceRefs: [] }],
        });
        assert.doesNotThrow(() => validateSeoSpecialistOutput(raw));
      },
    },

    // --- auditSeoSpecialistOutputForUnsupportedClaims ---
    {
      name: "audit: sin avisos cuando todo esta bien formado y respaldado por el contexto",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          evidence: [{ id: "ev-1", source: "job_data", keyword: "cerraduras electronicas para taquillas", page: "https://zentrylockers.com/cerraduras-inteligentes-taquillas/", description: "x" }],
          findings: [{ id: "f1", category: "technical", description: "x", basis: "evidence", evidenceRefs: ["ev-1"] }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "audit: avisa si basis=evidence pero evidenceRefs esta vacio",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          findings: [{ id: "f1", category: "technical", description: "x", basis: "evidence", evidenceRefs: [] }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => w.includes("f1") && w.includes("basis=evidence")));
      },
    },
    {
      name: "audit: NO avisa si basis=inference y evidenceRefs esta vacio (inferencia no necesita respaldo directo)",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          findings: [{ id: "f1", category: "technical", description: "x", basis: "inference", evidenceRefs: [] }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "audit: avisa de referencia a evidenceRefs colgante (id inexistente en evidence[])",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          opportunities: [{ id: "o1", keyword: "cerraduras electronicas para taquillas", kind: "quick_win", priority: "low", recommendedAction: "x", rationale: "y", basis: "evidence", evidenceRefs: ["ev-inexistente"] }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => w.includes("o1") && w.includes("ev-inexistente")));
      },
    },
    {
      name: "audit: avisa si una entrada de evidence[] cita una keyword que no aparece en el contexto (posible dato inventado)",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          evidence: [{ id: "ev-1", source: "job_data", keyword: "keyword totalmente inventada", description: "x" }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => w.includes("ev-1") && w.includes("keyword totalmente inventada")));
      },
    },
    {
      name: "audit: avisa si una entrada de evidence[] cita una pagina que no aparece en el contexto (posible dato inventado)",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          evidence: [{ id: "ev-1", source: "job_data", page: "https://zentrylockers.com/pagina-que-no-existe/", description: "x" }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => w.includes("ev-1") && w.includes("pagina-que-no-existe")));
      },
    },
    {
      name: "audit: acepta una keyword de evidence que solo aparece en targetKeywords (no en actionItems)",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          evidence: [{ id: "ev-1", source: "target_keyword_catalog", keyword: "lockers inteligentes", description: "x" }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "audit: acepta una keyword de evidence que solo aparece en un matchPattern de clusters",
      fn: () => {
        const context = makeContext();
        const output = makeEmptyOutput({
          evidence: [{ id: "ev-1", source: "cluster_catalog", keyword: "taquillas metalicas", description: "x" }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "audit: avisa si no hay ningun dato local disponible pero la salida trae findings/opportunities de todas formas (fail-closed contra fabricacion sin datos)",
      fn: () => {
        const context = makeContext({
          dataAvailability: { hasJobData: false, hasTargetKeywordCatalog: false, hasClusterCatalog: false, totalJobsInLatestRun: 0 },
          actionItems: [],
          targetKeywords: [],
          clusters: [],
        });
        const output = makeEmptyOutput({
          findings: [{ id: "f1", category: "other", description: "x", basis: "inference", evidenceRefs: [] }],
        });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => w.includes("No habia ningun dato SEO local disponible")));
      },
    },
    {
      name: "audit: sin datos locales y sin findings/opportunities no genera el aviso de fabricacion sin datos",
      fn: () => {
        const context = makeContext({
          dataAvailability: { hasJobData: false, hasTargetKeywordCatalog: false, hasClusterCatalog: false, totalJobsInLatestRun: 0 },
          actionItems: [],
          targetKeywords: [],
          clusters: [],
        });
        const output = makeEmptyOutput({ unknowns: ["No hay datos SEO locales disponibles."] });
        const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },

    // --- buildRunnerResultSummary ---
    {
      name: "buildRunnerResultSummary: status pending_execution deja los contadores en null",
      fn: () => {
        const result: SeoSpecialistResult = { status: "pending_execution", promptFilePath: "/tmp/prompt.md" };
        const summary = buildRunnerResultSummary(
          "run-1",
          { promptFilePath: "/tmp/prompt.md", expectedOutputPath: "/tmp/output.json", artifactJsonPath: "/tmp/artifact.json", artifactMdPath: "/tmp/artifact.md" },
          result
        );
        assert.equal(summary.status, "pending_execution");
        assert.equal(summary.findingCount, null);
        assert.equal(summary.opportunityCount, null);
        assert.equal(summary.warningCount, null);
      },
    },
    {
      name: "buildRunnerResultSummary: status executed cuenta findings/opportunities/warnings reales",
      fn: () => {
        const output = makeEmptyOutput({
          findings: [{ id: "f1", category: "other", description: "x", basis: "inference", evidenceRefs: [] }],
          opportunities: [
            { id: "o1", keyword: "kw1", kind: "quick_win", priority: "low", recommendedAction: "x", rationale: "y", basis: "inference", evidenceRefs: [] },
            { id: "o2", keyword: "kw2", kind: "quick_win", priority: "low", recommendedAction: "x", rationale: "y", basis: "inference", evidenceRefs: [] },
          ],
        });
        const result: SeoSpecialistResult = { status: "executed", output, warnings: ["aviso 1"] };
        const summary = buildRunnerResultSummary(
          "run-1",
          { promptFilePath: "/tmp/prompt.md", expectedOutputPath: "/tmp/output.json", artifactJsonPath: "/tmp/artifact.json", artifactMdPath: "/tmp/artifact.md" },
          result
        );
        assert.equal(summary.findingCount, 1);
        assert.equal(summary.opportunityCount, 2);
        assert.equal(summary.warningCount, 1);
      },
    },

    // --- parseSeoSpecialistRunnerResultJson / extractAndParseSeoSpecialistRunnerResult ---
    {
      name: "parseSeoSpecialistRunnerResultJson: fail-closed ante JSON invalido",
      fn: () => {
        assert.throws(() => parseSeoSpecialistRunnerResultJson("{ esto no es json"), /RUNNER_RESULT_JSON no es JSON valido/);
      },
    },
    {
      name: "parseSeoSpecialistRunnerResultJson: fail-closed ante campo string obligatorio ausente",
      fn: () => {
        const jsonText = JSON.stringify({ status: "pending_execution", promptFilePath: "p", expectedOutputPath: "e", artifactJsonPath: "j", artifactMdPath: "m", findingCount: null, opportunityCount: null, warningCount: null });
        assert.throws(() => parseSeoSpecialistRunnerResultJson(jsonText), /runId/);
      },
    },
    {
      name: "parseSeoSpecialistRunnerResultJson: fail-closed ante status fuera de los 3 valores esperados",
      fn: () => {
        const jsonText = JSON.stringify({ runId: "r1", status: "done", promptFilePath: "p", expectedOutputPath: "e", artifactJsonPath: "j", artifactMdPath: "m", findingCount: null, opportunityCount: null, warningCount: null });
        assert.throws(() => parseSeoSpecialistRunnerResultJson(jsonText), /status/);
      },
    },
    {
      name: "extractAndParseSeoSpecialistRunnerResult: extrae la ULTIMA linea RUNNER_RESULT_JSON de un log con ruido alrededor",
      fn: () => {
        const good = JSON.stringify({ runId: "r2", status: "executed", promptFilePath: "p", expectedOutputPath: "e", artifactJsonPath: "j", artifactMdPath: "m", findingCount: 3, opportunityCount: 1, warningCount: 0 });
        const log = `npm log ruido\nRUNNER_RESULT_JSON=${JSON.stringify({ runId: "r1-viejo", status: "pending_execution", promptFilePath: "p", expectedOutputPath: "e", artifactJsonPath: "j", artifactMdPath: "m", findingCount: null, opportunityCount: null, warningCount: null })}\nmas ruido\nRUNNER_RESULT_JSON=${good}\n`;
        const result = extractAndParseSeoSpecialistRunnerResult(log);
        assert.equal(result.runId, "r2");
        assert.equal(result.findingCount, 3);
      },
    },
    {
      name: "extractAndParseSeoSpecialistRunnerResult: fail-closed si no hay ninguna linea RUNNER_RESULT_JSON",
      fn: () => {
        assert.throws(() => extractAndParseSeoSpecialistRunnerResult("solo texto sin la linea esperada\n"), /No se encontro ninguna linea/);
      },
    },
  ];
}
