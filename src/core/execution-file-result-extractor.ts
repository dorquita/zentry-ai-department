import { extractJsonFromModelResponse, validateV2Output, LandingArchitectV2Output } from "./landing-architect-comparison";
import { JsonSchemaLite, validateAgainstSchema } from "./json-schema-lite";

/**
 * Fallback deterministico para cuando `claude-code-action` termina con
 * `subtype: "success"` pero SIN `structured_output` -- comportamiento
 * documentado oficialmente por Anthropic (no un bug de nuestro workflow):
 * "A result can also end with subtype success but no structured_output
 * value, for example when the run completes without the agent producing
 * a structured output" (https://code.claude.com/docs/en/agent-sdk/structured-outputs,
 * seccion "Error handling"). Ver .github/workflows/ux-ui-landing-architect-v2.yml
 * y docs/ux-ui-landing-architect-v2-experiment.md para el run real donde
 * se observo esto.
 *
 * Verificado leyendo el codigo real del commit fijado en el workflow
 * (9d7150bc8a3dae8149739a88019d192b579ad90c,
 * anthropics/claude-code-action):
 *   - base-action/src/run-claude-sdk.ts escribe el ARRAY COMPLETO de
 *     mensajes SDK (sin filtrar) a un fichero via writeExecutionFile()
 *     ANTES de comprobar structured_output -- ese fichero es el que
 *     expone la Action como su output `execution_file`.
 *   - src/entrypoints/run.ts (el entrypoint real que usa
 *     claude-code-action@v1, no solo base-action) SIGUE fijando el
 *     output `execution_file` (via setExecutionFileOutputIfPresent())
 *     incluso cuando el step termina fallando por falta de
 *     structured_output -- no hace falta ningun subprocess adicional
 *     para leerlo, el fichero ya esta en disco en el mismo runner/job.
 *   - El mensaje final de tipo "result" con subtype "success" SIEMPRE
 *     tiene un campo `result: string` (el texto final "clasico" de
 *     Claude Code), exista o no `structured_output` -- ver
 *     `SDKResultSuccess` en @anthropic-ai/claude-agent-sdk@0.3.233.
 *
 * Este modulo es TOOL puro (sin I/O): recibe el contenido YA LEIDO del
 * execution_file y reutiliza, SIN modificar, extractJsonFromModelResponse()
 * y validateV2Output() (src/core/landing-architect-comparison.ts) -- las
 * mismas funciones que ya usa el flujo normal (structured_output
 * presente). No reinterpreta ni "repara" el JSON de Claude: si no es
 * valido, o si la estructura no cumple LandingArchitectV2Output, lanza
 * (fail-closed), exactamente igual que el camino normal.
 *
 * PARIDAD DE CONTRATO caso A / caso B: cuando structured_output SI esta
 * presente (caso A), su contenido ya fue validado por el Claude Agent SDK
 * contra config/landing-architect-v2-output.schema.json (--json-schema),
 * INCLUIDO `additionalProperties: false` -- un campo extra no declarado
 * en el schema se rechaza ahi, antes de que este workflow lo vea
 * siquiera. validateV2Output() por si solo es mas permisivo (duck-typing
 * deliberado, ignora campos extra -- ver su propio comentario en
 * landing-architect-comparison.ts), asi que sin esta validacion extra el
 * camino de fallback (caso B) aceptaria JSON que --json-schema habria
 * rechazado en el caso A, relajando el contrato sin querer. Por eso
 * recoverV2OutputFromExecutionFile() exige el MISMO schema (via
 * validateAgainstSchema(), src/core/json-schema-lite.ts, la MISMA logica
 * que usa el test de deriva contra este fichero) ademas de
 * validateV2Output() -- nunca una tercera definicion manual del
 * contrato, siempre el mismo config/landing-architect-v2-output.schema.json.
 */

/** Subconjunto minimo de un SDKMessage que necesitamos -- no importamos el paquete completo del SDK (no es una dependencia de este proyecto). */
export interface ExecutionFileMessage {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
}

/**
 * Encuentra el ULTIMO mensaje de tipo "result" en el array completo de
 * mensajes del execution_file. Usa el ULTIMO (no el primero) por el
 * mismo motivo defensivo que extractLastRunnerResultJsonLine()
 * (src/core/runner-result-parser.ts): es la garantia mas robusta de "el
 * resultado final de esta ejecucion", aunque en la practica
 * run-claude-sdk.ts corta el stream en el primer mensaje "result" que
 * ve.
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

export interface RecoveredV2Result {
  /** El texto EXACTO extraido del campo `result` del mensaje final -- nunca reescrito ni "reparado". Esto es lo que se escribe tal cual en expectedV2OutputPath. */
  rawResultText: string;
  /** Solo para verificacion temprana en este mismo step -- la validacion "oficial" (fail-closed real) la sigue haciendo el paso 2 del runner sobre expectedV2OutputPath, sin cambios. */
  output: LandingArchitectV2Output;
}

/**
 * Punto de entrada del fallback: dado el contenido crudo (string) de un
 * execution_file y el JSON Schema versionado (config/landing-architect-v2-output.schema.json,
 * ya parseado -- lo lee/pasa el caller, este modulo sigue sin hacer I/O
 * propio), devuelve el texto de respuesta de Claude YA verificado como
 * JSON valido, conforme al schema (mismo contrato que --json-schema,
 * INCLUIDO additionalProperties: false) y con la forma de
 * LandingArchitectV2Output -- o lanza con un motivo especifico y
 * distinguible para cada modo de fallo:
 *   - execution_file no es JSON valido, o no es un array.
 *   - no hay ningun mensaje final de tipo "result" (nada recuperable).
 *   - el mensaje final indica un fallo real de Claude (is_error / subtype != "success").
 *   - el campo `result` no es un string no vacio.
 *   - el texto de `result` no es JSON valido (ni con fence ni sin el).
 *   - el JSON no cumple config/landing-architect-v2-output.schema.json
 *     (p.ej. un campo no declarado, top-level o anidado -- ver tests).
 *   - el JSON no cumple la forma de LandingArchitectV2Output.
 */
export function recoverV2OutputFromExecutionFile(rawExecutionFileContent: string, outputSchema: JsonSchemaLite): RecoveredV2Result {
  let messages: unknown;
  try {
    messages = JSON.parse(rawExecutionFileContent);
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
    throw new Error(`El JSON recuperado del execution_file no cumple config/landing-architect-v2-output.schema.json (el mismo contrato que exige --json-schema en el caso A): ${schemaErrors.join("; ")}`);
  }

  const output = validateV2Output(parsed);

  return { rawResultText: resultMessage.result, output };
}
