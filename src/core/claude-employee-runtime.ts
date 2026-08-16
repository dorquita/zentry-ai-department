import { JsonSchemaLite, validateAgainstSchema } from "./json-schema-lite";
import { ClaudeRuntimeFailureKind, ClaudeRuntimeFailureClassification, classifyFailure, classifyInvocationFailure, ClaudeInvocationEvidence } from "./claude-runtime-failure-taxonomy";

/**
 * Runtime COMUN reutilizable por cualquier "empleado Claude" (un
 * `.claude/agents/*.md` invocado como sesion principal de
 * `claude-code-action` via `--agent`, ver
 * `.github/actions/claude-employee-runtime/action.yml`) -- ver
 * docs/claude-employee-runtime.md para la arquitectura completa.
 *
 * FRONTERA DELIBERADA: este modulo NO SABE NADA de ningun dominio de
 * negocio concreto -- no conoce `hero`, `FAQ`, `changePackId`,
 * `fabricationWarnings`, "landing", "universidad", ni ningun otro
 * concepto de `ux-ui-landing-architect-v2` (el primer empleado) ni de
 * ningun empleado futuro. Solo sabe:
 *
 *   1. extraer JSON de una respuesta de texto de Claude (tolerando un
 *      posible fence de markdown),
 *   2. decidir, dado lo que devolvio `claude-code-action`, si la salida
 *      viene de `structured_output` (caso A) o hay que recuperarla del
 *      `execution_file` (caso B) -- o si no hay nada recuperable (caso C),
 *   3. validar el JSON resultante contra el JSON Schema VERSIONADO propio
 *      de cada empleado (nunca un schema hardcodeado aqui).
 *
 * La validacion de FORMA especifica del empleado (su interfaz TypeScript
 * exacta, sus auditorias de dominio) es responsabilidad EXCLUSIVA del
 * codigo de cada empleado, ejecutada DESPUES de `resolveClaudeEmployeeOutput()`
 * -- este modulo entrega `parsed: unknown`, nunca un tipo de dominio.
 */

/**
 * Extrae JSON de la respuesta cruda de texto de un empleado Claude. Las
 * instrucciones de cada `.claude/agents/*.md` piden normalmente "sin
 * markdown fences", pero en la practica (ver caso real documentado en
 * docs/ux-ui-landing-architect-v2-experiment.md) el modelo puede envolver
 * la respuesta en ```json ... ``` de todas formas -- esta funcion tolera
 * ese caso (y el caso sin fences) antes de intentar `JSON.parse`, para
 * que una diferencia de formato no tumbe todo el pipeline automatico.
 * Fail-closed igualmente: si tras quitar un posible fence el contenido
 * no es JSON valido, lanza -- nunca intenta "adivinar" ni reparar el
 * contenido.
 */
export function extractJsonFromModelResponse(raw: string): unknown {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

/** Subconjunto minimo de un SDKMessage que necesitamos -- no importamos el paquete completo del SDK (no es una dependencia de este proyecto). */
export interface ExecutionFileMessage {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
}

/**
 * Encuentra el ULTIMO mensaje de tipo "result" en el array completo de
 * mensajes de un `execution_file` de `claude-code-action`. Usa el
 * ULTIMO (no el primero) por el mismo motivo defensivo que
 * `extractLastRunnerResultJsonLine()` (src/core/runner-result-parser.ts):
 * es la garantia mas robusta de "el resultado final de esta ejecucion",
 * aunque en la practica el SDK corta el stream en el primer mensaje
 * "result" que ve.
 */
export function extractFinalResultMessage(messages: unknown): ExecutionFileMessage {
  if (!Array.isArray(messages)) {
    throw new Error("execution_file invalido: se esperaba un array de mensajes SDK.");
  }
  const resultMessages = messages.filter((m): m is ExecutionFileMessage => typeof m === "object" && m !== null && (m as Record<string, unknown>).type === "result");
  if (resultMessages.length === 0) {
    throw new Error('execution_file invalido: no se encontro ningun mensaje final de tipo "result" -- no hay nada recuperable.');
  }
  return resultMessages[resultMessages.length - 1];
}

export type ClaudeEmployeeOutputSource = "structured_output" | "execution_file_fallback";

export interface ResolvedClaudeEmployeeOutput {
  /** De donde vino la salida -- para logging/Step Summary, nunca para cambiar la validacion (ambos caminos exigen el mismo schema). */
  source: ClaudeEmployeeOutputSource;
  /** El texto EXACTO devuelto por Claude (structured_output o el campo `result` del execution_file) -- nunca reescrito ni "reparado". Esto es lo que debe escribirse tal cual en el fichero de salida esperado por el empleado. */
  rawText: string;
  /** JSON ya parseado y validado contra el JSON Schema versionado del empleado -- todavia SIN tipar ni auditar por logica de dominio; eso lo hace el codigo del empleado, no este modulo. */
  parsed: unknown;
}

/**
 * Punto de entrada del runtime comun. Dado lo que devolvio
 * `claude-code-action` (i.e. su output `structured_output`, que puede
 * venir vacio -- ver docs/ux-ui-landing-architect-v2-experiment.md para
 * el comportamiento oficialmente documentado por Anthropic donde esto
 * ocurre con subtype "success") mas, opcionalmente, el contenido crudo
 * del `execution_file` (para el fallback), decide el caso A/B/C:
 *
 *   A) `structuredOutput` presente -> se usa.
 *   B) ausente pero `executionFileContent` contiene un mensaje final
 *      "result" recuperable (subtype "success", is_error !== true, con
 *      un campo `result` de texto) -> se recupera de ahi.
 *   C) ninguno de los dos -> lanza (fallo real de Claude, no
 *      recuperable).
 *
 * En AMBOS caminos (A y B) el JSON resultante se valida contra el MISMO
 * `outputSchema` (el JSON Schema versionado que ya recibe `--json-schema`
 * en el caso A) -- nunca dos contratos distintos segun el camino. Nunca
 * repara ni reinterpreta el JSON: cualquier fallo de parseo o de schema
 * lanza con un motivo especifico y distinguible.
 */
export function resolveClaudeEmployeeOutput(params: { structuredOutput: string | undefined; executionFileContent: string | undefined; outputSchema: JsonSchemaLite }): ResolvedClaudeEmployeeOutput {
  const { structuredOutput, executionFileContent, outputSchema } = params;

  if (structuredOutput && structuredOutput.trim().length > 0) {
    const parsed = extractJsonFromModelResponse(structuredOutput);
    const schemaErrors = validateAgainstSchema(outputSchema, outputSchema, parsed);
    if (schemaErrors.length > 0) {
      throw new Error(`structured_output no cumple el JSON Schema versionado del empleado: ${schemaErrors.join("; ")}`);
    }
    return { source: "structured_output", rawText: structuredOutput, parsed };
  }

  if (!executionFileContent) {
    throw new Error("No hay structured_output ni execution_file disponible -- fallo real de Claude, no recuperable (caso C).");
  }

  let messages: unknown;
  try {
    messages = JSON.parse(executionFileContent);
  } catch (err) {
    throw new Error(`execution_file invalido: no es JSON valido (${err instanceof Error ? err.message : String(err)}).`);
  }

  const resultMessage = extractFinalResultMessage(messages);

  if (resultMessage.subtype !== "success" || resultMessage.is_error === true) {
    throw new Error(`Fallo real de Claude, no recuperable: mensaje final de tipo "result" con subtype="${String(resultMessage.subtype)}" is_error=${String(resultMessage.is_error)}.`);
  }

  if (typeof resultMessage.result !== "string" || resultMessage.result.trim().length === 0) {
    throw new Error('El mensaje final de tipo "result" no tiene un campo `result` de texto no vacio -- nada que recuperar.');
  }

  const parsed = extractJsonFromModelResponse(resultMessage.result);

  const schemaErrors = validateAgainstSchema(outputSchema, outputSchema, parsed);
  if (schemaErrors.length > 0) {
    throw new Error(`El JSON recuperado del execution_file no cumple el JSON Schema versionado del empleado: ${schemaErrors.join("; ")}`);
  }

  return { source: "execution_file_fallback", rawText: resultMessage.result, parsed };
}

/**
 * Mapeo de los `subtype` de error del mensaje final del Agent SDK a la
 * taxonomia del runtime. Explicito y exhaustivo a proposito: un subtype
 * nuevo cae en `unknown_runtime_failure` (no reintentable) en vez de
 * heredar silenciosamente la politica de otro.
 *
 * Ojo con `error_max_structured_output_retries`: significa que el SDK
 * YA re-pregunto varias veces al modelo y aun asi no consiguio una
 * salida valida contra el schema. Por eso se clasifica como
 * `schema_validation_failed` (determinista, NO reintentable): reintentar
 * desde fuera repetiria un bucle que el SDK ya agoto por dentro.
 */
const SDK_ERROR_SUBTYPE_TO_FAILURE_KIND: Record<string, ClaudeRuntimeFailureKind> = {
  error_max_structured_output_retries: "schema_validation_failed",
  error_max_turns: "timeout",
  error_max_budget_usd: "timeout",
  error_during_execution: "provider_transient_failure",
};

export type ClaudeEmployeeResolution =
  | { ok: true; resolved: ResolvedClaudeEmployeeOutput }
  | { ok: false; classification: ClaudeRuntimeFailureClassification };

/**
 * Version NO lanzante de `resolveClaudeEmployeeOutput()`: resuelve la
 * salida igual que ella (mismo contrato, misma validacion, mismo
 * fail-closed) pero, cuando no puede, devuelve la CLASE de fallo en vez
 * de una excepcion generica.
 *
 * Existe para que la composite action pueda decidir si reintentar sin
 * tener que adivinar el motivo parseando un mensaje de error. La
 * validacion es EXACTAMENTE la misma: nunca acepta una salida que
 * `resolveClaudeEmployeeOutput()` rechazaria, y nunca marca `ok: true`
 * solo porque exista texto.
 */
export function attemptResolveClaudeEmployeeOutput(params: { structuredOutput: string | undefined; executionFileContent: string | undefined; outputSchema: JsonSchemaLite; evidence: ClaudeInvocationEvidence }): ClaudeEmployeeResolution {
  const { structuredOutput, executionFileContent, outputSchema, evidence } = params;
  const attempt = evidence.attempt;

  // --- Caso A: structured_output presente (el camino que el SDK
  // valida contra el mismo schema en generacion). ---
  if (structuredOutput && structuredOutput.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = extractJsonFromModelResponse(structuredOutput);
    } catch (err) {
      return { ok: false, classification: classifyFailure("result_not_json", `structured_output no es JSON valido: ${errorText(err)}.`, attempt) };
    }
    const schemaErrors = validateAgainstSchema(outputSchema, outputSchema, parsed);
    if (schemaErrors.length > 0) {
      return { ok: false, classification: classifyFailure("schema_validation_failed", `structured_output no cumple el schema: ${schemaErrors.join("; ")}`, attempt) };
    }
    return { ok: true, resolved: { source: "structured_output", rawText: structuredOutput, parsed } };
  }

  // --- Sin structured_output: decidir si hay algo recuperable. ---
  if (!executionFileContent) {
    return { ok: false, classification: classifyInvocationFailure(evidence) };
  }

  let messages: unknown;
  try {
    messages = JSON.parse(executionFileContent);
  } catch (err) {
    return { ok: false, classification: classifyFailure("execution_file_invalid", `execution_file no es JSON valido (probable truncado): ${errorText(err)}.`, attempt) };
  }

  if (!Array.isArray(messages)) {
    return { ok: false, classification: classifyFailure("execution_file_invalid", "execution_file no contiene un array de mensajes SDK.", attempt) };
  }

  const resultMessages = messages.filter((m): m is ExecutionFileMessage => typeof m === "object" && m !== null && (m as Record<string, unknown>).type === "result");

  if (resultMessages.length === 0) {
    return { ok: false, classification: classifyFailure("result_missing", `El execution_file tiene ${messages.length} mensaje(s) SDK pero ninguno de tipo "result": el stream murio antes del mensaje final.`, attempt) };
  }

  const resultMessage = resultMessages[resultMessages.length - 1];

  if (resultMessage.subtype !== "success" || resultMessage.is_error === true) {
    const subtype = String(resultMessage.subtype);
    const kind = SDK_ERROR_SUBTYPE_TO_FAILURE_KIND[subtype] ?? "unknown_runtime_failure";
    return { ok: false, classification: classifyFailure(kind, `Mensaje final "result" con subtype="${subtype}" is_error=${String(resultMessage.is_error)}.`, attempt) };
  }

  if (typeof resultMessage.result !== "string" || resultMessage.result.trim().length === 0) {
    return { ok: false, classification: classifyFailure("result_missing", 'El mensaje final "result" no trae un campo `result` de texto no vacio.', attempt) };
  }

  let parsed: unknown;
  try {
    parsed = extractJsonFromModelResponse(resultMessage.result);
  } catch (err) {
    return { ok: false, classification: classifyFailure("result_not_json", `El texto final de Claude (${resultMessage.result.length} caracteres) no es JSON valido: ${errorText(err)}.`, attempt) };
  }

  const schemaErrors = validateAgainstSchema(outputSchema, outputSchema, parsed);
  if (schemaErrors.length > 0) {
    return { ok: false, classification: classifyFailure("schema_validation_failed", `El JSON recuperado del execution_file no cumple el schema: ${schemaErrors.join("; ")}`, attempt) };
  }

  return { ok: true, resolved: { source: "execution_file_fallback", rawText: resultMessage.result, parsed } };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
