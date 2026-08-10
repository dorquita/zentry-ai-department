import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { findChangePackById } from "../src/core/change-packs";
import { extractPreviewFields, buildWordpressContentHtml } from "../src/agents/wordpress-draft-agent";
import { readCurrentLandingBlueprints, findLandingBlueprintByChangePackId, replaceLandingBlueprintContent } from "../src/core/landing-blueprints";
import { checkLandingQuality } from "../src/agents/staging-qa-agent";
import { getProductionPage, getProductionStatusForReport, updateProductionPublishedPageContent } from "../src/adapters/wordpress-production";
import { recordPendingProductionDraftEdit, markProductionDraftEditFailed } from "../src/core/production-draft-edits";
import { logger } from "../src/core/logger";

/**
 * Fase O13.7b: corrige 3 detalles de calidad SEO/UX en la pagina de
 * PRODUCCION 1960, YA PUBLICADA (a diferencia de O13.6c, que trabajaba
 * sobre un draft). NUNCA cambia el status (sigue "publish") ni el slug.
 * Usa updateProductionPublishedPageContent() (nueva, Fase O13.7b), que
 * rechaza cualquier pagina que no este ya en "publish" -- lo opuesto de
 * updateProductionDraftPage(), que solo toca borradores.
 *
 * 1) H1 duplicado: ya arreglado en la fuente (buildWordpressContentHtml
 *    ahora usa <h2> para el hero cuando hay blueprint) -- este script solo
 *    tiene que regenerar el contenido con el codigo ya corregido.
 * 2) CTA secundario: existe una pagina real sobre cerraduras inteligentes
 *    (https://zentrylockers.com/cerraduras-inteligentes-taquillas/,
 *    verificado publicada) -- se enlaza ahi en vez de a /contacto/.
 * 3) Meta description (Yoast): NO se toca. Verificado que el objeto
 *    `meta` expuesto por la REST API de esta pagina no incluye ningun
 *    campo Yoast (_yoast_wpseo_metadesc ni similar) -- no hay forma
 *    segura de escribirlo via API. Se reporta para edicion manual.
 */

const PAGE_ID = 1960;
const CHANGE_PACK_ID = "e21b2a0d-b0b1-4080-8b5a-ea0d4a404ca5";
const HERO_MEDIA_ID = 1959;
const HERO_MEDIA_URL = "https://zentrylockers.com/wp-content/uploads/2026/08/taquillas-escolares-hero-zentry.webp";
const HERO_ALT_TEXT = "Taquillas escolares — imagen principal";
const REAL_SMART_LOCKS_URL = "https://zentrylockers.com/cerraduras-inteligentes-taquillas/";

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

  const existingBlueprint = findLandingBlueprintByChangePackId(CHANGE_PACK_ID, readCurrentLandingBlueprints());
  if (!existingBlueprint) {
    console.error("No existe blueprint para este change pack.");
    process.exit(1);
    return;
  }

  // Correccion 3 (CTA secundario): apuntar a la pagina real de cerraduras
  // inteligentes en vez de a /contacto/. Todo lo demas del blueprint se
  // conserva identico.
  const correctedInternalLinks = Array.from(new Set([...existingBlueprint.internalLinks, REAL_SMART_LOCKS_URL]));
  const blueprint = replaceLandingBlueprintContent(existingBlueprint.blueprintId, {
    templateType: existingBlueprint.templateType,
    hero: existingBlueprint.hero,
    ctaPrimary: existingBlueprint.ctaPrimary,
    ctaSecondary: existingBlueprint.ctaSecondary
      ? { ...existingBlueprint.ctaSecondary, target: REAL_SMART_LOCKS_URL, isRealLink: true }
      : undefined,
    benefitBlocks: existingBlueprint.benefitBlocks,
    cards: existingBlueprint.cards,
    sections: existingBlueprint.sections,
    faq: existingBlueprint.faq,
    finalCta: existingBlueprint.finalCta,
    internalLinks: correctedInternalLinks,
    visualHierarchyNotes: existingBlueprint.visualHierarchyNotes.map((note) =>
      note === "Un solo H1 (el headline del hero)."
        ? "El titular del hero usa H2 (el tema ya pone su propio H1 de pagina)."
        : note
    ),
  });
  if (!blueprint) {
    console.error("No se pudo actualizar el blueprint.");
    process.exit(1);
    return;
  }
  console.log(`Blueprint corregido: ${blueprint.blueprintId}`);
  console.log(`CTA secundario -> ${blueprint.ctaSecondary?.target}`);

  // 1) H1 duplicado: ya resuelto en buildWordpressContentHtml() (hero=H2).
  const fields = extractPreviewFields(changePack);
  const bodyHtml = buildWordpressContentHtml(fields, blueprint);
  const newContentHtml = `${buildHeroImageBlock()}\n\n${bodyHtml}`;

  const qa = checkLandingQuality(newContentHtml);
  console.log("");
  console.log("=== QA visual/SEO/CRO (pre-escritura, con reglas de encabezado corregidas) ===");
  console.log(`pass: ${qa.pass}`);
  console.log(`botones: ${qa.buttonCount} | bloques visuales: ${qa.visualBlockCount} | CTA above the fold: ${qa.hasAboveFoldCta}`);
  console.log(`H1 en contenido: ${qa.h1Count} (se espera 0, el tema pone el suyo) | H2: ${qa.h2Count} | estructura ok: ${qa.hasProperHeadingStructure}`);
  console.log(`placeholders: ${qa.hasPlaceholders} | claims sospechosos: ${qa.hasSuspiciousClaims}`);
  if (qa.failures.length > 0) {
    console.log("FALLOS:");
    for (const f of qa.failures) console.log(`  - ${f}`);
  }
  if (!qa.pass) {
    console.error("QA NO paso. No se escribe nada en produccion.");
    process.exit(1);
    return;
  }

  const prodStatus = getProductionStatusForReport();
  console.log("");
  console.log(`PRODUCTION_EXECUTION_ENABLED=${prodStatus.executionEnabled} PRODUCTION_DRAFTS_ENABLED=${prodStatus.draftsEnabled} PRODUCTION_BACKEND=${prodStatus.backend}`);
  if (!prodStatus.canWrite) {
    console.log("SIMULACION (no se toca la red): faltan condiciones. QA ya paso, contenido listo para cuando se activen los flags.");
    return;
  }

  const current = await getProductionPage(PAGE_ID);
  console.log(`Estado actual: status="${current.status}" title="${current.title}" slug="${current.slug}"`);
  if (current.status !== "publish") {
    console.error(`La pagina ${PAGE_ID} no esta en status "publish" (esta en "${current.status}"). Bloqueado -- este script solo corrige paginas ya publicadas.`);
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(
    `Vas a CORREGIR el CONTENIDO de la pagina PUBLICADA ${PAGE_ID} (H1 duplicado, CTA secundario). El status seguira "publish", el slug no cambia. Escribe "si" para confirmar: `
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

  logger.info("fix-published-page-1960: iniciando correccion real (pagina ya publicada)", { pageId: PAGE_ID, editId: edit.editId, blueprintId: blueprint.blueprintId });

  try {
    const result = await updateProductionPublishedPageContent({
      pageId: PAGE_ID,
      title: current.title,
      contentHtml: newContentHtml,
      excerpt: current.excerpt,
    });

    console.log("");
    console.log("=== Correccion aplicada ===");
    console.log(`wordpressPageId: ${result.wordpressPageId}`);
    console.log(`wordpressDraftUrl: ${result.wordpressDraftUrl}`);
    console.log(`editId (para rollback si hace falta): ${edit.editId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo la correccion: ${message}`);
    markProductionDraftEditFailed(edit.editId, message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
