/**
 * Lista ejecuciones de staging locales. Solo lectura.
 *
 * Uso:
 *   npm run staging-executions:list
 *   npm run staging-executions:list -- --status pending_approval
 *   npm run staging-executions:list -- --status applied_to_staging
 *   npm run staging-executions:list -- --targetBrand zentry
 *   npm run staging-executions:list -- --keyword taquillas
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidStagingExecutionStatus, readCurrentStagingExecutions } from "../src/core/staging-executions";
import { STAGING_EXECUTION_STATUSES } from "../src/core/types";

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
  let executions = readCurrentStagingExecutions();
  const totalBeforeFilter = executions.length;

  if (args.status) {
    if (!isValidStagingExecutionStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${STAGING_EXECUTION_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    executions = executions.filter((e) => e.status === args.status);
  }

  if (args.targetBrand) {
    executions = executions.filter((e) => e.targetBrand === args.targetBrand);
  }

  if (args.changeType) {
    executions = executions.filter((e) => e.changeType === args.changeType);
  }

  if (args.keyword) {
    const needle = args.keyword.toLowerCase();
    executions = executions.filter((e) => e.keyword.toLowerCase().includes(needle));
  }

  executions = executions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit ? executions.slice(0, limit) : executions;

  console.log(`${shown.length} de ${executions.length} ejecucion(es) filtrada(s) (total: ${totalBeforeFilter}).`);
  console.log("");

  for (const e of shown) {
    console.log(`[${e.status}] ${e.executionId}`);
    console.log(`  keyword="${e.keyword}" page="${e.page ?? ""}" targetBrand=${e.targetBrand} changeType=${e.changeType}`);
    console.log(`  changePackId=${e.changePackId} workOrderId=${e.workOrderId}`);
    if (e.wordpressPageId) console.log(`  wordpressPageId=${e.wordpressPageId} url=${e.wordpressDraftUrl ?? ""}`);
    if (e.lastError) console.log(`  lastError=${e.lastError}`);
    console.log(`  attempts=${e.attempts} updatedAt=${e.updatedAt.slice(0, 10)}`);
    console.log("");
  }
}

main();
