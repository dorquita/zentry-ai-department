import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateQaReviewerOutput } from "../src/employees/qa-reviewer/output";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre config/qa-reviewer-output.schema.json (el
 * JSON Schema que se pasa a claude-code-action via --json-schema, ver
 * .github/workflows/qa-reviewer.yml) y la interfaz TypeScript
 * QaReviewerOutput / validateQaReviewerOutput()
 * (src/employees/qa-reviewer/output.ts). Mismo patron que
 * test/landing-architect-v2-output-schema.test.ts: corre los MISMOS
 * fixtures contra las DOS capas (json-schema-lite sobre el JSON Schema,
 * y validateQaReviewerOutput() sobre la interfaz TypeScript real) y exige
 * que coincidan para los casos estructurales.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "qa-reviewer-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    reviewStatus: "pass",
    reviewedArtifact: {
      sourceEmployee: "ux-ui-landing-architect-v2",
      artifactType: "landing_architect_comparison",
      artifactId: "example-change-pack-001",
      artifactPath: "test/fixtures/qa-reviewer-example-artifact.json",
    },
    findings: [{ category: "evidence_coverage", severity: "info", description: "Ejemplo de finding." }],
    unsupportedClaims: [],
    contradictions: [],
    safetyConcerns: [],
    requiredCorrections: [],
    approvalRecommendation: { recommendedStatus: "pending", riskLevel: "none", rationale: "Ejemplo de justificacion." },
    evidence: ["Ejemplo de cita de evidencia."],
    summary: "Resumen de ejemplo.",
  };
}

export function runQaReviewerOutputSchemaTests(): TestCase[] {
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
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- .github/workflows/qa-reviewer.yml lo embebe tal cual dentro de --json-schema '...' (comillas simples de shell); un apostrofe en cualquier texto rompe el parseo del argumento y el workflow entero",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "qa-reviewer-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio (rompe --json-schema '...' en el workflow)");
      },
    },
    {
      name: "salida minima valida: acepta tanto el mini-validador del JSON Schema como validateQaReviewerOutput()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateQaReviewerOutput(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (reviewedArtifact) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.reviewedArtifact;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar reviewedArtifact como requerido y ausente");
        assert.throws(() => validateQaReviewerOutput(output), /reviewedArtifact/);
      },
    },
    {
      name: "DRIFT: tipo incorrecto (approvalRecommendation.riskLevel como numero en vez de string enum) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.approvalRecommendation as Record<string, unknown>).riskLevel = 42;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar riskLevel no string/no enum");
        assert.throws(() => validateQaReviewerOutput(output), /approvalRecommendation/);
      },
    },
    {
      name: "DRIFT: enum invalido (findings[0].severity fuera de info/warning/critical) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.findings as Array<Record<string, unknown>>)[0].severity = "not_a_real_severity";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un severity fuera del enum");
        assert.throws(() => validateQaReviewerOutput(output), /findings/);
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
      name: "el schema (additionalProperties: false) rechaza un campo ANIDADO no declarado (reviewedArtifact.extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.reviewedArtifact as Record<string, unknown>).extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar reviewedArtifact.extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo ANIDADO dentro de un item de array (findings[0].extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.findings as Array<Record<string, unknown>>)[0].extra = "campo no declarado en el item";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar findings[0].extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "arrays vacios (findings/unsupportedClaims/contradictions/safetyConcerns/requiredCorrections/evidence) siguen siendo una salida valida en ambas capas",
      fn: () => {
        const output = { ...minimalValidOutput(), findings: [], unsupportedClaims: [], contradictions: [], safetyConcerns: [], requiredCorrections: [], evidence: [] };
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, []);
        assert.doesNotThrow(() => validateQaReviewerOutput(output));
      },
    },
  ];
}
