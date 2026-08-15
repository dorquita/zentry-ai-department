import { AnalyticsSpecialistOutput } from "./types";

/**
 * Contrato machine-readable `RUNNER_RESULT_JSON=...` que imprime
 * scripts/run-analytics-specialist.ts -- mismo patron que
 * RunnerResultSummary/buildRunnerResultSummary en
 * src/core/landing-architect-comparison.ts (ver tambien
 * src/core/runner-result-parser.ts), pero con la forma propia de este
 * empleado (4 estados posibles, no 3 -- ver AnalyticsSpecialistResult):
 * este runner puede terminar en "no_analytics_data" si
 * analytics-watcher nunca se ha ejecutado en este repositorio (ver
 * src/employees/analytics-specialist/context.ts), un estado que
 * ux-ui-landing-architect-v2 no tiene (siempre hay change packs).
 *
 * NO reutiliza src/core/runner-result-parser.ts a proposito: ese modulo
 * esta tipado especificamente para RunnerResultSummary de
 * landing-architect-comparison (campos changePackId/keyword/v2Status) --
 * mezclar dominios ahi romperia la separacion "cada empleado define los
 * campos que tengan sentido para su dominio" (ver
 * docs/claude-employee-runtime.md, paso 3 de "Como anadir un nuevo
 * empleado").
 */

export type AnalyticsSpecialistRunStatus = "no_analytics_data" | "pending_execution" | "invalid_output" | "executed";

export type AnalyticsSpecialistResult =
  | { status: "no_analytics_data"; reason: string }
  | { status: "pending_execution"; promptFilePath: string; departmentRunId: string }
  | { status: "invalid_output"; error: string; rawOutputPath: string; departmentRunId: string }
  | { status: "executed"; output: AnalyticsSpecialistOutput; auditWarnings: string[]; departmentRunId: string };

/** Misma forma (mismas claves) en los 4 estados -- quien orquesta esto (el workflow de GitHub Actions) no debe ramificar su logica de lectura segun el estado para saber donde esta cada fichero. */
export interface AnalyticsSpecialistRunnerResultSummary {
  status: AnalyticsSpecialistRunStatus;
  departmentRunId: string | null;
  reason: string | null;
  promptFilePath: string | null;
  expectedOutputPath: string | null;
  artifactJsonPath: string | null;
  artifactMdPath: string | null;
  auditWarningCount: number | null;
}

export function buildAnalyticsSpecialistRunnerResultSummary(
  paths: { promptFilePath: string; expectedOutputPath: string; artifactJsonPath: string; artifactMdPath: string },
  result: AnalyticsSpecialistResult
): AnalyticsSpecialistRunnerResultSummary {
  return {
    status: result.status,
    departmentRunId: result.status === "no_analytics_data" ? null : result.departmentRunId,
    reason: result.status === "no_analytics_data" ? result.reason : null,
    promptFilePath: result.status === "no_analytics_data" ? null : paths.promptFilePath,
    expectedOutputPath: result.status === "no_analytics_data" ? null : paths.expectedOutputPath,
    artifactJsonPath: result.status === "no_analytics_data" ? null : paths.artifactJsonPath,
    artifactMdPath: result.status === "no_analytics_data" ? null : paths.artifactMdPath,
    auditWarningCount: result.status === "executed" ? result.auditWarnings.length : null,
  };
}

/** Busca la ULTIMA linea "RUNNER_RESULT_JSON=..." en un log de texto -- mismo motivo que extractLastRunnerResultJsonLine() en src/core/runner-result-parser.ts (robusto frente a ruido de npm/ts-node antes o despues). */
export function extractLastAnalyticsSpecialistRunnerResultJsonLine(log: string): string | undefined {
  const matches = [...log.matchAll(/^RUNNER_RESULT_JSON=(.*)$/gm)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1];
}

const VALID_STATUSES: AnalyticsSpecialistRunStatus[] = ["no_analytics_data", "pending_execution", "invalid_output", "executed"];

/** Valida (fail-closed) que el JSON parseado tiene la forma minima de un AnalyticsSpecialistRunnerResultSummary antes de confiar en sus campos. */
export function parseAnalyticsSpecialistRunnerResultJson(jsonText: string): AnalyticsSpecialistRunnerResultSummary {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`RUNNER_RESULT_JSON no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("RUNNER_RESULT_JSON invalido: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.status !== "string" || !VALID_STATUSES.includes(o.status as AnalyticsSpecialistRunStatus)) {
    throw new Error(`RUNNER_RESULT_JSON invalido: status "${String(o.status)}" no es uno de los estados esperados.`);
  }
  const NULLABLE_STRING_FIELDS = ["departmentRunId", "reason", "promptFilePath", "expectedOutputPath", "artifactJsonPath", "artifactMdPath"] as const;
  for (const field of NULLABLE_STRING_FIELDS) {
    if (o[field] !== null && typeof o[field] !== "string") {
      throw new Error(`RUNNER_RESULT_JSON invalido: el campo "${field}" debe ser string o null.`);
    }
  }
  if (o.auditWarningCount !== null && typeof o.auditWarningCount !== "number") {
    throw new Error('RUNNER_RESULT_JSON invalido: "auditWarningCount" debe ser number o null.');
  }

  return o as unknown as AnalyticsSpecialistRunnerResultSummary;
}

export function extractAndParseAnalyticsSpecialistRunnerResult(log: string): AnalyticsSpecialistRunnerResultSummary {
  const jsonText = extractLastAnalyticsSpecialistRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseAnalyticsSpecialistRunnerResultJson(jsonText);
}
