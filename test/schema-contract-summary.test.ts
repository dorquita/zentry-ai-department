import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { renderSchemaContractSummary } from "../src/core/schema-contract-summary";
import { JsonSchemaLite } from "../src/core/json-schema-lite";

/**
 * Tests de `renderSchemaContractSummary()` -- el bloque de contrato que
 * se inserta en el prompt de un empleado GENERADO desde su JSON Schema
 * versionado, en vez de escrito a mano.
 *
 * Lo que se protege aqui es exactamente el fallo que motivo el modulo
 * (run 31949966340): que la prosa de `.claude/agents/*.md` y el schema
 * contra el que se valida la respuesta puedan decir cosas distintas
 * sobre que campos son obligatorios.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

const EXAMPLE_SCHEMA: JsonSchemaLite = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    items: { type: "array", items: { $ref: "#/definitions/item" } },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "items", "tags"],
  definitions: {
    item: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        page: { type: "string" },
        level: { enum: ["high", "low"] },
      },
      required: ["id", "level"],
    },
  },
};

function loadSeoSchema(): JsonSchemaLite {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "seo-specialist-output.schema.json"), "utf-8")) as JsonSchemaLite;
}

export function runSchemaContractSummaryTests(): TestCase[] {
  return [
    {
      name: "lista los campos obligatorios y opcionales del objeto raiz por separado",
      fn: () => {
        const rendered = renderSchemaContractSummary(EXAMPLE_SCHEMA, "config/ejemplo.schema.json");
        assert.ok(rendered.includes("objeto raiz"));
        assert.ok(rendered.includes("`summary` (string)"));
        assert.ok(rendered.includes("`items` (array de objetos <item>)"));
        assert.ok(rendered.includes("`tags` (array de string)"));
      },
    },
    {
      name: "una definicion referenciada por $ref se documenta como su propio bloque, con sus opcionales",
      fn: () => {
        const rendered = renderSchemaContractSummary(EXAMPLE_SCHEMA, "config/ejemplo.schema.json");
        const itemBlock = rendered.slice(rendered.indexOf("**<item>**"));
        assert.ok(itemBlock.includes("`id` (string)"));
        assert.ok(itemBlock.includes("`level` (uno de: high | low)"));
        // `page` no esta en required -> debe aparecer bajo OPCIONALES, no bajo OBLIGATORIOS.
        const optionalSection = itemBlock.slice(itemBlock.indexOf("- OPCIONALES"));
        assert.ok(optionalSection.includes("`page` (string)"), "page deberia figurar como opcional");
        const requiredSection = itemBlock.slice(itemBlock.indexOf("- OBLIGATORIOS"), itemBlock.indexOf("- OPCIONALES"));
        assert.ok(!requiredSection.includes("`page`"), "page NO deberia figurar como obligatorio");
      },
    },
    {
      name: "declara explicitamente que additionalProperties:false rechaza la respuesta entera",
      fn: () => {
        const rendered = renderSchemaContractSummary(EXAMPLE_SCHEMA, "config/ejemplo.schema.json");
        assert.ok(rendered.includes("No se admite NINGUN campo adicional"));
      },
    },
    {
      name: "es DETERMINISTA: el mismo schema produce exactamente el mismo texto",
      fn: () => {
        const a = renderSchemaContractSummary(EXAMPLE_SCHEMA, "config/ejemplo.schema.json");
        const b = renderSchemaContractSummary(JSON.parse(JSON.stringify(EXAMPLE_SCHEMA)) as JsonSchemaLite, "config/ejemplo.schema.json");
        assert.equal(a, b);
      },
    },
    {
      name: "sobre el schema REAL de seo-specialist: technicalIssue declara page como opcional y el resto como obligatorio",
      fn: () => {
        const rendered = renderSchemaContractSummary(loadSeoSchema(), "config/seo-specialist-output.schema.json");
        const start = rendered.indexOf("**<technicalIssue>**");
        assert.ok(start >= 0, "deberia documentarse el bloque <technicalIssue>");
        const block = rendered.slice(start, rendered.indexOf("**<contentGap>**"));
        const required = block.slice(block.indexOf("- OBLIGATORIOS"), block.indexOf("- OPCIONALES"));
        const optional = block.slice(block.indexOf("- OPCIONALES"));
        assert.ok(required.includes("`issue`") && required.includes("`severity`") && required.includes("`basis`") && required.includes("`evidenceRefs`") && required.includes("`id`"));
        assert.ok(!required.includes("`page`"));
        assert.ok(optional.includes("`page`"));
      },
    },
    {
      name: "sobre el schema REAL de seo-specialist: se documentan los 6 tipos de item ademas del objeto raiz",
      fn: () => {
        const rendered = renderSchemaContractSummary(loadSeoSchema(), "config/seo-specialist-output.schema.json");
        for (const definition of ["finding", "opportunity", "technicalIssue", "contentGap", "internalLinkRecommendation", "prioritizedAction", "evidenceItem"]) {
          assert.ok(rendered.includes(`**<${definition}>**`), `falta el bloque de <${definition}>`);
        }
      },
    },
  ];
}
