import * as dotenv from "dotenv";
dotenv.config();
import { findChangePackById } from "../src/core/change-packs";
import { extractPreviewFields, buildWordpressContentHtml } from "../src/agents/wordpress-draft-agent";
import { buildBlueprintInput } from "../src/agents/ux-ui-landing-architect";
import { readCurrentLandingBlueprints, findLandingBlueprintByChangePackId, replaceLandingBlueprintContent } from "../src/core/landing-blueprints";
import { checkLandingQuality } from "../src/agents/staging-qa-agent";
import { updateWordpressDraftPage, getWordpressPage } from "../src/adapters/wordpress";

/**
 * Fase O28.3 -- regenera las 13 paginas de staging restantes (de las 21
 * del batch de O27.2) que todavia llevaban el motor de contenido/plantilla
 * anterior a las correcciones de O27.3-O28.2, usando el mismo motor ya
 * validado en 2097/2100 (patron de referencia aprobado por Pau):
 * meta description real, secciones especificas por material, FAQ real,
 * plantilla product_landing/sector_landing correcta, componentes visuales
 * "zentry-*" (hero a 2 columnas, tarjetas equilibradas, tabla comparativa,
 * grid de usos, proceso, CTA final centrado).
 *
 * Grupo A (leak solo en meta description): 2098, 2106, 2107, 2108, 2109,
 * 2110, 2111.
 * Grupo B (leak completo / plantilla blog_article rota): 2099, 2101,
 * 2102, 2103, 2104, 2105.
 *
 * Mismo patron que scripts/o274-regenerate-2097-2100.ts, ampliado a las
 * 13 paginas restantes. NUNCA toca produccion, NUNCA crea paginas nuevas
 * -- solo regenera contenido de borradores YA existentes en staging,
 * verificando `status: draft` antes de escribir en cada una.
 *
 * Uso: npx ts-node scripts/o283-regenerate-13-pages.ts
 */

interface Target {
  wordpressPageId: number;
  changePackId: string;
  keyword: string;
  group: "A" | "B";
}

const TARGETS: Target[] = [
  { wordpressPageId: 2098, changePackId: "5ac544c5-54a6-46f6-bb54-2cc9894804a4", keyword: "taquillas colegios", group: "A" },
  { wordpressPageId: 2106, changePackId: "17f7c707-cfb7-4039-84db-d5d138936301", keyword: "fenolicas con perfil", group: "A" },
  { wordpressPageId: 2107, changePackId: "b25751cb-244b-4faa-8ae9-8f85ceb96d7d", keyword: "industrial", group: "A" },
  { wordpressPageId: 2108, changePackId: "eb3b4452-f7bc-47af-8ad4-1cc25ca49d89", keyword: "oficina", group: "A" },
  { wordpressPageId: 2109, changePackId: "353d3c9d-b9a6-428e-a900-423236a95902", keyword: "colegio", group: "A" },
  { wordpressPageId: 2110, changePackId: "4e9134a4-09ff-44af-a4c9-707fc52da0ec", keyword: "universidad", group: "A" },
  { wordpressPageId: 2111, changePackId: "af35fa31-823e-4d8e-9312-6a6308721160", keyword: "hotel", group: "A" },
  { wordpressPageId: 2099, changePackId: "36f52336-4328-4b96-918a-bdd88ca35295", keyword: "taquilla para el personal", group: "B" },
  { wordpressPageId: 2101, changePackId: "3e7dfd91-d2c4-46f3-8460-b78c1851409a", keyword: "comprar taquillas", group: "B" },
  { wordpressPageId: 2102, changePackId: "fbe85ae4-6a91-4dc1-aaf0-47c536a2ead9", keyword: "soluciones de taquillas", group: "B" },
  { wordpressPageId: 2103, changePackId: "386ec34b-676b-4053-ac9f-8b2769c6d62d", keyword: "taquillas inteligentes", group: "B" },
  { wordpressPageId: 2104, changePackId: "abe0439c-f479-4c1b-ab83-85a77172f35b", keyword: "taquillas para vestuarios", group: "B" },
  { wordpressPageId: 2105, changePackId: "db77ad7d-8fd2-459c-8e0c-cd5627aa58dc", keyword: "metalicas taquillas", group: "B" },
];

const LEAK_MARKERS = [
  "Bajada editorial breve",
  "sin CTA fuerte",
  "no generada por Content Planner",
  "redactar manualmente",
  "brief de contenido",
];

async function main(): Promise<void> {
  let regenerated = 0;
  let failed = 0;
  const results: Array<{ id: number; keyword: string; group: string; qaPass: boolean; leaks: string[]; genericRepeats: number }> = [];

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
    const qa = checkLandingQuality(contentHtml);
    const leaks = LEAK_MARKERS.filter((marker) => contentHtml.includes(marker));
    const genericRepeats = (contentHtml.match(/cuentanos tu caso concreto/gi) || []).length;

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
      results.push({ id: target.wordpressPageId, keyword: target.keyword, group: target.group, qaPass: qa.pass, leaks, genericRepeats });
      console.log(
        `[OK] Grupo ${target.group} -- ${target.keyword} (page ${target.wordpressPageId}) regenerado. QA: ${qa.pass ? "PASA" : "FALLA"} (botones=${qa.buttonCount}, bloques=${qa.visualBlockCount}). Leaks: ${leaks.length ? leaks.join(";") : "ninguno"}. Relleno repetido: ${genericRepeats}.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[FAIL] ${target.keyword} (page ${target.wordpressPageId}): ${message}`);
      failed += 1;
    }
  }

  console.log(`\nRegenerados: ${regenerated}. Fallidos: ${failed}.`);
  const withLeaks = results.filter((r) => r.leaks.length > 0 || r.genericRepeats > 0);
  const qaFailed = results.filter((r) => !r.qaPass);
  console.log(`Con leaks restantes: ${withLeaks.length}. Con QA tecnico fallido: ${qaFailed.length}.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
