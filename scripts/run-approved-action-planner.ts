import * as dotenv from "dotenv";
dotenv.config();

import { runApprovedActionPlanner } from "../src/agents/approved-action-planner";

runApprovedActionPlanner()
  .then((result) => {
    console.log(`\nApproved Action Planner — departmentRunId: ${result.departmentRunId}`);
    console.log(`Acciones approved encontradas: ${result.approvedActionCount}`);
    console.log(`Work orders nuevas: ${result.newWorkOrders.length}`);
    console.log(`Ya planificadas: ${result.alreadyPlanned.length}`);
    console.log("Por categoria:", result.byCategory);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Approved Action Planner Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
