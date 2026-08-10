import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Fase O27.3 -- registro persistente de si un borrador de staging apunta
 * a una URL/tema que YA existe en producción (`update_existing_page`) o
 * es genuinamente nuevo (`new_page_candidate`). Nacio del caso concreto
 * que Pau senalo (/taquillas-para-colegios/, pagina 127 de producción,
 * con DOS borradores de staging -- 2093 y 2098 -- proponiendo contenido
 * competidor en vez de una actualizacion de la pagina real), pero el
 * mismo problema aparecia en mas casos de los que el propio sistema
 * habia detectado (ver scripts/o273-audit-duplicate-urls.ts).
 *
 * Mismo patron append-only que staging-qa-results.jsonl / visual-qa.ts
 * -- una linea = una instantanea, la mas reciente por wordpressPageId
 * (staging) gana.
 */

export type ExistingPageMatchType = "update_existing_page" | "new_page_candidate";

export interface ExistingPageAuditSnapshot {
  wordpressPageId: number;
  keyword: string;
  matchType: ExistingPageMatchType;
  productionPageId?: number;
  productionUrl?: string;
  confidence: "exact" | "topical_review";
  notes?: string;
  checkedAt: string;
}

const DATA_DIR = resolveActiveClientPaths().dataDir;
const AUDIT_FILE = path.join(DATA_DIR, "existing-page-audit.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readAllExistingPageAuditSnapshots(): ExistingPageAuditSnapshot[] {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const raw = fs.readFileSync(AUDIT_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ExistingPageAuditSnapshot);
}

export function readCurrentExistingPageAudits(): ExistingPageAuditSnapshot[] {
  const byId = new Map<number, ExistingPageAuditSnapshot>();
  for (const snapshot of readAllExistingPageAuditSnapshots()) {
    byId.set(snapshot.wordpressPageId, snapshot);
  }
  return [...byId.values()];
}

export function findExistingPageAudit(wordpressPageId: number, current?: ExistingPageAuditSnapshot[]): ExistingPageAuditSnapshot | undefined {
  return (current ?? readCurrentExistingPageAudits()).find((a) => a.wordpressPageId === wordpressPageId);
}

export function recordExistingPageAudit(input: Omit<ExistingPageAuditSnapshot, "checkedAt">): ExistingPageAuditSnapshot {
  ensureDataDir();
  const snapshot: ExistingPageAuditSnapshot = { ...input, checkedAt: new Date().toISOString() };
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(snapshot) + "\n", "utf-8");
  return snapshot;
}

export function getExistingPageAuditFilePath(): string {
  return AUDIT_FILE;
}
