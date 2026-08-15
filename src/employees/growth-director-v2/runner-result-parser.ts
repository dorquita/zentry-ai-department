import { GrowthDirectorV2RunnerResultSummary } from "./domain";

/**
 * Parser TOOL (puro, sin I/O) de la linea `RUNNER_RESULT_JSON=...` que
 * imprime `scripts/run-growth-director-v2.ts` -- mismo patron que
 * `src/core/runner-result-parser.ts` (el parser generico de
 * `ux-ui-landing-architect-v2`), copiado y adaptado a la forma de
 * `GrowthDirectorV2RunnerResultSummary` en vez de modificar el original
 * (que sigue siendo especifico de Landing Architect,
 * `RunnerResultSummary` de `src/core/landing-architect-comparison.ts`).
 *
 * Separado como modulo independiente para que
 * `.github/workflows/growth-director-v2.yml` pueda extraer esa linea
 * del log de cada paso del runner (paso 1: prepara `pending_execution`;
 * paso 2: valida la respuesta de Claude) sin parsear el resto de la
 * salida en texto libre -- ver
 * `scripts/parse-growth-director-v2-runner-result-for-ci.ts` para el
 * wrapper de CLI que usa el workflow.
 */

/**
 * Busca la ULTIMA linea que empieza por `RUNNER_RESULT_JSON=` en un log
 * de texto (puede haber ruido de npm/ts-node antes o despues). Devuelve
 * solo el JSON (sin el prefijo), o `undefined` si no aparece ninguna.
 * Usa la ULTIMA coincidencia a proposito: es la garantia mas robusta de
 * "la salida final de esta ejecucion del runner".
 */
export function extractLastRunnerResultJsonLine(log: string): string | undefined {
  const matches = [...log.matchAll(/^RUNNER_RESULT_JSON=(.*)$/gm)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1];
}

/**
 * Valida (fail-closed, sin librerias externas) que el JSON parseado
 * tiene la forma minima de un `GrowthDirectorV2RunnerResultSummary`
 * antes de confiar en sus campos.
 */
export function parseRunnerResultJson(jsonText: string): GrowthDirectorV2RunnerResultSummary {
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

  const REQUIRED_STRING_FIELDS = ["departmentRunId", "status", "promptFilePath", "expectedOutputPath", "artifactJsonPath", "artifactMdPath"] as const;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isString(o[field])) {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo string "${field}".`);
    }
  }
  if (!["pending_execution", "executed", "invalid_output"].includes(o.status as string)) {
    throw new Error(`RUNNER_RESULT_JSON invalido: status "${String(o.status)}" no es uno de los 3 valores esperados.`);
  }
  if (o.auditWarningCount !== null && typeof o.auditWarningCount !== "number") {
    throw new Error(`RUNNER_RESULT_JSON invalido: auditWarningCount debe ser number o null, encontrado "${typeof o.auditWarningCount}".`);
  }

  return o as unknown as GrowthDirectorV2RunnerResultSummary;
}

/** Combina las dos funciones de arriba -- el punto de entrada que usa scripts/parse-growth-director-v2-runner-result-for-ci.ts. */
export function extractAndParseRunnerResult(log: string): GrowthDirectorV2RunnerResultSummary {
  const jsonText = extractLastRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseRunnerResultJson(jsonText);
}
