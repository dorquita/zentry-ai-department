/**
 * Lista acciones del Action Backlog local. Solo lectura.
 *
 * Uso:
 *   npm run actions:list
 *   npm run actions:list -- --status open
 *   npm run actions:list -- --status auto_approved_for_planning
 *   npm run actions:list -- --status blocked
 *   npm run actions:list -- --priority high
 *   npm run actions:list -- --brand zentry
 *   npm run actions:list -- --keyword taquillas
 *   npm run actions:list -- --autonomyLevel AUTO_PLAN
 *   npm run actions:list -- --requiresApproval true
 *   npm run actions:list -- --status open --priority high --limit 10
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidActionStatus, readCurrentActions } from "../src/core/action-backlog";
import { ACTION_STATUSES, Priority } from "../src/core/types";

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

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
  let actions = readCurrentActions();
  const totalBeforeFilter = actions.length;

  if (args.status) {
    if (!isValidActionStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${ACTION_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    actions = actions.filter((a) => a.status === args.status);
  }

  if (args.priority) {
    actions = actions.filter((a) => a.priority === args.priority);
  }

  if (args.brand) {
    actions = actions.filter((a) => a.targetBrand === args.brand);
  }

  if (args.keyword) {
    const needle = args.keyword.toLowerCase();
    actions = actions.filter((a) => a.keyword.toLowerCase().includes(needle));
  }

  if (args.autonomyLevel) {
    actions = actions.filter((a) => a.autonomyLevel === args.autonomyLevel);
  }

  if (args.requiresApproval) {
    if (args.requiresApproval !== "true" && args.requiresApproval !== "false") {
      console.error(`--requiresApproval invalido: "${args.requiresApproval}". Valores validos: true, false.`);
      process.exit(1);
    }
    const wanted = args.requiresApproval === "true";
    actions = actions.filter((a) => a.requiresApproval === wanted);
  }

  actions = actions.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (rankDiff !== 0) return rankDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit ? actions.slice(0, limit) : actions;

  console.log(`${shown.length} de ${actions.length} accion(es) filtrada(s) (total en backlog: ${totalBeforeFilter}).`);
  console.log("");

  for (const a of shown) {
    console.log(`[${a.status}] [${a.priority}] ${a.actionId}`);
    console.log(`  ${a.title}`);
    console.log(`  keyword="${a.keyword}" page="${a.page ?? ""}" brand=${a.targetBrand} type=${a.actionType}`);
    console.log(
      `  autonomyLevel=${a.autonomyLevel} riskLevel=${a.riskLevel} requiresApproval=${a.requiresApproval}`
    );
    console.log(
      `  seenCount=${a.seenCount} firstSeenAt=${a.firstSeenAt.slice(0, 10)} lastSeenAt=${a.lastSeenAt.slice(0, 10)} sourceAgents=${a.sourceAgents.join(",")}`
    );
    console.log("");
  }
}

main();
