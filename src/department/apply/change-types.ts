/**
 * CONTRATO PERSISTENTE de un cambio del departamento.
 *
 * Un `DepartmentChangeRequest` es el registro que sobrevive a TODO: al
 * final del runner de GitHub Actions, al reinicio del VPS, al reinicio
 * del bot de Telegram y al paso de dias. Vive en un log append-only en
 * el `data/` del cliente activo (ver change-registry.ts), igual que el
 * resto de registros del proyecto.
 *
 * Mantiene la cadena de trazabilidad COMPLETA que se pidio, en un unico
 * objeto y sin cruzar ficheros:
 *
 *   departmentRunId
 *     -> recommendationId
 *       -> stagingChangeId
 *         -> telegramApprovalId       (approvalRequestId del registro comun)
 *           -> humanDecision          (approved / rejected + motivo)
 *             -> productionApplyId
 *
 * Y la regla anti-TOCTOU: `stagingVersionHash` identifica la version
 * EXACTA que se aplico y valido en staging y que se enseño en Telegram.
 * Si cuando llega la aprobacion staging ya no coincide con ese hash, la
 * aprobacion no vale (`approval_stale`) y hay que volver a pedirla.
 */

import { DepartmentChangeStatus } from "./state-machine";

export const DEPARTMENT_CHANGE_CONTRACT_VERSION = "department-change/v1";

/**
 * Capacidades de apply soportadas de verdad. Cada una es EXPLICITA y
 * corresponde a un executor determinista ya existente -- Claude nunca
 * ejecuta codigo arbitrario contra WordPress: razona y propone, y este
 * catalogo decide si eso se puede traducir a una operacion permitida.
 */
export type DepartmentChangeCapabilityId = "staging_published_meta_update";

export const DEPARTMENT_CHANGE_CAPABILITY_IDS: DepartmentChangeCapabilityId[] = ["staging_published_meta_update"];

/**
 * Nombres ESTABLES de los campos de un cambio. Son la clave con la que el
 * executor de produccion recupera "lo que se aprobo" del registro del
 * cambio (`resolveApprovedValues`), asi que no son texto decorativo:
 * cambiarlos rompe esa correspondencia. Viven aqui, en un solo sitio.
 */
export const CHANGE_FIELD_TITLE = "title";
export const CHANGE_FIELD_META = "meta description";
export const CHANGE_FIELD_BODY = "contenido (cuerpo)";

/** Un campo concreto que el cambio toca, con su valor antes y despues. Solo datos REALES leidos del sistema. */
export interface ChangedField {
  /** "title" | "meta_description" | ... -- nombre estable, legible en el mensaje de Telegram. */
  field: string;
  before: string;
  after: string;
  /** `false` cuando el cambio no toca este campo (se muestra como "sin cambio"). */
  changed: boolean;
}

/** Estado previo REAL leido justo antes de escribir. Sin snapshot no se escribe NADA. */
export interface ChangeSnapshot {
  takenAt: string;
  environment: "staging" | "production";
  wordpressPageId: number;
  previousStatus: string;
  previousTitle: string;
  previousMetaDescription: string;
  /** Hash del cuerpo HTML previo. No se guarda el HTML entero: el registro tiene que seguir siendo legible. */
  previousContentHash: string;
  /** Version identificable del estado PREVIO -- permite comprobar si algo cambio por fuera. */
  previousVersionHash: string;
}

export type ChangeValidationStatus = "not_run" | "passed" | "failed";
export type ChangeRollbackStatus = "not_needed" | "rolled_back" | "rollback_failed";

/** Resultado de aplicar el cambio en UN entorno (staging o produccion). */
export interface EnvironmentApplyRecord {
  environment: "staging" | "production";
  /** Id propio de esta ejecucion: `stagingChangeId` o `productionApplyId`. */
  applyId: string;
  wordpressPageId: number;
  /** URL publica REAL del resultado (nunca inventada: sale de lo que devolvio WordPress). */
  url: string;
  /**
   * Slug REAL de la pagina. Es lo unico con lo que se empareja una
   * pagina de staging con su equivalente de produccion, y solo si el
   * emparejamiento es EXACTO y unico (ver production-executor.ts).
   */
  pageSlug: string;
  startedAt: string;
  finishedAt: string | null;
  snapshot: ChangeSnapshot | null;
  changedFields: ChangedField[];
  validationStatus: ChangeValidationStatus;
  validationDetail: string;
  rollbackStatus: ChangeRollbackStatus;
  rollbackDetail: string;
  /**
   * Version identificable del estado RESULTANTE, releida del sistema
   * despues de validar. Es la que se compara contra staging cuando llega
   * la aprobacion (anti-TOCTOU).
   */
  resultingVersionHash: string | null;
}

/** La solicitud de aprobacion enviada a Telegram para ESTA version del cambio. */
export interface TelegramApprovalRecord {
  /** approvalRequestId del registro comun del proyecto (data/approval-requests.jsonl). */
  telegramApprovalId: string;
  /** message_id devuelto por Telegram, si el envio pudo confirmarlo. `null` = no confirmado. */
  telegramMessageId: number | null;
  chatId: string | null;
  sentAt: string | null;
  /** Hash de la version de staging que se enseño en ESE mensaje. La aprobacion solo vale para esta. */
  stagingVersionHash: string;
}

export type HumanDecisionType = "approved" | "rejected";

export interface HumanDecisionRecord {
  decision: HumanDecisionType;
  /** Identidad del autor tal como la reporto el canal (nunca inventada). */
  decidedBy: string;
  decidedAt: string;
  /** Motivo del rechazo, tal cual lo escribio la persona. Vacio mientras esta en `awaiting_rejection_reason`. */
  rejectionReason: string;
  /** Canal por el que llego la decision ("telegram", "cli"...). */
  channel: string;
}

export interface ChangeAuditEntry {
  at: string;
  event: string;
  detail: string;
}

export interface DepartmentChangeRequest {
  contractVersion: string;
  /** Id estable del CAMBIO (una version concreta de una recomendacion). */
  changeId: string;
  departmentRunId: string;
  recommendationId: string;
  recommendationRank: number;
  /**
   * Version de la propuesta para esta recomendacion: v1, v2, ... Una
   * propuesta nueva tras un rechazo es una version NUEVA, con su propio
   * changeId y su propia aprobacion. Nunca se reutiliza una aprobacion
   * vieja para una version nueva.
   */
  version: number;
  /** changeId de la version anterior de esta misma recomendacion, si la hay. */
  supersedesChangeId: string | null;
  title: string;
  /** Resumen corto de POR QUE se propone (viene de Growth, no se reescribe). */
  why: string;
  /** Origen real: seo-specialist / content-strategist / analytics-specialist / growth-director-v2... */
  sourceAgents: string[];
  impact: string;
  confidence: string;
  effort: string;
  /** Veredicto de QA. NO es una aprobacion. */
  qaStatus: string;
  capabilityId: DepartmentChangeCapabilityId | null;
  capabilityReason: string;
  status: DepartmentChangeStatus;
  staging: EnvironmentApplyRecord | null;
  telegram: TelegramApprovalRecord | null;
  humanDecision: HumanDecisionRecord | null;
  production: EnvironmentApplyRecord | null;
  /**
   * Feedback humano acumulado sobre esta recomendacion, disponible para
   * las siguientes ejecuciones de los agentes: por que se rechazo y que
   * hay que cambiar. Se COPIA aqui (ademas de vivir en el registro de
   * feedback) para que una version nueva pueda leer de un solo sitio la
   * historia de rechazos de su antecesora.
   */
  inheritedFeedback: string[];
  auditTrail: ChangeAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

/** Id determinista del cambio: recomendacion + version. Estable entre reintentos de la MISMA version. */
export function buildChangeId(departmentRunId: string, rank: number, version: number): string {
  return `${departmentRunId}#change-${rank}-v${version}`;
}

export function buildStagingChangeId(changeId: string): string {
  return `staging::${changeId}`;
}

export function buildProductionApplyId(changeId: string): string {
  return `production::${changeId}`;
}

export function appendAudit(change: DepartmentChangeRequest, at: Date, event: string, detail: string): DepartmentChangeRequest {
  return {
    ...change,
    auditTrail: [...change.auditTrail, { at: at.toISOString(), event, detail }],
    updatedAt: at.toISOString(),
  };
}

/** Resumen legible de los campos que cambiaron de verdad (para Telegram y para el informe). */
export function describeChangedFields(fields: ChangedField[]): string[] {
  return fields.map((field) => (field.changed ? `${field.field}: ${field.before || "(vacio)"} -> ${field.after || "(vacio)"}` : `${field.field}: sin cambio`));
}
