import * as dotenv from "dotenv";
dotenv.config();

import { runSemWatcher } from "../src/agents/sem-watcher";

runSemWatcher()
  .then((result) => {
    console.log(`\nSEM Watcher — departmentRunId: ${result.departmentRunId}`);
    console.log(`Conectado a Google Ads: ${result.connected}`);
    console.log(`Estado de campana: ${result.campaignState.status} (${result.campaignState.statusReason})`);
    console.log(`Candidatas SEM detectadas: ${result.semCandidates.length}`);
    result.warnings.forEach((w) => console.log(`  - warning: ${w}`));
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("SEM Watcher Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
