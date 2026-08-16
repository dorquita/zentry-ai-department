import * as dotenv from "dotenv";
dotenv.config();

import { runSeoWatcher } from "../src/agents/seo-watcher";
import { resolveDataSource } from "../src/adapters";

/**
 * Fase O50 — dos flags nuevas, ambas pensadas para que este watcher pueda
 * correr DENTRO de la pasada de GitHub Actions y no solo en el VPS:
 *
 *   --departmentRunId <id>  Cuelga esta lectura de la pasada en curso, en
 *     vez de abrir un departmentRunId propio. Es lo que permite que
 *     seo-specialist demuestre despues que su snapshot es de ESTA pasada
 *     (ver src/core/snapshot-freshness.ts) y no del ultimo commit del VPS.
 *
 *   --require-live  Fail-closed: aborta ANTES de leer nada si la fuente
 *     configurada no es la API real de Search Console. Sin esta flag,
 *     `SEO_DATA_SOURCE` sin configurar cae a "mock" (datos de ejemplo de
 *     data/sample-search-console-data.json) — util en local, pero
 *     inaceptable en una pasada automatica, donde produciria jobs de
 *     mentira indistinguibles de los buenos a simple vista.
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

if (args["require-live"] === "true") {
  const dataSource = resolveDataSource();
  if (dataSource !== "search_console") {
    console.error(
      `--require-live exige leer la API real de Search Console, pero SEO_DATA_SOURCE resuelve a "${dataSource}". ` +
        `Fail-closed: no se generan jobs con el adaptador placeholder en una pasada automatica. ` +
        `Configura SEO_DATA_SOURCE=search_console y las credenciales GSC_OAUTH_* del cliente activo.`
    );
    process.exit(1);
  }
}

runSeoWatcher(departmentRunId)
  .then((result) => {
    console.log(`\nrunId: ${result.runId}`);
    console.log(`departmentRunId: ${result.departmentRunId}`);
    console.log(`Resumen: ${result.jobs.length} oportunidad(es) SEO detectada(s) (${result.rowsRead} fila(s) leidas).`);
    for (const job of result.jobs) {
      const o = job.opportunity;
      const target =
        typeof o.targetPosition === "number" ? Number(o.targetPosition.toFixed(1)) : o.targetPosition;
      console.log(
        `- [${o.kind}] "${o.keyword}" (${o.currentPosition.toFixed(1)} -> ${target}) prioridad=${o.priority} riesgo=${o.risk} aprobacion_requerida=${o.requiresApproval}`
      );
    }
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("SEO Watcher Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
