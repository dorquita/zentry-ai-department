import * as dotenv from "dotenv";
dotenv.config();

import { runTelegramApprovalReceiver } from "../src/agents/telegram-approval-receiver";

/**
 * Polling MANUAL de una sola pasada (Fase O13.2b) -- lee los mensajes
 * nuevos de Telegram, procesa "approve <id>" / "reject <id>" /
 * "APROBAR PRODUCCION <shortId>", y termina. NO es un servicio
 * permanente: no hay bucle, no hay systemd/cron todavia. Hay que
 * volver a ejecutar `npm run telegram:approvals:poll` cada vez que se
 * quiera comprobar si hay respuestas nuevas.
 */
async function main(): Promise<void> {
  const result = await runTelegramApprovalReceiver();
  console.log("=== Telegram Approval Receiver (polling manual) ===");
  console.log(`Updates leidos: ${result.updatesFetched} | procesados: ${result.updatesProcessed}`);
  console.log(`Aprobados: ${result.approved} | Rechazados: ${result.rejected}`);
  console.log(`Confirmaciones de produccion pedidas: ${result.productionConfirmationsRequested} | confirmadas: ${result.productionConfirmed}`);
  console.log(`Ignorados (chat no autorizado / sin comando / ya resuelto / expirado / ambiguo): ${result.ignored}`);
  console.log("");
  console.log("Recordatorio: esto NO ejecuta ningun cambio en WordPress/produccion. Solo actualiza el estado local de las solicitudes.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
