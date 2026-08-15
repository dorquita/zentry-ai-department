import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "../../core/client-paths";
import { DEPARTMENT_CHANGE_CONTRACT_VERSION, DepartmentChangeRequest } from "./change-types";
import { checkTransition, DepartmentChangeStatus, isDepartmentChangeStatus } from "./state-machine";

/**
 * REGISTRO PERSISTENTE de los cambios del departamento.
 *
 * Log append-only de instantaneas en el `data/` del cliente activo,
 * exactamente el mismo patron (y el mismo directorio) que
 * approval-requests.jsonl, staging-executions.jsonl y el resto de
 * registros del proyecto: NO se inventa un almacen nuevo ni una base de
 * datos paralela.
 *
 * Por que aqui y no en el directorio de la pasada
 * (`reports/department/<runId>/`): el estado de una aprobacion NO puede
 * depender del filesystem efimero del runner de GitHub Actions. El runner
 * genera el trabajo; el registro de aprobaciones vive donde el proyecto
 * es persistente (el VPS, junto al servicio permanente de Telegram, ver
 * deploy/zentry-telegram-approvals.service). Una aprobacion tiene que
 * sobrevivir a un reinicio del VPS, al cierre de Claude, al final del
 * workflow y al reinicio del bot.
 *
 * El estado ACTUAL de un cambio es su instantanea mas reciente. Nunca se
 * borra ni se reescribe una linea existente.
 *
 * `filePath` es inyectable SOLO para poder testear el registro sin tocar
 * los datos reales del proyecto; en produccion siempre se usa el fichero
 * del cliente activo.
 */

const FILE_NAME = "department-changes.jsonl";

export function getDepartmentChangesFilePath(): string {
  return path.join(resolveActiveClientPaths().dataDir, FILE_NAME);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readAllChangeSnapshots(filePath: string = getDepartmentChangesFilePath()): DepartmentChangeRequest[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const snapshots: DepartmentChangeRequest[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const parsed = JSON.parse(line) as DepartmentChangeRequest;
    if (parsed.contractVersion !== DEPARTMENT_CHANGE_CONTRACT_VERSION) {
      throw new Error(
        `${FILE_NAME}: instantanea con contractVersion "${String(parsed.contractVersion)}" no soportada (se esperaba "${DEPARTMENT_CHANGE_CONTRACT_VERSION}"). Fail-closed: no se interpreta a medias un registro de aprobaciones.`
      );
    }
    if (!isDepartmentChangeStatus(parsed.status)) {
      throw new Error(`${FILE_NAME}: instantanea del cambio "${String(parsed.changeId)}" con status desconocido "${String(parsed.status)}". Fail-closed.`);
    }
    snapshots.push(parsed);
  }
  return snapshots;
}

/** Reduce el log al estado ACTUAL: la instantanea mas reciente de cada changeId. */
export function readCurrentChanges(filePath: string = getDepartmentChangesFilePath()): DepartmentChangeRequest[] {
  const byId = new Map<string, DepartmentChangeRequest>();
  for (const snapshot of readAllChangeSnapshots(filePath)) byId.set(snapshot.changeId, snapshot);
  return [...byId.values()];
}

export function findChangeById(changeId: string, filePath: string = getDepartmentChangesFilePath()): DepartmentChangeRequest | undefined {
  return readCurrentChanges(filePath).find((c) => c.changeId === changeId);
}

/** El cambio asociado a una solicitud de aprobacion del registro comun de Telegram. */
export function findChangeByTelegramApprovalId(
  telegramApprovalId: string,
  filePath: string = getDepartmentChangesFilePath()
): DepartmentChangeRequest | undefined {
  return readCurrentChanges(filePath).find((c) => c.telegram?.telegramApprovalId === telegramApprovalId);
}

/** Todas las versiones registradas de UNA recomendacion, de la mas antigua a la mas nueva. */
export function findChangesByRecommendationId(recommendationId: string, filePath: string = getDepartmentChangesFilePath()): DepartmentChangeRequest[] {
  return readCurrentChanges(filePath)
    .filter((c) => c.recommendationId === recommendationId)
    .sort((a, b) => a.version - b.version);
}

export function findChangesByRunId(departmentRunId: string, filePath: string = getDepartmentChangesFilePath()): DepartmentChangeRequest[] {
  return readCurrentChanges(filePath)
    .filter((c) => c.departmentRunId === departmentRunId)
    .sort((a, b) => a.recommendationRank - b.recommendationRank || a.version - b.version);
}

/** Escribe una instantanea nueva. No valida transiciones: eso es `transitionChange()`. */
export function appendChangeSnapshot(change: DepartmentChangeRequest, filePath: string = getDepartmentChangesFilePath()): DepartmentChangeRequest {
  if (change.contractVersion !== DEPARTMENT_CHANGE_CONTRACT_VERSION) {
    throw new Error(`appendChangeSnapshot: contractVersion "${change.contractVersion}" no soportada. Fail-closed.`);
  }
  ensureDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(change) + "\n", "utf-8");
  return change;
}

export interface TransitionResult {
  ok: boolean;
  /** El cambio ya persistido (si `ok`) o el cambio SIN tocar (si no). */
  change: DepartmentChangeRequest;
  reason: string;
}

/**
 * Aplica una transicion de estado COMPROBANDOLA contra la maquina de
 * estados y, solo si es valida, persiste la instantanea nueva.
 *
 * Fail-closed en los dos sentidos: una transicion no permitida no se
 * escribe (el registro nunca acaba en un estado imposible), y una
 * transicion permitida no se da por hecha hasta que el fichero se ha
 * escrito de verdad.
 */
export function transitionChange(
  change: DepartmentChangeRequest,
  nextStatus: DepartmentChangeStatus,
  updates: Partial<Omit<DepartmentChangeRequest, "changeId" | "contractVersion" | "status">>,
  audit: { event: string; detail: string },
  options: { now?: Date; filePath?: string } = {}
): TransitionResult {
  const now = options.now ?? new Date();
  const filePath = options.filePath ?? getDepartmentChangesFilePath();
  const check = checkTransition(change.status, nextStatus);
  if (!check.allowed) {
    return { ok: false, change, reason: check.reason };
  }

  const updated: DepartmentChangeRequest = {
    ...change,
    ...updates,
    status: nextStatus,
    auditTrail: [...change.auditTrail, { at: now.toISOString(), event: audit.event, detail: audit.detail }],
    updatedAt: now.toISOString(),
  };
  appendChangeSnapshot(updated, filePath);
  return { ok: true, change: updated, reason: check.reason };
}

/**
 * Guarda cambios en el registro SIN mover el estado (por ejemplo:
 * anotar el message_id que devolvio Telegram). Existe como funcion
 * aparte para que ninguna escritura "de paso" pueda cambiar un status
 * saltandose la maquina de estados.
 */
export function updateChangeWithoutTransition(
  change: DepartmentChangeRequest,
  updates: Partial<Omit<DepartmentChangeRequest, "changeId" | "contractVersion" | "status">>,
  audit: { event: string; detail: string },
  options: { now?: Date; filePath?: string } = {}
): DepartmentChangeRequest {
  const now = options.now ?? new Date();
  const updated: DepartmentChangeRequest = {
    ...change,
    ...updates,
    status: change.status,
    auditTrail: [...change.auditTrail, { at: now.toISOString(), event: audit.event, detail: audit.detail }],
    updatedAt: now.toISOString(),
  };
  appendChangeSnapshot(updated, options.filePath ?? getDepartmentChangesFilePath());
  return updated;
}

/**
 * Siguiente numero de version para una recomendacion: 1 si nunca hubo
 * ninguna, o la mayor + 1. Asi una propuesta posterior a un rechazo
 * NUNCA reutiliza el changeId (ni por tanto la aprobacion) de la
 * version anterior.
 */
export function nextVersionForRecommendation(recommendationId: string, filePath: string = getDepartmentChangesFilePath()): number {
  const existing = findChangesByRecommendationId(recommendationId, filePath);
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((c) => c.version)) + 1;
}

/**
 * Feedback humano acumulado de las versiones ANTERIORES de una
 * recomendacion -- lo que hay que darle a los agentes en la siguiente
 * pasada para que entiendan que se rechazo y POR QUE.
 */
export function collectFeedbackForRecommendation(recommendationId: string, filePath: string = getDepartmentChangesFilePath()): string[] {
  const feedback: string[] = [];
  for (const change of findChangesByRecommendationId(recommendationId, filePath)) {
    const reason = change.humanDecision?.rejectionReason?.trim();
    if (change.humanDecision?.decision === "rejected" && reason) {
      feedback.push(`v${change.version} (${change.humanDecision.decidedAt}): ${reason}`);
    }
  }
  return feedback;
}
