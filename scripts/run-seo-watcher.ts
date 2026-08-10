import * as dotenv from "dotenv";
dotenv.config();

import { runSeoWatcher } from "../src/agents/seo-watcher";

runSeoWatcher()
  .then((result) => {
    console.log(`\nrunId: ${result.runId}`);
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
