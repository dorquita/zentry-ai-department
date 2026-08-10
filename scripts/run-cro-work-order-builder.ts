import * as dotenv from "dotenv";
dotenv.config();

import { runCroWorkOrderBuilder } from "../src/agents/cro-work-order-builder";

runCroWorkOrderBuilder()
  .then((result) => {
    console.log(`\nCRO Work Order Builder — departmentRunId: ${result.departmentRunId}`);
    console.log(`Propuestas generadas: ${result.enrichedWorkOrders.length}`);
    for (const wo of result.enrichedWorkOrders) {
      console.log(`- [${wo.priority}] ${wo.workOrderId} — ${wo.sourceActionTitle}`);
    }
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("CRO Work Order Builder fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
