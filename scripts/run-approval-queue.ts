import * as dotenv from "dotenv";
dotenv.config();

import { runApprovalQueue } from "../src/agents/approval-queue";

runApprovalQueue()
  .then((result) => {
    console.log(`\nApproval Queue — departmentRunId: ${result.departmentRunId}`);
    console.log(`Nuevas: ${result.newActions.length}`);
    console.log(`Recurrentes/abiertas: ${result.recurringOpenActions.length}`);
    console.log(`Pendientes de aprobacion: ${result.waitingApprovalActions.length}`);
    console.log(`Aprobadas sin ejecutar: ${result.approvedNotDoneActions.length}`);
    console.log(`Snoozed: ${result.snoozedActions.length} | Rechazadas: ${result.rejectedActions.length} | Hechas: ${result.doneActions.length}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Approval Queue Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
