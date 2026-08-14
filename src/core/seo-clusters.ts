import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { SeoCluster } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * SEO Cluster Registry (Fase O29) — mismo patron append-only que
 * change-packs.jsonl/staging-executions.jsonl: cada linea es una
 * instantanea, el estado ACTUAL de un cluster es su instantanea mas
 * reciente por clusterId. Nunca muta data/action-backlog.jsonl -- este
 * registro vive POR ENCIMA del backlog de keywords sueltas, agrupandolas
 * sin tocar el dato original.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "seo-clusters.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendSnapshot(cluster: SeoCluster): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(cluster) + "\n", "utf-8");
}

export function readAllSeoClusterSnapshots(): SeoCluster[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SeoCluster);
}

export function readCurrentSeoClusters(): SeoCluster[] {
  const byId = new Map<string, SeoCluster>();
  for (const snapshot of readAllSeoClusterSnapshots()) {
    byId.set(snapshot.clusterId, snapshot);
  }
  return [...byId.values()];
}

export function findSeoClusterById(clusterId: string, current?: SeoCluster[]): SeoCluster | undefined {
  return (current ?? readCurrentSeoClusters()).find((c) => c.clusterId === clusterId);
}

/** Cluster cuyo `label` coincide (dedup al recalcular una pasada nueva, para no duplicar el mismo cluster dos veces). */
export function findSeoClusterByLabel(label: string, current?: SeoCluster[]): SeoCluster | undefined {
  return (current ?? readCurrentSeoClusters()).find((c) => c.label === label);
}

export function upsertSeoCluster(input: Omit<SeoCluster, "clusterId" | "createdAt" | "updatedAt">, current: SeoCluster[]): { cluster: SeoCluster; isNew: boolean } {
  const existing = findSeoClusterByLabel(input.label, current);
  const now = new Date().toISOString();
  if (existing) {
    const updated: SeoCluster = { ...existing, ...input, updatedAt: now };
    appendSnapshot(updated);
    return { cluster: updated, isNew: false };
  }
  const cluster: SeoCluster = { ...input, clusterId: `seo-cluster-${randomUUID()}`, createdAt: now, updatedAt: now };
  appendSnapshot(cluster);
  return { cluster, isNew: true };
}

export function setSeoClusterStatus(clusterId: string, status: SeoCluster["status"]): SeoCluster | undefined {
  const current = readCurrentSeoClusters();
  const existing = current.find((c) => c.clusterId === clusterId);
  if (!existing) return undefined;
  const updated: SeoCluster = { ...existing, status, updatedAt: new Date().toISOString() };
  appendSnapshot(updated);
  return updated;
}

export function getSeoClustersFilePath(): string {
  return FILE;
}
