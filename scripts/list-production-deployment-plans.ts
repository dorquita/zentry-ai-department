/**
 * Lista planes de deploy a produccion locales. Solo lectura.
 *
 * Fase O13.1 -- dos aprobaciones separadas, nunca una sola ambigua:
 * "plan_approved" confirma el DISENO (nunca autoriza escribir);
 * "execution_approved" autoriza una futura aplicacion MANUAL real (ni
 * siquiera eso ejecuta nada automaticamente hoy).
 *
 * Uso:
 *   npm run production-plans:list
 *   npm run production-plans:list -- --status plan_ready_for_review
 *   npm run production-plans:list -- --status plan_approved
 *   npm run production-plans:list -- --status execution_pending_approval
 *   npm run production-plans:list -- --status execution_approved
 *   npm run production-plans:list -- --keyword taquillas
 *   npm run production-plans:list -- --limit 10
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidDeploymentPlanStatus, readCurrentProductionDeploymentPlans } from "../src/core/production-deployment-plans";
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
  let plans = readCurrentProductionDeploymentPlans();
  const totalBeforeFilter = plans.length;

  if (args.status) {
    if (!isValidDeploymentPlanStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${DEPLOYMENT_PLAN_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    plans = plans.filter((p) => p.status === args.status);
  }

  if (args.keyword) {
    const needle = args.keyword.toLowerCase();
    plans = plans.filter((p) => p.keyword.toLowerCase().includes(needle));
  }

  plans = plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit ? plans.slice(0, limit) : plans;

  console.log(`${shown.length} de ${plans.length} plan(es) filtrado(s) (total: ${totalBeforeFilter}).`);
  console.log("");

  for (const p of shown) {
    console.log(`[${p.status}] ${p.deploymentPlanId}`);
    console.log(`  keyword="${p.keyword}" page="${p.page ?? ""}" deploymentType=${p.deploymentType}`);
    console.log(`  sourceDraftId=${p.sourceDraftId} (${p.sourceDraftUrl}) targetPageId=${p.targetPageId ?? "(ninguno)"}`);
    console.log(`  media=[${p.includedMediaIds.join(", ")}] approvalRequestId=${p.approvalRequestId ?? "(ninguno)"}`);
    console.log(`  updatedAt=${p.updatedAt.slice(0, 10)}`);
    console.log("");
  }

  console.log(
    'Recordatorio: ningun plan de esta lista ha sido aplicado a produccion. "plan_approved" confirma el diseno; ' +
      '"execution_approved" autoriza una futura aplicacion manual -- ninguna de las dos ejecuta nada por si sola.'
  );
}

main();
