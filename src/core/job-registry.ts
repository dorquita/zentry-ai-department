import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { SeoJob, SeoJobMeta, SeoOpportunity, AgentMode } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

const DATA_DIR = resolveActiveClientPaths().dataDir;
const JOBS_FILE = path.join(DATA_DIR, "jobs.jsonl");

function titleFor(opportunity: SeoOpportunity): string {
  const pos = opportunity.currentPosition.toFixed(1);
  switch (opportunity.kind) {
    case "quick_win":
    case "future_opportunity":
      return `Subir keyword "${opportunity.keyword}" de posicion ${pos} a top ${opportunity.targetPosition}`;
    case "low_ctr":
      return `Mejorar CTR de "${opportunity.keyword}" (posicion ${pos}, CTR ${(
        opportunity.evidence.ctr * 100
      ).toFixed(2)}%)`;
    case "position_drop":
      return `Recuperar posicion de "${opportunity.keyword}" (bajo de ${opportunity.evidence.previousPosition?.toFixed(
        1
      )} a ${pos})`;
  }
}

/**
 * Append-only registry: jobs are proposals, never applied automatically.
 * Nothing here ever deletes or rewrites an existing line in jobs.jsonl.
 */
export function createJob(
  opportunity: SeoOpportunity,
  mode: AgentMode,
  meta: SeoJobMeta
): SeoJob {
  const job: SeoJob = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    agent: "seo-watcher",
    mode,
    status: "proposed",
    title: titleFor(opportunity),
    meta,
    opportunity,
  };
  return job;
}

export function appendJob(job: SeoJob): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.appendFileSync(JOBS_FILE, JSON.stringify(job) + "\n", "utf-8");
}

export function getJobsFilePath(): string {
  return JOBS_FILE;
}

/**
 * Lee TODO el historico de data/jobs.jsonl (solo lectura). Cada linea es un
 * SeoJob independiente. Ignora lineas en blanco. No modifica el fichero.
 */
export function readAllJobs(): SeoJob[] {
  if (!fs.existsSync(JOBS_FILE)) return [];
  const raw = fs.readFileSync(JOBS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SeoJob);
}
