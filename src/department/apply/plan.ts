import { WebEngineerOutput } from "../../employees/web-engineer/types";
import { DepartmentPromotionResult, DepartmentRecommendation, signalMentionsTitle } from "../promotion";
import { attributeEvidenceRefToEmployees } from "../specialist-inputs";
import { OwnedStagingPage, resolveApplyCapability } from "./capability";
import { ResolvedChangePlan } from "../web-engineer-changeplan";
import { DepartmentChangeRequest } from "./change-types";
import {
  buildApplyItemId,
  buildRecommendationId,
  countApplyItems,
  DEPARTMENT_APPLY_CONTRACT_VERSION,
  DepartmentApplyItem,
  DepartmentApplySpecification,
  DepartmentApplyStatus,
  DepartmentApplySummary,
  emptyTraceability,
  ExecutablePlanRecord,
} from "./types";

/**
 * PLANIFICACION DEL APPLY: convierte lo que sobrevivio Growth + QA en
 * elementos de apply con contrato explicito.
 *
 * Modulo PURO (sin I/O, sin red): recibe la promocion ya resuelta, la
 * especificacion de web-engineer y el catalogo de paginas de staging
 * publicadas propias. Persistir, aplicar y aprobar son responsabilidad
 * de otros modulos.
 *
 * Orden de decision (fail-closed en cada paso):
 *
 *   1. Bloqueada por QA          -> `blocked` (nunca llega a plantearse aplicar)
 *   2. Sin executor determinista -> `requires_manual_staging_implementation`
 *   3. Resto                     -> `proposed` (candidata a apply automatico en STAGING)
 *
 * Ojo con el paso 3: `proposed` significa "se puede aplicar en STAGING",
 * que en este flujo NO requiere aprobacion humana previa. La aprobacion
 * humana gobierna exclusivamente el paso a produccion, y se pide despues,
 * sobre la version ya aplicada y validada en staging.
 */

export interface BuildApplyPlanInput {
  departmentRunId: string;
  promotion: DepartmentPromotionResult;
  webEngineer: { status: string; output?: WebEngineerOutput };
  ownedStagingPages: OwnedStagingPage[];
  /**
   * Planes YA resueltos contra el inventario real de staging. Es el
   * camino nuevo: sustituye a interpretar prosa buscando `page_id=N`.
   */
  resolvedChangePlans?: ResolvedChangePlan[];
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

export function resolvePlannedStatus(params: { isBlockedByQa: boolean; capabilitySupported: boolean; hasExecutablePlan?: boolean }): DepartmentApplyStatus {
  if (params.isBlockedByQa) return "blocked";
  // Un ChangePlan ejecutable YA resuelto contra el inventario real hace
  // accionable la recomendacion aunque la capacidad legacy (la que
  // interpretaba prosa buscando `page_id=N`) no la reconozca. Es
  // justamente el cuello de botella que este camino elimina.
  if (params.hasExecutablePlan) return "proposed";
  if (!params.capabilitySupported) return "requires_manual_staging_implementation";
  return "proposed";
}

export function buildApplyPlan(input: BuildApplyPlanInput): DepartmentApplySummary {
  const plansByRecommendationId = new Map((input.resolvedChangePlans ?? []).map((resolved) => [resolved.recommendationId, resolved]));
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

    const resolvedPlan = blockedByQa ? undefined : plansByRecommendationId.get(buildRecommendationId(input.departmentRunId, recommendation.rank));
    const executableChangePlan: ExecutablePlanRecord | null =
      resolvedPlan && resolvedPlan.status === "ACTIONABLE" && resolvedPlan.plan && resolvedPlan.capability && resolvedPlan.page
        ? {
            plan: resolvedPlan.plan,
            capability: resolvedPlan.capability,
            wordpressPageId: resolvedPlan.page.wordpressPageId,
            stagingUrl: resolvedPlan.page.stagingUrl,
            beforeValue: resolvedPlan.beforeValue,
            afterValue: resolvedPlan.afterValue,
            operation: resolvedPlan.operation,
            rationale: resolvedPlan.rationale,
          }
        : null;

    const applyStatus = resolvePlannedStatus({
      isBlockedByQa: blockedByQa,
      capabilitySupported: capability.supported,
      hasExecutablePlan: executableChangePlan !== null,
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
      impact: recommendation.impact,
      confidence: recommendation.confidence,
      effort: recommendation.effort,
      webEngineerSpecification: specification,
      humanApproval: {
        status: "none",
        approvalRequestId: null,
        answeredBy: null,
        answeredAt: null,
        reason:
          "Todavia no se ha pedido ninguna aprobacion humana: la solicitud se crea DESPUES de aplicar y validar el cambio en staging, y se refiere a esa version concreta.",
      },
      applyCapability: capability,
      executableChangePlan,
      applyStatus,
      validationStatus: "not_run",
      rollbackStatus: "not_needed",
      traceability: emptyTraceability(),
      auditTrail: [
        {
          at: nowIso,
          event: "planned",
          detail: `Elemento de apply construido a partir de la recomendacion #${recommendation.rank} de esta pasada. QA=${blockedByQa ? "BLOCKED" : input.promotion.departmentQaStatus}. Capacidad de apply: ${capability.supported ? String(capability.id) : "ninguna"} (${capability.reason})`,
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
    productionWritesPerformed: false,
    applyNotAttemptedReason: "Fase de planificacion: todavia no se ha intentado aplicar nada.",
  };
}

/**
 * Proyecta el estado REAL del registro persistente de cambios sobre los
 * elementos de la pasada. El artifact del run es efimero; la verdad vive
 * en el registro. Esta funcion (pura) es la que hace que el Daily Brief
 * pueda decir "aprobado"/"rechazado"/"publicado en produccion" con datos
 * que se decidieron horas o dias despues de generarse la pasada.
 */
export function projectChangesIntoSummary(summary: DepartmentApplySummary, changes: DepartmentChangeRequest[]): DepartmentApplySummary {
  const byRecommendation = new Map<string, DepartmentChangeRequest>();
  for (const change of changes) {
    const existing = byRecommendation.get(change.recommendationId);
    // La version MAS NUEVA de cada recomendacion es la que manda: una
    // aprobacion vieja nunca representa a una version nueva.
    if (!existing || change.version > existing.version) byRecommendation.set(change.recommendationId, change);
  }

  const items = summary.items.map((item) => {
    const change = byRecommendation.get(item.recommendationId);
    if (!change) return item;
    return {
      ...item,
      applyStatus: change.status,
      validationStatus: change.production?.validationStatus ?? change.staging?.validationStatus ?? item.validationStatus,
      rollbackStatus: change.production?.rollbackStatus ?? change.staging?.rollbackStatus ?? item.rollbackStatus,
      humanApproval: {
        status:
          // `approval_stale` NO es "aprobado": la version aprobada ya no
          // es la que hay en staging, asi que no se puede afirmar que
          // haya aprobacion valida -> `unknown`, que es el valor
          // fail-closed de este campo.
          change.status === "approval_stale"
            ? ("unknown" as const)
            : change.humanDecision?.decision === "approved"
              ? ("approved" as const)
              : change.humanDecision?.decision === "rejected"
                ? ("rejected" as const)
                : change.telegram
                  ? ("pending" as const)
                  : ("none" as const),
        approvalRequestId: change.telegram?.telegramApprovalId ?? null,
        answeredBy: change.humanDecision?.decidedBy ?? null,
        answeredAt: change.humanDecision?.decidedAt ?? null,
        reason:
          change.status === "approval_stale"
            ? "La aprobacion ya no se refiere a lo que hay en staging (staging cambio despues de enviarla). Hace falta una aprobacion nueva sobre la version actual."
            : change.humanDecision?.decision === "rejected" && change.humanDecision.rejectionReason
              ? `Rechazado por ${change.humanDecision.decidedBy}: ${change.humanDecision.rejectionReason}`
              : change.humanDecision
                ? `Decision humana "${change.humanDecision.decision}" registrada (${change.humanDecision.decidedBy}, ${change.humanDecision.decidedAt}).`
                : change.telegram
                  ? "Solicitud de aprobacion enviada por Telegram y pendiente de respuesta humana."
                  : item.humanApproval.reason,
      },
      traceability: {
        changeId: change.changeId,
        version: change.version,
        stagingChangeId: change.staging?.applyId ?? null,
        stagingUrl: change.staging?.url ?? null,
        telegramApprovalId: change.telegram?.telegramApprovalId ?? null,
        telegramMessageId: change.telegram?.telegramMessageId ?? null,
        productionApplyId: change.production?.applyId ?? null,
        productionUrl: change.production?.url ?? null,
        stagingVersionHash: change.telegram?.stagingVersionHash ?? change.staging?.resultingVersionHash ?? null,
      },
    };
  });

  return {
    ...summary,
    items,
    counts: countApplyItems(items),
    productionWritesPerformed: items.some((item) => item.traceability.productionApplyId !== null),
  };
}
