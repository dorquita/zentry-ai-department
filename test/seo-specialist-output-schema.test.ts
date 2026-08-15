import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateSeoSpecialistOutput } from "../src/employees/seo-specialist/domain";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre config/seo-specialist-output.schema.json
 * (el JSON Schema que se pasa a claude-code-action via --json-schema, ver
 * .github/workflows/seo-specialist.yml) y la interfaz TypeScript
 * SeoSpecialistOutput / validateSeoSpecialistOutput()
 * (src/employees/seo-specialist/domain.ts).
 *
 * Mismo principio que test/landing-architect-v2-output-schema.test.ts:
 * sin libreria de validacion de JSON Schema instalada, se corren los
 * MISMOS fixtures contra las DOS capas (el mini-validador de
 * src/core/json-schema-lite.ts sobre el JSON Schema, y
 * validateSeoSpecialistOutput() sobre la interfaz TypeScript real) y se
 * exige que coincidan para los casos estructurales.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "seo-specialist-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    executiveSummary: "Resumen de ejemplo.",
    findings: [],
    opportunities: [],
    technicalIssues: [],
    contentGaps: [],
    internalLinkRecommendations: [],
    prioritizedActions: [],
    evidence: [],
    unknowns: ["No hay datos suficientes."],
  };
}

function loadFixtureOutput(): Record<string, unknown> {
  const fixturePath = path.join(__dirname, "fixtures", "seo-specialist-output-example.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as Record<string, unknown>;
}

export function runSeoSpecialistOutputSchemaTests(): TestCase[] {
  const schema = loadSchema();

  return [
    {
      name: "el schema es JSON valido y declara draft-07",
      fn: () => {
        assert.equal(schema.type, "object");
        assert.equal((schema as unknown as { $schema: string }).$schema, "http://json-schema.org/draft-07/schema#");
      },
    },
    {
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- se embebe tal cual dentro de --json-schema entre comillas simples de shell",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "seo-specialist-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio");
      },
    },
    {
      name: "salida minima valida (arrays vacios): acepta tanto el mini-validador del JSON Schema como validateSeoSpecialistOutput()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateSeoSpecialistOutput(output));
      },
    },
    {
      name: "fixture sanitizado completo (con todos los tipos de item poblados) acepta ambas capas por igual",
      fn: () => {
        const output = loadFixtureOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateSeoSpecialistOutput(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (executiveSummary) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.executiveSummary;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar executiveSummary como requerido y ausente");
        assert.throws(() => validateSeoSpecialistOutput(output), /executiveSummary/);
      },
    },
    {
      name: "DRIFT: falta un campo requerido (evidence) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.evidence;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar evidence como requerido y ausente");
        assert.throws(() => validateSeoSpecialistOutput(output), /evidence/);
      },
    },
    {
      name: "DRIFT: enum invalido (findings[0].category fuera del enum permitido) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        output.findings = [{ id: "f1", category: "not_a_real_category", description: "x", basis: "inference", evidenceRefs: [] }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar una category fuera del enum");
        assert.throws(() => validateSeoSpecialistOutput(output), /findings/);
      },
    },
    {
      name: "DRIFT: enum invalido (basis fuera de evidence|inference) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        output.findings = [{ id: "f1", category: "technical", description: "x", basis: "maybe", evidenceRefs: [] }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un basis fuera del enum");
        assert.throws(() => validateSeoSpecialistOutput(output), /findings/);
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo TOP-LEVEL no declarado en el contrato",
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
      name: "el schema (additionalProperties: false) rechaza un campo ANIDADO no declarado (evidence[0].extra)",
      fn: () => {
        const output = minimalValidOutput();
        output.evidence = [{ id: "ev-1", source: "job_data", description: "x", extra: "campo no declarado" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar evidence[0].extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "campos opcionales (page/relatedKeyword) ausentes del todo siguen siendo una salida valida en ambas capas",
      fn: () => {
        const output = minimalValidOutput();
        output.opportunities = [{ id: "o1", keyword: "kw", kind: "quick_win", priority: "low", recommendedAction: "x", rationale: "y", basis: "inference", evidenceRefs: [] }];
        assert.ok(!("page" in (output.opportunities as Array<Record<string, unknown>>)[0]));
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, []);
        assert.doesNotThrow(() => validateSeoSpecialistOutput(output));
      },
    },
  ];
}
