import { ClaudeEmployeeExecutionRecord, isClaudeEmployeeExecutionRecord } from "../core/claude-employee-execution-record";
import { DepartmentStageName, DEPARTMENT_STAGE_NAMES } from "./types";

/**
 * COSTE / OBSERVABILIDAD de la pasada coordinada.
 *
 * Cada invocacion de Claude de la pasada deja sus metricas en SU PROPIO
 * fichero, dentro del directorio de SU etapa
 * (`reports/department/<departmentRunId>/stages/<empleado>/claude-execution.json`),
 * escrito por el runtime comun a traves de su input opcional
 * `execution-record-path`. Antes, las seis invocaciones compartian el
 * mismo `execution_file` del runner y solo sobrevivia la ultima.
 *
 * Este modulo agrega esos ficheros. Reglas duras:
 *
 * - Un empleado sin registro NO cuenta como coste 0: cuenta como
 *   "no reportado", y el total se marca como PARCIAL.
 * - No se estima, extrapola ni promedia ningun coste que no venga
 *   literalmente del registro.
 * - Es puro (sin I/O): recibe el contenido ya leido de cada fichero.
 */

export interface DepartmentEmployeeRun {
  employee: DepartmentStageName;
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
  numTurns: number | null;
  outputSource: string;
  outcome: string;
  note: string;
}

export interface DepartmentRunCostSummary {
  /** Empleados con registro leido en esta pasada (en el orden canonico de etapas). */
  runs: DepartmentEmployeeRun[];
  /** Suma de los costes REALMENTE reportados. `null` si ninguno lo reporto. */
  totalCostUsd: number | null;
  totalDurationMs: number | null;
  totalTurns: number | null;
  /** Empleados que SI reportaron coste. */
  employeesWithCost: number;
  /** Empleados que se invocaron pero no dejaron coste utilizable. */
  employeesWithoutCost: number;
  /** `true` si falta el coste de algun empleado con registro -- el total NO es el coste real de la pasada. */
  partial: boolean;
}

function isStageName(value: string): value is DepartmentStageName {
  return (DEPARTMENT_STAGE_NAMES as string[]).includes(value);
}

/**
 * Convierte el contenido de un `claude-execution.json` en un
 * `DepartmentEmployeeRun`. Devuelve `undefined` (nunca lanza) si el
 * fichero no es un registro valido o no corresponde a una etapa conocida:
 * un registro roto se ignora, jamas se interpreta a medias.
 */
export function parseEmployeeRunRecord(rawText: string, expectedEmployee: DepartmentStageName): DepartmentEmployeeRun | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return undefined;
  }
  if (!isClaudeEmployeeExecutionRecord(parsed)) return undefined;
  const record = parsed as ClaudeEmployeeExecutionRecord;
  if (!isStageName(record.employee) || record.employee !== expectedEmployee) return undefined;
  return {
    employee: record.employee,
    model: record.model,
    durationMs: record.durationMs,
    costUsd: record.costUsd,
    numTurns: record.numTurns,
    outputSource: record.outputSource,
    outcome: record.outcome,
    note: record.note,
  };
}

export function summarizeDepartmentRunCost(runs: DepartmentEmployeeRun[]): DepartmentRunCostSummary {
  const withCost = runs.filter((r) => typeof r.costUsd === "number");
  const withDuration = runs.filter((r) => typeof r.durationMs === "number");
  const withTurns = runs.filter((r) => typeof r.numTurns === "number");
  return {
    runs,
    totalCostUsd: withCost.length > 0 ? withCost.reduce((acc, r) => acc + (r.costUsd ?? 0), 0) : null,
    totalDurationMs: withDuration.length > 0 ? withDuration.reduce((acc, r) => acc + (r.durationMs ?? 0), 0) : null,
    totalTurns: withTurns.length > 0 ? withTurns.reduce((acc, r) => acc + (r.numTurns ?? 0), 0) : null,
    employeesWithCost: withCost.length,
    employeesWithoutCost: runs.length - withCost.length,
    partial: runs.length === 0 || withCost.length !== runs.length,
  };
}

/** Formatea un coste para informes humanos sin inventar precision ni sustituir "no reportado" por 0. */
export function formatCostUsd(costUsd: number | null): string {
  return costUsd === null ? "no reportado" : `${costUsd.toFixed(4)} USD`;
}

export function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null) return "no reportada";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}
