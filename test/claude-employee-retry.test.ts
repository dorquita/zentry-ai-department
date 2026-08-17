import * as assert from "node:assert/strict";
import { classifyClaudeEmployeeFailure, isRetryableFailureClass, ClaudeEmployeeFailureClass } from "../src/core/claude-employee-retry";
import { resolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { JsonSchemaLite } from "../src/core/json-schema-lite";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Schema generico minimo (mismo espiritu que el de
 * test/claude-employee-runtime.test.ts): estos tests NO deben depender
 * del schema de ningun empleado concreto -- el runtime comun no conoce
 * ningun dominio.
 */
const GENERIC_SCHEMA: JsonSchemaLite = {
  type: "object",
  additionalProperties: false,
  properties: { summary: { type: "string" }, score: { type: "number" } },
  required: ["summary", "score"],
};

const VALID_OUTPUT = { summary: "ok", score: 1 };

/** Construye el contenido de un execution_file tal y como lo escribe claude-code-action: un array de SDKMessages. */
function executionFile(resultText: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    { type: "system", subtype: "init" },
    { type: "result", subtype: "success", is_error: false, result: typeof resultText === "string" ? resultText : JSON.stringify(resultText), ...overrides },
  ]);
}

/** Captura el error que lanza resolveClaudeEmployeeOutput() para poder clasificarlo -- exactamente lo que hace el wrapper de CI. */
function failureOf(params: { structuredOutput?: string; executionFileContent?: string }): unknown {
  try {
    resolveClaudeEmployeeOutput({ structuredOutput: params.structuredOutput, executionFileContent: params.executionFileContent, outputSchema: GENERIC_SCHEMA });
  } catch (err) {
    return err;
  }
  throw new Error("Se esperaba que resolveClaudeEmployeeOutput() lanzara, pero resolvio correctamente.");
}

export function runClaudeEmployeeRetryTests(): TestCase[] {
  return [
    // --- Clases reintentables: variabilidad real del modelo/servicio ---
    {
      name: "C (error transitorio): salida del modelo que viola el schema se clasifica como reintentable",
      fn: () => {
        const err = failureOf({ executionFileContent: executionFile({ summary: "falta score" }) });
        const c = classifyClaudeEmployeeFailure(err);
        assert.equal(c.failureClass, "model_output_schema_violation");
        assert.equal(c.retryable, true);
      },
    },
    {
      name: "C (error transitorio): texto del modelo que no es JSON parseable se clasifica como reintentable",
      fn: () => {
        const err = failureOf({ executionFileContent: executionFile("esto no es JSON, es prosa") });
        assert.ok(err instanceof SyntaxError, "el runtime debe seguir propagando SyntaxError para el texto del modelo");
        const c = classifyClaudeEmployeeFailure(err);
        assert.equal(c.failureClass, "model_output_unparseable");
        assert.equal(c.retryable, true);
      },
    },
    {
      name: "C (error transitorio): ni structured_output ni execution_file (caso C) se clasifica como reintentable",
      fn: () => {
        const c = classifyClaudeEmployeeFailure(failureOf({}));
        assert.equal(c.failureClass, "no_output_delivered");
        assert.equal(c.retryable, true);
      },
    },
    {
      name: "C (error transitorio): mensaje final sin campo `result` de texto se clasifica como reintentable",
      fn: () => {
        const content = JSON.stringify([{ type: "result", subtype: "success", is_error: false, result: "   " }]);
        const c = classifyClaudeEmployeeFailure(failureOf({ executionFileContent: content }));
        assert.equal(c.failureClass, "no_output_delivered");
        assert.equal(c.retryable, true);
      },
    },
    {
      name: "C (error transitorio): fallo real de Claude reportado por el SDK (subtype != success) se clasifica como reintentable",
      fn: () => {
        const content = JSON.stringify([{ type: "result", subtype: "error_max_structured_output_retries", is_error: true }]);
        const c = classifyClaudeEmployeeFailure(failureOf({ executionFileContent: content }));
        assert.equal(c.failureClass, "claude_run_failed");
        assert.equal(c.retryable, true);
      },
    },

    // --- Clases NO reintentables: reintentar solo gastaria cuota y taparia un bug ---
    {
      name: "D (error NO transitorio): execution_file corrupto es infraestructura -- NUNCA se reintenta",
      fn: () => {
        const c = classifyClaudeEmployeeFailure(failureOf({ executionFileContent: "esto no es un JSON de execution_file" }));
        assert.equal(c.failureClass, "infrastructure");
        assert.equal(c.retryable, false);
      },
    },
    {
      name: "D (error NO transitorio): execution_file que no es un array de mensajes SDK es infraestructura -- NUNCA se reintenta",
      fn: () => {
        const c = classifyClaudeEmployeeFailure(failureOf({ executionFileContent: JSON.stringify({ not: "an array" }) }));
        assert.equal(c.failureClass, "infrastructure");
        assert.equal(c.retryable, false);
      },
    },
    {
      name: "D (error NO transitorio): un fallo NO clasificable nunca se reintenta (fail-closed)",
      fn: () => {
        const c = classifyClaudeEmployeeFailure(new Error("BLOCKED_BY_AUTH: falta CLAUDE_CODE_OAUTH_TOKEN"));
        assert.equal(c.failureClass, "unknown");
        assert.equal(c.retryable, false);
        assert.match(c.reason, /fail-closed/i);
      },
    },
    {
      name: "D (error NO transitorio): un fallo de configuracion de schema no se reintenta",
      fn: () => {
        const c = classifyClaudeEmployeeFailure(new Error('El JSON Schema usa la keyword no soportada "oneOf"'));
        assert.equal(c.retryable, false);
      },
    },
    {
      name: "isRetryableFailureClass: la tabla de clases reintentables es exactamente la esperada (ninguna clase de infraestructura o desconocida entra)",
      fn: () => {
        const expected: Record<ClaudeEmployeeFailureClass, boolean> = {
          model_output_unparseable: true,
          model_output_schema_violation: true,
          no_output_delivered: true,
          claude_run_failed: true,
          infrastructure: false,
          unknown: false,
        };
        for (const [cls, retryable] of Object.entries(expected)) {
          assert.equal(isRetryableFailureClass(cls as ClaudeEmployeeFailureClass), retryable, `clase ${cls}`);
        }
      },
    },

    // --- El reintento no puede cambiar el contrato ---
    {
      name: "E (los intentos no mezclan salidas): una salida VALIDA nunca se clasifica -- resolver no lanza y no hay reintento que decidir",
      fn: () => {
        const resolved = resolveClaudeEmployeeOutput({
          structuredOutput: undefined,
          executionFileContent: executionFile(VALID_OUTPUT),
          outputSchema: GENERIC_SCHEMA,
        });
        assert.equal(resolved.source, "execution_file_fallback");
        assert.deepEqual(resolved.parsed, VALID_OUTPUT);
      },
    },
    {
      name: "E (los intentos no mezclan salidas): el intento reintentado se valida contra el MISMO schema, sin relajarlo",
      fn: () => {
        // Simula el intento 2: su salida tambien tiene que cumplir el
        // schema. Que exista un reintento no puede convertirse nunca en
        // "la segunda vez vale con menos".
        const err = failureOf({ executionFileContent: executionFile({ summary: "sigue faltando score" }) });
        assert.match(String((err as Error).message), /no cumple el JSON Schema versionado/);
        assert.equal(classifyClaudeEmployeeFailure(err).retryable, true);
      },
    },
  ];
}
