import { GrowthDirectorV2Output, GrowthPriority } from "../employees/growth-director-v2/types";
import { QaReviewerOutput, summarizeQaReviewerOutput } from "../employees/qa-reviewer/output";
import { DepartmentQaStatus, DepartmentStageStatus } from "./types";

/**
 * FASE 3 -> FASE 4: la PUERTA. Decide, de forma DETERMINISTA (sin
 * modelo, sin heuristica de lenguaje natural mas alla de una
 * coincidencia literal de titulo), que recomendaciones de Growth
 * sobreviven a QA y pueden llegar a web-engineer.
 *
 * Fail-closed en las tres direcciones que importan:
 *
 * - Si Growth no produjo sintesis valida -> no se promueve NADA.
 * - Si QA no llego a ejecutarse (o su salida no es valida) -> no se
 *   promueve NADA. "QA no se pronuncio" nunca significa "aprobado".
 * - Si QA marca el conjunto como BLOCKED (`reviewStatus: "fail"`, o
 *   cualquier hallazgo `critical`, o cualquier `safetyConcern`) -> no se
 *   promueve NADA.
 *
 * Y, cuando QA si aprueba el conjunto, sigue bloqueando UNA A UNA las
 * recomendaciones cuyo titulo aparezca citado en las senales
 * bloqueantes de QA (`requiredCorrections`, `contradictions`,
 * `unsupportedClaims`, hallazgos `critical`, `safetyConcerns`).
 *
 * LIMITACION CONOCIDA Y DELIBERADA: la atribucion "esta senal de QA
 * habla de esta recomendacion" se hace por coincidencia LITERAL del
 * titulo normalizado (minusculas, sin diacriticos, sin puntuacion)
 * dentro del texto de la senal -- por eso las instrucciones que se le
 * pasan a QA le piden citar el titulo EXACTO. Una senal bloqueante que
 * no coincida con ningun titulo NO se pierde: queda registrada en
 * `unattributedBlockingSignals[]` y se muestra en el daily brief. No se
 * usa para bloquear en silencio ni se descarta.
 */

const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

/** Longitud minima del titulo normalizado para intentar la coincidencia literal (por debajo, el riesgo de coincidir con cualquier frase es alto). */
export const MIN_TITLE_MATCH_LENGTH = 8;

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function signalMentionsTitle(signalText: string, title: string): boolean {
  const normalizedTitle = normalizeForMatch(title);
  if (normalizedTitle.length < MIN_TITLE_MATCH_LENGTH) return false;
  return normalizeForMatch(signalText).includes(normalizedTitle);
}

export type PromotionDecision = "promoted" | "promoted_with_warnings" | "blocked";

export interface DepartmentRecommendation {
  /** Indice (1-based) dentro de `recommendedPriorities[]` de Growth -- trazabilidad exacta al origen. */
  rank: number;
  title: string;
  rationale: string;
  impact: GrowthPriority["impact"];
  confidence: GrowthPriority["confidence"];
  effort: GrowthPriority["effort"];
  dependsOn: string[];
  evidenceRefs: string[];
  decision: PromotionDecision;
  /** Textos LITERALES de QA que bloquean esta recomendacion (vacio si no esta bloqueada). */
  blockedBy: string[];
  /** Textos LITERALES de QA que la marcan como debil sin bloquearla. */
  qaWarnings: string[];
}

export interface DepartmentPromotionResult {
  departmentRunId: string;
  departmentQaStatus: DepartmentQaStatus;
  qaReviewStatus: QaReviewerOutput["reviewStatus"] | null;
  /** Motivo cuando NADA se promueve por una razon global (Growth ausente, QA ausente, QA BLOCKED). `null` si la puerta se evaluo recomendacion a recomendacion. */
  globalBlockReason: string | null;
  promoted: DepartmentRecommendation[];
  blocked: DepartmentRecommendation[];
  /** Senales bloqueantes de QA que no se pudieron atribuir a ninguna recomendacion concreta -- se reportan, nunca se descartan. */
  unattributedBlockingSignals: string[];
  qaSummary: {
    criticalFindings: number;
    warningFindings: number;
    safetyConcerns: number;
    contradictions: number;
    unsupportedClaims: number;
    requiredCorrections: number;
  } | null;
}

export interface PromotionInput {
  departmentRunId: string;
  growth: { status: DepartmentStageStatus; output?: GrowthDirectorV2Output };
  qa: { status: DepartmentStageStatus; output?: QaReviewerOutput };
}

function toRecommendation(priority: GrowthPriority, index: number, decision: PromotionDecision, blockedBy: string[], qaWarnings: string[]): DepartmentRecommendation {
  return {
    rank: index + 1,
    title: priority.title,
    rationale: priority.rationale,
    impact: priority.impact,
    confidence: priority.confidence,
    effort: priority.effort,
    dependsOn: priority.dependsOn,
    evidenceRefs: priority.evidenceRefs,
    decision,
    blockedBy,
    qaWarnings,
  };
}

function blockAll(input: PromotionInput, departmentQaStatus: DepartmentQaStatus, qaReviewStatus: QaReviewerOutput["reviewStatus"] | null, reason: string, qaSummary: DepartmentPromotionResult["qaSummary"]): DepartmentPromotionResult {
  const priorities = input.growth.output?.recommendedPriorities ?? [];
  return {
    departmentRunId: input.departmentRunId,
    departmentQaStatus,
    qaReviewStatus,
    globalBlockReason: reason,
    promoted: [],
    blocked: priorities.map((p, i) => toRecommendation(p, i, "blocked", [reason], [])),
    unattributedBlockingSignals: [],
    qaSummary,
  };
}

export function resolveDepartmentQaStatus(qaStatus: DepartmentStageStatus, output?: QaReviewerOutput): DepartmentQaStatus {
  if (qaStatus !== "executed" || !output) return "NOT_AVAILABLE";
  const counts = summarizeQaReviewerOutput(output);
  // `overallPass` es la regla del PROPIO empleado (reviewStatus !== fail
  // && sin hallazgos critical && sin safetyConcerns) -- se reutiliza tal
  // cual en vez de reimplementar aqui otro criterio distinto.
  if (!counts.overallPass) return "BLOCKED";
  return counts.hasWarnings ? "PASS_WITH_WARNINGS" : "PASS";
}

export function resolvePromotion(input: PromotionInput): DepartmentPromotionResult {
  const qaOutput = input.qa.status === "executed" ? input.qa.output : undefined;
  const qaSummary = qaOutput
    ? {
        criticalFindings: qaOutput.findings.filter((f) => f.severity === "critical").length,
        warningFindings: qaOutput.findings.filter((f) => f.severity === "warning").length,
        safetyConcerns: qaOutput.safetyConcerns.length,
        contradictions: qaOutput.contradictions.length,
        unsupportedClaims: qaOutput.unsupportedClaims.length,
        requiredCorrections: qaOutput.requiredCorrections.length,
      }
    : null;
  const departmentQaStatus = resolveDepartmentQaStatus(input.qa.status, qaOutput);
  const qaReviewStatus = qaOutput?.reviewStatus ?? null;

  if (input.growth.status !== "executed" || !input.growth.output) {
    return {
      departmentRunId: input.departmentRunId,
      departmentQaStatus,
      qaReviewStatus,
      globalBlockReason: `growth-director-v2 no produjo una sintesis valida en esta pasada (status=${input.growth.status}) -- no hay ninguna prioridad del departamento que promover a ingenieria.`,
      promoted: [],
      blocked: [],
      unattributedBlockingSignals: [],
      qaSummary,
    };
  }

  if (departmentQaStatus === "NOT_AVAILABLE") {
    return blockAll(
      input,
      departmentQaStatus,
      qaReviewStatus,
      `qa-reviewer no emitio una revision valida en esta pasada (status=${input.qa.status}). Fail-closed: sin QA no se promueve ninguna recomendacion a web-engineer -- "QA no se pronuncio" nunca equivale a "aprobado".`,
      qaSummary
    );
  }

  if (departmentQaStatus === "BLOCKED") {
    return blockAll(
      input,
      departmentQaStatus,
      qaReviewStatus,
      `qa-reviewer marco el conjunto como BLOCKED (reviewStatus=${qaReviewStatus}, hallazgos critical=${qaSummary?.criticalFindings ?? 0}, safetyConcerns=${qaSummary?.safetyConcerns ?? 0}). Ninguna recomendacion se promueve a web-engineer.`,
      qaSummary
    );
  }

  // QA aprobo el conjunto: puerta recomendacion a recomendacion.
  const blockingSignals: string[] = [
    ...(qaOutput?.findings.filter((f) => f.severity === "critical").map((f) => `[finding critical/${f.category}] ${f.description}`) ?? []),
    ...(qaOutput?.safetyConcerns.map((s) => `[safetyConcern] ${s}`) ?? []),
    ...(qaOutput?.requiredCorrections.map((s) => `[requiredCorrection] ${s}`) ?? []),
    ...(qaOutput?.contradictions.map((s) => `[contradiction] ${s}`) ?? []),
    ...(qaOutput?.unsupportedClaims.map((s) => `[unsupportedClaim] ${s}`) ?? []),
  ];
  const warningSignals: string[] = qaOutput?.findings.filter((f) => f.severity === "warning").map((f) => `[finding warning/${f.category}] ${f.description}`) ?? [];

  const promoted: DepartmentRecommendation[] = [];
  const blocked: DepartmentRecommendation[] = [];
  const attributedSignals = new Set<string>();

  input.growth.output.recommendedPriorities.forEach((priority, index) => {
    const blockedBy = blockingSignals.filter((signal) => signalMentionsTitle(signal, priority.title));
    const qaWarnings = warningSignals.filter((signal) => signalMentionsTitle(signal, priority.title));
    blockedBy.forEach((s) => attributedSignals.add(s));
    if (blockedBy.length > 0) {
      blocked.push(toRecommendation(priority, index, "blocked", blockedBy, qaWarnings));
      return;
    }
    promoted.push(toRecommendation(priority, index, qaWarnings.length > 0 ? "promoted_with_warnings" : "promoted", [], qaWarnings));
  });

  return {
    departmentRunId: input.departmentRunId,
    departmentQaStatus,
    qaReviewStatus,
    globalBlockReason: null,
    promoted,
    blocked,
    unattributedBlockingSignals: blockingSignals.filter((s) => !attributedSignals.has(s)),
    qaSummary,
  };
}
