import * as assert from "node:assert/strict";
import {
  auditSemSpecialistOutputForUnsupportedClaims,
  SemFinding,
  SemSpecialistOutput,
  validateSemSpecialistOutput,
} from "../src/employees/sem-specialist/sem-specialist-output";
import { buildSemEvidenceCatalog, SemEvidenceCatalogItem, SemSpecialistContext } from "../src/employees/sem-specialist/sem-specialist-context";

import { classifySnapshotFreshness } from "../src/core/snapshot-freshness";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Construye un SemSpecialistContext realista + su evidenceCatalog
 * determinista (buildSemEvidenceCatalog(), la MISMA funcion que usa
 * buildSemSpecialistContext() en produccion) -- nunca un catalogo
 * hand-rolled en el test, para que los fixtures no puedan desincronizarse
 * de lo que el runner realmente genera.
 */
function baseContext(overrides: Partial<Omit<SemSpecialistContext, "evidenceCatalog">> = {}): SemSpecialistContext {
  const base: Omit<SemSpecialistContext, "evidenceCatalog"> = {
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
    metricsStartDate: "2026-07-16",
    metricsEndDate: "2026-08-14",
    freshness: classifySnapshotFreshness({
      sourceGeneratedAt: "2026-08-14T11:13:30.858Z",
      now: "2026-08-14T11:20:00.000Z",
    }),
    searchTerms: [],
    searchTermCount: 0,
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
  return { ...base, evidenceCatalog: buildSemEvidenceCatalog(base) };
}

/** Busca una entrada real del catalogo por id -- lanza si el fixture del test no la generó (nunca cae en silencio a un id inventado). */
function catalogItem(context: SemSpecialistContext, id: string): SemEvidenceCatalogItem {
  const item = context.evidenceCatalog.find((c) => c.id === id);
  if (!item) throw new Error(`catalog item no encontrado en el fixture del test: "${id}" (ids disponibles: ${context.evidenceCatalog.map((c) => c.id).join(", ")})`);
  return item;
}

/** Copia una entrada del catalogo tal cual a la forma { id, contextField, value } que espera evidence[] -- exactamente lo que se le pide al subagente que haga. */
function evidenceFromCatalog(item: SemEvidenceCatalogItem): { id: string; contextField: string; value: string } {
  return { id: item.id, contextField: item.contextField, value: item.value };
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

    // --- auditSemSpecialistOutputForUnsupportedClaims: fail-closed, catalogo determinista ---
    {
      name: "sin afirmaciones cuantitativas ni evidence => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ summary: "Sin cifras concretas, solo observaciones cualitativas." });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "CPC inventado (numero que no aparece en el evidenceCatalog) => violacion dura",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: "El CPC medio es de 2,50 € en esta campana." })],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0, "deberia rechazar un CPC que no aparece en el evidenceCatalog");
        assert.ok(violations.some((v) => /CPC/i.test(v)));
      },
    },
    {
      name: "gasto inventado (cifra en euros que no aparece en el evidenceCatalog) => violacion dura",
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
      name: "presupuesto: cifra REAL del catalogo (44) pero SIN evidenceRefs => violacion (falta paper trail)",
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
      name: "presupuesto: cifra REAL del catalogo (44) CON evidence[] EXACTA del catalogo y evidenceRefs => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        const output = baseOutput({
          budgetObservations: [
            emptyFinding({
              description: `El presupuesto es de ${budgetItem.value} € al dia si se activaran todas las campanas.`,
              evidenceRefs: [budgetItem.id],
            }),
          ],
          evidence: [evidenceFromCatalog(budgetItem)],
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "REGRESION: una evidencia real pero de categoria SIN RELACION (other) no puede respaldar una cifra de CPC (misattribution)",
      fn: () => {
        const context = baseContext({
          departmentSummary: { ...baseContext().departmentSummary!, totalCampaigns: 3 },
        });
        const totalCampaignsItem = catalogItem(context, "sem-total-campaigns"); // categoria "other", value "3"
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El CPC medio es de 3 EUR.", evidenceRefs: [totalCampaignsItem.id] })],
          evidence: [evidenceFromCatalog(totalCampaignsItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0, "una evidencia real de categoria 'other' (totalCampaigns) no deberia respaldar una cifra de CPC solo porque el numero coincide");
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
      name: "evidenceRefs apunta a un id INEXISTENTE (ni en evidence[] ni en el catalogo) => la afirmacion se trata como sin respaldo",
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
      name: "conversiones: numero real presente en metrics[].conversions con evidence EXACTA del catalogo y referenciada => 0 violaciones",
      fn: () => {
        const context = baseContext({ metrics: [{ campaignId: "c1", campaignName: "SEM | Marca | Zentry", impressions: 100, clicks: 10, costEUR: 5, conversions: 2, ctr: 0.1, averageCpcEUR: 0.5, conversionsValue: 120 }] });
        const convItem = catalogItem(context, "sem-metrics-0-conversions");
        const output = baseOutput({
          conversionRiskFindings: [
            emptyFinding({ title: "Volumen de conversion bajo", description: "Se registraron 2 conversiones en el periodo medido.", evidenceRefs: [convItem.id] }),
          ],
          evidence: [evidenceFromCatalog(convItem)],
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "ROAS inventado (categoria estructuralmente sin campo real en el contexto) => violacion dura",
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
      name: "evidence no numerica (campaignStatus) EXACTA del catalogo => sin violacion de trazabilidad",
      fn: () => {
        const context = baseContext();
        const statusItem = catalogItem(context, "sem-campaign-status");
        const output = baseOutput({ evidence: [evidenceFromCatalog(statusItem)] });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(!violations.some((v) => /no coincide EXACTAMENTE/i.test(v)));
      },
    },

    // --- REGRESION (fix estructural: evidenceCatalog determinista) --------
    // 11 casos pedidos explicitamente tras el diagnostico del run
    // 31886434011 (2 afirmaciones sin respaldo, categorias CPC/ROAS
    // estructuralmente impasables con la heuristica anterior). ---
    {
      name: "evidence item EXACTO del catalogo (mismo id+contextField+value) => valida, no aparece como no-trazable",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        const output = baseOutput({ evidence: [evidenceFromCatalog(budgetItem)] });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(!violations.some((v) => /no coincide EXACTAMENTE/i.test(v)));
      },
    },
    {
      name: "evidence con id INVENTADO (no existe ningun item del evidenceCatalog con ese id) => invalida",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        const output = baseOutput({ evidence: [{ id: "sem-budget-daily-total-inventado", contextField: budgetItem.contextField, value: budgetItem.value }] });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /no coincide EXACTAMENTE/i.test(v)));
      },
    },
    {
      name: "evidence con contextField MODIFICADO respecto al catalogo (mismo id y value) => invalida",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        const output = baseOutput({ evidence: [{ id: budgetItem.id, contextField: "departmentSummary.presupuestoDiarioInventado", value: budgetItem.value }] });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /no coincide EXACTAMENTE/i.test(v)));
      },
    },
    {
      name: "evidence con value MODIFICADO respecto al catalogo (mismo id y contextField) => invalida",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        const output = baseOutput({ evidence: [{ id: budgetItem.id, contextField: budgetItem.contextField, value: "45" }] });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /no coincide EXACTAMENTE/i.test(v)));
      },
    },
    {
      name: "cifra con evidenceRef VALIDO (apunta a evidence[] EXACTA del catalogo, misma categoria) => valida",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-monthly-total");
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: `El presupuesto es de ${budgetItem.value} € al mes si se activaran todas las campanas.`, evidenceRefs: [budgetItem.id] })],
          evidence: [evidenceFromCatalog(budgetItem)],
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "cifra SIN evidenceRef alguno (array vacio) => invalida, aunque el numero sea real",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-monthly-total");
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: `El presupuesto es de ${budgetItem.value} € al mes si se activaran todas las campanas.`, evidenceRefs: [] })],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0);
      },
    },
    {
      name: "CPC: afirmacion cualitativa (sin cifra) citando sem-cpc-not-available => valida (0 violaciones)",
      fn: () => {
        const context = baseContext();
        const cpcItem = catalogItem(context, "sem-cpc-not-available");
        assert.equal(cpcItem.value, "not_available");
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El CPC no esta disponible en este snapshot, sin clics registrados.", evidenceRefs: [cpcItem.id] })],
          evidence: [evidenceFromCatalog(cpcItem)],
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "CPC: cifra NUMERICA sin dato real (aunque cite sem-cpc-not-available) => invalida siempre -- no hay ninguna entrada numerica de categoria cpc en el catalogo",
      fn: () => {
        const context = baseContext();
        const cpcItem = catalogItem(context, "sem-cpc-not-available");
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El CPC medio es de 0.50 EUR.", evidenceRefs: [cpcItem.id] })],
          evidence: [evidenceFromCatalog(cpcItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /CPC/i.test(v)), "una cifra de CPC nunca puede tener respaldo real hoy: el catalogo no expone ningun campo numerico de CPC");
      },
    },
    {
      name: "ROAS: afirmacion cualitativa (sin cifra) citando sem-roas-not-available => valida (0 violaciones)",
      fn: () => {
        const context = baseContext();
        const roasItem = catalogItem(context, "sem-roas-not-available");
        assert.equal(roasItem.value, "not_available");
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El ROAS no esta disponible en este snapshot.", evidenceRefs: [roasItem.id] })],
          evidence: [evidenceFromCatalog(roasItem)],
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "ROAS: cifra NUMERICA sin dato real (aunque cite sem-roas-not-available) => invalida siempre -- no hay ninguna entrada numerica de categoria roas en el catalogo",
      fn: () => {
        const context = baseContext();
        const roasItem = catalogItem(context, "sem-roas-not-available");
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El ROAS actual es de 3.5.", evidenceRefs: [roasItem.id] })],
          evidence: [evidenceFromCatalog(roasItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /ROAS/i.test(v)), "una cifra de ROAS nunca puede tener respaldo real hoy: el catalogo no expone ningun campo numerico de ROAS");
      },
    },

    // --- REGRESION (fix diagnostico run 31888764722): "summary" no puede
    // citar evidenceRefs propio, y la categoria proximidad-textual no
    // debe imponerse sobre la categoria REAL del evidenceCatalog. Las 4
    // violaciones de ese run (3 en summary con cifras reales gasto=0 /
    // presupuesto=44, 1 falso positivo "7 campañas" capturado por la
    // ventana de proximidad de "gasto") se reconstruyen aqui a partir del
    // diagnostico exacto -- el texto literal de Claude no fue recuperable
    // (ver diagnostico previo), pero las cifras/categorias/evidencias
    // reales si lo son. ---
    {
      name: "REGRESION run 31888764722 (summary, cifra real gasto=0 sin evidenceRefs posible) => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const spendItem = catalogItem(context, "sem-spend-real");
        assert.equal(spendItem.value, "0");
        const output = baseOutput({
          summary: "Snapshot con todas las campanas en PAUSED. Sin gasto real registrado (0 €) en el periodo medido.",
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "REGRESION run 31888764722 (summary, cifra real presupuesto=44 sin evidenceRefs posible) => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        assert.equal(budgetItem.value, "44");
        const output = baseOutput({
          summary: "Si se activaran todas las campanas, el presupuesto diario total seria de 44 € segun el snapshot mas reciente.",
        });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },
    {
      name: "REGRESION run 31888764722 (summary, cifra INVENTADA) => sigue siendo violacion -- 'summary' no puede citar, pero la cifra debe seguir siendo real",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ summary: "El gasto acumulado en el periodo fue de 999 €, una cifra inventada." });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /gasto/i.test(v)), "una cifra que no existe en el evidenceCatalog sigue siendo un fallo duro, incluso en summary");
      },
    },
    {
      name: "REGRESION run 31888764722 (falso positivo: '7 campañas' cerca de 'gasto', citando sem-total-campaigns) => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const campaignsItem = catalogItem(context, "sem-total-campaigns");
        assert.equal(campaignsItem.value, "7");
        assert.equal(campaignsItem.category, "other");
        const output = baseOutput({
          budgetObservations: [
            emptyFinding({
              description: "Sin gasto real registrado. Si se activaran las 7 campañas, convendria revisar el reparto de presupuesto entre ellas.",
              evidenceRefs: [campaignsItem.id],
            }),
          ],
          evidence: [evidenceFromCatalog(campaignsItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(
          violations,
          [],
          `una cifra real y correctamente citada (7 campañas, via sem-total-campaigns) no deberia rechazarse solo porque la palabra "gasto" aparece cerca en la prosa: ${JSON.stringify(violations)}`
        );
      },
    },
    {
      name: "REGRESION: 'gasto' cerca de una cifra ajena (other), MISMA frase (sin punto), SIN citarla => sigue siendo violacion (no basta con que exista en el catalogo en algun sitio de una finding)",
      fn: () => {
        const context = baseContext();
        // A proposito SIN punto entre "gasto" y "7" (a diferencia del texto
        // real del run 31890170949) -- este test verifica la otra mitad de
        // la regla: cuando la cifra SI esta en la misma frase que la
        // palabra clave (sin frontera de frase de por medio) pero no se ha
        // citado ninguna evidencia, sigue siendo un fallo duro.
        const output = baseOutput({
          budgetObservations: [
            emptyFinding({ description: "Sin gasto real registrado, si se activaran las 7 campañas.", evidenceRefs: [] }),
          ],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.length > 0, "un finding SIN evidenceRefs sigue exigiendo cita explicita, aunque la cifra sea real en el catalogo");
      },
    },
    {
      name: "REGRESION: CPC citando una entrada real pero de categoria ajena (sem-total-campaigns) => sigue siendo violacion (excepcion cpc/roas se mantiene)",
      fn: () => {
        const context = baseContext();
        const campaignsItem = catalogItem(context, "sem-total-campaigns");
        assert.equal(campaignsItem.value, "7");
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El CPC medio es de 7 EUR.", evidenceRefs: [campaignsItem.id] })],
          evidence: [evidenceFromCatalog(campaignsItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /CPC/i.test(v)), "cpc/roas exigen una entrada REALMENTE de esa categoria, no solo un value que coincida por casualidad");
      },
    },
    {
      name: "REGRESION: texto cualitativo sin cifras en summary => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ summary: "Campanas pausadas, sin actividad relevante que reportar en este snapshot." });
        assert.deepEqual(auditSemSpecialistOutputForUnsupportedClaims(context, output), []);
      },
    },

    // --- REGRESION (fix diagnostico run 31890170949): la violacion literal
    // recuperada de ese run fue exactamente:
    //   Afirmacion cuantitativa (gasto/coste)
    //   "gasto real registrado. Si se activaran las 7"
    //   en "budgetObservations: Presupuesto total disponible sin gasto
    //   real registrado"
    // El "7" representa campanas, no gasto -- la ventana de proximidad de
    // "gasto" (GAP) cruzaba el PUNTO que separa "...registrado." de "Si se
    // activaran las 7...", dos frases distintas. Fix: GAP ya no permite
    // cruzar puntuacion de fin de frase (. ! ?) -- ver su definicion mas
    // arriba. Estos tests usan la frase EXACTA del run real. ---
    {
      name: "REGRESION run 31890170949 (frase EXACTA 'gasto real registrado. Si se activaran las 7', con evidenceRefs de gasto=0 Y totalCampaigns=7) => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const spendItem = catalogItem(context, "sem-spend-real");
        const campaignsItem = catalogItem(context, "sem-total-campaigns");
        assert.equal(spendItem.value, "0");
        assert.equal(campaignsItem.value, "7");
        const output = baseOutput({
          budgetObservations: [
            emptyFinding({
              title: "Presupuesto total disponible sin gasto real registrado",
              description: "Presupuesto total disponible sin gasto real registrado. Si se activaran las 7 campañas, convendria priorizar el reparto del presupuesto.",
              evidenceRefs: [spendItem.id, campaignsItem.id],
            }),
          ],
          evidence: [evidenceFromCatalog(spendItem), evidenceFromCatalog(campaignsItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(
          violations,
          [],
          `la frase exacta del run 31890170949 (con evidenceRefs de gasto=0 y totalCampaigns=7) no deberia rechazarse: ${JSON.stringify(violations)}`
        );
      },
    },
    {
      name: "REGRESION run 31890170949: 'gasto de 7 €' SIN evidencia de gasto=7 => sigue siendo violacion",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({
          budgetObservations: [emptyFinding({ description: "El gasto de la campana es de 7 €, una cifra sin respaldo real.", evidenceRefs: [] })],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /gasto/i.test(v)), "un gasto de 7 EUR sin ninguna evidencia (real o no) sigue siendo un fallo duro");
      },
    },
    {
      name: "REGRESION run 31890663140 (frase EXACTA 'presupuesto diario total de 44') SIN evidenceRefs de sem-budget-daily-total => sigue siendo violacion",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        assert.equal(budgetItem.value, "44");
        const output = baseOutput({
          budgetObservations: [
            emptyFinding({
              title: "Distribucion desigual de presupuesto diario por campana",
              description: "presupuesto diario total de 44 repartido de forma desigual entre las campanas activas.",
              evidenceRefs: [],
            }),
          ],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(
          violations.some((v) => /presupuesto/i.test(v)),
          "una cifra real (44) sin su evidenceRef especifico (sem-budget-daily-total) sigue siendo un fallo duro"
        );
      },
    },
    {
      name: "REGRESION run 31890663140 (frase EXACTA 'presupuesto diario total de 44') CON evidenceRefs de sem-budget-daily-total => 0 violaciones",
      fn: () => {
        const context = baseContext();
        const budgetItem = catalogItem(context, "sem-budget-daily-total");
        const output = baseOutput({
          budgetObservations: [
            emptyFinding({
              title: "Distribucion desigual de presupuesto diario por campana",
              description: "presupuesto diario total de 44 repartido de forma desigual entre las campanas activas.",
              evidenceRefs: [budgetItem.id],
            }),
          ],
          evidence: [evidenceFromCatalog(budgetItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(violations, [], `citando sem-budget-daily-total no deberia rechazarse: ${JSON.stringify(violations)}`);
      },
    },
    {
      name: "REGRESION run 31890170949: 'CPC 7 €' citando SOLO evidence de campañas=7 => sigue siendo violacion (excepcion cpc/roas se mantiene)",
      fn: () => {
        const context = baseContext();
        const campaignsItem = catalogItem(context, "sem-total-campaigns");
        assert.equal(campaignsItem.value, "7");
        const output = baseOutput({
          biddingObservations: [emptyFinding({ description: "El CPC medio de la cuenta es de 7 €.", evidenceRefs: [campaignsItem.id] })],
          evidence: [evidenceFromCatalog(campaignsItem)],
        });
        const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
        assert.ok(violations.some((v) => /CPC/i.test(v)), "CPC exige una entrada REALMENTE de categoria cpc, nunca un value que coincida por casualidad con otra categoria");
      },
    },
  ];
}
