import * as dotenv from "dotenv";
dotenv.config();

import { runContentWorkOrderBuilder } from "../src/agents/content-work-order-builder";

runContentWorkOrderBuilder()
  .then((result) => {
    console.log(`\nContent Work Order Builder — departmentRunId: ${result.departmentRunId}`);
    console.log(`Briefs generados: ${result.enrichedWorkOrders.length}`);
    for (const wo of result.enrichedWorkOrders) {
      console.log(`- [${wo.priority}] ${wo.workOrderId} — ${wo.sourceActionTitle}`);
    }
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Content Work Order Builder fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
