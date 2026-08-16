import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { resolveMetricsDateRange } from "../src/adapters/google-ads";
import {
  buildSemSpecialistContext,
  SemSpecialistContext,
} from "../src/employees/sem-specialist/sem-specialist-context";
import { DepartmentEvent } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const ROOT = path.join(__dirname, "..");

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/**
 * Quita comentarios de bloque y de linea. Lo que importa para "este
 * adaptador no puede mutar nada" es el CODIGO, no la prosa: estos
 * ficheros documentan explicitamente que nunca llaman a `:mutate`, y esa
 * frase no puede hacer fallar el test que comprueba justo eso.
 */
function readCodeWithoutComments(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Evento `agent_finished` de sem-watcher con el payload ampliado de la
 * Fase O51 (ventana explicita, instante real de la lectura, CPC, valor de
 * conversion y terminos de busqueda).
 */
function semFinishedEvent(
  payloadOverrides: Record<string, unknown> = {},
  overrides: Partial<DepartmentEvent> = {}
): DepartmentEvent {
  return {
    eventId: "evt-sem",
    departmentRunId: "growth-department-2026-08-16T070000Z",
    agent: "sem-watcher",
    department: "web-growth",
    type: "agent_finished",
    priority: "low",
    summary: "SEM Watcher Agent finalizado. Conectado=true.",
    payload: {
      connected: true,
      campaignName: "SEM | ES | Compra | Taquillas",
      campaignStatus: "PAUSED",
      adGroups: 1,
      positiveKeywords: 60,
      negativeKeywords: 115,
      responsiveSearchAds: 11,
      semCandidateCount: 70,
      metricsWindow: "LAST_30_DAYS",
      metricsStartDate: "2026-07-17",
      metricsEndDate: "2026-08-15",
      adsGeneratedAt: "2026-08-16T07:03:00.000Z",
      metrics: [
        {
          campaignId: "c1",
          campaignName: "SEM | ES | Compra | Taquillas",
          impressions: 1200,
          clicks: 48,
          costMicros: 36_500_000,
          conversions: 3,
          conversionsValue: 890.5,
          ctr: 0.04,
          averageCpcMicros: 760_416,
        },
      ],
      searchTerms: [
        {
          searchTerm: "taquillas para gimnasio",
          campaignId: "c1",
          campaignName: "SEM | ES | Compra | Taquillas",
          adGroupId: "ag1",
          impressions: 300,
          clicks: 12,
          costMicros: 9_000_000,
          conversions: 1,
        },
      ],
      searchTermCount: 87,
      departmentSummary: null,
      ...payloadOverrides,
    },
    createdAt: "2026-08-16T07:03:05.000Z",
    ...overrides,
  };
}

function contextOf(
  event: DepartmentEvent,
  options: Parameters<typeof buildSemSpecialistContext>[1] = {}
): SemSpecialistContext {
  const ctx = buildSemSpecialistContext([event], {
    now: "2026-08-16T07:20:00.000Z",
    currentDepartmentRunId: "growth-department-2026-08-16T070000Z",
    ...options,
  });
  assert.ok(ctx, "el contexto SEM no deberia ser null con un evento agent_finished presente");
  return ctx as SemSpecialistContext;
}

function catalogValue(ctx: SemSpecialistContext, id: string): string | undefined {
  return ctx.evidenceCatalog.find((item) => item.id === id)?.value;
}

export function runGoogleAdsLiveMigrationTests(): TestCase[] {
  return [
    // ---------------------------------------------------------------
    // Ventana de metricas explicita
    // ---------------------------------------------------------------
    {
      name: "la ventana de Ads termina AYER y dura exactamente los dias pedidos, contando ambos extremos",
      fn: () => {
        const range = resolveMetricsDateRange({}, "2026-08-16");
        assert.equal(range.endDate, "2026-08-15", "el dia en curso esta incompleto: la ventana termina ayer");
        assert.equal(range.startDate, "2026-07-17");
        // 2026-07-17 .. 2026-08-15 inclusive = 30 dias.
        const days =
          (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000 + 1;
        assert.equal(days, 30);
      },
    },
    {
      name: "GOOGLE_ADS_LOOKBACK_DAYS configurable, y un valor invalido es un error explicito",
      fn: () => {
        const range = resolveMetricsDateRange({ GOOGLE_ADS_LOOKBACK_DAYS: "7" }, "2026-08-16");
        assert.equal(range.startDate, "2026-08-09");
        assert.equal(range.endDate, "2026-08-15");
        for (const bad of ["0", "-5", "un-mes"]) {
          assert.throws(
            () => resolveMetricsDateRange({ GOOGLE_ADS_LOOKBACK_DAYS: bad }, "2026-08-16"),
            /GOOGLE_ADS_LOOKBACK_DAYS invalido/
          );
        }
      },
    },
    {
      name: "la ventana cruza correctamente el cambio de mes y de anyo",
      fn: () => {
        assert.deepEqual(resolveMetricsDateRange({ GOOGLE_ADS_LOOKBACK_DAYS: "3" }, "2027-01-02"), {
          startDate: "2026-12-30",
          endDate: "2027-01-01",
        });
      },
    },

    // ---------------------------------------------------------------
    // READ-ONLY: ninguna mutacion posible
    // ---------------------------------------------------------------
    {
      name: "el adaptador de Google Ads no contiene NINGUNA llamada de mutacion",
      fn: () => {
        const source = readCodeWithoutComments("src/adapters/google-ads.ts");
        // Se comprueban las formas reales de mutar en la API de Ads. Si
        // alguien anade una, este test falla antes de que llegue a main.
        const forbidden = [":mutate", "mutateResourceOperation", "operations:", "removeAll"];
        for (const f of forbidden) {
          assert.equal(source.includes(f), false, `google-ads.ts no puede contener "${f}"`);
        }
      },
    },
    {
      name: "el watcher de SEM no importa nada capaz de escribir en Google Ads",
      fn: () => {
        const source = readCodeWithoutComments("src/agents/sem-watcher.ts");
        assert.equal(source.includes(":mutate"), false);
        // Solo consume funciones de lectura del adaptador.
        assert.match(source, /getGoogleAdsSnapshot/);
      },
    },

    // ---------------------------------------------------------------
    // CPC y valor de conversion reales
    // ---------------------------------------------------------------
    {
      name: "el CPC real entra en el catalogo de evidencia cuando la API lo devuelve",
      fn: () => {
        const ctx = contextOf(semFinishedEvent());
        assert.equal(ctx.metrics[0].averageCpcEUR, 0.76);
        assert.equal(catalogValue(ctx, "sem-metrics-0-cpc"), "0.76");
        // Y deja de declararse "no disponible" por definicion.
        assert.equal(catalogValue(ctx, "sem-cpc-not-available"), undefined);
      },
    },
    {
      name: "sin clics NO hay CPC: se mantiene null y el catalogo vuelve a declararlo no disponible",
      fn: () => {
        const metrics = [
          {
            campaignId: "c1",
            campaignName: "SEM | ES | Compra | Taquillas",
            impressions: 1200,
            clicks: 0,
            costMicros: 0,
            conversions: 0,
            conversionsValue: 0,
            ctr: 0,
            // La API omite average_cpc cuando no hubo clics.
          },
        ];
        const ctx = contextOf(semFinishedEvent({ metrics }));
        assert.equal(ctx.metrics[0].averageCpcEUR, null, '"sin clics" no puede convertirse en "CPC de 0 €"');
        assert.equal(catalogValue(ctx, "sem-metrics-0-cpc"), undefined);
        assert.equal(catalogValue(ctx, "sem-cpc-not-available"), "not_available");
      },
    },
    {
      name: "el valor de conversion viaja hasta el catalogo de evidencia",
      fn: () => {
        const ctx = contextOf(semFinishedEvent());
        assert.equal(ctx.metrics[0].conversionsValue, 890.5);
        assert.equal(catalogValue(ctx, "sem-metrics-0-conversions-value"), "890.5");
      },
    },
    {
      name: "el ROAS sigue sin derivarse: seria un calculo, no evidencia leida de la API",
      fn: () => {
        const ctx = contextOf(semFinishedEvent());
        assert.equal(catalogValue(ctx, "sem-roas-not-available"), "not_available");
      },
    },

    // ---------------------------------------------------------------
    // Search terms
    // ---------------------------------------------------------------
    {
      name: "los terminos de busqueda reales son citables uno a uno, con su coste y conversiones",
      fn: () => {
        const ctx = contextOf(semFinishedEvent());
        assert.equal(ctx.searchTerms.length, 1);
        assert.equal(ctx.searchTerms[0].searchTerm, "taquillas para gimnasio");
        assert.equal(ctx.searchTerms[0].costEUR, 9);
        assert.equal(catalogValue(ctx, "sem-search-term-0-text"), "taquillas para gimnasio");
        assert.equal(catalogValue(ctx, "sem-search-term-0-cost"), "9");
        assert.equal(catalogValue(ctx, "sem-search-term-0-conversions"), "1");
      },
    },
    {
      name: "searchTermCount conserva el total real aunque la lista venga recortada",
      fn: () => {
        const ctx = contextOf(semFinishedEvent());
        assert.equal(ctx.searchTermCount, 87);
        assert.ok(ctx.searchTerms.length < ctx.searchTermCount);
      },
    },

    // ---------------------------------------------------------------
    // Procedencia y frescura del snapshot SEM
    // ---------------------------------------------------------------
    {
      name: "SEM: si el watcher corrio en ESTA pasada, el contexto queda marcado live_this_run",
      fn: () => {
        const ctx = contextOf(semFinishedEvent());
        assert.equal(ctx.freshness.status, "live_this_run");
        assert.equal(ctx.freshness.producedInThisRun, true);
        assert.equal(ctx.sourceGeneratedAt, "2026-08-16T07:03:00.000Z");
        assert.equal(ctx.metricsStartDate, "2026-07-17");
        assert.equal(ctx.metricsEndDate, "2026-08-15");
      },
    },
    {
      name: "SEM: un snapshot del VPS de hace dos dias se marca stale, no se presenta como actual",
      fn: () => {
        const ctx = contextOf(
          semFinishedEvent(
            { adsGeneratedAt: "2026-08-14T11:13:30.000Z" },
            { departmentRunId: "growth-department-2026-08-14T111247Z" }
          ),
          { currentDepartmentRunId: "growth-department-2026-08-16T070000Z" }
        );
        assert.equal(ctx.freshness.status, "stale");
        assert.equal(ctx.freshness.producedInThisRun, false);
        assert.match(ctx.freshness.humanSummary, /NO presentes estas cifras como el estado actual/);
      },
    },
    {
      name: "SEM: se prefiere adsGeneratedAt (cuando se hablo con la API) sobre createdAt del evento",
      fn: () => {
        const ctx = contextOf(semFinishedEvent());
        assert.equal(ctx.sourceGeneratedAt, "2026-08-16T07:03:00.000Z");
        assert.notEqual(ctx.sourceGeneratedAt, "2026-08-16T07:03:05.000Z");
      },
    },
    {
      name: "SEM: un snapshot anterior a la Fase O51 (sin adsGeneratedAt) cae a createdAt sin romperse",
      fn: () => {
        const ctx = contextOf(semFinishedEvent({ adsGeneratedAt: undefined }));
        assert.equal(ctx.sourceGeneratedAt, "2026-08-16T07:03:05.000Z");
        assert.equal(ctx.metricsStartDate, "2026-07-17");
      },
    },
    {
      name: "SEM: un snapshot generado SIN conexion real a Google Ads queda marcado como tal",
      fn: () => {
        const ctx = contextOf(semFinishedEvent({ connected: false }));
        assert.equal(ctx.connectedToGoogleAdsAtSourceTime, false);
      },
    },

    // ---------------------------------------------------------------
    // Wiring del workflow
    // ---------------------------------------------------------------
    {
      name: "la pasada diaria lee Google Ads en vivo con el mismo departmentRunId y exigiendo lectura real",
      fn: () => {
        const daily = readSource(".github/workflows/zentry-ai-department-daily.yml");
        assert.match(daily, /npm run sem:watch -- --departmentRunId "\$DEPARTMENT_RUN_ID" --require-live/);
        for (const secret of [
          "GOOGLE_ADS_DEVELOPER_TOKEN",
          "GOOGLE_ADS_OAUTH_CLIENT_ID",
          "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
          "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
        ]) {
          assert.ok(
            daily.includes(`${secret}: \${{ secrets.${secret} }}`),
            `la pasada diaria no inyecta ${secret}`
          );
        }
      },
    },
    {
      name: "los identificadores de cuenta de Ads NO se duplican como secrets: ya estan en clients/zentry/ads.json",
      fn: () => {
        const daily = readSource(".github/workflows/zentry-ai-department-daily.yml");
        const ads = JSON.parse(readSource("clients/zentry/ads.json")) as Record<string, unknown>;
        assert.ok(ads.customerId, "clients/zentry/ads.json debe traer customerId");
        assert.ok(ads.loginCustomerId, "clients/zentry/ads.json debe traer loginCustomerId");
        assert.equal(daily.includes("secrets.GOOGLE_ADS_CUSTOMER_ID"), false);
        assert.equal(daily.includes("secrets.GOOGLE_ADS_LOGIN_CUSTOMER_ID"), false);
      },
    },
    {
      name: "el CI ejecuta actionlint ademas de typecheck y tests",
      fn: () => {
        const ci = readSource(".github/workflows/ci.yml");
        assert.match(ci, /npm run typecheck/);
        assert.match(ci, /npm test/);
        assert.match(ci, /actionlint/);
      },
    },
  ];
}
