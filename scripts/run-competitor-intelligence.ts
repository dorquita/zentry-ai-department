import * as dotenv from "dotenv";
dotenv.config();

import { runCompetitorIntelligence } from "../src/agents/competitor-intelligence";

runCompetitorIntelligence()
  .then((result) => {
    console.log(`\nCompetitor Intelligence — departmentRunId: ${result.departmentRunId}`);
    console.log(`Paginas leidas con exito: ${result.pages.filter((p) => p.status === "ok").length} de ${result.pages.length}`);
    console.log(`Gaps de keyword: ${result.keywordGaps.length}`);
    console.log(`Gaps de contenido (sector/material): ${result.contentGaps.length}`);
    console.log(`Warnings: ${result.warnings.length}`);
    result.warnings.forEach((w) => console.log(`  - ${w}`));
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Competitor Intelligence Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
