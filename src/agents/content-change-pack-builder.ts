import * as fs from "fs";
import * as path from "path";
import {
  buildGenericRollbackNotes,
  isEligibleWorkOrder,
  PRODUCTION_SAFETY_CHECKLIST_ITEMS,
  readCurrentChangePacks,
  upsertChangePack,
} from "../core/change-packs";
import { categorizeActionType, readCurrentWorkOrders } from "../core/work-orders";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ChangePack, WorkOrder } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Content Change Pack Builder — READ + PROPOSE only. Convierte work
 * orders de contenido ya detalladas (`auto_prepared`/`ready_for_review`/
 * `approved_to_prepare`) en un change pack: el mismo brief (estructura,
 * CTA, enlaces, cluster SEO) de la work order, mas pasos de
 * implementacion, checklist de revision y notas de reversion. NUNCA
 * escribe en WordPress ni redacta el articulo final — sigue siendo un
 * brief, no contenido publicable.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "content-change-packs");
const AGENT_NAME = "content-change-pack-builder";

interface ContentProposedChanges {
  contentType: string;
  recommendedTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  structure: string[];
  recommendedCta: string;
  internalLinks: string[];
  clusterNote: string;
}

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function resolveChangeType(workOrder: WorkOrder): string {
  return workOrder.actionType === "content:new_landing" ? "new_content_page" : "content_update";
}

function buildImplementationSteps(): string[] {
  return [
    "Redactar el contenido final siguiendo la estructura propuesta (este paquete solo tiene el brief, no el articulo terminado).",
    "Incluir el CTA recomendado en el lugar adecuado del contenido.",
    "Anadir los enlaces internos sugeridos.",
    "Revisar el cluster SEO senalado para no competir con contenido propio ya publicado.",
    "Publicar SOLO tras aprobacion humana explicita — este paquete no publica nada por si mismo.",
  ];
}

function buildHumanReviewChecklist(): string[] {
  return [
    "Confirmar el brief con el equipo de contenido antes de redactar el texto final.",
    "Verificar que no compite con otro contenido ya publicado (ver el cluster SEO senalado).",
    "Confirmar que el tono encaja con la voz de marca real.",
    ...PRODUCTION_SAFETY_CHECKLIST_ITEMS,
  ];
}

function buildRisks(proposal: ContentProposedChanges): string[] {
  const risks: string[] = [];
  if (proposal.clusterNote && !proposal.clusterNote.toLowerCase().includes("no se detectaron")) {
    risks.push(proposal.clusterNote);
  }
  risks.push("Publicar contenido nuevo sin revisar el cluster SEO puede generar canibalizacion con paginas ya existentes.");
  return risks;
}

function buildCurrentAssumptions(proposal: ContentProposedChanges, workOrder: WorkOrder): string[] {
  const assumptions = [
    `Se asume que "${proposal.primaryKeyword}" sigue siendo relevante para ${workOrder.targetBrand === "both" ? "Zentry y Tukandado" : workOrder.targetBrand}.`,
    "Se asume que el brief sigue vigente (no ha cambiado la estrategia de contenido desde que se genero la work order origen).",
  ];
  if (workOrder.page) {
    assumptions.push(`Se asume que la pagina ${workOrder.page} sigue existiendo en esa URL.`);
  }
  return assumptions;
}

export interface ContentChangePackBuilderRunResult {
  departmentRunId: string;
  newChangePacks: ChangePack[];
  alreadyExisting: ChangePack[];
  reportPath: string;
}

function buildReportMarkdown(result: ContentChangePackBuilderRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Content Change Packs — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se crearon **${result.newChangePacks.length}** change pack(s) de contenido nuevo(s) y **${result.alreadyExisting.length}** ya existian (no se duplican). Ninguno es el articulo final: son briefs empaquetados para revision humana.`
  );
  lines.push("");

  lines.push(`## Change packs nuevos (${result.newChangePacks.length})`);
  lines.push("");
  if (result.newChangePacks.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const cp of result.newChangePacks) {
      lines.push(`- [${cp.priority}] \`${cp.changePackId}\` ${cp.keyword} (${cp.changeType}) — status: ${cp.status}`);
    }
  }
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha escrito ni publicado nada en WordPress.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee work orders existentes y las repaqueta.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: ContentChangePackBuilderRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `content-change-packs-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runContentChangePackBuilder(departmentRunId?: string): Promise<ContentChangePackBuilderRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Content Change Pack Builder iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Content Change Pack Builder iniciado" });

  const eligibleWorkOrders = readCurrentWorkOrders().filter(
    (w) => isEligibleWorkOrder(w) && categorizeActionType(w.actionType) === "content"
  );
  const currentChangePacks = readCurrentChangePacks();

  const newChangePacks: ChangePack[] = [];
  const alreadyExisting: ChangePack[] = [];

  for (const workOrder of eligibleWorkOrders) {
    const proposal = workOrder.proposedChanges as unknown as ContentProposedChanges;
    const { changePack, isNew } = upsertChangePack(
      {
        workOrder,
        changeType: resolveChangeType(workOrder),
        proposedChanges: workOrder.proposedChanges,
        currentAssumptions: buildCurrentAssumptions(proposal, workOrder),
        implementationSteps: buildImplementationSteps(),
        humanReviewChecklist: buildHumanReviewChecklist(),
        risks: buildRisks(proposal),
        rollbackNotes: buildGenericRollbackNotes(workOrder.page ?? "la pagina/contenido afectado"),
        sourceAgent: AGENT_NAME,
      },
      currentChangePacks
    );

    if (isNew) {
      newChangePacks.push(changePack);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "recommendation_created",
        priority: changePack.priority,
        summary: `Change pack de contenido listo para revisar: ${changePack.keyword}`,
        payload: { changePackId: changePack.changePackId, workOrderId: changePack.workOrderId },
      });
    } else {
      alreadyExisting.push(changePack);
    }
  }

  const generatedAt = new Date().toISOString();
  const result: ContentChangePackBuilderRunResult = { departmentRunId: deptRunId, newChangePacks, alreadyExisting, reportPath: "" };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(`Content Change Pack Builder finalizado. Nuevos: ${newChangePacks.length}. Informe: ${result.reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Content Change Pack Builder finalizado: ${newChangePacks.length} change pack(s) nuevo(s)`,
    payload: { newCount: newChangePacks.length, alreadyExistingCount: alreadyExisting.length, reportPath: result.reportPath },
  });

  return result;
}
