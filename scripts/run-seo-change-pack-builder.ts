import * as dotenv from "dotenv";
dotenv.config();

import { runSeoChangePackBuilder } from "../src/agents/seo-change-pack-builder";

runSeoChangePackBuilder()
  .then((result) => {
    console.log(`\nSEO Change Pack Builder — departmentRunId: ${result.departmentRunId}`);
    console.log(`Nuevos: ${result.newChangePacks.length}`);
    console.log(`Ya existentes: ${result.alreadyExisting.length}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("SEO Change Pack Builder fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
