import * as crypto from "crypto";
import { ClaudeRuntimeFailureClassification, ClaudeRuntimeFailureKind } from "./claude-runtime-failure-taxonomy";

/**
 * Diagnostico por invocacion del runtime comun de empleados Claude
 * ("watchdog"): que paso exactamente en cada intento, en que capa, y si
 * se recupero.
 *
 * Alimenta la seccion SALUD DEL DEPARTAMENTO. No es una propuesta de
 * negocio ni contiene analisis de dominio: solo hechos observables de
 * la ejecucion.
 *
 * PRIVACIDAD/SEGURIDAD: nunca guarda el prompt, la respuesta del
 * modelo, ni ningun secreto. Del prompt y del schema guarda solo TAMANO
 * y HASH, que es lo unico que hace falta para correlacionar
 * invocaciones entre si ("mismo input?") sin exponer contenido.
 */

export const CLAUDE_RUNTIME_HEALTH_SCHEMA_VERSION = "1";

/** Hash corto y estable de un contenido -- para correlacionar sin exponer el contenido. */
export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16);
}

export type ClaudeEmployeeOutputSourceOrNone = "structured_output" | "execution_file_fallback" | "none";

/** Forensica de UN intento concreto. Un intento = una invocacion real de claude-code-action. */
export interface ClaudeRuntimeAttemptRecord {
  attempt: number;
  /** "success" | "failure" -- outcome REAL del step, sin enmascarar por continue-on-error. */
  claudeOutcome: string;
  structuredOutputPresent: boolean;
  executionFileOutputPresent: boolean;
  executionFilePath: string | null;
  executionFileExists: boolean;
  executionFileBytes: number | null;
  executionFileStale: boolean;
  /** Recuento de mensajes SDK por tipo, p.ej. {"system":1,"assistant":2,"result":1}. */
  sdkMessageTypes: Record<string, number> | null;
  sdkMessageCount: number | null;
  lastMessageType: string | null;
  finalSubtype: string | null;
  isError: boolean | null;
  resultPresent: boolean;
  resultLength: number | null;
  numTurns: number | null;
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
  /** Resultado de ESTE intento tras aplicar parse + schema. */
  resolved: boolean;
  outputSource: ClaudeEmployeeOutputSourceOrNone;
  failureKind: ClaudeRuntimeFailureKind | null;
  retriable: boolean | null;
  failureReason: string | null;
  failureEvidence: string | null;
}

export interface ClaudeRuntimeHealthRecord {
  schemaVersion: string;
  employee: string;
  departmentRunId: string | null;
  /** Correlacion de "mismo input" sin exponer el input. */
  promptBytes: number | null;
  promptHash: string | null;
  schemaBytes: number | null;
  schemaHash: string | null;
  authMethod: string;
  maxTurns: number | null;
  attemptCount: number;
  attempts: ClaudeRuntimeAttemptRecord[];
  /** Outcome del ULTIMO intento realizado. */
  actionResult: string;
  /** Clase de fallo FINAL (null si la invocacion acabo aceptada). */
  failureKind: ClaudeRuntimeFailureKind | null;
  retried: boolean;
  /** true solo si hubo reintento Y el reintento salvo la invocacion. */
  recovered: boolean;
  outputSource: ClaudeEmployeeOutputSourceOrNone;
  validationStatus: "accepted" | "rejected";
  /** Suma de la duracion medida de todos los intentos. */
  durationMs: number | null;
  /** Suma del coste estimado de todos los intentos (estimacion a tarifa de lista, no una factura). */
  totalCostUsd: number | null;
  model: string | null;
}

/** Subconjunto minimo de un mensaje SDK que este modulo necesita leer. */
interface SdkMessageLike {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  num_turns?: unknown;
  duration_ms?: unknown;
  total_cost_usd?: unknown;
  model?: unknown;
}

export interface ExecutionFileForensics {
  sdkMessageTypes: Record<string, number> | null;
  sdkMessageCount: number | null;
  lastMessageType: string | null;
  finalSubtype: string | null;
  isError: boolean | null;
  resultPresent: boolean;
  resultLength: number | null;
  numTurns: number | null;
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
}

const EMPTY_FORENSICS: ExecutionFileForensics = {
  sdkMessageTypes: null,
  sdkMessageCount: null,
  lastMessageType: null,
  finalSubtype: null,
  isError: null,
  resultPresent: false,
  resultLength: null,
  numTurns: null,
  model: null,
  durationMs: null,
  costUsd: null,
};

/**
 * Extrae la forensica de un execution_file. Tolerante a proposito: un
 * fichero truncado o corrupto devuelve lo que se pueda leer (o todo a
 * null) en vez de lanzar -- perder el diagnostico nunca puede ser el
 * motivo de que falle una pasada. La DECISION sobre si la salida es
 * valida no se toma aqui.
 */
export function extractExecutionFileForensics(content: string | undefined): ExecutionFileForensics {
  if (!content || content.trim().length === 0) return { ...EMPTY_FORENSICS };

  let messages: unknown;
  try {
    messages = JSON.parse(content);
  } catch {
    return { ...EMPTY_FORENSICS };
  }
  if (!Array.isArray(messages)) return { ...EMPTY_FORENSICS };

  const types: Record<string, number> = {};
  for (const message of messages) {
    const type = typeof message === "object" && message !== null && typeof (message as SdkMessageLike).type === "string" ? ((message as SdkMessageLike).type as string) : "(desconocido)";
    types[type] = (types[type] ?? 0) + 1;
  }

  const last = messages[messages.length - 1] as SdkMessageLike | undefined;
  const resultMessages = messages.filter((m): m is SdkMessageLike => typeof m === "object" && m !== null && (m as SdkMessageLike).type === "result");
  const finalResult = resultMessages[resultMessages.length - 1];
  const initMessage = messages.find((m): m is SdkMessageLike => typeof m === "object" && m !== null && (m as SdkMessageLike).type === "system" && (m as SdkMessageLike).subtype === "init");

  const resultText = typeof finalResult?.result === "string" ? (finalResult.result as string) : undefined;

  return {
    sdkMessageTypes: types,
    sdkMessageCount: messages.length,
    lastMessageType: typeof last?.type === "string" ? (last.type as string) : null,
    finalSubtype: typeof finalResult?.subtype === "string" ? (finalResult.subtype as string) : null,
    isError: typeof finalResult?.is_error === "boolean" ? (finalResult.is_error as boolean) : null,
    resultPresent: typeof resultText === "string" && resultText.length > 0,
    resultLength: typeof resultText === "string" ? resultText.length : null,
    numTurns: typeof finalResult?.num_turns === "number" ? (finalResult.num_turns as number) : null,
    model: typeof initMessage?.model === "string" ? (initMessage.model as string) : null,
    durationMs: typeof finalResult?.duration_ms === "number" ? (finalResult.duration_ms as number) : null,
    costUsd: typeof finalResult?.total_cost_usd === "number" ? (finalResult.total_cost_usd as number) : null,
  };
}

export interface BuildAttemptRecordParams {
  attempt: number;
  claudeOutcome: string | undefined;
  structuredOutput: string | undefined;
  executionFilePath: string | undefined;
  executionFileExists: boolean;
  executionFileBytes: number | undefined;
  executionFileStale: boolean;
  executionFileContent: string | undefined;
  resolved: boolean;
  outputSource: ClaudeEmployeeOutputSourceOrNone;
  classification: ClaudeRuntimeFailureClassification | null;
}

export function buildAttemptRecord(params: BuildAttemptRecordParams): ClaudeRuntimeAttemptRecord {
  const forensics = extractExecutionFileForensics(params.executionFileContent);
  return {
    attempt: params.attempt,
    claudeOutcome: params.claudeOutcome ?? "(desconocido)",
    structuredOutputPresent: typeof params.structuredOutput === "string" && params.structuredOutput.trim().length > 0,
    executionFileOutputPresent: typeof params.executionFilePath === "string" && params.executionFilePath.trim().length > 0,
    executionFilePath: params.executionFilePath && params.executionFilePath.trim().length > 0 ? params.executionFilePath : null,
    executionFileExists: params.executionFileExists,
    executionFileBytes: params.executionFileBytes ?? null,
    executionFileStale: params.executionFileStale,
    ...forensics,
    resolved: params.resolved,
    outputSource: params.outputSource,
    failureKind: params.classification?.failureKind ?? null,
    retriable: params.classification?.retriable ?? null,
    failureReason: params.classification?.reason ?? null,
    failureEvidence: params.classification?.evidence ?? null,
  };
}

export interface BuildHealthRecordParams {
  employee: string;
  departmentRunId?: string;
  promptBytes?: number;
  promptHash?: string;
  schemaBytes?: number;
  schemaHash?: string;
  authMethod: string;
  maxTurns?: number;
  attempts: ClaudeRuntimeAttemptRecord[];
}

/**
 * Compone el registro final a partir de los intentos ya capturados.
 *
 * `recovered` es deliberadamente estricto: solo es `true` si hubo mas
 * de un intento Y el ultimo salio aceptado. Un exito al primer intento
 * NO cuenta como "recuperado" -- si lo contara, la metrica de
 * recuperaciones dejaria de medir nada util.
 */
export function buildClaudeRuntimeHealthRecord(params: BuildHealthRecordParams): ClaudeRuntimeHealthRecord {
  const attempts = params.attempts;
  const last = attempts[attempts.length - 1];
  const accepted = attempts.find((attempt) => attempt.resolved);

  const measured = attempts.filter((attempt) => attempt.durationMs !== null || attempt.costUsd !== null);
  const durationMs = measured.length > 0 ? measured.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0) : null;
  const totalCostUsd = measured.length > 0 ? measured.reduce((sum, attempt) => sum + (attempt.costUsd ?? 0), 0) : null;

  return {
    schemaVersion: CLAUDE_RUNTIME_HEALTH_SCHEMA_VERSION,
    employee: params.employee,
    departmentRunId: params.departmentRunId && params.departmentRunId.length > 0 ? params.departmentRunId : null,
    promptBytes: params.promptBytes ?? null,
    promptHash: params.promptHash ?? null,
    schemaBytes: params.schemaBytes ?? null,
    schemaHash: params.schemaHash ?? null,
    authMethod: params.authMethod,
    maxTurns: params.maxTurns ?? null,
    attemptCount: attempts.length,
    attempts,
    actionResult: last?.claudeOutcome ?? "(sin intentos)",
    failureKind: accepted ? null : (last?.failureKind ?? "unknown_runtime_failure"),
    retried: attempts.length > 1,
    recovered: attempts.length > 1 && Boolean(accepted) && accepted!.attempt > 1,
    outputSource: accepted?.outputSource ?? "none",
    validationStatus: accepted ? "accepted" : "rejected",
    durationMs,
    totalCostUsd,
    model: attempts.map((attempt) => attempt.model).find((model): model is string => typeof model === "string") ?? null,
  };
}
