import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { DEPLOYMENT_PLAN_STATUSES, DeploymentPlanStatus, ProductionDeploymentPlan } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Production Deployment Plan Registry (Fase O13.0): log append-only de
 * instantaneas, mismo patron que change-packs.ts/staging-executions.ts/
 * asset-requests.ts. Un plan describe COMO se aplicaria de forma segura
 * un draft de staging ya probado a produccion -- NUNCA lo aplica. Ningun
 * codigo de este fichero, ni de src/agents/production-deployment-planner.ts,
 * llama a WordPress produccion. Ver docs/production-deployment-strategy.md.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "production-deployment-plans.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(plan: ProductionDeploymentPlan): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(plan) + "\n", "utf-8");
}

export function readAllProductionDeploymentPlanSnapshots(): ProductionDeploymentPlan[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ProductionDeploymentPlan);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada deploymentPlanId. */
export function readCurrentProductionDeploymentPlans(): ProductionDeploymentPlan[] {
  const byId = new Map<string, ProductionDeploymentPlan>();
  for (const snapshot of readAllProductionDeploymentPlanSnapshots()) {
    byId.set(snapshot.deploymentPlanId, snapshot);
  }
  return [...byId.values()];
}

export function findProductionDeploymentPlanById(deploymentPlanId: string): ProductionDeploymentPlan | undefined {
  return readCurrentProductionDeploymentPlans().find((p) => p.deploymentPlanId === deploymentPlanId);
}

/** Dedup: una misma ejecucion de staging nunca genera dos planes de deploy activos. */
export function findPlanByStagingExecutionId(
  stagingExecutionId: string,
  current: ProductionDeploymentPlan[]
): ProductionDeploymentPlan | undefined {
  return current.find((p) => p.stagingExecutionId === stagingExecutionId);
}

export function getProductionDeploymentPlansFilePath(): string {
  return FILE;
}

export function isValidDeploymentPlanStatus(value: string): value is DeploymentPlanStatus {
  return (DEPLOYMENT_PLAN_STATUSES as readonly string[]).includes(value);
}

export interface CreateProductionDeploymentPlanInput {
  changePackId: string;
  stagingExecutionId: string;
  keyword: string;
  page?: string;
  sourceDraftId: number;
  sourceDraftUrl: string;
  deploymentType: ProductionDeploymentPlan["deploymentType"];
  includedMediaIds: number[];
  includedAssetRequests: string[];
  seoMeta: ProductionDeploymentPlan["seoMeta"];
  checklist: string[];
  risks: string[];
  rollbackPlan: string[];
  requiredApprovals: string[];
}

export interface UpsertProductionDeploymentPlanResult {
  plan: ProductionDeploymentPlan;
  isNew: boolean;
}

/**
 * Crea un plan `plan_ready_for_review` nuevo para esta ejecucion de
 * staging si no existe todavia (dedup por stagingExecutionId), o
 * devuelve el existente sin tocarlo -- nunca se regenera un plan ya
 * propuesto solo porque el draft se vuelva a ver en una pasada
 * posterior de growth:daily.
 */
export function upsertProposedDeploymentPlan(
  input: CreateProductionDeploymentPlanInput,
  current: ProductionDeploymentPlan[]
): UpsertProductionDeploymentPlanResult {
  const existing = findPlanByStagingExecutionId(input.stagingExecutionId, current);
  if (existing) {
    return { plan: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const plan: ProductionDeploymentPlan = {
    deploymentPlanId: `prod-deploy-${randomUUID()}`,
    sourceEnvironment: "staging",
    targetEnvironment: "production",
    changePackId: input.changePackId,
    stagingExecutionId: input.stagingExecutionId,
    keyword: input.keyword,
    page: input.page,
    sourceDraftId: input.sourceDraftId,
    sourceDraftUrl: input.sourceDraftUrl,
    deploymentType: input.deploymentType,
    includedMediaIds: input.includedMediaIds,
    includedAssetRequests: input.includedAssetRequests,
    seoMeta: input.seoMeta,
    checklist: input.checklist,
    risks: input.risks,
    rollbackPlan: input.rollbackPlan,
    requiredApprovals: input.requiredApprovals,
    status: "plan_ready_for_review",
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(plan);
  current.push(plan);
  return { plan, isNew: true };
}

export interface SetDeploymentPlanStatusUpdates {
  approvalRequestId?: string;
  targetPageId?: number;
  lastError?: string;
}

/**
 * Cambia el status de un plan (CLI/futuro agente de aplicacion). NUNCA
 * llama a WordPress produccion por si misma -- eso, si algun dia existe,
 * es responsabilidad explicita de un modulo aparte (no implementado en
 * la Fase O13.0, por diseno).
 */
export function setDeploymentPlanStatus(
  deploymentPlanId: string,
  newStatus: DeploymentPlanStatus,
  updates: SetDeploymentPlanStatusUpdates = {}
): ProductionDeploymentPlan | undefined {
  const current = readCurrentProductionDeploymentPlans();
  const existing = current.find((p) => p.deploymentPlanId === deploymentPlanId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: ProductionDeploymentPlan = { ...existing, ...updates, status: newStatus, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
