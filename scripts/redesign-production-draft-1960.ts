import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { findChangePackById } from "../src/core/change-packs";
import { extractPreviewFields, buildWordpressContentHtml } from "../src/agents/wordpress-draft-agent";
import { buildBlueprintInput } from "../src/agents/ux-ui-landing-architect";
import { readCurrentLandingBlueprints, findLandingBlueprintByChangePackId, replaceLandingBlueprintContent } from "../src/core/landing-blueprints";
import { checkLandingQuality } from "../src/agents/staging-qa-agent";
import { getProductionPage, getProductionStatusForReport, updateProductionDraftPage } from "../src/adapters/wordpress-production";
import { recordPendingProductionDraftEdit, markProductionDraftEditFailed } from "../src/core/production-draft-edits";
import { logger } from "../src/core/logger";

/**
 * Rediseno puntual (Fase O13.6c) del draft de PRODUCCION 1960 usando el
 * UX/UI Landing Architect + plantilla sector_landing + render Gutenberg
 * real. Modifica SOLO la pagina 1960 -- nunca publica, nunca toca otra
 * pagina. Mantiene wp-image-1959 (la imagen hero ya subida en O13.3),
 * insertandola como bloque hero delante del resto del contenido nuevo
 * (el LandingBlueprint de hoy no incluye la imagen en si -- eso sigue
 * siendo un bloque aparte, mismo patron que insert-hero-image-into-draft.ts
 * de la Fase O12.8/O13.3).
 */

const PAGE_ID = 1960;
const CHANGE_PACK_ID = "e21b2a0d-b0b1-4080-8b5a-ea0d4a404ca5";
const HERO_MEDIA_ID = 1959;
const HERO_MEDIA_URL = "https://zentrylockers.com/wp-content/uploads/2026/08/taquillas-escolares-hero-zentry.webp";
const HERO_ALT_TEXT = "Taquillas escolares — imagen principal";
// Enlaces internos REALES ya verificados en produccion (misma home de
// zentrylockers.com que en las Fases O13.3/O13.5). El change pack de este
// draft no trae suggestedInternalLinks/internalLinks propios, asi que se
// inyectan aqui explicitamente para que los CTA apunten a paginas reales
// en vez de a anclas "#solicitar-presupuesto" que no existen en la pagina.
const REAL_CTA_URL = "https://zentrylockers.com/solicitar-presupuesto/";
const REAL_SECONDARY_URL = "https://zentrylockers.com/contacto/";

function buildHeroImageBlock(): string {
  return (
    `<!-- wp:image {"id":${HERO_MEDIA_ID},"sizeSlug":"large","linkDestination":"none","className":"hero-image"} -->\n` +
    `<figure class="wp-block-image size-large hero-image"><img src="${HERO_MEDIA_URL}" alt="${HERO_ALT_TEXT}" class="wp-image-${HERO_MEDIA_ID}"/></figure>\n` +
    `<!-- /wp:image -->`
  );
}

function plainPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const changePack = findChangePackById(CHANGE_PACK_ID);
  if (!changePack) {
    console.error(`No existe el change pack ${CHANGE_PACK_ID}.`);
    process.exit(1);
    return;
  }

  // 1) Regenerar el blueprint con la logica YA CORREGIDA (bugfix Fase
  // O13.6c: secciones duplicadas + bloque "como trabajamos").
  const fields = extractPreviewFields(changePack);
  const blueprintInput = buildBlueprintInput(changePack);
  // Los CTA generados apuntan a anclas locales cuando el change pack no
  // trae internalLinks propios (este es el caso). Se sustituyen por las
  // paginas reales ya verificadas para que "botones reales" lo sean de
  // verdad (enlazan a paginas de produccion existentes, no a anclas que
  // no existen en la pagina y sin tocar el formulario en si).
  blueprintInput.ctaPrimary = { ...blueprintInput.ctaPrimary, target: REAL_CTA_URL, isRealLink: true };
  if (blueprintInput.ctaSecondary) {
    blueprintInput.ctaSecondary = { ...blueprintInput.ctaSecondary, target: REAL_SECONDARY_URL, isRealLink: true };
  }
  blueprintInput.finalCta = {
    ...blueprintInput.finalCta,
    cta: { ...blueprintInput.finalCta.cta, target: REAL_CTA_URL, isRealLink: true },
  };
  blueprintInput.internalLinks = [REAL_CTA_URL, REAL_SECONDARY_URL];

  const existingBlueprint = findLandingBlueprintByChangePackId(CHANGE_PACK_ID, readCurrentLandingBlueprints());
  if (!existingBlueprint) {
    console.error("No existe todavia un LandingBlueprint para este change pack -- ejecuta primero npm run ux-ui-landing:plan.");
    process.exit(1);
    return;
  }
  const blueprint = replaceLandingBlueprintContent(existingBlueprint.blueprintId, blueprintInput);
  if (!blueprint) {
    console.error("No se pudo actualizar el blueprint.");
    process.exit(1);
    return;
  }
  console.log(`Blueprint corregido: ${blueprint.blueprintId} (plantilla: ${blueprint.templateType})`);

  // 2) Construir el HTML real: hero-image + hero texto/CTA + resto del blueprint.
  const bodyHtml = buildWordpressContentHtml(fields, blueprint);
  const newContentHtml = `${buildHeroImageBlock()}\n\n${bodyHtml}`;

  // 3) QA visual/SEO/CRO reforzado ANTES de escribir nada.
  const qa = checkLandingQuality(newContentHtml);
  console.log("");
  console.log("=== QA visual/SEO/CRO (pre-escritura) ===");
  console.log(`pass: ${qa.pass}`);
  console.log(`botones: ${qa.buttonCount} | bloques visuales: ${qa.visualBlockCount} | CTA above the fold: ${qa.hasAboveFoldCta}`);
  console.log(`H1: ${qa.h1Count} | H2: ${qa.h2Count} | estructura ok: ${qa.hasProperHeadingStructure}`);
  console.log(`contenido: ${qa.contentLength} caracteres | placeholders: ${qa.hasPlaceholders} | claims sospechosos: ${qa.hasSuspiciousClaims}`);
  if (qa.failures.length > 0) {
    console.log("FALLOS:");
    for (const f of qa.failures) console.log(`  - ${f}`);
  }
  if (!qa.pass) {
    console.error("QA visual/SEO/CRO NO paso. No se escribe nada en produccion.");
    process.exit(1);
    return;
  }

  // 4) Escritura real, gateada (mismas 3 condiciones que O13.3/O13.5).
  const prodStatus = getProductionStatusForReport();
  console.log("");
  console.log(`PRODUCTION_EXECUTION_ENABLED=${prodStatus.executionEnabled} PRODUCTION_DRAFTS_ENABLED=${prodStatus.draftsEnabled} PRODUCTION_BACKEND=${prodStatus.backend}`);
  if (!prodStatus.canWrite) {
    console.log("SIMULACION (no se toca la red): faltan condiciones. QA ya paso, contenido listo para cuando se activen los flags.");
    return;
  }

  const current = await getProductionPage(PAGE_ID);
  console.log(`Estado actual: status="${current.status}" title="${current.title}" slug="${current.slug}"`);
  if (current.status !== "draft") {
    console.error(`La pagina ${PAGE_ID} no esta en status "draft". Bloqueado.`);
    process.exit(1);
    return;
  }
  if (!current.contentHtml.includes(`wp-image-${HERO_MEDIA_ID}`)) {
    console.log("AVISO: el draft actual no contenia wp-image-1959 -- se inserta de todas formas segun lo pedido.");
  }

  const answer = await plainPrompt(
    `Vas a REDISENAR el draft de PRODUCCION ${PAGE_ID} con la plantilla sector_landing (hero+CTA+beneficios+materiales+secciones+FAQ+CTA final). Sigue en status "draft", NO se publica. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se modifico nada.");
    return;
  }

  const edit = recordPendingProductionDraftEdit({
    pageId: PAGE_ID,
    previousTitle: current.title,
    previousContentHtml: current.contentHtml,
    previousExcerpt: current.excerpt,
    previousSlug: current.slug,
    newTitle: current.title,
    newContentHtml,
    newExcerpt: current.excerpt,
    newSlug: current.slug,
  });
  console.log(`Snapshot previo guardado: editId=${edit.editId}`);

  logger.info("redesign-production-draft-1960: iniciando actualizacion real", { pageId: PAGE_ID, editId: edit.editId, blueprintId: blueprint.blueprintId });

  try {
    const result = await updateProductionDraftPage({
      pageId: PAGE_ID,
      title: current.title,
      contentHtml: newContentHtml,
      excerpt: current.excerpt,
      slug: current.slug,
    });

    console.log("");
    console.log("=== Rediseno aplicado ===");
    console.log(`wordpressPageId: ${result.wordpressPageId}`);
    console.log(`wordpressDraftUrl: ${result.wordpressDraftUrl}`);
    console.log(`editId (para rollback si hace falta): ${edit.editId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo el rediseno real: ${message}`);
    markProductionDraftEditFailed(edit.editId, message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
