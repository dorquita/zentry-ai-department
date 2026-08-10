import * as fs from "fs";
import * as path from "path";
import { classifyOpportunity, BRAND_INTENT_CATEGORY_LABELS } from "../core/brand-intent-router";
import { categorizeActionType, finalReviewStatus, readCurrentWorkOrders, updateWorkOrderContent } from "../core/work-orders";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { BrandIntentCategory, WorkOrder } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * CRO Work Order Builder — READ + PROPOSE only. Amplia las work orders
 * `draft` de categoria CRO con una propuesta de conversion concreta (CTA,
 * ubicacion, formulario, confianza, FAQ, mejoras visuales, test A/B).
 * NUNCA toca WordPress.
 *
 * Fase O7: el status final (`ready_for_review` o `auto_prepared`) lo
 * decide `finalReviewStatus()` segun el `planningOrigin` de la work
 * order.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "cro-work-orders");
const AGENT_NAME = "cro-work-order-builder";

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

interface CroProposedChanges {
  page: string;
  targetBrand: string;
  brandRationale: string;
  newCta: string;
  ctaPlacement: string;
  form: string;
  trustBlock: string;
  faqSection: string;
  visualImprovements: string[];
  suggestedAbTest?: string;
  risk: string;
  effort: string;
}

function buildNewCta(category: BrandIntentCategory): string {
  switch (category) {
    case "zentry_locker_core":
      return '"Solicitar presupuesto sin compromiso"';
    case "zentry_smart_locker":
      return '"Quiero la solucion completa" (mueble + cerradura)';
    case "tukandado_lock_core":
      return '"Hablar con un tecnico" / "Solicitar ficha tecnica"';
    case "mixed_cross_sell":
      return 'CTA doble: "Ver taquillas" (Zentry) + "Ver cerraduras" (Tukandado)';
    default:
      return '"Contactar"';
  }
}

function buildCtaPlacement(category: BrandIntentCategory): string {
  return category === "mixed_cross_sell"
    ? "Above the fold, con los dos CTAs lado a lado (o apilados en movil) justo debajo del H1."
    : "Above the fold, junto al H1, y repetido al final de la pagina tras el bloque de confianza.";
}

function buildForm(category: BrandIntentCategory): string {
  switch (category) {
    case "zentry_locker_core":
      return "Formulario corto (nombre, email/telefono, cantidad y medidas aproximadas) para acelerar el presupuesto.";
    case "zentry_smart_locker":
      return "Formulario de solicitud de demo (nombre, empresa, num. de taquillas a digitalizar).";
    case "tukandado_lock_core":
      return "Formulario B2B (empresa, volumen estimado, tipo de proyecto) — no un formulario de venta al por menor.";
    case "mixed_cross_sell":
      return "Formulario con selector previo: \"Busco mueble\" / \"Busco cerradura\" / \"Busco ambos\", que adapta los campos siguientes.";
    default:
      return "Formulario de contacto simple.";
  }
}

function buildTrustBlock(category: BrandIntentCategory): string {
  switch (category) {
    case "zentry_locker_core":
      return "Anos de experiencia como fabricante, numero de proyectos entregados, sellos de calidad de materiales.";
    case "zentry_smart_locker":
      return "Casos de exito de digitalizacion, garantia conjunta Zentry+Tukandado, certificaciones de la cerradura.";
    case "tukandado_lock_core":
      return "Logos de fabricantes/integradores que ya usan la cerradura, certificaciones tecnicas, garantia del componente.";
    case "mixed_cross_sell":
      return "Bloque combinado: casos de exito de ambas lineas (mueble y cerradura).";
    default:
      return "Testimonios o sellos de confianza genericos.";
  }
}

function buildVisualImprovements(category: BrandIntentCategory): string[] {
  const base = [
    "Asegurar que el CTA principal tiene contraste suficiente y es visible sin hacer scroll.",
    "Anadir foto/video real del producto (no solo render generico) cerca del formulario.",
  ];
  if (category === "mixed_cross_sell") {
    base.push("Usar dos columnas o dos tarjetas claramente diferenciadas (Zentry vs Tukandado) para no confundir al visitante.");
  }
  if (category === "zentry_smart_locker") {
    base.push("Incluir un diagrama simple del flujo de apertura (app/tarjeta -> cerradura -> taquilla) para explicar la tecnologia.");
  }
  return base;
}

function buildAbTest(category: BrandIntentCategory): string | undefined {
  switch (category) {
    case "zentry_locker_core":
      return 'Test A/B del texto del CTA: "Solicitar presupuesto" vs "Ver precios" — medir tasa de envio del formulario.';
    case "mixed_cross_sell":
      return "Test A/B de orden de los dos CTAs (mueble primero vs cerradura primero) para ver cual convierte mas segun el trafico real de esta keyword.";
    default:
      return undefined;
  }
}

function assessRisk(category: BrandIntentCategory): string {
  return category === "mixed_cross_sell"
    ? "Medio: mostrar dos ofertas a la vez puede diluir la conversion si no esta bien diferenciado visualmente."
    : "Bajo: cambios de CTA/formulario/confianza son reversibles y de bajo riesgo tecnico.";
}

function assessEffort(workOrder: WorkOrder): string {
  return workOrder.effort ?? "medium";
}

function buildCroProposal(workOrder: WorkOrder): CroProposedChanges {
  const intent = classifyOpportunity({ keyword: workOrder.keyword, page: workOrder.page });
  return {
    page: workOrder.page ?? "(sin pagina asociada)",
    targetBrand: BRAND_INTENT_CATEGORY_LABELS[intent.category],
    brandRationale: intent.reason,
    newCta: buildNewCta(intent.category),
    ctaPlacement: buildCtaPlacement(intent.category),
    form: buildForm(intent.category),
    trustBlock: buildTrustBlock(intent.category),
    faqSection: "Anadir/revisar seccion FAQ con 3-4 preguntas de friccion (plazos, garantia, instalacion, compatibilidad) justo antes del formulario.",
    visualImprovements: buildVisualImprovements(intent.category),
    suggestedAbTest: buildAbTest(intent.category),
    risk: assessRisk(intent.category),
    effort: assessEffort(workOrder),
  };
}

function buildChecklist(): string[] {
  return [
    "Validar el nuevo CTA/formulario con el equipo antes de implementar.",
    "Confirmar que el bloque de confianza usa datos reales (no inventados).",
    "Si hay test A/B sugerido, definir metrica de exito y duracion minima antes de lanzarlo.",
    "Implementar en WordPress solo tras revision humana — este plan no publica nada.",
  ];
}

export interface CroWorkOrderBuilderRunResult {
  departmentRunId: string;
  enrichedWorkOrders: WorkOrder[];
  reportPath: string;
}

function buildReportMarkdown(result: CroWorkOrderBuilderRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# CRO Work Orders — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **Propuestas generadas:** ${result.enrichedWorkOrders.length}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se generaron **${result.enrichedWorkOrders.length}** propuesta(s) de conversion detalladas. Ninguna se ha aplicado en WordPress: son planes para revision humana.`
  );
  lines.push("");

  for (const wo of result.enrichedWorkOrders) {
    const p = wo.proposedChanges as unknown as CroProposedChanges;
    lines.push(`## [${wo.priority}] ${wo.sourceActionTitle}`);
    lines.push("");
    lines.push(`- **workOrderId:** \`${wo.workOrderId}\``);
    lines.push(`- **Status:** ${wo.status} (origen: ${wo.planningOrigin})`);
    lines.push(`- **Pagina:** ${p.page}`);
    lines.push(`- **Marca objetivo:** ${p.targetBrand} — ${p.brandRationale}`);
    lines.push(`- **CTA nuevo:** ${p.newCta}`);
    lines.push(`- **Ubicacion del CTA:** ${p.ctaPlacement}`);
    lines.push(`- **Formulario:** ${p.form}`);
    lines.push(`- **Bloque de confianza:** ${p.trustBlock}`);
    lines.push(`- **Seccion FAQ:** ${p.faqSection}`);
    lines.push(`- **Mejoras visuales:**`);
    for (const v of p.visualImprovements) lines.push(`  - ${v}`);
    if (p.suggestedAbTest) lines.push(`- **Prueba A/B sugerida:** ${p.suggestedAbTest}`);
    lines.push(`- **Riesgo:** ${p.risk}`);
    lines.push(`- **Esfuerzo:** ${p.effort}`);
    lines.push(`- **Checklist de revision:**`);
    for (const item of wo.implementationChecklist) lines.push(`  - [ ] ${item}`);
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado ni publicado nada en WordPress.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee work orders existentes y propone.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: CroWorkOrderBuilderRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `cro-work-orders-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runCroWorkOrderBuilder(departmentRunId?: string): Promise<CroWorkOrderBuilderRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("CRO Work Order Builder iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "CRO Work Order Builder iniciado" });

  const draftCroWorkOrders = readCurrentWorkOrders().filter(
    (w) => w.status === "draft" && categorizeActionType(w.actionType) === "cro"
  );

  const enrichedWorkOrders: WorkOrder[] = [];

  for (const wo of draftCroWorkOrders) {
    const proposal = buildCroProposal(wo);
    const updated = updateWorkOrderContent(wo.workOrderId, {
      proposedChanges: proposal as unknown as Record<string, unknown>,
      implementationChecklist: buildChecklist(),
      risks: [proposal.risk],
      status: finalReviewStatus(wo.planningOrigin),
      sourceAgent: AGENT_NAME,
    });
    if (updated) {
      enrichedWorkOrders.push(updated);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "recommendation_created",
        priority: updated.priority,
        summary: `Propuesta CRO lista para revisar: ${updated.sourceActionTitle}`,
        payload: { workOrderId: updated.workOrderId },
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const result: CroWorkOrderBuilderRunResult = { departmentRunId: deptRunId, enrichedWorkOrders, reportPath: "" };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(`CRO Work Order Builder finalizado. Ampliadas: ${enrichedWorkOrders.length}. Informe: ${result.reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `CRO Work Order Builder finalizado: ${enrichedWorkOrders.length} propuesta(s) lista(s)`,
    payload: { enrichedCount: enrichedWorkOrders.length, reportPath: result.reportPath },
  });

  return result;
}
