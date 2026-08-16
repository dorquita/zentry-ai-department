import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "../../core/client-paths";
import { PreviousHumanFeedback, selectPreviousHumanFeedbackByRecommendation } from "../human-feedback-context";
import { HumanFeedbackEntry } from "../store";

/**
 * REGISTRO PERSISTENTE de las decisiones humanas dadas por prompt.
 *
 * Log append-only en el `data/` del cliente activo, mismo patron que el
 * resto de registros del proyecto (`approval-requests.jsonl`,
 * `staging-executions.jsonl`...). Se versiona con el repositorio, que es
 * justo lo que hace que la pasada del dia siguiente -- que corre en un
 * runner limpio de GitHub Actions -- pueda leer los rechazos de ayer.
 *
 * Esto es lo que sostiene el bucle de feedback: un rechazo no es solo un
 * "no", es un texto que la persona escribio y que las siguientes
 * propuestas tienen que poder leer LITERAL.
 *
 * Nunca se borra ni se reescribe una linea.
 */

const FILE_NAME = "department-human-decisions.jsonl";

export type RecordedAction = "approve" | "reject" | "defer";

export interface HumanDecisionRecord {
  decisionId: string;
  departmentRunId: string;
  /** Numero visible que tenia la propuesta en el Daily Brief de esa pasada. */
  proposalNumber: number;
  recommendationId: string;
  /** Id del cambio si llego a existir; si no, `null`. */
  changeId: string | null;
  recommendationTitle: string;
  action: RecordedAction;
  /** Motivo LITERAL del rechazo, tal cual lo escribio la persona. Vacio si no es un rechazo. */
  rejectionReason: string;
  /** Modificaciones que la persona pidio antes de aplicar. */
  overrides: { title?: string; metaDescription?: string };
  /** "staging" | "production". Solo tiene sentido en una aprobacion. */
  target: string;
  decidedBy: string;
  decidedAt: string;
  /** Que paso al ejecutar. `null` = no se ejecuto (rechazo, pendiente, o bloqueada). */
  executionStatus: string | null;
  executionDetail: string;
}

export function getHumanDecisionsFilePath(dataDir?: string): string {
  return path.join(dataDir ?? resolveActiveClientPaths().dataDir, FILE_NAME);
}

export function readHumanDecisions(filePath: string = getHumanDecisionsFilePath()): HumanDecisionRecord[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HumanDecisionRecord);
}

export function appendHumanDecision(record: HumanDecisionRecord, filePath: string = getHumanDecisionsFilePath()): HumanDecisionRecord {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
  return record;
}

/** Id determinista: una misma decision sobre una misma propuesta no se duplica al reintentar. */
export function buildDecisionId(departmentRunId: string, recommendationId: string, at: string): string {
  return `${departmentRunId}#decision-${recommendationId.split("#").pop() ?? recommendationId}-${at}`;
}

/**
 * Feedback humano de una recomendacion, en el formato que ya consume
 * `human-feedback-context.ts`. Solo los rechazos CON motivo: un rechazo
 * sin texto no aporta nada a la siguiente propuesta.
 *
 * `version` se deriva del orden cronologico de los rechazos de esa
 * recomendacion (1 = el primero), que es lo que la persona entiende por
 * "la version anterior" aunque el sistema no llegara a crear un cambio.
 */
export function listHumanFeedbackFor(recommendationId: string, filePath: string = getHumanDecisionsFilePath()): HumanFeedbackEntry[] {
  const rejections = readHumanDecisions(filePath)
    .filter((r) => r.recommendationId === recommendationId && r.action === "reject" && r.rejectionReason.trim().length > 0)
    .sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : 1));

  return rejections.map((record, index) => ({
    approvalId: record.changeId ?? record.recommendationId,
    recommendationId: record.recommendationId,
    recommendationTitle: record.recommendationTitle,
    version: index + 1,
    rejectionReason: record.rejectionReason,
    rejectedAt: record.decidedAt,
  }));
}

/**
 * Feedback humano YA SELECCIONADO y listo para inyectar en el prompt de
 * un empleado. Es el unico punto de este flujo que hace I/O: la seleccion
 * y el render siguen siendo puros (`human-feedback-context.ts`).
 *
 * Esto es lo que cierra el bucle: un rechazo con motivo que se registro
 * hoy llega manana al prompt de Content / Web Engineer / Growth, LITERAL
 * y sin reinterpretar. Sin esta funcion el motivo se guardaba pero no lo
 * leia nadie.
 */
export function loadPreviousHumanFeedback(filePath: string = getHumanDecisionsFilePath()): PreviousHumanFeedback[] {
  return selectPreviousHumanFeedbackByRecommendation(listAllHumanFeedback(filePath));
}

/** Todo el feedback humano registrado, para construir el contexto de una pasada nueva. */
export function listAllHumanFeedback(filePath: string = getHumanDecisionsFilePath()): HumanFeedbackEntry[] {
  const byRecommendation = new Map<string, HumanFeedbackEntry[]>();
  for (const record of readHumanDecisions(filePath)) {
    if (record.action !== "reject" || record.rejectionReason.trim().length === 0) continue;
    const existing = byRecommendation.get(record.recommendationId) ?? [];
    existing.push({
      approvalId: record.changeId ?? record.recommendationId,
      recommendationId: record.recommendationId,
      recommendationTitle: record.recommendationTitle,
      version: existing.length + 1,
      rejectionReason: record.rejectionReason,
      rejectedAt: record.decidedAt,
    });
    byRecommendation.set(record.recommendationId, existing);
  }
  return [...byRecommendation.values()].flat();
}
