import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Registro persistente de resultados de Staging QA (Fase O27). Hasta
 * ahora, Staging QA Agent (src/agents/staging-qa-agent.ts) recalculaba el
 * resultado en cada pasada y solo lo dejaba en el informe markdown del
 * dia (`reports/.../staging-qa-<fecha>.md``) — no habia ningun registro
 * duradero, asi que no era posible saber si UNA pagina concreta ya paso
 * QA en una pasada anterior sin volver a leer el markdown de ese dia a
 * mano. Esto hacia imposible derivar un estado real `qa_passed`/
 * `qa_failed` por oportunidad (ver src/core/opportunity-state.ts).
 *
 * Mismo patron append-only que action-backlog.jsonl / change-packs.jsonl
 * / staging-executions.jsonl: cada linea es una instantanea, nunca se
 * borra ni se reescribe una existente. El estado ACTUAL de una ejecucion
 * es su instantanea mas reciente (por executionId).
 */

export interface StagingQaResultSnapshot {
  executionId: string;
  keyword: string;
  changeType: string;
  wordpressPageId?: number;
  overallPass: boolean;
  hasWarnings: boolean;
  failures: string[];
  warnings: string[];
  checkedAt: string;
}

const DATA_DIR = resolveActiveClientPaths().dataDir;
const RESULTS_FILE = path.join(DATA_DIR, "staging-qa-results.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readAllStagingQaResultSnapshots(): StagingQaResultSnapshot[] {
  if (!fs.existsSync(RESULTS_FILE)) return [];
  const raw = fs.readFileSync(RESULTS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StagingQaResultSnapshot);
}

/** La instantanea mas reciente de CADA executionId (mismo criterio que readCurrentActions()). */
export function readCurrentStagingQaResults(): StagingQaResultSnapshot[] {
  const byId = new Map<string, StagingQaResultSnapshot>();
  for (const snapshot of readAllStagingQaResultSnapshots()) {
    byId.set(snapshot.executionId, snapshot);
  }
  return [...byId.values()];
}

export function findLatestStagingQaResult(executionId: string, current?: StagingQaResultSnapshot[]): StagingQaResultSnapshot | undefined {
  return (current ?? readCurrentStagingQaResults()).find((r) => r.executionId === executionId);
}

export function recordStagingQaResult(input: Omit<StagingQaResultSnapshot, "checkedAt">): StagingQaResultSnapshot {
  ensureDataDir();
  const snapshot: StagingQaResultSnapshot = { ...input, checkedAt: new Date().toISOString() };
  fs.appendFileSync(RESULTS_FILE, JSON.stringify(snapshot) + "\n", "utf-8");
  return snapshot;
}

export function getStagingQaResultsFilePath(): string {
  return RESULTS_FILE;
}
