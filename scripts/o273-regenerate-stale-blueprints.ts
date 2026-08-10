import * as dotenv from "dotenv";
dotenv.config();
import { findChangePackById } from "../src/core/change-packs";
import { extractPreviewFields, buildWordpressContentHtml } from "../src/agents/wordpress-draft-agent";
import { buildBlueprintInput } from "../src/agents/ux-ui-landing-architect";
import { readCurrentLandingBlueprints, findLandingBlueprintByChangePackId, replaceLandingBlueprintContent } from "../src/core/landing-blueprints";
import { checkLandingQuality } from "../src/agents/staging-qa-agent";
import { updateWordpressDraftPage, getWordpressPage } from "../src/adapters/wordpress";
import { logger } from "../src/core/logger";

/**
 * Fase O27.3 -- regenera el contenido de los borradores de STAGING
 * afectados por el bug real encontrado en la auditoria visual: el
 * `structure` que genera Content Planner viene en notacion de esquema
 * editorial ("H2: pregunta", "H3: comparativa"), pensada para que un
 * humano la lea como guion -- nunca como texto final. El blueprint de
 * estas 15 paginas se genero el 2026-08-05, ANTES del fix de
 * `extractPreviewFields()` (Fase O27.3) que quita ese prefijo, asi que
 * llevaban el "H2: "/"H3: " literal grabado en el titular Y el mismo
 * parrafo generico repetido bajo cada seccion.
 *
 * Este script SOLO toca STAGING (`updateWordpressDraftPage`, nunca
 * produccion) y SOLO borradores YA `draft` (nunca publicados) -- mismo
 * patron que `redesign-production-draft-1960.ts` (Fase O13.6c), pero
 * generalizado a staging para las 15 paginas de este batch en vez de una
 * unica pagina de produccion.
 *
 * Uso: npx ts-node scripts/o273-regenerate-stale-blueprints.ts
 */

interface Target {
  wordpressPageId: number;
  changePackId: string;
  keyword: string;
}

const TARGETS: Target[] = [
  { wordpressPageId: 2097, changePackId: "d4a5d3ac-7ba1-4909-be69-8838d288aa8d", keyword: "taquillas melamina" },
  { wordpressPageId: 2098, changePackId: "5ac544c5-54a6-46f6-bb54-2cc9894804a4", keyword: "taquillas colegios" },
  { wordpressPageId: 2099, changePackId: "36f52336-4328-4b96-918a-bdd88ca35295", keyword: "taquilla para el personal" },
  { wordpressPageId: 2100, changePackId: "817527bd-7305-4e95-96ab-f2234a0ff294", keyword: "taquillas fenólicas en palencia" },
  { wordpressPageId: 2101, changePackId: "3e7dfd91-d2c4-46f3-8460-b78c1851409a", keyword: "comprar taquillas" },
  { wordpressPageId: 2102, changePackId: "fbe85ae4-6a91-4dc1-aaf0-47c536a2ead9", keyword: "soluciones de taquillas" },
  { wordpressPageId: 2103, changePackId: "386ec34b-676b-4053-ac9f-8b2769c6d62d", keyword: "taquillas inteligentes" },
  { wordpressPageId: 2104, changePackId: "abe0439c-f479-4c1b-ab83-85a77172f35b", keyword: "taquillas para vestuarios" },
  { wordpressPageId: 2105, changePackId: "db77ad7d-8fd2-459c-8e0c-cd5627aa58dc", keyword: "metalicas taquillas" },
  { wordpressPageId: 2106, changePackId: "17f7c707-cfb7-4039-84db-d5d138936301", keyword: "fenolicas con perfil" },
  { wordpressPageId: 2107, changePackId: "b25751cb-244b-4faa-8ae9-8f85ceb96d7d", keyword: "industrial" },
  { wordpressPageId: 2108, changePackId: "eb3b4452-f7bc-47af-8ad4-1cc25ca49d89", keyword: "oficina" },
  { wordpressPageId: 2109, changePackId: "353d3c9d-b9a6-428e-a900-423236a95902", keyword: "colegio" },
  { wordpressPageId: 2110, changePackId: "4e9134a4-09ff-44af-a4c9-707fc52da0ec", keyword: "universidad" },
  { wordpressPageId: 2111, changePackId: "af35fa31-823e-4d8e-9312-6a6308721160", keyword: "hotel" },
];

async function main(): Promise<void> {
  let regenerated = 0;
  let failed = 0;
  let stillHasIssue = 0;

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

    // Regenerar el blueprint con extractPreviewFields() YA CORREGIDO
    // (quita el prefijo "H2: "/"H3: " y, al recalcular sections desde
    // cero, usa buildSectionBody() -- texto real por seccion en vez del
    // clusterNote generico repetido).
    const fields = extractPreviewFields(changePack);
    const blueprintInput = buildBlueprintInput(changePack);
    const blueprint = replaceLandingBlueprintContent(existingBlueprint.blueprintId, blueprintInput);
    if (!blueprint) {
      console.log(`[FAIL] ${target.keyword}: no se pudo regenerar el blueprint.`);
      failed += 1;
      continue;
    }

    const hasLiteralHeading = blueprint.sections.some((s) => /^H[1-3]:/i.test(s.heading));
    if (hasLiteralHeading) stillHasIssue += 1;

    const contentHtml = buildWordpressContentHtml(fields, blueprint);
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
        `[OK] ${target.keyword} (page ${target.wordpressPageId}) regenerado. QA visual: ${qa.pass ? "PASA" : "FALLA"} (botones=${qa.buttonCount}, bloques=${qa.visualBlockCount}, H1=${qa.h1Count}, H2=${qa.h2Count}, contenido=${qa.contentLength} caracteres). Heading con prefijo literal: ${hasLiteralHeading ? "SI (revisar)" : "no"}.`
      );
      logger.info("O27.3: borrador de staging regenerado tras fix de blueprint", {
        wordpressPageId: target.wordpressPageId,
        changePackId: target.changePackId,
        qaPass: qa.pass,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[FAIL] ${target.keyword} (page ${target.wordpressPageId}): ${message}`);
      failed += 1;
    }
  }

  console.log(`\nRegenerados: ${regenerated}. Fallidos: ${failed}. Con heading "H2:"/"H3:" literal tras el fix: ${stillHasIssue}.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
