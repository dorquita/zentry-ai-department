import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { TelegramProductionConfirmation } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Registro append-only (Fase O13.2b) de la SEGUNDA confirmacion
 * obligatoria para aprobar (nunca para rechazar) cualquier
 * ApprovalRequest con `riskLevel === "critical"`. Ventana corta (ver
 * PRODUCTION_CONFIRMATION_WINDOW_MINUTES en
 * src/agents/telegram-approval-receiver.ts) -- pensada para un
 * intercambio inmediato en el chat, no para dejar pendiente dias.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "telegram-production-confirmations.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(entry: TelegramProductionConfirmation): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(entry) + "\n", "utf-8");
}

export function readAllProductionConfirmationSnapshots(): TelegramProductionConfirmation[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TelegramProductionConfirmation);
}

export function readCurrentProductionConfirmations(): TelegramProductionConfirmation[] {
  const byId = new Map<string, TelegramProductionConfirmation>();
  for (const snapshot of readAllProductionConfirmationSnapshots()) {
    byId.set(snapshot.confirmationId, snapshot);
  }
  return [...byId.values()];
}

export function findActiveConfirmationForApprovalRequest(approvalRequestId: string): TelegramProductionConfirmation | undefined {
  return readCurrentProductionConfirmations().find(
    (c) => c.approvalRequestId === approvalRequestId && c.status === "awaiting_second_confirmation"
  );
}

/** Coincidencia por prefijo del shortId, entre confirmaciones activas. Devuelve TODAS las que coincidan (para poder detectar ambiguedad). */
export function findActiveConfirmationsByShortId(shortId: string): TelegramProductionConfirmation[] {
  const needle = shortId.trim().toLowerCase();
  return readCurrentProductionConfirmations().filter(
    (c) => c.status === "awaiting_second_confirmation" && c.shortId.toLowerCase().startsWith(needle)
  );
}

export function createProductionConfirmation(approvalRequestId: string, shortId: string): TelegramProductionConfirmation {
  const now = new Date().toISOString();
  const entry: TelegramProductionConfirmation = {
    confirmationId: `tg-confirm-${randomUUID()}`,
    approvalRequestId,
    shortId,
    status: "awaiting_second_confirmation",
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(entry);
  return entry;
}

export function setProductionConfirmationStatus(
  confirmationId: string,
  status: TelegramProductionConfirmation["status"]
): TelegramProductionConfirmation | undefined {
  const existing = readCurrentProductionConfirmations().find((c) => c.confirmationId === confirmationId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const updated: TelegramProductionConfirmation = { ...existing, status, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export function getTelegramProductionConfirmationsFilePath(): string {
  return FILE;
}
