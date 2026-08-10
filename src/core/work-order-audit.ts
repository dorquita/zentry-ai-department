import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { WorkOrderAuditEntry, WorkOrderStatus } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Log de auditoria append-only: un registro por cada cambio de estado de
 * una work order. Nunca se borra ni se reescribe una linea.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const AUDIT_FILE = path.join(DATA_DIR, "work-order-audit.jsonl");

export interface RecordWorkOrderStatusChangeInput {
  workOrderId: string;
  previousStatus: WorkOrderStatus;
  newStatus: WorkOrderStatus;
  reason?: string;
  changedBy: string;
}

export function recordWorkOrderStatusChange(input: RecordWorkOrderStatusChangeInput): WorkOrderAuditEntry {
  const entry: WorkOrderAuditEntry = {
    auditId: randomUUID(),
    workOrderId: input.workOrderId,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    reason: input.reason,
    changedBy: input.changedBy,
    changedAt: new Date().toISOString(),
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n", "utf-8");
  return entry;
}

export function readWorkOrderAuditLog(): WorkOrderAuditEntry[] {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const raw = fs.readFileSync(AUDIT_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as WorkOrderAuditEntry);
}

export function getWorkOrderAuditFilePath(): string {
  return AUDIT_FILE;
}
