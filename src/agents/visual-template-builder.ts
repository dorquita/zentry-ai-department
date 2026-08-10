import * as fs from "fs";
import * as path from "path";
import { readCurrentChangePacks } from "../core/change-packs";
import { findWordpressDraftByChangePackId, readCurrentWordpressDrafts } from "../core/wordpress-drafts";
import { extractPreviewFields, PreviewFields } from "./wordpress-draft-agent";
import { getVisualTemplateDefinition, selectVisualTemplate, VisualTemplateDefinition, VisualTemplateId } from "../core/visual-templates";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ChangePack } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Visual Template Builder Agent (Fase O12.4) — READ + PROPOSE only.
 * Genera, para cada change pack que ya tiene un preview local (creado
 * por el WordPress Draft Agent, Fase O10), un fichero ADICIONAL de
 * preview mas visual: mapea el contenido real del change pack sobre la
 * estructura de bloques de la plantilla visual que le corresponde (ver
 * src/core/visual-templates.ts) — hero, imagen destacada, beneficios,
 * materiales/productos, cerraduras inteligentes si aplica, FAQs, CTA,
 * enlaces internos, schema, notas Kadence/Gutenberg.
 *
 * NUNCA toca WordPress: el fichero generado es un `.md` nuevo en
 * `reports/wordpress-drafts/previews/`, junto al preview original
 * (`<draftId>.md`, sin modificarlo) — nunca sobrescribe nada existente.
 * NUNCA genera ni referencia una imagen real: solo describe donde iria
 * cada imagen y con que proposito/dimensiones (ver
 * src/agents/visual-asset-planner.ts para la propuesta de esos assets,
 * en un agente separado, para no acoplar el orden de ejecucion de los
 * dos).
 */

const PREVIEWS_DIR = path.join(resolveActiveClientPaths().reportsDir, "wordpress-drafts", "previews");
const AGENT_NAME = "visual-template-builder";

const ELIGIBLE_CHANGE_PACK_STATUSES: ChangePack["status"][] = ["ready_for_review", "approved_to_execute"];

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

// Exportadas (Fase O13.6b): reutilizadas por src/agents/ux-ui-landing-architect.ts
// para construir el LandingBlueprint real, no solo el preview de texto.
export function fillPattern(pattern: string, changePack: ChangePack, sector: string | undefined, material: string | undefined): string {
  return pattern
    .replace("{keyword}", changePack.keyword)
    .replace("{sector}", sector ?? "tu sector")
    .replace("{material}", material ?? changePack.keyword)
    .replace("{titulo del articulo}", changePack.keyword)
    .replace("{opcionA}", changePack.keyword)
    .replace("{opcionB}", "la alternativa");
}

export const SECTOR_TERMS = ["colegio", "gimnasio", "hotel", "oficina", "hospital", "universidad", "centro deportivo", "polideportivo", "piscina", "industrial", "empresa"];
export const MATERIAL_TERMS = ["melamina", "fenolica", "fenolico", "metalica", "metalico", "madera"];

export function detectTerm(changePack: ChangePack, terms: string[]): string | undefined {
  const haystack = `${changePack.keyword} ${changePack.page ?? ""}`.toLowerCase();
  return terms.find((term) => haystack.includes(term));
}

export function smartLocksBlockApplies(changePack: ChangePack): boolean {
  return changePack.brandIntent === "zentry_locker_core" || changePack.brandIntent === "mixed_cross_sell";
}

function buildImageLine(purpose: string, note: string, dims: { width: number; height: number }): string {
  return `> 🖼️ **[Imagen — ${purpose}, ${dims.width}x${dims.height}px]** — ${note}`;
}

function buildVisualPreviewMarkdown(
  changePack: ChangePack,
  fields: PreviewFields,
  templateId: VisualTemplateId,
  template: VisualTemplateDefinition,
  draftId: string,
  generatedAt: string
): string {
  const sector = detectTerm(changePack, SECTOR_TERMS);
  const material = detectTerm(changePack, MATERIAL_TERMS);
  const includeSmartLocks = smartLocksBlockApplies(changePack);
  const lines: string[] = [];

  lines.push(`# Preview VISUAL (local, no publicado) — ${changePack.keyword}`);
  lines.push("");
  lines.push(`- **draftId:** \`${draftId}\``);
  lines.push(`- **changePackId:** \`${changePack.changePackId}\` (status: ${changePack.status})`);
  lines.push(`- **Plantilla visual:** \`${templateId}\` — ${template.label}`);
  lines.push(`- **Por que esta plantilla:** ${template.whenToUse}`);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");
  lines.push(
    "> Este fichero es un preview VISUAL local (Fase O12.4), complementario al preview de texto ya generado por el WordPress Draft Agent (`" +
      draftId +
      ".md`, sin tocar). No se ha llamado a WordPress ni generado ninguna imagen real."
  );
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 🔝 HERO");
  lines.push("");
  lines.push(buildImageLine("hero", template.hero.image.placeholderNote, template.hero.image.dimensions));
  lines.push("");
  lines.push(`### ${fillPattern(template.hero.headlinePattern, changePack, sector, material)}`);
  lines.push("");
  lines.push(fillPattern(template.hero.subheadlinePattern, changePack, sector, material));
  lines.push("");
  lines.push(`**[ ${template.hero.ctaLabel} ]**`);
  lines.push("");

  lines.push("## 🖼️ IMAGEN DESTACADA");
  lines.push("");
  lines.push(buildImageLine(template.featuredImage.imagePurpose, template.featuredImage.placeholderNote, template.featuredImage.dimensions));
  lines.push("");

  lines.push(`## ✅ ${fillPattern(template.benefitsBlock.title, changePack, sector, material)}`);
  lines.push("");
  lines.push(`_(${template.benefitsBlock.itemCountRange} items — ${template.benefitsBlock.notes})_`);
  lines.push("");
  if (fields.copy) lines.push(fields.copy);
  lines.push("");

  lines.push(`## 🧱 ${fillPattern(template.materialsOrProductsBlock.title, changePack, sector, material)}`);
  lines.push("");
  lines.push(template.materialsOrProductsBlock.notes);
  if (fields.h2s.length > 0) {
    lines.push("");
    for (const h2 of fields.h2s) lines.push(`- ${h2}`);
  }
  lines.push("");

  if (includeSmartLocks) {
    lines.push(`## 🔐 ${template.smartLocksBlock.title}`);
    lines.push("");
    lines.push(buildImageLine("icon", `Icono de cerradura electronica/control de acceso.`, { width: 256, height: 256 }));
    lines.push("");
    lines.push(template.smartLocksBlock.notes);
    lines.push("");
  }

  lines.push(`## ❓ ${fillPattern(template.faqsBlock.title, changePack, sector, material)}`);
  lines.push("");
  lines.push(`_(${template.faqsBlock.minItems}-${template.faqsBlock.maxItems} preguntas — ${template.faqsBlock.notes})_`);
  lines.push("");
  if (fields.faqs.length === 0) {
    lines.push("Ninguna FAQ propuesta por el change pack de origen todavia.");
  } else {
    for (const faq of fields.faqs) {
      lines.push(`**${faq.question}**`);
      lines.push("");
      lines.push(faq.answer);
      lines.push("");
    }
  }

  lines.push(`## 🎯 CTA FINAL`);
  lines.push("");
  lines.push(`**[ ${template.finalCta.label} ]**`);
  lines.push("");
  lines.push(`_${template.finalCta.notes}_`);
  lines.push("");

  lines.push("## 🔗 Enlaces internos");
  lines.push("");
  lines.push(template.internalLinksNotes);
  if (fields.internalLinks.length > 0) {
    lines.push("");
    for (const link of fields.internalLinks) lines.push(`- ${link}`);
  }
  lines.push("");

  lines.push("## 🏷️ Schema recomendado");
  lines.push("");
  for (const schema of template.recommendedSchema) lines.push(`- \`${schema}\``);
  lines.push("");

  lines.push("## 🧩 Notas de diseno Kadence/Gutenberg");
  lines.push("");
  for (const note of template.kadenceGutenbergNotes) lines.push(`- ${note}`);
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha publicado nada. No se ha llamado a WordPress.");
  lines.push("- No se ha generado ni subido ninguna imagen real (los bloques de imagen son placeholders con proposito/dimensiones, no imagenes).");
  lines.push("- No se ha llamado a n8n.");
  lines.push("");

  return lines.join("\n");
}

export interface VisualTemplateBuilderRunResult {
  departmentRunId: string;
  newVisualPreviews: Array<{ draftId: string; changePackId: string; templateId: VisualTemplateId; path: string }>;
  skippedNoDraftYet: number;
  totalVisualPreviewCount: number;
  reportPath: string;
}

function buildReportMarkdown(result: VisualTemplateBuilderRunResult, generatedAt: string): string {
  const lines: string[] = [];
  const executionDate = generatedAt.slice(0, 10);

  lines.push(`# Visual Template Builder — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");
  lines.push(
    `Previews visuales nuevos: **${result.newVisualPreviews.length}** (total acumulado: **${result.totalVisualPreviewCount}**). Change packs sin preview de texto todavia (se esperara al WordPress Draft Agent): **${result.skippedNoDraftYet}**.`
  );
  lines.push("");
  lines.push("**No se ha llamado a WordPress ni a n8n. No se ha generado ninguna imagen real.**");
  lines.push("");
  lines.push(`## Previews nuevos (${result.newVisualPreviews.length})`);
  lines.push("");
  if (result.newVisualPreviews.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const p of result.newVisualPreviews) {
      lines.push(`- \`${p.draftId}\` — plantilla \`${p.templateId}\` — \`${p.path}\``);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: VisualTemplateBuilderRunResult, generatedAt: string): string {
  const reportsDir = path.join(resolveActiveClientPaths().reportsDir, "visual-templates");
  fs.mkdirSync(reportsDir, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(reportsDir, `visual-templates-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runVisualTemplateBuilder(departmentRunId?: string): Promise<VisualTemplateBuilderRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Visual Template Builder Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Visual Template Builder Agent iniciado" });

  const eligibleChangePacks = readCurrentChangePacks().filter((cp) => ELIGIBLE_CHANGE_PACK_STATUSES.includes(cp.status));
  const currentDrafts = readCurrentWordpressDrafts();

  fs.mkdirSync(PREVIEWS_DIR, { recursive: true });

  const newVisualPreviews: VisualTemplateBuilderRunResult["newVisualPreviews"] = [];
  let skippedNoDraftYet = 0;
  let totalVisualPreviewCount = 0;

  for (const changePack of eligibleChangePacks) {
    const draft = findWordpressDraftByChangePackId(changePack.changePackId, currentDrafts);
    if (!draft) {
      skippedNoDraftYet += 1;
      continue;
    }

    const visualPath = path.join(PREVIEWS_DIR, `${draft.draftId}-visual.md`);
    const alreadyExists = fs.existsSync(visualPath);

    const templateId = selectVisualTemplate(changePack);
    const template = getVisualTemplateDefinition(templateId);
    const fields = extractPreviewFields(changePack);
    const generatedAt = new Date().toISOString();

    fs.writeFileSync(visualPath, buildVisualPreviewMarkdown(changePack, fields, templateId, template, draft.draftId, generatedAt), "utf-8");
    totalVisualPreviewCount += 1;

    if (!alreadyExists) {
      newVisualPreviews.push({ draftId: draft.draftId, changePackId: changePack.changePackId, templateId, path: visualPath });
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "recommendation_created",
        priority: changePack.priority,
        summary: `Preview visual generado (plantilla ${templateId}): ${changePack.keyword}`,
        payload: { draftId: draft.draftId, changePackId: changePack.changePackId, templateId },
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const result: VisualTemplateBuilderRunResult = {
    departmentRunId: deptRunId,
    newVisualPreviews,
    skippedNoDraftYet,
    totalVisualPreviewCount,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `Visual Template Builder Agent finalizado. Previews visuales nuevos: ${newVisualPreviews.length}. Total: ${totalVisualPreviewCount}. Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Visual Template Builder Agent finalizado: ${newVisualPreviews.length} preview(s) visual(es) nuevo(s)`,
    payload: { newVisualPreviewCount: newVisualPreviews.length, totalVisualPreviewCount, reportPath: result.reportPath },
  });

  return result;
}
