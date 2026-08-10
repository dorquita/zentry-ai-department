import * as fs from "fs";
import * as path from "path";
import { readCurrentActions } from "../core/action-backlog";
import {
  categorizeActionType,
  finalReviewStatus,
  readCurrentWorkOrders,
  touchWorkOrder,
  upsertWorkOrder,
  WorkOrderCategory,
} from "../core/work-orders";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ActionStatus, BacklogAction, WorkOrder, WorkOrderPlanningOrigin } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Approved Action Planner Agent — READ + PROPOSE only. Lee el Action
 * Backlog, detecta acciones que ya se pueden planificar — `approved`
 * (aprobada por un humano) o `auto_approved_for_planning` (aprobada por la
 * politica de autonomia, Fase O7, ver docs/autonomy-policy.md) — y crea
 * (o toca, si ya existe) una work order por cada una. NO genera el plan
 * detallado final para SEO/contenido/CRO (eso lo hacen los Work Order
 * Builders especializados que corren despues): aqui solo se crea el
 * borrador inicial y se categoriza. Nunca crea work orders para acciones
 * `rejected`, `snoozed`, `done` ni `blocked`.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "approved-action-planner");
const AGENT_NAME = "approved-action-planner";

// Fase O7: una accion se puede convertir en work order tanto si la aprobo
// un humano como si la aprobo automaticamente la politica de autonomia.
// rejected/snoozed/done/blocked quedan fuera a proposito (allowlist, no
// exclusion list, para que anadir un status nuevo en el futuro no cree
// work orders por accidente).
const PLANNABLE_STATUSES: ActionStatus[] = ["approved", "auto_approved_for_planning"];

function planningOriginFor(status: ActionStatus): WorkOrderPlanningOrigin {
  return status === "approved" ? "human_approved" : "auto_approved_for_planning";
}

const CATEGORY_LABELS: Record<WorkOrderCategory, string> = {
  seo: "SEO page improvement",
  content: "Content creation",
  cro: "CRO improvement",
  sem: "SEM recommendation",
  analytics: "Analytics validation",
  competitor_gap: "Competitor gap",
  other: "Otro",
};

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error(
      "No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento."
    );
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

interface DraftContent {
  proposedChanges: Record<string, unknown>;
  implementationChecklist: string[];
  risks: string[];
}

/**
 * Borrador inicial por categoria. Para seo/content/cro es deliberadamente
 * minimo: el detalle real lo anaden los Work Order Builders especializados
 * (SEO/Content/CRO) que corren justo despues en el pase diario, y son
 * ellos quienes deciden el status final (ready_for_review/auto_prepared,
 * ver finalReviewStatus()). Para sem/analytics/competitor_gap (sin
 * builder dedicado en esta fase) el contenido ya es el definitivo, asi
 * que el status final tambien se fija aqui mismo.
 */
function buildInitialDraft(category: WorkOrderCategory, action: BacklogAction): DraftContent {
  switch (category) {
    case "seo":
      return {
        proposedChanges: { pending: true, note: "Pendiente de detalle por el SEO Work Order Builder." },
        implementationChecklist: ["Pendiente de detalle (SEO Work Order Builder)."],
        risks: [],
      };
    case "content":
      return {
        proposedChanges: { pending: true, note: "Pendiente de detalle por el Content Work Order Builder." },
        implementationChecklist: ["Pendiente de detalle (Content Work Order Builder)."],
        risks: [],
      };
    case "cro":
      return {
        proposedChanges: { pending: true, note: "Pendiente de detalle por el CRO Work Order Builder." },
        implementationChecklist: ["Pendiente de detalle (CRO Work Order Builder)."],
        risks: [],
      };
    case "sem":
      return {
        proposedChanges: {
          summary: action.recommendation,
          reminder: "La campana de Google Ads sigue en PAUSED a proposito. Esta work order no la activa.",
        },
        implementationChecklist: [
          "Revisar la keyword/candidata SEM propuesta contra las keywords positivas actuales de la campana.",
          "Revisar solapamiento con las keywords negativas actuales.",
          "Decidir con el cliente la fecha de activacion — no activar por defecto.",
        ],
        risks: ["Activar la campana sin revision final podria gastar presupuesto en trafico no cualificado."],
      };
    case "analytics":
      return {
        proposedChanges: { summary: action.recommendation },
        implementationChecklist: [
          "Validar manualmente en GA4 (DebugView o Realtime) que el evento se dispara correctamente.",
        ],
        risks: [
          "Sin esta validacion, las decisiones de SEM/CRO podrian basarse en datos de conversion incompletos.",
        ],
      };
    case "competitor_gap":
      return {
        proposedChanges: { summary: action.recommendation },
        implementationChecklist: [
          "Valorar si procede crear contenido/landing nueva o ampliar una pagina existente.",
          "Confirmar la clasificacion de marca antes de asignar a Zentry, Tukandado o ambas.",
        ],
        risks: [],
      };
    default:
      return { proposedChanges: { summary: action.recommendation }, implementationChecklist: [], risks: [] };
  }
}

// Categorias que tienen un Work Order Builder dedicado corriendo despues
// en el pase diario — para esas, la work order se crea en "draft" y es el
// builder quien decide el status final.
const CATEGORIES_WITH_DEDICATED_BUILDER: WorkOrderCategory[] = ["seo", "content", "cro"];

export interface ApprovedActionPlannerRunResult {
  departmentRunId: string;
  approvedActionCount: number;
  humanApprovedCount: number;
  autoApprovedForPlanningCount: number;
  newWorkOrders: WorkOrder[];
  alreadyPlanned: WorkOrder[];
  byCategory: Record<string, number>;
  reportPath: string;
}

function buildReportMarkdown(result: ApprovedActionPlannerRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Approved Action Planner — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **Acciones planificables encontradas:** ${result.approvedActionCount}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se encontraron **${result.approvedActionCount}** accion(es) planificable(s) en el Action Backlog: **${result.humanApprovedCount}** aprobada(s) por un humano (\`approved\`) y **${result.autoApprovedForPlanningCount}** auto-aprobada(s) para planificacion por la politica de autonomia (\`auto_approved_for_planning\`, Fase O7). Se crearon **${result.newWorkOrders.length}** work order(s) nueva(s) y **${result.alreadyPlanned.length}** ya tenian una work order (no se duplican). Ninguna work order ejecuta nada: son planes de ejecucion para revision humana, ni siquiera en su estado mas avanzado.`
  );
  lines.push("");

  lines.push("## Por categoria");
  lines.push("");
  lines.push("| Categoria | Acciones planificables |");
  lines.push("|---|---|");
  for (const [category, count] of Object.entries(result.byCategory)) {
    lines.push(`| ${CATEGORY_LABELS[category as WorkOrderCategory] ?? category} | ${count} |`);
  }
  lines.push("");

  lines.push(`## Work orders nuevas (${result.newWorkOrders.length})`);
  lines.push("");
  if (result.newWorkOrders.length === 0) {
    lines.push("Ninguna.");
  } else {
    for (const wo of result.newWorkOrders) {
      lines.push(
        `- [${wo.priority}] \`${wo.workOrderId}\` ${wo.sourceActionTitle} (${categorizeActionType(wo.actionType)}, origen: ${wo.planningOrigin}, status: ${wo.status})`
      );
    }
  }
  lines.push("");

  lines.push(`## Ya planificadas anteriormente (${result.alreadyPlanned.length})`);
  lines.push("");
  if (result.alreadyPlanned.length === 0) {
    lines.push("Ninguna.");
  } else {
    for (const wo of result.alreadyPlanned) {
      lines.push(`- [${wo.status}] \`${wo.workOrderId}\` ${wo.sourceActionTitle}`);
    }
  }
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Ninguna work order implica ejecucion real, ni en `ready_for_review`, ni en `auto_prepared`, ni en `approved_to_prepare`.");
  lines.push("- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: ApprovedActionPlannerRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `approved-action-planner-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runApprovedActionPlanner(
  departmentRunId?: string
): Promise<ApprovedActionPlannerRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Approved Action Planner Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_started",
    summary: "Approved Action Planner Agent iniciado",
  });

  const planningActions = readCurrentActions().filter((a) => PLANNABLE_STATUSES.includes(a.status));
  const currentWorkOrders = readCurrentWorkOrders();

  const newWorkOrders: WorkOrder[] = [];
  const alreadyPlanned: WorkOrder[] = [];
  const byCategory: Record<string, number> = {};
  let humanApprovedCount = 0;
  let autoApprovedForPlanningCount = 0;

  for (const action of planningActions) {
    if (action.status === "approved") humanApprovedCount++;
    else autoApprovedForPlanningCount++;

    const category = categorizeActionType(action.actionType);
    byCategory[category] = (byCategory[category] ?? 0) + 1;

    const existing = currentWorkOrders.find((w) => w.actionId === action.actionId);
    if (existing) {
      const touched = touchWorkOrder(existing.workOrderId, AGENT_NAME);
      alreadyPlanned.push(touched ?? existing);
      continue;
    }

    const planningOrigin = planningOriginFor(action.status);
    const draft = buildInitialDraft(category, action);
    const hasDedicatedBuilder = CATEGORIES_WITH_DEDICATED_BUILDER.includes(category);

    const { workOrder, isNew } = upsertWorkOrder(
      {
        actionId: action.actionId,
        canonicalKey: action.canonicalKey,
        sourceActionTitle: action.title,
        brandIntent: action.brandIntent,
        targetBrand: action.targetBrand,
        actionType: action.actionType,
        keyword: action.keyword,
        page: action.page,
        priority: action.priority,
        impact: action.impact,
        effort: action.effort,
        requiresHumanReview: true,
        planningOrigin,
        autonomyLevel: action.autonomyLevel,
        riskLevel: action.riskLevel,
        requiresApproval: action.requiresApproval,
        proposedChanges: draft.proposedChanges,
        implementationChecklist: draft.implementationChecklist,
        risks: draft.risks,
        sourceAgent: AGENT_NAME,
        // Sin builder dedicado el contenido ya es definitivo, asi que el
        // status final se fija aqui mismo en vez de quedarse en "draft"
        // para siempre (nadie mas lo tocaria despues).
        initialStatus: hasDedicatedBuilder ? undefined : finalReviewStatus(planningOrigin),
      },
      currentWorkOrders
    );

    if (isNew) {
      newWorkOrders.push(workOrder);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "action_proposed",
        priority: workOrder.priority,
        summary: `Nueva work order: ${workOrder.sourceActionTitle} (${category}, origen: ${planningOrigin})`,
        payload: { workOrderId: workOrder.workOrderId, actionId: workOrder.actionId, category, planningOrigin },
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const result: ApprovedActionPlannerRunResult = {
    departmentRunId: deptRunId,
    approvedActionCount: planningActions.length,
    humanApprovedCount,
    autoApprovedForPlanningCount,
    newWorkOrders,
    alreadyPlanned,
    byCategory,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `Approved Action Planner Agent finalizado. Nuevas work orders: ${newWorkOrders.length} (humanas: ${humanApprovedCount}, auto: ${autoApprovedForPlanningCount}). Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Approved Action Planner Agent finalizado: ${newWorkOrders.length} work order(s) nueva(s)`,
    payload: {
      approvedActionCount: planningActions.length,
      humanApprovedCount,
      autoApprovedForPlanningCount,
      newWorkOrderCount: newWorkOrders.length,
      reportPath: result.reportPath,
    },
  });

  return result;
}
