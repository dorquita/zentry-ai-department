import * as dotenv from "dotenv";
dotenv.config();

import { runUxUiLandingArchitect } from "../src/agents/ux-ui-landing-architect";

async function main(): Promise<void> {
  const result = await runUxUiLandingArchitect();
  console.log(`UX/UI Landing Architect — departmentRunId: ${result.departmentRunId}`);
  console.log(`Blueprints nuevos: ${result.newBlueprints.length} | Total: ${result.totalBlueprintCount}`);
  console.log(`Informe: ${result.reportPath}`);
  console.log("");
  console.log("Recordatorio: solo planificacion de estructura. WordPress/produccion/n8n/qdrant no se tocan.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
