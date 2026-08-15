import * as assert from "node:assert/strict";
import { GrowthDirectorV2Output, GrowthPriority } from "../src/employees/growth-director-v2/types";
import { QaReviewerOutput } from "../src/employees/qa-reviewer/output";
import { resolveDepartmentQaStatus, resolvePromotion, signalMentionsTitle } from "../src/department/promotion";

export interface TestCase {
  name: string;
  fn: () => void;
}

const DEPARTMENT_RUN_ID = "dept-2026-08-15T120000Z";

function priority(title: string, overrides: Partial<GrowthPriority> = {}): GrowthPriority {
  return {
    title,
    rationale: `Razon de "${title}".`,
    impact: "high",
    confidence: "medium",
    effort: "low",
    dependsOn: [],
    evidenceRefs: ["dept-seo-summary"],
    ...overrides,
  };
}

function growthOutput(priorities: GrowthPriority[]): GrowthDirectorV2Output {
  return {
    growthSummary: "Resumen.",
    currentSignals: [],
    bottlenecks: [],
    opportunities: [],
    experiments: [],
    recommendedPriorities: priorities,
    dependencies: [],
    risks: [],
    evidence: [],
    unknowns: [],
  };
}

function qaOutput(overrides: Partial<QaReviewerOutput> = {}): QaReviewerOutput {
  return {
    reviewStatus: "pass",
    reviewedArtifact: { sourceEmployee: "unknown", artifactType: "generic_json_artifact", artifactId: `${DEPARTMENT_RUN_ID}-qa-input`, artifactPath: `reports/department/${DEPARTMENT_RUN_ID}/${DEPARTMENT_RUN_ID}-qa-input.json` },
    findings: [],
    unsupportedClaims: [],
    contradictions: [],
    safetyConcerns: [],
    requiredCorrections: [],
    approvalRecommendation: { recommendedStatus: "pending", riskLevel: "low_medium", rationale: "Decision humana." },
    evidence: [],
    summary: "Revision.",
    ...overrides,
  };
}

export function runDepartmentPromotionTests(): TestCase[] {
  return [
    {
      name: "QA PASS: todas las prioridades de Growth se promueven a web-engineer",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "executed", output: growthOutput([priority("Corregir el seguimiento de conversiones"), priority("Publicar la pagina de taquillas metalicas")]) },
          qa: { status: "executed", output: qaOutput() },
        });

        assert.equal(result.departmentQaStatus, "PASS");
        assert.equal(result.promoted.length, 2);
        assert.equal(result.blocked.length, 0);
        assert.equal(result.globalBlockReason, null);
        assert.deepEqual(
          result.promoted.map((p) => p.decision),
          ["promoted", "promoted"]
        );
        // Trazabilidad: el rank apunta al indice original en recommendedPriorities[].
        assert.deepEqual(
          result.promoted.map((p) => p.rank),
          [1, 2]
        );
      },
    },
    {
      name: "QA BLOCKED (reviewStatus fail): NINGUNA recomendacion se promueve, todas quedan bloqueadas con motivo global",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "executed", output: growthOutput([priority("Corregir el seguimiento de conversiones"), priority("Publicar la pagina de taquillas metalicas")]) },
          qa: { status: "executed", output: qaOutput({ reviewStatus: "fail" }) },
        });

        assert.equal(result.departmentQaStatus, "BLOCKED");
        assert.equal(result.promoted.length, 0);
        assert.equal(result.blocked.length, 2);
        assert.ok(result.globalBlockReason && result.globalBlockReason.includes("BLOCKED"));
        assert.ok(result.blocked.every((b) => b.decision === "blocked" && b.blockedBy.length > 0));
      },
    },
    {
      name: "Un hallazgo critical bloquea el conjunto aunque reviewStatus sea pass (se reutiliza la regla overallPass del propio empleado)",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "executed", output: growthOutput([priority("Corregir el seguimiento de conversiones")]) },
          qa: { status: "executed", output: qaOutput({ findings: [{ category: "fabrication_risk", severity: "critical", description: "Cifra inventada." }] }) },
        });

        assert.equal(result.departmentQaStatus, "BLOCKED");
        assert.equal(result.promoted.length, 0);
        assert.equal(result.blocked.length, 1);
      },
    },
    {
      name: "Un safetyConcern bloquea el conjunto aunque no haya hallazgos critical",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "executed", output: growthOutput([priority("Corregir el seguimiento de conversiones")]) },
          qa: { status: "executed", output: qaOutput({ safetyConcerns: ["Propone tocar produccion sin aprobacion."] }) },
        });

        assert.equal(result.departmentQaStatus, "BLOCKED");
        assert.equal(result.promoted.length, 0);
      },
    },
    {
      name: "QA no ejecutado: fail-closed -- no se promueve nada (ausencia de QA nunca equivale a aprobado)",
      fn: () => {
        for (const qaStatus of ["not_available", "invalid_output", "failed", "blocked"] as const) {
          const result = resolvePromotion({
            departmentRunId: DEPARTMENT_RUN_ID,
            growth: { status: "executed", output: growthOutput([priority("Corregir el seguimiento de conversiones")]) },
            qa: { status: qaStatus },
          });
          assert.equal(result.departmentQaStatus, "NOT_AVAILABLE", `qaStatus=${qaStatus}`);
          assert.equal(result.promoted.length, 0, `qaStatus=${qaStatus}`);
          assert.equal(result.blocked.length, 1, `qaStatus=${qaStatus}`);
          assert.ok(result.globalBlockReason?.includes("Fail-closed"), `qaStatus=${qaStatus}`);
        }
      },
    },
    {
      name: "Growth no ejecutado: no hay nada que promover ni que bloquear, y se dice por que",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "invalid_output" },
          qa: { status: "executed", output: qaOutput() },
        });

        assert.equal(result.promoted.length, 0);
        assert.equal(result.blocked.length, 0);
        assert.ok(result.globalBlockReason?.includes("growth-director-v2"));
      },
    },
    {
      name: "QA PASS_WITH_WARNINGS: una correccion exigida que cita el titulo EXACTO bloquea SOLO esa recomendacion; el resto pasa",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "executed", output: growthOutput([priority("Corregir el seguimiento de conversiones"), priority("Publicar la pagina de taquillas metalicas")]) },
          qa: {
            status: "executed",
            output: qaOutput({
              reviewStatus: "pass_with_warnings",
              requiredCorrections: ['La recomendacion "Publicar la pagina de taquillas metalicas" no cita ninguna evidencia real.'],
            }),
          },
        });

        assert.equal(result.departmentQaStatus, "PASS_WITH_WARNINGS");
        assert.deepEqual(
          result.promoted.map((p) => p.title),
          ["Corregir el seguimiento de conversiones"]
        );
        assert.deepEqual(
          result.blocked.map((p) => p.title),
          ["Publicar la pagina de taquillas metalicas"]
        );
        assert.equal(result.blocked[0].blockedBy.length, 1);
        assert.equal(result.unattributedBlockingSignals.length, 0);
      },
    },
    {
      name: "Un hallazgo warning que cita una recomendacion NO la bloquea: la promueve marcada con el aviso",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "executed", output: growthOutput([priority("Publicar la pagina de taquillas metalicas")]) },
          qa: {
            status: "executed",
            output: qaOutput({
              reviewStatus: "pass_with_warnings",
              findings: [{ category: "evidence_coverage", severity: "warning", description: 'Publicar la pagina de taquillas metalicas se apoya en una sola fuente.' }],
            }),
          },
        });

        assert.equal(result.promoted.length, 1);
        assert.equal(result.promoted[0].decision, "promoted_with_warnings");
        assert.equal(result.promoted[0].qaWarnings.length, 1);
        assert.equal(result.blocked.length, 0);
      },
    },
    {
      name: "Una senal bloqueante que no cita ningun titulo no se pierde en silencio: queda en unattributedBlockingSignals",
      fn: () => {
        const result = resolvePromotion({
          departmentRunId: DEPARTMENT_RUN_ID,
          growth: { status: "executed", output: growthOutput([priority("Publicar la pagina de taquillas metalicas")]) },
          qa: { status: "executed", output: qaOutput({ reviewStatus: "pass_with_warnings", contradictions: ["Dos secciones del informe se contradicen sobre el numero de sesiones."] }) },
        });

        assert.equal(result.promoted.length, 1);
        assert.equal(result.unattributedBlockingSignals.length, 1);
        assert.ok(result.unattributedBlockingSignals[0].includes("contradiction"));
      },
    },
    {
      name: "signalMentionsTitle normaliza mayusculas, acentos y puntuacion, y no coincide con titulos demasiado cortos",
      fn: () => {
        assert.equal(signalMentionsTitle('Revisar "Optimizar la Medicion" antes de nada', "optimizar la medicion"), true);
        assert.equal(signalMentionsTitle("Falta evidencia en Optimizar la medicion.", "Optimizar la Medición"), true);
        assert.equal(signalMentionsTitle("Cualquier texto largo de QA", "SEO"), false);
        assert.equal(signalMentionsTitle("Nada que ver con esto", "Optimizar la medicion"), false);
      },
    },
    {
      name: "resolveDepartmentQaStatus mapea el vocabulario del empleado al del departamento (PASS / PASS_WITH_WARNINGS / BLOCKED / NOT_AVAILABLE)",
      fn: () => {
        assert.equal(resolveDepartmentQaStatus("executed", qaOutput()), "PASS");
        assert.equal(resolveDepartmentQaStatus("executed", qaOutput({ reviewStatus: "pass_with_warnings" })), "PASS_WITH_WARNINGS");
        assert.equal(resolveDepartmentQaStatus("executed", qaOutput({ reviewStatus: "fail" })), "BLOCKED");
        assert.equal(resolveDepartmentQaStatus("not_available", undefined), "NOT_AVAILABLE");
        assert.equal(resolveDepartmentQaStatus("executed", undefined), "NOT_AVAILABLE");
      },
    },
  ];
}
