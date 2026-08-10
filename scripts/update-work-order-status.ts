/**
 * Cambia el status de una work order local. NO ejecuta ningun cambio
 * real: solo actualiza el estado local (nueva instantanea append-only) y
 * registra el cambio en data/work-order-audit.jsonl.
 *
 * IMPORTANTE: "approved_to_prepare" NO significa publicar. Solo significa
 * que Pau acepta que se prepare una propuesta mas detallada.
 *
 * Uso:
 *   npm run work-orders:update -- --workOrderId <id> --status approved_to_prepare
 *   npm run work-orders:update -- --workOrderId <id> --status rejected --reason "..."
 *   npm run work-orders:update -- --workOrderId <id> --status applied_manually
 */
import * as dotenv from "dotenv";
dotenv.config();

import { findWorkOrderById, isValidWorkOrderStatus, setWorkOrderStatus } from "../src/core/work-orders";
import { recordWorkOrderStatusChange } from "../src/core/work-order-audit";
import { logger } from "../src/core/logger";
import { WORK_ORDER_STATUSES } from "../src/core/types";

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
  const workOrderId = args.workOrderId;
  const newStatus = args.status;
  const reason = args.reason;
  const changedBy = args.by ?? "cli";

  if (!workOrderId) {
    console.error('Falta --workOrderId <id>. Usa "npm run work-orders:list" para ver los IDs disponibles.');
    process.exit(1);
  }

  if (!newStatus || !isValidWorkOrderStatus(newStatus)) {
    console.error(`--status invalido o ausente. Validos: ${WORK_ORDER_STATUSES.join(", ")}`);
    process.exit(1);
  }

  const existing = findWorkOrderById(workOrderId);
  if (!existing) {
    console.error(`No existe ninguna work order con workOrderId="${workOrderId}".`);
    process.exit(1);
  }

  const previousStatus = existing.status;

  if (previousStatus === newStatus) {
    console.log(`Sin cambios: "${workOrderId}" ya estaba en status "${newStatus}".`);
    process.exit(0);
  }

  const updated = setWorkOrderStatus(workOrderId, newStatus, changedBy);
  if (!updated) {
    console.error("No se pudo actualizar la work order (inesperado).");
    process.exit(1);
  }

  recordWorkOrderStatusChange({ workOrderId, previousStatus, newStatus, reason, changedBy });

  logger.info(`Work order actualizada: ${workOrderId} (${previousStatus} -> ${newStatus})`, {
    workOrderId,
    previousStatus,
    newStatus,
    changedBy,
    reason,
  });

  console.log(`OK: "${workOrderId}" paso de "${previousStatus}" a "${newStatus}".`);
  if (reason) console.log(`Motivo: ${reason}`);
  console.log("");
  console.log(
    'Recordatorio: esto NO ejecuta ningun cambio real. "approved_to_prepare" solo significa que se acepta preparar una propuesta mas detallada, no publicar nada.'
  );

  process.exit(0);
}

main();
