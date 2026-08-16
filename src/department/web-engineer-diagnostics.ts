import { ChangePlanResolution, ResolvedChangePlan } from "./web-engineer-changeplan";
import { DepartmentWebEngineerContext } from "./web-engineer-input";
import { RecommendationTargetStatus } from "./target-resolution";

/**
 * DIAGNOSTICO ESTRUCTURADO DE `web-engineer` -- una fila por
 * recomendacion procesada, para que "0 ChangePlans" nunca vuelva a ser
 * un numero sin explicacion.
 *
 * El problema que resuelve es concreto: hasta ahora, las ocho
 * recomendaciones de una pasada acababan las ocho en
 * `requires_manual_staging_implementation` con el MISMO texto, aunque
 * las causas fueran completamente distintas (una no tenia pagina, otra
 * si la tenia pero pedia una redireccion que esta capa no sabe hacer,
 * otra era una decision humana y no un cambio web). Sin separar esas
 * causas no hay forma de saber que hay que arreglar despues.
 *
 * CONTENIDO: este artefacto NO lleva texto de negocio ni contenido de
 * pagina -- solo ids, estados, longitudes y motivos tecnicos. Es
 * diagnostico, no una copia de la propuesta.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

export const WEB_ENGINEER_DIAGNOSTICS_CONTRACT_VERSION = "web-engineer-diagnostics/v1";

/**
 * Estado final de UNA recomendacion respecto a producir un ChangePlan.
 * Amplia `ChangePlanResolution` con los dos casos que ocurren ANTES de
 * que exista draft alguno.
 */
export type RecommendationChangePlanStatus =
  | ChangePlanResolution
  | "qa_blocked"
  | "no_change_plan_declared";

export interface WebEngineerRecommendationDiagnostic {
  recommendationId: string;
  rank: number;
  /** Empleados de los que procede la recomendacion, por sus evidenceRefs. */
  sourceEmployees: string[];
  /** Referencias de pagina citadas literalmente por la recomendacion/evidencia. */
  targetReferences: string[];
  targetResolution: RecommendationTargetStatus | "not_evaluated";
  /** Pagina resuelta de forma determinista por el departamento. `null` = ninguna. */
  pageIdResolved: number | null;
  /** `true` si el contexto llevaba el BEFORE completo de esa pagina. */
  beforeAvailable: boolean;
  /** `true` si web-engineer declaro un valor nuevo para esta recomendacion. */
  afterDeclared: boolean;
  /** Longitud del valor propuesto. Nunca su contenido. */
  afterLength: number;
  operationResolved: string | null;
  /** `native_ability` | `execute_php_fallback` | null. */
  capabilityResolved: string | null;
  changePlanStatus: RecommendationChangePlanStatus;
  /** Siempre no vacio. */
  reason: string;
}

export interface WebEngineerDiagnostics {
  contractVersion: string;
  departmentRunId: string;
  /** Paginas publicadas leidas de staging en esta pasada. */
  stagingInventorySize: number;
  stagingInventoryUnavailableReason: string;
  /** Cuantos `changePlans[]` declaro el modelo, antes de resolverlos. */
  changePlansDeclared: number;
  /** Drafts descartados por forma invalida, con su motivo literal. */
  changePlansRejected: string[];
  changePlansActionable: number;
  recommendations: WebEngineerRecommendationDiagnostic[];
  /** Recuento por estado -- lo que se imprime en el log y en el step summary. */
  countsByStatus: Record<string, number>;
}

export interface BuildWebEngineerDiagnosticsInput {
  departmentRunId: string;
  context: DepartmentWebEngineerContext;
  /** Planes ya resueltos contra el inventario real. */
  resolved: ResolvedChangePlan[];
  /** Drafts rechazados por `parseChangePlanDrafts` (forma invalida). */
  rejectedDrafts: string[];
  /** Cuantos drafts declaro el modelo (incluidos los rechazados por forma). */
  declaredCount: number;
  /** Trazabilidad inversa evidenceRef -> empleado(s). Inyectada para mantener este modulo puro. */
  attributeEvidenceRef: (ref: string) => string[];
  /** Ids de recomendaciones bloqueadas por QA, con su motivo. */
  blocked?: { recommendationId: string; rank: number; blockedBy: string[] }[];
}

export function buildWebEngineerDiagnostics(input: BuildWebEngineerDiagnosticsInput): WebEngineerDiagnostics {
  const { context } = input;
  const resolvedById = new Map<string, ResolvedChangePlan>();
  for (const plan of input.resolved) {
    // Si el modelo declara varios planes para la misma recomendacion, el
    // ACTIONABLE manda: es el que llega a la capa de apply.
    const existing = resolvedById.get(plan.recommendationId);
    if (!existing || (existing.status !== "ACTIONABLE" && plan.status === "ACTIONABLE")) resolvedById.set(plan.recommendationId, plan);
  }
  const snapshotById = new Map(context.targetPageSnapshots.map((s) => [s.wordpressPageId, s]));

  const recommendations: WebEngineerRecommendationDiagnostic[] = context.approvedRecommendations.map((rec) => {
    const plan = resolvedById.get(rec.recommendationId);
    const pageIdResolved = rec.resolvedTargets.length === 1 ? rec.resolvedTargets[0].wordpressPageId : null;
    const snapshot = pageIdResolved === null ? undefined : snapshotById.get(pageIdResolved);

    const base = {
      recommendationId: rec.recommendationId,
      rank: rec.rank,
      sourceEmployees: [...new Set(rec.evidenceRefs.flatMap((ref) => input.attributeEvidenceRef(ref)))],
      targetReferences: rec.resolvedTargets.map((t) => t.citedAs),
      targetResolution: rec.targetResolutionStatus,
      pageIdResolved,
      beforeAvailable: snapshot !== undefined && snapshot.contentAvailable,
    };

    if (plan) {
      return {
        ...base,
        afterDeclared: plan.afterValue.length > 0,
        afterLength: plan.afterValue.length,
        operationResolved: plan.operation.length > 0 ? plan.operation : null,
        capabilityResolved: plan.capability?.executionPath ?? null,
        changePlanStatus: plan.resolution,
        reason: plan.reason,
      };
    }

    return {
      ...base,
      afterDeclared: false,
      afterLength: 0,
      operationResolved: null,
      capabilityResolved: null,
      changePlanStatus: "no_change_plan_declared" as const,
      reason:
        rec.targetResolutionStatus === "resolved"
          ? `web-engineer NO declaro ningun changePlan pese a que el departamento le entrego la pagina objetivo ya resuelta. ${rec.targetResolutionReason}${snapshot && !snapshot.contentAvailable ? ` Ademas, el BEFORE del cuerpo no estaba disponible: ${snapshot.contentUnavailableReason}` : ""} Queda como implementacion manual: revisar si la recomendacion admite alguna operacion del catalogo o si es trabajo que esta capa no cubre.`
          : `web-engineer no declaro ningun changePlan para esta recomendacion. ${rec.targetResolutionReason}`,
    };
  });

  for (const blocked of input.blocked ?? []) {
    recommendations.push({
      recommendationId: blocked.recommendationId,
      rank: blocked.rank,
      sourceEmployees: [],
      targetReferences: [],
      targetResolution: "not_evaluated",
      pageIdResolved: null,
      beforeAvailable: false,
      afterDeclared: false,
      afterLength: 0,
      operationResolved: null,
      capabilityResolved: null,
      changePlanStatus: "qa_blocked",
      reason: `Bloqueada por QA en esta pasada: ${blocked.blockedBy.join(" | ") || "sin motivo literal registrado"}. No se evalua ninguna capacidad de apply para ella.`,
    });
  }

  recommendations.sort((a, b) => a.rank - b.rank);

  const countsByStatus: Record<string, number> = {};
  for (const rec of recommendations) countsByStatus[rec.changePlanStatus] = (countsByStatus[rec.changePlanStatus] ?? 0) + 1;

  return {
    contractVersion: WEB_ENGINEER_DIAGNOSTICS_CONTRACT_VERSION,
    departmentRunId: input.departmentRunId,
    stagingInventorySize: context.stagingInventory.length,
    stagingInventoryUnavailableReason: context.stagingInventoryUnavailableReason,
    changePlansDeclared: input.declaredCount,
    changePlansRejected: [...input.rejectedDrafts],
    changePlansActionable: input.resolved.filter((r) => r.status === "ACTIONABLE").length,
    recommendations,
    countsByStatus,
  };
}

/** Tabla de una linea por recomendacion, para el log de la Action y el step summary. */
export function renderWebEngineerDiagnosticsLines(diagnostics: WebEngineerDiagnostics): string[] {
  const lines: string[] = [];
  lines.push(
    `Diagnostico de web-engineer: ${diagnostics.changePlansDeclared} changePlan(s) declarado(s), ${diagnostics.changePlansActionable} ACTIONABLE, inventario de staging = ${diagnostics.stagingInventorySize} pagina(s).`
  );
  for (const rec of diagnostics.recommendations) {
    lines.push(
      `  [${rec.changePlanStatus}] #${rec.rank} ${rec.recommendationId} target=${rec.targetResolution} pageId=${rec.pageIdResolved ?? "-"} before=${rec.beforeAvailable ? "si" : "no"} after=${rec.afterDeclared ? `si(${rec.afterLength})` : "no"} op=${rec.operationResolved ?? "-"} camino=${rec.capabilityResolved ?? "-"} :: ${rec.reason}`
    );
  }
  for (const rejected of diagnostics.changePlansRejected) lines.push(`  [draft_rechazado] ${rejected}`);
  return lines;
}
