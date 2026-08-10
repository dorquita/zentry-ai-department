import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  ACTION_STATUSES,
  ActionStatus,
  BacklogAction,
  BrandIntentCategory,
  BrandTarget,
  Priority,
} from "./types";
import { classifyActionAutonomy } from "./autonomy-policy";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Action Backlog: capa operativa por encima de jobs/eventos. Convierte
 * recomendaciones repetidas de los agentes en una unica accion
 * deduplicada, con historial y estado.
 *
 * data/action-backlog.jsonl es un log append-only (igual que jobs.jsonl y
 * department-events.jsonl): cada linea es una instantanea de una accion.
 * Nunca se borra ni se reescribe una linea existente — el estado actual
 * de una accion es su instantanea mas reciente. Esto evita por completo
 * la necesidad de "reescribir con backup" (no hay reescritura).
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const BACKLOG_FILE = path.join(DATA_DIR, "action-backlog.jsonl");

const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function normalize(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "");
}

export function buildCanonicalKey(input: {
  brandIntent: string;
  actionType: string;
  keyword: string;
  page?: string;
}): string {
  return [input.brandIntent, input.actionType, normalize(input.keyword), normalize(input.page ?? "")].join("|");
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(action: BacklogAction): void {
  ensureDataDir();
  fs.appendFileSync(BACKLOG_FILE, JSON.stringify(action) + "\n", "utf-8");
}

/** Lee TODAS las instantaneas del historico (solo lectura). */
export function readAllActionSnapshots(): BacklogAction[] {
  if (!fs.existsSync(BACKLOG_FILE)) return [];
  const raw = fs.readFileSync(BACKLOG_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BacklogAction);
}

/**
 * Reduce el log append-only al estado ACTUAL: la instantanea mas reciente
 * de cada actionId (el fichero esta ordenado por tiempo de escritura, asi
 * que "la mas reciente" = la ultima que aparece).
 */
export function readCurrentActions(): BacklogAction[] {
  const byId = new Map<string, BacklogAction>();
  for (const snapshot of readAllActionSnapshots()) {
    byId.set(snapshot.actionId, snapshot);
  }
  return [...byId.values()];
}

export function findActionById(actionId: string): BacklogAction | undefined {
  return readCurrentActions().find((a) => a.actionId === actionId);
}

export function getBacklogFilePath(): string {
  return BACKLOG_FILE;
}

export function isValidActionStatus(value: string): value is ActionStatus {
  return (ACTION_STATUSES as string[]).includes(value);
}

/**
 * Estados que cuentan como "decidido" (por un humano via `actions:update`,
 * o por la politica de autonomia en una pasada anterior) y que por tanto
 * NUNCA cambian solo porque la accion se vuelva a detectar. Solo "new" y
 * "open" — los dos estados puramente automaticos de "sin decidir todavia"
 * — se re-evaluan contra la politica de autonomia vigente en cada pasada
 * (ver nextStatusOnReappear). Esto es intencional: permite que el
 * backlog acumulado antes de la Fase O7 tambien se beneficie de la nueva
 * autonomia la proxima vez que se vuelva a detectar, sin tocar ninguna
 * accion que un humano (o una pasada anterior de la politica) ya decidio.
 */
function nextStatusOnReappear(current: ActionStatus, actionType: string): ActionStatus {
  if (current !== "new" && current !== "open") return current;
  return classifyActionAutonomy({ actionType }).backlogStatus;
}

export interface UpsertActionInput {
  title: string;
  description: string;
  sourceAgent: string;
  department?: string;
  brandIntent: BrandIntentCategory;
  targetBrand: BrandTarget;
  keyword: string;
  page?: string;
  actionType: string;
  priority: Priority;
  impact?: string;
  effort?: string;
  evidence?: Record<string, unknown>;
  recommendation: string;
  departmentRunId: string;
  relatedJobIds?: string[];
}

export interface UpsertActionResult {
  action: BacklogAction;
  isNew: boolean;
}

/**
 * Crea la accion si no existe todavia (por canonicalKey), o actualiza su
 * instantanea (seenCount, lastSeenAt, runIds, sourceAgents, evidencia mas
 * reciente) si ya existia. El status inicial (accion nueva) y las
 * transiciones automaticas al reaparecer (accion ya vista) los decide la
 * politica de autonomia (Fase O7, ver src/core/autonomy-policy.ts) segun
 * el `actionType` — nunca un valor fijo. Debe llamarse con el snapshot
 * ACTUAL de acciones ya cargado (parametro `current`) para poder
 * deduplicar varias llamadas seguidas dentro de la misma ejecucion sin
 * releer el fichero cada vez.
 */
export function upsertAction(
  input: UpsertActionInput,
  current: BacklogAction[]
): UpsertActionResult {
  const canonicalKey = buildCanonicalKey({
    brandIntent: input.brandIntent,
    actionType: input.actionType,
    keyword: input.keyword,
    page: input.page,
  });
  const existing = current.find((a) => a.canonicalKey === canonicalKey);
  const now = new Date().toISOString();
  const classification = classifyActionAutonomy({ actionType: input.actionType });

  if (existing) {
    const updated: BacklogAction = {
      ...existing,
      title: input.title,
      description: input.description,
      recommendation: input.recommendation,
      evidence: input.evidence ?? existing.evidence,
      priority: input.priority,
      impact: input.impact ?? existing.impact,
      effort: input.effort ?? existing.effort,
      sourceAgents: [...new Set([...existing.sourceAgents, input.sourceAgent])],
      lastSeenAt: now,
      seenCount: existing.seenCount + 1,
      runIds: [...new Set([...existing.runIds, input.departmentRunId])],
      relatedJobIds: input.relatedJobIds
        ? [...new Set([...existing.relatedJobIds, ...input.relatedJobIds])]
        : existing.relatedJobIds,
      status: nextStatusOnReappear(existing.status, input.actionType),
      // La metadata de autonomia se refresca siempre con la politica
      // vigente, aunque el status no cambie (una accion ya "approved" por
      // un humano sigue mostrando correctamente su nivel/riesgo real).
      autonomyLevel: classification.autonomyLevel,
      riskLevel: classification.riskLevel,
      autonomyReason: classification.reason,
      requiresApproval: classification.requiresApproval,
      updatedAt: now,
    };
    appendSnapshot(updated);
    // Refleja el cambio en el array `current` para que llamadas
    // posteriores dentro de la misma ejecucion vean la version actualizada.
    const idx = current.indexOf(existing);
    current[idx] = updated;
    return { action: updated, isNew: false };
  }

  const action: BacklogAction = {
    actionId: randomUUID(),
    canonicalKey,
    title: input.title,
    description: input.description,
    sourceAgents: [input.sourceAgent],
    department: input.department ?? "web-growth",
    brandIntent: input.brandIntent,
    targetBrand: input.targetBrand,
    keyword: input.keyword,
    page: input.page,
    actionType: input.actionType,
    priority: input.priority,
    impact: input.impact,
    effort: input.effort,
    status: classification.backlogStatus,
    requiresApproval: classification.requiresApproval,
    autonomyLevel: classification.autonomyLevel,
    riskLevel: classification.riskLevel,
    autonomyReason: classification.reason,
    evidence: input.evidence,
    recommendation: input.recommendation,
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 1,
    runIds: [input.departmentRunId],
    relatedJobIds: input.relatedJobIds ?? [],
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(action);
  current.push(action);
  return { action, isNew: true };
}

/**
 * Cambia el status de una accion existente (usado por
 * scripts/update-action-status.ts). NUNCA ejecuta nada real: solo anade
 * una nueva instantanea con el status actualizado. Devuelve undefined si
 * el actionId no existe.
 */
export function setActionStatus(
  actionId: string,
  newStatus: ActionStatus,
  changedBy: string
): BacklogAction | undefined {
  const current = readCurrentActions();
  const existing = current.find((a) => a.actionId === actionId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: BacklogAction = {
    ...existing,
    status: newStatus,
    updatedAt: now,
  };
  appendSnapshot(updated);
  return updated;
}
