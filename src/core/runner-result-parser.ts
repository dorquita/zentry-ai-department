import { RunnerResultSummary } from "./landing-architect-comparison";

/**
 * Parser TOOL (puro, sin I/O) de la linea `RUNNER_RESULT_JSON=...` que
 * imprime scripts/run-landing-architect-comparison.ts (ver
 * buildRunnerResultSummary() en src/core/landing-architect-comparison.ts).
 *
 * Separado como modulo independiente para que
 * .github/workflows/ux-ui-landing-architect-v2.yml pueda extraer esa
 * linea del log de cada paso del runner (paso 1: prepara V2Result
 * pending_execution; paso 2: valida la respuesta de Claude) SIN parsear
 * el resto de la salida en texto libre ni usar `grep`/`sed` sobre
 * contenido potencialmente multi-linea -- ver
 * scripts/ci/parse-runner-result.ts para el wrapper de CLI que usa el
 * workflow.
 */

/**
 * Busca la ULTIMA linea que empieza por `RUNNER_RESULT_JSON=` en un log de
 * texto (puede haber ruido de npm/ts-node antes o despues). Devuelve solo
 * el JSON (sin el prefijo), o `undefined` si no aparece ninguna. Usa la
 * ULTIMA coincidencia a proposito: es la unica garantia robusta de "la
 * salida final de esta ejecucion del runner", incluso si alguna
 * dependencia imprimiera por error una linea con el mismo prefijo antes.
 */
export function extractLastRunnerResultJsonLine(log: string): string | undefined {
  const matches = [...log.matchAll(/^RUNNER_RESULT_JSON=(.*)$/gm)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1];
}

/**
 * Valida (fail-closed, sin librerias externas) que el JSON parseado tiene
 * la forma minima de un RunnerResultSummary antes de confiar en sus
 * campos -- un runner roto que imprimiera JSON valido pero incompleto no
 * debe pasar desapercibido como si tuviera todas las rutas esperadas.
 */
export function parseRunnerResultJson(jsonText: string): RunnerResultSummary {
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

  const REQUIRED_STRING_FIELDS = ["changePackId", "keyword", "v2Status", "promptFilePath", "expectedV2OutputPath", "comparisonJsonPath", "comparisonMdPath"] as const;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isString(o[field])) {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo string "${field}".`);
    }
  }
  if (!["pending_execution", "executed", "invalid_output"].includes(o.v2Status as string)) {
    throw new Error(`RUNNER_RESULT_JSON invalido: v2Status "${String(o.v2Status)}" no es uno de los 3 valores esperados.`);
  }
  if (o.fabricationWarningCount !== null && typeof o.fabricationWarningCount !== "number") {
    throw new Error(`RUNNER_RESULT_JSON invalido: fabricationWarningCount debe ser number o null, encontrado "${typeof o.fabricationWarningCount}".`);
  }

  return o as unknown as RunnerResultSummary;
}

/** Combina las dos funciones de arriba -- el punto de entrada que usa scripts/ci/parse-runner-result.ts. */
export function extractAndParseRunnerResult(log: string): RunnerResultSummary {
  const jsonText = extractLastRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseRunnerResultJson(jsonText);
}
