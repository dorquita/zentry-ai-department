import { SemRunnerResultSummary, SemRunnerStatus } from "./sem-specialist-output";

/**
 * Parser TOOL (puro, sin I/O) de la linea `RUNNER_RESULT_JSON=...` que
 * imprime scripts/run-sem-specialist.ts (ver buildSemRunnerResultSummary()
 * en src/employees/sem-specialist/sem-specialist-output.ts).
 *
 * Mismo patron que src/core/runner-result-parser.ts (el parser generico de
 * ux-ui-landing-architect-v2) pero con el contrato de campos propio de
 * sem-specialist -- no se reutiliza el modulo original porque los campos
 * (status/sourceEventId/... en vez de changePackId/v2Status/...) son
 * distintos por diseno (cada empleado define su propio RUNNER_RESULT_JSON,
 * ver docs/claude-employee-runtime.md).
 */

const VALID_STATUSES: SemRunnerStatus[] = ["no_data", "pending_execution", "executed", "invalid_output"];

/** Busca la ULTIMA linea que empieza por `RUNNER_RESULT_JSON=` en un log de texto -- mismo motivo defensivo que el parser original (puede haber ruido de npm/ts-node alrededor). */
export function extractLastSemRunnerResultJsonLine(log: string): string | undefined {
  const matches = [...log.matchAll(/^RUNNER_RESULT_JSON=(.*)$/gm)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1];
}

/** Valida (fail-closed, sin librerias externas) que el JSON parseado tiene la forma minima de un SemRunnerResultSummary antes de confiar en sus campos. */
export function parseSemRunnerResultJson(jsonText: string): SemRunnerResultSummary {
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
  const isString = (v: unknown): v is string => typeof v === "string";

  const REQUIRED_STRING_FIELDS = ["status", "sourceEventId", "sourceDepartmentRunId", "promptFilePath", "expectedOutputPath", "artifactJsonPath", "artifactMdPath"] as const;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isString(o[field])) {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo string "${field}".`);
    }
  }
  if (!VALID_STATUSES.includes(o.status as SemRunnerStatus)) {
    throw new Error(`RUNNER_RESULT_JSON invalido: status "${String(o.status)}" no es uno de los valores esperados (${VALID_STATUSES.join(", ")}).`);
  }
  if (o.unsupportedClaimCount !== null && typeof o.unsupportedClaimCount !== "number") {
    throw new Error(`RUNNER_RESULT_JSON invalido: unsupportedClaimCount debe ser number o null, encontrado "${typeof o.unsupportedClaimCount}".`);
  }

  return o as unknown as SemRunnerResultSummary;
}

/** Combina las dos funciones de arriba -- el punto de entrada que usa scripts/parse-sem-specialist-runner-result-for-ci.ts. */
export function extractAndParseSemRunnerResult(log: string): SemRunnerResultSummary {
  const jsonText = extractLastSemRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseSemRunnerResultJson(jsonText);
}
