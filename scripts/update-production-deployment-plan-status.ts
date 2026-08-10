/**
 * Cambia el status de un plan de deploy a produccion local. NO ejecuta
 * ningun cambio real en WordPress produccion bajo ninguna circunstancia
 * -- ni siquiera pasar a "execution_approved" dispara ninguna escritura,
 * porque esa capacidad no existe todavia en este proyecto (por diseno).
 *
 * Fase O13.1 -- dos aprobaciones separadas: "plan_approved" (el DISENO
 * esta bien, no autoriza escribir) y, solo despues, "execution_approved"
 * (autoriza una futura aplicacion MANUAL real). El agente
 * (production-deployment-planner.ts) ya gestiona automaticamente estas
 * transiciones via las respuestas de Telegram -- este CLI es sobre todo
 * para casos manuales (cancelar, forzar un rollback de estado, etc).
 *
 * Uso:
 *   npm run production-plans:update -- --deploymentPlanId <id> --status plan_approved
 *   npm run production-plans:update -- --deploymentPlanId <id> --status plan_rejected --reason "..."
 *   npm run production-plans:update -- --deploymentPlanId <id> --status execution_approved
 *   npm run production-plans:update -- --deploymentPlanId <id> --status cancelled
 */
import * as dotenv from "dotenv";
dotenv.config();

import { findProductionDeploymentPlanById, isValidDeploymentPlanStatus, setDeploymentPlanStatus } from "../src/core/production-deployment-plans";
import { logger } from "../src/core/logger";
import { DEPLOYMENT_PLAN_STATUSES } from "../src/core/types";

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
  const deploymentPlanId = args.deploymentPlanId;
  const newStatus = args.status;
  const reason = args.reason;

  if (!deploymentPlanId) {
    console.error('Falta --deploymentPlanId <id>. Usa "npm run production-plans:list" para ver los IDs disponibles.');
    process.exit(1);
  }

  if (!newStatus || !isValidDeploymentPlanStatus(newStatus)) {
    console.error(`--status invalido o ausente. Validos: ${DEPLOYMENT_PLAN_STATUSES.join(", ")}`);
    process.exit(1);
  }

  const existing = findProductionDeploymentPlanById(deploymentPlanId);
  if (!existing) {
    console.error(`No existe ningun plan con deploymentPlanId="${deploymentPlanId}".`);
    process.exit(1);
  }

  const previousStatus = existing.status;
  if (previousStatus === newStatus) {
    console.log(`Sin cambios: "${deploymentPlanId}" ya estaba en status "${newStatus}".`);
    process.exit(0);
  }

  const updated = setDeploymentPlanStatus(deploymentPlanId, newStatus, { lastError: reason });
  if (!updated) {
    console.error("No se pudo actualizar el plan (inesperado).");
    process.exit(1);
  }

  logger.info(`Plan de deploy a produccion actualizado: ${deploymentPlanId} (${previousStatus} -> ${newStatus})`, {
    deploymentPlanId,
    previousStatus,
    newStatus,
    reason,
  });

  console.log(`OK: "${deploymentPlanId}" paso de "${previousStatus}" a "${newStatus}".`);
  if (reason) console.log(`Motivo/nota: ${reason}`);
  console.log("");
  console.log(
    'Recordatorio: esto NO ejecuta ningun cambio real en produccion. "plan_approved" solo confirma que el DISENO del plan esta bien (checklist/media/SEO/rollback) -- todavia no autoriza escribir. ' +
      '"execution_approved" (segunda aprobacion, distinta, solo posible tras "plan_approved") autoriza una futura aplicacion MANUAL real -- ni siquiera esa ejecuta nada automaticamente: no existe todavia ningun codigo en este proyecto que aplique un plan a produccion.'
  );

  process.exit(0);
}

main();
