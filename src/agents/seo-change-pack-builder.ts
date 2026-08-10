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
 * SEO Change Pack Builder — READ + PROPOSE only. Convierte work orders
 * SEO ya detalladas (`auto_prepared`/`ready_for_review`/
 * `approved_to_prepare`) en un change pack: los mismos title/meta/H1/H2/
 * copy/FAQs/enlaces/schema de la work order, mas pasos de implementacion
 * concretos, checklist de revision humana y notas de reversion. NUNCA
 * toca WordPress: solo repaqueta la propuesta que ya existia.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "seo-change-packs");
const AGENT_NAME = "seo-change-pack-builder";
const CHANGE_TYPE = "seo_on_page_update";

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

interface SeoProposedChanges {
  page: string;
  primaryKeyword: string;
  proposedTitle: string;
  proposedMetaDescription: string;
  proposedH1: string;
  suggestedH2s: string[];
  copyBlock: string;
  suggestedFaqs: Array<{ question: string; answer: string }>;
  suggestedInternalLinks: string[];
  schema: string;
  cannibalizationRisk: string;
}

function buildImplementationSteps(): string[] {
  return [
    "Actualizar el title de la pagina segun la propuesta.",
    "Actualizar la meta description segun la propuesta.",
    "Revisar y, si aplica, actualizar el H1 y los H2 sugeridos.",
    "Incorporar el bloque de copy propuesto donde corresponda en la pagina.",
    "Anadir las FAQs sugeridas si encajan con el contenido real.",
    "Revisar e incorporar los enlaces internos sugeridos.",
    "Aplicar el schema sugerido si el sitio lo soporta.",
    "Publicar SOLO tras aprobacion humana explicita — este paquete no publica nada por si mismo.",
  ];
}

function buildHumanReviewChecklist(): string[] {
  return [
    "Confirmar que el title y la meta description encajan con la voz de marca real (la propuesta es orientativa, no definitiva).",
    "Validar el H1/H2 contra el contenido real de la pagina antes de aplicar.",
    "Revisar el riesgo de canibalizacion senalado antes de publicar.",
    ...PRODUCTION_SAFETY_CHECKLIST_ITEMS,
  ];
}

function buildRisks(proposal: SeoProposedChanges): string[] {
  const risks = [proposal.cannibalizationRisk];
  risks.push("Cambiar el title/meta puede provocar una fluctuacion temporal de CTR mientras Google reindexa la pagina.");
  return risks;
}

function buildCurrentAssumptions(proposal: SeoProposedChanges): string[] {
  return [
    `Se asume que la pagina ${proposal.page} sigue existiendo en esa URL.`,
    "Se asume que el contenido actual de la pagina no ha cambiado sustancialmente desde que se genero la work order origen.",
    `Se asume que "${proposal.primaryKeyword}" sigue siendo la keyword principal relevante para esta pagina.`,
  ];
}

export interface SeoChangePackBuilderRunResult {
  departmentRunId: string;
  newChangePacks: ChangePack[];
  alreadyExisting: ChangePack[];
  reportPath: string;
}

function buildReportMarkdown(result: SeoChangePackBuilderRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# SEO Change Packs — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se crearon **${result.newChangePacks.length}** change pack(s) SEO nuevo(s) y **${result.alreadyExisting.length}** ya existian (no se duplican). Ningun change pack ejecuta nada: son paquetes de cambio concretos para revision humana, listos para una futura ejecucion controlada que hoy no existe.`
  );
  lines.push("");

  lines.push(`## Change packs nuevos (${result.newChangePacks.length})`);
  lines.push("");
  if (result.newChangePacks.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const cp of result.newChangePacks) {
      lines.push(`- [${cp.priority}] \`${cp.changePackId}\` ${cp.keyword} (${cp.page ?? "sin pagina"}) — status: ${cp.status}`);
    }
  }
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado ni publicado nada en WordPress.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee work orders existentes y las repaqueta; no genera contenido nuevo desde cero.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: SeoChangePackBuilderRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `seo-change-packs-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runSeoChangePackBuilder(departmentRunId?: string): Promise<SeoChangePackBuilderRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("SEO Change Pack Builder iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "SEO Change Pack Builder iniciado" });

  const eligibleWorkOrders = readCurrentWorkOrders().filter(
    (w) => isEligibleWorkOrder(w) && categorizeActionType(w.actionType) === "seo"
  );
  const currentChangePacks = readCurrentChangePacks();

  const newChangePacks: ChangePack[] = [];
  const alreadyExisting: ChangePack[] = [];

  for (const workOrder of eligibleWorkOrders) {
    const proposal = workOrder.proposedChanges as unknown as SeoProposedChanges;
    const { changePack, isNew } = upsertChangePack(
      {
        workOrder,
        changeType: CHANGE_TYPE,
        proposedChanges: workOrder.proposedChanges,
        currentAssumptions: buildCurrentAssumptions(proposal),
        implementationSteps: buildImplementationSteps(),
        humanReviewChecklist: buildHumanReviewChecklist(),
        risks: buildRisks(proposal),
        rollbackNotes: buildGenericRollbackNotes(workOrder.page ?? "la pagina afectada"),
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
        summary: `Change pack SEO listo para revisar: ${changePack.keyword}`,
        payload: { changePackId: changePack.changePackId, workOrderId: changePack.workOrderId },
      });
    } else {
      alreadyExisting.push(changePack);
    }
  }

  const generatedAt = new Date().toISOString();
  const result: SeoChangePackBuilderRunResult = { departmentRunId: deptRunId, newChangePacks, alreadyExisting, reportPath: "" };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(`SEO Change Pack Builder finalizado. Nuevos: ${newChangePacks.length}. Informe: ${result.reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `SEO Change Pack Builder finalizado: ${newChangePacks.length} change pack(s) nuevo(s)`,
    payload: { newCount: newChangePacks.length, alreadyExistingCount: alreadyExisting.length, reportPath: result.reportPath },
  });

  return result;
}
