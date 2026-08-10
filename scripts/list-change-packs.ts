/**
 * Lista change packs locales. Solo lectura.
 *
 * Uso:
 *   npm run change-packs:list
 *   npm run change-packs:list -- --status ready_for_review
 *   npm run change-packs:list -- --targetBrand zentry
 *   npm run change-packs:list -- --changeType seo_on_page_update
 *   npm run change-packs:list -- --priority high
 *   npm run change-packs:list -- --status ready_for_review --limit 10
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidChangePackStatus, readCurrentChangePacks } from "../src/core/change-packs";
import { CHANGE_PACK_STATUSES, Priority } from "../src/core/types";

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
  let changePacks = readCurrentChangePacks();
  const totalBeforeFilter = changePacks.length;

  if (args.status) {
    if (!isValidChangePackStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${CHANGE_PACK_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    changePacks = changePacks.filter((cp) => cp.status === args.status);
  }

  if (args.priority) {
    changePacks = changePacks.filter((cp) => cp.priority === args.priority);
  }

  if (args.targetBrand) {
    changePacks = changePacks.filter((cp) => cp.targetBrand === args.targetBrand);
  }

  if (args.changeType) {
    changePacks = changePacks.filter((cp) => cp.changeType === args.changeType);
  }

  if (args.keyword) {
    const needle = args.keyword.toLowerCase();
    changePacks = changePacks.filter((cp) => cp.keyword.toLowerCase().includes(needle));
  }

  changePacks = changePacks.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (rankDiff !== 0) return rankDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit ? changePacks.slice(0, limit) : changePacks;

  console.log(`${shown.length} de ${changePacks.length} change pack(s) filtrado(s) (total: ${totalBeforeFilter}).`);
  console.log("");

  for (const cp of shown) {
    console.log(`[${cp.status}] [${cp.priority}] ${cp.changePackId}`);
    console.log(`  keyword="${cp.keyword}" page="${cp.page ?? ""}" targetBrand=${cp.targetBrand} changeType=${cp.changeType}`);
    console.log(`  workOrderId=${cp.workOrderId} actionId=${cp.actionId}`);
    console.log(`  updatedAt=${cp.updatedAt.slice(0, 10)}`);
    console.log("");
  }
}

main();
