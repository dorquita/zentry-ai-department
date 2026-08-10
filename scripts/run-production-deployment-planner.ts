import * as dotenv from "dotenv";
dotenv.config();

import { runProductionDeploymentPlanner } from "../src/agents/production-deployment-planner";

async function main(): Promise<void> {
  const result = await runProductionDeploymentPlanner();
  console.log(`Production Deployment Planner — departmentRunId: ${result.departmentRunId}`);
  console.log(`Planes nuevos: ${result.newPlans.length} | Total: ${result.totalPlanCount}`);
  console.log(`Drafts omitidos (sin QA pass): ${result.skippedNoQaPass}`);
  console.log(`Nuevas solicitudes de aprobacion: ${result.newApprovalRequests} (enviadas por Telegram: ${result.sentViaTelegram})`);
  console.log(`Aprobaciones de PLAN esta pasada: ${result.planApprovedThisPass} aprobados / ${result.planRejectedThisPass} rechazados`);
  console.log(`Informe: ${result.reportPath}`);
  console.log("");
  console.log(
    'Recordatorio: produccion NO se ha tocado. "plan_approved" solo confirma el diseno. La aprobacion de EJECUCION y cualquier escritura real son responsabilidad de "npm run production:execute" (Fase O13.2), no de este agente.'
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
