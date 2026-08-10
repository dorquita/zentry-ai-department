import * as dotenv from "dotenv";
dotenv.config();

import { runSeoWorkOrderBuilder } from "../src/agents/seo-work-order-builder";

runSeoWorkOrderBuilder()
  .then((result) => {
    console.log(`\nSEO Work Order Builder — departmentRunId: ${result.departmentRunId}`);
    console.log(`Work orders ampliadas: ${result.enrichedWorkOrders.length}`);
    for (const wo of result.enrichedWorkOrders) {
      console.log(`- [${wo.priority}] ${wo.workOrderId} — ${wo.sourceActionTitle}`);
    }
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("SEO Work Order Builder fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
