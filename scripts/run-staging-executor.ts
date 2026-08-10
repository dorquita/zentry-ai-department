import * as dotenv from "dotenv";
dotenv.config();

import { runStagingExecutor } from "../src/agents/staging-executor";

runStagingExecutor()
  .then((result) => {
    console.log(`\nStaging Executor — departmentRunId: ${result.departmentRunId}`);
    console.log(`STAGING_EXECUTION_ENABLED: ${result.stagingExecutionEnabled}`);
    console.log(`WORDPRESS_DRAFTS_ENABLED: ${result.wordpressDraftsEnabled}`);
    console.log(`WORDPRESS_BACKEND: ${result.wordpressBackend}`);
    console.log(`WORDPRESS_ENV: ${result.wordpressEnv}`);
    console.log(`Puede escribir de verdad en esta pasada: ${result.canAttemptRealWrites}`);
    console.log(`Ejecuciones nuevas en cola: ${result.newPendingExecutions.length}`);
    console.log(`Aprobadas en esta pasada: ${result.approvedThisPass.length} | Rechazadas: ${result.rejectedThisPass.length}`);
    console.log(`Aplicadas en esta pasada: ${result.appliedThisPass.length} (total acumulado: ${result.totalAppliedCount})`);
    console.log(`Fallidas: ${result.failedThisPass.length}`);
    console.log(`Pendientes de aprobacion: ${result.pendingApprovalCount}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Staging Executor Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
