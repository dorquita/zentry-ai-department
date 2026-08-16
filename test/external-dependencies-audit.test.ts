import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_SNAPSHOT_MAX_AGE_HOURS,
  assertSnapshotUsable,
  classifySnapshotFreshness,
  isLiveThisRun,
  isStaleOrUnknown,
  resolveRequireLiveSources,
  resolveSnapshotMaxAgeHours,
} from "../src/core/snapshot-freshness";
import {
  GOOGLE_ENV_SENSITIVITY,
  GOOGLE_PROBE_SERVICES,
  GoogleProbeReport,
  explainOAuthError,
  listGoogleSecretEnvVarNames,
  listGoogleSecretEnvVarNamesForClient,
  listNotLiveRequiredServices,
  listServiceEnvVarNames,
  renderGoogleProbeMarkdown,
  resolveProbeExitCode,
} from "../src/core/google-live-probe";
import {
  CLIENT_SERVICE_CREDENTIAL_KEYS,
  resolveClientConfigProvidedCredentialKeys,
  resolveClientEnvVar,
  resolveClientServiceCredentials,
} from "../src/core/client-config";
import { containsSecretValue } from "../src/department/email-config";
import { buildAnalyticsSpecialistContext } from "../src/employees/analytics-specialist/context";
import {
  resolveSeoSnapshotDepartmentRunId,
  resolveSeoSourceGeneratedAt,
} from "../src/employees/seo-specialist/context";
import { DepartmentEvent, SeoJob } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const WORKFLOWS_DIR = path.join(__dirname, "..", ".github", "workflows");

function readWorkflow(name: string): string {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, name), "utf-8");
}

/**
 * Ejecuta `fn` con un `process.env` controlado y lo restaura pase lo que
 * pase. Necesario porque el gate de credenciales lee `process.env`
 * directamente y, si no, el resultado del test dependeria de si quien lo
 * ejecuta tiene o no un `.env` cargado.
 */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const snapshot = process.env;
  const replacement: Record<string, string | undefined> = { ...snapshot };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete replacement[key];
    else replacement[key] = value;
  }
  process.env = replacement as NodeJS.ProcessEnv;
  try {
    fn();
  } finally {
    process.env = snapshot;
  }
}

/** Un env sin NINGUNA variable Google, para probar el camino "faltan credenciales". */
function withoutAnyGoogleEnv(fn: () => void): void {
  const cleared: Record<string, string | undefined> = {};
  for (const service of GOOGLE_PROBE_SERVICES) {
    for (const key of listServiceEnvVarNames(service)) {
      cleared[key] = undefined;
      cleared[`ZENTRY_${key}`] = undefined;
    }
  }
  withEnv(cleared, fn);
}

function seoJob(overrides: Partial<SeoJob> = {}, metaOverrides: Partial<SeoJob["meta"]> = {}): SeoJob {
  return {
    id: "job-1",
    createdAt: "2026-08-14T11:12:48.024Z",
    agent: "seo-watcher",
    mode: "PROPOSE",
    status: "proposed",
    title: "Oportunidad de ejemplo",
    meta: {
      runId: "seo-watcher-2026-08-14T111247Z",
      analysisStartDate: "2026-07-16",
      analysisEndDate: "2026-08-13",
      siteUrl: "sc-domain:ejemplo.com",
      dataSource: "search_console",
      ...metaOverrides,
    },
    opportunity: {
      kind: "low_ctr",
      keyword: "ejemplo",
      page: "https://ejemplo.com/",
      currentPosition: 12,
      targetPosition: 8,
      recommendedAction: "Revisar meta title.",
      priority: "medium",
      risk: "low",
      requiresApproval: true,
      nextReviewDate: "2026-08-21",
      evidence: { impressions: 10, clicks: 0, ctr: 0 },
    },
    ...overrides,
  } as SeoJob;
}

function analyticsFinishedEvent(overrides: Partial<DepartmentEvent> = {}): DepartmentEvent {
  return {
    eventId: "evt-analytics",
    departmentRunId: "growth-department-2026-08-14T111247Z",
    agent: "analytics-watcher",
    department: "web-growth",
    type: "agent_finished",
    priority: "low",
    summary: "Analytics Watcher Agent finalizado. GA4=true GTM=true.",
    payload: { ga4Connected: true, gtmConnected: true, reportPath: "/opt/zentry-ai-department/reports/analytics/analytics-2026-08-14.md" },
    createdAt: "2026-08-14T11:13:33.727Z",
    ...overrides,
  };
}

const MINIMAL_ANALYTICS_REPORT = [
  "# Analytics Watcher — 2026-08-14",
  "",
  "## GA4 — Trafico por canal (2026-07-17 a 2026-08-13)",
  "",
  "| Canal | Sesiones | Usuarios activos | Conversiones |",
  "|---|---|---|---|",
  "| Direct | 100 | 80 | 3 |",
  "",
].join("\n");

export function runExternalDependenciesAuditTests(): TestCase[] {
  return [
    // ---------------------------------------------------------------
    // 1. Credenciales Google ausentes
    // ---------------------------------------------------------------
    {
      name: "credenciales ausentes: cada servicio Google reporta que NOMBRES faltan, y ninguno es un valor",
      fn: () => {
        withoutAnyGoogleEnv(() => {
          for (const service of GOOGLE_PROBE_SERVICES) {
            const status = resolveClientServiceCredentials("zentry", service);
            assert.equal(status.complete, false, `${service} no deberia estar completo sin variables`);
            assert.ok(status.missing.length > 0, `${service} deberia listar variables que faltan`);
            for (const name of status.missing) {
              assert.ok(
                name.startsWith("ZENTRY_"),
                `el nombre reportado debe venir prefijado por cliente, no crudo: ${name}`
              );
              // Un nombre de variable, nunca un valor: solo mayusculas,
              // digitos y guiones bajos.
              assert.match(name, /^[A-Z0-9_]+$/, `"${name}" no parece un nombre de variable`);
            }
          }
        });
      },
    },
    {
      name: "credenciales ausentes: los secretos de verdad SIEMPRE se exigen, aunque el cliente tenga ficheros de configuracion",
      fn: () => {
        withoutAnyGoogleEnv(() => {
          const provided = resolveClientConfigProvidedCredentialKeys("zentry");
          for (const secretName of listGoogleSecretEnvVarNames()) {
            assert.equal(
              provided.has(secretName),
              false,
              `${secretName} es un secreto: clients/<id>/*.json NUNCA puede darlo por resuelto`
            );
          }
          // Y el gate lo refleja: los tres OAuth de GA4 siguen faltando.
          const ga4 = resolveClientServiceCredentials("zentry", "ga4");
          assert.deepEqual(ga4.missing, [
            "ZENTRY_GOOGLE_ANALYTICS_OAUTH_CLIENT_ID",
            "ZENTRY_GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET",
            "ZENTRY_GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN",
          ]);
        });
      },
    },
    {
      name: "identificadores no secretos ya commiteados en clients/zentry/ no se piden como variable de entorno",
      fn: () => {
        const provided = resolveClientConfigProvidedCredentialKeys("zentry");
        // clients/zentry/analytics.json y ads.json traen estos cuatro.
        for (const key of ["GA4_PROPERTY_ID", "GTM_CONTAINER_ID", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID"]) {
          assert.ok(provided.has(key), `${key} deberia venir de la configuracion del cliente, no del entorno`);
          assert.equal(GOOGLE_ENV_SENSITIVITY[key], "config", `${key} debe estar clasificado como config, no como secreto`);
        }
      },
    },
    {
      name: "un cliente sin ficheros de configuracion no hereda los identificadores de zentry",
      fn: () => {
        assert.equal(resolveClientConfigProvidedCredentialKeys("cliente-que-no-existe").size, 0);
      },
    },

    // ---------------------------------------------------------------
    // 2. Frescura: stale / live / provenance
    // ---------------------------------------------------------------
    {
      name: "snapshot stale: por encima del umbral se marca stale y el resumen prohibe presentarlo como actual",
      fn: () => {
        const freshness = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-14T11:13:33.000Z",
          now: "2026-08-16T13:00:00.000Z",
        });
        assert.equal(freshness.status, "stale");
        assert.equal(freshness.producedInThisRun, false);
        assert.ok(freshness.ageHours !== null && freshness.ageHours > DEFAULT_SNAPSHOT_MAX_AGE_HOURS);
        assert.match(freshness.humanSummary, /NO presentes estas cifras como el estado actual/);
        assert.equal(isStaleOrUnknown(freshness), true);
        assert.equal(isLiveThisRun(freshness), false);
      },
    },
    {
      name: "snapshot de esta pasada: mismo departmentRunId -> live_this_run",
      fn: () => {
        const freshness = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-16T07:05:00.000Z",
          now: "2026-08-16T07:20:00.000Z",
          currentDepartmentRunId: "growth-department-2026-08-16T070000Z",
          snapshotDepartmentRunId: "growth-department-2026-08-16T070000Z",
        });
        assert.equal(freshness.status, "live_this_run");
        assert.equal(freshness.producedInThisRun, true);
        assert.match(freshness.humanSummary, /DATOS LIVE DE ESTA PASADA/);
      },
    },
    {
      name: "procedencia: departmentRunId distinto NO es live aunque el snapshot sea de hace un minuto",
      fn: () => {
        const freshness = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-16T07:19:00.000Z",
          now: "2026-08-16T07:20:00.000Z",
          currentDepartmentRunId: "growth-department-2026-08-16T072000Z",
          snapshotDepartmentRunId: "growth-department-2026-08-16T070000Z",
        });
        assert.equal(freshness.status, "fresh");
        assert.equal(freshness.producedInThisRun, false);
        assert.match(freshness.humanSummary, /NO DE ESTA PASADA/);
      },
    },
    {
      name: "procedencia no demostrable: sin marca de tiempo -> unknown, nunca 'reciente por defecto'",
      fn: () => {
        for (const value of [null, undefined, "", "   ", "no-es-una-fecha"]) {
          const freshness = classifySnapshotFreshness({ sourceGeneratedAt: value, now: "2026-08-16T07:20:00.000Z" });
          assert.equal(freshness.status, "unknown", `"${value}" deberia dar unknown`);
          assert.equal(freshness.ageHours, null);
          assert.equal(isStaleOrUnknown(freshness), true);
          assert.match(freshness.humanSummary, /PROCEDENCIA NO DEMOSTRABLE/);
        }
      },
    },
    {
      name: "un snapshot con fecha futura (relojes desincronizados) no burla el umbral con una antiguedad negativa",
      fn: () => {
        const freshness = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-17T00:00:00.000Z",
          now: "2026-08-16T07:20:00.000Z",
        });
        assert.equal(freshness.ageHours, 0);
        assert.equal(freshness.status, "fresh");
      },
    },
    {
      name: "el umbral es configurable, pero un valor invalido es un error explicito y no una caida silenciosa al default",
      fn: () => {
        assert.equal(resolveSnapshotMaxAgeHours({}), DEFAULT_SNAPSHOT_MAX_AGE_HOURS);
        assert.equal(resolveSnapshotMaxAgeHours({ SNAPSHOT_MAX_AGE_HOURS: "" }), DEFAULT_SNAPSHOT_MAX_AGE_HOURS);
        assert.equal(resolveSnapshotMaxAgeHours({ SNAPSHOT_MAX_AGE_HOURS: "48" }), 48);
        for (const bad of ["cero", "0", "-3"]) {
          assert.throws(
            () => resolveSnapshotMaxAgeHours({ SNAPSHOT_MAX_AGE_HOURS: bad }),
            /SNAPSHOT_MAX_AGE_HOURS invalido/
          );
        }
      },
    },

    // ---------------------------------------------------------------
    // 3. Fuente live no disponible -> sin fallback silencioso
    // ---------------------------------------------------------------
    {
      name: "fuente live no disponible: con REQUIRE_LIVE_SOURCES=true, un snapshot que no es de esta pasada falla explicitamente",
      fn: () => {
        const stale = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-14T11:13:33.000Z",
          now: "2026-08-16T13:00:00.000Z",
        });
        assert.throws(
          () => assertSnapshotUsable("analytics-watcher (GA4/GTM)", stale, { requireLive: true }),
          (err: Error) => {
            assert.match(err.message, /REQUIRE_LIVE_SOURCES=true/);
            assert.match(err.message, /analytics-watcher \(GA4\/GTM\)/);
            assert.match(err.message, /Fail-closed/);
            return true;
          }
        );
      },
    },
    {
      name: "sin REQUIRE_LIVE_SOURCES el snapshot viejo se usa, pero jamas queda etiquetado como live",
      fn: () => {
        const stale = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-14T11:13:33.000Z",
          now: "2026-08-16T13:00:00.000Z",
        });
        assert.doesNotThrow(() => assertSnapshotUsable("seo-watcher", stale, { requireLive: false }));
        assert.equal(isLiveThisRun(stale), false);
      },
    },
    {
      name: "un snapshot live de esta pasada pasa el gate fail-closed",
      fn: () => {
        const live = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-16T07:05:00.000Z",
          now: "2026-08-16T07:20:00.000Z",
          currentDepartmentRunId: "run-A",
          snapshotDepartmentRunId: "run-A",
        });
        assert.doesNotThrow(() => assertSnapshotUsable("seo-watcher", live, { requireLive: true }));
      },
    },
    {
      name: "REQUIRE_LIVE_SOURCES solo se activa con el literal 'true'",
      fn: () => {
        assert.equal(resolveRequireLiveSources({}), false);
        assert.equal(resolveRequireLiveSources({ REQUIRE_LIVE_SOURCES: "TRUE" }), true);
        assert.equal(resolveRequireLiveSources({ REQUIRE_LIVE_SOURCES: "1" }), false);
        assert.equal(resolveRequireLiveSources({ REQUIRE_LIVE_SOURCES: "yes" }), false);
        assert.equal(resolveRequireLiveSources({ REQUIRE_LIVE_SOURCES: "false" }), false);
      },
    },

    // ---------------------------------------------------------------
    // 4. generatedAt vs sourceGeneratedAt en los contextos reales
    // ---------------------------------------------------------------
    {
      name: "analytics-specialist: sourceGeneratedAt es CUANDO se leyo GA4/GTM, no cuando se construyo el contexto",
      fn: () => {
        const result = buildAnalyticsSpecialistContext({
          events: [analyticsFinishedEvent()],
          readReportFile: () => MINIMAL_ANALYTICS_REPORT,
          now: "2026-08-16T13:00:00.000Z",
          currentDepartmentRunId: "growth-department-2026-08-16T130000Z",
        });
        assert.equal(result.status, "ready");
        if (result.status !== "ready") return;
        assert.equal(result.sourceGeneratedAt, "2026-08-14T11:13:33.727Z");
        assert.equal(result.freshness.status, "stale");
        assert.equal(result.freshness.producedInThisRun, false);
      },
    },
    {
      name: "analytics-specialist: si el watcher corrio en ESTA pasada, el contexto queda marcado live_this_run",
      fn: () => {
        const result = buildAnalyticsSpecialistContext({
          events: [
            analyticsFinishedEvent({
              departmentRunId: "growth-department-2026-08-16T070000Z",
              createdAt: "2026-08-16T07:05:00.000Z",
            }),
          ],
          readReportFile: () => MINIMAL_ANALYTICS_REPORT,
          now: "2026-08-16T07:20:00.000Z",
          currentDepartmentRunId: "growth-department-2026-08-16T070000Z",
        });
        assert.equal(result.status, "ready");
        if (result.status !== "ready") return;
        assert.equal(result.freshness.status, "live_this_run");
        assert.equal(result.freshness.producedInThisRun, true);
      },
    },
    {
      name: "seo-specialist: sourceGeneratedAt sale del job mas reciente de la ultima pasada",
      fn: () => {
        const jobs = [
          seoJob({ id: "a", createdAt: "2026-08-14T11:12:48.024Z" }),
          seoJob({ id: "b", createdAt: "2026-08-14T11:12:49.500Z" }),
        ];
        assert.equal(resolveSeoSourceGeneratedAt(jobs), "2026-08-14T11:12:49.500Z");
        assert.equal(resolveSeoSourceGeneratedAt([]), null);
      },
    },
    {
      name: "seo-specialist: el runId del watcher se correlaciona con el departmentRunId via el bus de eventos",
      fn: () => {
        const events: DepartmentEvent[] = [
          {
            eventId: "e1",
            departmentRunId: "growth-department-2026-08-16T070000Z",
            agent: "seo-watcher",
            department: "web-growth",
            type: "agent_finished",
            priority: "low",
            summary: "SEO Watcher Agent finalizado",
            payload: { runId: "seo-watcher-2026-08-16T070100Z", rowsRead: 900 },
            createdAt: "2026-08-16T07:01:30.000Z",
          },
        ];
        assert.equal(
          resolveSeoSnapshotDepartmentRunId(events, "seo-watcher-2026-08-16T070100Z"),
          "growth-department-2026-08-16T070000Z"
        );
        // Un runId sin evento correlacionado NO se puede afirmar como de esta pasada.
        assert.equal(resolveSeoSnapshotDepartmentRunId(events, "seo-watcher-2026-08-14T111247Z"), undefined);
        assert.equal(resolveSeoSnapshotDepartmentRunId(events, undefined), undefined);
      },
    },

    // ---------------------------------------------------------------
    // 5. El servicio live se marca correctamente / no hay fallback mudo
    // ---------------------------------------------------------------
    {
      name: "probe: solo `live` cuenta como live; missing_credentials y failed NO cuelan por el gate fail-closed",
      fn: () => {
        const report: GoogleProbeReport = {
          clientId: "zentry",
          probedAt: "2026-08-16T13:00:00.000Z",
          results: [
            { service: "search_console", status: "live", missing: [], evidence: { accessibleSiteCount: 2 }, error: null },
            { service: "ga4", status: "missing_credentials", missing: ["ZENTRY_GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN"], evidence: null, error: null },
            { service: "gtm", status: "failed", missing: [], evidence: null, error: "invalid_grant" },
            { service: "google_ads", status: "skipped", missing: [], evidence: null, error: null },
          ],
        };
        assert.equal(resolveProbeExitCode(report, []), 0, "sin --require el probe es informativo");
        assert.equal(resolveProbeExitCode(report, ["search_console"]), 0);
        assert.equal(resolveProbeExitCode(report, ["ga4"]), 1);
        assert.equal(resolveProbeExitCode(report, ["gtm"]), 1);
        assert.equal(resolveProbeExitCode(report, ["google_ads"]), 1);
        assert.deepEqual(listNotLiveRequiredServices(report, ["search_console", "ga4", "gtm"]), ["ga4", "gtm"]);
      },
    },
    {
      name: "probe: el informe distingue los cuatro estados y nunca convierte un fallo en un hueco vacio",
      fn: () => {
        const report: GoogleProbeReport = {
          clientId: "zentry",
          probedAt: "2026-08-16T13:00:00.000Z",
          results: [
            { service: "search_console", status: "live", missing: [], evidence: { accessibleSiteCount: 2 }, error: null },
            { service: "ga4", status: "missing_credentials", missing: ["ZENTRY_GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN"], evidence: null, error: null },
            { service: "gtm", status: "failed", missing: [], evidence: null, error: "invalid_grant" },
            { service: "google_ads", status: "skipped", missing: [], evidence: null, error: null },
          ],
        };
        const markdown = renderGoogleProbeMarkdown(report);
        assert.match(markdown, /`live`/);
        assert.match(markdown, /`missing_credentials`/);
        assert.match(markdown, /ZENTRY_GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN/);
        assert.match(markdown, /ERROR: invalid_grant/);
        assert.match(markdown, /`skipped`/);
      },
    },

    // ---------------------------------------------------------------
    // 6. Los secretos no se imprimen
    // ---------------------------------------------------------------
    {
      name: "los secretos no se imprimen: el informe del probe no contiene el valor de ninguna credencial",
      fn: () => {
        const fakeEnv: Record<string, string | undefined> = {
          GSC_OAUTH_REFRESH_TOKEN: "1//0e-token-super-secreto-de-prueba",
          GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token-secreto-de-prueba",
          ZENTRY_GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET: "GOCSPX-secreto-de-prueba",
        };
        const report: GoogleProbeReport = {
          clientId: "zentry",
          probedAt: "2026-08-16T13:00:00.000Z",
          results: [
            { service: "search_console", status: "live", missing: [], evidence: { accessibleSiteCount: 2 }, error: null },
            { service: "ga4", status: "missing_credentials", missing: ["ZENTRY_GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET"], evidence: null, error: null },
            { service: "gtm", status: "failed", missing: [], evidence: null, error: "invalid_grant" },
            { service: "google_ads", status: "skipped", missing: [], evidence: null, error: null },
          ],
        };
        const printed = `${renderGoogleProbeMarkdown(report)}\n${JSON.stringify(report)}`;
        assert.equal(
          containsSecretValue(printed, fakeEnv, listGoogleSecretEnvVarNamesForClient("zentry")),
          null,
          "el informe del probe no puede contener el valor de ningun secreto"
        );
      },
    },
    {
      name: "los secretos no se imprimen: el guardia DETECTA una fuga real (si no, no probaria nada)",
      fn: () => {
        const fakeEnv: Record<string, string | undefined> = {
          GSC_OAUTH_REFRESH_TOKEN: "1//0e-token-super-secreto-de-prueba",
        };
        const leaked = "Search Console query fallo: refresh_token 1//0e-token-super-secreto-de-prueba rechazado";
        assert.equal(
          containsSecretValue(leaked, fakeEnv, listGoogleSecretEnvVarNamesForClient("zentry")),
          "GSC_OAUTH_REFRESH_TOKEN"
        );
      },
    },
    {
      name: "la lista de vigilancia cubre los secretos con y sin prefijo de cliente",
      fn: () => {
        const names = listGoogleSecretEnvVarNamesForClient("zentry");
        for (const secret of listGoogleSecretEnvVarNames()) {
          assert.ok(names.includes(secret), `falta ${secret} en la lista de vigilancia`);
          assert.ok(names.includes(`ZENTRY_${secret}`), `falta ZENTRY_${secret} en la lista de vigilancia`);
        }
        // Un identificador no secreto NO entra en la lista: enmascararlo
        // solo dificultaria depurar, sin ganar nada.
        assert.equal(names.includes("GA4_PROPERTY_ID"), false);
      },
    },
    {
      name: "todas las variables del catalogo Google estan clasificadas como secret o config, sin huecos",
      fn: () => {
        for (const service of GOOGLE_PROBE_SERVICES) {
          for (const key of listServiceEnvVarNames(service)) {
            assert.ok(
              GOOGLE_ENV_SENSITIVITY[key] === "secret" || GOOGLE_ENV_SENSITIVITY[key] === "config",
              `${key} (servicio ${service}) no esta clasificado en GOOGLE_ENV_SENSITIVITY`
            );
          }
        }
      },
    },

    // ---------------------------------------------------------------
    // 7. Mapeo env de los workflows
    // ---------------------------------------------------------------
    {
      name: "workflow env mapping: la pasada diaria inyecta TODOS los secretos que necesitan los watchers Google",
      fn: () => {
        const daily = readWorkflow("zentry-ai-department-daily.yml");
        const needed = [
          ...listServiceEnvVarNames("search_console"),
          ...listServiceEnvVarNames("ga4"),
          ...listServiceEnvVarNames("gtm"),
        ].filter((key) => GOOGLE_ENV_SENSITIVITY[key] === "secret");
        for (const key of new Set(needed)) {
          assert.ok(
            daily.includes(`${key}: \${{ secrets.${key} }}`),
            `zentry-ai-department-daily.yml no inyecta ${key} desde secrets`
          );
        }
      },
    },
    {
      name: "workflow env mapping: el probe inyecta los secretos de los cuatro servicios, incluido Google Ads",
      fn: () => {
        const probe = readWorkflow("google-live-probe.yml");
        const needed = GOOGLE_PROBE_SERVICES.flatMap((service) => listServiceEnvVarNames(service)).filter(
          (key) => GOOGLE_ENV_SENSITIVITY[key] === "secret"
        );
        for (const key of new Set(needed)) {
          assert.ok(probe.includes(`${key}: \${{ secrets.${key} }}`), `google-live-probe.yml no inyecta ${key}`);
        }
      },
    },
    {
      name: "workflow env mapping: los identificadores NO secretos no se duplican como secrets (ya estan en clients/zentry/)",
      fn: () => {
        const daily = readWorkflow("zentry-ai-department-daily.yml");
        const probe = readWorkflow("google-live-probe.yml");
        const configKeys = Object.keys(GOOGLE_ENV_SENSITIVITY).filter((k) => GOOGLE_ENV_SENSITIVITY[k] === "config");
        for (const key of configKeys) {
          assert.equal(daily.includes(`secrets.${key}`), false, `${key} es configuracion, no un secreto duplicado`);
          assert.equal(probe.includes(`secrets.${key}`), false, `${key} es configuracion, no un secreto duplicado`);
        }
      },
    },
    {
      name: "no hay fallback silencioso a mock: la pasada diaria fija SEO_DATA_SOURCE y exige lectura real",
      fn: () => {
        const daily = readWorkflow("zentry-ai-department-daily.yml");
        assert.match(daily, /SEO_DATA_SOURCE: search_console/);
        assert.match(daily, /npm run seo:watch -- --departmentRunId "\$DEPARTMENT_RUN_ID" --require-live/);
        assert.match(daily, /npm run analytics:watch -- --departmentRunId "\$DEPARTMENT_RUN_ID" --require-live/);
      },
    },
    {
      name: "los especialistas reciben DEPARTMENT_RUN_ID: sin el no podrian distinguir un snapshot live de uno heredado",
      fn: () => {
        const daily = readWorkflow("zentry-ai-department-daily.yml");
        const seoStep = daily.slice(daily.indexOf("[SEO] Runner (paso 1)"), daily.indexOf("[SEO] Parsear RUNNER_RESULT_JSON (paso 1)"));
        assert.match(seoStep, /DEPARTMENT_RUN_ID: \$\{\{ steps\.run\.outputs\.departmentRunId \}\}/);
        const analyticsStep = daily.slice(
          daily.indexOf("[ANALYTICS] Runner (paso 1)"),
          daily.indexOf("[ANALYTICS] Parsear RUNNER_RESULT_JSON (paso 1)")
        );
        assert.match(analyticsStep, /DEPARTMENT_RUN_ID: \$\{\{ steps\.run\.outputs\.departmentRunId \}\}/);
      },
    },
    {
      name: "el probe live es de solo lectura: permisos minimos y sin ningun trigger que escriba",
      fn: () => {
        const probe = readWorkflow("google-live-probe.yml");
        assert.match(probe, /permissions:\s*\n\s*contents: read/);
        assert.equal(probe.includes("contents: write"), false);
        assert.equal(probe.includes("id-token: write"), false);
      },
    },

    // ---------------------------------------------------------------
    // 8. Higiene de credenciales y diagnostico de errores OAuth
    // ---------------------------------------------------------------
    {
      name: "una credencial con espacios o salto de linea se recorta: un secreto mal pegado no puede dar invalid_client",
      fn: () => {
        withEnv({ GSC_OAUTH_CLIENT_ID: "  abc123.apps.googleusercontent.com\n" }, () => {
          assert.equal(resolveClientEnvVar("zentry", "GSC_OAUTH_CLIENT_ID"), "abc123.apps.googleusercontent.com");
        });
      },
    },
    {
      name: "una credencial que solo tiene espacios cuenta como ausente, no como valor vacio",
      fn: () => {
        withEnv({ GSC_OAUTH_CLIENT_SECRET: "   ", ZENTRY_GSC_OAUTH_CLIENT_SECRET: undefined }, () => {
          assert.equal(resolveClientEnvVar("zentry", "GSC_OAUTH_CLIENT_SECRET"), undefined);
          const status = resolveClientServiceCredentials("zentry", "search_console");
          assert.ok(status.missing.includes("ZENTRY_GSC_OAUTH_CLIENT_SECRET"));
        });
      },
    },
    {
      name: "la forma prefijada tambien se recorta y sigue teniendo prioridad sobre la legacy",
      fn: () => {
        withEnv({ ZENTRY_GSC_OAUTH_CLIENT_ID: " prefijado ", GSC_OAUTH_CLIENT_ID: "legacy" }, () => {
          assert.equal(resolveClientEnvVar("zentry", "GSC_OAUTH_CLIENT_ID"), "prefijado");
        });
      },
    },
    {
      name: "invalid_client e invalid_grant se explican como causas DISTINTAS, no como el mismo fallo",
      fn: () => {
        const clientHint = explainOAuthError("Probe de GA4 fallo: invalid_client");
        const grantHint = explainOAuthError("Lectura de GA4 fallo: invalid_grant");
        assert.ok(clientHint && /CLIENT_ID\/CLIENT_SECRET/.test(clientHint));
        assert.ok(clientHint && /NO es un token caducado/.test(clientHint));
        assert.ok(grantHint && /REFRESH_TOKEN/.test(grantHint));
        assert.notEqual(clientHint, grantHint);
      },
    },
    {
      name: "un error no reconocido no inventa un diagnostico",
      fn: () => {
        assert.equal(explainOAuthError("algo raro que nadie ha visto"), null);
        assert.equal(explainOAuthError(null), null);
      },
    },
    {
      name: "el informe del probe incluye el diagnostico cuando un servicio falla por OAuth",
      fn: () => {
        const report: GoogleProbeReport = {
          clientId: "zentry",
          probedAt: "2026-08-16T15:05:42.870Z",
          results: [
            { service: "search_console", status: "live", missing: [], evidence: { accessibleSiteCount: 1 }, error: null },
            { service: "ga4", status: "failed", missing: [], evidence: null, error: "Probe de GA4 fallo: invalid_client" },
            { service: "gtm", status: "failed", missing: [], evidence: null, error: "Probe de GTM fallo: invalid_client" },
            { service: "google_ads", status: "live", missing: [], evidence: { customerId: "8369126564" }, error: null },
          ],
        };
        const markdown = renderGoogleProbeMarkdown(report);
        assert.match(markdown, /Diagnostico de los fallos/);
        assert.match(markdown, /CLIENT_ID\/CLIENT_SECRET/);
      },
    },

    // ---------------------------------------------------------------
    // 9. El catalogo de credenciales sigue siendo la unica fuente
    // ---------------------------------------------------------------
    {
      name: "el probe cubre exactamente los cuatro servicios Google del catalogo de credenciales",
      fn: () => {
        for (const service of GOOGLE_PROBE_SERVICES) {
          assert.ok(
            CLIENT_SERVICE_CREDENTIAL_KEYS[service],
            `${service} deberia existir en CLIENT_SERVICE_CREDENTIAL_KEYS`
          );
        }
        assert.deepEqual([...GOOGLE_PROBE_SERVICES], ["search_console", "ga4", "gtm", "google_ads"]);
      },
    },
  ];
}
