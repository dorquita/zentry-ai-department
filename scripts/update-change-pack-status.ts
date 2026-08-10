/**
 * Cambia el status de un change pack local. NO ejecuta ningun cambio
 * real: solo actualiza el estado local (nueva instantanea append-only).
 *
 * IMPORTANTE: "approved_to_execute" NO significa publicar ni ejecutar
 * nada. Solo significa que Pau aceptaria que esto se ejecute el dia que
 * exista un modo de ejecucion controlada (que hoy no existe). Este
 * comando nunca cascada a la work order ni a la accion relacionadas —
 * change packs es una capa de empaquetado, no un mecanismo de ejecucion.
 *
 * Uso:
 *   npm run change-packs:update -- --changePackId <id> --status approved_to_execute
 *   npm run change-packs:update -- --changePackId <id> --status rejected --reason "..."
 *   npm run change-packs:update -- --changePackId <id> --status applied_manually
 */
import * as dotenv from "dotenv";
dotenv.config();

import { findChangePackById, isValidChangePackStatus, setChangePackStatus } from "../src/core/change-packs";
import { logger } from "../src/core/logger";
import { CHANGE_PACK_STATUSES } from "../src/core/types";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const changePackId = args.changePackId;
  const newStatus = args.status;
  const reason = args.reason;
  const changedBy = args.by ?? "cli";

  if (!changePackId) {
    console.error('Falta --changePackId <id>. Usa "npm run change-packs:list" para ver los IDs disponibles.');
    process.exit(1);
  }

  if (!newStatus || !isValidChangePackStatus(newStatus)) {
    console.error(`--status invalido o ausente. Validos: ${CHANGE_PACK_STATUSES.join(", ")}`);
    process.exit(1);
  }

  const existing = findChangePackById(changePackId);
  if (!existing) {
    console.error(`No existe ningun change pack con changePackId="${changePackId}".`);
    process.exit(1);
  }

  const previousStatus = existing.status;

  if (previousStatus === newStatus) {
    console.log(`Sin cambios: "${changePackId}" ya estaba en status "${newStatus}".`);
    process.exit(0);
  }

  const updated = setChangePackStatus(changePackId, newStatus, changedBy);
  if (!updated) {
    console.error("No se pudo actualizar el change pack (inesperado).");
    process.exit(1);
  }

  logger.info(`Change pack actualizado: ${changePackId} (${previousStatus} -> ${newStatus})`, {
    changePackId,
    previousStatus,
    newStatus,
    changedBy,
    reason,
  });

  console.log(`OK: "${changePackId}" paso de "${previousStatus}" a "${newStatus}".`);
  if (reason) console.log(`Motivo: ${reason}`);
  console.log("");
  console.log(
    'Recordatorio: esto NO ejecuta ningun cambio real (no publica en WordPress, no toca Ads/GA4/GTM/n8n). "approved_to_execute" solo significa que se aceptaria ejecutar esto en una futura fase con modo de ejecucion controlada, que hoy no existe.'
  );

  process.exit(0);
}

main();
