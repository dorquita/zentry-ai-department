import * as dotenv from "dotenv";
dotenv.config();

import { runCroChangePackBuilder } from "../src/agents/cro-change-pack-builder";

runCroChangePackBuilder()
  .then((result) => {
    console.log(`\nCRO Change Pack Builder — departmentRunId: ${result.departmentRunId}`);
    console.log(`Nuevos: ${result.newChangePacks.length}`);
    console.log(`Ya existentes: ${result.alreadyExisting.length}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("CRO Change Pack Builder fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
