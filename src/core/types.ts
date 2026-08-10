import type { AutonomyLevel, AutonomyRiskLevel } from "./autonomy-policy";
import type { NotificationChannel } from "./notification-policy";

export type AgentMode = "READ" | "PROPOSE" | "APPLY";

export type SeoDataSource = "mock" | "search_console";

export interface SearchConsoleRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  previousPosition?: number;
}

/**
 * What every data adapter (mock or real) returns: the rows plus enough
 * context (site, date range) to stamp onto each job's metadata.
 */
export interface SeoDataResult {
  rows: SearchConsoleRow[];
  siteUrl: string;
  analysisStartDate: string;
  analysisEndDate: string;
}

export interface TargetKeyword {
  keyword: string;
  type: "commercial" | "informational";
  priority: "high" | "medium" | "low";
}

export interface Thresholds {
  opportunityMinImpressions: number;
  opportunityMinPosition: number;
  opportunityMaxPosition: number;
  lowCtrThreshold: number;
  reviewCycleDays: number;
  top10TargetPosition: number;
  top3TargetPosition: number;
  positionDropAlertDelta: number;
  futureOpportunityMinPosition: number;
}

export type OpportunityKind =
  | "quick_win"
  | "low_ctr"
  | "position_drop"
  | "future_opportunity";

export type Priority = "high" | "medium" | "low";

export interface SeoOpportunity {
  kind: OpportunityKind;
  keyword: string;
  page: string;
  currentPosition: number;
  targetPosition: number;
  recommendedAction: string;
  priority: Priority;
  risk: "low" | "medium";
  requiresApproval: boolean;
  nextReviewDate: string;
  evidence: {
    impressions: number;
    clicks: number;
    ctr: number;
    previousPosition?: number;
  };
}

export interface SeoJobMeta {
  runId: string;
  analysisStartDate: string;
  analysisEndDate: string;
  siteUrl: string;
  dataSource: SeoDataSource;
}

export interface SeoJob {
  id: string;
  createdAt: string;
  agent: "seo-watcher";
  mode: AgentMode;
  status: "proposed";
  title: string;
  meta: SeoJobMeta;
  opportunity: SeoOpportunity;
}

// --- Department event bus (data/department-events.jsonl) ---
// Cualquier agente del departamento escribe aqui su actividad. Solo lectura
// para consumidores (Growth Director); solo append para quien escribe.

export type DepartmentEventType =
  | "agent_started"
  | "agent_finished"
  | "opportunity_detected"
  | "recommendation_created"
  | "warning_detected"
  | "action_proposed"
  | "approval_required"
  | "competitor_keyword_detected"
  | "brand_intent_classified";

export type EventPriority = "low" | "medium" | "high";

export interface DepartmentEvent {
  eventId: string;
  departmentRunId: string;
  agent: string;
  department: string;
  type: DepartmentEventType;
  priority: EventPriority;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// --- Brand / Intent Router ---
// Clasificacion de keywords/oportunidades entre las dos marcas del cliente
// (Zentry = mobiliario/taquillas/lockers, Tukandado = cerradura electronica).
// Usado por Competitor Intelligence, Content Planner, CRO Reviewer y
// Growth Director para no mezclar las marcas sin criterio.

export type BrandIntentCategory =
  | "zentry_locker_core"
  | "zentry_smart_locker"
  | "tukandado_lock_core"
  | "mixed_cross_sell"
  | "irrelevant_or_low_fit";

export type BrandTarget = "zentry" | "tukandado" | "both" | "none";

export interface BrandIntentResult {
  category: BrandIntentCategory;
  brand: BrandTarget;
  reason: string;
  signals: {
    hasLockerTerm: boolean;
    hasLockTerm: boolean;
    hasSmartTerm: boolean;
    matchedB2bSectors: string[];
    matchedMaterials: string[];
    hasLowFitTerm: boolean;
  };
}

// --- Action Backlog (data/action-backlog.jsonl) ---
// Capa operativa por encima de jobs/eventos: convierte recomendaciones
// repetidas de los agentes en una unica accion deduplicada con estado.
// Ningun estado implica ejecucion real — "approved"/"auto_approved_for_planning"
// solo significan que se puede trabajar esa accion (con o sin humano segun
// la Fase O7, ver docs/autonomy-policy.md), nunca que se ha publicado nada.

export type ActionStatus =
  | "new"
  | "open"
  | "auto_processed"
  | "auto_approved_for_planning"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "snoozed"
  | "blocked"
  | "done";

export const ACTION_STATUSES: ActionStatus[] = [
  "new",
  "open",
  "auto_processed",
  "auto_approved_for_planning",
  "waiting_approval",
  "approved",
  "rejected",
  "snoozed",
  "blocked",
  "done",
];

/**
 * data/action-backlog.jsonl es un log append-only: cada linea es una
 * "instantanea" de una accion en un momento dado. El estado ACTUAL de una
 * accion es su instantanea mas reciente (ultima linea con ese actionId).
 * Nunca se reescribe ni se borra una linea existente.
 */
export interface BacklogAction {
  actionId: string;
  canonicalKey: string;
  title: string;
  description: string;
  sourceAgents: string[];
  department: string;
  brandIntent: BrandIntentCategory;
  targetBrand: BrandTarget;
  keyword: string;
  page?: string;
  actionType: string;
  priority: Priority;
  impact?: string;
  effort?: string;
  status: ActionStatus;
  requiresApproval: boolean;
  // Fase O7 — clasificacion de autonomia aplicada a esta accion (ver
  // src/core/autonomy-policy.ts). Se recalcula en cada snapshot con la
  // politica vigente en ese momento, para que quede trazado incluso si la
  // politica cambia mas adelante.
  autonomyLevel: AutonomyLevel;
  riskLevel: AutonomyRiskLevel;
  autonomyReason: string;
  evidence?: Record<string, unknown>;
  recommendation: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  runIds: string[];
  relatedJobIds: string[];
  createdAt: string;
  updatedAt: string;
}

// --- Action Audit Log (data/action-audit.jsonl) ---
// Un registro append-only por cada cambio de estado de una accion.

export interface ActionAuditEntry {
  auditId: string;
  actionId: string;
  previousStatus: ActionStatus;
  newStatus: ActionStatus;
  reason?: string;
  changedBy: string;
  changedAt: string;
}

// --- Work Orders (data/work-orders.jsonl) ---
// Capa por encima del Action Backlog: convierte una accion `approved` (o,
// desde la Fase O7, `auto_approved_for_planning`) en un plan de ejecucion
// detallado, listo para revision humana. Una work order NUNCA ejecuta
// nada — ni siquiera en estado `approved_to_prepare` ni `auto_prepared`,
// que solo significan "hay una propuesta detallada lista para mirar", no
// "publicar".

export type WorkOrderStatus =
  | "draft"
  | "ready_for_review"
  | "auto_prepared"
  | "approved_to_prepare"
  | "rejected"
  | "applied_manually"
  | "superseded";

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  "draft",
  "ready_for_review",
  "auto_prepared",
  "approved_to_prepare",
  "rejected",
  "applied_manually",
  "superseded",
];

/**
 * De donde viene una work order: si la accion origen la aprobo un humano
 * (`approved`) o si la aprobo automaticamente la politica de autonomia
 * (`auto_approved_for_planning`, Fase O7). Determina si el builder la deja
 * en `ready_for_review` o en `auto_prepared` — en ambos casos sigue
 * pendiente de revision humana antes de cualquier ejecucion real.
 */
export type WorkOrderPlanningOrigin = "human_approved" | "auto_approved_for_planning";

/**
 * Confirmacion inmutable de seguridad: se fija una vez al crear la work
 * order y ningun builder ni actualizacion posterior la toca. Existe para
 * que, aunque el resto del contenido cambie, quede siempre trazado en el
 * propio registro (no solo en el informe markdown) que no se ha tocado
 * produccion.
 */
export interface WorkOrderProductionSafety {
  wordpressTouched: false;
  published: false;
  productionExecuted: false;
  note: string;
}

/**
 * Igual que data/action-backlog.jsonl: log append-only de instantaneas.
 * El estado ACTUAL de una work order es su instantanea mas reciente (la
 * ultima linea con ese workOrderId). Nunca se borra ni se reescribe una
 * linea existente.
 */
export interface WorkOrder {
  workOrderId: string;
  actionId: string;
  canonicalKey: string;
  department: string;
  sourceActionTitle: string;
  brandIntent: BrandIntentCategory;
  targetBrand: BrandTarget;
  actionType: string;
  keyword: string;
  page?: string;
  priority: Priority;
  impact?: string;
  effort?: string;
  status: WorkOrderStatus;
  requiresHumanReview: boolean;
  // Fase O7 — heredado de la accion origen en el momento de crear la work
  // order (ver src/agents/approved-action-planner.ts).
  planningOrigin: WorkOrderPlanningOrigin;
  autonomyLevel: AutonomyLevel;
  riskLevel: AutonomyRiskLevel;
  requiresApproval: boolean;
  productionSafety: WorkOrderProductionSafety;
  proposedChanges: Record<string, unknown>;
  implementationChecklist: string[];
  risks: string[];
  dependencies: string[];
  sourceAgents: string[];
  createdAt: string;
  updatedAt: string;
}

// --- Work Order Audit Log (data/work-order-audit.jsonl) ---

export interface WorkOrderAuditEntry {
  auditId: string;
  workOrderId: string;
  previousStatus: WorkOrderStatus;
  newStatus: WorkOrderStatus;
  reason?: string;
  changedBy: string;
  changedAt: string;
}

// --- Approval Requests (data/approval-requests.jsonl) — Fase O8 ---
// Una solicitud de aprobacion es lo que crea el Approval Gateway Agent
// cuando la politica de notificacion (notification-policy.ts) clasifica
// una accion o work order como INSTANT_APPROVAL_REQUIRED. Nunca ejecuta
// nada por si misma: solo registra que se pidio permiso, por que canal, y
// (cuando la haya) la respuesta. La ejecucion real sigue sin existir en
// este sistema (no hay modo APPLY).

export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "snoozed" | "expired" | "cancelled";

export const APPROVAL_REQUEST_STATUSES: ApprovalRequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "snoozed",
  "expired",
  "cancelled",
];

// Fase WordPress Draft Agent: "change_pack" se anade para poder pedir
// aprobacion por Telegram antes de crear un borrador REAL en WordPress
// (ver src/agents/wordpress-draft-agent.ts). A diferencia de "action" y
// "work_order", las solicitudes de tipo "change_pack" NUNCA cascadan un
// cambio de estado al responderlas (ver scripts/update-approval-request.ts)
// — solo desbloquean que el WordPress Draft Agent intente crear el
// borrador real en su siguiente pasada.
//
// Fase O12: "staging_execution" sigue el mismo patron sin cascada, para
// el Staging Executor (ver src/agents/staging-executor.ts) — la unica
// via para que exista una escritura real controlada (crear o actualizar
// un borrador) contra staging.
export type ApprovalRelatedType =
  | "action"
  | "work_order"
  | "change_pack"
  | "staging_execution"
  | "production_deployment_plan"
  | "production_execution"
  // Fase O14: reservado para el dia que una ability de Novamira MCP
  // clasificada "safe_write_staging_only" con requiresApproval:true
  // (ver config/novamira-allowlist.json + src/core/novamira-guard.ts)
  // necesite aprobacion humana antes de ejecutarse. Nada crea todavia
  // solicitudes de este tipo -- es solo arquitectura preparada.
  | "novamira_staging_write";

/**
 * data/approval-requests.jsonl es un log append-only de instantaneas,
 * igual que action-backlog.jsonl y work-orders.jsonl. El estado ACTUAL de
 * una solicitud es su instantanea mas reciente. Nunca se borra ni se
 * reescribe una linea existente.
 */
export interface ApprovalRequest {
  approvalRequestId: string;
  relatedType: ApprovalRelatedType;
  relatedId: string;
  title: string;
  summary: string;
  riskLevel: AutonomyRiskLevel;
  requestedAction: string;
  options: string[];
  status: ApprovalRequestStatus;
  channel: NotificationChannel;
  sentAt?: string;
  answeredAt?: string;
  answer?: string;
  reason?: string;
  answeredBy?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Change Packs (data/change-packs.jsonl) — Fase "Change Packs" ---
// Convierte una work order ya detallada (`auto_prepared`,
// `ready_for_review` o `approved_to_prepare`) en un PAQUETE DE CAMBIO
// concreto: pasos de implementacion, checklist de revision humana,
// riesgos y notas de reversion — pensado para que, el dia que exista
// ejecucion controlada (modo APPLY), ya haya un paquete listo para
// aplicar con un solo click humano. Hoy NO ejecuta nada: es la misma
// filosofia READ+PROPOSE que el resto del departamento, un nivel mas
// concreto que una work order.

export type ChangePackStatus =
  | "draft"
  | "ready_for_review"
  | "approved_to_execute"
  | "rejected"
  | "superseded"
  | "applied_manually";

export const CHANGE_PACK_STATUSES: ChangePackStatus[] = [
  "draft",
  "ready_for_review",
  "approved_to_execute",
  "rejected",
  "superseded",
  "applied_manually",
];

/**
 * data/change-packs.jsonl es un log append-only de instantaneas, mismo
 * patron que action-backlog.jsonl/work-orders.jsonl/
 * approval-requests.jsonl. El estado ACTUAL de un change pack es su
 * instantanea mas reciente (la ultima linea con ese changePackId). Nunca
 * se borra ni se reescribe una linea existente — el historico completo de
 * un change pack se reconstruye leyendo todas sus instantaneas en orden.
 */
export interface ChangePack {
  changePackId: string;
  workOrderId: string;
  actionId: string;
  canonicalKey: string;
  targetBrand: BrandTarget;
  brandIntent: BrandIntentCategory;
  page?: string;
  keyword: string;
  changeType: string;
  priority: Priority;
  status: ChangePackStatus;
  proposedChanges: Record<string, unknown>;
  currentAssumptions: string[];
  implementationSteps: string[];
  humanReviewChecklist: string[];
  risks: string[];
  rollbackNotes: string[];
  createdAt: string;
  updatedAt: string;
}

// --- WordPress Drafts (data/wordpress-drafts.jsonl) — WordPress Draft Agent ---
// Convierte un change pack ya listo (`ready_for_review`/
// `approved_to_execute`) en un borrador seguro: primero SIEMPRE un
// "preview" local (fichero markdown en reports/wordpress-drafts/previews/,
// cero llamadas a WordPress), y solo si WORDPRESS_DRAFTS_ENABLED=true Y
// el change pack esta `approved_to_execute` Y hay una aprobacion de
// Telegram explicita para ESE borrador concreto, un borrador REAL en
// WordPress (siempre `status: draft`, nunca publicado). Ver
// docs/wordpress-draft-agent.md y docs/wordpress-safety-policy.md.

export type WordpressDraftStatus =
  | "local_preview"
  | "wp_draft_created"
  | "rejected"
  | "superseded"
  | "manually_applied";

export const WORDPRESS_DRAFT_STATUSES: WordpressDraftStatus[] = [
  "local_preview",
  "wp_draft_created",
  "rejected",
  "superseded",
  "manually_applied",
];

/**
 * data/wordpress-drafts.jsonl es un log append-only de instantaneas,
 * mismo patron que change-packs.jsonl. El estado ACTUAL de un draft es su
 * instantanea mas reciente. Nunca se borra ni se reescribe una linea
 * existente.
 */
export interface WordpressDraft {
  draftId: string;
  changePackId: string;
  workOrderId: string;
  targetBrand: BrandTarget;
  page?: string;
  keyword: string;
  draftType: string;
  status: WordpressDraftStatus;
  localPreviewPath: string;
  wordpressDraftId?: number;
  wordpressDraftUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Staging Executions (data/staging-executions.jsonl) — Fase O12 ---
// Ejecucion controlada: convierte un change pack `approved_to_execute`
// (mas la aprobacion explicita de Telegram para ESA ejecucion concreta)
// en una escritura REAL pero acotada contra WordPress STAGING —
// SIEMPRE crear o actualizar una pagina en `status: draft`, NUNCA
// publicar, NUNCA produccion. Ver src/agents/staging-executor.ts,
// docs/staging-execution.md y docs/staging-rollback.md.

export type StagingExecutionStatus =
  | "pending_approval"
  | "approved"
  | "applied_to_staging"
  | "failed"
  | "rolled_back"
  | "rejected";

export const STAGING_EXECUTION_STATUSES: StagingExecutionStatus[] = [
  "pending_approval",
  "approved",
  "applied_to_staging",
  "failed",
  "rolled_back",
  "rejected",
];

/**
 * Snapshot tomado ANTES de escribir nada, para poder hacer rollback
 * despues. `existedBefore: false` (pagina nueva, creada por este mismo
 * Staging Executor) -> el rollback vacia el contenido y marca el titulo
 * como revertido, pero SIGUE sin borrar la pagina (no existe ninguna
 * funcion de delete en src/adapters/wordpress.ts, ni la habra para esto
 * — ver docs/staging-rollback.md). `existedBefore: true` (se actualizo
 * un draft que el propio Staging Executor ya habia creado en una pasada
 * anterior) -> el rollback restaura `previousTitle`/`previousContent`
 * tal cual estaban.
 */
export interface StagingExecutionSnapshot {
  existedBefore: boolean;
  wordpressPageId?: number;
  previousStatus?: string;
  previousTitle?: string;
  previousContent?: string;
}

/**
 * data/staging-executions.jsonl es un log append-only de instantaneas,
 * mismo patron que change-packs.jsonl/wordpress-drafts.jsonl. El estado
 * ACTUAL de una ejecucion es su instantanea mas reciente (la ultima
 * linea con ese executionId). Nunca se borra ni se reescribe una linea
 * existente — el propio historico de instantaneas ya sirve de
 * auditoria completa, sin fichero de auditoria aparte.
 */
export interface StagingExecution {
  executionId: string;
  changePackId: string;
  workOrderId: string;
  actionId: string;
  canonicalKey: string;
  targetBrand: BrandTarget;
  changeType: string;
  page?: string;
  keyword: string;
  status: StagingExecutionStatus;
  environment: "staging";
  wordpressBackend: string;
  wordpressPageId?: number;
  wordpressDraftUrl?: string;
  snapshot?: StagingExecutionSnapshot;
  rollbackNotes: string[];
  approvalRequestId?: string;
  lastError?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

// --- Asset Requests (data/asset-requests.jsonl) — Fase O12.4 ---
// Propuesta de un asset visual (imagen) que un draft/change pack
// necesitaria. Esta fase SOLO propone: ningun codigo de este proyecto
// llama todavia a n8n, genera una imagen ni la sube a WordPress. Ver
// docs/asset-generation-workflow.md y docs/n8n-asset-webhook-contract.md.

export type ImagePurpose = "hero" | "card" | "icon" | "background" | "product_context";

export type AssetRequestStatus =
  | "proposed"
  | "ready_for_generation"
  | "sent_to_n8n"
  | "generated"
  | "uploaded_to_wordpress"
  | "rejected"
  | "failed";

export const ASSET_REQUEST_STATUSES: AssetRequestStatus[] = [
  "proposed",
  "ready_for_generation",
  "sent_to_n8n",
  "generated",
  "uploaded_to_wordpress",
  "rejected",
  "failed",
];

export interface AssetRequestDimensions {
  width: number;
  height: number;
}

/**
 * data/asset-requests.jsonl es un log append-only de instantaneas, mismo
 * patron que change-packs.jsonl/staging-executions.jsonl. El estado
 * ACTUAL de una peticion es su instantanea mas reciente. Nunca se borra
 * ni se reescribe una linea existente.
 */
export interface AssetRequest {
  assetRequestId: string;
  changePackId: string;
  draftId?: string;
  targetBrand: BrandTarget;
  sector?: string;
  pageType: string;
  imagePurpose: ImagePurpose;
  prompt: string;
  negativePrompt: string;
  styleGuide: string;
  altText: string;
  filenameSuggestion: string;
  dimensions: AssetRequestDimensions;
  status: AssetRequestStatus;
  // Rellenados solo despues de que exista integracion real con n8n
  // (no en esta fase): id/URL de la imagen generada y de la subida a
  // WordPress, si algun dia llega a producirse.
  n8nWebhookSentAt?: string;
  generatedImageUrl?: string;
  wordpressMediaId?: number;
  wordpressMediaUrl?: string;
  // Rellenados solo tras una subida real a WordPress Media Library
  // (Fase O12.7) -- fileSize en bytes, width/height del archivo tal
  // como quedo en WordPress (no el objetivo pedido en `dimensions`).
  uploadedAt?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Production Deployment Plans (data/production-deployment-plans.jsonl) — Fase O13.0 ---
// PURA PLANIFICACION: ningun codigo de este proyecto escribe todavia en
// WordPress produccion. Un plan describe COMO se aplicaria de forma
// segura y selectiva un draft ya probado en staging -- nunca lo aplica.
// Ver docs/production-deployment-strategy.md.

// Fase O13.1 -- DOS aprobaciones humanas distintas y separadas, nunca
// una sola ambigua:
//   1. "aprobacion de PLAN" (plan_ready_for_review -> plan_approved /
//      plan_rejected): el humano confirma que el DISENO del plan
//      (checklist, riesgos, rollback, media, SEO) esta bien. NO autoriza
//      ninguna escritura real.
//   2. "aprobacion de EJECUCION" (execution_pending_approval ->
//      execution_approved / execution_rejected): solo se pide DESPUES de
//      plan_approved. El humano autoriza EXPLICITAMENTE una futura
//      escritura real en produccion. Ni siquiera "execution_approved"
//      ejecuta nada por si solo hoy -- no existe todavia ningun
//      ejecutor real (ver docs/production-deployment-strategy.md).
// Fase O28.5 -- "needs_revalidation" (Pau, tras el rediseno visual de
// O28.1-O28.3): un plan creado ANTES de que su draft de origen se
// regenerase con el motor visual/contenido nuevo queda con `seoMeta` y
// `checklist` desactualizados -- no describe ya la pagina real. No es
// "cancelled" (abandonado) ni "plan_rejected" (rechazado a proposito):
// es un estado de PAUSA explicito, nunca avanza a ejecucion, y deja
// hueco para que el planner proponga un plan NUEVO con datos correctos
// una vez la pagina pase el gate de aprobacion visual (ver
// src/core/visual-qa.ts) -- deliberadamente fuera de
// UNRESOLVED_PLAN_STATUSES en production-deployment-planner.ts para no
// bloquear esa regeneracion.
export const DEPLOYMENT_PLAN_STATUSES = [
  "draft",
  "plan_ready_for_review",
  "plan_approved",
  "plan_rejected",
  "execution_pending_approval",
  "execution_approved",
  "execution_rejected",
  "applied_to_production_draft",
  "rolled_back",
  "cancelled",
  "needs_revalidation",
] as const;
export type DeploymentPlanStatus = (typeof DEPLOYMENT_PLAN_STATUSES)[number];

export type DeploymentType = "create_draft" | "update_existing_draft" | "manual_apply" | "publish_existing";

export interface DeploymentSeoMeta {
  title: string;
  metaDescription: string;
}

export interface ProductionDeploymentPlan {
  deploymentPlanId: string;
  sourceEnvironment: "staging";
  targetEnvironment: "production";
  changePackId: string;
  stagingExecutionId: string;
  keyword: string;
  page?: string;
  sourceDraftId: number;
  sourceDraftUrl: string;
  targetPageId?: number;
  deploymentType: DeploymentType;
  includedMediaIds: number[];
  includedAssetRequests: string[];
  seoMeta: DeploymentSeoMeta;
  checklist: string[];
  risks: string[];
  rollbackPlan: string[];
  requiredApprovals: string[];
  approvalRequestId?: string;
  status: DeploymentPlanStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Production Executions (data/production-executions.jsonl) — Fase O13.2 ---
// El unico registro de todo el proyecto con capacidad (gateada, hoy
// siempre desactivada) de escribir de verdad en WordPress PRODUCCION.
// Creado SOLO para planes ya `plan_approved`. Necesita una SEGUNDA
// aprobacion de Telegram (distinta de la de plan, relatedType
// "production_execution") + 3 flags de entorno simultaneos
// (`PRODUCTION_EXECUTION_ENABLED`, `PRODUCTION_DRAFTS_ENABLED`,
// `PRODUCTION_BACKEND=rest`) antes de poder intentar una escritura real.
// Ver src/agents/production-draft-executor.ts y
// docs/production-deployment-strategy.md.

export const PRODUCTION_EXECUTION_STATUSES = [
  "pending_approval",
  "approved",
  "applied_to_production_draft",
  "failed",
  "rolled_back",
  "cancelled",
] as const;
export type ProductionExecutionStatus = (typeof PRODUCTION_EXECUTION_STATUSES)[number];

export interface ProductionMediaMapping {
  sourceMediaId: number;
  targetMediaId?: number;
  targetMediaUrl?: string;
}

export interface ProductionExecution {
  executionId: string;
  deploymentPlanId: string;
  changePackId: string;
  keyword: string;
  page?: string;
  environment: "production";
  backend: string;
  sourceDraftId: number;
  sourceDraftUrl: string;
  targetPageId?: number;
  targetDraftUrl?: string;
  seoMeta: DeploymentSeoMeta;
  mediaMappings: ProductionMediaMapping[];
  rollbackPlan: string[];
  // Snapshot obligatorio (Fase O13.2): el contentHtml EXACTO que se
  // envio (o se enviaria) a produccion, capturado SIEMPRE justo antes de
  // intentar la escritura real -- exista o no una pagina previa que
  // revertir (para "crear pagina nueva" no hay contenido anterior que
  // guardar, pero si hace falta saber EXACTAMENTE que se creo, para un
  // rollback futuro que la vacie/marque en vez de reconstruirla a ciegas).
  submittedContentSnapshot?: string;
  approvalRequestId?: string;
  status: ProductionExecutionStatus;
  lastError?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

// --- Telegram Approval Receiver (Fase O13.2b) ---
// Permite responder "approve <id>" / "reject <id>" directamente en el
// chat de Telegram en vez de por SSH. Solo polling manual bajo peticion
// (npm run telegram:approvals:poll) -- NO es un servicio permanente
// todavia. Ver src/agents/telegram-approval-receiver.ts.

/**
 * Log append-only (data/telegram-processed-updates.jsonl) de CADA update
 * de Telegram ya procesado, exista o no una accion real -- incluye los
 * ignorados (chat no autorizado, sin comando reconocido, aprobacion ya
 * resuelta, expirada, ambigua...). Sirve como auditoria completa Y como
 * cursor: el offset de la siguiente llamada a getUpdates es
 * max(updateId) + 1 de este log.
 */
export interface TelegramProcessedUpdate {
  updateId: number;
  chatId: string;
  text: string;
  outcome:
    | "approved"
    | "rejected"
    | "production_confirmation_requested"
    | "production_confirmed_approved"
    | "ignored_unauthorized_chat"
    | "ignored_no_command_match"
    | "ignored_already_resolved"
    | "ignored_expired"
    | "ignored_ambiguous_id"
    | "ignored_not_found"
    | "ignored_confirmation_not_found_or_expired"
    | "ignored_requires_cli_cascade"
    // Fase O28.5 -- rediseno del flujo de aprobaciones de Telegram.
    | "feedback_recorded"
    | "ignored_multiple_pending_needs_id"
    | "ignored_no_pending_requests";
  approvalRequestId?: string;
  relatedType?: ApprovalRelatedType;
  processedAt: string;
}

// Fase O28.5 -- cuando Pau rechaza una revision (boton o texto natural),
// el sistema pide un motivo antes de dar el rechazo por cerrado. Este
// registro (append-only, mismo patron que TelegramProductionConfirmation)
// recuerda que HAY una pregunta abierta para ese chat, para que el
// siguiente mensaje de texto que llegue (sin comando reconocido) se
// interprete como la RESPUESTA a esa pregunta, no como un mensaje suelto.
export interface RejectReasonPrompt {
  promptId: string;
  approvalRequestId: string;
  chatId: string;
  status: "pending" | "answered" | "expired" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

// Fase O28.5 -- feedback real de Pau al rechazar una revision visual,
// guardado para que futuras paginas no repitan el mismo error (Pau:
// "evitar repetir el mismo error en futuras paginas"). No hay todavia
// ningun agente automatico que LEA este fichero para cambiar su
// comportamiento -- hoy es un registro consultable a mano/por un humano
// antes de la siguiente regeneracion, un primer paso honesto hacia ese
// circuito de mejora continua.
export interface VisualReviewFeedback {
  feedbackId: string;
  approvalRequestId: string;
  wordpressPageId?: number;
  feedback: string;
  source: "telegram";
  createdAt: string;
}

/**
 * Doble confirmacion obligatoria para aprobar (nunca para rechazar)
 * cualquier ApprovalRequest con `riskLevel === "critical"` (planes/
 * ejecuciones de deploy a produccion). `data/telegram-production-confirmations.jsonl`,
 * mismo patron append-only. Ventana corta (15 min) -- pensada para un
 * intercambio inmediato en el chat, no para dejar pendiente dias.
 */
export type TelegramProductionConfirmationStatus = "awaiting_second_confirmation" | "confirmed" | "expired" | "cancelled";

export interface TelegramProductionConfirmation {
  confirmationId: string;
  approvalRequestId: string;
  shortId: string;
  status: TelegramProductionConfirmationStatus;
  createdAt: string;
  updatedAt: string;
}

// --- Landing Blueprint (data/landing-blueprints.jsonl) — Fase O13.6b ---
// UX/UI Landing Architect: convierte cada change pack en una estructura
// visual de landing CONCRETA (no solo un preview de texto) ANTES de que
// WordPress Draft Agent escriba nada. Postmortem: el sistema ya tenia un
// catalogo de plantillas (src/core/visual-templates.ts, Fase O12.4) pero
// nunca se conectaba al HTML real -- este blueprint es lo que cierra ese
// hueco. Ver docs/postmortem-landing-quality.md.

export interface LandingCtaSpec {
  label: string;
  target: string;
  isRealLink: boolean;
}

export interface LandingBenefitItem {
  title: string;
  description: string;
}

export interface LandingCardItem {
  title: string;
  description: string;
}

export type LandingSearchIntent = "informational" | "transactional" | "comparison" | "commercial";

export interface LandingSection {
  heading: string;
  body: string;
  searchIntent: LandingSearchIntent;
}

export interface LandingFaqItem {
  question: string;
  answer: string;
}

export interface LandingComparisonTable {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface LandingBlueprint {
  blueprintId: string;
  changePackId: string;
  templateType: string;
  hero: { headline: string; subheadline: string };
  // Fase O27.4c -- Pau revizo una captura real y la pagina parecia un
  // boceto/articulo plano: sin imagen de hero, jerarquia visual floja,
  // sin tabla comparativa real. `heroImageCaption` (siempre presente
  // hoy, no hay pipeline de fotos reales conectado a este agente) marca
  // que el hero debe mostrar un placeholder visual HONESTO (nunca una
  // foto falsa) en vez de texto plano sin imagen.
  heroImageCaption?: string;
  benefitsHeading?: string;
  comparisonTable?: LandingComparisonTable;
  // Fase O27.4d -- benchmark UX/UI de referencias reales del sector (ver
  // docs/ux-benchmark-taquillas.md): las landings de competidores
  // directos (Setroc, Taquiblok) usan bloques dedicados de "en que
  // sectores se usa" y "como funciona el pedido" con tratamiento visual
  // propio, no un parrafo de texto mas -- `useCases`/`processSteps`
  // alimentan los componentes zentryUseCasesGrid/zentryProcessSteps.
  useCases?: string[];
  processSteps?: string[];
  ctaPrimary: LandingCtaSpec;
  ctaSecondary?: LandingCtaSpec;
  benefitBlocks: LandingBenefitItem[];
  cards: LandingCardItem[];
  sections: LandingSection[];
  faq: LandingFaqItem[];
  finalCta: { headline: string; cta: LandingCtaSpec };
  internalLinks: string[];
  visualHierarchyNotes: string[];
  createdAt: string;
  updatedAt: string;
}
