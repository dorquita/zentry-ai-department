import * as dotenv from "dotenv";
dotenv.config();
import { findChangePackById } from "../src/core/change-packs";
import { extractPreviewFields, buildWordpressContentHtml } from "../src/agents/wordpress-draft-agent";
import { buildBlueprintInput } from "../src/agents/ux-ui-landing-architect";
import { readCurrentLandingBlueprints, findLandingBlueprintByChangePackId, replaceLandingBlueprintContent } from "../src/core/landing-blueprints";
import { checkLandingQuality } from "../src/agents/staging-qa-agent";
import { updateWordpressDraftPage, getWordpressPage } from "../src/adapters/wordpress";

/**
 * Fase O28.6 -- regenera SOLO la pagina 2103 ("taquillas inteligentes")
 * con la nueva base de conocimiento de control de acceso (LOCK_INFO en
 * ux-ui-landing-architect.ts): que es una taquilla inteligente, mecanica
 * vs electronica, PIN/RFID/app, logs, apertura remota, usos, cuando
 * conviene cada tipo, tabla comparativa propia y FAQ especifica. Ninguna
 * otra pagina se toca.
 *
 * Uso: npx ts-node scripts/o286-regenerate-2103.ts
 */

const WORDPRESS_PAGE_ID = 2103;
const CHANGE_PACK_ID = "386ec34b-676b-4053-ac9f-8b2769c6d62d";

const BAD_MARKERS = ["Bajada editorial breve", "sin CTA fuerte", "no generada por Content Planner", "redactar manualmente", "brief de contenido"];

async function main(): Promise<void> {
  const changePack = findChangePackById(CHANGE_PACK_ID);
  if (!changePack) {
    console.log("Change pack no encontrado, abortando.");
    return;
  }
  const existingBlueprint = findLandingBlueprintByChangePackId(CHANGE_PACK_ID, readCurrentLandingBlueprints());
  if (!existingBlueprint) {
    console.log("Sin blueprint existente, abortando.");
    return;
  }

  const fields = extractPreviewFields(changePack);
  const blueprintInput = buildBlueprintInput(changePack);
  const blueprint = replaceLandingBlueprintContent(existingBlueprint.blueprintId, blueprintInput);
  if (!blueprint) {
    console.log("No se pudo regenerar el blueprint.");
    return;
  }

  const contentHtml = buildWordpressContentHtml(fields, blueprint);
  const qa = checkLandingQuality(contentHtml);
  const leaks = BAD_MARKERS.filter((m) => contentHtml.includes(m));
  const genericRepeats = (contentHtml.match(/cuentanos tu caso concreto/gi) || []).length;

  const before = await getWordpressPage(WORDPRESS_PAGE_ID);
  if (before.status !== "draft") {
    console.log(`Pagina ${WORDPRESS_PAGE_ID} ya no esta en draft (status="${before.status}") -- no se toca.`);
    return;
  }
  await updateWordpressDraftPage({ pageId: WORDPRESS_PAGE_ID, title: fields.title, contentHtml, excerpt: fields.metaDescription });

  console.log(`[OK] taquillas inteligentes (page ${WORDPRESS_PAGE_ID}) regenerado.`);
  console.log(`QA tecnico: ${qa.pass ? "PASA" : "FALLA"} (botones=${qa.buttonCount}, bloques=${qa.visualBlockCount})`);
  console.log(`Leaks: ${leaks.length ? leaks.join(";") : "ninguno"}. Relleno repetido: ${genericRepeats}.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
