import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { parseGa4ReportSection, parseGtmReportSection } from "../src/employees/analytics-specialist/report-parser";

export interface TestCase {
  name: string;
  fn: () => void;
}

function loadFixtureMarkdown(): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", "analytics-specialist-report-example.md"), "utf-8");
}

export function runAnalyticsSpecialistReportParserTests(): TestCase[] {
  const fixture = loadFixtureMarkdown();

  return [
    {
      name: "parseGa4ReportSection extrae el rango de fechas y el trafico por canal del fixture",
      fn: () => {
        const ga4 = parseGa4ReportSection(fixture);
        assert.ok(ga4);
        assert.deepEqual(ga4?.dateRange, { startDate: "2026-07-13", endDate: "2026-08-09" });
        assert.equal(ga4?.channelTraffic.length, 3);
        assert.deepEqual(ga4?.channelTraffic[0], { channel: "Direct", sessions: 200, activeUsers: 90, conversions: 40 });
      },
    },
    {
      name: "parseGa4ReportSection extrae landing pages con bounceRatePercent numerico",
      fn: () => {
        const ga4 = parseGa4ReportSection(fixture);
        assert.equal(ga4?.topLandingPages.length, 2);
        assert.deepEqual(ga4?.topLandingPages[0], { landingPage: "/", sessions: 120, conversions: 30, bounceRatePercent: 22 });
      },
    },
    {
      name: "parseGa4ReportSection distingue eventos que SI se dispararon de los que NO (click_phone)",
      fn: () => {
        const ga4 = parseGa4ReportSection(fixture);
        const clickPhone = ga4?.keyEvents.find((e) => e.name === "click_phone");
        const leadForm = ga4?.keyEvents.find((e) => e.name === "generate_lead_form_submit");
        assert.equal(clickPhone?.fired, false);
        assert.equal(clickPhone?.occurrences, 0);
        assert.equal(leadForm?.fired, true);
        assert.equal(leadForm?.occurrences, 12);
      },
    },
    {
      name: "parseGa4ReportSection extrae fuentes/medios",
      fn: () => {
        const ga4 = parseGa4ReportSection(fixture);
        assert.equal(ga4?.sourceMedium.length, 2);
        assert.deepEqual(ga4?.sourceMedium[1], { source: "google", medium: "organic", sessions: 45, conversions: 9 });
      },
    },
    {
      name: "parseGa4ReportSection devuelve null si no hay ninguna seccion GA4 en el Markdown",
      fn: () => {
        const noGa4Markdown = "# Analytics Watcher — sin GA4\n\n## GTM — Estado del contenedor\n\n- **Contenedor:** x (GTM-X,\n";
        assert.equal(parseGa4ReportSection(noGa4Markdown), null);
      },
    },
    {
      name: "parseGtmReportSection extrae contenedor/workspace/version live/contadores del fixture",
      fn: () => {
        const gtm = parseGtmReportSection(fixture);
        assert.ok(gtm);
        assert.equal(gtm?.containerName, "www.ejemplo-cliente.com");
        assert.equal(gtm?.containerPublicId, "GTM-EXAMPLE1");
        assert.equal(gtm?.workspaceName, "Default Workspace");
        assert.equal(gtm?.liveVersionName, "V12 - version de ejemplo (id 12)");
        assert.equal(gtm?.tagCount, 4);
        assert.equal(gtm?.triggerCount, 3);
        assert.equal(gtm?.variableCount, 0);
      },
    },
    {
      name: "parseGtmReportSection marca click_phone como tag pausado",
      fn: () => {
        const gtm = parseGtmReportSection(fixture);
        const clickPhoneTag = gtm?.tags.find((t) => t.name === "GA4 Event - click_phone");
        assert.equal(clickPhoneTag?.paused, true);
        const whatsappTag = gtm?.tags.find((t) => t.name === "GA4 Event - click_whatsapp");
        assert.equal(whatsappTag?.paused, false);
      },
    },
    {
      name: "parseGtmReportSection extrae triggers",
      fn: () => {
        const gtm = parseGtmReportSection(fixture);
        assert.equal(gtm?.triggers.length, 3);
        assert.deepEqual(gtm?.triggers[0], { name: "click_phone", type: "linkClick" });
      },
    },
    {
      name: "parseGtmReportSection devuelve null si no hay ninguna seccion GTM en el Markdown",
      fn: () => {
        const noGtmMarkdown = "# Analytics Watcher — sin GTM\n\n## GA4 — Trafico por canal (2026-01-01 a 2026-01-02)\n\n| Canal | Sesiones | Usuarios activos | Conversiones |\n|---|---|---|---|\n";
        assert.equal(parseGtmReportSection(noGtmMarkdown), null);
      },
    },
    {
      name: "una seccion GA4 sin trafico ('Sin trafico en el periodo.') produce channelTraffic vacio, no un error",
      fn: () => {
        const markdown = "# x\n\n## GA4 — Trafico por canal (2026-01-01 a 2026-01-02)\n\nSin trafico en el periodo.\n\n## GA4 — Landing pages principales\n\nSin datos de landing pages en el periodo.\n\n## GA4 — Eventos clave (comparado contra lo esperado)\n\n| Evento | Se disparo en el periodo | Ocurrencias | Conversiones |\n|---|---|---|---|\n\n## GA4 — Fuentes / medios principales\n\nSin datos de fuente/medio en el periodo.\n";
        const ga4 = parseGa4ReportSection(markdown);
        assert.deepEqual(ga4?.channelTraffic, []);
        assert.deepEqual(ga4?.topLandingPages, []);
        assert.deepEqual(ga4?.keyEvents, []);
        assert.deepEqual(ga4?.sourceMedium, []);
        assert.deepEqual(ga4?.dateRange, { startDate: "2026-01-01", endDate: "2026-01-02" });
      },
    },
  ];
}
