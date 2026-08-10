import * as fs from "fs";
import * as path from "path";
import { StagingReviewPage } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Fase O28.7 -- registro append-only de paginas de staging publicadas
 * EXPLICITAMENTE para revision visual humana (status=publish, solo
 * staging, nunca produccion). WordPress no expone meta personalizado via
 * REST sin registrarlo en el tema (fuera de alcance, no se toca
 * theme/functions.php) -- este registro ES la marca interna
 * "review_staging_page=true" que pidio Pau, viviendo en este sistema en
 * vez de como post meta de WordPress.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "staging-review-pages.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readAllStagingReviewPageSnapshots(): StagingReviewPage[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StagingReviewPage);
}

/** La instantanea mas reciente de CADA wordpressPageId. */
export function readCurrentStagingReviewPages(): StagingReviewPage[] {
  const byId = new Map<number, StagingReviewPage>();
  for (const snapshot of readAllStagingReviewPageSnapshots()) {
    byId.set(snapshot.wordpressPageId, snapshot);
  }
  return [...byId.values()];
}

export function findStagingReviewPage(wordpressPageId: number, current?: StagingReviewPage[]): StagingReviewPage | undefined {
  return (current ?? readCurrentStagingReviewPages()).find((p) => p.wordpressPageId === wordpressPageId);
}

export function recordStagingReviewPage(input: Omit<StagingReviewPage, "reviewStagingPage" | "publishedAt">): StagingReviewPage {
  ensureDataDir();
  const record: StagingReviewPage = { ...input, reviewStagingPage: true, publishedAt: new Date().toISOString() };
  fs.appendFileSync(FILE, JSON.stringify(record) + "\n", "utf-8");
  return record;
}

export function getStagingReviewPagesFilePath(): string {
  return FILE;
}
