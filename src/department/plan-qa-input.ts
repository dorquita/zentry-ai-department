import { WebEngineerOutput } from "../employees/web-engineer/types";
import { QaCorrectionRequest } from "./qa-correction";
import { ResolvedChangePlan } from "./web-engineer-changeplan";
import { DEPARTMENT_RUN_CONTRACT_VERSION } from "./types";

/**
 * QA DEL PLAN -- la revision que faltaba.
 *
 * Hasta ahora qa-reviewer revisaba los outputs de los especialistas y la
 * sintesis de Growth, y despues web-engineer producia la especificacion
 * tecnica y los ChangePlans SIN que nadie los revisara. El orden real
 * era:
 *
 *     especialistas -> Growth -> QA -> web-engineer -> APPLY
 *                                                 ^
 *                                     nada revisa esto
 *
 * Es decir: lo unico que de verdad se escribe en staging era justo lo
 * unico que no pasaba por QA. El orden correcto, y el que implementa
 * esta capa, es:
 *
 *     recomendacion -> ChangePlan -> QA DEL PLAN -> PASS -> apply staging
 *
 * Igual que `qa-input.ts`, esta capa NO modifica ni reimplementa
 * qa-reviewer: su runner ya acepta cualquier artifact JSON via
 * `--artifact-path` y ata la identidad de lo revisado al fichero que se
 * le entrego. Aqui solo se construye ESE fichero.
 */

export interface PlanQaChangePlanSummary {
  recommendationId: string;
  status: string;
  resolution: string;
  operation: string;
  wordpressPageId: number | null;
  stagingUrl: string;
  /** Valor REAL actual, leido del sitio. Nunca declarado por el modelo. */
  beforeValue: string;
  afterValue: string;
  rationale: string;
  reason: string;
}

export interface DepartmentPlanQaInputBundle {
  contractVersion: string;
  departmentRunId: string;
  generatedAt: string;
  /** Ronda del bucle de correccion. 0 = la propuesta original. */
  round: number;
  reviewInstructionsForQa: string[];
  /** Recomendaciones aprobadas por Growth+QA que web-engineer tenia que resolver. */
  approvedRecommendations: { recommendationId: string; rank: number; title: string; rationale: string }[];
  webEngineerOutput: WebEngineerOutput;
  changePlans: PlanQaChangePlanSummary[];
  /**
   * Correcciones que QA pidio en la ronda ANTERIOR. Vacio en la ronda 0.
   * Van aqui para que la re-QA pueda comprobar una cosa concreta: si lo
   * que pidio quedo resuelto de verdad.
   */
  previousCorrections: QaCorrectionRequest[];
}

export const PLAN_QA_REVIEW_INSTRUCTIONS: string[] = [
  "Este artifact es la ESPECIFICACION TECNICA y los CHANGEPLANS que ha producido web-engineer para las recomendaciones ya aprobadas por Growth y por la revision anterior de QA.",
  "Es lo ULTIMO que se revisa antes de que el sistema escriba de verdad en staging. Un ChangePlan con estado ACTIONABLE que sobreviva esta revision SE EJECUTARA automaticamente sobre una pagina real. Revisalo con ese peso.",
  "Comprueba, plan a plan: (a) que el cambio responde de verdad a la recomendacion que dice responder, (b) que el valor nuevo (`afterValue`) es correcto, completo y publicable tal cual, (c) que no contradice el valor actual real (`beforeValue`) por accidente, (d) que la pagina objetivo es la que corresponde a la recomendacion.",
  "`beforeValue` es el estado REAL leido del sitio, no una declaracion del modelo: si el cambio propuesto ignora lo que ya hay, eso es un hallazgo.",
  "Vigila especialmente el contenido que se escribe: texto que promete plazos, cifras, garantias o afirmaciones de negocio no confirmadas es un `safetyConcern`, no un matiz de estilo.",
  "Un plan que NO es ACTIONABLE no se va a ejecutar: no lo marques como riesgo de escritura. Si su motivo de no serlo revela un error real de la propuesta, ESO si es un hallazgo.",
  "Cuando pidas una correccion, usa `correctionRequests[]` y se literal: que campo esta mal (`field`), que problema tiene (`problem`), con que criterio se sabra que quedo resuelto (`expectedCriterion`) y en que evidencia te basas (`evidence`). Una frase generica no se puede corregir de forma dirigida.",
  "Cita la `recommendationId` exacta en `targetRecommendationId`: el departamento la usa para saber a que recomendacion afecta cada correccion, sin adivinar.",
  "Si esta revision trae `previousCorrections`, tu primera tarea es comprobar UNA POR UNA si quedaron resueltas en esta version. No repitas una correccion ya resuelta, y no des por buena una que solo se ha reformulado.",
  "Nada de esto se ha aplicado todavia a ningun sistema. No lo evalues como si ya estuviera publicado.",
];

export function buildPlanQaInputBundle(input: {
  departmentRunId: string;
  round: number;
  approvedRecommendations: { recommendationId: string; rank: number; title: string; rationale: string }[];
  webEngineerOutput: WebEngineerOutput;
  changePlans: ResolvedChangePlan[];
  previousCorrections?: QaCorrectionRequest[];
  now?: Date;
}): DepartmentPlanQaInputBundle {
  const now = input.now ?? new Date();
  return {
    contractVersion: DEPARTMENT_RUN_CONTRACT_VERSION,
    departmentRunId: input.departmentRunId,
    generatedAt: now.toISOString(),
    round: input.round,
    reviewInstructionsForQa: PLAN_QA_REVIEW_INSTRUCTIONS,
    approvedRecommendations: input.approvedRecommendations,
    webEngineerOutput: input.webEngineerOutput,
    changePlans: input.changePlans.map((plan) => ({
      recommendationId: plan.recommendationId,
      status: plan.status,
      resolution: plan.resolution,
      operation: plan.operation,
      wordpressPageId: plan.page?.wordpressPageId ?? null,
      stagingUrl: plan.page?.stagingUrl ?? "",
      beforeValue: plan.beforeValue,
      afterValue: plan.afterValue,
      rationale: plan.rationale,
      reason: plan.reason,
    })),
    previousCorrections: input.previousCorrections ?? [],
  };
}
