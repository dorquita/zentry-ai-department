import * as fs from "fs";
import * as path from "path";
import { readCurrentChangePacks } from "../core/change-packs";
import { findAssetRequestByChangePackAndPurpose, readCurrentAssetRequests, upsertProposedAssetRequest } from "../core/asset-requests";
import { getVisualTemplateDefinition, selectVisualTemplate, VisualTemplateDefinition, VisualTemplateId } from "../core/visual-templates";
import { isN8nAssetWebhookConfigured } from "../adapters/n8n-asset-webhook";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { AssetRequest, BrandTarget, ChangePack, ImagePurpose } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Visual Asset Planner Agent (Fase O12.4) — READ + PROPOSE only. Decide
 * que imagenes necesitaria cada change pack elegible segun la plantilla
 * visual que le corresponde (ver src/core/visual-templates.ts) y crea
 * peticiones de asset en estado `proposed`
 * (data/asset-requests.jsonl). NUNCA llama a n8n (ver
 * src/adapters/n8n-asset-webhook.ts, un skeleton que siempre lanza),
 * NUNCA genera una imagen, NUNCA sube nada a WordPress. Es exactamente
 * el mismo nivel de "solo proponer" que el WordPress Draft Agent tenia
 * en su primera fase (previews locales), antes de que existiera ninguna
 * escritura real.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "visual-assets");
const AGENT_NAME = "visual-asset-planner";

const ELIGIBLE_CHANGE_PACK_STATUSES: ChangePack["status"][] = ["ready_for_review", "approved_to_execute"];

const SECTOR_TERMS = ["colegio", "gimnasio", "hotel", "oficina", "hospital", "universidad", "centro deportivo", "polideportivo", "piscina", "industrial", "empresa"];

function detectSector(changePack: ChangePack): string | undefined {
  const haystack = `${changePack.keyword} ${changePack.page ?? ""}`.toLowerCase();
  return SECTOR_TERMS.find((term) => haystack.includes(term));
}

/** El bloque de cerraduras inteligentes (y por tanto su icono) solo aplica si la marca no es tukandado_lock_core puro repetido innecesariamente ni completamente ajeno. */
function smartLocksBlockApplies(changePack: ChangePack): boolean {
  return changePack.brandIntent === "zentry_locker_core" || changePack.brandIntent === "mixed_cross_sell";
}

// Rango de marcas diacriticas combinantes (U+0300-U+036F), construido
// por punto de codigo para evitar tecleare caracteres Unicode literales
// en el fuente (mismo patron que DIACRITICS_RE en executive-report.ts).
const SLUG_DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(SLUG_DIACRITICS_RE, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const BRAND_STYLE_GUIDE: Record<BrandTarget, string> = {
  zentry: "Zentry: mobiliario/taquillas metalicas e industriales, paleta de grises y azules corporativos, fotografia de producto o render limpio con fondo neutro o instalaciones reales (vestuarios, oficinas, colegios), iluminacion profesional tipo catalogo, sin ambiente oscuro ni dramatico.",
  tukandado: "Tukandado: cerradura electronica/control de acceso, enfoque tecnico en el detalle del mecanismo/panel, tono mas tecnologico (azules frios, superficies metalicas/plastico premium), sin ambiente domestico.",
  both: "Composicion neutra que sirva tanto para Zentry (mobiliario) como Tukandado (cerradura): taquilla con cerradura electronica visible, paleta de grises/azules corporativos, fotografia de catalogo limpia.",
  none: "Composicion generica de catalogo, paleta de grises/azules corporativos, sin elementos de marca de terceros.",
};

const NEGATIVE_PROMPT =
  "sin texto superpuesto, sin marcas de agua, sin logotipos de terceros, sin personas reconocibles, sin manos/dedos deformes, sin marcas o logos inventados, sin baja resolucion, sin bordes/marcos decorativos";

interface ImageSlotPlan {
  imagePurpose: ImagePurpose;
  dimensions: { width: number; height: number };
  slotNote: string;
}

function collectImageSlots(template: VisualTemplateDefinition, changePack: ChangePack): ImageSlotPlan[] {
  const slots: ImageSlotPlan[] = [
    { imagePurpose: template.hero.image.imagePurpose, dimensions: template.hero.image.dimensions, slotNote: `Hero: ${template.hero.image.placeholderNote}` },
    { imagePurpose: template.featuredImage.imagePurpose, dimensions: template.featuredImage.dimensions, slotNote: `Imagen destacada: ${template.featuredImage.placeholderNote}` },
  ];
  if (smartLocksBlockApplies(changePack)) {
    slots.push({
      imagePurpose: "icon",
      dimensions: { width: 256, height: 256 },
      slotNote: `Icono para el bloque "${template.smartLocksBlock.title}": icono simple de cerradura electronica/control de acceso, estilo linea o solido plano, coherente con el resto de iconos del sitio.`,
    });
  }
  return slots;
}

function buildPrompt(changePack: ChangePack, templateId: VisualTemplateId, slot: ImageSlotPlan, sector: string | undefined): string {
  const brandNote = BRAND_STYLE_GUIDE[changePack.targetBrand];
  const sectorNote = sector ? ` Contexto de sector: ${sector}.` : "";
  const purposeNote =
    slot.imagePurpose === "icon"
      ? "Icono simple, fondo transparente, un solo concepto claro."
      : `Fotografia/render tipo ${slot.imagePurpose === "hero" ? "hero de landing" : slot.imagePurpose === "product_context" ? "producto en contexto de uso" : "tarjeta/miniatura"}.`;

  return (
    `${purposeNote} Tema: "${changePack.keyword}" (plantilla: ${templateId}).${sectorNote} ${brandNote} ` +
    `Dimensiones objetivo: ${slot.dimensions.width}x${slot.dimensions.height}px. ${slot.slotNote}`
  ).replace(/\s+/g, " ").trim();
}

function buildAltText(changePack: ChangePack, slot: ImageSlotPlan): string {
  const purposeLabel = slot.imagePurpose === "hero" ? "imagen principal" : slot.imagePurpose === "icon" ? "icono" : slot.imagePurpose === "product_context" ? "producto en contexto" : "imagen destacada";
  return `${capitalizeFirst(changePack.keyword)} — ${purposeLabel}`;
}

function capitalizeFirst(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function buildFilenameSuggestion(changePack: ChangePack, slot: ImageSlotPlan): string {
  const brandPart = changePack.targetBrand !== "none" ? changePack.targetBrand : "zentry";
  return `${slugify(changePack.keyword)}-${slot.imagePurpose}-${brandPart}.jpg`;
}

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

export interface VisualAssetPlannerRunResult {
  departmentRunId: string;
  newAssetRequests: AssetRequest[];
  existingAssetRequests: AssetRequest[];
  totalAssetRequestCount: number;
  n8nConfigured: boolean;
  reportPath: string;
}

function buildReportMarkdown(result: VisualAssetPlannerRunResult, generatedAt: string): string {
  const lines: string[] = [];
  const executionDate = generatedAt.slice(0, 10);

  lines.push(`# Visual Asset Planner — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **N8N_ASSET_GENERATION_WEBHOOK_URL configurada:** ${result.n8nConfigured ? "si (igualmente NO se ha llamado — ver docs/n8n-asset-webhook-contract.md)" : "no"}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Peticiones de asset nuevas en esta pasada: **${result.newAssetRequests.length}**. Total acumulado en \`proposed\`: **${result.totalAssetRequestCount}**.`
  );
  lines.push("");
  lines.push(
    "**No se ha llamado a n8n, no se ha generado ninguna imagen y no se ha subido nada a WordPress.** Este agente solo propone — ver `docs/asset-generation-workflow.md`."
  );
  lines.push("");

  lines.push(`## Peticiones nuevas (${result.newAssetRequests.length})`);
  lines.push("");
  if (result.newAssetRequests.length === 0) {
    lines.push("Ninguna.");
  } else {
    for (const r of result.newAssetRequests) {
      lines.push(`- \`${r.assetRequestId}\` (${r.imagePurpose}, ${r.dimensions.width}x${r.dimensions.height}) — ${r.altText}`);
    }
  }
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha llamado a ningun webhook de n8n ni a ninguna API de generacion de imagenes.");
  lines.push("- No se ha generado ninguna imagen real.");
  lines.push("- No se ha subido nada a WordPress (ni staging ni produccion).");
  lines.push("- No se ha tocado `/opt/n8n` ni `/opt/qdrant`.");
  lines.push("- `data/asset-requests.jsonl` es append-only.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: VisualAssetPlannerRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `visual-assets-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runVisualAssetPlanner(departmentRunId?: string): Promise<VisualAssetPlannerRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Visual Asset Planner Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Visual Asset Planner Agent iniciado" });

  const eligibleChangePacks = readCurrentChangePacks().filter((cp) => ELIGIBLE_CHANGE_PACK_STATUSES.includes(cp.status));
  let currentRequests = readCurrentAssetRequests();
  const newAssetRequests: AssetRequest[] = [];
  const existingAssetRequests: AssetRequest[] = [];

  for (const changePack of eligibleChangePacks) {
    const templateId = selectVisualTemplate(changePack);
    const template = getVisualTemplateDefinition(templateId);
    const sector = detectSector(changePack);
    const slots = collectImageSlots(template, changePack);

    for (const slot of slots) {
      const existing = findAssetRequestByChangePackAndPurpose(changePack.changePackId, slot.imagePurpose, currentRequests);
      if (existing) {
        existingAssetRequests.push(existing);
        continue;
      }

      const { request, isNew } = upsertProposedAssetRequest(
        {
          changePackId: changePack.changePackId,
          targetBrand: changePack.targetBrand,
          sector,
          pageType: templateId,
          imagePurpose: slot.imagePurpose,
          prompt: buildPrompt(changePack, templateId, slot, sector),
          negativePrompt: NEGATIVE_PROMPT,
          styleGuide: BRAND_STYLE_GUIDE[changePack.targetBrand],
          altText: buildAltText(changePack, slot),
          filenameSuggestion: buildFilenameSuggestion(changePack, slot),
          dimensions: slot.dimensions,
        },
        currentRequests
      );
      if (isNew) {
        newAssetRequests.push(request);
        emitEvent({
          departmentRunId: deptRunId,
          agent: AGENT_NAME,
          type: "recommendation_created",
          priority: changePack.priority,
          summary: `Asset visual propuesto (${slot.imagePurpose}): ${changePack.keyword}`,
          payload: { assetRequestId: request.assetRequestId, changePackId: changePack.changePackId, imagePurpose: slot.imagePurpose },
        });
      }
    }
  }

  const totalAssetRequestCount = readCurrentAssetRequests().filter((r) => r.status === "proposed").length;
  const generatedAt = new Date().toISOString();
  const result: VisualAssetPlannerRunResult = {
    departmentRunId: deptRunId,
    newAssetRequests,
    existingAssetRequests,
    totalAssetRequestCount,
    n8nConfigured: isN8nAssetWebhookConfigured(),
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `Visual Asset Planner Agent finalizado. Peticiones nuevas: ${newAssetRequests.length}. Total propuestas: ${totalAssetRequestCount}. Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Visual Asset Planner Agent finalizado: ${newAssetRequests.length} peticion(es) nueva(s), n8n NO se ha ejecutado`,
    payload: { newAssetRequestCount: newAssetRequests.length, totalAssetRequestCount, n8nConfigured: result.n8nConfigured, reportPath: result.reportPath },
  });

  return result;
}
