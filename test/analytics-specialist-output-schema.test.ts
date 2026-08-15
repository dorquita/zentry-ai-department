import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateAnalyticsSpecialistOutput } from "../src/employees/analytics-specialist/validator";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";
import { assertJsonSchemaLiteSupported } from "../src/core/json-schema-lite";

/**
 * Test de DERIVA (drift) entre config/analytics-specialist-output.schema.json
 * (el JSON Schema que se pasa a claude-code-action via --json-schema, ver
 * .github/workflows/analytics-specialist.yml) y la interfaz TypeScript
 * AnalyticsSpecialistOutput / validateAnalyticsSpecialistOutput()
 * (src/employees/analytics-specialist/). Mismo patron que
 * test/landing-architect-v2-output-schema.test.ts: sin libreria de
 * validacion de JSON Schema instalada, se corren los MISMOS fixtures
 * contra las DOS capas y se exige que coincidan para los casos
 * estructurales (campo requerido ausente, tipo incorrecto, enum
 * invalido, additionalProperties top-level y anidado).
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

function loadSchema(): JsonSchemaLite {
  const schemaPath = path.join(__dirname, "..", "config", "analytics-specialist-output.schema.json");
  return JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
}

function loadFixtureOutput(): Record<string, unknown> {
  const fixturePath = path.join(__dirname, "fixtures", "analytics-specialist-output-example.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as Record<string, unknown>;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    runSummary: { departmentRunId: "test-run", reportGeneratedAt: "2026-08-10T09:00:00.000Z", ga4Connected: true, gtmConnected: false },
    measurementFindings: [],
    funnelObservations: [],
    trafficObservations: [],
    conversionObservations: [],
    trackingIssues: [],
    anomalyCandidates: [],
    hypotheses: [],
    recommendedMeasurements: [],
    prioritizedActions: [],
    evidence: [],
    unknowns: ["No hay suficientes datos para evaluar el funnel completo."],
  };
}

export function runAnalyticsSpecialistOutputSchemaTests(): TestCase[] {
  const schema = loadSchema();

  return [
    {
      name: "el schema es JSON valido, draft-07, y solo usa keywords soportadas por json-schema-lite",
      fn: () => {
        assert.equal(schema.type, "object");
        assert.equal((schema as unknown as { $schema: string }).$schema, "http://json-schema.org/draft-07/schema#");
        assert.doesNotThrow(() => assertJsonSchemaLiteSupported(schema));
      },
    },
    {
      name: "REGRESION: el fichero del schema no contiene ningun apostrofe -- se embebe en --json-schema entre comillas simples de shell",
      fn: () => {
        const schemaPath = path.join(__dirname, "..", "config", "analytics-specialist-output.schema.json");
        const raw = fs.readFileSync(schemaPath, "utf-8");
        assert.doesNotMatch(raw, /'/, "el JSON Schema no debe contener el caracter apostrofe en ningun sitio");
      },
    },
    {
      name: "salida minima valida (todos los arrays vacios): acepta tanto el mini-validador del JSON Schema como validateAnalyticsSpecialistOutput()",
      fn: () => {
        const output = minimalValidOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateAnalyticsSpecialistOutput(output));
      },
    },
    {
      name: "fixture realista completo acepta ambas capas por igual",
      fn: () => {
        const output = loadFixtureOutput();
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.deepEqual(schemaErrors, [], `no deberian ser errores: ${JSON.stringify(schemaErrors)}`);
        assert.doesNotThrow(() => validateAnalyticsSpecialistOutput(output));
      },
    },
    {
      name: "DRIFT: falta un campo requerido (runSummary) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        delete output.runSummary;
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia reportar runSummary como requerido y ausente");
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /runSummary/);
      },
    },
    {
      name: "DRIFT: tipo incorrecto (runSummary.ga4Connected como string en vez de boolean) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        (output.runSummary as Record<string, unknown>).ga4Connected = "yes";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar ga4Connected no booleano");
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /ga4Connected/);
      },
    },
    {
      name: "DRIFT: enum invalido (measurementFindings[0].claimType fuera de los 4 valores permitidos) -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        output.measurementFindings = [{ claimType: "CAUSAL_CERTAINTY", statement: "x", evidenceIds: [] }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar un claimType fuera del enum");
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /claimType/);
      },
    },
    {
      name: "DRIFT: enum invalido en prioritizedActions[0].priority -- ambas capas deben rechazarlo",
      fn: () => {
        const output = minimalValidOutput();
        output.prioritizedActions = [{ claimType: "RECOMMENDATION", statement: "x", evidenceIds: [], priority: "urgentisimo" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar una priority fuera del enum");
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /priority/);
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
      name: "el schema (additionalProperties: false) rechaza un campo anidado no declarado (runSummary.extra)",
      fn: () => {
        const output = minimalValidOutput();
        (output.runSummary as Record<string, unknown>).extra = "campo no declarado";
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extra")),
          `el schema deberia rechazar runSummary.extra, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
    {
      name: "el schema (additionalProperties: false) rechaza un campo no declarado dentro de un item de evidence[]",
      fn: () => {
        const output = minimalValidOutput();
        output.evidence = [{ id: "e1", source: "ga4_channel_traffic", description: "x", extraField: "no deberia estar aqui" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("extraField")),
          `el schema deberia rechazar evidence[0].extraField, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },

    // --- REGRESION (run 31884786170, analytics-specialist): Claude copio la
    // forma del AnalyticsSpecialistContext de ENTRADA (departmentRunId,
    // reportGeneratedAt, reportPath, ga4Connected, gtmConnected sueltos en
    // la raiz) en vez de la forma de SALIDA (runSummary anidado + los 11
    // arrays), y uso "text"/"reason"/"detail" en vez de "statement"/
    // "evidenceIds" -- ver .claude/agents/analytics-specialist.md, seccion
    // "Frontera OBLIGATORIA: INPUT CONTEXT vs OUTPUT CONTRACT" (fix
    // aplicado tras ese fallo real). ---
    {
      name: 'REGRESION: campos del INPUT CONTEXT sueltos en la raiz del output (departmentRunId/reportGeneratedAt/reportPath/ga4Connected/gtmConnected sin anidar en runSummary) -- ambas capas deben rechazarlo',
      fn: () => {
        const output: Record<string, unknown> = {
          departmentRunId: "growth-department-2026-08-14T111247Z",
          reportGeneratedAt: "2026-08-14T11:12:47.000Z",
          reportPath: "reports/analytics/analytics-2026-08-14.md",
          ga4Connected: true,
          gtmConnected: true,
          dateRangeAnalyzed: "last_30_days",
          measurementFindings: [],
          funnelObservations: [],
          trafficObservations: [],
          conversionObservations: [],
          trackingIssues: [],
          anomalyCandidates: [],
          hypotheses: [],
          recommendedMeasurements: [],
          prioritizedActions: [],
          evidence: [],
          unknowns: [],
        };
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar los campos de contexto sueltos en la raiz (falta runSummary + additionalProperties no declarados)");
        assert.ok(
          schemaErrors.some((e) => e.includes("runSummary")),
          `deberia reportar runSummary como requerido y ausente, errores: ${JSON.stringify(schemaErrors)}`
        );
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /runSummary/);
      },
    },
    {
      name: 'REGRESION: "text" en vez de "statement" en un finding -- ambas capas deben rechazarlo',
      fn: () => {
        const output = minimalValidOutput();
        output.measurementFindings = [{ claimType: "FACT", text: "el evento click_phone no se disparo", evidenceIds: [] }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(schemaErrors.length > 0, "el schema deberia rechazar 'text' (no declarado) y 'statement' ausente (requerido)");
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /statement/);
      },
    },
    {
      name: 'REGRESION: "evidenceIds" ausente en un finding -- ambas capas deben rechazarlo',
      fn: () => {
        const output = minimalValidOutput();
        output.measurementFindings = [{ claimType: "FACT", statement: "el evento click_phone no se disparo" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("evidenceIds")),
          `el schema deberia reportar evidenceIds como requerido y ausente, errores: ${JSON.stringify(schemaErrors)}`
        );
        assert.throws(() => validateAnalyticsSpecialistOutput(output), /evidenceIds/);
      },
    },
    {
      name: 'REGRESION: campos extra "reason"/"detail" no declarados en prioritizedActions[]/evidence[] -- ambas capas deben rechazarlo',
      fn: () => {
        const output = minimalValidOutput();
        output.prioritizedActions = [{ claimType: "RECOMMENDATION", statement: "x", evidenceIds: [], priority: "high", reason: "no deberia estar aqui" }];
        output.evidence = [{ id: "e1", source: "ga4_channel_traffic", description: "x", detail: "no deberia estar aqui" }];
        const schemaErrors = validateAgainstSchema(schema, schema, output);
        assert.ok(
          schemaErrors.some((e) => e.includes("reason")),
          `el schema deberia rechazar prioritizedActions[0].reason, errores: ${JSON.stringify(schemaErrors)}`
        );
        assert.ok(
          schemaErrors.some((e) => e.includes("detail")),
          `el schema deberia rechazar evidence[0].detail, errores: ${JSON.stringify(schemaErrors)}`
        );
      },
    },
  ];
}
