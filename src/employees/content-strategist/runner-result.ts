import { ContentStrategistRunnerResultSummary } from "./brief";

/**
 * Parser TOOL (puro, sin I/O) de la linea `RUNNER_RESULT_JSON=...` que
 * imprime scripts/run-content-strategist.ts -- mismo patron que
 * src/core/runner-result-parser.ts (el parser de
 * ux-ui-landing-architect-v2), reimplementado aqui de forma
 * independiente en vez de importado: ese modulo esta acoplado al tipo
 * `RunnerResultSummary` de src/core/landing-architect-comparison.ts (sus
 * campos obligatorios son `changePackId`/`v2Status`/etc., especificos de
 * ese empleado), asi que no es realmente generico pese a vivir en
 * `src/core` -- ver la nota en docs/claude-employee-runtime.md sobre
 * `ux-ui-landing-architect-v2` conservando sus ficheros de dominio en
 * ubicaciones historicas.
 *
 * Usado por scripts/parse-content-strategist-runner-result-for-ci.ts,
 * el wrapper de CLI que el workflow usa para extraer esta linea del log
 * de cada paso del runner SIN parsear el resto de la salida en texto
 * libre.
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

const VALID_STATUSES: ContentStrategistRunnerResultSummary["status"][] = ["no_eligible_work", "pending_execution", "invalid_output", "executed"];

/**
 * Valida (fail-closed, sin librerias externas) que el JSON parseado
 * tiene la forma minima de un ContentStrategistRunnerResultSummary antes
 * de confiar en sus campos -- un runner roto que imprimiera JSON valido
 * pero incompleto no debe pasar desapercibido como si tuviera todos los
 * campos esperados.
 */
export function parseRunnerResultJson(jsonText: string): ContentStrategistRunnerResultSummary {
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

  const REQUIRED_STRING_FIELDS = ["status", "changePackId", "keyword", "promptFilePath", "expectedOutputPath", "artifactJsonPath", "artifactMdPath"] as const;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isString(o[field])) {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo string "${field}".`);
    }
  }
  if (!VALID_STATUSES.includes(o.status as ContentStrategistRunnerResultSummary["status"])) {
    throw new Error(`RUNNER_RESULT_JSON invalido: status "${String(o.status)}" no es uno de los ${VALID_STATUSES.length} valores esperados.`);
  }
  if (o.auditWarningCount !== null && typeof o.auditWarningCount !== "number") {
    throw new Error(`RUNNER_RESULT_JSON invalido: auditWarningCount debe ser number o null, encontrado "${typeof o.auditWarningCount}".`);
  }

  return o as unknown as ContentStrategistRunnerResultSummary;
}

/** Combina las dos funciones de arriba -- el punto de entrada que usa scripts/parse-content-strategist-runner-result-for-ci.ts. */
export function extractAndParseRunnerResult(log: string): ContentStrategistRunnerResultSummary {
  const jsonText = extractLastRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseRunnerResultJson(jsonText);
}
