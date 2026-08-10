import * as dotenv from "dotenv";
dotenv.config();

import { runVisualAssetPlanner } from "../src/agents/visual-asset-planner";

runVisualAssetPlanner()
  .then((result) => {
    console.log(`\nVisual Asset Planner — departmentRunId: ${result.departmentRunId}`);
    console.log(`Peticiones nuevas: ${result.newAssetRequests.length}`);
    console.log(`Total propuestas acumuladas: ${result.totalAssetRequestCount}`);
    console.log(`n8n configurado (igualmente no llamado): ${result.n8nConfigured}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Visual Asset Planner Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
