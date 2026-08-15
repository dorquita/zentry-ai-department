import * as assert from "node:assert/strict";
import { extractFinalResultMessage, extractJsonFromModelResponse, resolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { JsonSchemaLite } from "../src/core/json-schema-lite";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Schema de un "empleado Claude" FICTICIO, deliberadamente sin ninguna
 * relacion con ux-ui-landing-architect-v2 (nada de hero/FAQ/CTA) -- para
 * demostrar que src/core/claude-employee-runtime.ts no depende de
 * ningun concepto de dominio concreto. Misma forma de schema
 * (draft-07, additionalProperties:false, $ref/definitions) que
 * config/landing-architect-v2-output.schema.json, pero con campos de
 * negocio completamente distintos.
 */
const GENERIC_EMPLOYEE_SCHEMA: JsonSchemaLite = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    score: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
    details: { $ref: "#/definitions/details" },
  },
  required: ["summary", "score", "tags", "details"],
  definitions: {
    details: {
      type: "object",
      additionalProperties: false,
      properties: {
        note: { type: "string" },
      },
      required: ["note"],
    },
  },
};

function validGenericOutput(): Record<string, unknown> {
  return {
    summary: "Resultado de ejemplo del empleado ficticio.",
    score: 0.9,
    tags: ["ejemplo", "ficticio"],
    details: { note: "Nota de ejemplo." },
  };
}

function messagesWithResult(resultOverrides: Record<string, unknown> = {}): unknown[] {
  return [
    { type: "system", subtype: "init", message: "Claude Code initialized", model: "claude-sonnet-5" },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "(texto intermedio, no es el resultado final)" }] }, parent_tool_use_id: null, uuid: "a1", session_id: "s1" },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 12345,
      num_turns: 1,
      total_cost_usd: 0.01,
      permission_denials_count: 0,
      result: JSON.stringify(validGenericOutput()),
      uuid: "r1",
      session_id: "s1",
      ...resultOverrides,
    },
  ];
}

export function runClaudeEmployeeRuntimeTests(): TestCase[] {
  return [
    // --- extractJsonFromModelResponse (generico -- movido desde landing-architect-comparison.ts) ---
    {
      name: "extractJsonFromModelResponse parsea JSON sin fences",
      fn: () => {
        const result = extractJsonFromModelResponse('{"a": 1}');
        assert.deepEqual(result, { a: 1 });
      },
    },
    {
      name: "extractJsonFromModelResponse quita un fence ```json ... ``` (caso real observado en la ejecucion via Agent tool)",
      fn: () => {
        const raw = '```json\n{"a": 1, "b": [1, 2]}\n```';
        const result = extractJsonFromModelResponse(raw);
        assert.deepEqual(result, { a: 1, b: [1, 2] });
      },
    },
    {
      name: "extractJsonFromModelResponse quita un fence generico sin la etiqueta 'json'",
      fn: () => {
        const raw = '```\n{"a": 1}\n```';
        const result = extractJsonFromModelResponse(raw);
        assert.deepEqual(result, { a: 1 });
      },
    },
    {
      name: "extractJsonFromModelResponse tolera espacio en blanco alrededor del fence",
      fn: () => {
        const raw = '  \n```json\n  {"a": 1}  \n```\n  ';
        const result = extractJsonFromModelResponse(raw);
        assert.deepEqual(result, { a: 1 });
      },
    },
    {
      name: "extractJsonFromModelResponse falla (fail-closed) con texto que no es JSON, con o sin fence",
      fn: () => {
        assert.throws(() => extractJsonFromModelResponse("esto no es JSON"));
        assert.throws(() => extractJsonFromModelResponse("```json\nesto tampoco\n```"));
      },
    },
    {
      name: 'REGRESION (run 31884785206 sem-specialist / run 31884787140 growth-director-v2, ambos "SyntaxError: Expected \',\' or \'}\' after property value"): extractJsonFromModelResponse falla (fail-closed, no repara) cuando un valor string contiene una comilla doble SIN escapar',
      fn: () => {
        const rawWithUnescapedQuote = '{"summary": "el termino "biometrico" genera confusion en el anuncio"}';
        assert.throws(() => extractJsonFromModelResponse(rawWithUnescapedQuote), SyntaxError);
      },
    },
    {
      name: "REGRESION: extractJsonFromModelResponse falla con prosa ANTES del objeto JSON, sin fence que la envuelva",
      fn: () => {
        const rawWithLeadingProse = 'Aqui tienes el analisis solicitado:\n{"a": 1}';
        assert.throws(() => extractJsonFromModelResponse(rawWithLeadingProse), SyntaxError);
      },
    },
    {
      name: "REGRESION: extractJsonFromModelResponse falla con prosa DESPUES del objeto JSON, sin fence que la envuelva",
      fn: () => {
        const rawWithTrailingProse = '{"a": 1}\nEspero que este analisis te sea util.';
        assert.throws(() => extractJsonFromModelResponse(rawWithTrailingProse), SyntaxError);
      },
    },
    {
      name: "REGRESION: extractJsonFromModelResponse falla con JSON truncado/incorrecto (estructura sin cerrar)",
      fn: () => {
        const truncated = '{"summary": "texto", "campaignFindings": [{"title": "x", "description": "y"';
        assert.throws(() => extractJsonFromModelResponse(truncated), SyntaxError);
      },
    },
    {
      name: "output JSON valido exacto (sin fence, sin prosa, estructuras cerradas) -> extractJsonFromModelResponse NO lanza",
      fn: () => {
        const validExact = '{"summary": "texto valido", "campaignFindings": [{"title": "x", "description": "y", "evidenceRefs": [], "severity": "low"}], "unknowns": []}';
        assert.doesNotThrow(() => extractJsonFromModelResponse(validExact));
      },
    },

    // --- extractFinalResultMessage (generico) ---
    {
      name: "extractFinalResultMessage encuentra el mensaje final de tipo result entre mensajes intermedios",
      fn: () => {
        const result = extractFinalResultMessage(messagesWithResult());
        assert.equal(result.type, "result");
        assert.equal(result.subtype, "success");
      },
    },
    {
      name: "extractFinalResultMessage usa el ULTIMO mensaje de tipo result si aparece mas de uno",
      fn: () => {
        const messages = [...messagesWithResult({ result: JSON.stringify({ ...validGenericOutput(), summary: "version vieja" }) }), { type: "result", subtype: "success", is_error: false, result: JSON.stringify({ ...validGenericOutput(), summary: "version final" }) }];
        const result = extractFinalResultMessage(messages);
        assert.match(String(result.result), /version final/);
      },
    },
    {
      name: "extractFinalResultMessage (fail-closed) lanza si no hay ningun mensaje de tipo result",
      fn: () => {
        assert.throws(() => extractFinalResultMessage([{ type: "system", subtype: "init" }]), /no se encontro ningun mensaje final de tipo "result"/);
      },
    },
    {
      name: "extractFinalResultMessage (fail-closed) lanza si el input no es un array",
      fn: () => {
        assert.throws(() => extractFinalResultMessage({ not: "an array" }), /se esperaba un array/);
      },
    },

    // --- resolveClaudeEmployeeOutput: CASO A (structured_output valido) ---
    // Usa el schema del "empleado ficticio" (GENERIC_EMPLOYEE_SCHEMA, sin
    // relacion con Landing Architect) para demostrar que el runtime no
    // depende de ningun dominio concreto.
    {
      name: "CASO A: structured_output presente y valido -> se usa directamente, source=structured_output",
      fn: () => {
        const structuredOutput = JSON.stringify(validGenericOutput());
        const resolved = resolveClaudeEmployeeOutput({ structuredOutput, executionFileContent: undefined, outputSchema: GENERIC_EMPLOYEE_SCHEMA });
        assert.equal(resolved.source, "structured_output");
        assert.equal(resolved.rawText, structuredOutput);
        assert.deepEqual(resolved.parsed, validGenericOutput());
      },
    },
    {
      name: "CASO A: structured_output presente pero incumple el schema (additionalProperties top-level) -> falla, NO cae al fallback aunque execution_file sea valido",
      fn: () => {
        const withExtra = { ...validGenericOutput(), unexpectedField: "no deberia aceptarse" };
        const executionFileContent = JSON.stringify(messagesWithResult());
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: JSON.stringify(withExtra), executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA }), /unexpectedField/);
      },
    },

    // --- resolveClaudeEmployeeOutput: CASO B (fallback via execution_file) ---
    {
      name: "CASO B: structured_output ausente + execution_file con resultado valido -> se recupera del execution_file, source=execution_file_fallback",
      fn: () => {
        const executionFileContent = JSON.stringify(messagesWithResult());
        const resolved = resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA });
        assert.equal(resolved.source, "execution_file_fallback");
        assert.deepEqual(resolved.parsed, validGenericOutput());
      },
    },
    {
      name: "CASO B: structured_output vacio (cadena vacia, no undefined) tambien activa el fallback",
      fn: () => {
        const executionFileContent = JSON.stringify(messagesWithResult());
        const resolved = resolveClaudeEmployeeOutput({ structuredOutput: "", executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA });
        assert.equal(resolved.source, "execution_file_fallback");
      },
    },
    {
      name: "CASO B: tolera un fence ```json ... ``` en el campo result del execution_file",
      fn: () => {
        const fenced = "```json\n" + JSON.stringify(validGenericOutput()) + "\n```";
        const executionFileContent = JSON.stringify(messagesWithResult({ result: fenced }));
        const resolved = resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA });
        assert.deepEqual(resolved.parsed, validGenericOutput());
      },
    },

    // --- resolveClaudeEmployeeOutput: CASO C (fallo real, nada recuperable) ---
    {
      name: "CASO C: ni structured_output ni execution_file -> falla explicitamente",
      fn: () => {
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: undefined, outputSchema: GENERIC_EMPLOYEE_SCHEMA }), /no recuperable \(caso C\)/);
      },
    },
    {
      name: "CASO C: execution_file con subtype distinto de success (p.ej. error_max_structured_output_retries) -> falla, no se recupera nada",
      fn: () => {
        const executionFileContent = JSON.stringify(messagesWithResult({ subtype: "error_max_structured_output_retries", is_error: undefined, result: undefined }));
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA }), /Fallo real de Claude/);
      },
    },
    {
      name: "CASO C: execution_file con is_error true -> falla aunque subtype sea success",
      fn: () => {
        const executionFileContent = JSON.stringify(messagesWithResult({ is_error: true }));
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA }), /Fallo real de Claude/);
      },
    },

    // --- resolveClaudeEmployeeOutput: JSON invalido / incumplimiento de schema en el fallback ---
    {
      name: "JSON invalido en execution_file (el propio fichero no es JSON) -> falla",
      fn: () => {
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: "esto no es JSON", outputSchema: GENERIC_EMPLOYEE_SCHEMA }), /no es JSON valido/);
      },
    },
    {
      name: "JSON invalido en el campo result (no parseable ni con fence) -> falla",
      fn: () => {
        const executionFileContent = JSON.stringify(messagesWithResult({ result: "esto no es JSON en absoluto" }));
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA }));
      },
    },
    {
      name: "JSON valido pero incumple el schema (falta un campo requerido) -> falla",
      fn: () => {
        const incomplete = { ...validGenericOutput() } as Record<string, unknown>;
        delete incomplete.score;
        const executionFileContent = JSON.stringify(messagesWithResult({ result: JSON.stringify(incomplete) }));
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA }), /score/);
      },
    },
    {
      name: "additionalProperties TOP-LEVEL no declarado en el schema -> falla en el fallback igual que en structured_output",
      fn: () => {
        const withExtra = { ...validGenericOutput(), unexpectedField: "esto no debe aceptarse" };
        const executionFileContent = JSON.stringify(messagesWithResult({ result: JSON.stringify(withExtra) }));
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA }), /unexpectedField/);
      },
    },
    {
      name: "additionalProperties ANIDADO (dentro de 'details') no declarado en el schema -> falla igual que el top-level",
      fn: () => {
        const withNestedExtra = { ...validGenericOutput(), details: { note: "nota", extra: "campo anidado no declarado" } };
        const executionFileContent = JSON.stringify(messagesWithResult({ result: JSON.stringify(withNestedExtra) }));
        assert.throws(
          () => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent, outputSchema: GENERIC_EMPLOYEE_SCHEMA }),
          (err: unknown) => err instanceof Error && /\$\.details/.test(err.message) && /"extra"/.test(err.message)
        );
      },
    },
  ];
}
