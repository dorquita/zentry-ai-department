import * as dotenv from "dotenv";
dotenv.config();

import { runProductionDraftExecutor } from "../src/agents/production-draft-executor";

async function main(): Promise<void> {
  const result = await runProductionDraftExecutor();
  console.log(`Production Draft Executor — departmentRunId: ${result.departmentRunId}`);
  console.log(
    `PRODUCTION_EXECUTION_ENABLED=${result.productionExecutionEnabled} PRODUCTION_DRAFTS_ENABLED=${result.productionDraftsEnabled} PRODUCTION_BACKEND=${result.productionBackend}`
  );
  console.log(`canAttemptRealWrites (las 3 a la vez): ${result.canAttemptRealWrites}`);
  console.log(`Ejecuciones nuevas (pending_approval): ${result.newPendingExecutions.length}`);
  for (const e of result.newPendingExecutions) {
    console.log(`  - executionId=${e.executionId} deploymentPlanId=${e.deploymentPlanId} keyword="${e.keyword}"`);
  }
  console.log(`Nuevas solicitudes de aprobacion de EJECUCION: ${result.newApprovalRequests} (enviadas por Telegram: ${result.sentViaTelegram})`);
  console.log(`Aprobadas esta pasada: ${result.approvedThisPass} | Canceladas/rechazadas esta pasada: ${result.cancelledThisPass}`);
  console.log(`Aplicadas de verdad esta pasada: ${result.appliedThisPass.length} | Fallidas: ${result.failedThisPass.length}`);
  console.log(`Pendientes de aprobacion de ejecucion (total): ${result.pendingApprovalCount}`);
  console.log(`Informe: ${result.reportPath}`);
  console.log("");
  if (result.canAttemptRealWrites) {
    console.log("AVISO: las 3 condiciones de escritura real estaban activas en esta pasada.");
  } else {
    console.log("Escritura real BLOQUEADA (al menos una de las 3 condiciones no esta activa). Produccion no se toco.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
