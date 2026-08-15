import { WebEngineerOutput } from "../../employees/web-engineer/types";
import { DepartmentPromotionResult, DepartmentRecommendation, signalMentionsTitle } from "../promotion";
import { attributeEvidenceRefToEmployees } from "../specialist-inputs";
import { ApprovalSnapshotLike, resolveHumanApproval } from "./approval";
import { OwnedStagingPage, resolveApplyCapability } from "./capability";
import {
  buildApplyItemId,
  buildRecommendationId,
  countApplyItems,
  DEPARTMENT_APPLY_CONTRACT_VERSION,
  DepartmentApplyItem,
  DepartmentApplySpecification,
  DepartmentApplyStatus,
  DepartmentApplySummary,
} from "./types";

/**
 * PLANIFICACION DEL APPLY: convierte lo que sobrevivio Growth + QA en
 * elementos de apply con contrato explicito.
 *
 * Modulo PURO (sin I/O, sin red): recibe la promocion ya resuelta, la
 * especificacion de web-engineer, el catalogo de paginas de staging
 * propias y las solicitudes de aprobacion ya leidas. Persistir y ejecutar
 * son responsabilidad de otros modulos.
 *
 * Orden de decision (fail-closed en cada paso):
 *
 *   1. Bloqueada por QA            -> `blocked` (nunca llega a plantearse aplicar)
 *   2. Sin executor determinista   -> `requires_manual_implementation`
 *   3. Aprobacion humana `unknown` -> `blocked`
 *   4. Aprobacion `rejected`       -> `rejected`
 *   5. Aprobacion `approved`       -> `approved` (unico estado que puede entrar al executor)
 *   6. Resto                       -> `awaiting_approval`
 *
 * QA nunca aparece en los pasos 3-6: un `PASS` de QA no mueve nada hacia
 * `approved`.
 */

export interface BuildApplyPlanInput {
  departmentRunId: string;
  promotion: DepartmentPromotionResult;
  webEngineer: { status: string; output?: WebEngineerOutput };
  ownedStagingPages: OwnedStagingPage[];
  approvalRequests: ApprovalSnapshotLike[];
  now?: Date;
}

function toSpecification(output: WebEngineerOutput, changes: WebEngineerOutput["proposedChanges"]): DepartmentApplySpecification {
  return {
    implementationSummary: output.implementationSummary,
    proposedChanges: changes.map((c) => ({ description: c.description, rationale: c.rationale, targetPageOrComponent: c.targetPageOrComponent })),
    acceptanceCriteria: [...output.acceptanceCriteria],
    validationPlan: [...output.validationPlan],
    rollbackPlan: [...output.rollbackPlan],
    approvalRequired: output.approvalRequired,
  };
}

/**
 * Atribuye cambios propuestos a UNA recomendacion por coincidencia
 * literal del titulo normalizado -- exactamente el mismo criterio (y las
 * mismas limitaciones documentadas) que usa la puerta de QA en
 * promotion.ts, en vez de inventar aqui una heuristica distinta.
 *
 * Caso especial DELIBERADO: si la pasada promovio UNA sola recomendacion,
 * toda la especificacion es suya -- no hay ambiguedad posible.
 */
export function selectChangesForRecommendation(
  output: WebEngineerOutput,
  recommendation: DepartmentRecommendation,
  promotedCount: number
): WebEngineerOutput["proposedChanges"] {
  const matched = output.proposedChanges.filter((change) =>
    [change.description, change.rationale, change.targetPageOrComponent].some((text) => signalMentionsTitle(text, recommendation.title))
  );
  if (matched.length > 0) return matched;
  return promotedCount === 1 ? [...output.proposedChanges] : [];
}

function resolveStatus(params: {
  isBlockedByQa: boolean;
  capabilitySupported: boolean;
  approvalStatus: "none" | "pending" | "approved" | "rejected" | "unknown";
}): DepartmentApplyStatus {
  if (params.isBlockedByQa) return "blocked";
  if (!params.capabilitySupported) return "requires_manual_implementation";
  if (params.approvalStatus === "unknown") return "blocked";
  if (params.approvalStatus === "rejected") return "rejected";
  if (params.approvalStatus === "approved") return "approved";
  return "awaiting_approval";
}

export function buildApplyPlan(input: BuildApplyPlanInput): DepartmentApplySummary {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const webOutput = input.webEngineer.status === "executed" ? input.webEngineer.output : undefined;
  const promotedCount = input.promotion.promoted.length;

  const all: { recommendation: DepartmentRecommendation; blockedByQa: boolean }[] = [
    ...input.promotion.promoted.map((recommendation) => ({ recommendation, blockedByQa: false })),
    ...input.promotion.blocked.map((recommendation) => ({ recommendation, blockedByQa: true })),
  ].sort((a, b) => a.recommendation.rank - b.recommendation.rank);

  const items: DepartmentApplyItem[] = all.map(({ recommendation, blockedByQa }) => {
    const applyItemId = buildApplyItemId(input.departmentRunId, recommendation.rank);
    const changes = webOutput && !blockedByQa ? selectChangesForRecommendation(webOutput, recommendation, promotedCount) : [];
    const specification = webOutput && !blockedByQa && changes.length > 0 ? toSpecification(webOutput, changes) : null;

    const specificationTexts = specification
      ? [
          specification.implementationSummary,
          ...specification.proposedChanges.flatMap((c) => [c.description, c.rationale, c.targetPageOrComponent]),
          ...specification.acceptanceCriteria,
          ...(webOutput?.targetPages ?? []),
        ]
      : [];

    const capability = blockedByQa
      ? {
          id: null,
          supported: false,
          reason: "Recomendacion bloqueada por QA en esta pasada: no se evalua ninguna capacidad de apply para ella.",
          target: null,
        }
      : resolveApplyCapability({
          specificationTexts,
          ownedStagingPages: input.ownedStagingPages,
          hasSpecification: specification !== null,
        });

    // La aprobacion se resuelve SIEMPRE (aunque no haya executor):
    // saberlo es parte de la trazabilidad, y jamas se usa para relajar
    // nada -- solo puede restringir.
    const humanApproval = resolveHumanApproval({ applyItemId, requests: input.approvalRequests, now });

    const applyStatus = resolveStatus({
      isBlockedByQa: blockedByQa,
      capabilitySupported: capability.supported,
      approvalStatus: humanApproval.status,
    });

    return {
      contractVersion: DEPARTMENT_APPLY_CONTRACT_VERSION,
      applyItemId,
      recommendationId: buildRecommendationId(input.departmentRunId, recommendation.rank),
      recommendationRank: recommendation.rank,
      departmentRunId: input.departmentRunId,
      sourceAgents: [...new Set(recommendation.evidenceRefs.flatMap((ref) => attributeEvidenceRefToEmployees(ref)))],
      title: recommendation.title,
      target: webOutput && !blockedByQa ? [...webOutput.targetPages, ...webOutput.targetComponents].join(" | ") : "(sin objetivo tecnico declarado en esta pasada)",
      proposedChange: recommendation.rationale,
      evidenceRefs: [...recommendation.evidenceRefs],
      qaStatus: blockedByQa ? "BLOCKED" : recommendation.decision === "promoted_with_warnings" ? "PASS_WITH_WARNINGS" : input.promotion.departmentQaStatus,
      webEngineerSpecification: specification,
      humanApproval,
      applyCapability: capability,
      applyStatus,
      validationStatus: "not_run",
      rollbackStatus: "not_needed",
      snapshot: null,
      auditTrail: [
        {
          at: nowIso,
          event: "planned",
          detail: `Elemento de apply construido a partir de la recomendacion #${recommendation.rank} de esta pasada. QA=${blockedByQa ? "BLOCKED" : input.promotion.departmentQaStatus}. Capacidad de apply: ${capability.supported ? String(capability.id) : "ninguna"} (${capability.reason}). Aprobacion humana: ${humanApproval.status} (${humanApproval.reason})`,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  return {
    contractVersion: DEPARTMENT_APPLY_CONTRACT_VERSION,
    departmentRunId: input.departmentRunId,
    generatedAt: nowIso,
    items,
    counts: countApplyItems(items),
    externalWritesPerformed: false,
    applyNotAttemptedReason: "Fase de planificacion: todavia no se ha intentado aplicar nada.",
  };
}
