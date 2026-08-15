/**
 * Registro de UNA invocacion concreta de Claude hecha por el runtime
 * comun (.github/actions/claude-employee-runtime/action.yml).
 *
 * Motivo de existir: `claude-code-action` deja su `execution_file` en una
 * ruta del runner que NO es unica por invocacion. En un workflow con UNA
 * SOLA invocacion (los workflows de un unico empleado) eso da igual; en
 * la pasada COORDINADA del departamento, donde seis empleados se invocan
 * dentro del mismo job, la ultima invocacion pisaba a las anteriores y
 * era imposible reportar coste/turnos/duracion POR EMPLEADO.
 *
 * Este modulo NO invoca nada ni lee ficheros: solo PARSEA el contenido de
 * un execution_file y extrae las metricas que se pueden reportar sin
 * inventar nada. Todo campo que no venga en el fichero queda `null`
 * (nunca 0, nunca "desconocido" convertido en un numero) -- un coste
 * ausente debe poder distinguirse de un coste que fue realmente cero.
 *
 * Deliberadamente NO se guarda el contenido de la conversacion: el
 * registro que se persiste son solo metricas + estado, no el prompt ni la
 * respuesta (que ya viajan, cuando procede, por las rutas deterministas
 * del propio empleado).
 */

/** Origen de la salida, tal como lo reporta el runtime comun. */
export type ClaudeExecutionOutputSource = "structured_output" | "execution_file_fallback" | "unknown";

export type ClaudeExecutionOutcome = "success" | "error" | "unknown";

export const CLAUDE_EXECUTION_RECORD_CONTRACT_VERSION = "claude-execution-record/v1";

export interface ClaudeEmployeeExecutionRecord {
  contractVersion: string;
  /** Nombre del empleado (`--agent`) al que pertenece ESTA invocacion. */
  employee: string;
  /** Modelo real reportado por el SDK en esta sesion. `null` si el fichero no lo dice. */
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
  numTurns: number | null;
  outputSource: ClaudeExecutionOutputSource;
  outcome: ClaudeExecutionOutcome;
  /** Motivo cuando no se pudo extraer nada (fichero ausente, no parseable, sin mensaje final). */
  note: string;
  recordedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Busca el modelo real de la sesion. El SDK lo publica en el mensaje
 * `system`/`init` y tambien en cada mensaje `assistant`
 * (`message.model`): se acepta el primero que aparezca, sin inventar un
 * valor por defecto si no aparece ninguno.
 */
export function extractModelFromExecutionMessages(messages: unknown[]): string | null {
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const direct = stringOrNull(message.model);
    if (direct) return direct;
    const inner = message.message;
    if (isRecord(inner)) {
      const nested = stringOrNull(inner.model);
      if (nested) return nested;
    }
  }
  return null;
}

export interface BuildExecutionRecordInput {
  employee: string;
  /** Contenido crudo del execution_file. `undefined`/vacio = no hubo fichero. */
  executionFileContent?: string;
  /** Valor del output `output-source` de la composite action, si se conoce. */
  outputSource?: string;
  /** Valor del output `claude-outcome` de la composite action, si se conoce. */
  claudeOutcome?: string;
  now?: Date;
}

function normalizeOutputSource(raw: string | undefined): ClaudeExecutionOutputSource {
  if (raw === "structured_output" || raw === "execution_file_fallback") return raw;
  return "unknown";
}

/**
 * Construye el registro de UNA invocacion. Nunca lanza: un execution_file
 * ausente o roto produce un registro con metricas `null` y una `note`
 * explicita -- perder el diagnostico de coste jamas debe tumbar la pasada
 * del departamento.
 */
export function buildClaudeEmployeeExecutionRecord(input: BuildExecutionRecordInput): ClaudeEmployeeExecutionRecord {
  const now = input.now ?? new Date();
  const base: ClaudeEmployeeExecutionRecord = {
    contractVersion: CLAUDE_EXECUTION_RECORD_CONTRACT_VERSION,
    employee: input.employee,
    model: null,
    durationMs: null,
    costUsd: null,
    numTurns: null,
    outputSource: normalizeOutputSource(input.outputSource),
    outcome: input.claudeOutcome === "success" ? "success" : input.claudeOutcome === "failure" ? "error" : "unknown",
    note: "",
    recordedAt: now.toISOString(),
  };

  const content = input.executionFileContent?.trim();
  if (!content) {
    return { ...base, note: "No hubo execution_file para esta invocacion (Claude no llego a ejecutarse, o la Action no lo publico). Metricas no disponibles -- no se estima ninguna." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { ...base, note: `El execution_file no es JSON valido (${err instanceof Error ? err.message : String(err)}). Metricas no disponibles -- no se estima ninguna.` };
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const model = extractModelFromExecutionMessages(messages);

  const resultMessages = messages.filter((m): m is Record<string, unknown> => isRecord(m) && m.type === "result");
  if (resultMessages.length === 0) {
    return { ...base, model, note: 'El execution_file no contiene ningun mensaje final de tipo "result": no hay metricas de coste/turnos que reportar.' };
  }
  const final = resultMessages[resultMessages.length - 1];

  const outcome: ClaudeExecutionOutcome =
    final.is_error === true || (typeof final.subtype === "string" && final.subtype !== "success") ? "error" : base.outcome === "unknown" ? "success" : base.outcome;

  return {
    ...base,
    model,
    durationMs: numberOrNull(final.duration_ms),
    costUsd: numberOrNull(final.total_cost_usd),
    numTurns: numberOrNull(final.num_turns),
    outcome,
    note: "",
  };
}

export function isClaudeEmployeeExecutionRecord(value: unknown): value is ClaudeEmployeeExecutionRecord {
  if (!isRecord(value)) return false;
  return value.contractVersion === CLAUDE_EXECUTION_RECORD_CONTRACT_VERSION && typeof value.employee === "string";
}
