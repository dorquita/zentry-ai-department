/**
 * Cambia el status de una ejecucion de produccion local. NO ejecuta
 * ningun cambio real en WordPress produccion -- este CLI solo actualiza
 * el estado local (nueva instantanea append-only). La unica via para una
 * escritura real es `npm run production:execute` con las 3 condiciones
 * de entorno activas Y la ejecucion ya `approved`.
 *
 * Uso:
 *   npm run production-executions:update -- --executionId <id> --status cancelled --reason "..."
 *   npm run production-executions:update -- --executionId <id> --status rolled_back --reason "..."
 */
import * as dotenv from "dotenv";
dotenv.config();

import { findProductionExecutionById, isValidProductionExecutionStatus, setProductionExecutionStatus } from "../src/core/production-executions";
import { logger } from "../src/core/logger";
import { PRODUCTION_EXECUTION_STATUSES } from "../src/core/types";

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
  const executionId = args.executionId;
  const newStatus = args.status;
  const reason = args.reason;

  if (!executionId) {
    console.error('Falta --executionId <id>. Usa "npm run production-executions:list" para ver los IDs disponibles.');
    process.exit(1);
  }

  if (!newStatus || !isValidProductionExecutionStatus(newStatus)) {
    console.error(`--status invalido o ausente. Validos: ${PRODUCTION_EXECUTION_STATUSES.join(", ")}`);
    process.exit(1);
  }

  const existing = findProductionExecutionById(executionId);
  if (!existing) {
    console.error(`No existe ninguna ejecucion con executionId="${executionId}".`);
    process.exit(1);
  }

  const previousStatus = existing.status;
  if (previousStatus === newStatus) {
    console.log(`Sin cambios: "${executionId}" ya estaba en status "${newStatus}".`);
    process.exit(0);
  }

  const updated = setProductionExecutionStatus(executionId, newStatus, { lastError: reason });
  if (!updated) {
    console.error("No se pudo actualizar la ejecucion (inesperado).");
    process.exit(1);
  }

  logger.info(`Ejecucion de produccion actualizada: ${executionId} (${previousStatus} -> ${newStatus})`, {
    executionId,
    previousStatus,
    newStatus,
    reason,
  });

  console.log(`OK: "${executionId}" paso de "${previousStatus}" a "${newStatus}".`);
  if (reason) console.log(`Motivo/nota: ${reason}`);
  console.log("");
  console.log('Recordatorio: esto NO ejecuta ningun cambio real en produccion -- solo actualiza el estado local.');

  process.exit(0);
}

main();
