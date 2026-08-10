import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { PRODUCTION_EXECUTION_STATUSES, ProductionExecution, ProductionExecutionStatus, ProductionMediaMapping } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Production Execution Registry (Fase O13.2): log append-only de
 * instantaneas, mismo patron que staging-executions.ts/change-packs.ts.
 * Es el UNICO registro de todo el proyecto ligado a una capacidad
 * (gateada, hoy siempre desactivada) de escritura real contra WordPress
 * PRODUCCION. Ver src/agents/production-draft-executor.ts y
 * src/adapters/wordpress-production.ts.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "production-executions.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(execution: ProductionExecution): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(execution) + "\n", "utf-8");
}

export function readAllProductionExecutionSnapshots(): ProductionExecution[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ProductionExecution);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada executionId. */
export function readCurrentProductionExecutions(): ProductionExecution[] {
  const byId = new Map<string, ProductionExecution>();
  for (const snapshot of readAllProductionExecutionSnapshots()) {
    byId.set(snapshot.executionId, snapshot);
  }
  return [...byId.values()];
}

export function findProductionExecutionById(executionId: string): ProductionExecution | undefined {
  return readCurrentProductionExecutions().find((e) => e.executionId === executionId);
}

/** Dedup: un mismo plan de deploy nunca genera dos ejecuciones de produccion activas. */
export function findExecutionByDeploymentPlanId(
  deploymentPlanId: string,
  current: ProductionExecution[]
): ProductionExecution | undefined {
  return current.find((e) => e.deploymentPlanId === deploymentPlanId);
}

export function getProductionExecutionsFilePath(): string {
  return FILE;
}

export function isValidProductionExecutionStatus(value: string): value is ProductionExecutionStatus {
  return (PRODUCTION_EXECUTION_STATUSES as readonly string[]).includes(value);
}

export interface CreatePendingExecutionInput {
  deploymentPlanId: string;
  changePackId: string;
  keyword: string;
  page?: string;
  backend: string;
  sourceDraftId: number;
  sourceDraftUrl: string;
  seoMeta: ProductionExecution["seoMeta"];
  mediaMappings: ProductionMediaMapping[];
  rollbackPlan: string[];
}

export interface CreatePendingExecutionResult {
  execution: ProductionExecution;
  isNew: boolean;
}

/**
 * Crea una ejecucion `pending_approval` nueva para este plan si no
 * existe todavia (dedup por deploymentPlanId), o devuelve la existente
 * sin tocarla.
 */
export function createPendingExecution(
  input: CreatePendingExecutionInput,
  current: ProductionExecution[]
): CreatePendingExecutionResult {
  const existing = findExecutionByDeploymentPlanId(input.deploymentPlanId, current);
  if (existing) {
    return { execution: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const execution: ProductionExecution = {
    executionId: `prod-exec-${randomUUID()}`,
    deploymentPlanId: input.deploymentPlanId,
    changePackId: input.changePackId,
    keyword: input.keyword,
    page: input.page,
    environment: "production",
    backend: input.backend,
    sourceDraftId: input.sourceDraftId,
    sourceDraftUrl: input.sourceDraftUrl,
    seoMeta: input.seoMeta,
    mediaMappings: input.mediaMappings,
    rollbackPlan: input.rollbackPlan,
    status: "pending_approval",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(execution);
  current.push(execution);
  return { execution, isNew: true };
}

export interface SetProductionExecutionStatusUpdates {
  approvalRequestId?: string;
  targetPageId?: number;
  targetDraftUrl?: string;
  mediaMappings?: ProductionMediaMapping[];
  submittedContentSnapshot?: string;
  lastError?: string;
  incrementAttempts?: boolean;
}

/**
 * Cambia el status de una ejecucion. NUNCA llama a WordPress produccion
 * por si misma -- eso es responsabilidad exclusiva de
 * src/agents/production-draft-executor.ts, y solo cuando las 3
 * condiciones de entorno + las 2 aprobaciones (plan + ejecucion) ya se
 * cumplen.
 */
export function setProductionExecutionStatus(
  executionId: string,
  newStatus: ProductionExecutionStatus,
  updates: SetProductionExecutionStatusUpdates = {}
): ProductionExecution | undefined {
  const current = readCurrentProductionExecutions();
  const existing = current.find((e) => e.executionId === executionId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const { incrementAttempts, ...rest } = updates;
  const updated: ProductionExecution = {
    ...existing,
    ...rest,
    status: newStatus,
    attempts: incrementAttempts ? existing.attempts + 1 : existing.attempts,
    updatedAt: now,
  };
  appendSnapshot(updated);
  return updated;
}
