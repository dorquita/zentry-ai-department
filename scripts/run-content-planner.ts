import * as dotenv from "dotenv";
dotenv.config();

import { runContentPlanner } from "../src/agents/content-planner";

runContentPlanner()
  .then((result) => {
    console.log(`\nContent Planner — departmentRunId: ${result.departmentRunId}`);
    console.log(`Propuestas de contenido: ${result.items.length}`);
    for (const item of result.items.slice(0, 10)) {
      console.log(`- [${item.targetBrand}] [${item.priority}] ${item.type}: ${item.title}`);
    }
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Content Planner Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
