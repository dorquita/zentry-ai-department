import * as dotenv from "dotenv";
dotenv.config();

import { runApprovalGateway } from "../src/agents/approval-gateway";

runApprovalGateway()
  .then((result) => {
    console.log(`\nApproval Gateway — departmentRunId: ${result.departmentRunId}`);
    console.log(`Telegram activo: ${result.telegramEnabled ? "si" : "no"} (configurado: ${result.telegramConfigured ? "si" : "no"})`);
    console.log(`Solicitudes nuevas: ${result.newRequests.length}`);
    console.log(`Enviadas por Telegram: ${result.sentViaTelegram.length}`);
    console.log(`Ya pendientes de antes: ${result.alreadyPending.length}`);
    if (result.sendErrors.length > 0) {
      console.log(`Errores de envio: ${result.sendErrors.length}`);
    }
    console.log(`\nInforme: ${result.reportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Approval Gateway Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
