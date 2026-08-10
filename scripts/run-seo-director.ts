import * as dotenv from "dotenv";
dotenv.config();

import { runSeoDirector } from "../src/agents/seo-director";

runSeoDirector()
  .then((result) => {
    console.log(`\nSEO Director — basado en runId: ${result.sourceRunId}`);
    console.log(`Informe base (SEO Watcher): ${result.sourceReportPath}`);
    console.log(`Acciones generadas: ${result.items.length}`);
    result.items.slice(0, 5).forEach((item, i) => {
      console.log(
        `${i + 1}. [${item.priority}] "${item.keyword}" (${item.page}) — esfuerzo=${item.effort} impacto=${item.impact} wordpress=${item.requiresWordPress} contenido_nuevo=${item.requiresNewContent}`
      );
    });
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("SEO Director Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
