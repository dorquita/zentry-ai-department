import * as dotenv from "dotenv";
dotenv.config();
import { findChangePackById } from "../src/core/change-packs";
import { extractPreviewFields, buildWordpressContentHtml } from "../src/agents/wordpress-draft-agent";
import { buildBlueprintInput } from "../src/agents/ux-ui-landing-architect";
import { readCurrentLandingBlueprints, findLandingBlueprintByChangePackId, replaceLandingBlueprintContent } from "../src/core/landing-blueprints";
import { checkLandingQuality } from "../src/agents/staging-qa-agent";
import { updateWordpressDraftPage, getWordpressPage } from "../src/adapters/wordpress";

/**
 * Fase O27.4 -- regenera SOLO las 2 paginas de staging (2097, 2100)
 * afectadas por el bug real encontrado en la revision visual de Pau: la
 * plantilla "blog_article" (src/core/visual-templates.ts) tenia una nota
 * para quien programa en vez de copy real en subheadlinePattern/ctaLabel
 * ("Bajada editorial breve..." / "(sin CTA fuerte...)"), y se colaba
 * literal en el subtitulo/boton del hero. Ya corregido en el codigo --
 * este script solo regenera el contenido YA aplicado con esa plantilla
 * rota. Mismo patron que scripts/o273-regenerate-stale-blueprints.ts,
 * pero acotado a estas 2 paginas (las unicas con el defecto).
 *
 * Uso: npx ts-node scripts/o274-regenerate-2097-2100.ts
 */

interface Target {
  wordpressPageId: number;
  changePackId: string;
  keyword: string;
}

const TARGETS: Target[] = [
  { wordpressPageId: 2097, changePackId: "d4a5d3ac-7ba1-4909-be69-8838d288aa8d", keyword: "taquillas melamina" },
  { wordpressPageId: 2100, changePackId: "817527bd-7305-4e95-96ab-f2234a0ff294", keyword: "taquillas fenólicas en palencia" },
];

const LEAKED_INSTRUCTION_MARKERS = [
  "Bajada editorial breve",
  "sin CTA fuerte en el hero",
];

async function main(): Promise<void> {
  let regenerated = 0;
  let failed = 0;
  let stillLeaking = 0;

  for (const target of TARGETS) {
    const changePack = findChangePackById(target.changePackId);
    if (!changePack) {
      console.log(`[SKIP] ${target.keyword}: change pack ${target.changePackId} no encontrado.`);
      failed += 1;
      continue;
    }

    const existingBlueprint = findLandingBlueprintByChangePackId(target.changePackId, readCurrentLandingBlueprints());
    if (!existingBlueprint) {
      console.log(`[SKIP] ${target.keyword}: sin blueprint existente.`);
      failed += 1;
      continue;
    }

    const fields = extractPreviewFields(changePack);
    const blueprintInput = buildBlueprintInput(changePack);
    const blueprint = replaceLandingBlueprintContent(existingBlueprint.blueprintId, blueprintInput);
    if (!blueprint) {
      console.log(`[FAIL] ${target.keyword}: no se pudo regenerar el blueprint.`);
      failed += 1;
      continue;
    }

    const contentHtml = buildWordpressContentHtml(fields, blueprint);
    const hasLeak = LEAKED_INSTRUCTION_MARKERS.some((marker) => contentHtml.includes(marker));
    if (hasLeak) stillLeaking += 1;

    const qa = checkLandingQuality(contentHtml);

    try {
      const before = await getWordpressPage(target.wordpressPageId);
      if (before.status !== "draft") {
        console.log(`[SKIP] ${target.keyword}: pagina ${target.wordpressPageId} ya no esta en draft (status="${before.status}") -- no se toca.`);
        continue;
      }
      await updateWordpressDraftPage({
        pageId: target.wordpressPageId,
        title: fields.title,
        contentHtml,
        excerpt: fields.metaDescription,
      });
      regenerated += 1;
      console.log(
        `[OK] ${target.keyword} (page ${target.wordpressPageId}) regenerado. QA visual: ${qa.pass ? "PASA" : "FALLA"} (botones=${qa.buttonCount}, bloques=${qa.visualBlockCount}). Instruccion interna filtrada: ${hasLeak ? "SI (revisar)" : "no"}.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[FAIL] ${target.keyword} (page ${target.wordpressPageId}): ${message}`);
      failed += 1;
    }
  }

  console.log(`\nRegenerados: ${regenerated}. Fallidos: ${failed}. Con instruccion interna filtrada tras el fix: ${stillLeaking}.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
