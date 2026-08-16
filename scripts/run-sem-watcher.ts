import * as dotenv from "dotenv";
dotenv.config();

import { runSemWatcher } from "../src/agents/sem-watcher";

/**
 * Fase O51 — dos flags nuevas, para poder ejecutar este watcher DENTRO de
 * la pasada de GitHub Actions y no solo en el VPS:
 *
 *   --departmentRunId <id>  Cuelga la lectura de Google Ads de la pasada
 *     en curso, para que sem-specialist pueda demostrar despues que su
 *     snapshot es de ESTA pasada (ver src/core/snapshot-freshness.ts).
 *
 *   --require-live  Fail-closed: si la lectura real de Google Ads no se
 *     completo (credenciales ausentes, cuenta sin campanas, o error de la
 *     API), sale con codigo != 0. Sin esta flag, `runSemWatcher()` cae de
 *     forma deliberada al estado documentado en
 *     `config/sem-campaign-state.json` y sigue adelante — razonable en
 *     local, pero en una pasada automatica significa un informe basado en
 *     un fichero de configuracion que aguas abajo puede leerse como si
 *     fuera la cuenta real.
 *
 * SOLO LECTURA en cualquier caso: este watcher no puede activar, pausar,
 * crear ni modificar ninguna campana, presupuesto, keyword ni anuncio —
 * el adaptador que usa no contiene una sola llamada `:mutate`.
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

runSemWatcher(departmentRunId)
  .then((result) => {
    console.log(`\nSEM Watcher — departmentRunId: ${result.departmentRunId}`);
    console.log(`Conectado a Google Ads: ${result.connected}`);
    console.log(`Estado de campana: ${result.campaignState.status} (${result.campaignState.statusReason})`);
    console.log(`Candidatas SEM detectadas: ${result.semCandidates.length}`);
    if (result.adsSnapshot) {
      console.log(
        `Ventana de metricas: ${result.adsSnapshot.metricsStartDate}..${result.adsSnapshot.metricsEndDate}` +
          ` | campanas=${result.adsSnapshot.campaigns.length}` +
          ` | terminos de busqueda=${result.adsSnapshot.searchTerms.length}`
      );
      console.log(`Lectura real de Google Ads: ${result.adsSnapshot.generatedAt}`);
    }
    result.warnings.forEach((w) => console.log(`  - warning: ${w}`));
    console.log(`\nInforme: ${result.reportPath}`);

    if (requireLive && !result.connected) {
      console.error(
        `--require-live exige una lectura real de Google Ads, pero connected=false. ` +
          `Fail-closed: el informe se ha escrito igualmente (con su estado real), pero esta pasada NO puede presentarse ` +
          `como lectura live de la cuenta. Revisa los warnings de arriba: dicen que NOMBRES de variable faltan, nunca sus valores.`
      );
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("SEM Watcher Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
