import * as assert from "node:assert/strict";
import { buildSemSpecialistContext, findLatestSemWatcherFinishedEvent } from "../src/employees/sem-specialist/sem-specialist-context";
import { DepartmentEvent } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseEvent(overrides: Partial<DepartmentEvent> = {}): DepartmentEvent {
  return {
    eventId: "evt-1",
    departmentRunId: "growth-department-2026-08-14T111247Z",
    agent: "sem-watcher",
    department: "web-growth",
    type: "agent_finished",
    priority: "low",
    summary: "SEM Watcher Agent finalizado.",
    payload: {},
    createdAt: "2026-08-14T11:13:30.858Z",
    ...overrides,
  };
}

function realisticSemWatcherPayload(): Record<string, unknown> {
  // Forma sanitizada, pero fiel a la forma REAL emitida por
  // src/agents/sem-watcher.ts (buildSemDepartmentSummary()) -- ver
  // data/department-events.jsonl para el evento real equivalente.
  return {
    connected: true,
    campaignName: "SEM | ES | Compra | Taquillas / Gimnasios",
    campaignStatus: "PAUSED",
    adGroups: 1,
    positiveKeywords: 60,
    negativeKeywords: 115,
    responsiveSearchAds: 11,
    semCandidateCount: 70,
    metricsWindow: "LAST_30_DAYS",
    metrics: [
      { campaignId: "23721032768", campaignName: "Campaign #1", impressions: 0, clicks: 0, costMicros: 0, conversions: 0, ctr: 0 },
      { campaignId: "23726061328", campaignName: "SEM | ES | Compra | Taquillas / Gimnasios", impressions: 120, clicks: 8, costMicros: 4_500_000, conversions: 1, ctr: 0.0666 },
    ],
    reportPath: "/opt/zentry-ai-department/reports/sem/sem-2026-08-14.md",
    departmentSummary: {
      totalCampaigns: 7,
      activeCampaignCount: 0,
      pausedCampaignCount: 7,
      allPaused: true,
      totalDailyBudgetIfActivatedEUR: 44,
      totalMonthlyBudgetIfActivatedEUR: 1320,
      campaigns: [{ name: "SEM | ES | Compra | Taquillas / Gimnasios", status: "PAUSED", dailyBudgetEUR: 10, adGroups: 1, positiveKeywords: 11 }],
      totalPositiveKeywords: 60,
      totalNegativeKeywords: 115,
      realSpendEUR: 4.5,
      primaryConversionActionNames: ["www.zentrylockers.com (web) generate_lead_form_submit"],
      unexpectedPrimaryConversionActionNames: [],
      duplicateKeywordWarnings: ['"lockers para empresas" se dirige desde 2 campanas distintas: A, B'],
    },
  };
}

export function runSemSpecialistContextTests(): TestCase[] {
  return [
    {
      name: "findLatestSemWatcherFinishedEvent devuelve null si no hay ningun evento sem-watcher",
      fn: () => {
        const events: DepartmentEvent[] = [baseEvent({ agent: "seo-watcher" }), baseEvent({ agent: "sem-watcher", type: "agent_started" })];
        assert.equal(findLatestSemWatcherFinishedEvent(events), null);
      },
    },
    {
      name: "findLatestSemWatcherFinishedEvent ignora eventos de otros agentes y de otros tipos",
      fn: () => {
        const target = baseEvent({ eventId: "evt-target" });
        const events: DepartmentEvent[] = [
          baseEvent({ eventId: "evt-other-agent", agent: "seo-watcher" }),
          baseEvent({ eventId: "evt-wrong-type", type: "warning_detected" }),
          target,
        ];
        const found = findLatestSemWatcherFinishedEvent(events);
        assert.equal(found?.eventId, "evt-target");
      },
    },
    {
      name: "findLatestSemWatcherFinishedEvent elige el evento MAS RECIENTE por createdAt, no el ultimo del array",
      fn: () => {
        const older = baseEvent({ eventId: "evt-older", createdAt: "2026-08-10T09:00:00.000Z" });
        const newer = baseEvent({ eventId: "evt-newer", createdAt: "2026-08-14T11:13:30.858Z" });
        // El mas reciente aparece PRIMERO en el array a proposito -- la
        // funcion debe comparar timestamps, no asumir orden de array.
        const events: DepartmentEvent[] = [newer, older];
        const found = findLatestSemWatcherFinishedEvent(events);
        assert.equal(found?.eventId, "evt-newer");
      },
    },
    {
      name: "buildSemSpecialistContext devuelve null (no-op) si no hay ningun snapshot -- nunca inventa datos SEM",
      fn: () => {
        const context = buildSemSpecialistContext([baseEvent({ agent: "seo-watcher" })]);
        assert.equal(context, null);
      },
    },
    {
      name: "buildSemSpecialistContext extrae correctamente un payload realista (connected=true, con departmentSummary y metrics)",
      fn: () => {
        const event = baseEvent({ payload: realisticSemWatcherPayload() });
        const context = buildSemSpecialistContext([event]);
        assert.ok(context);
        assert.equal(context!.sourceEventId, "evt-1");
        assert.equal(context!.connectedToGoogleAdsAtSourceTime, true);
        assert.equal(context!.campaignName, "SEM | ES | Compra | Taquillas / Gimnasios");
        assert.equal(context!.campaignStatus, "PAUSED");
        assert.equal(context!.metricsWindow, "LAST_30_DAYS");
        assert.equal(context!.metrics.length, 2);
        assert.equal(context!.metrics[1].clicks, 8);
        assert.equal(context!.metrics[1].costEUR, 4.5, "costMicros=4_500_000 debe convertirse a 4.5 EUR (division pura, sin llamar a Google Ads)");
        assert.ok(context!.departmentSummary);
        assert.equal(context!.departmentSummary!.totalCampaigns, 7);
        assert.equal(context!.departmentSummary!.realSpendEUR, 4.5);
        assert.deepEqual(context!.departmentSummary!.duplicateKeywordWarnings, ['"lockers para empresas" se dirige desde 2 campanas distintas: A, B']);
      },
    },
    {
      name: "buildSemSpecialistContext con connected=false: metrics/departmentSummary caen a vacio/null sin lanzar, resto de campos documentados se conserva",
      fn: () => {
        const event = baseEvent({
          payload: {
            connected: false,
            campaignName: "SEM | ES | Compra | Taquillas / Gimnasios",
            campaignStatus: "PAUSED",
            adGroups: 1,
            positiveKeywords: 5,
            negativeKeywords: 3,
            responsiveSearchAds: 2,
            semCandidateCount: 0,
            metricsWindow: undefined,
            metrics: [],
            departmentSummary: undefined,
          },
        });
        const context = buildSemSpecialistContext([event]);
        assert.ok(context);
        assert.equal(context!.connectedToGoogleAdsAtSourceTime, false);
        assert.equal(context!.metricsWindow, null);
        assert.deepEqual(context!.metrics, []);
        assert.equal(context!.departmentSummary, null);
      },
    },
    {
      name: "buildSemSpecialistContext es defensivo ante un payload malformado (tipos inesperados) -- nunca lanza, cae a valores seguros",
      fn: () => {
        const event = baseEvent({
          payload: {
            connected: "yes" as unknown, // deberia ser boolean
            campaignName: 12345 as unknown, // deberia ser string
            metrics: "no-es-un-array" as unknown,
            departmentSummary: "tampoco-es-un-objeto" as unknown,
          },
        });
        assert.doesNotThrow(() => buildSemSpecialistContext([event]));
        const context = buildSemSpecialistContext([event]);
        assert.equal(context!.connectedToGoogleAdsAtSourceTime, false);
        assert.equal(context!.campaignName, "");
        assert.deepEqual(context!.metrics, []);
        assert.equal(context!.departmentSummary, null);
      },
    },
  ];
}
