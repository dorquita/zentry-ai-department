import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { CHANGE_PACK_STATUSES, ChangePack, ChangePackStatus, WorkOrder, WorkOrderStatus } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Change Pack Registry: convierte una work order ya detallada en un
 * paquete de cambio concreto (pasos de implementacion, checklist de
 * revision humana, riesgos, notas de reversion). Un change pack NUNCA
 * ejecuta nada — ni siquiera en `approved_to_execute`, que solo significa
 * "Pau aceptaria que esto se ejecute el dia que exista un modo APPLY", no
 * "publicar ahora". No toca WordPress, Google Ads, GA4, GTM, n8n ni
 * qdrant, en ningun estado.
 *
 * data/change-packs.jsonl es un log append-only de instantaneas, mismo
 * patron que action-backlog.jsonl/work-orders.jsonl/
 * approval-requests.jsonl: cada linea es como estaba un change pack en un
 * momento dado. El estado actual es su instantanea mas reciente. No hay
 * un fichero de auditoria aparte (a diferencia de action-audit.jsonl/
 * work-order-audit.jsonl): el propio historico de instantaneas ya sirve
 * de auditoria completa (leer todas las lineas con el mismo
 * changePackId reconstruye toda la historia de cambios de estado).
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const CHANGE_PACKS_FILE = path.join(DATA_DIR, "change-packs.jsonl");

// Solo estos 3 estados de work order representan un plan ya detallado
// (no un borrador a medio hacer) y por tanto son elegibles para
// convertirse en change pack. `draft`, `rejected`, `applied_manually` y
// `superseded` quedan fuera a proposito.
export const ELIGIBLE_WORK_ORDER_STATUSES: WorkOrderStatus[] = ["auto_prepared", "ready_for_review", "approved_to_prepare"];

export function isEligibleWorkOrder(workOrder: WorkOrder): boolean {
  return ELIGIBLE_WORK_ORDER_STATUSES.includes(workOrder.status);
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(changePack: ChangePack): void {
  ensureDataDir();
  fs.appendFileSync(CHANGE_PACKS_FILE, JSON.stringify(changePack) + "\n", "utf-8");
}

export function readAllChangePackSnapshots(): ChangePack[] {
  if (!fs.existsSync(CHANGE_PACKS_FILE)) return [];
  const raw = fs.readFileSync(CHANGE_PACKS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChangePack);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada changePackId. */
export function readCurrentChangePacks(): ChangePack[] {
  const byId = new Map<string, ChangePack>();
  for (const snapshot of readAllChangePackSnapshots()) {
    byId.set(snapshot.changePackId, snapshot);
  }
  return [...byId.values()];
}

export function findChangePackById(changePackId: string): ChangePack | undefined {
  return readCurrentChangePacks().find((cp) => cp.changePackId === changePackId);
}

export function findChangePackByWorkOrderId(workOrderId: string, current: ChangePack[]): ChangePack | undefined {
  return current.find((cp) => cp.workOrderId === workOrderId);
}

export function getChangePacksFilePath(): string {
  return CHANGE_PACKS_FILE;
}

export function isValidChangePackStatus(value: string): value is ChangePackStatus {
  return (CHANGE_PACK_STATUSES as string[]).includes(value);
}

export interface CreateChangePackInput {
  workOrder: WorkOrder;
  changeType: string;
  proposedChanges: Record<string, unknown>;
  currentAssumptions: string[];
  implementationSteps: string[];
  humanReviewChecklist: string[];
  risks: string[];
  rollbackNotes: string[];
  sourceAgent: string;
  /** Fase O31 -- ver ChangePack.targetWordpressPageId en types.ts. */
  targetWordpressPageId?: number;
}

export interface UpsertChangePackResult {
  changePack: ChangePack;
  isNew: boolean;
}

/**
 * Crea un change pack nuevo para una work order que todavia no tiene uno
 * (dedup por `workOrderId`: una work order nunca tiene mas de un change
 * pack activo), o "toca" el existente (solo `updatedAt`, sin regenerar
 * contenido) si ya lo tenia. Las 3 work orders elegibles
 * (`auto_prepared`/`ready_for_review`/`approved_to_prepare`) ya vienen
 * con el plan completamente detallado, asi que un change pack nuevo nace
 * directamente en `ready_for_review` — listo para que un humano lo mire,
 * nunca en `draft` a medio hacer.
 */
export function upsertChangePack(input: CreateChangePackInput, current: ChangePack[]): UpsertChangePackResult {
  const existing = findChangePackByWorkOrderId(input.workOrder.workOrderId, current);
  if (existing) {
    const touched: ChangePack = { ...existing, updatedAt: new Date().toISOString() };
    appendSnapshot(touched);
    const idx = current.indexOf(existing);
    current[idx] = touched;
    return { changePack: touched, isNew: false };
  }

  const now = new Date().toISOString();
  const changePack: ChangePack = {
    changePackId: randomUUID(),
    workOrderId: input.workOrder.workOrderId,
    actionId: input.workOrder.actionId,
    canonicalKey: input.workOrder.canonicalKey,
    targetBrand: input.workOrder.targetBrand,
    brandIntent: input.workOrder.brandIntent,
    page: input.workOrder.page,
    keyword: input.workOrder.keyword,
    changeType: input.changeType,
    targetWordpressPageId: input.targetWordpressPageId,
    priority: input.workOrder.priority,
    status: "ready_for_review",
    proposedChanges: input.proposedChanges,
    currentAssumptions: input.currentAssumptions,
    implementationSteps: input.implementationSteps,
    humanReviewChecklist: input.humanReviewChecklist,
    risks: input.risks,
    rollbackNotes: input.rollbackNotes,
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(changePack);
  current.push(changePack);
  return { changePack, isNew: true };
}

/**
 * Cambia el status de un change pack (usado por
 * scripts/update-change-pack-status.ts). NUNCA ejecuta nada real, ni
 * siquiera en `approved_to_execute`: solo anade una nueva instantanea con
 * el status actualizado.
 */
export function setChangePackStatus(
  changePackId: string,
  newStatus: ChangePackStatus,
  changedBy: string
): ChangePack | undefined {
  const current = readCurrentChangePacks();
  const existing = current.find((cp) => cp.changePackId === changePackId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: ChangePack = { ...existing, status: newStatus, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

// --- Texto compartido entre los 3 builders (SEO/Content/CRO) ---

/**
 * Confirmacion de seguridad en texto plano, pensada para incluirse en el
 * checklist de revision humana de cualquier change pack, de cualquier
 * categoria. Complementa (no sustituye) la ausencia total de codigo de
 * ejecucion real en este proyecto.
 */
export const PRODUCTION_SAFETY_CHECKLIST_ITEMS: string[] = [
  "Confirmar que este paquete NO se ha aplicado en WordPress ni se ha publicado nada.",
  "Confirmar que no se ha modificado Google Ads, GA4, GTM, n8n ni qdrant al preparar este paquete.",
  "Aplicar (si se decide hacerlo) solo de forma manual y tras aprobacion humana explicita — este sistema no tiene modo de ejecucion automatica.",
];

/**
 * Notas de reversion genericas, comunes a cualquier cambio de contenido
 * en una pagina existente. Los builders especificos pueden anadir notas
 * adicionales propias de su categoria.
 */
export function buildGenericRollbackNotes(pageLabel: string): string[] {
  return [
    `Antes de aplicar cualquier cambio: guardar una copia del contenido actual de ${pageLabel} (o registrar el estado actual si es una pagina nueva) para poder revertir.`,
    "Si algo falla tras aplicar el cambio manualmente, restaurar la copia guardada y confirmar que la pagina vuelve al estado anterior.",
    "Ningun cambio de este paquete se aplica automaticamente — la reversion, si hiciera falta, tambien es manual.",
  ];
}
