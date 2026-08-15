import * as assert from "node:assert/strict";
import {
  auditSemSpecialistOutputForUnsupportedClaims,
  SemFinding,
  SemSpecialistOutput,
  validateSemSpecialistOutput,
} from "../src/employees/sem-specialist/sem-specialist-output";
import { SemSpecialistContext } from "../src/employees/sem-specialist/sem-specialist-context";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(overrides: Partial<SemSpecialistContext> = {}): SemSpecialistContext {
  return {
    sourceEventId: "evt-1",
    sourceDepartmentRunId: "growth-department-2026-08-14T111247Z",
    sourceGeneratedAt: "2026-08-14T11:13:30.858Z",
    connectedToGoogleAdsAtSourceTime: true,
    campaignName: "SEM | ES | Compra | Taquillas / Gimnasios",
    campaignStatus: "PAUSED",
    adGroups: 1,
    positiveKeywords: 60,
    negativeKeywords: 115,
    responsiveSearchAds: 11,
    semCandidateCount: 70,
    metricsWindow: "LAST_30_DAYS",
    metrics: [],
    departmentSummary: {
      totalCampaigns: 7,
      activeCampaignCount: 0,
      pausedCampaignCount: 7,
      allPaused: true,
      totalDailyBudgetIfActivatedEUR: 44,
      totalMonthlyBudgetIfActivatedEUR: 1320,
      campaigns: [],
      totalPositiveKeywords: 60,
      totalNegativeKeywords: 115,
      realSpendEUR: 0,
      primaryConversionActionNames: [],
      unexpectedPrimaryConversionActionNames: [],
      duplicateKeywordWarnings: [],
    },
    ...overrides,
  };
}

function emptyFinding(overrides: Partial<SemFinding> = {}): SemFinding {
  return { title: "t", description: "d", evidenceRefs: [], severity: "info", ...overrides };
}

function baseOutput(overrides: Partial<SemSpecialistOutput> = {}): SemSpecialistOutput {
  return {
    summary: "Resumen de ejemplo.",
    campaignFindings: [],
    searchTermOpportunities: [],
    negativeKeywordRecommendations: [],
    budgetObservations: [],
    biddingObservations: [],
    adLandingAlignment: [],
    conversionRiskFindings: [],
    prioritizedExperiments: [],
    evidence: [],
    unknowns: [],
    ...overrides,
  };
}

export function runSemSpecialistOutputTests(): TestCase[] {
  return [
    // --- validateSemSpecialistOutput: estructural, fail-closed ---
    {
      name: "validateSemSpecialistOutput acepta una salida minima valida",
      fn: () => {
        assert.doesNotThrow(() => validateSemSpecialistOutput(baseOutput()));
      },
    },
    {
      name: "validateSemSpecialistOutput lanza si falta 'summary'",
      fn: () => {
        const output = baseOutput() as unknown as Record<string, unknown>;
        delete output.summary;
        assert.throws(() => validateSemSpecialistOutput(output), /summary/);
      },
    },
    {
      name: "validateSemSpecialistOutput lanza si campaignFindings no es un array de findings validos",
      fn: () => {
        const output = { ...baseOutput(), campaignFindings: "no-es-un-array" };
        assert.throws(() => validateSemSpecialistOutput(output), /campaignFindings/);
      },
    },
    {
      name: "validateSemSpecialistOutput lanza si severity de un finding no es uno de los 4 valores del enum",
      fn: () => {
        const output = { ...baseOutput(), campaignFindings: [emptyFinding({ severity: "urgentisimo" as unknown as SemFinding["severity"] })] };
        assert.throws(() => validateSemSpecialistOutput(output), /campaignFindings/);
      },
    },
    {
      name: "validateSemSpecialistOutput lanza si prioritizedExperiments tiene forma incorrecta",
      fn: () => {
        const output = { ...baseOutput(), prioritizedExperiments: [{ title: "x" }] };
        assert.throws(() => validateSemSpecialistOutput(output), /prioritizedExperiments/);
      },
    },
    {
      name: "validateSemSpecialistOutput lanza si evidence tiene forma incorrecta",
      fn: () => {
        const output = { ...baseOutput(), evidence: [{ id: "e1" }] };
        assert.throws(() => validateSemSpecialistOutput(output), /evidence/);
      },
    },
    {
      name: "validateSemSpecialistOutput lanza si unknowns no es string[]",
      fn: () => {
        const output = { ...baseOutput(), unknowns: [42] };
        assert.throws(() => validateSemSpecialistOutput(output), /unknowns/);
      },
    },
    {
      name: "validateSemSpecialistOutput lanza si el input no es un objeto",
      fn: () => {
        assert.throws(() => validateSemSpecialistOutput("no-un-objeto"), /objeto JSON/);
      },
    },

    // --- auditSemSpecialistOutputForUnsupportedClaims: fail-closed, no invented CPC/conversions/ROAS/spend/budget ---
    {
      name: "sin afirmaciones cuantitativas ni evidence => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ summary: "Sin cifras concretas, solo observaciones cualitativas." });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "CPC inventado (numero que no aparece en el contexto) => violacion dura",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: "El CPC medio es de 2,50 € en esta campana." })],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0, "deberia rechazar un CPC que no aparece en el contexto");
        assert.ok(violations.some((v) => /CPC/i.test(v)));
      },
    },
    {
      name: "gasto inventado (cifra en euros que no aparece en el contexto) => violacion dura",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: "El gasto acumulado es de 999 € este mes." })],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /gasto/i.test(v)));
      },
    },
    {
      name: "presupuesto: cifra REAL del contexto (totalDailyBudgetIfActivatedEUR=44) pero SIN evidenceRefs => violacion (falta paper trail)",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: "El presupuesto es de 44 € al dia si se activaran todas las campanas.", evidenceRefs: [] })],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0, "una cifra real sin evidenceRefs verificada sigue siendo una violacion -- hace falta el paper trail explicito");
      },
    },
    {
      name: "presupuesto: cifra REAL del contexto (44) CON evidence[] trazable y evidenceRefs => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          budgetObservations: [
            emptyFinding({
              description: "El presupuesto es de 44 € al dia si se activaran todas las campanas.",
              evidenceRefs: ["ev-budget"],
            }),
          ],
          evidence: [{ id: "ev-budget", contextField: "departmentSummary.totalDailyBudgetIfActivatedEUR", value: "44 EUR" }],
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "evidence[] inventada (valor que no aparece en el contexto real) => violacion dura, incluso sin referenciarla desde ningun finding",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          evidence: [{ id: "ev-fake", contextField: "departmentSummary.realSpendEUR", value: "999 EUR" }],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /no trazable/i.test(v)));
      },
    },
    // --- REGRESIONES (code review) ---
    {
      name: "REGRESION: un CPC decimal fabricado (0.45) no debe colarse solo porque '45' coincide con un entero real de OTRO campo del contexto",
      fn: () => {
        const context = baseContext({ adGroups: 45 }); // 45 es un numero real del contexto, pero de un campo sin relacion con CPC
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El CPC medio es de 0.45 EUR en esta campana.", evidenceRefs: ["ev-cpc"] })],
          evidence: [{ id: "ev-cpc", contextField: "adGroups", value: "45" }],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0, "0.45 no deberia interpretarse como '045'=45 (separador de miles) y colarse via un entero real no relacionado");
      },
    },
    {
      name: "REGRESION: una evidencia no puede citar un numero real de un contextField DISTINTO para respaldar una cifra inventada (misattribution)",
      fn: () => {
        const context = baseContext({ departmentSummary: { ...baseContext().departmentSummary!, totalCampaigns: 3 } });
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El CPC medio es de 3 EUR.", evidenceRefs: ["ev-misattributed"] })],
          // El campo citado (totalCampaigns) es real y vale 3, pero NO tiene relacion alguna con un CPC -- citar su valor para
          // respaldar una afirmacion de CPC es una atribucion falsa, no una evidencia real.
          evidence: [{ id: "ev-misattributed", contextField: "departmentSummary.totalCampaigns", value: "3" }],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0, "citar un numero real de un campo no relacionado no deberia respaldar una cifra de CPC inventada");
      },
    },
    {
      name: "REGRESION: 'conversiones' con la palabra clave ANTES del numero ('Conversiones: 12') tambien se audita, no solo 'numero antes de palabra'",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          conversionRiskFindings: [emptyFinding({ description: "Conversiones: 12 en el periodo medido, una cifra inventada." })],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(
          violations.some((v) => /conversiones/i.test(v)),
          "el orden 'palabra clave antes del numero' tambien debe detectarse como afirmacion cuantitativa"
        );
      },
    },
    {
      name: "gasto: identificador con digitos pegados (LAST_30_DAYS) cerca de 'gasto' NO se lee como una cifra de gasto inventada",
      fn: () => {
        const context = baseContext({ metricsWindow: "LAST_30_DAYS" });
        const output = baseOutput({ summary: "Sin gasto real medido en la ventana LAST_30_DAYS." });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(violations, [], `no deberia interpretar el 30 de LAST_30_DAYS como una cifra de gasto: ${JSON.stringify(violations)}`);
      },
    },
    {
      name: "evidenceRefs apunta a un id de evidence[] inexistente => la afirmacion se trata como sin respaldo",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: "Presupuesto de 44 € al dia.", evidenceRefs: ["id-que-no-existe"] })],
          evidence: [],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0);
      },
    },
    {
      name: "conversiones: numero real presente en metrics[].conversions con evidence trazable y referenciada => 0 violaciones",
      fn: () => {
        const context = baseContext({ metrics: [{ campaignId: "c1", campaignName: "SEM | Marca | Zentry", impressions: 100, clicks: 10, costEUR: 5, conversions: 2, ctr: 0.1 }] });
        const output = baseOutput({
          conversionRiskFindings: [
            emptyFinding({ title: "Volumen de conversion bajo", description: "Se registraron 2 conversiones en el periodo medido.", evidenceRefs: ["ev-conv"] }),
          ],
          evidence: [{ id: "ev-conv", contextField: "metrics[0].conversions", value: "2" }],
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "ROAS inventado (categoria explicitamente prohibida por la mision) => violacion dura",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ biddingObservations: [emptyFinding({ description: "El ROAS actual es de 3.5, muy por encima del objetivo." })] });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /ROAS/i.test(v)));
      },
    },
    {
      name: "evidence[] con id duplicado => violacion dura (paper trail ambiguo)",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          evidence: [
            { id: "dup", contextField: "campaignStatus", value: "PAUSED" },
            { id: "dup", contextField: "campaignName", value: context.campaignName },
          ],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /duplicada/i.test(v)));
      },
    },
    {
      name: "evidence no numerica (nombre de campana real) trazable por substring del contexto serializado => sin violacion propia",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          evidence: [{ id: "ev-name", contextField: "campaignStatus", value: "PAUSED" }],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(!violations.some((v) => /no trazable/i.test(v)));
      },
    },
  ];
}
