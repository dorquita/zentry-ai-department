import * as assert from "node:assert/strict";
import { assertReviewedArtifactMatches, QaReviewedArtifactRef, QaReviewerOutput, summarizeQaReviewerOutput, validateQaReviewerOutput } from "../src/employees/qa-reviewer/output";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseIdentity(overrides: Partial<QaReviewedArtifactRef> = {}): QaReviewedArtifactRef {
  return {
    sourceEmployee: "ux-ui-landing-architect-v2",
    artifactType: "landing_architect_comparison",
    artifactId: "example-change-pack-001",
    artifactPath: "test/fixtures/qa-reviewer-example-artifact.json",
    ...overrides,
  };
}

function baseOutput(overrides: Partial<QaReviewerOutput> = {}): QaReviewerOutput {
  return {
    reviewStatus: "pass_with_warnings",
    reviewedArtifact: baseIdentity(),
    findings: [{ category: "unsupported_claims", severity: "warning", description: "La garantia de fabricante no viene respaldada por el input." }],
    unsupportedClaims: ["Todas nuestras unidades cuentan con garantia de fabricante."],
    contradictions: [],
    safetyConcerns: [],
    requiredCorrections: ["Sustituir la afirmacion de garantia por un remitido a presupuesto."],
    approvalRecommendation: { recommendedStatus: "pending", riskLevel: "low_medium", rationale: "Hay una afirmacion sin respaldo, pero el resto del artifact es coherente." },
    evidence: ['faq[0].answer: "Todas nuestras unidades cuentan con garantia de fabricante."'],
    summary: "El artifact es mayormente correcto salvo una afirmacion de garantia sin respaldo en el input.",
    ...overrides,
  };
}

export function runQaReviewerOutputTests(): TestCase[] {
  return [
    // --- validateQaReviewerOutput: aceptar salida valida ---
    {
      name: "salida valida completa: validateQaReviewerOutput la acepta sin lanzar",
      fn: () => {
        assert.doesNotThrow(() => validateQaReviewerOutput(baseOutput()));
      },
    },
    {
      name: "salida valida con arrays vacios (sin nada que reportar) tambien es valida",
      fn: () => {
        const output = baseOutput({ reviewStatus: "pass", findings: [], unsupportedClaims: [], contradictions: [], safetyConcerns: [], requiredCorrections: [], evidence: [] });
        assert.doesNotThrow(() => validateQaReviewerOutput(output));
      },
    },

    // --- validateQaReviewerOutput: rechazar salida invalida (tipo base) ---
    {
      name: "salida no-objeto (string/null/array) se rechaza",
      fn: () => {
        assert.throws(() => validateQaReviewerOutput("no es un objeto"), /se esperaba un objeto JSON/);
        assert.throws(() => validateQaReviewerOutput(null), /se esperaba un objeto JSON/);
      },
    },

    // --- Campo requerido ausente ---
    {
      name: "falta reviewStatus: rechazado",
      fn: () => {
        const output = baseOutput() as unknown as Record<string, unknown>;
        delete output.reviewStatus;
        assert.throws(() => validateQaReviewerOutput(output), /reviewStatus/);
      },
    },
    {
      name: "falta reviewedArtifact: rechazado",
      fn: () => {
        const output = baseOutput() as unknown as Record<string, unknown>;
        delete output.reviewedArtifact;
        assert.throws(() => validateQaReviewerOutput(output), /reviewedArtifact/);
      },
    },
    {
      name: "falta approvalRecommendation: rechazado",
      fn: () => {
        const output = baseOutput() as unknown as Record<string, unknown>;
        delete output.approvalRecommendation;
        assert.throws(() => validateQaReviewerOutput(output), /approvalRecommendation/);
      },
    },
    {
      name: "falta summary: rechazado",
      fn: () => {
        const output = baseOutput() as unknown as Record<string, unknown>;
        delete output.summary;
        assert.throws(() => validateQaReviewerOutput(output), /summary/);
      },
    },

    // --- Enum invalido ---
    {
      name: "reviewStatus fuera del enum: rechazado",
      fn: () => {
        const output = { ...baseOutput(), reviewStatus: "maybe" };
        assert.throws(() => validateQaReviewerOutput(output), /reviewStatus/);
      },
    },
    {
      name: "findings[0].severity fuera del enum: rechazado",
      fn: () => {
        const output = baseOutput({ findings: [{ category: "other", severity: "extremely_bad" as unknown as "critical", description: "x" }] });
        assert.throws(() => validateQaReviewerOutput(output), /findings/);
      },
    },
    {
      name: "approvalRecommendation.recommendedStatus fuera del enum: rechazado",
      fn: () => {
        const output = baseOutput();
        (output.approvalRecommendation as unknown as Record<string, unknown>).recommendedStatus = "maybe_later";
        assert.throws(() => validateQaReviewerOutput(output), /approvalRecommendation/);
      },
    },

    // --- Tipo incorrecto ---
    {
      name: "unsupportedClaims no es string[]: rechazado",
      fn: () => {
        const output = { ...baseOutput(), unsupportedClaims: [1, 2, 3] };
        assert.throws(() => validateQaReviewerOutput(output), /unsupportedClaims/);
      },
    },

    // --- assertReviewedArtifactMatches: la regla "reviewedArtifact debe coincidir con lo suministrado" ---
    {
      name: "assertReviewedArtifactMatches: identidad identica no lanza",
      fn: () => {
        const identity = baseIdentity();
        assert.doesNotThrow(() => assertReviewedArtifactMatches(identity, identity));
      },
    },
    {
      name: "assertReviewedArtifactMatches: artifactId distinto -- fail-closed, lanza con el motivo",
      fn: () => {
        const expected = baseIdentity();
        const actual = baseIdentity({ artifactId: "otro-artifact-completamente-distinto" });
        assert.throws(() => assertReviewedArtifactMatches(expected, actual), /artifactId/);
      },
    },
    {
      name: "assertReviewedArtifactMatches: sourceEmployee distinto (Claude reclama haber revisado otro empleado) -- fail-closed",
      fn: () => {
        const expected = baseIdentity();
        const actual = baseIdentity({ sourceEmployee: "un-empleado-que-no-se-le-suministro" });
        assert.throws(() => assertReviewedArtifactMatches(expected, actual), /sourceEmployee/);
      },
    },
    {
      name: "assertReviewedArtifactMatches: artifactPath distinto -- fail-closed",
      fn: () => {
        const expected = baseIdentity();
        const actual = baseIdentity({ artifactPath: "otra/ruta/inventada.json" });
        assert.throws(() => assertReviewedArtifactMatches(expected, actual), /artifactPath/);
      },
    },

    // --- summarizeQaReviewerOutput: espejo de overallPass/hasWarnings de StagingQaResultSnapshot ---
    {
      name: "summarizeQaReviewerOutput: reviewStatus pass sin findings ni safetyConcerns => overallPass true, hasWarnings false",
      fn: () => {
        const output = baseOutput({ reviewStatus: "pass", findings: [], unsupportedClaims: [], contradictions: [], safetyConcerns: [] });
        const summary = summarizeQaReviewerOutput(output);
        assert.equal(summary.overallPass, true);
        assert.equal(summary.hasWarnings, false);
        assert.equal(summary.criticalFindingsCount, 0);
      },
    },
    {
      name: "summarizeQaReviewerOutput: un finding critical => overallPass false, aunque reviewStatus no sea fail",
      fn: () => {
        const output = baseOutput({
          reviewStatus: "pass_with_warnings",
          findings: [{ category: "unsafe_actions", severity: "critical", description: "Escritura externa sin aprobacion." }],
        });
        const summary = summarizeQaReviewerOutput(output);
        assert.equal(summary.overallPass, false, "un finding critical siempre debe tumbar overallPass, sin importar reviewStatus");
        assert.equal(summary.criticalFindingsCount, 1);
      },
    },
    {
      name: "summarizeQaReviewerOutput: un safetyConcern => overallPass false",
      fn: () => {
        const output = baseOutput({ reviewStatus: "pass", findings: [], safetyConcerns: ["Propone escribir en WordPress sin aprobacion humana."] });
        const summary = summarizeQaReviewerOutput(output);
        assert.equal(summary.overallPass, false);
      },
    },
    {
      name: "summarizeQaReviewerOutput: unsupportedClaims no vacio => hasWarnings true incluso sin findings de severidad warning",
      fn: () => {
        const output = baseOutput({ reviewStatus: "pass", findings: [], unsupportedClaims: ["Una afirmacion sin respaldo."], contradictions: [], safetyConcerns: [] });
        const summary = summarizeQaReviewerOutput(output);
        assert.equal(summary.hasWarnings, true);
      },
    },
  ];
}
