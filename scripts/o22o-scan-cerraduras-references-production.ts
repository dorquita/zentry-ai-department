import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl } from "../src/adapters/wordpress-production";

/**
 * Ajuste O22 -- barrido COMPLETO de solo lectura en produccion:
 * paginas, entradas, productos y bloques reutilizables, buscando
 * cualquier referencia interna a /cerraduras/ (absoluta o relativa,
 * como href de enlace/boton/CTA -- Kadence Blocks/Gutenberg incluidos,
 * porque el href vive en el HTML del bloque igual que en cualquier
 * otro). Los 4 menus (17 Menu principal, 23 Footer, 24 Legal, 69
 * Productos-Blog-Contacto) ya se revisaron a mano en el ajuste anterior
 * -- solo el item 307 del menu 17 apuntaba ahi, ya corregido. Este
 * script NO escribe nada, solo reporta coincidencias exactas con
 * contexto para decidir que editar despues.
 *
 * Uso:
 *   npx ts-node scripts/o22o-scan-cerraduras-references-production.ts
 */

const OLD_URL_ABS = "https://zentrylockers.com/cerraduras/";
const OLD_URL_REL = '"/cerraduras/"';
const NEW_SLUG = "cerraduras-para-taquillas";

interface WpConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}
function resolveConfig(): WpConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  return { baseUrl, username, appPassword };
}
function authHeaderFor(config: WpConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}

interface ContentItem {
  id: number;
  slug: string;
  title: string;
  contentRaw: string;
}

async function fetchAllOfType(config: WpConfig, restBase: string): Promise<ContentItem[]> {
  const authHeader = authHeaderFor(config);
  const items: ContentItem[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`${config.baseUrl}/wp-json/wp/v2/${restBase}?per_page=100&page=${page}&context=edit&_cb=${Date.now()}`, {
      headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
    });
    if (!res.ok) {
      if (res.status === 400 && page > 1) break; // paginado agotado
      throw new Error(`GET ${restBase} pagina ${page} respondio ${res.status}`);
    }
    const json = (await res.json()) as Array<{
      id: number;
      slug?: string;
      title?: { raw?: string; rendered?: string };
      content?: { raw?: string; rendered?: string };
      description?: string;
    }>;
    if (json.length === 0) break;
    for (const it of json) {
      const contentRaw = it.content?.raw ?? it.content?.rendered ?? it.description ?? "";
      items.push({ id: it.id, slug: it.slug ?? "", title: it.title?.raw ?? it.title?.rendered ?? "", contentRaw });
    }
    const totalPages = Number(res.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages) break;
    page++;
  }
  return items;
}

function findMatches(contentRaw: string): string[] {
  const matches: string[] = [];
  let idx = contentRaw.indexOf(OLD_URL_ABS);
  while (idx !== -1) {
    // excluir si en realidad es la URL nueva (cerraduras-para-taquillas contiene "cerraduras" pero no "cerraduras/" seguido de comilla/espacio ahi)
    const context = contentRaw.slice(Math.max(0, idx - 40), idx + OLD_URL_ABS.length + 20);
    matches.push(context);
    idx = contentRaw.indexOf(OLD_URL_ABS, idx + 1);
  }
  idx = contentRaw.indexOf(OLD_URL_REL);
  while (idx !== -1) {
    const context = contentRaw.slice(Math.max(0, idx - 40), idx + OLD_URL_REL.length + 20);
    matches.push(context);
    idx = contentRaw.indexOf(OLD_URL_REL, idx + 1);
  }
  return matches;
}

async function main(): Promise<void> {
  const config = resolveConfig();
  const results: Array<{ type: string; id: number; slug: string; title: string; matches: string[] }> = [];

  for (const [type, restBase] of [
    ["page", "pages"],
    ["post", "posts"],
    ["product", "product"],
    ["reusable_block", "blocks"],
  ] as const) {
    console.log(`Escaneando ${type} (${restBase})...`);
    const items = await fetchAllOfType(config, restBase);
    console.log(`  ${items.length} elementos leidos`);
    for (const item of items) {
      if (item.slug === NEW_SLUG) continue; // no reportar la propia landing nueva
      const matches = findMatches(item.contentRaw);
      if (matches.length > 0) {
        results.push({ type, id: item.id, slug: item.slug, title: item.title, matches });
      }
    }
  }

  console.log(`\n=== RESULTADO: ${results.length} elementos con referencias a /cerraduras/ ===`);
  for (const r of results) {
    console.log(`\n[${r.type}] id ${r.id} "${r.title}" (/${r.slug}/) -- ${r.matches.length} coincidencia(s):`);
    for (const m of r.matches) console.log(`    ...${m.replace(/\n/g, " ")}...`);
  }

  const outPath = `data/o22o-scan-results-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nGuardado en: ${outPath}`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
