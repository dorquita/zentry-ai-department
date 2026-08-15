import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { DepartmentEvent } from "../src/core/types";
import { buildAnalyticsSpecialistContext, collectWatcherWarnings, selectLatestAnalyticsWatcherFinishedEvent } from "../src/employees/analytics-specialist/context";

export interface TestCase {
  name: string;
  fn: () => void;
}

function fixtureMarkdown(): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", "analytics-specialist-report-example.md"), "utf-8");
}

function finishedEvent(overrides: Partial<DepartmentEvent> = {}): DepartmentEvent {
  return {
    eventId: "evt-1",
    departmentRunId: "growth-department-2026-08-10T090000Z",
    agent: "analytics-watcher",
    department: "web-growth",
    type: "agent_finished",
    priority: "low",
    summary: "Analytics Watcher Agent finalizado. GA4=true GTM=true.",
    payload: { ga4Connected: true, gtmConnected: true, reportPath: "/fake/reports/analytics/analytics-2026-08-10.md" },
    createdAt: "2026-08-10T09:00:12.000Z",
    ...overrides,
  };
}

export function runAnalyticsSpecialistContextTests(): TestCase[] {
  return [
    {
      name: "buildAnalyticsSpecialistContext devuelve status no_data si nunca hubo un evento agent_finished de analytics-watcher",
      fn: () => {
        const result = buildAnalyticsSpecialistContext({ events: [], readReportFile: () => undefined });
        assert.equal(result.status, "no_data");
        if (result.status !== "no_data") return;
        assert.match(result.reason, /nunca se ha ejecutado/);
      },
    },
    {
      name: "buildAnalyticsSpecialistContext devuelve status no_data si el reportPath del evento no existe en disco (nunca fabrica datos)",
      fn: () => {
        const result = buildAnalyticsSpecialistContext({ events: [finishedEvent()], readReportFile: () => undefined });
        assert.equal(result.status, "no_data");
        if (result.status !== "no_data") return;
        assert.match(result.reason, /no existe en disco/);
      },
    },
    {
      name: "buildAnalyticsSpecialistContext status ready: parsea GA4 y GTM reales cuando ambos estan conectados",
      fn: () => {
        const markdown = fixtureMarkdown();
        const result = buildAnalyticsSpecialistContext({ events: [finishedEvent()], readReportFile: () => markdown });
        assert.equal(result.status, "ready");
        if (result.status !== "ready") return;
        assert.equal(result.departmentRunId, "growth-department-2026-08-10T090000Z");
        assert.equal(result.ga4Connected, true);
        assert.equal(result.gtmConnected, true);
        assert.ok(result.ga4);
        assert.ok(result.gtm);
        assert.equal(result.ga4?.channelTraffic.length, 3);
        assert.equal(result.gtm?.tagCount, 4);
      },
    },
    {
      name: "GA4 y GTM fallan de forma independiente: gtmConnected=false => gtm queda null aunque el Markdown SI tenga una seccion GTM",
      fn: () => {
        const markdown = fixtureMarkdown();
        const result = buildAnalyticsSpecialistContext({
          events: [finishedEvent({ payload: { ga4Connected: true, gtmConnected: false, reportPath: "/fake/reports/analytics/analytics-2026-08-10.md" } })],
          readReportFile: () => markdown,
        });
        assert.equal(result.status, "ready");
        if (result.status !== "ready") return;
        assert.ok(result.ga4);
        assert.equal(result.gtm, null);
      },
    },
    {
      name: "ga4Connected=false => ga4 queda null",
      fn: () => {
        const markdown = fixtureMarkdown();
        const result = buildAnalyticsSpecialistContext({
          events: [finishedEvent({ payload: { ga4Connected: false, gtmConnected: true, reportPath: "/fake/reports/analytics/analytics-2026-08-10.md" } })],
          readReportFile: () => markdown,
        });
        assert.equal(result.status, "ready");
        if (result.status !== "ready") return;
        assert.equal(result.ga4, null);
        assert.ok(result.gtm);
      },
    },
    {
      name: "selectLatestAnalyticsWatcherFinishedEvent elige el mas reciente por createdAt, ignora eventos de otros agentes",
      fn: () => {
        const older = finishedEvent({ eventId: "old", departmentRunId: "run-old", createdAt: "2026-08-01T00:00:00.000Z" });
        const newer = finishedEvent({ eventId: "new", departmentRunId: "run-new", createdAt: "2026-08-10T09:00:12.000Z" });
        const otherAgent: DepartmentEvent = { ...finishedEvent(), eventId: "other", agent: "seo-watcher", createdAt: "2026-08-15T00:00:00.000Z" };
        const selected = selectLatestAnalyticsWatcherFinishedEvent([older, newer, otherAgent]);
        assert.equal(selected?.eventId, "new");
      },
    },
    {
      name: "selectLatestAnalyticsWatcherFinishedEvent devuelve undefined si no hay ningun evento agent_finished de analytics-watcher",
      fn: () => {
        const startedOnly: DepartmentEvent = { ...finishedEvent(), type: "agent_started" };
        assert.equal(selectLatestAnalyticsWatcherFinishedEvent([startedOnly]), undefined);
      },
    },
    {
      name: "collectWatcherWarnings solo devuelve warnings del mismo departmentRunId",
      fn: () => {
        const warningSameRun: DepartmentEvent = { ...finishedEvent(), eventId: "w1", type: "warning_detected", summary: "Sin credenciales de GA4." };
        const warningOtherRun: DepartmentEvent = { ...finishedEvent(), eventId: "w2", type: "warning_detected", departmentRunId: "otro-run", summary: "No deberia aparecer." };
        const warnings = collectWatcherWarnings([warningSameRun, warningOtherRun], "growth-department-2026-08-10T090000Z");
        assert.deepEqual(warnings, ["Sin credenciales de GA4."]);
      },
    },
  ];
}
