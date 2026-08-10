import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Production Draft Edit Registry (Fase O13.5): log append-only de
 * instantaneas, mismo patron que draft-image-insertions.ts (staging,
 * Fase O12.8) pero para PRODUCCION. Cada edicion guarda el snapshot
 * COMPLETO previo (title/content/excerpt/slug) ANTES de escribir --
 * nunca solo un diff -- para poder revertir sin reconstruir nada.
 */

export type ProductionDraftEditStatus = "applied" | "failed" | "rolled_back";

export interface ProductionDraftEdit {
  editId: string;
  pageId: number;
  previousTitle: string;
  previousContentHtml: string;
  previousExcerpt: string;
  previousSlug: string;
  newTitle: string;
  newContentHtml: string;
  newExcerpt: string;
  newSlug: string;
  status: ProductionDraftEditStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "production-draft-edits.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(edit: ProductionDraftEdit): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(edit) + "\n", "utf-8");
}

export function readAllProductionDraftEditSnapshots(): ProductionDraftEdit[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ProductionDraftEdit);
}

export function readCurrentProductionDraftEdits(): ProductionDraftEdit[] {
  const byId = new Map<string, ProductionDraftEdit>();
  for (const snapshot of readAllProductionDraftEditSnapshots()) {
    byId.set(snapshot.editId, snapshot);
  }
  return [...byId.values()];
}

export function findProductionDraftEditById(editId: string): ProductionDraftEdit | undefined {
  return readCurrentProductionDraftEdits().find((e) => e.editId === editId);
}

export function getProductionDraftEditsFilePath(): string {
  return FILE;
}

export interface RecordProductionDraftEditInput {
  pageId: number;
  previousTitle: string;
  previousContentHtml: string;
  previousExcerpt: string;
  previousSlug: string;
  newTitle: string;
  newContentHtml: string;
  newExcerpt: string;
  newSlug: string;
}

/** Crea el snapshot ANTES de intentar el update real en WordPress. */
export function recordPendingProductionDraftEdit(input: RecordProductionDraftEditInput): ProductionDraftEdit {
  const now = new Date().toISOString();
  const edit: ProductionDraftEdit = {
    editId: `prod-edit-${randomUUID()}`,
    ...input,
    status: "applied",
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(edit);
  return edit;
}

export function markProductionDraftEditFailed(editId: string, error: string): ProductionDraftEdit | undefined {
  const existing = findProductionDraftEditById(editId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: ProductionDraftEdit = { ...existing, status: "failed", lastError: error, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export function markProductionDraftEditRolledBack(editId: string): ProductionDraftEdit | undefined {
  const existing = findProductionDraftEditById(editId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: ProductionDraftEdit = { ...existing, status: "rolled_back", updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
