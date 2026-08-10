/**
 * Lista ejecuciones de produccion locales. Solo lectura.
 *
 * Uso:
 *   npm run production-executions:list
 *   npm run production-executions:list -- --status pending_approval
 *   npm run production-executions:list -- --status approved
 *   npm run production-executions:list -- --keyword taquillas
 *   npm run production-executions:list -- --limit 10
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidProductionExecutionStatus, readCurrentProductionExecutions } from "../src/core/production-executions";
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
  let executions = readCurrentProductionExecutions();
  const totalBeforeFilter = executions.length;

  if (args.status) {
    if (!isValidProductionExecutionStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${PRODUCTION_EXECUTION_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    executions = executions.filter((e) => e.status === args.status);
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
    console.log(`  deploymentPlanId=${e.deploymentPlanId} keyword="${e.keyword}" page="${e.page ?? ""}"`);
    console.log(`  sourceDraftId=${e.sourceDraftId} (${e.sourceDraftUrl}) targetPageId=${e.targetPageId ?? "(ninguno)"}`);
    console.log(`  media=[${e.mediaMappings.map((m) => `${m.sourceMediaId}->${m.targetMediaId ?? "?"}`).join(", ")}]`);
    console.log(`  approvalRequestId=${e.approvalRequestId ?? "(ninguno)"} attempts=${e.attempts}`);
    if (e.lastError) console.log(`  lastError: ${e.lastError}`);
    console.log(`  updatedAt=${e.updatedAt.slice(0, 10)}`);
    console.log("");
  }

  console.log('Recordatorio: "approved" no ejecuta nada por si solo -- solo se aplica de verdad si ademas las 3 condiciones de entorno (PRODUCTION_EXECUTION_ENABLED, PRODUCTION_DRAFTS_ENABLED, PRODUCTION_BACKEND=rest) estan activas.');
}

main();
