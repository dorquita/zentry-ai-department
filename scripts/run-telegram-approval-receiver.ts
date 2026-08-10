import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { runTelegramApprovalReceiver } from "../src/agents/telegram-approval-receiver";

/**
 * Polling MANUAL de una sola pasada (Fase O13.2b) -- lee los mensajes
 * nuevos de Telegram, procesa "approve <id>" / "reject <id>" /
 * "APROBAR PRODUCCION <shortId>", y termina.
 *
 * Fase O28.8 -- desde que existe el servicio permanente
 * (zentry-telegram-approvals.service, ver scripts/telegram-approvals-service.ts),
 * este script pasa a ser SOLO para depuracion puntual con el servicio
 * PARADO. Comprueba el mismo lockfile que usa el servicio -- si esta
 * activo, Telegram devolveria 409 Conflict si los dos hacen getUpdates
 * a la vez (mismo bot token), asi que este script se niega a arrancar
 * en vez de arriesgarse a romper el servicio permanente.
 */
const LOCK_FILE = path.join(__dirname, "..", "telegram-approvals-service.lock");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = Number(fs.readFileSync(LOCK_FILE, "utf-8").trim());
    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      console.log(
        `El servicio permanente (zentry-telegram-approvals.service, PID ${existingPid}) ya esta sondeando Telegram. No se lanza un segundo poll manual (evita 409 Conflict). Si necesitas depurar, para el servicio primero: systemctl stop zentry-telegram-approvals.service`
      );
      return;
    }
  }

  const result = await runTelegramApprovalReceiver();
  console.log("=== Telegram Approval Receiver (polling manual) ===");
  console.log(`Updates leidos: ${result.updatesFetched} | procesados: ${result.updatesProcessed}`);
  console.log(`Aprobados: ${result.approved} | Rechazados: ${result.rejected}`);
  console.log(`Confirmaciones de produccion pedidas: ${result.productionConfirmationsRequested} | confirmadas: ${result.productionConfirmed}`);
  console.log(`Feedback de rechazo guardado: ${result.feedbackRecorded} | Errores: ${result.errors}`);
  console.log(`Ignorados (chat no autorizado / sin comando / ya resuelto / expirado / ambiguo): ${result.ignored}`);
  console.log("");
  console.log("Recordatorio: esto NO ejecuta ningun cambio en WordPress/produccion. Solo actualiza el estado local de las solicitudes.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
