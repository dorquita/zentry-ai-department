import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { createProductionDraftPage, getProductionPage, getProductionStatusForReport } from "../src/adapters/wordpress-production";
import { findProductionProductBySlug } from "../src/adapters/woocommerce-production";

/**
 * O22 Ajuste -- Etapa C (produccion) -- crea la landing
 * /cerraduras-para-taquillas/ en produccion como DRAFT
 * (createProductionDraftPage() siempre fuerza status:draft, nunca
 * publica). Contenido identico al ya validado en staging (pagina 2067,
 * ver o22h-create-cerraduras-landing-staging.ts), con las URLs de los 4
 * productos remapeadas al dominio de produccion. No hay imagenes que
 * remapear (la landing usa placeholders neutros, O22.4 sigue aplazada).
 *
 * Etapa D (publicar de verdad) es DELIBERADAMENTE manual -- este script
 * NUNCA publica. Pau publica el borrador el mismo desde wp-admin, igual
 * que se hizo con la landing de Bancos (pagina 2042).
 *
 * Uso:
 *   npx ts-node scripts/o22l-create-cerraduras-landing-production.ts                                     (dry-run: valida contenido y duplicados, no escribe)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o22l-create-cerraduras-landing-production.ts --confirm
 */

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buttonBlock(label: string, target: string): string {
  return [
    `<!-- wp:buttons -->`,
    `<div class="wp-block-buttons"><!-- wp:button -->`,
    `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${esc(target)}">${esc(label)}</a></div>`,
    `<!-- /wp:button --></div>`,
    `<!-- /wp:buttons -->`,
  ].join("\n");
}

function outlineButtonBlock(label: string, target: string): string {
  return [
    `<!-- wp:buttons -->`,
    `<div class="wp-block-buttons"><!-- wp:button {"className":"is-style-outline"} -->`,
    `<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="${esc(target)}">${esc(label)}</a></div>`,
    `<!-- /wp:button --></div>`,
    `<!-- /wp:buttons -->`,
  ].join("\n");
}

function placeholderBlock(label: string): string {
  return [
    `<!-- wp:group {"style":{"border":{"width":"1px","style":"dashed"},"spacing":{"padding":{"top":"48px","bottom":"48px"}}},"layout":{"type":"constrained"}} -->`,
    `<div class="wp-block-group" style="border-style:dashed;border-width:1px;padding-top:48px;padding-bottom:48px">`,
    `<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"32px"}}} -->`,
    `<p class="has-text-align-center" style="font-size:32px">🔒</p>`,
    `<!-- /wp:paragraph -->`,
    `<!-- wp:paragraph {"align":"center"} -->`,
    `<p class="has-text-align-center">${esc(label)}</p>`,
    `<!-- /wp:paragraph -->`,
    `</div>`,
    `<!-- /wp:group -->`,
  ].join("\n");
}

interface ProductCard {
  name: string;
  sku: string;
  phrase: string;
  permalink: string;
}

function productGridBlock(products: ProductCard[]): string {
  const rows: ProductCard[][] = [];
  for (let i = 0; i < products.length; i += 2) rows.push(products.slice(i, i + 2));

  const rowsHtml = rows
    .map((row) => {
      const columns = row
        .map((p) =>
          [
            `<!-- wp:column -->`,
            `<div class="wp-block-column">`,
            placeholderBlock(p.name),
            `<h3>${esc(p.name)}</h3>`,
            `<p><strong>SKU:</strong> ${esc(p.sku)}</p>`,
            `<p>${esc(p.phrase)}</p>`,
            outlineButtonBlock("Ver ficha", p.permalink),
            `</div>`,
            `<!-- /wp:column -->`,
          ].join("\n")
        )
        .join("\n");
      return [`<!-- wp:columns -->`, `<div class="wp-block-columns">`, columns, `</div>`, `<!-- /wp:columns -->`].join("\n");
    })
    .join("\n\n");

  return `<h2 id="productos">Modelos de cerraduras electrónicas</h2>\n\n${rowsHtml}`;
}

const PRODUCTION_BASE = "https://zentrylockers.com";
const SLUG = "cerraduras-para-taquillas";
const TITLE = "Cerraduras para taquillas";
const EXCERPT =
  "Cerraduras electrónicas para taquillas Zentry con tecnología Tukandado. Modelos ARES, ORBIS, BOXIS y NEO para proyectos B2B.";

const CTA_PRIMARY_TARGET = `${PRODUCTION_BASE}/contacto/?origen=landing_cerraduras_para_taquillas&ubicacion=hero`;
const CTA_SECONDARY_TARGET = "#productos";
const CTA_FINAL_TARGET = `${PRODUCTION_BASE}/contacto/?origen=landing_cerraduras_para_taquillas&ubicacion=cta_final`;

const PRODUCT_SLUGS = [
  { name: "ARES", sku: "TKD-ARES", slug: "ares" },
  { name: "ORBIS", sku: "TKD-ORBIS", slug: "orbis" },
  { name: "BOXIS", sku: "TKD-BOXIS", slug: "boxis" },
  { name: "NEO", sku: "TKD-NEO", slug: "neo" },
];

function buildContentHtml(products: ProductCard[]): string {
  const parts: string[] = [];

  parts.push(
    `<p><strong>Cerraduras electrónicas compatibles con taquillas Zentry, con tecnología Tukandado.</strong></p>`
  );
  parts.push(
    [
      `<!-- wp:buttons -->`,
      `<div class="wp-block-buttons">`,
      `<!-- wp:button -->`,
      `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${esc(CTA_PRIMARY_TARGET)}">Solicitar presupuesto</a></div>`,
      `<!-- /wp:button -->`,
      `<!-- wp:button {"className":"is-style-outline"} -->`,
      `<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="${esc(CTA_SECONDARY_TARGET)}">Ver modelos</a></div>`,
      `<!-- /wp:button -->`,
      `</div>`,
      `<!-- /wp:buttons -->`,
    ].join("\n")
  );

  parts.push(`<h2>Dos familias de cerraduras</h2>`);
  parts.push(
    `<p>En Zentry, junto con la tecnología Tukandado, organizamos las cerraduras para taquillas en dos familias:</p>`
  );
  parts.push(
    [
      `<!-- wp:list -->`,
      `<ul class="wp-block-list">`,
      `<li><strong>Cerraduras electrónicas:</strong> ARES, ORBIS, BOXIS y NEO, con tecnología Tukandado.</li>`,
      `<li><strong>Cerraduras mecánicas:</strong> línea pendiente de definir.</li>`,
      `</ul>`,
      `<!-- /wp:list -->`,
    ].join("\n")
  );

  parts.push(productGridBlock(products));

  parts.push(`<h2>Precio y condiciones comerciales</h2>`);
  parts.push(
    `<p>Cada modelo tiene un PVP base. En proyectos B2B aplicamos descuentos comerciales según cantidad, tipo de integración y cliente. Cuéntanos tu proyecto y te preparamos un presupuesto ajustado.</p>`
  );

  parts.push(`<h2>Integración en tu proyecto</h2>`);
  parts.push(
    `<p>Estas cerraduras electrónicas se pueden montar en taquillas Zentry, o valorarse para integración en proyectos de taquillas ya existentes. Cuéntanos tu caso y te ayudamos a valorar la mejor solución.</p>`
  );

  parts.push(`<h2>¿Hablamos de tu proyecto?</h2>`);
  parts.push(buttonBlock("Solicitar presupuesto de cerraduras para taquillas", CTA_FINAL_TARGET));

  return parts.join("\n\n");
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getProductionStatusForReport();
  console.log("wordpress-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  console.log("\nResolviendo permalinks reales de los 4 productos en produccion...");
  const products: ProductCard[] = [];
  for (const p of PRODUCT_SLUGS) {
    const found = await findProductionProductBySlug(p.slug);
    if (!found) {
      throw new Error(
        `Producto "${p.slug}" no encontrado en produccion. Ejecuta primero o22k-create-cerraduras-electronicas-products-production.ts --confirm.`
      );
    }
    const permalink = `${PRODUCTION_BASE}/product/${found.slug}/`;
    console.log(`  ${p.name}: id ${found.id}, slug ${found.slug} -> ${permalink}`);
    products.push({ name: p.name, sku: p.sku, phrase: `Cerradura electrónica ${p.name}, tecnología Tukandado.`, permalink });
  }

  const contentHtml = buildContentHtml(products);
  console.log(`\nLongitud del contenido HTML: ${contentHtml.length} caracteres`);

  const existingCheck = (await fetch(`${PRODUCTION_BASE}/wp-json/wp/v2/pages?slug=${SLUG}&_cb=${Date.now()}`).then((r) => r.json())) as Array<{
    id: number;
    status: string;
  }>;
  const backupPath = `data/o22l-landing-backup-${Date.now()}.json`;
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), existingProductionPagesWithSlug: existingCheck, contentHtml, title: TITLE, excerpt: EXCERPT }, null, 2)
  );
  console.log(`Backup/snapshot escrito: ${backupPath} (paginas produccion existentes con este slug: ${existingCheck.length})`);
  if (existingCheck.length > 0) {
    throw new Error(
      `Ya existe una pagina en produccion con slug "${SLUG}" (id ${existingCheck[0].id}, status ${existingCheck[0].status}). Bloqueado -- no se crea un duplicado.`
    );
  }

  if (!confirm) {
    console.log("\nDry-run completo -- contenido validado (permalinks reales, sin duplicados). Repite con --confirm (+ flags inline) para crear el draft de verdad.");
    return;
  }

  const created = await createProductionDraftPage({ title: TITLE, contentHtml, excerpt: EXCERPT, slug: SLUG });
  console.log("\n=== Draft creado en PRODUCCION ===");
  console.log(JSON.stringify(created, null, 2));

  const verify = await getProductionPage(created.wordpressPageId);
  console.log("\n=== Verificacion post-creacion ===");
  console.log("status:", verify.status, "(esperado draft)");
  console.log("slug:", verify.slug, "(esperado", SLUG, ")");

  const outPath = `data/o22l-landing-created-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ created, verify: { id: verify.id, status: verify.status, slug: verify.slug, link: verify.link } }, null, 2));
  console.log(`\nGuardado en: ${outPath}`);

  console.log("\n=== SIGUIENTE PASO: Etapa D (manual, por Pau) ===");
  console.log(`Publicar el borrador ${created.wordpressPageId} desde wp-admin de produccion. Este script NUNCA publica.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
