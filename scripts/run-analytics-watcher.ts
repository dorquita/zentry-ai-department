import * as dotenv from "dotenv";
dotenv.config();

import { runAnalyticsWatcher } from "../src/agents/analytics-watcher";

/**
 * Fase O50 — dos flags nuevas, para poder ejecutar este watcher DENTRO de
 * la pasada de GitHub Actions y no solo en el VPS:
 *
 *   --departmentRunId <id>  Cuelga la lectura de GA4/GTM de la pasada en
 *     curso, para que analytics-specialist pueda demostrar despues que su
 *     snapshot es de ESTA pasada (ver src/core/snapshot-freshness.ts).
 *
 *   --require-live  Fail-closed: si GA4 o GTM NO quedaron conectados de
 *     verdad (credenciales ausentes o la lectura fallo), sale con codigo
 *     != 0. Sin esta flag, runAnalyticsWatcher() escribe igualmente un
 *     informe con `ga4Connected=false` y sigue adelante — que es lo
 *     razonable en local, pero en una pasada automatica significa un
 *     informe sin datos reales que aguas abajo puede leerse como si los
 *     tuviera.
 */
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

const args = parseArgs(process.argv.slice(2));
const departmentRunId = args.departmentRunId && args.departmentRunId !== "true" ? args.departmentRunId : undefined;
const requireLive = args["require-live"] === "true";

runAnalyticsWatcher(departmentRunId)
  .then((result) => {
    console.log(`\nAnalytics Watcher — departmentRunId: ${result.departmentRunId}`);
    console.log(`GA4 conectado: ${result.ga4Connected} | GTM conectado: ${result.gtmConnected}`);
    console.log(`Eventos clave documentados: ${result.keyEvents.length}`);
    result.warnings.forEach((w) => console.log(`  - warning: ${w}`));
    console.log(`\nInforme: ${result.reportPath}`);

    if (requireLive && (!result.ga4Connected || !result.gtmConnected)) {
      console.error(
        `--require-live exige lectura real de AMBOS: GA4 conectado=${result.ga4Connected}, GTM conectado=${result.gtmConnected}. ` +
          `Fail-closed: el informe se ha escrito igualmente (con su estado real), pero esta pasada no puede presentarse como lectura live. ` +
          `Revisa los warnings de arriba: dicen que NOMBRES de variable faltan, nunca sus valores.`
      );
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Analytics Watcher Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
