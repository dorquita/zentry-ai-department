/**
 * Fase O50 — probe LIVE de las integraciones Google, SOLO LECTURA.
 *
 * Sirve para responder con evidencia, y no por deduccion, a la pregunta
 * "¿este entorno (GitHub Actions o VPS) puede leer de verdad de Search
 * Console / GA4 / GTM / Google Ads?".
 *
 * GARANTIAS:
 * - CERO escrituras. Cada adaptador expone una unica funcion `probe*`
 *   que llama al metodo de consulta mas pequeno posible de su API
 *   (`sites.list`, `runReport` con una metrica, `accounts.list`,
 *   `SELECT ... FROM customer LIMIT 1`). Ninguno de esos adaptadores
 *   contiene una sola llamada de mutacion.
 * - CERO valores de credenciales impresos. Solo se imprimen NOMBRES de
 *   variables, estados, y el dato devuelto por la API. Antes de escribir
 *   nada se verifica ademas que la salida construida no contenga el
 *   valor de ninguna variable sensible (`containsSecretValue`).
 * - Si faltan credenciales NO se inventa nada ni se cae a un modo mock:
 *   el servicio queda en `missing_credentials` con los nombres exactos
 *   que faltan.
 *
 * Uso:
 *   npm run probe:google
 *   npm run probe:google -- --services search_console,ga4
 *   npm run probe:google -- --require search_console,ga4   # fail-closed
 */
import * as dotenv from "dotenv";
dotenv.config();

import { containsSecretValue } from "../src/department/email-config";
import { resolveActiveClientId, resolveClientServiceCredentials } from "../src/core/client-config";
import {
  GOOGLE_PROBE_SERVICES,
  GoogleProbeReport,
  GoogleProbeService,
  GoogleProbeServiceResult,
  listGoogleSecretEnvVarNamesForClient,
  listNotLiveRequiredServices,
  renderGoogleProbeMarkdown,
  resolveProbeExitCode,
} from "../src/core/google-live-probe";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

function parseServiceList(raw: string | undefined, label: string): GoogleProbeService[] {
  if (!raw || raw === "true") return [];
  const parsed: GoogleProbeService[] = [];
  for (const chunk of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!(GOOGLE_PROBE_SERVICES as readonly string[]).includes(chunk)) {
      throw new Error(
        `${label} desconocido: "${chunk}". Valores validos: ${GOOGLE_PROBE_SERVICES.join(", ")}.`
      );
    }
    parsed.push(chunk as GoogleProbeService);
  }
  return parsed;
}

/**
 * Una llamada real por servicio, cargada de forma perezosa: si un
 * servicio no tiene credenciales completas su adaptador ni siquiera se
 * importa, asi que no hay ninguna posibilidad de que se construya un
 * cliente OAuth a medias.
 */
async function runServiceProbe(
  service: GoogleProbeService
): Promise<Record<string, string | number | boolean>> {
  if (service === "search_console") {
    const { probeSearchConsole } = await import("../src/adapters/search-console");
    const result = await probeSearchConsole();
    return {
      authMethod: result.authMethod,
      configuredSiteUrl: result.configuredSiteUrl,
      accessibleSiteCount: result.accessibleSiteCount,
      configuredSiteIsAccessible: result.configuredSiteIsAccessible,
    };
  }
  if (service === "ga4") {
    const { probeGa4 } = await import("../src/adapters/ga4");
    const result = await probeGa4();
    return {
      propertyId: result.propertyId,
      window: `${result.startDate}..${result.endDate}`,
      sessions: result.sessions,
    };
  }
  if (service === "gtm") {
    const { probeGtm } = await import("../src/adapters/gtm");
    const result = await probeGtm();
    return {
      accountId: result.accountId,
      containerId: result.containerId,
      containerName: result.containerName,
      containerPublicId: result.containerPublicId,
    };
  }
  const { probeGoogleAds } = await import("../src/adapters/google-ads");
  const result = await probeGoogleAds();
  return {
    customerId: result.customerId,
    descriptiveName: result.descriptiveName,
    currencyCode: result.currencyCode,
    timeZone: result.timeZone,
  };
}

async function probeService(
  clientId: string,
  service: GoogleProbeService
): Promise<GoogleProbeServiceResult> {
  const credentials = resolveClientServiceCredentials(clientId, service);
  if (!credentials.complete) {
    return { service, status: "missing_credentials", missing: credentials.missing, evidence: null, error: null };
  }
  try {
    const evidence = await runServiceProbe(service);
    return { service, status: "live", missing: [], evidence, error: null };
  } catch (err) {
    // El mensaje ya viene saneado por el adaptador (sanitizeError), que
    // es quien conoce la forma de los errores de su propia API.
    const message = err instanceof Error ? err.message : String(err);
    return { service, status: "failed", missing: [], evidence: null, error: message };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const requested = parseServiceList(args.services, "--services");
  const required = parseServiceList(args.require, "--require");
  const services = requested.length > 0 ? requested : [...GOOGLE_PROBE_SERVICES];

  const clientId = resolveActiveClientId();
  const results: GoogleProbeServiceResult[] = [];
  for (const service of services) {
    results.push(await probeService(clientId, service));
  }
  for (const service of GOOGLE_PROBE_SERVICES) {
    if (!services.includes(service)) {
      results.push({ service, status: "skipped", missing: [], evidence: null, error: null });
    }
  }
  // Orden estable = el canonico de GOOGLE_PROBE_SERVICES, no el de la CLI.
  results.sort(
    (a, b) => GOOGLE_PROBE_SERVICES.indexOf(a.service) - GOOGLE_PROBE_SERVICES.indexOf(b.service)
  );

  const report: GoogleProbeReport = { clientId, probedAt: new Date().toISOString(), results };
  const markdown = renderGoogleProbeMarkdown(report);
  const resultJson = JSON.stringify(report);

  // Ultima linea de defensa antes de imprimir: si por lo que sea el
  // valor de un secreto se hubiera colado en un mensaje de error, aqui
  // se corta la ejecucion en vez de publicarlo en el log del workflow.
  const leak = containsSecretValue(
    `${markdown}\n${resultJson}`,
    process.env,
    listGoogleSecretEnvVarNamesForClient(clientId)
  );
  if (leak) {
    console.error(
      `ABORTADO: la salida del probe contenia el valor de ${leak}. No se imprime nada. Revisa el saneado de errores del adaptador correspondiente.`
    );
    process.exit(2);
  }

  console.log(markdown);
  console.log("");
  console.log(`PROBE_RESULT_JSON=${resultJson}`);

  const notLive = listNotLiveRequiredServices(report, required);
  if (notLive.length > 0) {
    console.error(
      `Servicios exigidos que NO quedaron live en esta pasada: ${notLive.join(", ")}. Fail-closed: no se continua con datos de otra procedencia.`
    );
  }
  process.exit(resolveProbeExitCode(report, required));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
