import * as dotenv from "dotenv";
dotenv.config();
import { createWordpressDraftPage, updateWordpressDraftPage, getWordpressStatusForReport } from "../src/adapters/wordpress";
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
 * O21.3 -- construye el HTML de la landing /bancos-de-vestuario/ a mano
 * (bloques Gutenberg nativos, mismas convenciones que
 * wordpress-draft-agent.ts/fix-published-page-1960.ts) y crea la pagina
 * en STAGING como DRAFT. NUNCA publica -- eso es un paso aparte,
 * deliberadamente separado (scripts/o213-publish-landing.ts), con su
 * propia confirmacion explicita.
 *
 * No se fuerza esta landing dentro de landing-blueprints.ts: ese
 * registro exige un changePackId real de contenido de blog, y esta
 * landing es de producto/WooCommerce, sin change pack detras -- misma
 * razon de diseno que llevo a crear product-asset-requests.ts como
 * registro separado en la Fase O21.2a.
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

function imageBlock(mediaId: number, url: string, alt: string, className = ""): string {
  const cls = className ? ` ${className}` : "";
  const attrs = className
    ? `{"id":${mediaId},"sizeSlug":"large","linkDestination":"none","className":"${className}"}`
    : `{"id":${mediaId},"sizeSlug":"large","linkDestination":"none"}`;
  return [
    `<!-- wp:image ${attrs} -->`,
    `<figure class="wp-block-image size-large${cls}"><img src="${esc(url)}" alt="${esc(alt)}" class="wp-image-${mediaId}"/></figure>`,
    `<!-- /wp:image -->`,
  ].join("\n");
}

interface FamilyCard {
  title: string;
  description: string;
  mediaId: number;
  imageUrl: string;
  alt: string;
  link: string;
}

function familyCardsBlock(cards: FamilyCard[]): string {
  const columns = cards
    .map((c) =>
      [
        `<!-- wp:column -->`,
        `<div class="wp-block-column">`,
        imageBlock(c.mediaId, c.imageUrl, c.alt),
        `<h3>${esc(c.title)}</h3>`,
        `<p>${esc(c.description)}</p>`,
        `<p><a href="${esc(c.link)}">Ver ${esc(c.title.toLowerCase())} &rarr;</a></p>`,
        `</div>`,
        `<!-- /wp:column -->`,
      ].join("\n")
    )
    .join("\n");
  return [`<!-- wp:columns -->`, `<div class="wp-block-columns">`, columns, `</div>`, `<!-- /wp:columns -->`].join("\n");
}

interface ConfigItem {
  title: string;
  description: string;
}

function configColumnsBlock(items: ConfigItem[]): string {
  const columns = items
    .map(
      (item) =>
        `<!-- wp:column -->\n<div class="wp-block-column"><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></div>\n<!-- /wp:column -->`
    )
    .join("\n");
  return [`<!-- wp:columns -->`, `<div class="wp-block-columns">`, columns, `</div>`, `<!-- /wp:columns -->`].join("\n");
}

interface ProductCard {
  name: string;
  mediaId: number;
  imageUrl: string;
  alt: string;
  permalink: string;
}

function productGridBlock(products: ProductCard[]): string {
  // 3 columnas x 3 filas -- wp:columns solo soporta una fila de columnas
  // por bloque, asi que se generan 3 bloques wp:columns consecutivos.
  const rows: ProductCard[][] = [];
  for (let i = 0; i < products.length; i += 3) rows.push(products.slice(i, i + 3));

  const rowsHtml = rows
    .map((row) => {
      const columns = row
        .map((p) =>
          [
            `<!-- wp:column -->`,
            `<div class="wp-block-column">`,
            imageBlock(p.mediaId, p.imageUrl, p.alt),
            `<h4>${esc(p.name)}</h4>`,
            outlineButtonBlock("Ver ficha", p.permalink),
            `</div>`,
            `<!-- /wp:column -->`,
          ].join("\n")
        )
        .join("\n");
      return [`<!-- wp:columns -->`, `<div class="wp-block-columns">`, columns, `</div>`, `<!-- /wp:columns -->`].join("\n");
    })
    .join("\n\n");

  return `<h2 id="productos">Los 9 modelos de la gama</h2>\n\n${rowsHtml}`;
}

function faqBlock(items: Array<{ question: string; answer: string }>): string {
  const parts: string[] = [`<h2>Preguntas frecuentes</h2>`];
  for (const item of items) {
    parts.push(`<h3>${esc(item.question)}</h3>`);
    parts.push(`<p>${esc(item.answer)}</p>`);
  }
  return parts.join("\n");
}

function bulletListBlock(heading: string, items: string[]): string {
  const lis = items.map((i) => `<li>${esc(i)}</li>`).join("\n");
  return [`<h2>${esc(heading)}</h2>`, `<!-- wp:list -->`, `<ul class="wp-block-list">`, lis, `</ul>`, `<!-- /wp:list -->`].join("\n");
}

function linkListBlock(paragraph: string, links: Array<{ label: string; url: string }>): string {
  const lis = links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join("\n");
  return [
    `<h2>Combina bancos y taquillas Zentry</h2>`,
    `<p>${esc(paragraph)}</p>`,
    `<!-- wp:list -->`,
    `<ul class="wp-block-list">`,
    lis,
    `</ul>`,
    `<!-- /wp:list -->`,
  ].join("\n");
}

const HERO_IMAGE = { id: 2047, url: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/bancos-vestuario-hero-zentry-16x9-1.webp" };

const FAMILY_CARDS: FamilyCard[] = [
  {
    title: "Bancos de pino",
    description: "Acabado calido y tradicional para vestuarios, colegios, clubes y espacios deportivos.",
    mediaId: 2043,
    imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/bancos-pino-familia-zentry.webp",
    alt: "Gama de bancos de vestuario de pino Zentry",
    link: "https://staging.zentrylockers.com/product-category/bancos-de-vestuario/bancos-de-pino/",
  },
  {
    title: "Bancos fenolicos",
    description: "Opcion tecnica y resistente para entornos de uso intensivo.",
    mediaId: 2044,
    imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/bancos-fenolicos-familia-zentry.webp",
    alt: "Gama de bancos de vestuario fenolicos Zentry",
    link: "https://staging.zentrylockers.com/product-category/bancos-de-vestuario/bancos-de-fenolicos/",
  },
  {
    title: "Bancos de melamina",
    description: "Solucion limpia y versatil para oficinas, empresas, colegios y vestuarios interiores.",
    mediaId: 2046,
    imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/bancos-melamina-familia-zentry-1.webp",
    alt: "Gama de bancos de vestuario de melamina Zentry",
    link: "https://staging.zentrylockers.com/product-category/bancos-de-vestuario/bancos-de-melamina/",
  },
];

const CONFIG_ITEMS: ConfigItem[] = [
  { title: "Banco simple", description: "Solo asiento sobre estructura de patas: la opcion mas compacta para zonas de paso o espacios reducidos." },
  { title: "Banco con respaldo y perchero", description: "Anade respaldo y una barra de ganchos superior para colgar ropa mientras se usa el vestuario." },
  { title: "Banco con respaldo, perchero y zapatero", description: "La configuracion mas completa: respaldo, perchero y una balda inferior para dejar el calzado." },
];

const PRODUCTS: ProductCard[] = [
  { name: "Banco de vestuario de pino", mediaId: 2021, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-pino-principal.webp", alt: "Banco de vestuario de pino Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-pino/" },
  { name: "Banco de vestuario de pino con perchero", mediaId: 2027, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-pino-perchero-principal.webp", alt: "Banco de vestuario de pino con respaldo y perchero Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-pino-perchero/" },
  { name: "Banco de vestuario de pino con zapatero", mediaId: 2028, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-pino-zapatero-principal.webp", alt: "Banco de vestuario de pino con respaldo, perchero y zapatero Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-pino-zapatero/" },
  { name: "Banco de vestuario fenolico", mediaId: 2029, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-fenolico-principal.webp", alt: "Banco de vestuario fenolico Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-fenolico/" },
  { name: "Banco de vestuario fenolico con perchero", mediaId: 2024, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-fenolico-perchero-principal-v2.webp", alt: "Banco de vestuario fenolico con respaldo y perchero Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-fenolico-perchero/" },
  { name: "Banco de vestuario fenolico con zapatero", mediaId: 2030, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-fenolico-zapatero-principal.webp", alt: "Banco de vestuario fenolico con respaldo, perchero y zapatero Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-fenolico-zapatero/" },
  { name: "Banco de vestuario de melamina", mediaId: 2031, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-melamina-principal.webp", alt: "Banco de vestuario de melamina Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-melamina/" },
  { name: "Banco de vestuario de melamina con perchero", mediaId: 2032, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-melamina-perchero-principal.webp", alt: "Banco de vestuario de melamina con respaldo y perchero Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-melamina-perchero/" },
  { name: "Banco de vestuario de melamina con zapatero", mediaId: 2025, imageUrl: "https://staging.zentrylockers.com/wp-content/uploads/2026/08/banco-vestuario-melamina-zapatero-principal-v2.webp", alt: "Banco de vestuario de melamina con respaldo, perchero y zapatero Zentry", permalink: "https://staging.zentrylockers.com/product/banco-vestuario-melamina-zapatero/" },
];

const SECTORS = ["Gimnasios", "Colegios", "Empresas", "Centros deportivos", "Hospitales", "Coworkings", "Vestuarios industriales"];

const FAQ = [
  { question: "Que tipos de bancos de vestuario hay", answer: "En Zentry ofrecemos bancos de vestuario en tres materiales -- pino, fenolico y melamina -- y en tres configuraciones: banco simple, banco con respaldo y perchero, y banco con respaldo, perchero y zapatero." },
  { question: "Que material elegir", answer: "El pino aporta un acabado calido y tradicional; el fenolico es la opcion tecnica y resistente para uso intensivo; la melamina ofrece un acabado limpio y versatil para oficinas, colegios y vestuarios interiores." },
  { question: "Que longitudes estan disponibles", answer: "Los bancos se fabrican en diferentes longitudes y configuraciones para adaptarse a la zona de taquillas o vestuario disponible. Consultanos tu medida exacta y te preparamos presupuesto." },
  { question: "Se pueden combinar con taquillas", answer: "Si. Los bancos de vestuario Zentry se disenan para combinarse con nuestras taquillas metalicas, fenolicas y de melamina y crear una solucion completa de vestuario." },
  { question: "Como solicitar presupuesto", answer: "Pulsa en \"Solicitar presupuesto\" en cualquier punto de esta pagina o en la ficha de cada banco, y cuentanos material, configuracion, cantidad y longitud deseada. Te responderemos con precio y plazos." },
];

const LOCKER_LINKS = [
  { label: "Taquillas metalicas", url: "https://staging.zentrylockers.com/taquillas-metalicas/" },
  { label: "Taquillas fenolicas", url: "https://staging.zentrylockers.com/taquillas-fenolicas/" },
  { label: "Taquillas de melamina", url: "https://staging.zentrylockers.com/taquillas-melamina/" },
  { label: "Taquillas por sector", url: "https://staging.zentrylockers.com/taquillas-por-sector/" },
];

const CTA_PRIMARY_TARGET = "https://staging.zentrylockers.com/contacto/?origen=landing_bancos_vestuario&ubicacion=hero";
const CTA_SECONDARY_TARGET = "#productos";

function buildContentHtml(): string {
  const parts: string[] = [];

  // 1. Hero -- el titulo de la pagina en WordPress YA es este mismo
  // texto (theme lo renderiza como <h1 class="page-title">), asi que el
  // hero del contenido NO repite el titular como <h2> (evita el mismo
  // bug de encabezado duplicado ya corregido en la pagina 1960) -- solo
  // aporta el subtitular, la imagen y los CTAs.
  parts.push(
    `<p><strong>Bancos de vestuario en pino, fenolico y melamina, disponibles en diferentes longitudes y configuraciones para completar zonas de taquillas, vestuarios y espacios colectivos.</strong></p>`
  );
  parts.push(imageBlock(HERO_IMAGE.id, HERO_IMAGE.url, "Bancos de vestuario Zentry en instalacion deportiva", "hero-image"));
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

  // 2. Familias
  parts.push(`<h2>Tres materiales, una misma gama</h2>`);
  parts.push(familyCardsBlock(FAMILY_CARDS));

  // 3. Configuraciones
  parts.push(`<h2>Tres configuraciones, para cada necesidad</h2>`);
  parts.push(configColumnsBlock(CONFIG_ITEMS));

  // 4. Productos
  parts.push(productGridBlock(PRODUCTS));

  // 5. Sectores
  parts.push(bulletListBlock("Usos recomendados", SECTORS));

  // 6. Combinacion con taquillas
  parts.push(
    linkListBlock(
      "Los bancos de vestuario Zentry pueden combinarse con nuestras taquillas metalicas, fenolicas y de melamina para crear soluciones completas de vestuario.",
      LOCKER_LINKS
    )
  );

  // 7. FAQ
  parts.push(faqBlock(FAQ));

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

  const canWrite = wpStatus.enabled && backend === "rest" && wpStatus.environment === "staging" && wpStatus.configured;
  if (!canWrite) {
    console.log("SIMULACION (no se toca la red): faltan condiciones de escritura. No se crea ninguna pagina.");
    console.log("--- contenido generado (primeros 2000 caracteres) ---");
    console.log(contentHtml.slice(0, 2000));
    return;
  }

  const title = "Bancos de vestuario para gimnasios, empresas y centros deportivos";
  const excerpt = "Bancos de vestuario en pino, fenolico y melamina para gimnasios, empresas, colegios y centros deportivos. Modelos simples, con perchero y con zapatero.";

  const result = existingPageId
    ? await updateWordpressDraftPage({ pageId: existingPageId, title, contentHtml, excerpt })
    : await createWordpressDraftPage({ title, contentHtml, excerpt, slug: "bancos-de-vestuario" });

  console.log(existingPageId ? "--- BORRADOR ACTUALIZADO EN STAGING ---" : "--- BORRADOR CREADO EN STAGING ---");
  console.log(`wordpressDraftId: ${result.wordpressDraftId}`);
  console.log(`wordpressDraftUrl: ${result.wordpressDraftUrl}`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
