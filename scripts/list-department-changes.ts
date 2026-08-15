/**
 * Lista las aprobaciones del departamento tal como estan en el datastore
 * SERVERLESS: estado, version, URL de staging, decision humana y
 * publicacion en produccion.
 *
 * Solo LECTURA: consulta la API del Worker, no toca Telegram ni
 * WordPress. Es la forma de responder "¿en que punto esta cada cambio?"
 * desde cualquier sitio, sin entrar en la base de datos.
 *
 * Uso:
 *   npm run department:changes:list
 *   npm run department:changes:list -- --status awaiting_approval
 *   npm run department:changes:list -- --departmentRunId dept-2026-08-15T070000Z
 *   npm run department:changes:list -- --changeId <id> --verbose
 */
import * as dotenv from "dotenv";
dotenv.config();

import { createHttpApprovalStoreFromEnv } from "../src/approvals/http-store";
import { Approval } from "../src/approvals/store";
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runId = args.departmentRunId && args.departmentRunId !== "true" ? args.departmentRunId : null;
  const statusFilter = args.status && args.status !== "true" ? args.status : null;
  const changeId = args.changeId && args.changeId !== "true" ? args.changeId : null;
  const verbose = args.verbose === "true";

  if (statusFilter && !isDepartmentChangeStatus(statusFilter)) {
    throw new Error(`--status "${statusFilter}" no es un estado valido del ciclo de vida de un cambio.`);
  }

  const store = createHttpApprovalStoreFromEnv();
  if (!runId && !changeId) {
    throw new Error("Indica --departmentRunId <id> o --changeId <id>: el datastore no expone un listado global (y no hace falta para operar).");
  }
  let changes: Approval[] = runId ? await store.listByRun(runId) : [];
  if (!runId && changeId) {
    const single = await store.get(changeId);
    changes = single ? [single] : [];
  }
  if (statusFilter) changes = changes.filter((c) => c.status === statusFilter);
  if (changeId) changes = changes.filter((c) => c.changeId === changeId);
  changes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  console.log("Origen: datastore serverless de aprobaciones (API del Worker).");
  console.log(`Cambios: ${changes.length}${statusFilter ? ` (status=${statusFilter})` : ""}${runId ? ` (pasada=${runId})` : ""}`);
  for (const change of changes) printChange(change, verbose || Boolean(changeId));

  if (changes.length === 0) console.log("\n(ninguno)");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
