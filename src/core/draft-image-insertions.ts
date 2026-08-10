import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Draft Image Insertion Registry (Fase O12.8): log append-only de
 * instantaneas, mismo patron que asset-requests.ts/staging-executions.ts.
 * Cada linea es un snapshot; el estado actual es la instantanea mas
 * reciente por `insertionId`. Guarda SIEMPRE el `previousContentHtml`
 * completo (snapshot previo, nunca solo un diff) para que el rollback no
 * dependa de reconstruir nada -- solo restaura ese texto tal cual.
 */

export type DraftImageInsertionStatus = "applied" | "rolled_back" | "failed";

export interface DraftImageInsertion {
  insertionId: string;
  pageId: number;
  assetRequestId: string;
  wordpressMediaId: number;
  wordpressMediaUrl: string;
  previousContentHtml: string;
  newContentHtml: string;
  status: DraftImageInsertionStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "draft-image-insertions.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(record: DraftImageInsertion): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(record) + "\n", "utf-8");
}

export function readAllDraftImageInsertionSnapshots(): DraftImageInsertion[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DraftImageInsertion);
}

export function readCurrentDraftImageInsertions(): DraftImageInsertion[] {
  const byId = new Map<string, DraftImageInsertion>();
  for (const snapshot of readAllDraftImageInsertionSnapshots()) {
    byId.set(snapshot.insertionId, snapshot);
  }
  return [...byId.values()];
}

export function findDraftImageInsertionById(insertionId: string): DraftImageInsertion | undefined {
  return readCurrentDraftImageInsertions().find((r) => r.insertionId === insertionId);
}

export function getDraftImageInsertionsFilePath(): string {
  return FILE;
}

export interface RecordInsertionInput {
  pageId: number;
  assetRequestId: string;
  wordpressMediaId: number;
  wordpressMediaUrl: string;
  previousContentHtml: string;
  newContentHtml: string;
}

/** Crea el snapshot ANTES de intentar el update real en WordPress. */
export function recordPendingInsertion(input: RecordInsertionInput): DraftImageInsertion {
  const now = new Date().toISOString();
  const record: DraftImageInsertion = {
    insertionId: `draft-img-${randomUUID()}`,
    pageId: input.pageId,
    assetRequestId: input.assetRequestId,
    wordpressMediaId: input.wordpressMediaId,
    wordpressMediaUrl: input.wordpressMediaUrl,
    previousContentHtml: input.previousContentHtml,
    newContentHtml: input.newContentHtml,
    status: "applied",
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(record);
  return record;
}

export function markInsertionFailed(insertionId: string, error: string): DraftImageInsertion | undefined {
  const existing = findDraftImageInsertionById(insertionId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: DraftImageInsertion = { ...existing, status: "failed", lastError: error, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export function markInsertionRolledBack(insertionId: string): DraftImageInsertion | undefined {
  const existing = findDraftImageInsertionById(insertionId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: DraftImageInsertion = { ...existing, status: "rolled_back", updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
