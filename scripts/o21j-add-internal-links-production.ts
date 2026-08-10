import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import {
  getProductionPage,
  updateProductionPublishedPageContent,
  getProductionStatusForReport,
  canAttemptProductionWrites,
} from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa J -- replica en PRODUCCION los enlaces internos hacia
 * /bancos-de-vestuario/ ya aprobados y verificados en staging (Fase
 * O21.4, scripts/o214-add-internal-links.ts + o214-add-sector-links.ts).
 * Mismo texto exacto, mismo mecanismo de insercion (append al final
 * para las 5 paginas de alta prioridad; insert justo antes del bloque
 * wp:buttons final para las 6 paginas de sector) -- unica diferencia es
 * el dominio del enlace (produccion, nunca staging) y los IDs de pagina
 * (produccion, ya confirmados iguales a staging para estas 11 paginas).
 * No toca productos, cerraduras, O19 ni theme/functions.php -- solo
 * contenido de pagina via REST, y solo estas 11 paginas.
 *
 * Uso:
 *   npx ts-node scripts/o21j-add-internal-links-production.ts                                     (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o21j-add-internal-links-production.ts --confirm
 */

const BANCOS_URL = "https://zentrylockers.com/bancos-de-vestuario/";
const APPEND_TEXT = `Completa tu vestuario con nuestros <a href="${BANCOS_URL}">bancos de vestuario</a>.`;
const SECTOR_SENTENCE = `También podemos completar el proyecto con <a href="${BANCOS_URL}">bancos de vestuario</a> a juego.`;

interface Target {
  pageId: number;
  slug: string;
  mode: "append" | "insert_before_buttons";
}

const TARGETS: Target[] = [
  { pageId: 22, slug: "taquillas", mode: "append" },
  { pageId: 1636, slug: "taquillas-por-sector", mode: "append" },
  { pageId: 108, slug: "taquillas-metalicas", mode: "append" },
  { pageId: 468, slug: "taquillas-fenolicas", mode: "append" },
  { pageId: 470, slug: "taquillas-melamina", mode: "append" },
  { pageId: 124, slug: "taquillas-para-gimnasios", mode: "insert_before_buttons" },
  { pageId: 127, slug: "taquillas-para-colegios", mode: "insert_before_buttons" },
  { pageId: 129, slug: "taquillas-para-empresas", mode: "insert_before_buttons" },
  { pageId: 1820, slug: "taquillas-para-centros-deportivos", mode: "insert_before_buttons" },
  { pageId: 1823, slug: "taquillas-para-industria", mode: "insert_before_buttons" },
  { pageId: 1822, slug: "taquillas-para-oficinas", mode: "insert_before_buttons" },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getProductionStatusForReport();
  console.log("wordpress-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const plan: Array<{ target: Target; title: string; excerpt: string; currentContent: string; newContent: string }> = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  const backupSnapshot: Array<{ pageId: number; slug: string; status: string; title: string; excerpt: string; contentHtml: string }> = [];

  for (const target of TARGETS) {
    const page = await getProductionPage(target.pageId);
    backupSnapshot.push({ pageId: target.pageId, slug: target.slug, status: page.status, title: page.title, excerpt: page.excerpt, contentHtml: page.contentHtml });

    if (page.status !== "publish") {
      skipped.push({ slug: target.slug, reason: `status \"${page.status}\", no \"publish\"` });
      console.log(`SKIP ${target.slug} (id ${target.pageId}): status \"${page.status}\".`);
      continue;
    }
    if (page.contentHtml.includes("bancos-de-vestuario")) {
      skipped.push({ slug: target.slug, reason: "ya contiene un enlace a bancos-de-vestuario" });
      console.log(`SKIP ${target.slug} (id ${target.pageId}): ya contiene un enlace a bancos-de-vestuario.`);
      continue;
    }

    let newContent: string;
    if (target.mode === "append") {
      const appendBlock = `\n\n<!-- wp:paragraph -->\n<p>${APPEND_TEXT}</p>\n<!-- /wp:paragraph -->`;
      newContent = page.contentHtml + appendBlock;
      console.log(`OK ${target.slug} (id ${target.pageId}): append al final (+${appendBlock.length} caracteres).`);
    } else {
      const insertIdx = page.contentHtml.lastIndexOf("<!-- wp:buttons -->");
      if (insertIdx === -1) {
        skipped.push({ slug: target.slug, reason: "no se encontro wp:buttons final" });
        console.log(`SKIP ${target.slug} (id ${target.pageId}): no se encontro un bloque wp:buttons final donde insertar de forma segura.`);
        continue;
      }
      const insertBlock = `<!-- wp:paragraph -->\n<p>${SECTOR_SENTENCE}</p>\n<!-- /wp:paragraph -->\n\n`;
      newContent = page.contentHtml.slice(0, insertIdx) + insertBlock + page.contentHtml.slice(insertIdx);
      console.log(`OK ${target.slug} (id ${target.pageId}): parrafo insertado justo antes del CTA final.`);
    }

    plan.push({ target, title: page.title, excerpt: page.excerpt, currentContent: page.contentHtml, newContent });
  }

  const backupPath = `data/o21j-links-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(backupSnapshot, null, 2));
  console.log(`\nBackup escrito: ${backupPath} (${backupSnapshot.length} paginas, contenido completo ANTES del cambio)`);
  console.log(`Plan: ${plan.length} paginas a actualizar, ${skipped.length} omitidas.`);

  if (plan.length === 0) {
    console.log("Nada que hacer.");
    return;
  }

  if (!confirm) {
    console.log("\nDry-run completo. Repite con --confirm (+ flags inline) para escribir de verdad.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion (pasa los flags inline en el comando).");
    process.exit(1);
    return;
  }

  const results: Array<{ slug: string; pageId: number; result?: { wordpressPageId: number; wordpressDraftUrl: string }; error?: string }> = [];
  for (const item of plan) {
    try {
      const result = await updateProductionPublishedPageContent({
        pageId: item.target.pageId,
        title: item.title,
        contentHtml: item.newContent,
        excerpt: item.excerpt,
      });
      console.log(`ACTUALIZADO: ${item.target.slug} (id ${result.wordpressPageId}) -> ${result.wordpressDraftUrl}`);
      results.push({ slug: item.target.slug, pageId: item.target.pageId, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FALLO en ${item.target.slug}:`, msg);
      results.push({ slug: item.target.slug, pageId: item.target.pageId, error: msg });
    }
  }

  const outPath = `data/o21j-links-updated-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ results, backupPath }, null, 2));
  console.log(`\nGuardado en: ${outPath}`);

  console.log("\n=== Rollback (restaura el contenido EXACTO previo de cada pagina) ===");
  console.log(`npx ts-node scripts/o21j-rollback-links-production.ts --backupFile ${backupPath} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
