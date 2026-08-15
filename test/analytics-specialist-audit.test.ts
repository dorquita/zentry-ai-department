import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { auditAnalyticsSpecialistOutput } from "../src/employees/analytics-specialist/audit";
import { AnalyticsSpecialistContextReady } from "../src/employees/analytics-specialist/context";
import { AnalyticsSpecialistOutput } from "../src/employees/analytics-specialist/types";
import { validateAnalyticsSpecialistOutput } from "../src/employees/analytics-specialist/validator";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(overrides: Partial<AnalyticsSpecialistContextReady> = {}): AnalyticsSpecialistContextReady {
  return {
    status: "ready",
    departmentRunId: "growth-department-2026-08-10T090000Z",
    reportGeneratedAt: "2026-08-10T09:00:12.000Z",
    reportPath: "/fake/reports/analytics/analytics-2026-08-10.md",
    ga4Connected: true,
    gtmConnected: true,
    ga4: {
      dateRange: { startDate: "2026-07-13", endDate: "2026-08-09" },
      channelTraffic: [{ channel: "Direct", sessions: 200, activeUsers: 90, conversions: 40 }],
      topLandingPages: [],
      keyEvents: [{ name: "click_phone", fired: false, occurrences: 0, conversions: 0 }],
      sourceMedium: [],
    },
    gtm: {
      containerName: "www.ejemplo-cliente.com",
      containerPublicId: "GTM-EXAMPLE1",
      workspaceName: "Default Workspace",
      liveVersionName: "V12",
      tagCount: 4,
      triggerCount: 3,
      variableCount: 0,
      tags: [{ name: "GA4 Event - click_phone", type: "gaawe", paused: true }],
      triggers: [],
    },
    watcherWarnings: [],
    ...overrides,
  };
}

function baseOutput(overrides: Partial<AnalyticsSpecialistOutput> = {}): AnalyticsSpecialistOutput {
  return {
    runSummary: { departmentRunId: "growth-department-2026-08-10T090000Z", reportGeneratedAt: "2026-08-10T09:00:12.000Z", ga4Connected: true, gtmConnected: true },
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
    ...overrides,
  };
}

export function runAnalyticsSpecialistAuditTests(): TestCase[] {
  return [
    {
      name: "una salida sin cifras inventadas, sin lenguaje causal en HYPOTHESIS y sin referencias colgantes no genera ningun warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          trackingIssues: [{ claimType: "FACT", statement: "El evento click_phone no se disparo (0 ocurrencias) en el periodo.", evidenceIds: ["ev1"] }],
          evidence: [{ id: "ev1", source: "ga4_key_events", description: "click_phone: 0 ocurrencias en el periodo." }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "cifra citada en un statement que no aparece en el contexto ni en la evidencia => warning de metrica inventada",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          trafficObservations: [{ claimType: "OBSERVATION", statement: "El canal Direct genero 9999 sesiones en el periodo.", evidenceIds: ["ev1"] }],
          evidence: [{ id: "ev1", source: "ga4_channel_traffic", description: "Trafico del canal Direct." }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(warnings.some((w) => /9999/.test(w) && /no es rastreable/.test(w)));
      },
    },
    {
      name: "cifra citada SIN ningun evidenceIds => warning distinto (falta respaldo), incluso si la cifra es real",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          trafficObservations: [{ claimType: "OBSERVATION", statement: "El canal Direct tuvo 200 sesiones.", evidenceIds: [] }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(warnings.some((w) => /sin ningun evidenceIds/.test(w)));
      },
    },
    {
      name: "evidenceIds que referencia un id inexistente en evidence[] => warning de referencia colgante",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          measurementFindings: [{ claimType: "FACT", statement: "Hallazgo sin cifras.", evidenceIds: ["no-existe"] }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(warnings.some((w) => /no-existe/.test(w) && /no existe en el array/.test(w)));
      },
    },
    {
      name: "HYPOTHESIS con lenguaje causal cierto ('porque') => warning de correlacion/causalidad",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          hypotheses: [{ claimType: "HYPOTHESIS", statement: "Las conversiones bajaron porque el tag esta pausado.", evidenceIds: [] }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(warnings.some((w) => /lenguaje de causalidad cierta/.test(w)));
      },
    },
    {
      name: "HYPOTHESIS redactada como posibilidad ('podria deberse a') NO genera warning de causalidad",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          hypotheses: [{ claimType: "HYPOTHESIS", statement: "La caida podria deberse a que el tag esta pausado, pendiente de confirmar.", evidenceIds: [] }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(!warnings.some((w) => /lenguaje de causalidad cierta/.test(w)));
      },
    },
    {
      name: "OBSERVATION con lenguaje causal ('porque') NO se marca con la heuristica de HYPOTHESIS (solo aplica a items HYPOTHESIS)",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          trafficObservations: [{ claimType: "OBSERVATION", statement: "El trafico crecio porque hubo mas sesiones.", evidenceIds: [] }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(!warnings.some((w) => /lenguaje de causalidad cierta/.test(w)));
      },
    },
    {
      name: "recommendedMeasurements con claimType distinto de RECOMMENDATION => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          recommendedMeasurements: [{ claimType: "OBSERVATION", statement: "Esto deberia ser una recomendacion.", evidenceIds: [] }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(warnings.some((w) => /recommendedMeasurements\[0\]/.test(w) && /RECOMMENDATION/.test(w)));
      },
    },
    {
      name: "prioritizedActions con claimType distinto de RECOMMENDATION => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          prioritizedActions: [{ claimType: "FACT", statement: "Esto deberia ser una recomendacion.", evidenceIds: [], priority: "high" }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.ok(warnings.some((w) => /prioritizedActions\[0\]/.test(w) && /RECOMMENDATION/.test(w)));
      },
    },
    {
      name: "un ano de 4 digitos (p.ej. 2026) citado en un statement no se trata como metrica inventada",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          measurementFindings: [{ claimType: "FACT", statement: "El informe de analytics-watcher es del 2026.", evidenceIds: [] }],
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "el fixture realista test/fixtures/analytics-specialist-output-example.json no genera ningun warning (es internamente consistente)",
      fn: () => {
        const fixturePath = path.join(__dirname, "fixtures", "analytics-specialist-output-example.json");
        const raw = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
        const output = validateAnalyticsSpecialistOutput(raw);
        const context = baseContext({
          ga4: {
            dateRange: { startDate: "2026-07-13", endDate: "2026-08-09" },
            channelTraffic: [
              { channel: "Direct", sessions: 200, activeUsers: 90, conversions: 40 },
              { channel: "Organic Search", sessions: 50, activeUsers: 45, conversions: 10 },
              { channel: "Paid Search", sessions: 10, activeUsers: 9, conversions: 1 },
            ],
            topLandingPages: [],
            keyEvents: [
              { name: "generate_lead_form_submit", fired: true, occurrences: 12, conversions: 12 },
              { name: "click_whatsapp", fired: true, occurrences: 18, conversions: 18 },
              { name: "click_phone", fired: false, occurrences: 0, conversions: 0 },
              { name: "click_request_quote", fired: true, occurrences: 40, conversions: 40 },
            ],
            sourceMedium: [],
          },
        });
        const warnings = auditAnalyticsSpecialistOutput(context, output);
        assert.deepEqual(warnings, [], `el fixture deberia estar libre de warnings, obtenidos: ${JSON.stringify(warnings, null, 2)}`);
      },
    },
  ];
}
