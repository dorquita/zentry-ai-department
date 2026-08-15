import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { assertJsonSchemaLiteSupported } from "../src/core/json-schema-lite";

export interface TestCase {
  name: string;
  fn: () => void;
}

const LANDING_ARCHITECT_V2_SCHEMA_PATH = path.join(__dirname, "..", "config", "landing-architect-v2-output.schema.json");

function loadLandingArchitectV2Schema(): unknown {
  return JSON.parse(fs.readFileSync(LANDING_ARCHITECT_V2_SCHEMA_PATH, "utf-8"));
}

/**
 * Tests de assertJsonSchemaLiteSupported() -- el preflight fail-closed
 * que impide que un schema con keywords de JSON Schema no implementadas
 * por json-schema-lite (p.ej. minLength, pattern, oneOf) rompa la
 * paridad entre caso A (--json-schema) y caso B (fallback via
 * execution_file). Ver src/core/json-schema-lite.ts para el porque.
 */
export function runJsonSchemaLiteTests(): TestCase[] {
  return [
    {
      name: "el schema real de landing-architect-v2 (con $schema/$id/title/description a nivel raiz) pasa sin cambios",
      fn: () => {
        assert.doesNotThrow(() => assertJsonSchemaLiteSupported(loadLandingArchitectV2Schema()));
      },
    },
    {
      name: "un schema minimo con solo keywords soportadas (type/properties/required/additionalProperties) pasa",
      fn: () => {
        assert.doesNotThrow(() =>
          assertJsonSchemaLiteSupported({
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              status: { type: "string", enum: ["ok", "warn"] },
            },
            required: ["summary"],
          }),
        );
      },
    },
    {
      name: "un schema con $ref/definitions (patron real usado por landing-architect-v2) pasa",
      fn: () => {
        assert.doesNotThrow(() =>
          assertJsonSchemaLiteSupported({
            type: "object",
            additionalProperties: false,
            properties: { cta: { $ref: "#/definitions/cta" } },
            required: ["cta"],
            definitions: {
              cta: {
                type: "object",
                additionalProperties: false,
                properties: { label: { type: "string" } },
                required: ["label"],
              },
            },
          }),
        );
      },
    },
    {
      name: "keyword desconocida TOP-LEVEL (p.ej. minLength) falla, no se ignora en silencio",
      fn: () => {
        assert.throws(
          () =>
            assertJsonSchemaLiteSupported({
              type: "string",
              minLength: 5,
            }),
          /keyword de JSON Schema "minLength".*no esta soportada/,
        );
      },
    },
    {
      name: "keyword desconocida ANIDADA (dentro de properties) falla",
      fn: () => {
        assert.throws(
          () =>
            assertJsonSchemaLiteSupported({
              type: "object",
              properties: {
                slug: { type: "string", pattern: "^[a-z-]+$" },
              },
            }),
          /keyword de JSON Schema "pattern" \(en \$\.properties\.slug\)/,
        );
      },
    },
    {
      name: "keyword desconocida dentro de items falla",
      fn: () => {
        assert.throws(
          () =>
            assertJsonSchemaLiteSupported({
              type: "array",
              items: { type: "string", format: "uri" },
            }),
          /keyword de JSON Schema "format" \(en \$\.items\)/,
        );
      },
    },
    {
      name: "keyword desconocida dentro de definitions falla",
      fn: () => {
        assert.throws(
          () =>
            assertJsonSchemaLiteSupported({
              type: "object",
              properties: { cta: { $ref: "#/definitions/cta" } },
              definitions: {
                cta: { type: "object", oneOf: [{ type: "string" }] },
              },
            }),
          /keyword de JSON Schema "oneOf" \(en \$\.definitions\.cta\)/,
        );
      },
    },
    {
      name: "oneOf a nivel raiz falla explicitamente (no soportado, ni siquiera parcialmente)",
      fn: () => {
        assert.throws(() => assertJsonSchemaLiteSupported({ oneOf: [{ type: "string" }, { type: "number" }] }), /keyword de JSON Schema "oneOf"/);
      },
    },
    {
      name: "pattern a nivel raiz falla explicitamente",
      fn: () => {
        assert.throws(() => assertJsonSchemaLiteSupported({ type: "string", pattern: "^[a-z]+$" }), /keyword de JSON Schema "pattern"/);
      },
    },
  ];
}
