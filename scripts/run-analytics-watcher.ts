import * as dotenv from "dotenv";
dotenv.config();

import { runAnalyticsWatcher } from "../src/agents/analytics-watcher";

runAnalyticsWatcher()
  .then((result) => {
    console.log(`\nAnalytics Watcher — departmentRunId: ${result.departmentRunId}`);
    console.log(`GA4 conectado: ${result.ga4Connected} | GTM conectado: ${result.gtmConnected}`);
    console.log(`Eventos clave documentados: ${result.keyEvents.length}`);
    result.warnings.forEach((w) => console.log(`  - warning: ${w}`));
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Analytics Watcher Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
