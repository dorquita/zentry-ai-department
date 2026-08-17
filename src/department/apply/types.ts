/**
 * CONTRATO DE APPLY del departamento -- la representacion estructurada de
 * UN elemento que el departamento propone aplicar de verdad, dentro de
 * UNA pasada coordinada.
 *
 * Este contrato es la frontera entre "Claude decide/propone" y
 * "TypeScript aplica": Claude NUNCA aplica nada, y ningun executor
 * ejecuta nada que no venga descrito aqui con una capacidad de apply
 * SOPORTADA por un executor determinista ya existente.
 *
 * v2 (fase TELEGRAM APPROVAL SYSTEM + STAGING-FIRST APPLY) -- dos
 * cambios de fondo respecto a v1:
 *
 * 1. STAGING-FIRST. Antes, un elemento esperaba aprobacion humana ANTES
 *    de tocar nada. Ahora staging se aplica automaticamente (es nuestro
 *    entorno de trabajo y revision) y la aprobacion humana gobierna
 *    exclusivamente el paso a PRODUCCION. La regla dura no se relaja,
 *    se mueve de sitio:
 *
 *        QA PASS != aprobado por Pau.
 *        staging validado != aprobado por Pau.
 *        Solo una aprobacion HUMANA explicita de la version EXACTA que
 *        hay en staging autoriza una escritura en produccion.
 *
 * 2. NO DRAFTS. La capacidad soportada actua sobre paginas de staging ya
 *    PUBLICADAS: un borrador no se puede revisar abriendo una URL normal
 *    desde el movil, que es justo lo que el flujo necesita.
 *
 * El estado de cada elemento usa el MISMO vocabulario que la maquina de
 * estados persistente (state-machine.ts): un unico juego de estados para
 * todo el sistema, no dos que haya que traducir.
 */

import { CapabilitySelection, ExecutePhpChangePlan } from "../../core/execute-php-operations";
import { ChangePlanExecutionStatus, ExecutableChangePlan } from "../executable-change-plan";
import { DepartmentChangeCapabilityId } from "./change-types";
import { DEPARTMENT_CHANGE_STATUSES, DepartmentChangeStatus, isDepartmentChangeStatus } from "./state-machine";

export const DEPARTMENT_APPLY_CONTRACT_VERSION = "department-apply/v2";

/** Un elemento de apply usa exactamente los estados de la maquina de estados del cambio. */
export type DepartmentApplyStatus = DepartmentChangeStatus;

export const DEPARTMENT_APPLY_STATUSES: DepartmentApplyStatus[] = [...DEPARTMENT_CHANGE_STATUSES];

export type DepartmentApplyCapabilityId = DepartmentChangeCapabilityId;

export const DEPARTMENT_APPLY_CAPABILITY_IDS: DepartmentApplyCapabilityId[] = ["staging_published_meta_update"];

/**
 * Parametros YA resueltos de forma determinista para el executor de
 * title/meta sobre una pagina de staging PUBLICADA.
 */
export interface StagingPublishedMetaUpdateTarget {
  capabilityId: "staging_published_meta_update";
  wordpressPageId: number;
  /** URL publica de staging de la pagina, tal como la registro el sistema que la publico. */
  stagingUrl: string;
  /** Nuevo title. `null` = no se toca. */
  newTitle: string | null;
  /** Nueva meta description (excerpt). `null` = no se toca. */
  newMetaDescription: string | null;
}

/**
 * Plan ejecutable adjunto a un elemento de apply. Se persiste con la
 * pasada para que la sesion de aprobacion pueda cargarlo tal cual, sin
 * volver a interpretar prosa.
 */
export interface ExecutablePlanRecord {
  plan: ExecutePhpChangePlan;
  capability: CapabilitySelection;
  wordpressPageId: number;
  stagingUrl: string;
  /** Valor REAL del campo antes del cambio, leido del sitio. */
  beforeValue: string;
  afterValue: string;
  operation: string;
  rationale: string;
  /**
   * Sobre ejecutable completo (target, before, after, preconditions,
   * validation, rollback) tal como lo construyo
   * `buildChangePlanFromDraft`. Opcional por compatibilidad con pasadas
   * ya persistidas antes de que existiera.
   */
  executableChangePlan?: ExecutableChangePlan;
}

export interface DepartmentApplyCapability {
  id: DepartmentApplyCapabilityId | null;
  supported: boolean;
  /** Siempre no vacio: por que SI o por que NO hay executor para esto. */
  reason: string;
  target: StagingPublishedMetaUpdateTarget | null;
}

/** Estado de la aprobacion HUMANA. `none`/`pending`/`rejected`/`unknown` nunca permiten publicar en produccion. */
export type DepartmentHumanApprovalStatus = "none" | "pending" | "approved" | "rejected" | "unknown";

export interface DepartmentHumanApproval {
  status: DepartmentHumanApprovalStatus;
  /** Solicitud del registro EXISTENTE del proyecto (data/approval-requests.jsonl). `null` si todavia no existe. */
  approvalRequestId: string | null;
  /** Quien respondio ("telegram", "cli", ...). Nunca se rellena si no hay respuesta real. */
  answeredBy: string | null;
  answeredAt: string | null;
  reason: string;
}

export type DepartmentApplyValidationStatus = "not_run" | "passed" | "failed";

export type DepartmentApplyRollbackStatus = "not_needed" | "rolled_back" | "rollback_failed";

export interface DepartmentApplyAuditEntry {
  at: string;
  event: string;
  detail: string;
}

/** Especificacion de web-engineer asociada, resumida (nunca reescrita). */
export interface DepartmentApplySpecification {
  implementationSummary: string;
  proposedChanges: { description: string; rationale: string; targetPageOrComponent: string }[];
  acceptanceCriteria: string[];
  validationPlan: string[];
  rollbackPlan: string[];
  approvalRequired: boolean;
}

/**
 * Enlaces de TRAZABILIDAD del elemento con el registro persistente. Un
 * elemento de apply vive en el artifact de la pasada (efimero en CI); el
 * cambio real vive en el registro persistente. Estos ids son el puente.
 */
export interface DepartmentApplyTraceability {
  /** Id del cambio en el registro persistente (una version concreta de la recomendacion). */
  changeId: string | null;
  version: number | null;
  stagingChangeId: string | null;
  stagingUrl: string | null;
  telegramApprovalId: string | null;
  telegramMessageId: number | null;
  productionApplyId: string | null;
  productionUrl: string | null;
  /** Hash de la version de staging que se enseño en Telegram (anti-TOCTOU). */
  stagingVersionHash: string | null;
}

export function emptyTraceability(): DepartmentApplyTraceability {
  return {
    changeId: null,
    version: null,
    stagingChangeId: null,
    stagingUrl: null,
    telegramApprovalId: null,
    telegramMessageId: null,
    productionApplyId: null,
    productionUrl: null,
    stagingVersionHash: null,
  };
}

export interface DepartmentApplyItem {
  contractVersion: string;
  applyItemId: string;
  /** Id determinista de la recomendacion de Growth dentro de ESTA pasada. */
  recommendationId: string;
  recommendationRank: number;
  departmentRunId: string;
  /** Empleados de los que procede la evidencia de la recomendacion. */
  sourceAgents: string[];
  title: string;
  /** Descripcion textual del objetivo tal como lo declararon Growth/web-engineer (no interpretada). */
  target: string;
  proposedChange: string;
  evidenceRefs: string[];
  /** Veredicto de QA para esta recomendacion. NO es una aprobacion. */
  qaStatus: string;
  impact: string;
  confidence: string;
  effort: string;
  webEngineerSpecification: DepartmentApplySpecification | null;
  humanApproval: DepartmentHumanApproval;
  applyCapability: DepartmentApplyCapability;
  /**
   * ADITIVO: plan de cambio EJECUTABLE ya resuelto contra el inventario
   * real de staging (pageId real, BEFORE real, ancla de version real).
   * `null` = esta recomendacion no llego a plan y por tanto NO es
   * accionable, por muy bien redactada que este.
   */
  executableChangePlan: ExecutablePlanRecord | null;
  /**
   * POR QUE esta recomendacion es o no es ejecutable, con la causa
   * exacta (destino sin resolver, ambiguo, AFTER sin concretar,
   * operacion no soportada...). Existe para que un informe pueda decir
   * el motivo en vez del generico "REQUIRES MANUAL STAGING
   * IMPLEMENTATION", que no distinguia entre causas muy distintas.
   *
   * `null` cuando esta pasada ni siquiera declaro un plan para la
   * recomendacion (p.ej. web-engineer no la incluyo en `changePlans[]`).
   */
  changePlanStatus: ChangePlanExecutionStatus | null;
  /** Motivo textual del `changePlanStatus`. Vacio si no hay plan declarado. */
  changePlanReason: string;
  applyStatus: DepartmentApplyStatus;
  validationStatus: DepartmentApplyValidationStatus;
  rollbackStatus: DepartmentApplyRollbackStatus;
  traceability: DepartmentApplyTraceability;
  auditTrail: DepartmentApplyAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentApplySummary {
  contractVersion: string;
  departmentRunId: string;
  generatedAt: string;
  items: DepartmentApplyItem[];
  counts: Record<DepartmentApplyStatus, number>;
  /** `true` si en esta pasada se ha escrito de verdad en algun sistema externo (staging incluido). */
  externalWritesPerformed: boolean;
  /** `true` solo si se ha escrito en PRODUCCION. Se reporta aparte a proposito. */
  productionWritesPerformed: boolean;
  /** Motivo por el que NO se intento aplicar nada. Vacio si si se intento. */
  applyNotAttemptedReason: string;
}

/**
 * Etiquetas legibles de cada estado, para el Daily Brief y el email. Una
 * sola fuente para los dos: el informe nunca debe decir
 * "requires_manual_implementation" cuando en realidad SI hay un apply de
 * staging soportado, ni llamar de dos formas distintas al mismo estado.
 */
export const APPLY_STATUS_LABEL: Record<DepartmentApplyStatus, string> = {
  proposed: "PROPOSED (pendiente de aplicar en staging)",
  staging_applying: "STAGING APPLYING",
  staging_applied: "STAGING READY",
  staging_validation_failed: "STAGING VALIDATION FAILED",
  staging_rolled_back: "STAGING ROLLED BACK",
  awaiting_approval: "AWAITING APPROVAL",
  awaiting_rejection_reason: "AWAITING REJECTION REASON",
  rejected: "REJECTED",
  approved: "APPROVED",
  approval_stale: "APPROVAL STALE (staging cambio: hace falta aprobar de nuevo)",
  production_queued: "PRODUCTION QUEUED (aprobado; GitHub Actions va a publicar)",
  production_applying: "PRODUCTION APPLYING",
  production_applied: "PRODUCTION APPLIED",
  production_validation_failed: "PRODUCTION VALIDATION FAILED",
  production_rolled_back: "PRODUCTION ROLLED BACK",
  blocked: "BLOCKED",
  requires_manual_staging_implementation: "REQUIRES MANUAL STAGING IMPLEMENTATION",
};

/** Orden en el que se presentan los bloques de estado en los informes: lo accionable primero. */
export const APPLY_STATUS_REPORT_ORDER: DepartmentApplyStatus[] = [
  "awaiting_approval",
  "staging_applied",
  "approved",
  "production_applied",
  "awaiting_rejection_reason",
  "rejected",
  "approval_stale",
  "production_validation_failed",
  "production_rolled_back",
  "production_queued",
  "staging_validation_failed",
  "staging_rolled_back",
  "blocked",
  "requires_manual_staging_implementation",
  "proposed",
  "staging_applying",
  "production_applying",
];

export function emptyApplyCounts(): Record<DepartmentApplyStatus, number> {
  const counts = {} as Record<DepartmentApplyStatus, number>;
  for (const status of DEPARTMENT_APPLY_STATUSES) counts[status] = 0;
  return counts;
}

export function countApplyItems(items: DepartmentApplyItem[]): Record<DepartmentApplyStatus, number> {
  const counts = emptyApplyCounts();
  for (const item of items) counts[item.applyStatus] += 1;
  return counts;
}

export function isDepartmentApplyStatus(value: unknown): value is DepartmentApplyStatus {
  return isDepartmentChangeStatus(value);
}

/** Id determinista de una recomendacion dentro de una pasada -- estable entre re-planificaciones. */
export function buildRecommendationId(departmentRunId: string, rank: number): string {
  return `${departmentRunId}#rec-${rank}`;
}

/**
 * Id determinista del elemento de apply dentro de la pasada. Estable a
 * proposito: replanificar la misma pasada no puede duplicar elementos.
 */
export function buildApplyItemId(departmentRunId: string, rank: number): string {
  return `${departmentRunId}#apply-${rank}`;
}
