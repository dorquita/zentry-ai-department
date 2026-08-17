/**
 * Tipo/validador/auditoria de dominio del empleado `qa-reviewer` -- ver
 * .claude/agents/qa-reviewer.md y docs/claude-employee-runtime.md. Mismo
 * patron que src/core/landing-architect-comparison.ts
 * (validateV2Output/auditV2OutputForFabrication), adaptado al dominio de
 * revision de calidad en vez de generacion de landing.
 *
 * FRONTERA: este modulo NO decide si un artifact revisado se aplica ni
 * sustituye a ningun guard deterministico existente
 * (subagent-tool-guard.ts, json-schema-lite.ts) -- solo tipa/valida/audita
 * la SALIDA de qa-reviewer sobre un artifact que otro proceso ya produjo.
 */
import type { ApprovalRequestStatus } from "../../core/types";
import type { AutonomyRiskLevel } from "../../core/autonomy-policy";

// Reusa EXACTAMENTE el mismo vocabulario que ApprovalRequestStatus
// (src/core/types.ts), DERIVADO por tipo (no reescrito a mano) como
// subconjunto deliberado: una recomendacion de revision nunca es
// "snoozed"/"expired"/"cancelled" -- esos son solo estados de ciclo de
// vida de una solicitud de aprobacion YA CREADA, no algo que un revisor
// pueda recomendar. `Extract<...>` (en vez de una union escrita a mano)
// significa que si ApprovalRequestStatus alguna vez deja de incluir uno
// de estos 3 literales, APPROVAL_RECOMMENDED_STATUSES (mas abajo) deja de
// compilar -- deriva real detectada por el compilador, no solo por un
// comentario.
export type QaApprovalRecommendedStatus = Extract<ApprovalRequestStatus, "approved" | "rejected" | "pending">;

// Reusa EXACTAMENTE (alias directo, no una copia) el mismo enum que
// AutonomyRiskLevel (src/core/autonomy-policy.ts) -- vocabulario de
// riesgo ya existente en el resto del departamento, en vez de inventar
// uno nuevo para qa-reviewer. Un cambio en AutonomyRiskLevel se propaga
// aqui automaticamente.
export type QaApprovalRiskLevel = AutonomyRiskLevel;

export type QaReviewStatus = "pass" | "pass_with_warnings" | "fail";

export type QaFindingCategory =
  | "schema_compliance"
  | "evidence_coverage"
  | "unsupported_claims"
  | "fabrication_risk"
  | "contradictions"
  | "actionability"
  | "priority_consistency"
  | "missing_assumptions"
  | "unsafe_actions"
  | "approval_requirements"
  | "other";

export type QaFindingSeverity = "info" | "warning" | "critical";

export interface QaFinding {
  category: QaFindingCategory;
  severity: QaFindingSeverity;
  description: string;
}

/**
 * Identidad del artifact bajo revision -- debe coincidir EXACTAMENTE
 * entre lo que el runner suministra en el contexto (ver context.ts) y lo
 * que Claude devuelve dentro de `QaReviewerOutput.reviewedArtifact`. Es
 * la unica garantia de que qa-reviewer esta revisando de verdad lo que se
 * le entrego, no otra cosa.
 */
export interface QaReviewedArtifactRef {
  sourceEmployee: string;
  artifactType: string;
  artifactId: string;
  artifactPath: string;
}

export interface QaApprovalRecommendation {
  recommendedStatus: QaApprovalRecommendedStatus;
  riskLevel: QaApprovalRiskLevel;
  rationale: string;
}

/**
 * Correccion estructurada tal y como la declara qa-reviewer. Es la forma
 * accionable de `requiredCorrections`: lo que permite reinvocar al
 * empleado responsable con un encargo concreto en vez de con una frase.
 *
 * OPCIONAL en el contrato (ver el schema): una revision que solo traiga
 * el texto plano sigue siendo valida, y el bucle de correccion la
 * degrada con su motivo en vez de rechazarla.
 */
export interface QaCorrectionRequestOutput {
  field: string;
  problem: string;
  expectedCriterion: string;
  evidence: string[];
  targetRecommendationId: string;
  blocking: boolean;
}

export interface QaReviewerOutput {
  reviewStatus: QaReviewStatus;
  reviewedArtifact: QaReviewedArtifactRef;
  findings: QaFinding[];
  unsupportedClaims: string[];
  contradictions: string[];
  safetyConcerns: string[];
  requiredCorrections: string[];
  correctionRequests?: QaCorrectionRequestOutput[];
  approvalRecommendation: QaApprovalRecommendation;
  evidence: string[];
  summary: string;
}

const REVIEW_STATUSES: QaReviewStatus[] = ["pass", "pass_with_warnings", "fail"];
const FINDING_CATEGORIES: QaFindingCategory[] = [
  "schema_compliance",
  "evidence_coverage",
  "unsupported_claims",
  "fabrication_risk",
  "contradictions",
  "actionability",
  "priority_consistency",
  "missing_assumptions",
  "unsafe_actions",
  "approval_requirements",
  "other",
];
const FINDING_SEVERITIES: QaFindingSeverity[] = ["info", "warning", "critical"];
const APPROVAL_RECOMMENDED_STATUSES: QaApprovalRecommendedStatus[] = ["approved", "rejected", "pending"];
const APPROVAL_RISK_LEVELS: QaApprovalRiskLevel[] = ["none", "low_medium", "medium", "high", "critical"];

const isString = (v: unknown): v is string => typeof v === "string";
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

function isReviewedArtifactRef(v: unknown): v is QaReviewedArtifactRef {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.sourceEmployee) && isString(o.artifactType) && isString(o.artifactId) && isString(o.artifactPath);
}

function isFinding(v: unknown): v is QaFinding {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.category) &&
    (FINDING_CATEGORIES as string[]).includes(o.category) &&
    isString(o.severity) &&
    (FINDING_SEVERITIES as string[]).includes(o.severity) &&
    isString(o.description)
  );
}

function isCorrectionRequest(v: unknown): v is QaCorrectionRequestOutput {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.field) &&
    isString(o.problem) &&
    isString(o.expectedCriterion) &&
    isStringArray(o.evidence) &&
    isString(o.targetRecommendationId) &&
    typeof o.blocking === "boolean"
  );
}

function isApprovalRecommendation(v: unknown): v is QaApprovalRecommendation {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.recommendedStatus) &&
    (APPROVAL_RECOMMENDED_STATUSES as string[]).includes(o.recommendedStatus) &&
    isString(o.riskLevel) &&
    (APPROVAL_RISK_LEVELS as string[]).includes(o.riskLevel) &&
    isString(o.rationale)
  );
}

/**
 * Valida (sin librerias externas -- ninguna dependencia nueva) que un
 * objeto crudo tiene la forma minima de un `QaReviewerOutput`. Fail-closed:
 * cualquier campo obligatorio ausente, del tipo equivocado, o con un
 * valor de enum invalido lanza -- nunca se "rellena" con un valor por
 * defecto que disfrazaria una salida rota del subagente como si fuera
 * valida. Mismo patron que validateV2Output()
 * (src/core/landing-architect-comparison.ts).
 */
export function validateQaReviewerOutput(raw: unknown): QaReviewerOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salida qa-reviewer invalida: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  if (!isString(o.reviewStatus) || !(REVIEW_STATUSES as string[]).includes(o.reviewStatus)) {
    throw new Error(`Salida qa-reviewer invalida: reviewStatus debe ser uno de ${REVIEW_STATUSES.join("/")}.`);
  }
  if (!isReviewedArtifactRef(o.reviewedArtifact)) {
    throw new Error("Salida qa-reviewer invalida: falta reviewedArtifact { sourceEmployee, artifactType, artifactId, artifactPath } (todos string).");
  }
  if (!Array.isArray(o.findings) || !o.findings.every(isFinding)) {
    throw new Error("Salida qa-reviewer invalida: findings debe ser QaFinding[] con category/severity/description validos.");
  }
  if (!isStringArray(o.unsupportedClaims)) {
    throw new Error("Salida qa-reviewer invalida: unsupportedClaims debe ser string[].");
  }
  if (!isStringArray(o.contradictions)) {
    throw new Error("Salida qa-reviewer invalida: contradictions debe ser string[].");
  }
  if (!isStringArray(o.safetyConcerns)) {
    throw new Error("Salida qa-reviewer invalida: safetyConcerns debe ser string[].");
  }
  if (!isStringArray(o.requiredCorrections)) {
    throw new Error("Salida qa-reviewer invalida: requiredCorrections debe ser string[].");
  }
  // `correctionRequests` es OPCIONAL a proposito. Es lo que permite la
  // correccion automatica dirigida, pero exigirlo convertiria en fallo de
  // schema una revision por lo demas perfecta -- y un fallo de schema
  // aqui bloquea la pasada entera. Si viene, tiene que estar bien; si no
  // viene, el bucle se apoya en `requiredCorrections` (ver
  // normalizeQaCorrections en src/department/qa-correction.ts).
  if (o.correctionRequests !== undefined && (!Array.isArray(o.correctionRequests) || !o.correctionRequests.every(isCorrectionRequest))) {
    throw new Error(
      "Salida qa-reviewer invalida: correctionRequests, si viene, debe ser QaCorrectionRequestOutput[] con field/problem/expectedCriterion/targetRecommendationId (string), evidence (string[]) y blocking (boolean)."
    );
  }
  if (!isApprovalRecommendation(o.approvalRecommendation)) {
    throw new Error("Salida qa-reviewer invalida: falta approvalRecommendation { recommendedStatus, riskLevel, rationale } valido.");
  }
  if (!isStringArray(o.evidence)) {
    throw new Error("Salida qa-reviewer invalida: evidence debe ser string[].");
  }
  if (!isString(o.summary)) {
    throw new Error("Salida qa-reviewer invalida: falta summary (string).");
  }

  return o as unknown as QaReviewerOutput;
}

/**
 * Chequeo de dominio LIGERO (no de schema): el `reviewedArtifact` que
 * Claude devuelve debe coincidir EXACTAMENTE con la identidad del
 * artifact que el runner le suministro en el contexto -- nunca al reves.
 * Fail-closed: cualquier discrepancia lanza, para que un subagente que
 * "afirme" haber revisado un artifact distinto del que realmente recibio
 * nunca produzca una revision aceptada como valida.
 */
export function assertReviewedArtifactMatches(expected: QaReviewedArtifactRef, actual: QaReviewedArtifactRef): void {
  const mismatches: string[] = [];
  if (actual.sourceEmployee !== expected.sourceEmployee) {
    mismatches.push(`sourceEmployee: esperado "${expected.sourceEmployee}", recibido "${actual.sourceEmployee}"`);
  }
  if (actual.artifactType !== expected.artifactType) {
    mismatches.push(`artifactType: esperado "${expected.artifactType}", recibido "${actual.artifactType}"`);
  }
  if (actual.artifactId !== expected.artifactId) {
    mismatches.push(`artifactId: esperado "${expected.artifactId}", recibido "${actual.artifactId}"`);
  }
  if (actual.artifactPath !== expected.artifactPath) {
    mismatches.push(`artifactPath: esperado "${expected.artifactPath}", recibido "${actual.artifactPath}"`);
  }
  if (mismatches.length > 0) {
    throw new Error(`qa-reviewer: reviewedArtifact no coincide con el artifact realmente suministrado en el contexto -- ${mismatches.join("; ")}`);
  }
}

export interface QaReviewSummaryCounts {
  overallPass: boolean;
  hasWarnings: boolean;
  criticalFindingsCount: number;
  warningFindingsCount: number;
  infoFindingsCount: number;
}

/**
 * Resumen deterministico derivado de la salida ya validada -- mismo
 * patron overallPass/hasWarnings que StagingQaResultSnapshot
 * (src/core/staging-qa-results.ts), en vez de inventar un vocabulario
 * nuevo de pass/fail. `overallPass` es estricto (falso ante cualquier
 * finding critical o cualquier safetyConcern real), `hasWarnings` cubre
 * el resto de señales de "no perfecto pero no bloqueante".
 */
export function summarizeQaReviewerOutput(output: QaReviewerOutput): QaReviewSummaryCounts {
  const criticalFindingsCount = output.findings.filter((f) => f.severity === "critical").length;
  const warningFindingsCount = output.findings.filter((f) => f.severity === "warning").length;
  const infoFindingsCount = output.findings.filter((f) => f.severity === "info").length;

  const overallPass = output.reviewStatus !== "fail" && criticalFindingsCount === 0 && output.safetyConcerns.length === 0;
  const hasWarnings = output.reviewStatus === "pass_with_warnings" || warningFindingsCount > 0 || output.unsupportedClaims.length > 0 || output.contradictions.length > 0;

  return { overallPass, hasWarnings, criticalFindingsCount, warningFindingsCount, infoFindingsCount };
}
