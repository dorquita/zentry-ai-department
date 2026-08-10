import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Image Optimization Registry (Fase O12.9): log append-only de
 * instantaneas, mismo patron que el resto del proyecto. Cada linea es un
 * snapshot; el estado actual es la instantanea mas reciente por
 * `optimizationId`. Una optimizacion NUNCA borra el media original --
 * solo propone/sube una version WebP nueva y separada. `appliedToDraft`
 * se queda en `false` hasta que una sustitucion real en el draft se
 * confirme y ejecute (Fase O12.9: construido pero NO ejecutado sin
 * aprobacion explicita).
 */

export type ImageOptimizationStatus = "proposed" | "uploaded" | "applied" | "failed";

export interface ImageOptimization {
  optimizationId: string;
  assetRequestId: string;
  sourceWordpressMediaId: number;
  sourceFormat: string;
  sourceFileSize: number;
  outputFormat: "webp";
  outputQuality: number;
  outputWordpressMediaId?: number;
  outputWordpressMediaUrl?: string;
  outputFileSize?: number;
  width?: number;
  height?: number;
  appliedToDraft: boolean;
  appliedToPageId?: number;
  status: ImageOptimizationStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "image-optimizations.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(record: ImageOptimization): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(record) + "\n", "utf-8");
}

export function readAllImageOptimizationSnapshots(): ImageOptimization[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ImageOptimization);
}

export function readCurrentImageOptimizations(): ImageOptimization[] {
  const byId = new Map<string, ImageOptimization>();
  for (const snapshot of readAllImageOptimizationSnapshots()) {
    byId.set(snapshot.optimizationId, snapshot);
  }
  return [...byId.values()];
}

export function findImageOptimizationById(optimizationId: string): ImageOptimization | undefined {
  return readCurrentImageOptimizations().find((r) => r.optimizationId === optimizationId);
}

export function findLatestOptimizationForSourceMedia(sourceWordpressMediaId: number): ImageOptimization | undefined {
  const matches = readCurrentImageOptimizations()
    .filter((r) => r.sourceWordpressMediaId === sourceWordpressMediaId && r.status !== "failed")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return matches[0];
}

export function getImageOptimizationsFilePath(): string {
  return FILE;
}

export interface CreateOptimizationInput {
  assetRequestId: string;
  sourceWordpressMediaId: number;
  sourceFormat: string;
  sourceFileSize: number;
  outputQuality: number;
}

export function recordProposedOptimization(input: CreateOptimizationInput): ImageOptimization {
  const now = new Date().toISOString();
  const record: ImageOptimization = {
    optimizationId: `img-opt-${randomUUID()}`,
    assetRequestId: input.assetRequestId,
    sourceWordpressMediaId: input.sourceWordpressMediaId,
    sourceFormat: input.sourceFormat,
    sourceFileSize: input.sourceFileSize,
    outputFormat: "webp",
    outputQuality: input.outputQuality,
    appliedToDraft: false,
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(record);
  return record;
}

export function markOptimizationUploaded(
  optimizationId: string,
  updates: { outputWordpressMediaId: number; outputWordpressMediaUrl: string; outputFileSize: number; width?: number; height?: number }
): ImageOptimization | undefined {
  const existing = findImageOptimizationById(optimizationId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: ImageOptimization = { ...existing, ...updates, status: "uploaded", updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export function markOptimizationFailed(optimizationId: string, error: string): ImageOptimization | undefined {
  const existing = findImageOptimizationById(optimizationId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: ImageOptimization = { ...existing, status: "failed", lastError: error, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export function markOptimizationApplied(optimizationId: string, pageId: number): ImageOptimization | undefined {
  const existing = findImageOptimizationById(optimizationId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: ImageOptimization = { ...existing, status: "applied", appliedToDraft: true, appliedToPageId: pageId, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
