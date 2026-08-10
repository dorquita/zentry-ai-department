/**
 * Lista work orders locales. Solo lectura.
 *
 * Uso:
 *   npm run work-orders:list
 *   npm run work-orders:list -- --status ready_for_review
 *   npm run work-orders:list -- --status auto_prepared
 *   npm run work-orders:list -- --targetBrand zentry
 *   npm run work-orders:list -- --priority high
 *   npm run work-orders:list -- --autonomyLevel AUTO_PLAN
 *   npm run work-orders:list -- --requiresApproval false
 *   npm run work-orders:list -- --status ready_for_review --limit 10
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidWorkOrderStatus, readCurrentWorkOrders, categorizeActionType } from "../src/core/work-orders";
import { Priority, WORK_ORDER_STATUSES } from "../src/core/types";

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
  let workOrders = readCurrentWorkOrders();
  const totalBeforeFilter = workOrders.length;

  if (args.status) {
    if (!isValidWorkOrderStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${WORK_ORDER_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    workOrders = workOrders.filter((w) => w.status === args.status);
  }

  if (args.priority) {
    workOrders = workOrders.filter((w) => w.priority === args.priority);
  }

  if (args.targetBrand) {
    workOrders = workOrders.filter((w) => w.targetBrand === args.targetBrand);
  }

  if (args.category) {
    workOrders = workOrders.filter((w) => categorizeActionType(w.actionType) === args.category);
  }

  if (args.keyword) {
    const needle = args.keyword.toLowerCase();
    workOrders = workOrders.filter((w) => w.keyword.toLowerCase().includes(needle));
  }

  if (args.autonomyLevel) {
    workOrders = workOrders.filter((w) => w.autonomyLevel === args.autonomyLevel);
  }

  if (args.requiresApproval) {
    if (args.requiresApproval !== "true" && args.requiresApproval !== "false") {
      console.error(`--requiresApproval invalido: "${args.requiresApproval}". Valores validos: true, false.`);
      process.exit(1);
    }
    const wanted = args.requiresApproval === "true";
    workOrders = workOrders.filter((w) => w.requiresApproval === wanted);
  }

  workOrders = workOrders.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (rankDiff !== 0) return rankDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit ? workOrders.slice(0, limit) : workOrders;

  console.log(`${shown.length} de ${workOrders.length} work order(s) filtrada(s) (total: ${totalBeforeFilter}).`);
  console.log("");

  for (const w of shown) {
    console.log(`[${w.status}] [${w.priority}] ${w.workOrderId}`);
    console.log(`  ${w.sourceActionTitle}`);
    console.log(
      `  keyword="${w.keyword}" page="${w.page ?? ""}" targetBrand=${w.targetBrand} category=${categorizeActionType(w.actionType)}`
    );
    console.log(
      `  planningOrigin=${w.planningOrigin} autonomyLevel=${w.autonomyLevel} riskLevel=${w.riskLevel} requiresApproval=${w.requiresApproval}`
    );
    console.log(`  updatedAt=${w.updatedAt.slice(0, 10)} sourceAgents=${w.sourceAgents.join(",")}`);
    console.log("");
  }
}

main();
