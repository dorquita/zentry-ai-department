import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateGrowthDirectorV2Output, GrowthDirectorV2Artifact } from "../src/employees/growth-director-v2/domain";
import { assertJsonSchemaLiteSupported, JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre
 * config/growth-director-v2-output.schema.json (el JSON Schema que se
 * pasa a claude-code-action via --json-schema, ver
 * .github/workflows/growth-director-v2.yml) y la interfaz TypeScript
 * GrowthDirectorV2Output / validateGrowthDirectorV2Output()
 * (src/employees/growth-director-v2/domain.ts).
 *
 * Mismo patron que test/landing-architect-v2-output-schema.test.ts: sin
 * libreria de validacion de JSON Schema instalada, se corren los MISMOS
 * fixtures contra las DOS capas (el mini-validador de
 * src/core/json-schema-lite.ts sobre el JSON Schema, y
 * validateGrowthDirectorV2Output() sobre la interfaz TypeScript real) y
 * se exige que coincidan para los casos estructurales.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "growth-director-v2-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    growthSummary: "Concentrar esfuerzo en SEO on-page.",
    currentSignals: [{ channel: "seo", description: "5 acciones vivas.", evidenceRefs: ["actions-live"] }],
    bottlenecks: [{ channel: "sem", description: "Sin datos SEM recientes.", evidenceRefs: ["dependency-sem-watcher"] }],
    opportunities: [{ channel: "seo", description: "1 change pack listo.", evidenceRefs: ["changepacks-ready"] }],
    experiments: [{ title: "Cerrar change pack SEO", hypothesis: "Reduce backlog abierto.", channel: "seo", successMetric: "change pack aprobado", evidenceRefs: ["changepacks-ready"] }],
    recommendedPriorities: [
      { title: "Revisar change pack SEO", rationale: "Unica pieza lista para avanzar.", impact: "medium", confidence: "high", effort: "low", dependsOn: ["revision humana"], evidenceRefs: ["changepacks-ready"] },
    ],
    dependencies: [{ name: "seo-specialist", status: "missing", note: "No existe todavia en este checkout." }],
    risks: [{ description: "Vision parcial sin SEM/Analytics.", severity: "medium", evidenceRefs: ["department-warnings"] }],
    evidence: [],
    unknowns: ["Estado real de SEM."],
  };
}

function loadFixtureOutput(): Record<string, unknown> {
  const fixturePath = path.join(__dirname, "fixtures", "growth-director-v2-example.json");
  const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as GrowthDirectorV2Artifact;
  assert.equal(artifact.result.status, "executed");
  if (artifact.result.status !== "executed") throw new Error("unreachable");
  return artifact.result.output as unknown as Record<string, unknown>;
}

export function runGrowthDirectorV2OutputSchemaTests(): TestCase[] {
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
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- .github/workflows/growth-director-v2.yml lo embebe tal cual dentro de --json-schema '...' (comillas simples de shell)",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "growth-director-v2-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio (rompe --json-schema '...' en el workflow)");
      },
    },
    {
      // Reutiliza el MISMO preflight que corre el runtime comun antes de
      // invocar a Claude (ver scripts/assert-json-schema-lite-compatible-for-ci.ts,
      // .github/actions/claude-employee-runtime/action.yml) -- no
      // reimplementa su propio recorrido de claves (un recorrido
      // generico confundiria nombres de PROPIEDAD del contrato, p.ej.
      // "growthSummary", con keywords reales de JSON Schema, que solo
      // aparecen en posiciones concretas del arbol).
      name: "el schema solo usa keywords soportadas por json-schema-lite.ts (assertJsonSchemaLiteSupported no lanza)",
      fn: () => {
        assert.doesNotThrow(() => assertJsonSchemaLiteSupported(schema));
      },
    },
    {
      name: "salida minima valida: acepta tanto el mini-validador del JSON Schema como validateGrowthDirectorV2Output()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateGrowthDirectorV2Output(output));
      },
    },
    {
      name: "fixture sanitizado completo acepta ambas capas por igual",
      fn: () => {
        const output = loadFixtureOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateGrowthDirectorV2Output(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (growthSummary) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.growthSummary;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar growthSummary como requerido y ausente");
        assert.throws(() => validateGrowthDirectorV2Output(output), /growthSummary/);
      },
    },
    {
      name: "DRIFT: tipo incorrecto (recommendedPriorities[0].dependsOn como string en vez de array) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.recommendedPriorities as Array<Record<string, unknown>>)[0].dependsOn = "no es un array";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar dependsOn no array");
        assert.throws(() => validateGrowthDirectorV2Output(output), /dependsOn/);
      },
    },
    {
      name: "DRIFT: enum invalido (currentSignals[0].channel fuera de los 9 canales permitidos) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.currentSignals as Array<Record<string, unknown>>)[0].channel = "not_a_real_channel";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un channel fuera del enum");
        assert.throws(() => validateGrowthDirectorV2Output(output), /channel/);
      },
    },
    {
      name: "DRIFT: enum invalido (recommendedPriorities[0].impact fuera de high/medium/low) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.recommendedPriorities as Array<Record<string, unknown>>)[0].impact = "extreme";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un impact fuera del enum");
        assert.throws(() => validateGrowthDirectorV2Output(output), /impact/);
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
      name: "el schema (additionalProperties: false) rechaza un campo anidado no declarado (recommendedPriorities[0].extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.recommendedPriorities as Array<Record<string, unknown>>)[0].extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar recommendedPriorities[0].extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "arrays vacios (currentSignals/bottlenecks/opportunities/experiments/recommendedPriorities/dependencies/risks/evidence/unknowns) siguen siendo una salida valida en ambas capas",
      fn: () => {
        const output = {
          growthSummary: "Contexto insuficiente: no hay pasada de departamento reciente ni dependencias disponibles.",
          currentSignals: [],
          bottlenecks: [],
          opportunities: [],
          experiments: [],
          recommendedPriorities: [],
          dependencies: [],
          risks: [],
          evidence: [],
          unknowns: ["No hay ningun dato de departamento disponible todavia."],
        };
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, []);
        assert.doesNotThrow(() => validateGrowthDirectorV2Output(output));
      },
    },
  ];
}
