import { BacklogAction, ChangePack, StagingExecution, ProductionDeploymentPlan, ProductionExecution } from "./types";
import { StagingQaResultSnapshot } from "./staging-qa-results";

/**
 * Estado unificado por oportunidad (Fase O27). Hasta esta fase, "el
 * estado" de una oportunidad vivia repartido en 4 registros
 * independientes (BacklogAction.status, ChangePack.status,
 * StagingExecution.status, ProductionDeploymentPlan.status +
 * ProductionExecution.status), cada uno con su propio vocabulario --
 * coherente puertas adentro de cada agente, pero sin una unica respuesta
 * a "¿en que punto esta esta oportunidad, de verdad?" que se pudiera
 * mostrar a Pau sin reconstruirla a mano.
 *
 * Esta funcion NO cambia ningun dato existente ni ningun jsonl -- es una
 * vista DERIVADA y de solo lectura sobre los 5 registros ya existentes.
 * No hace falta migrar nada: se puede recalcular en cualquier momento a
 * partir de los ficheros append-only de siempre.
 *
 * Los 14 estados (ver docs/opportunity-states.md para las reglas
 * completas):
 *   detected -> selected_for_execution -> drafted_local ->
 *   pushed_to_staging -> qa_pending -> qa_passed | qa_failed ->
 *   waiting_approval -> approved -> deployed_production -> done
 *   (mas: rejected, postponed, blocked -- pueden llegar desde cualquier
 *   punto de la cadena)
 */
export type OpportunityState =
  | "detected"
  | "selected_for_execution"
  | "drafted_local"
  | "pushed_to_staging"
  | "qa_pending"
  | "qa_passed"
  | "qa_failed"
  | "waiting_approval"
  | "approved"
  | "deployed_production"
  | "done"
  | "rejected"
  | "postponed"
  | "blocked";

export const OPPORTUNITY_STATE_RANK: Record<OpportunityState, number> = {
  detected: 0,
  drafted_local: 1,
  selected_for_execution: 2,
  pushed_to_staging: 3,
  qa_pending: 4,
  qa_failed: 4.5,
  qa_passed: 5,
  waiting_approval: 6,
  approved: 7,
  deployed_production: 8,
  done: 9,
  // Estos 3 no son "progreso" en la misma escala -- se tratan aparte
  // (ver deriveOpportunityState): solo ganan si NADA mas avanzo.
  rejected: -1,
  postponed: -1,
  blocked: -1,
};

export interface OpportunityStateContext {
  action: BacklogAction;
  changePacks: ChangePack[];
  stagingExecutions: StagingExecution[];
  qaResults: StagingQaResultSnapshot[];
  productionPlans: ProductionDeploymentPlan[];
  productionExecutions: ProductionExecution[];
}

function deriveStateForChangePack(cp: ChangePack, ctx: OpportunityStateContext): OpportunityState {
  if (cp.status === "rejected") return "rejected";
  if (cp.status === "superseded") return "postponed";
  if (cp.status === "draft" || cp.status === "ready_for_review") return "drafted_local";
  if (cp.status === "applied_manually") return "deployed_production";
  // cp.status === "approved_to_execute" a partir de aqui: mirar si ya
  // hay una ejecucion de staging real para este change pack.
  const executions = ctx.stagingExecutions.filter((e) => e.changePackId === cp.changePackId);
  if (executions.length === 0) return "selected_for_execution";

  let best: OpportunityState = "selected_for_execution";
  for (const exec of executions) {
    const state = deriveStateForExecution(exec, ctx);
    if (OPPORTUNITY_STATE_RANK[state] > OPPORTUNITY_STATE_RANK[best]) best = state;
  }
  return best;
}

function deriveStateForExecution(exec: StagingExecution, ctx: OpportunityStateContext): OpportunityState {
  if (exec.status === "pending_approval" || exec.status === "approved") return "selected_for_execution";
  if (exec.status === "rejected") return "rejected";
  if (exec.status === "failed") return "blocked";
  if (exec.status === "rolled_back") return "postponed";
  // exec.status === "applied_to_staging" a partir de aqui. En este
  // pipeline, Staging QA Agent (paso 21) siempre corre justo despues del
  // Staging Executor (paso 20) en la misma pasada, asi que "aplicado pero
  // sin QA todavia" (pushed_to_staging) es casi siempre transitorio --
  // se deja como estado explicito por si se lee a mitad de pasada o si
  // en el futuro QA se desacopla a su propio paso asincrono.
  const qa = ctx.qaResults.find((r) => r.executionId === exec.executionId);
  if (!qa) return "pushed_to_staging";
  const qaState: OpportunityState = qa.overallPass ? "qa_passed" : "qa_failed";
  if (!qa.overallPass) return "qa_failed";

  const plan = ctx.productionPlans.find((p) => p.stagingExecutionId === exec.executionId);
  if (!plan) return qaState;
  const planState = deriveStateForPlan(plan, ctx);
  return OPPORTUNITY_STATE_RANK[planState] > OPPORTUNITY_STATE_RANK[qaState] ? planState : qaState;
}

function deriveStateForPlan(plan: ProductionDeploymentPlan, ctx: OpportunityStateContext): OpportunityState {
  if (plan.status === "plan_rejected" || plan.status === "cancelled") return "qa_passed";
  if (plan.status === "draft" || plan.status === "plan_ready_for_review") return "waiting_approval";
  if (plan.status === "plan_approved") return "approved";
  if (plan.status === "execution_pending_approval" || plan.status === "execution_approved") return "approved";
  if (plan.status === "rolled_back") return "qa_passed";
  // plan.status === "applied_to_production_draft"
  const exec = ctx.productionExecutions.find((e) => e.deploymentPlanId === plan.deploymentPlanId);
  if (exec && (exec.status === "applied_to_production_draft" || exec.status === "approved")) return "deployed_production";
  return "approved";
}

/**
 * Estado ACTUAL (instantanea mas reciente de cada registro vinculado). Si
 * una accion tiene varios change packs (p. ej. SEO + content + CRO para
 * la misma pagina), el estado mostrado es el MAS AVANZADO de todos ellos
 * -- si alguno ya llego a staging, la oportunidad "ya avanzo", aunque
 * otro change pack hermano siga en drafted_local.
 */
export function deriveOpportunityState(ctx: OpportunityStateContext): OpportunityState {
  const { action } = ctx;
  if (action.status === "rejected") return "rejected";
  if (action.status === "snoozed") return "postponed";
  if (action.status === "blocked") return "blocked";
  if (action.status === "done") return "done";

  if (ctx.changePacks.length === 0) return "detected";

  let best: OpportunityState = "detected";
  for (const cp of ctx.changePacks) {
    const state = deriveStateForChangePack(cp, ctx);
    if (OPPORTUNITY_STATE_RANK[state] > OPPORTUNITY_STATE_RANK[best]) best = state;
  }
  return best;
}

/**
 * Construye el contexto de una accion concreta a partir de los registros
 * YA leidos en memoria (para no releer los jsonl una vez por accion en un
 * bucle -- quien llama a esto en un bucle debe leer readCurrentX() UNA
 * vez fuera del bucle y pasarlo aqui).
 */
export function buildOpportunityStateContext(
  action: BacklogAction,
  allChangePacks: ChangePack[],
  allStagingExecutions: StagingExecution[],
  allQaResults: StagingQaResultSnapshot[],
  allProductionPlans: ProductionDeploymentPlan[],
  allProductionExecutions: ProductionExecution[]
): OpportunityStateContext {
  const changePacks = allChangePacks.filter((cp) => cp.actionId === action.actionId);
  const changePackIds = new Set(changePacks.map((cp) => cp.changePackId));
  const stagingExecutions = allStagingExecutions.filter((e) => changePackIds.has(e.changePackId));
  const executionIds = new Set(stagingExecutions.map((e) => e.executionId));
  const qaResults = allQaResults.filter((r) => executionIds.has(r.executionId));
  const productionPlans = allProductionPlans.filter((p) => executionIds.has(p.stagingExecutionId));
  const planIds = new Set(productionPlans.map((p) => p.deploymentPlanId));
  const productionExecutions = allProductionExecutions.filter((e) => planIds.has(e.deploymentPlanId));
  return { action, changePacks, stagingExecutions, qaResults, productionPlans, productionExecutions };
}

/**
 * Igual que buildOpportunityStateContext(), pero solo con los registros
 * cuya ultima instantanea (updatedAt/createdAt) es ANTERIOR a `cutoffISO`
 * -- permite calcular "en que estado estaba esta oportunidad ayer" sin
 * necesitar ningun snapshot adicional: el propio log append-only YA tiene
 * toda la informacion necesaria (basta con no mirar las lineas de hoy).
 * Usado por el informe diario para la seccion "Tareas avanzadas hoy"
 * (estado anterior -> estado nuevo).
 */
export function buildOpportunityStateContextAsOf(
  cutoffISO: string,
  action: BacklogAction,
  allChangePacks: ChangePack[],
  allStagingExecutions: StagingExecution[],
  allQaResults: StagingQaResultSnapshot[],
  allProductionPlans: ProductionDeploymentPlan[],
  allProductionExecutions: ProductionExecution[]
): OpportunityStateContext {
  const before = <T extends { updatedAt?: string; createdAt?: string; checkedAt?: string }>(items: T[]): T[] =>
    items.filter((i) => (i.updatedAt ?? i.checkedAt ?? i.createdAt ?? "") < cutoffISO);
  return buildOpportunityStateContext(
    action,
    before(allChangePacks),
    before(allStagingExecutions),
    before(allQaResults),
    before(allProductionPlans),
    before(allProductionExecutions)
  );
}

export const OPPORTUNITY_STATE_LABELS: Record<OpportunityState, string> = {
  detected: "Detectada",
  selected_for_execution: "Seleccionada para ejecutar",
  drafted_local: "Borrador local preparado",
  pushed_to_staging: "Aplicada en staging",
  qa_pending: "QA pendiente",
  qa_passed: "QA superado (en staging)",
  qa_failed: "QA fallido",
  waiting_approval: "Esperando aprobacion de Pau",
  approved: "Aprobada para producción",
  deployed_production: "Desplegada en producción",
  done: "Cerrada (done)",
  rejected: "Rechazada",
  postponed: "Aplazada",
  blocked: "Bloqueada",
};
