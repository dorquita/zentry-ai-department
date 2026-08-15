import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateSemSpecialistOutput } from "../src/employees/sem-specialist/sem-specialist-output";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre config/sem-specialist-output.schema.json
 * (el JSON Schema que se pasa a claude-code-action via --json-schema, ver
 * .github/workflows/sem-specialist.yml) y la interfaz TypeScript
 * SemSpecialistOutput / validateSemSpecialistOutput()
 * (src/employees/sem-specialist/sem-specialist-output.ts).
 *
 * Mismo principio que test/landing-architect-v2-output-schema.test.ts:
 * sin libreria de validacion de JSON Schema instalada, asi que en vez de
 * mantener dos contratos sincronizados a mano, este test corre los MISMOS
 * fixtures contra las DOS capas (el mini-validador de
 * src/core/json-schema-lite.ts sobre el JSON Schema, y
 * validateSemSpecialistOutput() sobre la interfaz TypeScript real) y
 * exige que coincidan para los casos estructurales.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "sem-specialist-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    summary: "Resumen minimo de ejemplo.",
    campaignFindings: [{ title: "t", description: "d", evidenceRefs: [], severity: "info" }],
    searchTermOpportunities: [],
    negativeKeywordRecommendations: [],
    budgetObservations: [],
    biddingObservations: [],
    adLandingAlignment: [],
    conversionRiskFindings: [],
    prioritizedExperiments: [{ title: "t", hypothesis: "h", expectedImpact: "e", evidenceRefs: [], priority: "low" }],
    evidence: [{ id: "ev-1", contextField: "campaignStatus", value: "PAUSED" }],
    unknowns: ["algun unknown de ejemplo"],
  };
}

function loadFixtureOutput(): Record<string, unknown> {
  const fixturePath = path.join(__dirname, "fixtures", "sem-specialist-output-example.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as Record<string, unknown>;
}

export function runSemSpecialistOutputSchemaTests(): TestCase[] {
  const schema = loadSchema();

  return [
    {
      name: "el schema es JSON valido y declara draft-07 (el SDK de Claude Agent rechaza drafts mas nuevos)",
      fn: () => {
        assert.equal(schema.type, "object");
        assert.equal((schema as unknown as { $schema: string }).$schema, "http://json-schema.org/draft-07/schema#");
      },
    },
    {
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- se embebe entre comillas simples de shell en --json-schema dentro del workflow",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "sem-specialist-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio (rompe --json-schema '...' en el workflow)");
      },
    },
    {
      name: "salida minima valida: acepta tanto el mini-validador del JSON Schema como validateSemSpecialistOutput()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateSemSpecialistOutput(output));
      },
    },
    {
      name: "fixture sanitizado realista (con todas las categorias) acepta ambas capas por igual",
      fn: () => {
        const output = loadFixtureOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateSemSpecialistOutput(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (summary) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.summary;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar summary como requerido y ausente");
        assert.throws(() => validateSemSpecialistOutput(output), /summary/);
      },
    },
    {
      name: "DRIFT: falta un campo requerido a nivel de finding anidado (severity) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete (output.campaignFindings as Array<Record<string, unknown>>)[0].severity;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar severity como requerido y ausente");
        assert.throws(() => validateSemSpecialistOutput(output), /campaignFindings/);
      },
    },
    {
      name: "DRIFT: enum invalido (severity fuera de los 4 valores permitidos) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.campaignFindings as Array<Record<string, unknown>>)[0].severity = "urgentisimo";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un severity fuera del enum");
        assert.throws(() => validateSemSpecialistOutput(output), /campaignFindings/);
      },
    },
    {
      name: "DRIFT: enum invalido (priority de un experiment fuera de los 3 valores permitidos) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.prioritizedExperiments as Array<Record<string, unknown>>)[0].priority = "urgentisima";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un priority fuera del enum");
        assert.throws(() => validateSemSpecialistOutput(output), /prioritizedExperiments/);
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo top-level no declarado en el contrato",
      fn: () => {
        const output = { ...minimalValidOutput(), unexpectedField: "no deberia estar aqui" };
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("unexpectedField")),
          `el schema deberia rechazar la propiedad no declarada, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo anidado no declarado dentro de un finding",
      fn: () => {
        const output = minimalValidOutput();
        (output.campaignFindings as Array<Record<string, unknown>>)[0].extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar campaignFindings[0].extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo anidado no declarado dentro de una evidenceItem",
      fn: () => {
        const output = minimalValidOutput();
        (output.evidence as Array<Record<string, unknown>>)[0].extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar evidence[0].extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
  ];
}
