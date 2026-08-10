import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { RejectReasonPrompt } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Fase O28.5 -- registro append-only (mismo patron que
 * telegram-production-confirmations.ts) de "preguntas abiertas" de motivo
 * de rechazo. Cuando Pau rechaza una revision, se crea un prompt
 * `pending` para su chat; el siguiente mensaje de texto libre que llegue
 * de ese chat se trata como la respuesta (ver telegram-approval-receiver.ts).
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const FILE = path.join(DATA_DIR, "telegram-reject-prompts.jsonl");
const PROMPT_EXPIRY_MINUTES = 30;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendSnapshot(prompt: RejectReasonPrompt): void {
  ensureDataDir();
  fs.appendFileSync(FILE, JSON.stringify(prompt) + "\n", "utf-8");
}

export function readAllRejectReasonPromptSnapshots(): RejectReasonPrompt[] {
  if (!fs.existsSync(FILE)) return [];
  const raw = fs.readFileSync(FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RejectReasonPrompt);
}

export function readCurrentRejectReasonPrompts(): RejectReasonPrompt[] {
  const byId = new Map<string, RejectReasonPrompt>();
  for (const snapshot of readAllRejectReasonPromptSnapshots()) {
    byId.set(snapshot.promptId, snapshot);
  }
  return [...byId.values()];
}

export function createRejectReasonPrompt(approvalRequestId: string, chatId: string): RejectReasonPrompt {
  const now = new Date().toISOString();
  const prompt: RejectReasonPrompt = { promptId: `reject-prompt-${randomUUID()}`, approvalRequestId, chatId, status: "pending", createdAt: now, updatedAt: now };
  appendSnapshot(prompt);
  return prompt;
}

export function isRejectReasonPromptExpired(prompt: RejectReasonPrompt, nowMs: number): boolean {
  return nowMs - new Date(prompt.createdAt).getTime() > PROMPT_EXPIRY_MINUTES * 60 * 1000;
}

/** El prompt "pending" mas reciente para este chat, o undefined si no hay ninguno activo. */
export function findActiveRejectReasonPromptForChat(chatId: string, current?: RejectReasonPrompt[]): RejectReasonPrompt | undefined {
  const all = (current ?? readCurrentRejectReasonPrompts()).filter((p) => p.chatId === chatId && p.status === "pending");
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

export function setRejectReasonPromptStatus(promptId: string, status: RejectReasonPrompt["status"]): RejectReasonPrompt | undefined {
  const current = readCurrentRejectReasonPrompts();
  const existing = current.find((p) => p.promptId === promptId);
  if (!existing) return undefined;
  const updated: RejectReasonPrompt = { ...existing, status, updatedAt: new Date().toISOString() };
  appendSnapshot(updated);
  return updated;
}
