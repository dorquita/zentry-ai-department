import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  APPROVAL_REQUEST_STATUSES,
  ApprovalRelatedType,
  ApprovalRequest,
  ApprovalRequestStatus,
} from "./types";
import { AutonomyRiskLevel } from "./autonomy-policy";
import { NotificationChannel } from "./notification-policy";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Approval Request Registry (Fase O8): log append-only de instantaneas,
 * mismo patron que action-backlog.ts y work-orders.ts. Una solicitud de
 * aprobacion registra que se le pidio permiso a Pau para algo con impacto
 * real — nunca ejecuta esa accion. La ejecucion (si algun dia existe) es
 * responsabilidad de otro sistema, fuera de este registro.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const APPROVAL_REQUESTS_FILE = path.join(DATA_DIR, "approval-requests.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(request: ApprovalRequest): void {
  ensureDataDir();
  fs.appendFileSync(APPROVAL_REQUESTS_FILE, JSON.stringify(request) + "\n", "utf-8");
}

export function readAllApprovalRequestSnapshots(): ApprovalRequest[] {
  if (!fs.existsSync(APPROVAL_REQUESTS_FILE)) return [];
  const raw = fs.readFileSync(APPROVAL_REQUESTS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ApprovalRequest);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada approvalRequestId. */
export function readCurrentApprovalRequests(): ApprovalRequest[] {
  const byId = new Map<string, ApprovalRequest>();
  for (const snapshot of readAllApprovalRequestSnapshots()) {
    byId.set(snapshot.approvalRequestId, snapshot);
  }
  return [...byId.values()];
}

export function findApprovalRequestById(approvalRequestId: string): ApprovalRequest | undefined {
  return readCurrentApprovalRequests().find((r) => r.approvalRequestId === approvalRequestId);
}

/**
 * Dedup: cualquier solicitud ya creada para este relatedId (sea cual sea
 * su status actual) cuenta como "ya preguntado" — nunca se vuelve a crear
 * una segunda solicitud automaticamente para la misma accion/work order,
 * ni siquiera si la primera esta `snoozed` (eso significa "pregunta mas
 * tarde", no "vuelve a preguntar en la siguiente pasada"). Mismo criterio
 * de "las decisiones no se revierten solas" que usa el Action Backlog.
 */
export function findAnyRequestByRelatedId(relatedId: string, current: ApprovalRequest[]): ApprovalRequest | undefined {
  return current.find((r) => r.relatedId === relatedId);
}

export function getApprovalRequestsFilePath(): string {
  return APPROVAL_REQUESTS_FILE;
}

export function isValidApprovalRequestStatus(value: string): value is ApprovalRequestStatus {
  return (APPROVAL_REQUEST_STATUSES as string[]).includes(value);
}

export interface CreateApprovalRequestInput {
  relatedType: ApprovalRelatedType;
  relatedId: string;
  title: string;
  summary: string;
  riskLevel: AutonomyRiskLevel;
  requestedAction: string;
  options: string[];
  channel: NotificationChannel;
}

export interface UpsertApprovalRequestResult {
  request: ApprovalRequest;
  isNew: boolean;
}

/**
 * Crea una solicitud `pending` nueva para `relatedId` si no existe
 * todavia ninguna (dedup por relatedId, ver findAnyRequestByRelatedId), o
 * devuelve la existente sin tocarla. Debe llamarse con el snapshot ACTUAL
 * ya cargado (`current`) para deduplicar varias llamadas dentro de la
 * misma ejecucion sin releer el fichero cada vez.
 */
export function upsertApprovalRequest(
  input: CreateApprovalRequestInput,
  current: ApprovalRequest[]
): UpsertApprovalRequestResult {
  const existing = findAnyRequestByRelatedId(input.relatedId, current);
  if (existing) {
    return { request: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const request: ApprovalRequest = {
    approvalRequestId: randomUUID(),
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    title: input.title,
    summary: input.summary,
    riskLevel: input.riskLevel,
    requestedAction: input.requestedAction,
    options: input.options,
    status: "pending",
    channel: input.channel,
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(request);
  current.push(request);
  return { request, isNew: true };
}

/**
 * Marca que la solicitud se envio de verdad por un canal (hoy solo
 * Telegram). No cambia el status (sigue `pending`) — solo registra
 * `sentAt`. Si TELEGRAM_APPROVALS_ENABLED=false, esta funcion nunca se
 * llama (la solicitud se queda con `sentAt` vacio, solo visible en el
 * informe local).
 */
export function markApprovalRequestSent(approvalRequestId: string, channel: NotificationChannel): ApprovalRequest | undefined {
  const current = readCurrentApprovalRequests();
  const existing = current.find((r) => r.approvalRequestId === approvalRequestId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: ApprovalRequest = { ...existing, channel, sentAt: now, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}

export interface SetApprovalRequestStatusUpdates {
  answer?: string;
  reason?: string;
  answeredBy?: string;
}

const TERMINAL_ANSWER_STATUSES: ApprovalRequestStatus[] = ["approved", "rejected", "snoozed"];

/**
 * Cambia el status de una solicitud (usado por
 * scripts/update-approval-request.ts, o en el futuro por un listener de
 * Telegram). NUNCA ejecuta la accion/work order relacionada — eso, si se
 * quiere, es responsabilidad explicita de quien llama (ver
 * update-approval-request.ts, que cascada la decision a
 * actions:update/work-orders:update por separado).
 */
export function setApprovalRequestStatus(
  approvalRequestId: string,
  newStatus: ApprovalRequestStatus,
  updates: SetApprovalRequestStatusUpdates
): ApprovalRequest | undefined {
  const current = readCurrentApprovalRequests();
  const existing = current.find((r) => r.approvalRequestId === approvalRequestId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: ApprovalRequest = {
    ...existing,
    status: newStatus,
    answer: updates.answer ?? existing.answer,
    reason: updates.reason ?? existing.reason,
    answeredBy: updates.answeredBy ?? existing.answeredBy,
    answeredAt: TERMINAL_ANSWER_STATUSES.includes(newStatus) ? now : existing.answeredAt,
    updatedAt: now,
  };
  appendSnapshot(updated);
  return updated;
}
