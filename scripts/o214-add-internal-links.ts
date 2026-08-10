import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressPage, updateStagingPublishedPageContent, isWordpressDraftsEnabled, getWordpressStatusForReport } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";

/**
 * O21.4 Parte B -- anade un parrafo con enlace a /bancos-de-vestuario/
 * al FINAL del contenido de paginas de staging ya publicadas. Solo
 * append (nunca borra ni reescribe nada existente). Comprueba primero
 * que el contenido actual no tenga ya un enlace a bancos-de-vestuario
 * (evita duplicados). Dry-run por defecto.
 *
 * Uso:
 *   npx ts-node scripts/o214-add-internal-links.ts
 *   npx ts-node scripts/o214-add-internal-links.ts --confirm
 */

const BANCOS_URL = "https://staging.zentrylockers.com/bancos-de-vestuario/";

interface LinkTarget {
  pageId: number;
  slug: string;
  linkTextHtml: string; // parrafo completo con <a>, listo para insertar
}

const TARGETS: LinkTarget[] = [
  { pageId: 22, slug: "taquillas", linkTextHtml: `Completa tu vestuario con nuestros <a href="${BANCOS_URL}">bancos de vestuario</a>.` },
  { pageId: 1636, slug: "taquillas-por-sector", linkTextHtml: `Completa tu vestuario con nuestros <a href="${BANCOS_URL}">bancos de vestuario</a>.` },
  { pageId: 108, slug: "taquillas-metalicas", linkTextHtml: `Completa tu vestuario con nuestros <a href="${BANCOS_URL}">bancos de vestuario</a>.` },
  { pageId: 468, slug: "taquillas-fenolicas", linkTextHtml: `Completa tu vestuario con nuestros <a href="${BANCOS_URL}">bancos de vestuario</a>.` },
  { pageId: 470, slug: "taquillas-melamina", linkTextHtml: `Completa tu vestuario con nuestros <a href="${BANCOS_URL}">bancos de vestuario</a>.` },
];

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
  const args = parseArgs(process.argv.slice(2));
  console.log("=== O21.4 Parte B: enlaces internos hacia /bancos-de-vestuario/ (staging) ===");

  const plan: Array<{ target: LinkTarget; currentContent: string; title: string; excerpt: string; newContent: string }> = [];

  for (const target of TARGETS) {
    const page = await getWordpressPage(target.pageId);
    if (page.status !== "publish") {
      console.log(`SKIP ${target.slug} (id ${target.pageId}): status "${page.status}", no "publish".`);
      continue;
    }
    if (page.contentHtml.includes("bancos-de-vestuario")) {
      console.log(`SKIP ${target.slug} (id ${target.pageId}): ya contiene un enlace a bancos-de-vestuario.`);
      continue;
    }
    const appendBlock = `\n\n<!-- wp:paragraph -->\n<p>${target.linkTextHtml}</p>\n<!-- /wp:paragraph -->`;
    const newContent = page.contentHtml + appendBlock;
    plan.push({ target, currentContent: page.contentHtml, title: page.title, excerpt: page.excerpt, newContent });
    console.log(`OK ${target.slug} (id ${target.pageId}): +${appendBlock.length} caracteres al final.`);
  }

  if (plan.length === 0) {
    console.log("Nada que hacer.");
    return;
  }

  if (!args.confirm) {
    console.log("\nSIMULACION: falta --confirm. No se ha escrito nada.");
    return;
  }

  if (!isWordpressDraftsEnabled()) {
    console.error("Bloqueado: WORDPRESS_DRAFTS_ENABLED != true.");
    process.exit(1);
    return;
  }
  const wpStatus = getWordpressStatusForReport();
  const backend = (() => {
    try {
      return resolveWordpressBackend();
    } catch {
      return "desconocido";
    }
  })();
  if (backend !== "rest" || wpStatus.environment !== "staging") {
    console.error(`Bloqueado: BACKEND="${backend}" ENV="${wpStatus.environment}" (se requiere rest/staging).`);
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(`Vas a ANADIR el enlace a ${plan.length} paginas YA PUBLICADAS de STAGING. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario.");
    return;
  }

  for (const item of plan) {
    try {
      const result = await updateStagingPublishedPageContent({
        pageId: item.target.pageId,
        title: item.title,
        contentHtml: item.newContent,
        excerpt: item.excerpt,
      });
      console.log(`ACTUALIZADO: ${item.target.slug} (id ${result.wordpressDraftId}) -> ${result.wordpressDraftUrl}`);
    } catch (err) {
      console.error(`FALLO en ${item.target.slug}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
