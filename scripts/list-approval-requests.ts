/**
 * Lista solicitudes de aprobacion locales. Solo lectura.
 *
 * Uso:
 *   npm run approvals:list
 *   npm run approvals:list -- --status pending
 *   npm run approvals:list -- --relatedType work_order
 *   npm run approvals:list -- --riskLevel high
 *   npm run approvals:list -- --channel telegram
 *   npm run approvals:list -- --status pending --limit 10
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidApprovalRequestStatus, readCurrentApprovalRequests } from "../src/core/approval-requests";
import { APPROVAL_REQUEST_STATUSES } from "../src/core/types";

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
  let requests = readCurrentApprovalRequests();
  const totalBeforeFilter = requests.length;

  if (args.status) {
    if (!isValidApprovalRequestStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${APPROVAL_REQUEST_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    requests = requests.filter((r) => r.status === args.status);
  }

  if (args.relatedType) {
    requests = requests.filter((r) => r.relatedType === args.relatedType);
  }

  if (args.riskLevel) {
    requests = requests.filter((r) => r.riskLevel === args.riskLevel);
  }

  if (args.channel) {
    requests = requests.filter((r) => r.channel === args.channel);
  }

  requests = requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit ? requests.slice(0, limit) : requests;

  console.log(`${shown.length} de ${requests.length} solicitud(es) filtrada(s) (total: ${totalBeforeFilter}).`);
  console.log("");

  for (const r of shown) {
    console.log(`[${r.status}] [${r.riskLevel}] ${r.approvalRequestId}`);
    console.log(`  ${r.title}`);
    console.log(`  ${r.summary}`);
    console.log(`  relatedType=${r.relatedType} relatedId=${r.relatedId} channel=${r.channel}`);
    console.log(`  sentAt=${r.sentAt ?? "(no enviada)"} answeredAt=${r.answeredAt ?? "(sin responder)"} answer=${r.answer ?? ""}`);
    if (r.reason) console.log(`  reason=${r.reason}`);
    console.log(`  createdAt=${r.createdAt.slice(0, 10)}`);
    console.log("");
  }
}

main();
