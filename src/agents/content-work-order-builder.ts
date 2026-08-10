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
 * Content Work Order Builder — READ + PROPOSE only. Amplia las work
 * orders `draft` de categoria content con un brief operativo (no un
 * articulo entero): tipo de contenido, keyword principal/secundarias,
 * estructura H2/H3, intencion, marca, CTA, enlaces internos. NUNCA
 * escribe en WordPress.
 *
 * Fase O7: el status final (`ready_for_review` o `auto_prepared`) lo
 * decide `finalReviewStatus()` segun el `planningOrigin` de la work
 * order.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "content-work-orders");
const AGENT_NAME = "content-work-order-builder";

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

const CONTENT_TYPE_LABELS: Record<string, string> = {
  "content:article": "Articulo",
  "content:faq": "FAQ",
  "content:landing_block": "Bloque de categoria",
  "content:new_landing": "Landing nueva",
  "content:title_meta_improvement": "Mejora de title/meta",
  "content:internal_link": "Enlace interno",
};

interface ContentProposedChanges {
  contentType: string;
  recommendedTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  structure: string[];
  intent: string;
  targetBrand: string;
  brandRationale: string;
  recommendedCta: string;
  internalLinks: string[];
  clusterNote: string;
}

function buildStructure(category: BrandIntentCategory, keyword: string): string[] {
  const cap = capitalizeWords(keyword);
  switch (category) {
    case "zentry_locker_core":
      return [
        `H2: ¿Que es ${keyword}?`,
        "H2: Tipos y materiales disponibles",
        "H3: Metalica vs fenolica vs melamina",
        "H2: Como elegir la medida correcta",
        "H2: Precios y presupuesto",
        `H2: Preguntas frecuentes sobre ${keyword}`,
      ];
    case "zentry_smart_locker":
      return [
        `H2: ${cap}: la solucion completa`,
        "H2: Como funciona la cerradura inteligente",
        "H3: App / tarjeta / codigo de acceso",
        "H2: Casos de uso (gimnasios, empresas, centros deportivos)",
        "H2: Solicita una demo",
      ];
    case "tukandado_lock_core":
      return [
        `H2: ${cap}: especificaciones tecnicas`,
        "H2: Compatibilidad con fabricantes de taquillas",
        "H2: Casos de exito / integradores",
        "H2: Contacta con un tecnico",
      ];
    case "mixed_cross_sell":
      return [
        `H2: ¿Buscas mueble, cerradura o ambos?`,
        "H2: Solucion Zentry (mobiliario)",
        "H2: Solucion Tukandado (cerradura)",
        "H2: Como elegir segun tu caso",
      ];
    default:
      return [`H2: Sobre ${keyword}`];
  }
}

function buildCta(category: BrandIntentCategory): string {
  switch (category) {
    case "zentry_locker_core":
      return 'CTA: "Solicitar presupuesto sin compromiso"';
    case "zentry_smart_locker":
      return 'CTA: "Quiero la solucion completa — pedir demo"';
    case "tukandado_lock_core":
      return 'CTA: "Hablar con un tecnico" / "Solicitar ficha tecnica"';
    case "mixed_cross_sell":
      return 'CTA doble: "Ver taquillas" + "Ver cerraduras"';
    default:
      return 'CTA: "Contactar"';
  }
}

function findClusterKeywords(targetBrand: string, keyword: string, excludeActionId: string): string[] {
  const normalized = keyword.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter((w) => w.length >= 4);
  return readCurrentActions()
    .filter(
      (a) =>
        a.actionId !== excludeActionId &&
        a.targetBrand === targetBrand &&
        a.keyword.toLowerCase() !== normalized &&
        words.some((w) => a.keyword.toLowerCase().includes(w))
    )
    .map((a) => a.keyword)
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .slice(0, 5);
}

function buildContentProposal(workOrder: WorkOrder): ContentProposedChanges {
  const intent = classifyOpportunity({ keyword: workOrder.keyword, page: workOrder.page });
  const secondaryKeywords = findClusterKeywords(workOrder.targetBrand, workOrder.keyword, workOrder.actionId);

  return {
    contentType: CONTENT_TYPE_LABELS[workOrder.actionType] ?? workOrder.actionType,
    recommendedTitle: capitalizeWords(workOrder.keyword),
    primaryKeyword: workOrder.keyword,
    secondaryKeywords,
    structure: buildStructure(intent.category, workOrder.keyword),
    intent: BRAND_INTENT_CATEGORY_LABELS[intent.category],
    targetBrand: BRAND_INTENT_CATEGORY_LABELS[intent.category],
    brandRationale: intent.reason,
    recommendedCta: buildCta(intent.category),
    internalLinks:
      intent.category === "zentry_smart_locker" || intent.category === "mixed_cross_sell"
        ? ["Enlazar hacia contenido Zentry (mobiliario)", "Enlazar hacia contenido Tukandado (cerradura)"]
        : ["Enlazar hacia la landing/categoria principal relacionada"],
    clusterNote:
      secondaryKeywords.length > 0
        ? `Posible cluster SEO con: ${secondaryKeywords.join(", ")}. Considerar enlazado interno entre estas paginas.`
        : "No se detectaron otras keywords del backlog para formar cluster todavia.",
  };
}

function buildChecklist(): string[] {
  return [
    "Confirmar el brief con el equipo de contenido antes de redactar el texto final.",
    "Verificar que no compite con otro contenido ya publicado (ver clusterNote).",
    "Redactar el contenido final fuera de este sistema — esta work order es solo el brief.",
    "Publicar en WordPress solo tras revision humana — este plan no publica nada.",
  ];
}

export interface ContentWorkOrderBuilderRunResult {
  departmentRunId: string;
  enrichedWorkOrders: WorkOrder[];
  reportPath: string;
}

function buildReportMarkdown(result: ContentWorkOrderBuilderRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Content Work Orders — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **Briefs generados:** ${result.enrichedWorkOrders.length}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se generaron **${result.enrichedWorkOrders.length}** brief(s) de contenido operativos (no el articulo final). Ninguno se ha publicado: son planes para revision humana.`
  );
  lines.push("");

  for (const wo of result.enrichedWorkOrders) {
    const p = wo.proposedChanges as unknown as ContentProposedChanges;
    lines.push(`## [${wo.priority}] ${p.contentType}: ${p.recommendedTitle}`);
    lines.push("");
    lines.push(`- **workOrderId:** \`${wo.workOrderId}\``);
    lines.push(`- **Status:** ${wo.status} (origen: ${wo.planningOrigin})`);
    lines.push(`- **Keyword principal:** ${p.primaryKeyword}`);
    lines.push(`- **Keywords secundarias:** ${p.secondaryKeywords.join(", ") || "(ninguna)"}`);
    lines.push(`- **Intencion:** ${p.intent}`);
    lines.push(`- **Marca objetivo:** ${p.targetBrand} — ${p.brandRationale}`);
    lines.push(`- **Estructura:**`);
    for (const h of p.structure) lines.push(`  - ${h}`);
    lines.push(`- **CTA recomendado:** ${p.recommendedCta}`);
    lines.push(`- **Enlaces internos:** ${p.internalLinks.join(" · ")}`);
    lines.push(`- **Cluster SEO:** ${p.clusterNote}`);
    lines.push(`- **Checklist de revision:**`);
    for (const item of wo.implementationChecklist) lines.push(`  - [ ] ${item}`);
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha escrito ni publicado nada en WordPress.");
  lines.push("- No se ha modificado Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Este agente solo lee work orders existentes y propone briefs.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: ContentWorkOrderBuilderRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `content-work-orders-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runContentWorkOrderBuilder(departmentRunId?: string): Promise<ContentWorkOrderBuilderRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Content Work Order Builder iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Content Work Order Builder iniciado" });

  const draftContentWorkOrders = readCurrentWorkOrders().filter(
    (w) => w.status === "draft" && categorizeActionType(w.actionType) === "content"
  );

  const enrichedWorkOrders: WorkOrder[] = [];

  for (const wo of draftContentWorkOrders) {
    const proposal = buildContentProposal(wo);
    const updated = updateWorkOrderContent(wo.workOrderId, {
      proposedChanges: proposal as unknown as Record<string, unknown>,
      implementationChecklist: buildChecklist(),
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
        summary: `Brief de contenido listo para revisar: ${updated.sourceActionTitle}`,
        payload: { workOrderId: updated.workOrderId },
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const result: ContentWorkOrderBuilderRunResult = { departmentRunId: deptRunId, enrichedWorkOrders, reportPath: "" };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(`Content Work Order Builder finalizado. Ampliadas: ${enrichedWorkOrders.length}. Informe: ${result.reportPath}`);
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Content Work Order Builder finalizado: ${enrichedWorkOrders.length} brief(s) listo(s)`,
    payload: { enrichedCount: enrichedWorkOrders.length, reportPath: result.reportPath },
  });

  return result;
}
