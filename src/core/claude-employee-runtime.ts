import * as crypto from "crypto";
import { JsonSchemaLite, validateAgainstSchema } from "./json-schema-lite";

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
 * DIAGNOSTICO de una invocacion del runtime comun -- ver
 * docs/claude-employee-runtime.md, seccion "Diagnostico".
 *
 * Motivo por el que existe (incidente real de seo-specialist en la
 * pasada dept-2026-08-16T124753Z): cuando `resolveClaudeEmployeeOutput()`
 * lanzaba, lo unico que quedaba registrado aguas arriba era
 * "runtime=failure / claude=failure", que confunde ocho fallos
 * COMPLETAMENTE distintos en una sola etiqueta inutil. Esta funcion
 * clasifica cual de esos ocho fallos ocurrio de verdad, sin volver a
 * ejecutar nada y sin cambiar el veredicto (la autoridad sigue siendo
 * `resolveClaudeEmployeeOutput()`, que es quien falla en cerrado).
 *
 * NUNCA LANZA: un diagnostico que se rompiera al diagnosticar dejaria el
 * incidente exactamente igual de ciego que antes.
 *
 * PRIVACIDAD -- este objeto se imprime en el log de GitHub Actions y se
 * guarda como fichero, asi que deliberadamente NO contiene contenido:
 * ni el prompt, ni la respuesta de Claude, ni tokens, ni credenciales.
 * Solo metadatos estructurales (tamanos, hashes truncados, tipos de
 * mensaje, presencia/ausencia de campos, longitudes, y los mensajes de
 * error de parseo/schema, que citan rutas de campo y valores de enum
 * cortos, nunca texto libre del modelo).
 */
export type ClaudeEmployeeFailureKind =
  | "none"
  | "no_output_at_all"
  | "execution_file_not_json"
  | "execution_file_without_result_message"
  | "claude_reported_failure"
  | "result_field_missing_or_empty"
  | "result_not_valid_json"
  | "schema_validation_failed";

/** Cuantos errores de schema se conservan en el diagnostico (el resto se cuenta pero no se imprime, para no volcar miles de lineas). */
const MAX_REPORTED_SCHEMA_ERRORS = 20;
/** Longitud maxima de cada mensaje de error conservado. */
const MAX_ERROR_MESSAGE_LENGTH = 300;

export interface ClaudeEmployeeOutputDiagnostics {
  contractVersion: "claude-employee-runtime-diagnostics/v1";
  /** Que fallo exactamente (o "none" si la salida se resolvio bien). */
  failureKind: ClaudeEmployeeFailureKind;
  /** Origen resuelto, o null si no se pudo resolver ninguno. */
  source: ClaudeEmployeeOutputSource | null;
  structuredOutput: {
    present: boolean;
    bytes: number;
    sha256Prefix: string | null;
  };
  executionFile: {
    provided: boolean;
    bytes: number;
    sha256Prefix: string | null;
    parsedAsJson: boolean | null;
    messageCount: number | null;
    messageTypeCounts: Record<string, number>;
    resultMessageCount: number | null;
  };
  finalResultMessage: {
    present: boolean;
    subtype: string | null;
    isError: boolean | null;
    resultFieldType: string | null;
    resultLength: number | null;
    /** Pistas ESTRUCTURALES para distinguir "JSON truncado" de "JSON con forma equivocada" -- nunca contenido. */
    hasMarkdownFence: boolean | null;
    lastNonWhitespaceChar: string | null;
  };
  jsonParse: { attempted: boolean; ok: boolean; error: string | null };
  schemaValidation: { attempted: boolean; ok: boolean; errorCount: number; errors: string[] };
}

function sha256Prefix(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 12);
}

function truncateMessage(message: string): string {
  return message.length <= MAX_ERROR_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}... (truncado)`;
}

function countMessageTypes(messages: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    const type = typeof message === "object" && message !== null ? String((message as Record<string, unknown>).type ?? "(sin type)") : `(no-objeto: ${typeof message})`;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export function buildClaudeEmployeeOutputDiagnostics(params: { structuredOutput: string | undefined; executionFileContent: string | undefined; outputSchema: JsonSchemaLite }): ClaudeEmployeeOutputDiagnostics {
  const { structuredOutput, executionFileContent, outputSchema } = params;

  const diagnostics: ClaudeEmployeeOutputDiagnostics = {
    contractVersion: "claude-employee-runtime-diagnostics/v1",
    failureKind: "none",
    source: null,
    structuredOutput: {
      present: !!structuredOutput && structuredOutput.trim().length > 0,
      bytes: structuredOutput ? Buffer.byteLength(structuredOutput, "utf-8") : 0,
      sha256Prefix: structuredOutput ? sha256Prefix(structuredOutput) : null,
    },
    executionFile: {
      provided: executionFileContent !== undefined,
      bytes: executionFileContent ? Buffer.byteLength(executionFileContent, "utf-8") : 0,
      sha256Prefix: executionFileContent ? sha256Prefix(executionFileContent) : null,
      parsedAsJson: null,
      messageCount: null,
      messageTypeCounts: {},
      resultMessageCount: null,
    },
    finalResultMessage: {
      present: false,
      subtype: null,
      isError: null,
      resultFieldType: null,
      resultLength: null,
      hasMarkdownFence: null,
      lastNonWhitespaceChar: null,
    },
    jsonParse: { attempted: false, ok: false, error: null },
    schemaValidation: { attempted: false, ok: false, errorCount: 0, errors: [] },
  };

  /** Parseo + validacion de schema, compartido por el caso A y el caso B (mismo contrato en ambos, igual que en resolveClaudeEmployeeOutput). */
  const inspectRawText = (rawText: string): void => {
    diagnostics.jsonParse.attempted = true;
    let parsed: unknown;
    try {
      parsed = extractJsonFromModelResponse(rawText);
      diagnostics.jsonParse.ok = true;
    } catch (err) {
      diagnostics.jsonParse.error = truncateMessage(err instanceof Error ? err.message : String(err));
      diagnostics.failureKind = "result_not_valid_json";
      return;
    }
    diagnostics.schemaValidation.attempted = true;
    const errors = validateAgainstSchema(outputSchema, outputSchema, parsed);
    diagnostics.schemaValidation.errorCount = errors.length;
    diagnostics.schemaValidation.errors = errors.slice(0, MAX_REPORTED_SCHEMA_ERRORS).map(truncateMessage);
    diagnostics.schemaValidation.ok = errors.length === 0;
    if (errors.length > 0) diagnostics.failureKind = "schema_validation_failed";
  };

  try {
    if (diagnostics.structuredOutput.present) {
      diagnostics.source = "structured_output";
      inspectRawText(structuredOutput as string);
      return diagnostics;
    }

    if (!executionFileContent) {
      diagnostics.failureKind = "no_output_at_all";
      return diagnostics;
    }

    let messages: unknown;
    try {
      messages = JSON.parse(executionFileContent);
      diagnostics.executionFile.parsedAsJson = true;
    } catch {
      diagnostics.executionFile.parsedAsJson = false;
      diagnostics.failureKind = "execution_file_not_json";
      return diagnostics;
    }

    if (!Array.isArray(messages)) {
      diagnostics.failureKind = "execution_file_without_result_message";
      return diagnostics;
    }

    diagnostics.executionFile.messageCount = messages.length;
    diagnostics.executionFile.messageTypeCounts = countMessageTypes(messages);
    diagnostics.executionFile.resultMessageCount = diagnostics.executionFile.messageTypeCounts["result"] ?? 0;

    if (diagnostics.executionFile.resultMessageCount === 0) {
      diagnostics.failureKind = "execution_file_without_result_message";
      return diagnostics;
    }

    const resultMessage = extractFinalResultMessage(messages);
    diagnostics.finalResultMessage.present = true;
    diagnostics.finalResultMessage.subtype = resultMessage.subtype === undefined ? null : String(resultMessage.subtype);
    diagnostics.finalResultMessage.isError = resultMessage.is_error === undefined ? null : resultMessage.is_error === true;
    diagnostics.finalResultMessage.resultFieldType = resultMessage.result === undefined ? "undefined" : typeof resultMessage.result;

    if (typeof resultMessage.result === "string") {
      const trimmed = resultMessage.result.trim();
      diagnostics.finalResultMessage.resultLength = resultMessage.result.length;
      diagnostics.finalResultMessage.hasMarkdownFence = /^```/.test(trimmed);
      diagnostics.finalResultMessage.lastNonWhitespaceChar = trimmed.length > 0 ? trimmed[trimmed.length - 1] : null;
    }

    if (resultMessage.subtype !== "success" || resultMessage.is_error === true) {
      diagnostics.failureKind = "claude_reported_failure";
      return diagnostics;
    }

    if (typeof resultMessage.result !== "string" || resultMessage.result.trim().length === 0) {
      diagnostics.failureKind = "result_field_missing_or_empty";
      return diagnostics;
    }

    diagnostics.source = "execution_file_fallback";
    inspectRawText(resultMessage.result);
    return diagnostics;
  } catch (err) {
    // Red de seguridad: diagnosticar nunca puede ser el motivo de que
    // una pasada se caiga -- se registra el fallo del propio
    // diagnostico y se devuelve lo que se haya podido reunir.
    diagnostics.jsonParse.error = truncateMessage(`fallo inesperado del propio diagnostico: ${err instanceof Error ? err.message : String(err)}`);
    return diagnostics;
  }
}

/** Frase corta y legible por humanos para cada clasificacion -- lo que antes se resumia como "runtime=failure / claude=failure". */
export function describeClaudeEmployeeFailureKind(kind: ClaudeEmployeeFailureKind): string {
  switch (kind) {
    case "none":
      return "salida resuelta y valida.";
    case "no_output_at_all":
      return "Claude no dejo NADA recuperable: ni structured_output ni execution_file (caso C).";
    case "execution_file_not_json":
      return "el execution_file existe pero no es JSON valido -- no se pudo recuperar la salida.";
    case "execution_file_without_result_message":
      return 'el execution_file existe y es JSON, pero no contiene ningun mensaje final de tipo "result".';
    case "claude_reported_failure":
      return "Claude respondio, pero su mensaje final declara un fallo real (subtype != success o is_error = true).";
    case "result_field_missing_or_empty":
      return 'Claude termino en exito pero su mensaje final no trae un campo `result` de texto no vacio -- no hay respuesta que recuperar.';
    case "result_not_valid_json":
      return "Claude respondio y hay texto en `result`, pero ese texto no es JSON valido (respuesta truncada, texto alrededor del JSON, o formato roto).";
    case "schema_validation_failed":
      return "Claude devolvio JSON valido, pero NO cumple el JSON Schema versionado del empleado -- descartado en cerrado (fail-closed).";
  }
}
