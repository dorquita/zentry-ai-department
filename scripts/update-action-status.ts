/**
 * Cambia el status de una accion del Action Backlog local. NO ejecuta
 * ningun cambio real: solo actualiza el estado local (nueva instantanea
 * append-only) y registra el cambio en data/action-audit.jsonl.
 *
 * Uso:
 *   npm run actions:update -- --actionId <id> --status approved
 *   npm run actions:update -- --actionId <id> --status rejected --reason "no aplica"
 *   npm run actions:update -- --actionId <id> --status snoozed
 */
import * as dotenv from "dotenv";
dotenv.config();

import { findActionById, isValidActionStatus, setActionStatus } from "../src/core/action-backlog";
import { recordStatusChange } from "../src/core/action-audit";
import { logger } from "../src/core/logger";
import { ACTION_STATUSES } from "../src/core/types";

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
  const actionId = args.actionId;
  const newStatus = args.status;
  const reason = args.reason;
  const changedBy = args.by ?? "cli";

  if (!actionId) {
    console.error('Falta --actionId <id>. Usa "npm run actions:list" para ver los IDs disponibles.');
    process.exit(1);
  }

  if (!newStatus || !isValidActionStatus(newStatus)) {
    console.error(`--status invalido o ausente. Validos: ${ACTION_STATUSES.join(", ")}`);
    process.exit(1);
  }

  const existing = findActionById(actionId);
  if (!existing) {
    console.error(`No existe ninguna accion con actionId="${actionId}".`);
    process.exit(1);
  }

  const previousStatus = existing.status;

  if (previousStatus === newStatus) {
    console.log(`Sin cambios: "${actionId}" ya estaba en status "${newStatus}".`);
    process.exit(0);
  }

  const updated = setActionStatus(actionId, newStatus, changedBy);
  if (!updated) {
    console.error("No se pudo actualizar la accion (inesperado).");
    process.exit(1);
  }

  recordStatusChange({ actionId, previousStatus, newStatus, reason, changedBy });

  logger.info(`Accion actualizada: ${actionId} (${previousStatus} -> ${newStatus})`, {
    actionId,
    previousStatus,
    newStatus,
    changedBy,
    reason,
  });

  console.log(`OK: "${actionId}" paso de "${previousStatus}" a "${newStatus}".`);
  if (reason) console.log(`Motivo: ${reason}`);
  console.log("");
  console.log(
    "Recordatorio: esto NO ejecuta ningun cambio real (no publica en WordPress, no toca Ads/GA4/GTM/n8n). Solo actualiza el estado local del backlog."
  );

  process.exit(0);
}

main();
