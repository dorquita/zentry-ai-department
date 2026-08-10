import * as fs from "fs";
import * as path from "path";
import { TelegramProcessedUpdate } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Log append-only (Fase O13.2b) de cada update de Telegram procesado por
 * el receiver -- incluye los ignorados. Nunca se borra ni reescribe una
 * linea. Tambien sirve de cursor: el offset de la siguiente llamada a
 * `getUpdates` es `max(updateId) + 1` de este fichero.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "telegram-processed-updates.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function recordProcessedUpdate(entry: TelegramProcessedUpdate): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(entry) + "\n", "utf-8");
}

export function readAllProcessedUpdates(): TelegramProcessedUpdate[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TelegramProcessedUpdate);
}

/** El offset a pedir en la proxima llamada a getUpdates: 0 si nunca se proceso nada. */
export function getNextUpdateOffset(): number {
  const all = readAllProcessedUpdates();
  if (all.length === 0) return 0;
  const maxId = all.reduce((max, u) => Math.max(max, u.updateId), 0);
  return maxId + 1;
}

export function isUpdateAlreadyProcessed(updateId: number): boolean {
  return readAllProcessedUpdates().some((u) => u.updateId === updateId);
}

export function getTelegramProcessedUpdatesFilePath(): string {
  return FILE;
}
