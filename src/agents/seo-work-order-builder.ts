import * as fs from "fs";
import * as path from "path";
import { classifyOpportunity, BRAND_INTENT_CATEGORY_LABELS } from "../core/brand-intent-router";
import { readCurrentActions } from "../core/action-backlog";
import { categorizeActionType, finalReviewStatus, readCurrentWorkOrders, updateWorkOrderContent } from "../core/work-orders";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { BrandIntentCategory, WorkOrder } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * SEO Work Order Builder — READ + PROPOSE only. Amplia las work orders
 * `draft` de categoria SEO con un plan on-page detallado (title, meta,
 * H1/H2, copy, FAQs, enlaces internos, schema, riesgo de canibalizacion).
 * NUNCA toca WordPress: solo escribe la propuesta en el work order.
 *
 * Fase O7: el status final (`ready_for_review` o `auto_prepared`) lo
 * decide `finalReviewStatus()` segun el `planningOrigin` de la work
 * order (si la accion origen la aprobo un humano o la politica de
 * autonomia) — este agente no decide eso, solo enriquece el contenido.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "seo-work-orders");
const AGENT_NAME = "seo-work-order-builder";

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function capitalizeWords(text: string): string {
  return text
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1).trimEnd() + "…";
}

interface SeoProposedChanges {
  page: string;
  primaryKeyword: string;
  searchIntent: string;
  targetBrand: string;
  brandRationale: string;
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

function buildSeoIntentLabel(category: BrandIntentCategory): string {
  switch (category) {
    case "zentry_locker_core":
      return "Compra de mobiliario/taquillas — el usuario quiere el mueble.";
    case "zentry_smart_locker":
      return "Compra de la solucion completa — mueble + cerradura inteligente.";
    case "tukandado_lock_core":
      return "Compra de cerradura/control de acceso — el usuario quiere la cerradura, no necesariamente el mueble.";
    case "mixed_cross_sell":
      return "Intencion ambigua — puede derivar a mueble o a cerradura segun como se aborde.";
    default:
      return "Intencion no comercial detectada — revisar si merece la pena atacar esta keyword.";
  }
}

function buildTitle(keyword: string, category: BrandIntentCategory): string {
  const cap = capitalizeWords(keyword);
  switch (category) {
    case "zentry_locker_core":
      return truncate(`${cap} | Fabricante y venta directa - Zentry`, 60);
    case "zentry_smart_locker":
      return truncate(`${cap}: taquilla + cerradura inteligente - Zentry`, 60);
    case "tukandado_lock_core":
      return truncate(`${cap} | Cerraduras electronicas para taquillas - Tukandado`, 60);
    case "mixed_cross_sell":
      return truncate(`${cap} | Zentry y Tukandado`, 60);
    default:
      return truncate(cap, 60);
  }
}

function buildMetaDescription(keyword: string, category: BrandIntentCategory): string {
  switch (category) {
    case "zentry_locker_core":
      return truncate(
        `${capitalizeWords(keyword)}: fabricante directo, entrega rapida y presupuesto sin compromiso. Descubre modelos, materiales y precios con Zentry.`,
        160
      );
    case "zentry_smart_locker":
      return truncate(
        `${capitalizeWords(keyword)} con cerradura inteligente integrada. Solucion completa Zentry + Tukandado: mueble y tecnologia de apertura en un solo proveedor.`,
        160
      );
    case "tukandado_lock_core":
      return truncate(
        `${capitalizeWords(keyword)}: cerradura electronica Tukandado, compatible con fabricantes de taquillas. Ficha tecnica y contacto directo con un especialista.`,
        160
      );
    case "mixed_cross_sell":
      return truncate(
        `${capitalizeWords(keyword)}: descubre si necesitas el mueble, la cerradura o la solucion completa. Zentry y Tukandado te asesoran sin compromiso.`,
        160
      );
    default:
      return truncate(`${capitalizeWords(keyword)} — informacion y contacto.`, 160);
  }
}

function buildH2s(category: BrandIntentCategory, keyword: string): string[] {
  switch (category) {
    case "zentry_locker_core":
      return [
        "Modelos y medidas disponibles",
        "Materiales: metalica, fenolica o melamina",
        "Precios y presupuesto sin compromiso",
        `Preguntas frecuentes sobre ${keyword}`,
      ];
    case "zentry_smart_locker":
      return [
        "Como funciona la cerradura inteligente",
        "Ventajas de digitalizar tus taquillas",
        "Casos de uso: gimnasios, empresas, centros deportivos",
        "Solicita una demo",
      ];
    case "tukandado_lock_core":
      return [
        "Especificaciones tecnicas de la cerradura",
        "Integracion con fabricantes de taquillas",
        "Casos de exito",
        "Contacta con un tecnico",
      ];
    case "mixed_cross_sell":
      return [
        "Que necesitas: mueble, cerradura o ambos",
        "Solucion Zentry (mobiliario)",
        "Solucion Tukandado (cerradura)",
        "Habla con nuestro equipo",
      ];
    default:
      return ["Informacion general", "Contacto"];
  }
}

function buildCopyBlock(keyword: string, category: BrandIntentCategory): string {
  switch (category) {
    case "zentry_locker_core":
      return `En Zentry fabricamos y vendemos directamente ${keyword}, con envio rapido y precios competitivos al ser fabricante. Elige entre distintos materiales y medidas segun tu espacio y presupuesto.`;
    case "zentry_smart_locker":
      return `Combina el mobiliario de Zentry con la cerradura electronica de Tukandado: ${keyword} listas para digitalizar el acceso, sin cables ni llaves fisicas que gestionar.`;
    case "tukandado_lock_core":
      return `Tukandado desarrolla ${keyword} pensadas para integrarse en mobiliario ya existente o nuevo. Compatible con fabricantes de taquillas y proyectos de digitalizacion.`;
    case "mixed_cross_sell":
      return `Tanto si buscas ${keyword} como mueble, como cerradura, o la solucion completa, Zentry y Tukandado te ayudan a elegir la combinacion adecuada.`;
    default:
      return `Informacion sobre ${keyword}.`;
  }
}

function buildFaqs(category: BrandIntentCategory): Array<{ question: string; answer: string }> {
  switch (category) {
    case "zentry_locker_core":
      return [
        { question: "¿Cuanto tarda la entrega?", answer: "Al ser fabricante directo, los plazos suelen ser mas cortos que con un intermediario — confirmar plazo exacto segun stock/personalizacion." },
        { question: "¿Que garantia tienen las taquillas?", answer: "Indicar la garantia real del producto (pendiente de confirmar con el equipo)." },
      ];
    case "zentry_smart_locker":
      return [
        { question: "¿Puedo anadir la cerradura inteligente a taquillas que ya tengo?", answer: "Depende del modelo — confirmar compatibilidad con el equipo tecnico." },
        { question: "¿Como se gestiona el acceso sin llave fisica?", answer: "Explicar el sistema de apertura (app, tarjeta, codigo...) segun el modelo Tukandado integrado." },
      ];
    case "tukandado_lock_core":
      return [
        { question: "¿La cerradura es compatible con mi mobiliario actual?", answer: "Confirmar compatibilidad segun fabricante y modelo de taquilla." },
        { question: "¿Se puede pedir solo la cerradura sin el mueble?", answer: "Si — Tukandado vende la cerradura de forma independiente para integradores y fabricantes." },
      ];
    case "mixed_cross_sell":
      return [
        { question: "¿Necesito comprar el mueble y la cerradura al mismo proveedor?", answer: "No es obligatorio, pero Zentry + Tukandado ofrecen la solucion integrada con garantia conjunta." },
      ];
    default:
      return [];
  }
}

function buildInternalLinks(category: BrandIntentCategory): string[] {
  switch (category) {
    case "zentry_locker_core":
      return ["Enlazar hacia la landing general de taquillas Zentry", "Enlazar hacia la pagina de presupuesto/contacto"];
    case "zentry_smart_locker":
      return [
        "Enlazar hacia la landing de cerraduras inteligentes (Tukandado)",
        "Enlazar hacia casos de digitalizacion de taquillas",
      ];
    case "tukandado_lock_core":
      return ["Enlazar hacia el catalogo de taquillas de Zentry (para quien busca el mueble completo)", "Enlazar hacia la ficha tecnica de la cerradura"];
    case "mixed_cross_sell":
      return ["Enlazar hacia la landing Zentry (mueble)", "Enlazar hacia la landing Tukandado (cerradura)"];
    default:
      return [];
  }
}

function buildSchema(category: BrandIntentCategory, hasFaqs: boolean): string {
  const base = category === "tukandado_lock_core" ? "Product (cerradura) o Service" : "Product (taquilla/locker)";
  return hasFaqs ? `${base} + FAQPage` : base;
}

function assessCannibalizationRisk(
  keyword: string,
  page: string | undefined,
  targetBrand: string
): string {
  const allActions = readCurrentActions();
  const normalizedKeyword = keyword.trim().toLowerCase();
  const overlapping = allActions.filter(
    (a) =>
      a.targetBrand === targetBrand &&
      a.page !== page &&
      (a.keyword.toLowerCase().includes(normalizedKeyword) || normalizedKeyword.includes(a.keyword.toLowerCase())) &&
      a.keyword.toLowerCase() !== normalizedKeyword
  );
  if (overlapping.length === 0) {
    return "Bajo: no se detecto otra accion del backlog con keyword solapada apuntando a una pagina distinta.";
  }
  const pages = [...new Set(overlapping.map((a) => a.page).filter(Boolean))];
  return `Medio: hay ${overlapping.length} accion(es) con keyword similar apuntando a pagina(s) distinta(s) (${pages.join(", ")}). Revisar solapamiento antes de publicar para no competir contra contenido propio.`;
}

function buildSeoProposal(workOrder: WorkOrder): SeoProposedChanges {
  const intent = classifyOpportunity({ keyword: workOrder.keyword, page: workOrder.page });
  const faqs = buildFaqs(intent.category);
  return {
    page: workOrder.page ?? "(sin pagina asociada)",
    primaryKeyword: workOrder.keyword,
    searchIntent: buildSeoIntentLabel(intent.category),
    targetBrand: BRAND_INTENT_CATEGORY_LABELS[intent.category],
    brandRationale: intent.reason,
    proposedTitle: buildTitle(workOrder.keyword, intent.category),
    proposedMetaDescription: buildMetaDescription(workOrder.keyword, intent.category),
    proposedH1: capitalizeWords(workOrder.keyword),
    suggestedH2s: buildH2s(intent.category, workOrder.keyword),
    copyBlock: buildCopyBlock(workOrder.keyword, intent.category),
    suggestedFaqs: faqs,
    suggestedInternalLinks: buildInternalLinks(intent.category),
    schema: buildSchema(intent.category, faqs.length > 0),
    cannibalizationRisk: assessCannibalizationRisk(workOrder.keyword, workOrder.page, workOrder.targetBrand),
  };
}

function buildChecklist(): string[] {
  return [
    "Confirmar que el title/meta propuestos encajan con la voz de marca real (no son definitivos).",
    "Validar tecnicamente el H1/H2 contra el contenido real de la pagina antes de aplicar.",
    "Revisar el riesgo de canibalizacion senalado antes de publicar.",
    "Aprobar en WordPress solo tras revision humana — este plan no publica nada.",
  ];
}

export interface SeoWorkOrderBuilderRunResult {
  departmentRunId: string;
  enrichedWorkOrders: WorkOrder[];
  skipped: WorkOrder[];
  reportPath: string;
}

function buildReportMarkdown(result: SeoWorkOrderBuilderRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# SEO Work Orders — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **Work orders ampliadas:** ${result.enrichedWorkOrders.length}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se ampliaron **${result.enrichedWorkOrders.length}** work order(s) SEO con propuesta detallada (title, meta, H1/H2, copy, FAQs, enlaces internos, schema, riesgo de canibalizacion). Ninguna se ha aplicado en WordPress: son planes para revision humana.`
  );
  lines.push("");

  for (const wo of result.enrichedWorkOrders) {
    const p = wo.proposedChanges as unknown as SeoProposedChanges;
    lines.push(`## [${wo.priority}] ${wo.sourceActionTitle}`);
    lines.push("");
    lines.push(`- **workOrderId:** \`${wo.workOrderId}\``);
    lines.push(`- **Status:** ${wo.status} (origen: ${wo.planningOrigin})`);
    lines.push(`- **Pagina:** ${p.page}`);
    lines.push(`- **Keyword principal:** ${p.primaryKeyword}`);
    lines.push(`- **Intencion de busqueda:** ${p.searchIntent}`);
    lines.push(`- **Marca objetivo:** ${p.targetBrand} — ${p.brandRationale}`);
    lines.push(`- **Title propuesto:** ${p.proposedTitle}`);
    lines.push(`- **Meta description propuesta:** ${p.proposedMetaDescription}`);
    lines.push(`- **H1:** ${p.proposedH1}`);
    lines.push(`- **H2 sugeridos:** ${p.suggestedH2s.join(" · ")}`);
    lines.push(`- **Copy sugerido:** ${p.copyBlock}`);
    if (p.suggestedFaqs.length > 0) {
      lines.push(`- **FAQs sugeridas:**`);
      for (const faq of p.suggestedFaqs) lines.push(`  - **${faq.question}** ${faq.answer}`);
    }
    lines.push(`- **Enlaces internos sugeridos:** ${p.suggestedInternalLinks.join(" · ") || "(ninguno)"}`);
    lines.push(`- **Schema sugerido:** ${p.schema}`);
    lines.push(`- **Riesgo de canibalizacion:** ${p.cannibalizationRisk}`);
    lines.push(`- **Checklist de revision:**`);
    for (const item of wo.implementationChecklist) lines.push(`  - [ ] ${item}`);
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado ni publicado nada en WordPress.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee work orders existentes y propone contenido.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: SeoWorkOrderBuilderRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `seo-work-orders-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runSeoWorkOrderBuilder(departmentRunId?: string): Promise<SeoWorkOrderBuilderRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("SEO Work Order Builder iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "SEO Work Order Builder iniciado" });

  const draftSeoWorkOrders = readCurrentWorkOrders().filter(
    (w) => w.status === "draft" && categorizeActionType(w.actionType) === "seo"
  );

  const enrichedWorkOrders: WorkOrder[] = [];
  const skipped: WorkOrder[] = [];

  for (const wo of draftSeoWorkOrders) {
    const proposal = buildSeoProposal(wo);
    const checklist = buildChecklist();
    const updated = updateWorkOrderContent(wo.workOrderId, {
      proposedChanges: proposal as unknown as Record<string, unknown>,
      implementationChecklist: checklist,
      risks: [proposal.cannibalizationRisk],
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
        summary: `Plan SEO listo para revisar: ${updated.sourceActionTitle}`,
        payload: { workOrderId: updated.workOrderId },
      });
    } else {
      skipped.push(wo);
    }
  }

  const generatedAt = new Date().toISOString();
  const result: SeoWorkOrderBuilderRunResult = { departmentRunId: deptRunId, enrichedWorkOrders, skipped, reportPath: "" };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(`SEO Work Order Builder finalizado. Ampliadas: ${enrichedWorkOrders.length}. Informe: ${result.reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `SEO Work Order Builder finalizado: ${enrichedWorkOrders.length} work order(s) lista(s) para revisar`,
    payload: { enrichedCount: enrichedWorkOrders.length, reportPath: result.reportPath },
  });

  return result;
}
