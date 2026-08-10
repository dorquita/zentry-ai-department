/**
 * Cambia el status de una ejecucion de staging local. Solo acepta dos
 * transiciones manuales (las demas — pending_approval/approved/
 * applied_to_staging/failed — las gestiona exclusivamente
 * src/agents/staging-executor.ts, nunca a mano):
 *
 *   --status rejected     Rechaza una ejecucion pendiente. No toca WordPress.
 *   --status rolled_back  ROLLBACK REAL: restaura el snapshot previo (si la
 *                         pagina ya existia) o vacia y marca como revertido
 *                         un borrador creado por este sistema (si era
 *                         nuevo) — SIEMPRE via update (nunca delete, nunca
 *                         publish). Requiere WORDPRESS_DRAFTS_ENABLED=true
 *                         y solo funciona contra staging (bloqueo
 *                         incondicional de produccion en el adaptador).
 *
 * Uso:
 *   npm run staging-executions:update -- --executionId <id> --status rejected --reason "..."
 *   npm run staging-executions:update -- --executionId <id> --status rolled_back --reason "..."
 *
 * Ver docs/staging-rollback.md.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { findStagingExecutionById, markExecutionRejected, markExecutionRolledBack } from "../src/core/staging-executions";
import { updateWordpressDraftPage } from "../src/adapters/wordpress";
import { logger } from "../src/core/logger";

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

const ALLOWED_MANUAL_STATUSES = ["rejected", "rolled_back"];
const ROLLBACK_PLACEHOLDER_HTML =
  "<!-- Este borrador fue revertido por el Staging Executor (Fase O12). Ver rollbackNotes en data/staging-executions.jsonl. No se ha borrado ni publicado nada. -->";

async function performRollback(executionId: string, reason: string | undefined, changedBy: string): Promise<void> {
  const execution = findStagingExecutionById(executionId);
  if (!execution) {
    console.error(`No existe ninguna ejecucion con executionId="${executionId}".`);
    process.exit(1);
    return;
  }

  if (execution.status !== "applied_to_staging" || typeof execution.wordpressPageId !== "number") {
    console.error(
      `Sin cambios: "${executionId}" tiene status "${execution.status}" — solo se puede hacer rollback de una ejecucion "applied_to_staging" con wordpressPageId registrado.`
    );
    process.exit(1);
    return;
  }

  const snapshot = execution.snapshot;
  const pageId = execution.wordpressPageId;

  try {
    if (snapshot?.existedBefore) {
      console.log(`Restaurando contenido anterior de la pagina ${pageId} (existia antes de esta ejecucion)...`);
      await updateWordpressDraftPage({
        pageId,
        title: snapshot.previousTitle ?? "(sin titulo anterior registrado)",
        contentHtml: snapshot.previousContent ?? "",
      });
    } else {
      console.log(`Vaciando y marcando como revertido el borrador ${pageId} (era una pagina nueva, nunca se borra)...`);
      await updateWordpressDraftPage({
        pageId,
        title: `[ROLLED BACK] ${execution!.keyword}`,
        contentHtml: ROLLBACK_PLACEHOLDER_HTML,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo el rollback real en WordPress: ${message}`);
    console.error(`La ejecucion sigue en status "applied_to_staging" (no se marco como rolled_back). Reintenta cuando el problema este resuelto.`);
    logger.error("Rollback de staging fallo", { executionId, error: message });
    process.exit(1);
  }

  const updated = markExecutionRolledBack(executionId, reason ?? `via CLI (${changedBy})`);
  if (!updated) {
    console.error("El rollback en WordPress se aplico, pero no se pudo actualizar el registro local (inesperado).");
    process.exit(1);
  }

  logger.info(`Rollback de staging completado: ${executionId}`, { executionId, pageId, changedBy, reason });
  console.log(`OK: "${executionId}" -> "rolled_back". Pagina ${pageId} sigue en status draft (nunca borrada, nunca publicada).`);
  if (reason) console.log(`Motivo: ${reason}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const executionId = args.executionId;
  const newStatus = args.status;
  const reason = args.reason;
  const changedBy = args.by ?? "cli";

  if (!executionId) {
    console.error('Falta --executionId <id>. Usa "npm run staging-executions:list" para ver los IDs disponibles.');
    process.exit(1);
  }

  if (!newStatus || !ALLOWED_MANUAL_STATUSES.includes(newStatus)) {
    console.error(`--status invalido o ausente. Validos manualmente desde este comando: ${ALLOWED_MANUAL_STATUSES.join(", ")}.`);
    console.error(
      "Los demas estados (pending_approval/approved/applied_to_staging/failed) los gestiona exclusivamente el Staging Executor — no se fijan a mano."
    );
    process.exit(1);
  }

  const existing = findStagingExecutionById(executionId);
  if (!existing) {
    console.error(`No existe ninguna ejecucion con executionId="${executionId}".`);
    process.exit(1);
  }

  if (newStatus === "rejected") {
    if (existing.status !== "pending_approval" && existing.status !== "approved") {
      console.log(`Sin cambios: "${executionId}" ya estaba en status "${existing.status}" (no tiene sentido rechazar desde ahi).`);
      process.exit(0);
    }
    const updated = markExecutionRejected(executionId, existing.approvalRequestId ?? "");
    if (!updated) {
      console.error("No se pudo actualizar la ejecucion (inesperado).");
      process.exit(1);
    }
    logger.info(`Ejecucion de staging rechazada manualmente: ${executionId}`, { executionId, changedBy, reason });
    console.log(`OK: "${executionId}" -> "rejected". No se ha tocado WordPress.`);
    if (reason) console.log(`Motivo: ${reason}`);
    process.exit(0);
  }

  // newStatus === "rolled_back"
  await performRollback(executionId, reason, changedBy);
  process.exit(0);
}

main().catch((err) => {
  console.error("update-staging-execution-status fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
