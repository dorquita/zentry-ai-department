import * as dotenv from "dotenv";
dotenv.config();

import { runVisualTemplateBuilder } from "../src/agents/visual-template-builder";

runVisualTemplateBuilder()
  .then((result) => {
    console.log(`\nVisual Template Builder — departmentRunId: ${result.departmentRunId}`);
    console.log(`Previews visuales nuevos: ${result.newVisualPreviews.length}`);
    console.log(`Total previews visuales: ${result.totalVisualPreviewCount}`);
    console.log(`Change packs sin preview de texto todavia: ${result.skippedNoDraftYet}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Visual Template Builder Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
