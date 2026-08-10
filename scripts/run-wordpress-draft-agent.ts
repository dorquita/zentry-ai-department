import * as dotenv from "dotenv";
dotenv.config();

import { runWordpressDraftAgent } from "../src/agents/wordpress-draft-agent";

runWordpressDraftAgent()
  .then((result) => {
    console.log(`\nWordPress Draft Agent — departmentRunId: ${result.departmentRunId}`);
    console.log(`WORDPRESS_DRAFTS_ENABLED: ${result.wordpressDraftsEnabled}`);
    console.log(`WORDPRESS_BACKEND: ${result.wordpressBackend}`);
    console.log(`WORDPRESS_ENV: ${result.wordpressEnv}`);
    console.log(`Destino WordPress resuelto: ${result.wordpressTargetUrl ?? "(no configurado)"}`);
    console.log(`Previews locales nuevos: ${result.newLocalPreviews.length} (total: ${result.totalLocalPreviewCount})`);
    console.log(`Borradores WordPress nuevos: ${result.newWordpressDrafts.length} (total: ${result.totalWordpressDraftCount})`);
    console.log(`Solicitudes de aprobacion nuevas: ${result.newApprovalRequests.length}, pendientes: ${result.pendingApprovalCount}`);
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("WordPress Draft Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
