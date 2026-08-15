import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateV2Output, LandingArchitectComparisonArtifact } from "../src/core/landing-architect-comparison";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre config/landing-architect-v2-output.schema.json
 * (el JSON Schema que se pasa a claude-code-action via --json-schema, ver
 * .github/workflows/ux-ui-landing-architect-v2.yml) y la interfaz TypeScript
 * LandingArchitectV2Output / validateV2Output() (src/core/landing-architect-comparison.ts).
 *
 * No hay una libreria de validacion de JSON Schema instalada en este
 * proyecto (mismo principio que validateV2Output(): "sin librerias
 * externas"), asi que en vez de mantener dos contratos sincronizados a
 * mano, este test corre los MISMOS fixtures contra las DOS capas (el
 * mini-validador de src/core/json-schema-lite.ts sobre el JSON Schema,
 * y validateV2Output() sobre la interfaz TypeScript real) y exige que
 * coincidan para los casos estructurales (campo requerido ausente, tipo
 * incorrecto, enum invalido). Un cambio en una interfaz sin el
 * correspondiente cambio en el schema (o viceversa) deberia romper este
 * test.
 *
 * src/core/json-schema-lite.ts (no test/helpers/) porque el mismo
 * validador se reutiliza tambien en RUNTIME, no solo en tests -- ver
 * src/core/claude-employee-runtime.ts (resolveClaudeEmployeeOutput()),
 * el runtime comun de CUALQUIER empleado Claude, que lo usa para exigir
 * el mismo contrato (incluido additionalProperties: false) tanto si la
 * salida vino de `structured_output` (caso A) como si se recupero del
 * `execution_file` (caso B, fallback).
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "landing-architect-v2-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    hero: { headline: "Taquillas de melamina", subheadline: "Fabricacion a medida." },
    ctaPrimary: { label: "Solicitar presupuesto", target: "#solicitar-presupuesto", isRealLink: false },
    benefitBlocks: [{ title: "Fabricante directo", description: "Sin intermediarios." }],
    cards: [{ title: "Melamina", description: "Acabado calido." }],
    sections: [{ heading: "Modelos disponibles", body: "Texto de ejemplo.", searchIntent: "commercial" }],
    faq: [{ question: "¿Que garantia tiene?", answer: "Te lo confirmamos con tu presupuesto." }],
    finalCta: { headline: "Solicita presupuesto", cta: { label: "Solicitar presupuesto", target: "#solicitar-presupuesto", isRealLink: false } },
    internalLinks: [],
    visualHierarchyNotes: ["Un solo H1."],
    reasoningNotes: ["Nota de razonamiento de ejemplo."],
  };
}

function loadFixtureV2Output(): Record<string, unknown> {
  const fixturePath = path.join(__dirname, "fixtures", "landing-architect-comparison-example.json");
  const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as LandingArchitectComparisonArtifact;
  assert.equal(artifact.v2.status, "executed");
  if (artifact.v2.status !== "executed") throw new Error("unreachable");
  return artifact.v2.output as unknown as Record<string, unknown>;
}

export function runLandingArchitectV2OutputSchemaTests(): TestCase[] {
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
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- .github/workflows/ux-ui-landing-architect-v2.yml lo embebe tal cual dentro de --json-schema '...' (comillas simples de shell); un apostrofe en cualquier texto (p.ej. una descripcion) rompe el parseo del argumento y el workflow entero",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "landing-architect-v2-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio (rompe --json-schema '...' en el workflow)");
      },
    },
    {
      name: "salida minima valida: acepta tanto el mini-validador del JSON Schema como validateV2Output()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateV2Output(output));
      },
    },
    {
      name: "fixture sanitizado completo (con todos los campos opcionales) acepta ambas capas por igual",
      fn: () => {
        const output = loadFixtureV2Output();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateV2Output(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (hero) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.hero;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar hero como requerido y ausente");
        assert.throws(() => validateV2Output(output), /hero/);
      },
    },
    {
      name: "DRIFT: tipo incorrecto (ctaPrimary.isRealLink como string en vez de boolean) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.ctaPrimary as Record<string, unknown>).isRealLink = "yes";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar isRealLink no booleano");
        assert.throws(() => validateV2Output(output), /ctaPrimary/);
      },
    },
    {
      name: "DRIFT: enum invalido (sections[0].searchIntent fuera de los 4 valores permitidos) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.sections as Array<Record<string, unknown>>)[0].searchIntent = "not_a_real_intent";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un searchIntent fuera del enum");
        assert.throws(() => validateV2Output(output), /sections/);
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo top-level no declarado en el contrato -- defensa extra que validateV2Output() no aplica a proposito (duck-typing permisivo con campos extra)",
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
      name: "el schema (additionalProperties: false) rechaza un campo anidado no declarado (hero.extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.hero as Record<string, unknown>).extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar hero.extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "ctaSecondary es opcional: ausente del todo sigue siendo una salida valida en ambas capas",
      fn: () => {
        const output = minimalValidOutput();
        assert.ok(!("ctaSecondary" in output));
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, []);
        assert.doesNotThrow(() => validateV2Output(output));
      },
    },
  ];
}
