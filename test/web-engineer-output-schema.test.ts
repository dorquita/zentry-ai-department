import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateWebEngineerOutput } from "../src/employees/web-engineer/validator";
import { WebEngineerSpecArtifact } from "../src/employees/web-engineer/runner-result";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre config/web-engineer-output.schema.json (el
 * JSON Schema que se pasa a claude-code-action via --json-schema, ver
 * .github/workflows/web-engineer.yml) y la interfaz TypeScript
 * WebEngineerOutput / validateWebEngineerOutput()
 * (src/employees/web-engineer/{types,validator}.ts). Mismo patron que
 * test/landing-architect-v2-output-schema.test.ts.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "web-engineer-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    implementationSummary: "Actualizar el CTA principal segun el ChangePack de origen.",
    targetPages: ["https://example-client.test/producto-ejemplo/"],
    targetComponents: ["hero"],
    proposedChanges: [{ description: "Mover el CTA junto al H1.", rationale: "Mejora visibilidad en movil.", targetPageOrComponent: "hero" }],
    filesOrSystemsAffected: ["Contenido de la pagina en WordPress (bloques Gutenberg)"],
    acceptanceCriteria: ["El CTA es visible sin hacer scroll en movil."],
    validationPlan: ["Revision visual manual antes de proponer aplicar el cambio."],
    rollbackPlan: ["Guardar copia del contenido actual antes de aplicar el cambio."],
    dependencies: [],
    risks: ["Bajo: cambio reversible."],
    approvalRequired: true,
    unknowns: [],
  };
}

function loadFixtureOutput(): Record<string, unknown> {
  const fixturePath = path.join(__dirname, "fixtures", "web-engineer-spec-example.json");
  const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as WebEngineerSpecArtifact;
  assert.equal(artifact.result.status, "executed");
  if (artifact.result.status !== "executed") throw new Error("unreachable");
  return artifact.result.output as unknown as Record<string, unknown>;
}

export function runWebEngineerOutputSchemaTests(): TestCase[] {
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
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- se embebe tal cual dentro de --json-schema entrecomillado (comillas simples de shell) en .github/workflows/web-engineer.yml",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "web-engineer-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio (rompe --json-schema '...' en el workflow)");
      },
    },
    {
      name: "additionalProperties:false en TODOS los objetos del schema (root + definitions.proposedChange)",
      fn: () => {
        assert.equal(schema.additionalProperties, false);
        assert.equal(schema.definitions!.proposedChange.additionalProperties, false);
      },
    },
    {
      name: "salida minima valida: acepta tanto el mini-validador del JSON Schema como validateWebEngineerOutput()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateWebEngineerOutput(output));
      },
    },
    {
      name: "fixture sanitizado completo acepta ambas capas por igual",
      fn: () => {
        const output = loadFixtureOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateWebEngineerOutput(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (implementationSummary) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.implementationSummary;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar implementationSummary como requerido y ausente");
        assert.throws(() => validateWebEngineerOutput(output), /implementationSummary/);
      },
    },
    {
      name: "DRIFT: tipo incorrecto (approvalRequired como string en vez de boolean) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output as Record<string, unknown>).approvalRequired = "yes";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar approvalRequired no booleano");
        assert.throws(() => validateWebEngineerOutput(output), /approvalRequired/);
      },
    },
    {
      name: "DRIFT: proposedChanges con un item que falta targetPageOrComponent -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        output.proposedChanges = [{ description: "x", rationale: "y" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar targetPageOrComponent como requerido y ausente");
        assert.throws(() => validateWebEngineerOutput(output), /proposedChanges/);
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
      name: "el schema (additionalProperties: false) rechaza un campo ANIDADO no declarado (proposedChanges[0].extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.proposedChanges as Array<Record<string, unknown>>)[0].extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar proposedChanges[0].extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "approvalRequired: false es una salida ESTRUCTURALMENTE valida para el JSON Schema generico (boolean), pero validateWebEngineerOutput() (regla de dominio) SIEMPRE la rechaza",
      fn: () => {
        const output = minimalValidOutput();
        output.approvalRequired = false;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], "el schema generico no conoce la regla de negocio -- eso es responsabilidad del validador de dominio");
        assert.throws(() => validateWebEngineerOutput(output), /approvalRequired debe ser SIEMPRE true/);
      },
    },
  ];
}
