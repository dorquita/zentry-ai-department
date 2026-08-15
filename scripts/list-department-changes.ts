/**
 * Lista el registro PERSISTENTE de cambios del departamento
 * (`data/department-changes.jsonl`): estado, version, URL de staging,
 * aprobacion, decision humana y publicacion en produccion.
 *
 * Solo LECTURA local: no llama a Telegram, ni a WordPress, ni a nada
 * externo. Es la forma de responder "¿en que punto esta cada cambio?"
 * desde el VPS sin abrir el fichero a mano.
 *
 * Uso:
 *   npm run department:changes:list
 *   npm run department:changes:list -- --status awaiting_approval
 *   npm run department:changes:list -- --departmentRunId dept-2026-08-15T070000Z
 *   npm run department:changes:list -- --changeId <id> --verbose
 */
import * as dotenv from "dotenv";
dotenv.config();

import { findChangesByRunId, getDepartmentChangesFilePath, readCurrentChanges } from "../src/department/apply/change-registry";
import { DepartmentChangeRequest } from "../src/department/apply/change-types";
import { isDepartmentChangeStatus } from "../src/department/apply/state-machine";
import { APPLY_STATUS_LABEL } from "../src/department/apply/types";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
    }
  }
  return args;
}

function printChange(change: DepartmentChangeRequest, verbose: boolean): void {
  console.log(`\n[${APPLY_STATUS_LABEL[change.status]}] ${change.changeId}`);
  console.log(`  Titulo:        ${change.title}`);
  console.log(`  Pasada:        ${change.departmentRunId} (recomendacion #${change.recommendationRank}, v${change.version})`);
  console.log(`  Capacidad:     ${change.capabilityId ?? "ninguna"}`);
  if (change.staging) {
    console.log(`  Staging:       page ${change.staging.wordpressPageId} -- ${change.staging.url}`);
    console.log(`                 validacion=${change.staging.validationStatus}, rollback=${change.staging.rollbackStatus}, version=${(change.staging.resultingVersionHash ?? "").slice(0, 12)}`);
    for (const field of change.staging.changedFields.filter((f) => f.changed)) {
      console.log(`                 ${field.field}: "${field.before}" -> "${field.after}"`);
    }
  }
  if (change.telegram) {
    console.log(`  Telegram:      approvalRequestId=${change.telegram.telegramApprovalId}, message_id=${change.telegram.telegramMessageId ?? "no confirmado"}, enviado=${change.telegram.sentAt ?? "?"}`);
  }
  if (change.humanDecision) {
    console.log(`  Decision:      ${change.humanDecision.decision} por ${change.humanDecision.decidedBy} el ${change.humanDecision.decidedAt}`);
    if (change.humanDecision.rejectionReason) console.log(`  Motivo:        ${change.humanDecision.rejectionReason}`);
  }
  if (change.production) {
    console.log(`  Produccion:    page ${change.production.wordpressPageId} -- ${change.production.url}`);
    console.log(`                 validacion=${change.production.validationStatus}, rollback=${change.production.rollbackStatus}`);
  }
  if (change.inheritedFeedback.length > 0) {
    console.log(`  Feedback heredado de versiones anteriores:`);
    for (const item of change.inheritedFeedback) console.log(`                 - ${item}`);
  }
  if (verbose) {
    console.log("  Auditoria:");
    for (const entry of change.auditTrail) console.log(`                 ${entry.at} ${entry.event}: ${entry.detail}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const runId = args.departmentRunId && args.departmentRunId !== "true" ? args.departmentRunId : null;
  const statusFilter = args.status && args.status !== "true" ? args.status : null;
  const changeId = args.changeId && args.changeId !== "true" ? args.changeId : null;
  const verbose = args.verbose === "true";

  if (statusFilter && !isDepartmentChangeStatus(statusFilter)) {
    throw new Error(`--status "${statusFilter}" no es un estado valido del ciclo de vida de un cambio.`);
  }

  let changes = runId ? findChangesByRunId(runId) : readCurrentChanges();
  if (statusFilter) changes = changes.filter((c) => c.status === statusFilter);
  if (changeId) changes = changes.filter((c) => c.changeId === changeId);
  changes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  console.log(`Registro: ${getDepartmentChangesFilePath()}`);
  console.log(`Cambios: ${changes.length}${statusFilter ? ` (status=${statusFilter})` : ""}${runId ? ` (pasada=${runId})` : ""}`);
  for (const change of changes) printChange(change, verbose || Boolean(changeId));

  if (changes.length === 0) console.log("\n(ninguno)");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
