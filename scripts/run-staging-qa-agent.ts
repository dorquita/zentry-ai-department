import * as dotenv from "dotenv";
dotenv.config();

import { runStagingQaAgent } from "../src/agents/staging-qa-agent";

runStagingQaAgent()
  .then((result) => {
    console.log(`\nStaging QA Agent — departmentRunId: ${result.departmentRunId}`);
    console.log(`Staging alcanzable: ${result.siteHealth.reachable} | HTTP 200: ${result.siteHealth.status200} | noindex: ${result.siteHealth.noindexPresent}`);
    console.log(`Borradores verificados: ${result.checkedCount} | Pasan: ${result.passCount} (con warning: ${result.warnCount}) | Fallan: ${result.failCount}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Staging QA Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
