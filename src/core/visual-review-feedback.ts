import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { VisualReviewFeedback } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Fase O28.5 -- registro append-only del motivo real que Pau da al
 * rechazar una revision visual por Telegram ("se ve muy plano", "falta
 * imagen", "el CTA no destaca"...). Objetivo declarado por Pau: "evitar
 * repetir el mismo error en futuras paginas". Hoy es solo un registro
 * consultable -- no hay ningun agente que lo lea automaticamente
 * todavia (seria el siguiente paso natural: que UX/UI Landing Architect
 * revise este fichero antes de generar contenido nuevo).
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "visual-review-feedback.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readAllVisualReviewFeedback(): VisualReviewFeedback[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as VisualReviewFeedback);
}

export function recordVisualReviewFeedback(input: Omit<VisualReviewFeedback, "feedbackId" | "createdAt">): VisualReviewFeedback {
  ensureDataDir();
  const feedback: VisualReviewFeedback = { ...input, feedbackId: `visual-feedback-${randomUUID()}`, createdAt: new Date().toISOString() };
  fs.appendFileSync(FILE, JSON.stringify(feedback) + "\n", "utf-8");
  return feedback;
}

export function getVisualReviewFeedbackFilePath(): string {
  return FILE;
}
