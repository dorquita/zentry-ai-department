import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateContentStrategistOutput } from "../src/employees/content-strategist/output";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre config/content-strategist-output.schema.json
 * (el JSON Schema que se pasa a claude-code-action via --json-schema, ver
 * .github/workflows/content-strategist.yml) y la interfaz TypeScript
 * ContentStrategistOutput / validateContentStrategistOutput()
 * (src/employees/content-strategist/output.ts).
 *
 * Mismo patron que test/landing-architect-v2-output-schema.test.ts: sin
 * libreria de validacion de JSON Schema instalada, se corren los MISMOS
 * fixtures contra las DOS capas (src/core/json-schema-lite.ts sobre el
 * JSON Schema, y validateContentStrategistOutput() sobre la interfaz
 * TypeScript real) y se exige que coincidan para los casos
 * estructurales.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "content-strategist-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    contentOpportunity: { title: "Taquillas de melamina para colegios", summary: "Keyword con volumen sin pagina dedicada." },
    targetAudience: "Responsable de compras de un colegio que renueva vestuarios.",
    searchIntent: "commercial",
    commercialIntent: "Busca comparar materiales antes de pedir presupuesto.",
    angle: "Comparativa de materiales orientada a centros educativos.",
    contentType: "title_meta_improvement",
    targetBrand: "zentry",
    recommendedStructure: {
      h1: "Taquillas de melamina: guia para colegios",
      sections: [{ heading: "Que es taquillas melamina", level: "H2", purpose: "Definir el producto para quien no lo conoce." }],
    },
    ctaStrategy: { primaryCta: "Solicitar presupuesto sin compromiso", rationale: "Coherente con la intencion comercial detectada." },
    internalLinks: [{ anchorIdea: "taquillas colegios", targetDescription: "pagina de categoria taquillas colegios (sin URL confirmada)", isRealLink: false }],
    supportingEvidence: ['El brief de entrada asume que "taquillas melamina" sigue siendo relevante para zentry.'],
    priority: "medium",
    risksAndUnknowns: ["Posible canibalizacion con paginas ya existentes del mismo cluster."],
    reasoningNotes: ["Se prioriza la comparativa de materiales porque es la duda mas repetida en el cluster."],
  };
}

export function runContentStrategistOutputSchemaTests(): TestCase[] {
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
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- .github/workflows/content-strategist.yml lo embebe tal cual dentro de --json-schema '...' (comillas simples de shell)",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "content-strategist-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio (rompe --json-schema '...' en el workflow)");
      },
    },
    {
      name: "salida minima valida: acepta tanto el mini-validador del JSON Schema como validateContentStrategistOutput()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateContentStrategistOutput(output));
      },
    },
    {
      name: "ctaStrategy.secondaryCta ausente sigue siendo una salida valida en ambas capas",
      fn: () => {
        const output = minimalValidOutput();
        assert.ok(!("secondaryCta" in (output.ctaStrategy as Record<string, unknown>)));
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, []);
        assert.doesNotThrow(() => validateContentStrategistOutput(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (contentOpportunity) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.contentOpportunity;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar contentOpportunity como requerido y ausente");
        assert.throws(() => validateContentStrategistOutput(output), /contentOpportunity/);
      },
    },
    {
      name: "DRIFT: tipo incorrecto (internalLinks[0].isRealLink como string en vez de boolean) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.internalLinks as Array<Record<string, unknown>>)[0].isRealLink = "yes";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar isRealLink no booleano");
        assert.throws(() => validateContentStrategistOutput(output), /internalLinks/);
      },
    },
    {
      name: "DRIFT: enum invalido (searchIntent fuera de los 4 valores permitidos) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        output.searchIntent = "not_a_real_intent";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un searchIntent fuera del enum");
        assert.throws(() => validateContentStrategistOutput(output), /searchIntent/);
      },
    },
    {
      name: "DRIFT: enum invalido (recommendedStructure.sections[0].level fuera de H2/H3) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.recommendedStructure as Record<string, unknown>).sections = [{ heading: "x", level: "H1", purpose: "y" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar level fuera de H2/H3");
        assert.throws(() => validateContentStrategistOutput(output), /recommendedStructure/);
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
      name: "el schema (additionalProperties: false) rechaza un campo ANIDADO no declarado (contentOpportunity.extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.contentOpportunity as Record<string, unknown>).extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar contentOpportunity.extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo ANIDADO no declarado dentro de un item de un array ($ref -- recommendedStructure.sections[0].extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.recommendedStructure as Record<string, unknown>).sections = [{ heading: "x", level: "H2", purpose: "y", extra: "no deberia estar aqui" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar sections[0].extra (via $ref a definitions.section), errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
  ];
}
