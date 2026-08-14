import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { STAGING_EXECUTION_STATUSES, StagingExecution, StagingExecutionSnapshot, StagingExecutionStatus } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Staging Execution Registry (Fase O12): convierte un change pack
 * `approved_to_execute` (mas la aprobacion explicita de Telegram para
 * ESA ejecucion concreta) en una escritura REAL pero acotada contra
 * WordPress STAGING. Ningun estado de este registro implica produccion
 * ni publicacion — ver src/agents/staging-executor.ts.
 *
 * data/staging-executions.jsonl es un log append-only de instantaneas,
 * mismo patron que change-packs.ts/wordpress-drafts.ts. El estado actual
 * es su instantanea mas reciente. No hay fichero de auditoria aparte: el
 * propio historico de instantaneas ya sirve de auditoria completa.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const STAGING_EXECUTIONS_FILE = path.join(DATA_DIR, "staging-executions.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(execution: StagingExecution): void {
  ensureDataDir();
  fs.appendFileSync(STAGING_EXECUTIONS_FILE, JSON.stringify(execution) + "\n", "utf-8");
}

export function readAllStagingExecutionSnapshots(): StagingExecution[] {
  if (!fs.existsSync(STAGING_EXECUTIONS_FILE)) return [];
  const raw = fs.readFileSync(STAGING_EXECUTIONS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StagingExecution);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada executionId. */
export function readCurrentStagingExecutions(): StagingExecution[] {
  const byId = new Map<string, StagingExecution>();
  for (const snapshot of readAllStagingExecutionSnapshots()) {
    byId.set(snapshot.executionId, snapshot);
  }
  return [...byId.values()];
}

export function findStagingExecutionById(executionId: string): StagingExecution | undefined {
  return readCurrentStagingExecutions().find((e) => e.executionId === executionId);
}

/** Dedup: un change pack nunca tiene mas de una ejecucion de staging activa. */
export function findStagingExecutionByChangePackId(changePackId: string, current: StagingExecution[]): StagingExecution | undefined {
  return current.find((e) => e.changePackId === changePackId);
}

export function getStagingExecutionsFilePath(): string {
  return STAGING_EXECUTIONS_FILE;
}

export function isValidStagingExecutionStatus(value: string): value is StagingExecutionStatus {
  return (STAGING_EXECUTION_STATUSES as string[]).includes(value);
}

export interface CreatePendingExecutionInput {
  changePackId: string;
  workOrderId: string;
  actionId: string;
  canonicalKey: string;
  targetBrand: StagingExecution["targetBrand"];
  changeType: string;
  page?: string;
  keyword: string;
  rollbackNotes: string[];
  /** Fase O31 -- ver StagingExecution.targetWordpressPageId en types.ts. */
  targetWordpressPageId?: number;
}

export interface UpsertPendingExecutionResult {
  execution: StagingExecution;
  isNew: boolean;
}

/**
 * Crea una ejecucion `pending_approval` nueva para un change pack que
 * todavia no tiene una (dedup por changePackId), o devuelve la existente
 * sin tocarla (nunca reinicia una ejecucion ya decidida solo porque el
 * change pack se vuelva a ver en una pasada posterior).
 */
export function upsertPendingExecution(
  input: CreatePendingExecutionInput,
  current: StagingExecution[]
): UpsertPendingExecutionResult {
  const existing = findStagingExecutionByChangePackId(input.changePackId, current);
  if (existing) {
    return { execution: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const execution: StagingExecution = {
    executionId: `staging-exec-${randomUUID()}`,
    changePackId: input.changePackId,
    workOrderId: input.workOrderId,
    actionId: input.actionId,
    canonicalKey: input.canonicalKey,
    targetBrand: input.targetBrand,
    changeType: input.changeType,
    page: input.page,
    keyword: input.keyword,
    targetWordpressPageId: input.targetWordpressPageId,
    status: "pending_approval",
    environment: "staging",
    wordpressBackend: "",
    rollbackNotes: input.rollbackNotes,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(execution);
  current.push(execution);
  return { execution, isNew: true };
}

/** Marca que la aprobacion de Telegram para esta ejecucion ya llego en estado "approved". */
export function markExecutionApproved(executionId: string, approvalRequestId: string): StagingExecution | undefined {
  const current = readCurrentStagingExecutions();
  const existing = current.find((e) => e.executionId === executionId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: StagingExecution = { ...existing, status: "approved", approvalRequestId, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export function markExecutionRejected(executionId: string, approvalRequestId: string): StagingExecution | undefined {
  const current = readCurrentStagingExecutions();
  const existing = current.find((e) => e.executionId === executionId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: StagingExecution = { ...existing, status: "rejected", approvalRequestId, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export interface RecordAppliedInput {
  wordpressBackend: string;
  wordpressPageId: number;
  wordpressDraftUrl: string;
  snapshot: StagingExecutionSnapshot;
}

/** Registra una escritura real EXITOSA (siempre status draft en WordPress). Nunca optimista: solo tras respuesta real de la API. */
export function recordExecutionApplied(executionId: string, input: RecordAppliedInput): StagingExecution | undefined {
  const current = readCurrentStagingExecutions();
  const existing = current.find((e) => e.executionId === executionId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: StagingExecution = {
    ...existing,
    status: "applied_to_staging",
    wordpressBackend: input.wordpressBackend,
    wordpressPageId: input.wordpressPageId,
    wordpressDraftUrl: input.wordpressDraftUrl,
    snapshot: input.snapshot,
    attempts: existing.attempts + 1,
    lastError: undefined,
    updatedAt: now,
  };
  appendSnapshot(updated);
  return updated;
}

/** Registra un fallo (red/API/validacion). Nunca crashea el agente que llama; se reintenta en la siguiente pasada. */
export function recordExecutionFailed(executionId: string, sanitizedError: string): StagingExecution | undefined {
  const current = readCurrentStagingExecutions();
  const existing = current.find((e) => e.executionId === executionId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: StagingExecution = {
    ...existing,
    status: "failed",
    lastError: sanitizedError,
    attempts: existing.attempts + 1,
    updatedAt: now,
  };
  appendSnapshot(updated);
  return updated;
}

/** Marca una ejecucion como revertida. Quien llama (staging-executor.ts / scripts/update-staging-execution-status.ts) ya debe haber hecho el rollback real en WordPress ANTES de llamar a esto. */
export function markExecutionRolledBack(executionId: string, reason?: string): StagingExecution | undefined {
  const current = readCurrentStagingExecutions();
  const existing = current.find((e) => e.executionId === executionId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const rollbackNotes = reason ? [...existing.rollbackNotes, `Rollback ejecutado: ${reason}`] : existing.rollbackNotes;
  const updated: StagingExecution = { ...existing, status: "rolled_back", rollbackNotes, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
