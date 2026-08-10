import * as dotenv from "dotenv";
dotenv.config();

import { runCroLandingReviewer } from "../src/agents/cro-landing-reviewer";

runCroLandingReviewer()
  .then((result) => {
    console.log(`\nCRO / Landing Reviewer — departmentRunId: ${result.departmentRunId}`);
    console.log(`Landings revisadas: ${result.reviews.length}`);
    for (const review of result.reviews) {
      console.log(`- [${review.priority}] ${review.page} — ${review.recommendations.length} recomendacion(es)`);
    }
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("CRO / Landing Reviewer Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
