import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  CreateApprovalRequestInput,
  findAnyRequestByRelatedId,
  readCurrentApprovalRequests,
  upsertApprovalRequest,
  markApprovalRequestSent,
} from "../core/approval-requests";
import { readCurrentChangePacks } from "../core/change-packs";
import {
  findWordpressDraftByChangePackId,
  promoteWordpressDraftCreated,
  readCurrentWordpressDrafts,
  setWordpressDraftStatus,
  upsertLocalPreviewDraft,
} from "../core/wordpress-drafts";
import { createWordpressDraftPage, getWordpressStatusForReport, isWordpressDraftsEnabled } from "../adapters/wordpress";
import { resolveWordpressBackend, resolveWordpressEnv, WordpressBackend, WordpressEnv } from "../adapters/wordpress-backend";
import { createWordpressDraftPageViaMcp } from "../adapters/wordpress-mcp";
import {
  getTelegramStatusForReport,
  isTelegramApprovalsEnabled,
  sendTelegramApprovalRequest,
} from "../core/telegram-gateway";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ApprovalRequest, ChangePack, LandingBlueprint, WordpressDraft } from "../core/types";
import { findLandingBlueprintByChangePackId, readCurrentLandingBlueprints } from "../core/landing-blueprints";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * WordPress Draft Agent — READ + PROPOSE only (con una unica excepcion
 * controlada: crear un borrador SIN PUBLICAR en WordPress, y solo bajo
 * las 3 condiciones simultaneas descritas mas abajo). Convierte change
 * packs ya listos (`ready_for_review`/`approved_to_execute`) en:
 *
 * 1. SIEMPRE, primero: un "local preview" — un fichero markdown en
 *    `reports/wordpress-drafts/previews/` con el mismo contenido que
 *    tendria el borrador (title, meta, H1/H2, copy, FAQs, CTA, enlaces,
 *    instrucciones y checklist). Generar un preview NUNCA llama a
 *    WordPress, pase lo que pase con WORDPRESS_DRAFTS_ENABLED.
 * 2. SOLO SI se cumplen las 3 condiciones a la vez: (a)
 *    WORDPRESS_DRAFTS_ENABLED=true, (b) el change pack esta
 *    `approved_to_execute`, y (c) existe una solicitud de aprobacion de
 *    Telegram (`relatedType: "change_pack"`) con status `approved` para
 *    ESE changePackId concreto — intenta crear el borrador REAL en
 *    WordPress (siempre `status: draft`, nunca publicado). Si la
 *    solicitud todavia no existe, este agente la crea aqui mismo (y la
 *    envia por Telegram si TELEGRAM_APPROVALS_ENABLED=true) y NO crea
 *    nada mas en esta misma pasada — espera a la siguiente pasada para
 *    ver la respuesta.
 *
 * Si WORDPRESS_DRAFTS_ENABLED no es "true", este agente NUNCA importa ni
 * invoca nada de src/adapters/wordpress.ts — el paso 2 completo se salta
 * en el codigo, no solo se le da una respuesta negativa. Ver
 * docs/wordpress-draft-agent.md y docs/wordpress-safety-policy.md.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "wordpress-drafts");
const PREVIEWS_DIR = path.join(REPORTS_DIR, "previews");
const AGENT_NAME = "wordpress-draft-agent";

// Solo estos 2 estados de change pack son elegibles para generar (o
// mantener) un preview local. `draft` esta a medias, `rejected`/
// `superseded`/`applied_manually` ya estan resueltos.
const ELIGIBLE_CHANGE_PACK_STATUSES: ChangePack["status"][] = ["ready_for_review", "approved_to_execute"];

// El gate de Telegram para escribir de verdad en WordPress es
// deliberadamente INCONDICIONAL: a diferencia de Approval Gateway (que
// consulta config/notification-policy.json para decidir si algo necesita
// aprobacion instantanea), crear un borrador real en WordPress SIEMPRE
// exige aprobacion explicita por Telegram, sin excepcion y sin que un
// cambio futuro en notification-policy.json pueda debilitar esta regla.
const WORDPRESS_DRAFT_RISK_LEVEL = "high" as const;
const APPROVAL_OPTIONS = ["approved", "rejected", "snoozed"];

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

// --- Extraccion generica de campos de preview segun el tipo de cambio ---
// Cada change pack hereda el `proposedChanges` que ya genero el Work
// Order Builder correspondiente (Fase O6): la forma exacta varia por
// categoria (SEO/contenido/CRO). Esta funcion no vuelve a redactar nada:
// solo mapea los campos ya existentes a una estructura comun de preview.

export interface PreviewFields {
  title: string;
  metaDescription: string;
  h1: string;
  h2s: string[];
  copy: string;
  faqs: Array<{ question: string; answer: string }>;
  cta: string;
  internalLinks: string[];
}

// Fase O27.3 -- bug real encontrado auditando visualmente los borradores
// de staging: el Content Planner genera `structure` como una lista en
// notacion de esquema editorial ("H2: ¿Que es X?", "H3: Y vs Z") pensada
// para que un humano la lea como un GUION, nunca como texto final. Sin
// esta funcion, ese prefijo ("H2: "/"H3: "/"H1: ") se colaba literal
// dentro de un <h2> real en el HTML publicado -- el titular decia
// literalmente "H2: ¿Que es X?" en la pagina. Se aplica SOLO a `structure`
// (new_content_page/content_update); seo_on_page_update usa
// `suggestedH2s`, que nunca ha tenido este prefijo.
function stripOutlinePrefix(heading: string): string {
  return heading.replace(/^H[1-3]:\s*/i, "").trim();
}

export function extractPreviewFields(changePack: ChangePack): PreviewFields {
  const p = changePack.proposedChanges as Record<string, unknown>;
  const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
  const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  const asHeadingArray = (value: unknown): string[] => asStringArray(value).map(stripOutlinePrefix);

  if (changePack.changeType === "seo_on_page_update") {
    const faqs = Array.isArray(p.suggestedFaqs)
      ? (p.suggestedFaqs as unknown[])
          .filter((f): f is { question: unknown; answer: unknown } => typeof f === "object" && f !== null)
          .map((f) => ({ question: asString((f as Record<string, unknown>).question), answer: asString((f as Record<string, unknown>).answer) }))
      : [];
    return {
      title: asString(p.proposedTitle, changePack.keyword),
      metaDescription: asString(p.proposedMetaDescription),
      h1: asString(p.proposedH1),
      h2s: asStringArray(p.suggestedH2s),
      copy: asString(p.copyBlock),
      faqs,
      cta: "(sin CTA especifico: cambio on-page de SEO, no de conversion)",
      internalLinks: asStringArray(p.suggestedInternalLinks),
    };
  }

  if (changePack.changeType === "new_content_page" || changePack.changeType === "content_update") {
    return {
      title: asString(p.recommendedTitle, changePack.keyword),
      metaDescription: "(no generada por Content Planner — redactar manualmente antes de publicar)",
      h1: asString(p.recommendedTitle, changePack.keyword),
      h2s: asHeadingArray(p.structure),
      copy: `(brief de contenido, no copy final) ${asString(p.clusterNote)}`.trim(),
      faqs: [],
      cta: asString(p.recommendedCta, "(sin CTA propuesto)"),
      internalLinks: asStringArray(p.internalLinks),
    };
  }

  if (changePack.changeType === "cro_conversion_update") {
    return {
      title: `(sin cambio de titulo — mejora de conversion en pagina existente) ${changePack.page ?? changePack.keyword}`,
      metaDescription: "(sin cambio de meta description: este paquete solo modifica CTA/formulario/confianza en una pagina existente)",
      h1: "(sin cambio de H1)",
      h2s: asStringArray(p.visualImprovements),
      copy: asString(p.trustBlock, "(sin bloque de confianza propuesto)"),
      faqs: p.faqSection ? [{ question: "FAQ propuesta", answer: asString(p.faqSection) }] : [],
      cta: `${asString(p.newCta, "(sin CTA nuevo)")}${p.ctaPlacement ? ` — ubicacion: ${asString(p.ctaPlacement)}` : ""}`,
      internalLinks: [],
    };
  }

  // changeType desconocido (defensivo): preview minimo pero nunca vacio/roto.
  return {
    title: changePack.keyword,
    metaDescription: "(sin datos de meta description para este tipo de cambio)",
    h1: "(sin datos de H1 para este tipo de cambio)",
    h2s: [],
    copy: "(sin copy propuesto para este tipo de cambio)",
    faqs: [],
    cta: "(sin CTA propuesto para este tipo de cambio)",
    internalLinks: [],
  };
}

function buildPreviewMarkdown(changePack: ChangePack, draftId: string, generatedAt: string): string {
  const fields = extractPreviewFields(changePack);
  const lines: string[] = [];

  lines.push(`# Draft preview (local, no publicado) — ${changePack.keyword}`);
  lines.push("");
  lines.push(`- **draftId:** \`${draftId}\``);
  lines.push(`- **changePackId:** \`${changePack.changePackId}\` (status: ${changePack.status})`);
  lines.push(`- **workOrderId:** \`${changePack.workOrderId}\``);
  lines.push(`- **Marca:** ${changePack.targetBrand}`);
  lines.push(`- **Pagina:** ${changePack.page ?? "(pagina nueva, sin URL asignada todavia)"}`);
  lines.push(`- **Tipo de cambio:** ${changePack.changeType}`);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");
  lines.push(
    "> Este fichero es solo una PREVIEW local. No se ha llamado a WordPress para generarlo. Nada de esto esta publicado ni existe todavia en el sitio real."
  );
  lines.push("");

  lines.push("## Titulo propuesto");
  lines.push("");
  lines.push(fields.title);
  lines.push("");

  lines.push("## Meta description");
  lines.push("");
  lines.push(fields.metaDescription);
  lines.push("");

  lines.push("## H1");
  lines.push("");
  lines.push(fields.h1);
  lines.push("");

  lines.push("## H2 sugeridos");
  lines.push("");
  if (fields.h2s.length === 0) {
    lines.push("Ninguno propuesto.");
  } else {
    for (const h2 of fields.h2s) lines.push(`- ${h2}`);
  }
  lines.push("");

  lines.push("## Copy propuesto");
  lines.push("");
  lines.push(fields.copy || "(sin copy propuesto)");
  lines.push("");

  lines.push("## FAQs");
  lines.push("");
  if (fields.faqs.length === 0) {
    lines.push("Ninguna propuesta.");
    lines.push("");
  } else {
    for (const faq of fields.faqs) {
      lines.push(`**${faq.question}**`);
      lines.push("");
      lines.push(faq.answer);
      lines.push("");
    }
  }

  lines.push("## CTA");
  lines.push("");
  lines.push(fields.cta);
  lines.push("");

  lines.push("## Enlaces internos sugeridos");
  lines.push("");
  if (fields.internalLinks.length === 0) {
    lines.push("Ninguno propuesto.");
  } else {
    for (const link of fields.internalLinks) lines.push(`- ${link}`);
  }
  lines.push("");

  lines.push("## Instrucciones de implementacion");
  lines.push("");
  changePack.implementationSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push("");

  lines.push("## Checklist humano antes de aceptar este borrador");
  lines.push("");
  for (const item of changePack.humanReviewChecklist) lines.push(`- [ ] ${item}`);
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha publicado nada. No se ha modificado ninguna pagina existente.");
  lines.push("- No se ha tocado home, formularios, WooCommerce, precios, checkout, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- Si algun dia se crea un borrador real en WordPress a partir de este preview, quedara SIEMPRE en estado `draft` (nunca `publish`) y requerira aprobacion explicita por Telegram antes de crearse.");
  lines.push("");

  return lines.join("\n");
}

function writePreviewFile(changePack: ChangePack, draftId: string, generatedAt: string): string {
  fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
  const filePath = path.join(PREVIEWS_DIR, `${draftId}.md`);
  fs.writeFileSync(filePath, buildPreviewMarkdown(changePack, draftId, generatedAt), "utf-8");
  return filePath;
}

// Fase O12.2 — un elemento de fields.internalLinks es o bien una URL real
// (absoluta http(s):// o ruta relativa "/...", sin espacios) o una
// instruccion editorial en texto libre (p.ej. "Enlazar hacia la landing
// general de taquillas Zentry"). Solo lo primero se convierte en un
// <a href> real; nunca se fabrica una URL a partir de una instruccion.
function isRealInternalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^\/\S*$/.test(trimmed)) return true;
  return false;
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildButtonBlock(label: string, target: string): string {
  const safeLabel = escapeHtmlText(label);
  const safeTarget = escapeHtmlAttr(target);
  return [
    `<!-- wp:buttons -->`,
    `<div class="wp-block-buttons"><!-- wp:button -->`,
    `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${safeTarget}">${safeLabel}</a></div>`,
    `<!-- /wp:button --></div>`,
    `<!-- /wp:buttons -->`,
  ].join("\n");
}

function buildColumnsBlock(items: Array<{ title: string; description: string }>): string {
  const columns = items
    .map(
      (item) =>
        `<!-- wp:column -->\n<div class="wp-block-column"><h3>${escapeHtmlText(item.title)}</h3><p>${escapeHtmlText(item.description)}</p></div>\n<!-- /wp:column -->`
    )
    .join("\n");
  return [`<!-- wp:columns -->`, `<div class="wp-block-columns">`, columns, `</div>`, `<!-- /wp:columns -->`].join("\n");
}

/**
 * Fase O13.6b: si hay un `LandingBlueprint` (UX/UI Landing Architect, ver
 * src/agents/ux-ui-landing-architect.ts), construye una landing REAL con
 * bloques Gutenberg nativos -- hero + CTA principal (boton, above the
 * fold), beneficios y materiales/productos en columnas, secciones por
 * intencion de busqueda, CTA secundario si aplica, FAQ, enlaces
 * internos reales, CTA final. Sin blueprint (compatibilidad hacia atras
 * -- no deberia pasar para change packs nuevos, todos pasan primero por
 * el Architect), cae al comportamiento plano anterior (H1/p/H2/H3+p).
 */
export function buildWordpressContentHtml(fields: PreviewFields, blueprint?: LandingBlueprint): string {
  if (!blueprint) {
    const parts: string[] = [];
    if (fields.h1 && !fields.h1.startsWith("(")) parts.push(`<h1>${fields.h1}</h1>`);
    if (fields.copy) parts.push(`<p>${fields.copy}</p>`);
    for (const h2 of fields.h2s) parts.push(`<h2>${h2}</h2>`);
    for (const faq of fields.faqs) {
      parts.push(`<h3>${faq.question}</h3>`);
      parts.push(`<p>${faq.answer}</p>`);
    }

    const realUrls = fields.internalLinks.filter(isRealInternalUrl);
    const editorialNotes = fields.internalLinks.filter((link) => !isRealInternalUrl(link));

    if (realUrls.length > 0) {
      parts.push("<h2>Enlaces relacionados</h2>");
      parts.push("<ul>");
      for (const url of realUrls) {
        parts.push(`<li><a href="${escapeHtmlAttr(url)}">${escapeHtmlText(url)}</a></li>`);
      }
      parts.push("</ul>");
    }

    if (editorialNotes.length > 0) {
      const notesBlock = editorialNotes.map((note) => `- ${note}`).join("\n");
      parts.push(
        `<!-- Checklist editorial de enlaces internos (instrucciones para un humano, NO son URLs reales, nunca se han convertido en enlaces):\n${notesBlock}\n-->`
      );
    }

    return parts.join("\n");
  }

  const parts: string[] = [];

  // El tema ya renderiza su propio <h1 class="page-title"> a partir del
  // titulo de WordPress (verificado en produccion, Fase O13.7b) -- el
  // titular del hero usa <h2> para no duplicar el H1 de la pagina.
  parts.push(`<h2>${escapeHtmlText(blueprint.hero.headline)}</h2>`);
  parts.push(`<p><strong>${escapeHtmlText(blueprint.hero.subheadline)}</strong></p>`);
  parts.push(buildButtonBlock(blueprint.ctaPrimary.label, blueprint.ctaPrimary.target));

  if (blueprint.benefitBlocks.length > 0) {
    parts.push(buildColumnsBlock(blueprint.benefitBlocks));
  }
  if (blueprint.cards.length > 0) {
    parts.push(buildColumnsBlock(blueprint.cards));
  }

  for (const section of blueprint.sections) {
    parts.push(`<h2>${escapeHtmlText(section.heading)}</h2>`);
    parts.push(`<p>${escapeHtmlText(section.body)}</p>`);
  }

  if (blueprint.ctaSecondary) {
    parts.push(buildButtonBlock(blueprint.ctaSecondary.label, blueprint.ctaSecondary.target));
  }

  if (blueprint.faq.length > 0) {
    parts.push(`<h2>Preguntas frecuentes</h2>`);
    for (const item of blueprint.faq) {
      parts.push(`<h3>${escapeHtmlText(item.question)}</h3>`);
      parts.push(`<p>${escapeHtmlText(item.answer)}</p>`);
    }
  }

  if (blueprint.internalLinks.length > 0) {
    parts.push("<h2>Enlaces relacionados</h2>");
    parts.push("<ul>");
    for (const url of blueprint.internalLinks) {
      parts.push(`<li><a href="${escapeHtmlAttr(url)}">${escapeHtmlText(url)}</a></li>`);
    }
    parts.push("</ul>");
  }
  const editorialNotes = fields.internalLinks.filter((link) => !isRealInternalUrl(link));
  if (editorialNotes.length > 0) {
    const notesBlock = editorialNotes.map((note) => `- ${note}`).join("\n");
    parts.push(
      `<!-- Checklist editorial de enlaces internos (instrucciones para un humano, NO son URLs reales, nunca se han convertido en enlaces):\n${notesBlock}\n-->`
    );
  }

  parts.push(`<h2>${escapeHtmlText(blueprint.finalCta.headline)}</h2>`);
  parts.push(buildButtonBlock(blueprint.finalCta.cta.label, blueprint.finalCta.cta.target));

  return parts.join("\n\n");
}

export interface WordpressDraftAgentRunResult {
  departmentRunId: string;
  newLocalPreviews: WordpressDraft[];
  existingLocalPreviews: WordpressDraft[];
  newApprovalRequests: ApprovalRequest[];
  sentViaTelegram: ApprovalRequest[];
  pendingApprovalCount: number;
  newWordpressDrafts: WordpressDraft[];
  rejectedDrafts: WordpressDraft[];
  wpCreationErrors: Array<{ draftId: string; changePackId: string; error: string }>;
  wordpressDraftsEnabled: boolean;
  stagingExecutorIsActive: boolean;
  wordpressConfigured: boolean;
  wordpressBackend: WordpressBackend;
  wordpressEnv: WordpressEnv;
  wordpressTargetUrl?: string;
  telegramEnabled: boolean;
  totalLocalPreviewCount: number;
  totalWordpressDraftCount: number;
  reportPath: string;
}

function buildReportMarkdown(result: WordpressDraftAgentRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# WordPress Draft Agent — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **WORDPRESS_DRAFTS_ENABLED:** ${result.wordpressDraftsEnabled ? "true" : "false"}`);
  lines.push(`- **WORDPRESS_BACKEND:** ${result.wordpressBackend}`);
  lines.push(`- **WORDPRESS_ENV:** ${result.wordpressEnv}${result.wordpressEnv === "production" ? " (escritura SIEMPRE bloqueada, ver docs/wordpress-safety-policy.md)" : ""}`);
  lines.push(`- **Destino WordPress resuelto:** ${result.wordpressTargetUrl ?? "(no configurado)"}`);
  lines.push(`- **WordPress configurado (URL del entorno activo + USERNAME + APP_PASSWORD presentes):** ${result.wordpressConfigured ? "si" : "no"}`);
  lines.push(`- **Telegram activo:** ${result.telegramEnabled ? "si" : "no"}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Previews locales nuevos: **${result.newLocalPreviews.length}** (ya existian: **${result.existingLocalPreviews.length}**, total acumulado: **${result.totalLocalPreviewCount}**). Borradores reales creados en WordPress en esta pasada: **${result.newWordpressDrafts.length}** (total acumulado: **${result.totalWordpressDraftCount}**). Solicitudes de aprobacion de Telegram nuevas: **${result.newApprovalRequests.length}** (enviadas: **${result.sentViaTelegram.length}**). Pendientes de aprobacion: **${result.pendingApprovalCount}**.`
  );
  lines.push("");
  if (result.stagingExecutorIsActive) {
    lines.push(
      `**Este agente no ha creado ningun borrador real en esta pasada a proposito** (Fase O27.2): con STAGING_EXECUTION_ENABLED=true, el Staging Executor (Carril A) es la via oficial para escritura real -- crearla tambien aqui generaria una SEGUNDA solicitud de aprobacion de Telegram para el mismo change pack. Solo se han generado/actualizado previews locales. Ver \`docs/staging-execution.md\` y \`docs/carril-a-staging-autonomy.md\`.`
    );
    lines.push("");
  } else if (!result.wordpressDraftsEnabled || result.wordpressBackend === "local_preview") {
    lines.push(
      `**No se ha llamado a WordPress en esta pasada** (WORDPRESS_DRAFTS_ENABLED=${result.wordpressDraftsEnabled ? "true" : "false"}, WORDPRESS_BACKEND=${result.wordpressBackend}). Solo se han generado/actualizado previews locales en \`reports/wordpress-drafts/previews/\`. Hacen falta las DOS variables a la vez (WORDPRESS_DRAFTS_ENABLED=true y WORDPRESS_BACKEND=rest o mcp) para que exista la posibilidad de una escritura real. Ver \`docs/wordpress-draft-agent.md\` y \`docs/wordpress-mcp-adapter.md\`.`
    );
    lines.push("");
  }

  lines.push(`## Previews locales nuevos (${result.newLocalPreviews.length})`);
  lines.push("");
  if (result.newLocalPreviews.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const d of result.newLocalPreviews) {
      lines.push(`- \`${d.draftId}\` ${d.keyword} (${d.page ?? "sin pagina"}, ${d.draftType}) — \`${d.localPreviewPath}\``);
    }
  }
  lines.push("");

  lines.push(`## Borradores reales creados en WordPress en esta pasada (${result.newWordpressDrafts.length})`);
  lines.push("");
  if (result.newWordpressDrafts.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const d of result.newWordpressDrafts) {
      lines.push(`- \`${d.draftId}\` ${d.keyword} — wordpressDraftId=${d.wordpressDraftId} — ${d.wordpressDraftUrl}`);
    }
  }
  lines.push("");

  lines.push(`## Pendientes de aprobacion por Telegram (${result.pendingApprovalCount})`);
  lines.push("");
  lines.push(
    result.pendingApprovalCount === 0
      ? "Ninguno."
      : "Revisa `npm run approvals:list -- --relatedType change_pack --status pending` y responde con `npm run approvals:update -- --approvalRequestId <id> --answer approved` (o `rejected`/`snoozed`)."
  );
  lines.push("");

  if (result.wpCreationErrors.length > 0) {
    lines.push(`## Errores al crear borrador en WordPress (${result.wpCreationErrors.length})`);
    lines.push("");
    for (const e of result.wpCreationErrors) {
      lines.push(`- \`${e.draftId}\` (change pack \`${e.changePackId}\`): ${e.error}`);
    }
    lines.push("");
    lines.push("El draft se queda en `local_preview` — no se pierde nada, solo no se pudo crear el borrador real. Se reintenta en la siguiente pasada.");
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha publicado ninguna pagina. Cualquier borrador creado en WordPress queda en `status: draft`.");
  lines.push("- No se ha modificado ninguna pagina publicada existente (este agente solo sabe CREAR paginas nuevas en borrador).");
  lines.push("- No se ha tocado home, formularios, WooCommerce, precios, checkout, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- No se ha impreso ni registrado WORDPRESS_APP_PASSWORD ni ningun otro secreto en este informe ni en los logs de esta ejecucion.");
  lines.push(`- \`data/wordpress-drafts.jsonl\` es append-only.`);
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: WordpressDraftAgentRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `wordpress-drafts-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runWordpressDraftAgent(departmentRunId?: string): Promise<WordpressDraftAgentRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("WordPress Draft Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "WordPress Draft Agent iniciado" });

  // --- Paso 1: previews locales (siempre, nunca llama a WordPress) ---
  const eligibleChangePacks = readCurrentChangePacks().filter((cp) => ELIGIBLE_CHANGE_PACK_STATUSES.includes(cp.status));
  const currentDrafts = readCurrentWordpressDrafts();

  const newLocalPreviews: WordpressDraft[] = [];
  const existingLocalPreviews: WordpressDraft[] = [];

  for (const changePack of eligibleChangePacks) {
    const existing = findWordpressDraftByChangePackId(changePack.changePackId, currentDrafts);
    if (existing) {
      existingLocalPreviews.push(existing);
      continue;
    }

    const draftId = randomUUID();
    const generatedAt = new Date().toISOString();
    const localPreviewPath = writePreviewFile(changePack, draftId, generatedAt);

    const { draft } = upsertLocalPreviewDraft(
      {
        draftId,
        changePackId: changePack.changePackId,
        workOrderId: changePack.workOrderId,
        targetBrand: changePack.targetBrand,
        page: changePack.page,
        keyword: changePack.keyword,
        draftType: changePack.changeType,
        localPreviewPath,
      },
      currentDrafts
    );
    newLocalPreviews.push(draft);
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "recommendation_created",
      priority: changePack.priority,
      summary: `Preview local de borrador WordPress listo: ${changePack.keyword}`,
      payload: { draftId: draft.draftId, changePackId: changePack.changePackId },
    });
  }

  // --- Paso 2: creacion real en WordPress, solo si las condiciones se cumplen ---
  const wordpressDraftsEnabled = isWordpressDraftsEnabled();
  const { configured: wordpressConfigured, targetUrl: wordpressTargetUrl } = getWordpressStatusForReport();
  // Fase O10.5: capa de seguridad ADICIONAL, independiente de
  // WORDPRESS_DRAFTS_ENABLED. Con el valor por defecto ("local_preview"),
  // el bloque de creacion real de mas abajo ni siquiera se entra, pase lo
  // que pase con WORDPRESS_DRAFTS_ENABLED — hacen falta las DOS variables
  // a la vez para que exista la posibilidad de una escritura real. Ver
  // docs/wordpress-mcp-adapter.md.
  const wordpressBackend: WordpressBackend = resolveWordpressBackend();
  // Fase O10.6: tercera capa de seguridad, tambien independiente —
  // WORDPRESS_ENV="production" bloquea cualquier escritura real de
  // forma incondicional (aplicado dentro del adaptador, ver
  // src/adapters/wordpress-backend.ts#assertWordpressWriteAllowed).
  // Aqui solo se usa para el log/informe, nunca para decidir si se
  // entra en el bloque de mas abajo (el bloqueo real vive en el
  // adaptador, no aqui, para que no se pueda "olvidar" en un futuro
  // punto de entrada nuevo).
  const wordpressEnv: WordpressEnv = resolveWordpressEnv();

  // Fase O27.2 -- bug real encontrado en el primer pase con
  // STAGING_EXECUTION_ENABLED=true Y WORDPRESS_DRAFTS_ENABLED=true a la
  // vez: este agente y el Staging Executor comparten el mismo
  // interruptor de adaptador (WORDPRESS_DRAFTS_ENABLED, por diseno, ver
  // docs/staging-execution.md) pero tienen flujos de aprobacion
  // SEPARADOS -- con los dos activos, un mismo change pack generaba DOS
  // solicitudes de Telegram distintas ("Ejecutar en staging" del Carril A
  // Y "Crear borrador WordPress" de este agente) para la MISMA pagina.
  // Cuando el Staging Executor esta activo, es la via OFICIAL y mas
  // completa (snapshot, rollback, QA integrado, Carril A) -- este agente
  // cede el paso y se queda solo en previews locales, igual que si
  // WORDPRESS_DRAFTS_ENABLED fuera false, para no duplicar la decision.
  const stagingExecutorIsActive = (process.env.STAGING_EXECUTION_ENABLED ?? "").trim().toLowerCase() === "true";

  // Log claro del estado completo antes de decidir nada — sin secretos
  // (targetUrl es una URL publica, nunca una credencial).
  logger.info("WordPress Draft Agent: estado de escritura real para esta pasada", {
    environment: wordpressEnv,
    backend: wordpressBackend,
    draftsEnabled: wordpressDraftsEnabled,
    stagingExecutorIsActive,
    targetUrl: wordpressTargetUrl ?? "(no configurado)",
  });

  const newApprovalRequests: ApprovalRequest[] = [];
  const sentViaTelegram: ApprovalRequest[] = [];
  const newWordpressDrafts: WordpressDraft[] = [];
  const rejectedDrafts: WordpressDraft[] = [];
  const wpCreationErrors: Array<{ draftId: string; changePackId: string; error: string }> = [];
  let pendingApprovalCount = 0;

  const telegramEnabled = isTelegramApprovalsEnabled();

  if (wordpressDraftsEnabled && wordpressBackend !== "local_preview" && !stagingExecutorIsActive) {
    const allChangePacksById = new Map(eligibleChangePacks.map((cp) => [cp.changePackId, cp]));
    const currentApprovalRequests = readCurrentApprovalRequests();
    const allCurrentDrafts = readCurrentWordpressDrafts();

    const candidateDrafts = allCurrentDrafts.filter(
      (d) => d.status === "local_preview" && allChangePacksById.get(d.changePackId)?.status === "approved_to_execute"
    );

    for (const draft of candidateDrafts) {
      const changePack = allChangePacksById.get(draft.changePackId);
      if (!changePack) continue;

      let approvalRequest = findAnyRequestByRelatedId(changePack.changePackId, currentApprovalRequests);
      if (!approvalRequest) {
        const input: CreateApprovalRequestInput = {
          relatedType: "change_pack",
          relatedId: changePack.changePackId,
          title: `Crear borrador WordPress: "${changePack.keyword}"${changePack.page ? ` (${changePack.page})` : ""}`,
          summary: `El change pack \`${changePack.changePackId}\` esta aprobado para ejecutar. Este es el paso final antes de crear un borrador SIN PUBLICAR en WordPress a partir de el.`,
          riskLevel: WORDPRESS_DRAFT_RISK_LEVEL,
          requestedAction: "Aprobar la creacion de un borrador (status: draft, sin publicar) en WordPress a partir de este paquete de cambio ya revisado.",
          options: APPROVAL_OPTIONS,
          channel: "telegram",
        };
        const { request, isNew } = upsertApprovalRequest(input, currentApprovalRequests);
        approvalRequest = request;
        if (isNew) {
          newApprovalRequests.push(request);
          emitEvent({
            departmentRunId: deptRunId,
            agent: AGENT_NAME,
            type: "approval_required",
            priority: "high",
            summary: `Nueva solicitud de aprobacion para crear borrador WordPress: ${changePack.keyword}`,
            payload: { approvalRequestId: request.approvalRequestId, changePackId: changePack.changePackId, draftId: draft.draftId },
          });

          if (telegramEnabled) {
            try {
              await sendTelegramApprovalRequest({
                approvalRequestId: request.approvalRequestId,
                title: request.title,
                summary: request.summary,
                riskLevel: request.riskLevel,
                requestedAction: request.requestedAction,
                options: request.options,
              });
              const updated = markApprovalRequestSent(request.approvalRequestId, "telegram");
              if (updated) sentViaTelegram.push(updated);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              logger.error("Fallo al enviar por Telegram la aprobacion de borrador WordPress", {
                approvalRequestId: request.approvalRequestId,
                error: message,
              });
            }
          }
        }
      }

      if (approvalRequest.status === "approved") {
        try {
          const fields = extractPreviewFields(changePack);
          const blueprint = findLandingBlueprintByChangePackId(changePack.changePackId, readCurrentLandingBlueprints());
          const draftInput = {
            title: fields.title,
            contentHtml: buildWordpressContentHtml(fields, blueprint),
            excerpt: fields.metaDescription,
          };
          // wordpressBackend nunca es "local_preview" aqui (ver el guard
          // de mas arriba que ni entra en este bloque en ese caso) — solo
          // "rest" (Fase O10, implementado) o "mcp" (Fase O10.5, skeleton
          // que siempre lanza, ver src/adapters/wordpress-mcp.ts).
          const result =
            wordpressBackend === "rest"
              ? await createWordpressDraftPage(draftInput)
              : await createWordpressDraftPageViaMcp(draftInput);
          const promoted = promoteWordpressDraftCreated(draft.draftId, result.wordpressDraftId, result.wordpressDraftUrl);
          if (promoted) newWordpressDrafts.push(promoted);
          // Deliberadamente NO se emite un evento "agent_finished" aqui
          // (solo el del final de la funcion cuenta como tal) —
          // summarizeAgentActivity() en growth-director.ts usa el PRIMER
          // "agent_finished" de cada agente para el resumen de actividad
          // del informe tecnico; emitir uno intermedio con este tipo lo
          // pisaria por error. Se registra en el log y en el informe del
          // agente en su lugar.
          logger.info("Borrador real creado en WordPress (sin publicar)", {
            draftId: draft.draftId,
            wordpressDraftId: result.wordpressDraftId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          wpCreationErrors.push({ draftId: draft.draftId, changePackId: changePack.changePackId, error: message });
          logger.error("Fallo al crear el borrador real en WordPress", { draftId: draft.draftId, error: message });
        }
      } else if (approvalRequest.status === "rejected") {
        const updated = setWordpressDraftStatus(draft.draftId, "rejected");
        if (updated) rejectedDrafts.push(updated);
      } else {
        pendingApprovalCount += 1;
      }
    }
  } else if (currentDrafts.some((d) => d.status === "local_preview")) {
    logger.info(
      `No se ha llamado a WordPress en esta pasada (WORDPRESS_DRAFTS_ENABLED=${wordpressDraftsEnabled}, WORDPRESS_BACKEND=${wordpressBackend}), solo previews locales.`
    );
  }

  const totalLocalPreviewCount = readCurrentWordpressDrafts().filter((d) => d.status === "local_preview").length;
  const totalWordpressDraftCount = readCurrentWordpressDrafts().filter((d) => d.status === "wp_draft_created").length;

  const generatedAt = new Date().toISOString();
  const result: WordpressDraftAgentRunResult = {
    departmentRunId: deptRunId,
    newLocalPreviews,
    existingLocalPreviews,
    newApprovalRequests,
    sentViaTelegram,
    pendingApprovalCount,
    newWordpressDrafts,
    rejectedDrafts,
    wpCreationErrors,
    wordpressDraftsEnabled,
    stagingExecutorIsActive,
    wordpressConfigured,
    wordpressBackend,
    wordpressEnv,
    wordpressTargetUrl,
    telegramEnabled,
    totalLocalPreviewCount,
    totalWordpressDraftCount,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `WordPress Draft Agent finalizado. Previews nuevos: ${newLocalPreviews.length}. Borradores WordPress nuevos: ${newWordpressDrafts.length}. Pendientes de aprobacion: ${pendingApprovalCount}. Informe: ${result.reportPath}`
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `WordPress Draft Agent finalizado: ${newLocalPreviews.length} preview(s) nuevo(s), ${newWordpressDrafts.length} borrador(es) real(es) nuevo(s)`,
    payload: {
      newLocalPreviewCount: newLocalPreviews.length,
      newWordpressDraftCount: newWordpressDrafts.length,
      wordpressDraftsEnabled,
      reportPath: result.reportPath,
    },
  });

  return result;
}
