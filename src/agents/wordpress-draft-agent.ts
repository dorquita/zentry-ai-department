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

// Fase O27.4b -- segundo bug real encontrado en revision visual de Pau:
// para new_content_page/content_update, esta funcion devolvia SIEMPRE la
// nota interna "(no generada por Content Planner — redactar manualmente
// antes de publicar)" como si fuera la meta description real -- y esa
// nota terminaba en el <meta name="description"> y en el excerpt de la
// pagina publicada en staging (visible para cualquiera que la inspeccione
// o la vea en un listado). Content Planner nunca genera una meta
// description para estos tipos de change pack (confirmado: su esquema no
// tiene ese campo) -- en vez de dejar la nota interna, se genera una meta
// description real y razonable a partir del titulo/keyword.
function buildFallbackMetaDescription(title: string): string {
  const base = `${title}: materiales, ventajas y presupuesto con Zentry, fabricante directo. Sin compromiso.`;
  return base.length <= 155 ? base : `${base.slice(0, 152)}...`;
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
    const title = asString(p.recommendedTitle, changePack.keyword);
    return {
      title,
      metaDescription: buildFallbackMetaDescription(title),
      h1: title,
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

// Fase O27.4d -- componentes "zentry*" (benchmark UX/UI de referencias
// reales del sector, ver docs/ux-benchmark-taquillas.md): antes de este
// fix, el "hero" era una banda de una sola columna, apilada (imagen
// encima, texto debajo) -- ningun competidor directo visitado (Setroc,
// Taquiblok) hace esto. El patron real observado en los dos es SIEMPRE
// dos columnas: texto+CTA a un lado, imagen real al otro. Se replica esa
// ESTRUCTURA (no el diseno literal de ningun competidor -- colores,
// tipografia y copy son propios de Zentry).

// `prominent` anade estilo de boton grande/relleno (`is-style-fill` +
// `has-large-font-size`, clases nativas de Gutenberg) para el CTA del
// hero y el cierre comercial -- Pau senalo el CTA como "poco
// protagonista" en una captura real; Taquiblok usa un boton amarillo muy
// visible sobre foto real como referencia de lo que SI funciona.
// Fase O28.1 -- `extraClass` (p.ej. "zentry-cta") se anade AL LADO de las
// clases nativas de Gutenberg, nunca en su lugar: el marcador
// `<!-- wp:buttons -->`/`wp-block-button__link` sigue presente para que
// (a) el QA tecnico (checkLandingQuality) siga detectando el boton como
// tal, y (b) el bloque siga siendo un boton Gutenberg valido si alguien
// lo abre en el editor -- el estilo real lo aporta la clase zentry-cta.
function buildButtonBlock(label: string, target: string, extraClass?: string): string {
  const safeLabel = escapeHtmlText(label);
  const safeTarget = escapeHtmlAttr(target);
  const linkClass = extraClass ? `wp-block-button__link wp-element-button ${extraClass}` : "wp-block-button__link wp-element-button";
  return [
    `<!-- wp:buttons -->`,
    `<div class="wp-block-buttons"><!-- wp:button -->`,
    `<div class="wp-block-button"><a class="${linkClass}" href="${safeTarget}">${safeLabel}</a></div>`,
    `<!-- /wp:button --></div>`,
    `<!-- /wp:buttons -->`,
  ].join("\n");
}

// Fase O28.1 -- pulido visual final: se confirmo (test real de escritura
// contra staging) que <style> SI sobrevive en content.raw, asi que en vez
// de depender solo de estilos inline (limitados: sin hover, sin
// gradientes reutilizables, dificil de mantener consistente), se define
// UN bloque de clases CSS reutilizables ".zentry-*" que se inyecta una
// vez al principio del contenido. Colores tomados de las variables CSS
// REALES de produccion (--global-palette1..9, verificado via curl contra
// zentrylockers.com) -- no son colores inventados, son la marca real.
const ZENTRY_BRAND = {
  primary: "#3182CE",
  primaryDark: "#2B6CB0",
  ink: "#1A202C",
  inkSoft: "#2D3748",
  muted: "#4A5568",
  bgSoft: "#F7FAFC",
  bgCard: "#EDF2F7",
};

const ZENTRY_STYLE_BLOCK = `<style>
.zentry-hero{background:linear-gradient(135deg,${ZENTRY_BRAND.bgCard} 0%,${ZENTRY_BRAND.bgSoft} 100%);border-radius:20px;padding:3.5rem 2.5rem;margin-bottom:2.5rem;}
.zentry-hero__grid{display:grid;grid-template-columns:1.15fr 1fr;gap:2.5rem;align-items:center;}
.zentry-hero__title{font-size:2.5rem;line-height:1.15;margin:0 0 1rem;color:${ZENTRY_BRAND.ink};font-weight:800;}
.zentry-hero__subtitle{font-size:1.3rem;color:${ZENTRY_BRAND.inkSoft};margin:0 0 1.5rem;line-height:1.5;}
.zentry-hero__benefits{list-style:none;padding:0;margin:0 0 1.75rem;}
.zentry-hero__benefits li{font-size:1.1rem;margin-bottom:0.65rem;color:${ZENTRY_BRAND.inkSoft};font-weight:600;}
.zentry-cta{display:inline-block!important;background:${ZENTRY_BRAND.primary}!important;color:#fff!important;font-weight:700!important;font-size:1.15rem!important;padding:1.1rem 2.25rem!important;border-radius:10px!important;text-decoration:none!important;box-shadow:0 6px 18px rgba(49,130,206,0.35);transition:transform .15s ease,box-shadow .15s ease;}
.zentry-cta:hover{background:${ZENTRY_BRAND.primaryDark}!important;transform:translateY(-2px);box-shadow:0 8px 22px rgba(49,130,206,0.45);}
.zentry-image-box{background:linear-gradient(135deg,${ZENTRY_BRAND.primary} 0%,${ZENTRY_BRAND.primaryDark} 100%);border-radius:18px;padding:3.5rem 1.5rem;text-align:center;min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;box-shadow:0 14px 34px rgba(49,130,206,0.28);}
.zentry-image-box__icon{font-size:4.5rem;margin:0;line-height:1;}
.zentry-image-box__caption{margin:1.1rem 0 0;font-size:0.95rem;opacity:0.92;font-style:italic;padding:0 1rem;}
.zentry-cards{display:grid!important;width:100%!important;grid-template-columns:repeat(var(--zentry-cols,3),1fr);gap:1.5rem;margin:1.75rem 0;align-items:stretch;}
@media(max-width:780px){.zentry-cards{grid-template-columns:1fr!important;}}
.zentry-card{background:#fff;border:1px solid ${ZENTRY_BRAND.bgCard};border-radius:14px;padding:2rem 1.5rem;text-align:center;box-shadow:0 3px 14px rgba(26,32,44,0.07);transition:transform .15s ease,box-shadow .15s ease;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;box-sizing:border-box;}
.zentry-card:hover{transform:translateY(-4px);box-shadow:0 10px 24px rgba(26,32,44,0.12);}
.zentry-card__icon{font-size:2.5rem;display:block;margin-bottom:0.65rem;}
.zentry-card__title{font-size:1.15rem;font-weight:700;color:${ZENTRY_BRAND.ink};margin:0 0 0.5rem;}
.zentry-card__desc{font-size:0.95rem;color:${ZENTRY_BRAND.muted};margin:0;line-height:1.5;}
.zentry-table-wrap{overflow-x:auto;margin:1.75rem 0;border-radius:14px;box-shadow:0 3px 14px rgba(26,32,44,0.07);}
.zentry-table{width:100%;border-collapse:collapse;background:#fff;}
.zentry-table th{background:${ZENTRY_BRAND.primary};color:#fff;padding:1.1rem 1.25rem;text-align:left;font-size:0.95rem;font-weight:700;}
.zentry-table td{padding:1rem 1.25rem;border-bottom:1px solid ${ZENTRY_BRAND.bgCard};font-size:0.95rem;color:${ZENTRY_BRAND.inkSoft};}
.zentry-table tr:last-child td{border-bottom:none;}
.zentry-table td:first-child{font-weight:700;color:${ZENTRY_BRAND.ink};background:${ZENTRY_BRAND.bgSoft};}
.zentry-usecases{display:grid!important;width:100%!important;grid-template-columns:repeat(var(--zentry-cols,4),1fr);gap:1.25rem;margin:1.75rem 0;align-items:stretch;}
@media(max-width:780px){.zentry-usecases{grid-template-columns:repeat(2,1fr)!important;}}
.zentry-usecase{background:${ZENTRY_BRAND.bgSoft};border-radius:14px;padding:1.75rem 1rem;text-align:center;border:1px solid ${ZENTRY_BRAND.bgCard};display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;box-sizing:border-box;}
.zentry-usecase__icon{font-size:2.5rem;display:block;margin-bottom:0.6rem;}
.zentry-usecase__label{font-weight:700;color:${ZENTRY_BRAND.ink};font-size:1.02rem;}
.zentry-process{display:grid!important;width:100%!important;grid-template-columns:repeat(var(--zentry-cols,3),1fr);gap:1.75rem;margin:1.75rem 0;align-items:start;}
@media(max-width:780px){.zentry-process{grid-template-columns:1fr!important;}}
.zentry-process__step{text-align:center;padding:1rem;}
.zentry-process__number{width:3.75rem;height:3.75rem;border-radius:50%;background:${ZENTRY_BRAND.primary};color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 1.1rem;font-weight:800;font-size:1.5rem;box-shadow:0 6px 16px rgba(49,130,206,0.32);}
.zentry-process__text{color:${ZENTRY_BRAND.inkSoft};font-size:1.02rem;line-height:1.5;}
.zentry-final-cta{background:linear-gradient(135deg,${ZENTRY_BRAND.ink} 0%,${ZENTRY_BRAND.inkSoft} 100%);border-radius:20px;padding:4rem 2rem;text-align:center;margin-top:3rem;max-width:640px;margin-left:auto;margin-right:auto;}
.zentry-final-cta__title{color:#fff;font-size:2rem;margin:0 0 0.9rem;line-height:1.2;}
.zentry-final-cta__support{color:#CBD5E0;font-size:1.1rem;margin:0 0 2rem;line-height:1.5;}
/* Fase O28.2 -- el bloque nativo de Gutenberg "Botones" trae su propio
   justify-content (por defecto flex-start) en .wp-block-buttons, que
   IGNORA el text-align:center del contenedor padre -- por eso el CTA
   final se veia pegado a la izquierda pese a estar dentro de una banda
   centrada. Se fuerza el centrado del bloque de botones especificamente
   dentro de esta banda, sin tocar el boton del hero (que debe seguir
   alineado a la izquierda, dentro de su columna de texto). */
.zentry-final-cta .wp-block-buttons{display:flex!important;justify-content:center!important;margin:0!important;}
.zentry-faq-item{border:1px solid ${ZENTRY_BRAND.bgCard};border-radius:14px;padding:1.4rem 1.6rem;margin-bottom:1rem;background:#fff;box-shadow:0 2px 10px rgba(26,32,44,0.05);}
.zentry-faq-item h3{margin-top:0;color:${ZENTRY_BRAND.ink};font-size:1.12rem;}
.zentry-faq-item p{margin-bottom:0;color:${ZENTRY_BRAND.muted};}
@media(max-width:780px){.zentry-hero__grid{grid-template-columns:1fr;}.zentry-hero{padding:2.25rem 1.5rem;}.zentry-hero__title{font-size:1.9rem;}.zentry-final-cta__title{font-size:1.5rem;}}
</style>`;

/**
 * zentryBenefitsCards -- tarjetas de ventajas reales (fondo blanco, borde,
 * sombra suave, hover con elevacion) -- Setroc usa este mismo patron
 * estructural (icono + titulo + descripcion corta, en tarjeta propia) en
 * su bloque de confianza. Se replica la ESTRUCTURA con copy/marca propios.
 */
function zentryBenefitsCards(items: Array<{ title: string; description: string }>, withIcons = false): string {
  const cards = items
    .map((item, i) => {
      const icon = withIcons ? `<span class="zentry-card__icon">${COLUMN_ICONS[i % COLUMN_ICONS.length]}</span>` : "";
      return `<div class="zentry-card">${icon}<h3 class="zentry-card__title">${escapeHtmlText(item.title)}</h3><p class="zentry-card__desc">${escapeHtmlText(item.description)}</p></div>`;
    })
    .join("\n");
  // Fase O28.1 -- envuelto en un `<!-- wp:columns -->` real (div propio,
  // sin mezclar clases con .zentry-cards -- evita cualquier conflicto
  // entre el `display:flex` del bloque nativo y el `display:grid` propio)
  // para que siga contando como bloque visual valido en el QA tecnico y
  // en el editor de bloques.
  // Fase O28.2 -- `--zentry-cols` explicito (nunca auto-fit): rejilla
  // predecible de verdad, capada a 3 columnas maximo (si hay 1 sola card
  // -- el material destacado -- ocupa 1 columna centrada, no se estira a
  // todo el ancho). El bug real de "huecos raros"/tarjetas descompensadas
  // era que `.zentry-cards` vivia dentro de `.wp-block-columns` (flex de
  // Kadence) sin `width:100%`, asi que el grid se calculaba contra un
  // ancho encogido en vez del ancho completo del bloque -- ver `width:100%!important` arriba.
  const cols = Math.min(items.length, 3);
  return [
    `<!-- wp:columns -->`,
    `<div class="wp-block-columns"><div class="zentry-cards" style="--zentry-cols:${cols};${cols === 1 ? "max-width:360px;margin-left:auto;margin-right:auto;" : ""}">`,
    cards,
    `</div></div>`,
    `<!-- /wp:columns -->`,
  ].join("\n");
}
const COLUMN_ICONS = ["✅", "📐", "💬", "🔧", "⭐"];

/**
 * zentryHeroProduct -- hero a DOS COLUMNAS grande, con impacto (patron
 * confirmado por captura real en Taquiblok: titular+copy a la izquierda,
 * imagen destacada a la derecha). El placeholder de imagen ahora es una
 * caja grande con degradado de marca, no un icono pequeño suelto --
 * sigue siendo honesto (nunca simula una foto real), pero se presenta
 * como un espacio de diseno "reservado", no como un error visual.
 */
function zentryHeroProduct(blueprint: LandingBlueprint): string {
  const quickBenefits = blueprint.benefitBlocks
    .slice(0, 3)
    .map((b) => `<li>✅ ${escapeHtmlText(b.title)}</li>`)
    .join("\n");
  const caption = blueprint.heroImageCaption ?? "Imagen de producto — pendiente de sesion fotografica";
  return [
    `<div class="zentry-hero">`,
    `<div class="zentry-hero__grid">`,
    `<div class="zentry-hero__content">`,
    `<h2 class="zentry-hero__title">${escapeHtmlText(blueprint.hero.headline)}</h2>`,
    `<p class="zentry-hero__subtitle">${escapeHtmlText(blueprint.hero.subheadline)}</p>`,
    quickBenefits ? `<ul class="zentry-hero__benefits">\n${quickBenefits}\n</ul>` : "",
    buildButtonBlock(blueprint.ctaPrimary.label, blueprint.ctaPrimary.target, "zentry-cta"),
    `</div>`,
    `<div class="zentry-hero__visual">`,
    `<div class="zentry-image-box">`,
    `<p class="zentry-image-box__icon">🖼️</p>`,
    `<p class="zentry-image-box__caption">${escapeHtmlText(caption)}</p>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * zentryFinalCta -- cierre comercial fuerte: banda con degradado oscuro,
 * titulo grande, TEXTO DE APOYO (nuevo, pedido explicitamente por Pau) y
 * boton grande de marca.
 */
function zentryFinalCta(blueprint: LandingBlueprint): string {
  return [
    `<div class="zentry-final-cta">`,
    `<h2 class="zentry-final-cta__title">${escapeHtmlText(blueprint.finalCta.headline)}</h2>`,
    `<p class="zentry-final-cta__support">Fabricante directo, sin intermediarios. Te respondemos con tu presupuesto a medida en poco tiempo.</p>`,
    buildButtonBlock(blueprint.finalCta.cta.label, blueprint.finalCta.cta.target, "zentry-cta"),
    `</div>`,
  ].join("\n");
}

/**
 * zentryMaterialComparisonTable -- tabla con cabecera de marca (fondo de
 * color, texto blanco), primera columna con mas peso visual, filas
 * separadas por linea sutil y envuelta en una tarjeta con sombra.
 */
function zentryMaterialComparisonTable(table: NonNullable<LandingBlueprint["comparisonTable"]>): string {
  const theadCells = table.headers.map((h) => `<th>${escapeHtmlText(h)}</th>`).join("");
  const bodyRows = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtmlText(cell)}</td>`).join("")}</tr>`)
    .join("\n");
  return [
    `<h2>${escapeHtmlText(table.title)}</h2>`,
    `<div class="zentry-table-wrap">`,
    `<table class="zentry-table"><thead><tr>${theadCells}</tr></thead><tbody>`,
    bodyRows,
    `</tbody></table>`,
    `</div>`,
  ].join("\n");
}

const USE_CASE_ICONS = ["🏢", "🏫", "🏊", "🏋️", "🏨", "🏭"];

/**
 * zentryUseCasesGrid -- grid de sectores/usos con icono grande y card
 * propia (antes era una fila de columnas basicas de Gutenberg).
 */
function zentryUseCasesGrid(useCases: string[]): string {
  if (useCases.length === 0) return "";
  const cards = useCases
    .map(
      (useCase, i) =>
        `<div class="zentry-usecase"><span class="zentry-usecase__icon">${USE_CASE_ICONS[i % USE_CASE_ICONS.length]}</span><div class="zentry-usecase__label">${escapeHtmlText(useCase)}</div></div>`
    )
    .join("\n");
  // Fase O28.2 -- columnas explicitas capadas a 4 (nunca auto-fit), igual
  // criterio que zentryBenefitsCards.
  const cols = Math.min(useCases.length, 4);
  return [
    `<h2>Donde se usan habitualmente</h2>`,
    `<!-- wp:columns -->`,
    `<div class="wp-block-columns"><div class="zentry-usecases" style="--zentry-cols:${cols};">`,
    cards,
    `</div></div>`,
    `<!-- /wp:columns -->`,
  ].join("\n");
}

/**
 * zentryProcessSteps -- pasos numerados con circulo grande de marca y
 * mas separacion entre pasos.
 */
function zentryProcessSteps(steps: string[]): string {
  if (steps.length === 0) return "";
  const stepBlocks = steps
    .map((step, i) => `<div class="zentry-process__step"><div class="zentry-process__number">${i + 1}</div><p class="zentry-process__text">${escapeHtmlText(step)}</p></div>`)
    .join("\n");
  const cols = Math.min(steps.length, 3);
  return [
    `<h2>Como pedir tu presupuesto</h2>`,
    `<!-- wp:columns -->`,
    `<div class="wp-block-columns"><div class="zentry-process" style="--zentry-cols:${cols};">`,
    stepBlocks,
    `</div></div>`,
    `<!-- /wp:columns -->`,
  ].join("\n");
}

/**
 * zentryFaqBlock -- FAQ en tarjetas propias con sombra suave.
 */
function zentryFaqBlock(items: Array<{ question: string; answer: string }>): string {
  const parts = [`<h2>Preguntas frecuentes</h2>`];
  for (const item of items) {
    parts.push(`<div class="zentry-faq-item"><h3>${escapeHtmlText(item.question)}</h3><p>${escapeHtmlText(item.answer)}</p></div>`);
  }
  return parts.join("\n");
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

  // Fase O27.4d -- rediseno con componentes "zentry*" tras benchmark UX/UI
  // de referencias reales del sector (ver docs/ux-benchmark-taquillas.md):
  // hero a 2 columnas, ventajas con iconos, tabla comparativa real, grid
  // de usos, pasos de proceso, FAQ y cierre comercial fuerte -- patrones
  // confirmados en Setroc/Taquiblok, nunca copiados literalmente (colores,
  // tipografia y copy son propios de Zentry).
  // Fase O28.1 -- bloque de estilo con clases ".zentry-*" reutilizables,
  // inyectado UNA vez al principio (confirmado con una escritura real de
  // prueba que <style> sobrevive en content.raw).
  parts.push(ZENTRY_STYLE_BLOCK);
  parts.push(zentryHeroProduct(blueprint));

  if (blueprint.benefitBlocks.length > 0) {
    if (blueprint.benefitsHeading) parts.push(`<h2>${escapeHtmlText(blueprint.benefitsHeading)}</h2>`);
    parts.push(zentryBenefitsCards(blueprint.benefitBlocks, true));
  }
  if (blueprint.cards.length > 0) {
    parts.push(zentryBenefitsCards(blueprint.cards, false));
  }

  if (blueprint.comparisonTable) {
    parts.push(zentryMaterialComparisonTable(blueprint.comparisonTable));
  }

  if (blueprint.useCases && blueprint.useCases.length > 0) {
    parts.push(zentryUseCasesGrid(blueprint.useCases));
  }

  for (const section of blueprint.sections) {
    parts.push(`<h2>${escapeHtmlText(section.heading)}</h2>`);
    parts.push(`<p>${escapeHtmlText(section.body)}</p>`);
  }

  if (blueprint.processSteps && blueprint.processSteps.length > 0) {
    parts.push(zentryProcessSteps(blueprint.processSteps));
  }

  if (blueprint.ctaSecondary) {
    parts.push(buildButtonBlock(blueprint.ctaSecondary.label, blueprint.ctaSecondary.target));
  }

  if (blueprint.faq.length > 0) {
    parts.push(zentryFaqBlock(blueprint.faq));
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

  parts.push(zentryFinalCta(blueprint));

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
                relatedType: request.relatedType,
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
