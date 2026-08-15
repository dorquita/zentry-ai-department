/**
 * CONTRATO DE APPLY del departamento -- la representacion estructurada de
 * UN elemento que el departamento propone aplicar de verdad.
 *
 * Este contrato es la frontera entre "Claude decide/propone" y
 * "TypeScript aplica": Claude NUNCA aplica nada, y ningun executor
 * ejecuta nada que no venga descrito aqui con (a) una capacidad de apply
 * SOPORTADA por un executor determinista ya existente y (b) una
 * aprobacion HUMANA explicita registrada.
 *
 * Regla dura, escrita una sola vez y aplicada en todas partes:
 *
 *     QA PASS  !=  aprobado por Pau.
 *
 * `qaStatus` significa "es suficientemente valida para PROPONERSE".
 * `humanApproval` es lo unico que significa "se puede ejecutar". Cuando
 * el estado de la aprobacion no se puede determinar, el resultado es
 * `unknown` -> `blocked` (fail-closed), nunca "adelante".
 */

export const DEPARTMENT_APPLY_CONTRACT_VERSION = "department-apply/v1";

/**
 * Estados posibles de un elemento de apply.
 *
 * - `proposed`: recien construido, todavia sin resolver capacidad ni aprobacion.
 * - `awaiting_approval`: tiene executor soportado, pero NO hay aprobacion humana valida.
 * - `approved`: hay aprobacion humana explicita y executor soportado -- puede entrar al executor.
 * - `rejected`: un humano dijo que no. Nunca se ejecuta.
 * - `applying`: el executor esta en marcha (estado transitorio, persistido antes de tocar nada).
 * - `applied`: aplicado Y validado con exito.
 * - `validation_failed`: se aplico pero la validacion posterior fallo (dispara rollback).
 * - `rolled_back`: se revirtio al estado previo del snapshot.
 * - `requires_manual_implementation`: no existe executor determinista y seguro para esto.
 * - `blocked`: fail-closed -- aprobacion indeterminada, rollback fallido, o guard que impide seguir.
 */
export type DepartmentApplyStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "applying"
  | "applied"
  | "validation_failed"
  | "rolled_back"
  | "requires_manual_implementation"
  | "blocked";

export const DEPARTMENT_APPLY_STATUSES: DepartmentApplyStatus[] = [
  "proposed",
  "awaiting_approval",
  "approved",
  "rejected",
  "applying",
  "applied",
  "validation_failed",
  "rolled_back",
  "requires_manual_implementation",
  "blocked",
];

/**
 * Capacidades de apply SOPORTADAS en esta primera version. Una sola, a
 * proposito: actualizar title/meta description de una pagina que YA
 * existe como BORRADOR en staging y que YA pertenece a este sistema
 * (esta en el registro de ejecuciones de staging aplicadas).
 *
 * Es reversible (el snapshot guarda title/excerpt previos), esta
 * soportada por un executor determinista que ya existe
 * (`updateWordpressDraftPage`, que verifica `status === "draft"` antes de
 * escribir y bloquea produccion de forma incondicional), y no crea nada
 * nuevo.
 *
 * Cualquier otra cosa -> `requires_manual_implementation`. No se
 * construyen executors nuevos para recomendaciones arbitrarias.
 */
export type DepartmentApplyCapabilityId = "staging_draft_meta_update";

export const DEPARTMENT_APPLY_CAPABILITY_IDS: DepartmentApplyCapabilityId[] = ["staging_draft_meta_update"];

/** Parametros YA resueltos de forma determinista para el executor de title/meta en staging. */
export interface StagingDraftMetaUpdateTarget {
  capabilityId: "staging_draft_meta_update";
  wordpressPageId: number;
  /** URL de staging del borrador, tal como la registro la ejecucion de staging que lo creo. */
  stagingUrl: string;
  /** Nuevo title. `null` = no se toca. */
  newTitle: string | null;
  /** Nueva meta description (excerpt). `null` = no se toca. */
  newMetaDescription: string | null;
}

export interface DepartmentApplyCapability {
  id: DepartmentApplyCapabilityId | null;
  supported: boolean;
  /** Siempre no vacio: por que SI o por que NO hay executor para esto. */
  reason: string;
  target: StagingDraftMetaUpdateTarget | null;
}

/** Estado de la aprobacion HUMANA. `none`/`pending`/`rejected`/`unknown` nunca permiten aplicar. */
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

/** Estado previo REAL leido del sistema justo antes de escribir. Sin esto no se aplica nada. */
export interface DepartmentApplySnapshot {
  takenAt: string;
  wordpressPageId: number;
  previousStatus: string;
  previousTitle: string;
  previousMetaDescription: string;
}

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
  webEngineerSpecification: DepartmentApplySpecification | null;
  humanApproval: DepartmentHumanApproval;
  applyCapability: DepartmentApplyCapability;
  applyStatus: DepartmentApplyStatus;
  validationStatus: DepartmentApplyValidationStatus;
  rollbackStatus: DepartmentApplyRollbackStatus;
  snapshot: DepartmentApplySnapshot | null;
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
  /** `true` si en esta pasada se ha escrito de verdad en algun sistema externo. */
  externalWritesPerformed: boolean;
  /** Motivo por el que NO se intento aplicar nada (interruptores apagados, sin aprobaciones, etc). Vacio si si se intento. */
  applyNotAttemptedReason: string;
}

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
  return typeof value === "string" && (DEPARTMENT_APPLY_STATUSES as string[]).includes(value);
}

/** Id determinista de una recomendacion dentro de una pasada -- estable entre re-planificaciones. */
export function buildRecommendationId(departmentRunId: string, rank: number): string {
  return `${departmentRunId}#rec-${rank}`;
}

/**
 * Id determinista del elemento de apply. Estable a proposito: la
 * solicitud de aprobacion del registro existente se deduplica por
 * `relatedId`, asi que volver a planificar la misma pasada no puede
 * generar una segunda solicitud para lo mismo.
 */
export function buildApplyItemId(departmentRunId: string, rank: number): string {
  return `${departmentRunId}#apply-${rank}`;
}
