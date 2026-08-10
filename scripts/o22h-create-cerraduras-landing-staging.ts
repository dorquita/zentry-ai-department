import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import {
  createWordpressDraftPage,
  updateWordpressDraftPage,
  getWordpressPage,
  getWordpressStatusForReport,
} from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

/**
 * O22.5 -- construye el HTML de la landing /cerraduras-para-taquillas/
 * a mano (bloques Gutenberg nativos, mismas convenciones que
 * o213-create-landing.ts de Bancos) y crea la pagina en STAGING como
 * DRAFT. NUNCA publica -- eso es scripts/o213-publish-landing.ts (ya
 * existente y generico via --pageId, reutilizado tal cual para esta
 * landing).
 *
 * O22.4 (imagenes IA) queda aplazada por decision de Pau -- esta
 * landing NO sube ni asocia ninguna media, usa placeholders/bloques
 * visuales neutros (grupo con borde discontinuo + icono decorativo)
 * en vez de wp:image. No toca /cerraduras/,
 * /cerraduras-inteligentes-taquillas/ ni /digitalizacion-taquillas/
 * (no se leen ni se enlazan en esta fase). No toca categorias ni
 * precios (solo enlaza a las fichas de producto ya creadas en O22.3,
 * sin leer ni mostrar su precio).
 *
 * Uso:
 *   npx ts-node scripts/o22h-create-cerraduras-landing-staging.ts                                     (dry-run: solo transforma y valida, no escribe)
 *   STAGING_EXECUTION_ENABLED=true WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o22h-create-cerraduras-landing-staging.ts --confirm
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

/** Bloque visual neutro (sin imagen real): grupo con borde discontinuo + icono decorativo, mismo alto que una tarjeta de producto. */
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
  // 4 tarjetas en 2 filas de 2 (wp:columns solo soporta una fila por bloque).
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

const STAGING_BASE = "https://staging.zentrylockers.com";
const SLUG = "cerraduras-para-taquillas";
const TITLE = "Cerraduras para taquillas";
const EXCERPT =
  "Cerraduras electrónicas para taquillas Zentry con tecnología Tukandado. Modelos ARES, ORBIS, BOXIS y NEO para proyectos B2B.";

const CTA_PRIMARY_TARGET = `${STAGING_BASE}/contacto/?origen=landing_cerraduras_para_taquillas&ubicacion=hero`;
const CTA_SECONDARY_TARGET = "#productos";
const CTA_FINAL_TARGET = `${STAGING_BASE}/contacto/?origen=landing_cerraduras_para_taquillas&ubicacion=cta_final`;

const PRODUCTS: ProductCard[] = [
  { name: "ARES", sku: "TKD-ARES", phrase: "Cerradura electrónica ARES, tecnología Tukandado.", permalink: `${STAGING_BASE}/product/ares/` },
  { name: "ORBIS", sku: "TKD-ORBIS", phrase: "Cerradura electrónica ORBIS, tecnología Tukandado.", permalink: `${STAGING_BASE}/product/orbis/` },
  { name: "BOXIS", sku: "TKD-BOXIS", phrase: "Cerradura electrónica BOXIS, tecnología Tukandado.", permalink: `${STAGING_BASE}/product/boxis/` },
  { name: "NEO", sku: "TKD-NEO", phrase: "Cerradura electrónica NEO, tecnología Tukandado.", permalink: `${STAGING_BASE}/product/neo/` },
];

function buildContentHtml(): string {
  const parts: string[] = [];

  // 1. Hero -- el titulo de la pagina en WordPress YA es el H1 (theme lo
  // renderiza como <h1 class="page-title">), asi que el hero del
  // contenido no repite el titular como encabezado -- solo subtitulo +
  // CTAs, mismo patron que la landing de Bancos (o213-create-landing.ts).
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

  // 2. Bloque explicacion -- diferencia electronicas vs mecanicas.
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

  // 3. Grid de 4 productos (sin precio, sin imagen real).
  parts.push(productGridBlock(PRODUCTS));

  // 4. Bloque comercial -- sin mencionar "40%".
  parts.push(`<h2>Precio y condiciones comerciales</h2>`);
  parts.push(
    `<p>Cada modelo tiene un PVP base. En proyectos B2B aplicamos descuentos comerciales según cantidad, tipo de integración y cliente. Cuéntanos tu proyecto y te preparamos un presupuesto ajustado.</p>`
  );

  // 5. Bloque integracion -- sin inventar compatibilidades tecnicas.
  parts.push(`<h2>Integración en tu proyecto</h2>`);
  parts.push(
    `<p>Estas cerraduras electrónicas se pueden montar en taquillas Zentry, o valorarse para integración en proyectos de taquillas ya existentes. Cuéntanos tu caso y te ayudamos a valorar la mejor solución.</p>`
  );

  // 6. CTA final.
  parts.push(`<h2>¿Hablamos de tu proyecto?</h2>`);
  parts.push(buttonBlock("Solicitar presupuesto de cerraduras para taquillas", CTA_FINAL_TARGET));

  return parts.join("\n\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const existingPageId = args.pageId ? Number(args.pageId) : undefined;
  const wpStatus = getWordpressStatusForReport();
  const backend = (() => {
    try {
      return resolveWordpressBackend();
    } catch {
      return "desconocido";
    }
  })();
  console.log(`WORDPRESS_DRAFTS_ENABLED=${wpStatus.enabled} BACKEND=${backend} ENV=${wpStatus.environment} configured=${wpStatus.configured}`);

  const contentHtml = buildContentHtml();
  console.log(`Longitud del contenido HTML: ${contentHtml.length} caracteres`);
  console.log(`Slug: ${SLUG} | Title: ${TITLE}`);
  console.log(`SEO sugerido (no aplicado via API -- pendiente de configurar manualmente en Yoast, igual que O21):`);
  console.log(`  SEO title: "Cerraduras para taquillas | Electrónicas Zentry/Tukandado"`);
  console.log(`  Meta description: "${EXCERPT}"`);
  console.log(`  Focus keyword: "cerraduras para taquillas"`);

  // Comprobacion de duplicados / backup antes de escribir nada.
  const existingCheck = (await fetch(`${STAGING_BASE}/wp-json/wp/v2/pages?slug=${SLUG}&_cb=${Date.now()}`).then((r) => r.json())) as Array<{
    id: number;
    status: string;
  }>;
  const backupPath = `data/o22h-landing-backup-${Date.now()}.json`;
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), existingStagingPagesWithSlug: existingCheck, contentHtml, title: TITLE, excerpt: EXCERPT }, null, 2)
  );
  console.log(`Backup/snapshot escrito: ${backupPath} (paginas staging existentes con este slug: ${existingCheck.length})`);
  if (existingCheck.length > 0 && !existingPageId) {
    throw new Error(
      `Ya existe una pagina en staging con slug "${SLUG}" (id ${existingCheck[0].id}, status ${existingCheck[0].status}). Si quieres actualizarla, repite con --pageId ${existingCheck[0].id}. Bloqueado -- no se crea un duplicado.`
    );
  }

  const canWrite = wpStatus.enabled && backend === "rest" && wpStatus.environment === "staging" && wpStatus.configured;
  if (!args.confirm || !canWrite) {
    console.log("\nSIMULACION (no se toca la red): falta --confirm y/o faltan condiciones de escritura. No se crea/actualiza ninguna pagina.");
    console.log("--- contenido generado (primeros 2000 caracteres) ---");
    console.log(contentHtml.slice(0, 2000));
    return;
  }

  const result = existingPageId
    ? await updateWordpressDraftPage({ pageId: existingPageId, title: TITLE, contentHtml, excerpt: EXCERPT })
    : await createWordpressDraftPage({ title: TITLE, contentHtml, excerpt: EXCERPT, slug: SLUG });

  console.log(existingPageId ? "\n--- BORRADOR ACTUALIZADO EN STAGING ---" : "\n--- BORRADOR CREADO EN STAGING ---");
  console.log(`wordpressDraftId: ${result.wordpressDraftId}`);
  console.log(`wordpressDraftUrl: ${result.wordpressDraftUrl}`);

  const verify = await getWordpressPage(result.wordpressDraftId);
  console.log("\n=== Verificacion post-creacion ===");
  console.log("status:", verify.status, "(esperado draft)");
  console.log("slug:", verify.link);

  const outPath = `data/o22h-landing-created-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ result, verify: { id: verify.id, status: verify.status, link: verify.link } }, null, 2));
  console.log(`\nGuardado en: ${outPath}`);

  console.log("\n=== Siguiente paso (aparte, con su propia confirmacion) ===");
  console.log(`npx ts-node scripts/o213-publish-landing.ts --pageId ${result.wordpressDraftId} --confirm`);
  console.log("\n=== Rollback (volver a borrador) ===");
  console.log(`npx ts-node scripts/o213-unpublish-landing.ts --pageId ${result.wordpressDraftId} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
