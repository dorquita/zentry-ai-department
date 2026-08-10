import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  WORK_ORDER_STATUSES,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderPlanningOrigin,
  WorkOrderProductionSafety,
  BrandIntentCategory,
  BrandTarget,
  Priority,
} from "./types";
import { AutonomyLevel, AutonomyRiskLevel } from "./autonomy-policy";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Work Order Registry: convierte una accion `approved` (o, desde la Fase
 * O7, `auto_approved_for_planning`) del Action Backlog en un plan de
 * ejecucion detallado. Una work order NUNCA ejecuta nada.
 *
 * data/work-orders.jsonl es un log append-only de instantaneas (mismo
 * patron que data/action-backlog.jsonl): cada linea es como estaba una
 * work order en un momento dado. El estado actual es su instantanea mas
 * reciente. Nunca se borra ni se reescribe una linea.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const WORK_ORDERS_FILE = path.join(DATA_DIR, "work-orders.jsonl");

const PRODUCTION_SAFETY_NOTE =
  "No se ha tocado WordPress. No se ha publicado nada. No se ha ejecutado produccion. Esta work order es solo una propuesta local para revision humana.";

/**
 * Valor fijo, nunca modificado despues de crear la work order (ni por
 * touchWorkOrder ni por updateWorkOrderContent) — ver docstrings de
 * ambas funciones mas abajo. Existe para que la confirmacion de
 * seguridad quede trazada en el propio registro de datos, no solo en los
 * informes markdown que se generan a partir de el.
 */
function buildProductionSafety(): WorkOrderProductionSafety {
  return {
    wordpressTouched: false,
    published: false,
    productionExecuted: false,
    note: PRODUCTION_SAFETY_NOTE,
  };
}

/**
 * Fase O7: decide el status final que deja un Work Order Builder (o el
 * propio Approved Action Planner, para categorias sin builder dedicado)
 * segun de donde viene la work order. `ready_for_review` cuando un humano
 * aprobo la accion origen; `auto_prepared` cuando la aprobo la politica de
 * autonomia sin intervencion humana. Las dos significan exactamente lo
 * mismo en terminos de seguridad (nada ejecutado, pendiente de revision);
 * la unica diferencia es de donde vino la aprobacion para llegar hasta
 * aqui.
 */
export function finalReviewStatus(planningOrigin: WorkOrderPlanningOrigin): WorkOrderStatus {
  return planningOrigin === "auto_approved_for_planning" ? "auto_prepared" : "ready_for_review";
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(workOrder: WorkOrder): void {
  ensureDataDir();
  fs.appendFileSync(WORK_ORDERS_FILE, JSON.stringify(workOrder) + "\n", "utf-8");
}

export function readAllWorkOrderSnapshots(): WorkOrder[] {
  if (!fs.existsSync(WORK_ORDERS_FILE)) return [];
  const raw = fs.readFileSync(WORK_ORDERS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as WorkOrder);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada workOrderId. */
export function readCurrentWorkOrders(): WorkOrder[] {
  const byId = new Map<string, WorkOrder>();
  for (const snapshot of readAllWorkOrderSnapshots()) {
    byId.set(snapshot.workOrderId, snapshot);
  }
  return [...byId.values()];
}

export function findWorkOrderById(workOrderId: string): WorkOrder | undefined {
  return readCurrentWorkOrders().find((w) => w.workOrderId === workOrderId);
}

export function findWorkOrderByActionId(actionId: string): WorkOrder | undefined {
  return readCurrentWorkOrders().find((w) => w.actionId === actionId);
}

export function getWorkOrdersFilePath(): string {
  return WORK_ORDERS_FILE;
}

export function isValidWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as string[]).includes(value);
}

export type WorkOrderCategory = "seo" | "content" | "cro" | "sem" | "analytics" | "competitor_gap" | "other";

/**
 * Deriva la categoria (para enrutar a que Work Order Builder le toca
 * ampliar la propuesta) a partir del actionType del Action Backlog. No se
 * guarda como campo aparte: siempre se puede recalcular desde actionType.
 */
export function categorizeActionType(actionType: string): WorkOrderCategory {
  if (actionType.startsWith("seo:")) return "seo";
  if (actionType.startsWith("content:")) return "content";
  if (actionType.startsWith("cro:")) return "cro";
  if (actionType.startsWith("competitor:keyword_gap_sem")) return "sem";
  if (actionType.startsWith("competitor:")) return "competitor_gap";
  if (actionType.startsWith("sem:")) return "sem";
  if (actionType.startsWith("analytics:")) return "analytics";
  return "other";
}

export interface UpsertWorkOrderInput {
  actionId: string;
  canonicalKey: string;
  department?: string;
  sourceActionTitle: string;
  brandIntent: BrandIntentCategory;
  targetBrand: BrandTarget;
  actionType: string;
  keyword: string;
  page?: string;
  priority: Priority;
  impact?: string;
  effort?: string;
  requiresHumanReview?: boolean;
  planningOrigin: WorkOrderPlanningOrigin;
  autonomyLevel: AutonomyLevel;
  riskLevel: AutonomyRiskLevel;
  requiresApproval: boolean;
  proposedChanges: Record<string, unknown>;
  implementationChecklist: string[];
  risks: string[];
  dependencies?: string[];
  sourceAgent: string;
  initialStatus?: WorkOrderStatus;
}

export interface UpsertWorkOrderResult {
  workOrder: WorkOrder;
  isNew: boolean;
}

/**
 * Crea una work order nueva para una `actionId` que todavia no tiene una
 * (dedup por actionId, tal como pide la Fase O6), o la deja intacta si ya
 * existe (usar `touchWorkOrder` o `updateWorkOrderContent` para tocarla).
 * Quien llama es responsable de comprobar que la accion origen esta
 * `approved` o `auto_approved_for_planning` (Fase O7) — este modulo no
 * conoce el Action Backlog.
 */
export function upsertWorkOrder(
  input: UpsertWorkOrderInput,
  current: WorkOrder[]
): UpsertWorkOrderResult {
  const existing = current.find((w) => w.actionId === input.actionId);
  if (existing) {
    return { workOrder: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const workOrder: WorkOrder = {
    workOrderId: randomUUID(),
    actionId: input.actionId,
    canonicalKey: input.canonicalKey,
    department: input.department ?? "web-growth",
    sourceActionTitle: input.sourceActionTitle,
    brandIntent: input.brandIntent,
    targetBrand: input.targetBrand,
    actionType: input.actionType,
    keyword: input.keyword,
    page: input.page,
    priority: input.priority,
    impact: input.impact,
    effort: input.effort,
    status: input.initialStatus ?? "draft",
    requiresHumanReview: input.requiresHumanReview ?? true,
    planningOrigin: input.planningOrigin,
    autonomyLevel: input.autonomyLevel,
    riskLevel: input.riskLevel,
    requiresApproval: input.requiresApproval,
    productionSafety: buildProductionSafety(),
    proposedChanges: input.proposedChanges,
    implementationChecklist: input.implementationChecklist,
    risks: input.risks,
    dependencies: input.dependencies ?? [],
    sourceAgents: [input.sourceAgent],
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(workOrder);
  current.push(workOrder);
  return { workOrder, isNew: true };
}

/**
 * Anade la instantanea actual otra vez (con updatedAt fresco y, si se
 * indica, un nuevo sourceAgent) sin cambiar contenido, status ni la
 * confirmacion de seguridad (`productionSafety`, siempre igual desde la
 * creacion). Se usa cuando una accion `approved`/`auto_approved_for_planning`
 * que ya tiene work order vuelve a detectarse: "sigue vigente", pero no
 * hay nada nuevo que planificar.
 */
export function touchWorkOrder(workOrderId: string, sourceAgent?: string): WorkOrder | undefined {
  const current = readCurrentWorkOrders();
  const existing = current.find((w) => w.workOrderId === workOrderId);
  if (!existing) return undefined;

  const updated: WorkOrder = {
    ...existing,
    sourceAgents: sourceAgent ? [...new Set([...existing.sourceAgents, sourceAgent])] : existing.sourceAgents,
    updatedAt: new Date().toISOString(),
  };
  appendSnapshot(updated);
  return updated;
}

/**
 * Usado por los Work Order Builders (SEO/Content/CRO) para rellenar el
 * plan detallado de una work order `draft` ya creada por el Approved
 * Action Planner. No cambia actionId/canonicalKey/keyword/planningOrigin/
 * productionSafety — solo el contenido del plan y, opcionalmente, el
 * status (normalmente draft -> ready_for_review o draft -> auto_prepared,
 * ver finalReviewStatus()).
 */
export function updateWorkOrderContent(
  workOrderId: string,
  updates: {
    proposedChanges?: Record<string, unknown>;
    implementationChecklist?: string[];
    risks?: string[];
    dependencies?: string[];
    status?: WorkOrderStatus;
    sourceAgent?: string;
  }
): WorkOrder | undefined {
  const current = readCurrentWorkOrders();
  const existing = current.find((w) => w.workOrderId === workOrderId);
  if (!existing) return undefined;

  const updated: WorkOrder = {
    ...existing,
    proposedChanges: updates.proposedChanges ?? existing.proposedChanges,
    implementationChecklist: updates.implementationChecklist ?? existing.implementationChecklist,
    risks: updates.risks ?? existing.risks,
    dependencies: updates.dependencies ?? existing.dependencies,
    status: updates.status ?? existing.status,
    sourceAgents: updates.sourceAgent
      ? [...new Set([...existing.sourceAgents, updates.sourceAgent])]
      : existing.sourceAgents,
    updatedAt: new Date().toISOString(),
  };
  appendSnapshot(updated);
  return updated;
}

/**
 * Cambia el status de una work order (usado por
 * scripts/update-work-order-status.ts). NUNCA ejecuta nada real.
 */
export function setWorkOrderStatus(
  workOrderId: string,
  newStatus: WorkOrderStatus,
  changedBy: string
): WorkOrder | undefined {
  const current = readCurrentWorkOrders();
  const existing = current.find((w) => w.workOrderId === workOrderId);
  if (!existing) return undefined;

  const updated: WorkOrder = { ...existing, status: newStatus, updatedAt: new Date().toISOString() };
  appendSnapshot(updated);
  return updated;
}
