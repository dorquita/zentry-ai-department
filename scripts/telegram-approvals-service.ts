import * as dotenv from "dotenv";
dotenv.config();
import * as fs from "fs";
import * as path from "path";
import { runTelegramApprovalReceiver } from "../src/agents/telegram-approval-receiver";
import { isTelegramApprovalsEnabled } from "../src/core/telegram-gateway";
import { logger } from "../src/core/logger";

/**
 * Fase O28.8 -- servicio PERMANENTE (pensado para systemd, ver
 * zentry-telegram-approvals.service) que sustituye al sondeo manual
 * (`npm run telegram:approvals:poll`) para que los botones de Telegram
 * respondan casi al instante. Usa long polling REAL de Telegram
 * (`timeout: LONG_POLL_SECONDS` en getUpdates) -- la peticion HTTP queda
 * abierta en el lado de Telegram hasta que llega una actualizacion o
 * pasa ese tiempo, asi que no hace falta sondear en bucle corto (nada de
 * `sleep` entre pasadas cuando hay actividad).
 *
 * Instancia unica: un lockfile con el PID evita que este proceso y un
 * `npm run telegram:approvals:poll` manual corran a la vez -- Telegram
 * responde 409 Conflict si dos procesos hacen getUpdates en paralelo con
 * el mismo bot token, lo que romperia ambos.
 *
 * NUNCA toca WordPress/produccion directamente -- delega TODO el trabajo
 * real a runTelegramApprovalReceiver() (mismo codigo, mismas garantias,
 * ya usado y probado por el poll manual).
 */

const LONG_POLL_SECONDS = 25;
const ERROR_BACKOFF_MS = 5000;
const LOCK_FILE = path.join(__dirname, "..", "telegram-approvals-service.lock");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): boolean {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = Number(fs.readFileSync(LOCK_FILE, "utf-8").trim());
    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      return false;
    }
    // Lock obsoleto (el proceso que lo creo ya no existe) -- se limpia y se continua.
    logger.warn("Telegram Approvals Service: lockfile obsoleto encontrado, se limpia", { previousPid: existingPid });
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid), "utf-8");
  return true;
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE) && fs.readFileSync(LOCK_FILE, "utf-8").trim() === String(process.pid)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // no bloquear el apagado por un fallo limpiando el lock
  }
}

let running = true;
function requestStop(signal: string): void {
  logger.info(`Telegram Approvals Service: señal ${signal} recibida, parando tras la pasada actual`);
  running = false;
}
process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("SIGINT", () => requestStop("SIGINT"));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!acquireLock()) {
    logger.error("Telegram Approvals Service: ya hay otra instancia activa (lockfile), no se arranca una segunda.");
    process.exit(1);
  }
  process.on("exit", releaseLock);

  if (!isTelegramApprovalsEnabled()) {
    logger.info("Telegram Approvals Service: TELEGRAM_APPROVALS_ENABLED != true. El servicio queda inactivo (sin sondear) hasta que se active.");
  }

  logger.info("Telegram Approvals Service: arrancado (long polling, modo permanente)", { longPollSeconds: LONG_POLL_SECONDS, pid: process.pid });

  while (running) {
    if (!isTelegramApprovalsEnabled()) {
      // Se comprueba en cada vuelta -- si alguien desactiva el flag en
      // caliente, el servicio deja de sondear sin necesitar reiniciarlo,
      // y vuelve a sondear solo si se reactiva.
      await sleep(30000);
      continue;
    }
    try {
      const result = await runTelegramApprovalReceiver({ longPollSeconds: LONG_POLL_SECONDS });
      if (result.updatesProcessed > 0) {
        logger.info("Telegram Approvals Service: pasada con actividad", { ...result });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Telegram Approvals Service: fallo en una pasada, se reintenta tras una pausa", { error: message });
      await sleep(ERROR_BACKOFF_MS);
    }
  }

  logger.info("Telegram Approvals Service: parado limpiamente.");
  releaseLock();
}

main().catch((err) => {
  logger.error("Telegram Approvals Service: error fatal no capturado", { error: err instanceof Error ? err.message : String(err) });
  releaseLock();
  process.exit(1);
});
