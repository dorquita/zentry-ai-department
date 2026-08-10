import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { LandingBlueprint } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Landing Blueprint Registry (Fase O13.6b): log append-only de
 * instantaneas, mismo patron que change-packs.ts/asset-requests.ts. Es
 * la estructura visual REAL de una landing (hero/CTAs/beneficios/cards/
 * secciones/FAQ/CTA final/enlaces/jerarquia), generada por
 * src/agents/ux-ui-landing-architect.ts ANTES de que WordPress Draft
 * Agent escriba nada. Dedup por changePackId -- un mismo change pack
 * nunca tiene dos blueprints activos.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "landing-blueprints.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(blueprint: LandingBlueprint): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(blueprint) + "\n", "utf-8");
}

export function readAllLandingBlueprintSnapshots(): LandingBlueprint[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LandingBlueprint);
}

export function readCurrentLandingBlueprints(): LandingBlueprint[] {
  const byId = new Map<string, LandingBlueprint>();
  for (const snapshot of readAllLandingBlueprintSnapshots()) {
    byId.set(snapshot.blueprintId, snapshot);
  }
  return [...byId.values()];
}

export function findLandingBlueprintByChangePackId(changePackId: string, current: LandingBlueprint[]): LandingBlueprint | undefined {
  return current.find((b) => b.changePackId === changePackId);
}

export function getLandingBlueprintsFilePath(): string {
  return FILE;
}

export type CreateLandingBlueprintInput = Omit<LandingBlueprint, "blueprintId" | "createdAt" | "updatedAt">;

export interface UpsertLandingBlueprintResult {
  blueprint: LandingBlueprint;
  isNew: boolean;
}

/**
 * Corrige el CONTENIDO de un blueprint ya existente (Fase O13.6c: fix de
 * un bug real donde varias secciones quedaban con el mismo texto
 * duplicado). Nueva instantanea append-only con el MISMO blueprintId
 * (mismo patron que setDeploymentPlanStatus/setProductionExecutionStatus
 * -- nunca se borra ni reescribe una linea existente, solo se anade una
 * version mas reciente).
 */
export function replaceLandingBlueprintContent(
  blueprintId: string,
  updates: Omit<CreateLandingBlueprintInput, "changePackId">
): LandingBlueprint | undefined {
  const current = readCurrentLandingBlueprints();
  const existing = current.find((b) => b.blueprintId === blueprintId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: LandingBlueprint = { ...existing, ...updates, changePackId: existing.changePackId, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export function upsertLandingBlueprint(input: CreateLandingBlueprintInput, current: LandingBlueprint[]): UpsertLandingBlueprintResult {
  const existing = findLandingBlueprintByChangePackId(input.changePackId, current);
  if (existing) {
    return { blueprint: existing, isNew: false };
  }
  const now = new Date().toISOString();
  const blueprint: LandingBlueprint = {
    blueprintId: `landing-bp-${randomUUID()}`,
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(blueprint);
  current.push(blueprint);
  return { blueprint, isNew: true };
}
