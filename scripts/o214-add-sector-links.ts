import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressPage, updateStagingPublishedPageContent, isWordpressDraftsEnabled, getWordpressStatusForReport } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";

/**
 * O21.4 Parte B (sectorial) -- inserta un parrafo contextual con enlace
 * a /bancos-de-vestuario/ justo ANTES del bloque de botones final
 * (CTA de cierre) de cada pagina de sector, en vez de al final absoluto
 * -- todas terminan en un CTA de cierre ("Solicitar presupuesto" o
 * WhatsApp) y anadir texto DESPUES de ese boton se veria como un
 * apendice fuera de lugar. Solo insert quirurgico, nunca borra nada.
 */

const BANCOS_URL = "https://staging.zentrylockers.com/bancos-de-vestuario/";
const SENTENCE = `También podemos completar el proyecto con <a href="${BANCOS_URL}">bancos de vestuario</a> a juego.`;

interface SectorTarget {
  pageId: number;
  slug: string;
}

const TARGETS: SectorTarget[] = [
  { pageId: 124, slug: "taquillas-para-gimnasios" },
  { pageId: 127, slug: "taquillas-para-colegios" },
  { pageId: 129, slug: "taquillas-para-empresas" },
  { pageId: 1820, slug: "taquillas-para-centros-deportivos" },
  { pageId: 1823, slug: "taquillas-para-industria" },
  { pageId: 1822, slug: "taquillas-para-oficinas" },
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
  console.log("=== O21.4 Parte B (sectorial): enlaces contextuales hacia /bancos-de-vestuario/ ===");

  const plan: Array<{ target: SectorTarget; title: string; excerpt: string; newContent: string }> = [];

  for (const target of TARGETS) {
    const page = await getWordpressPage(target.pageId);
    if (page.status !== "publish") {
      console.log(`SKIP ${target.slug} (id ${target.pageId}): status "${page.status}".`);
      continue;
    }
    if (page.contentHtml.includes("bancos-de-vestuario")) {
      console.log(`SKIP ${target.slug} (id ${target.pageId}): ya contiene un enlace a bancos-de-vestuario.`);
      continue;
    }
    const insertIdx = page.contentHtml.lastIndexOf("<!-- wp:buttons -->");
    if (insertIdx === -1) {
      console.log(`SKIP ${target.slug} (id ${target.pageId}): no se encontro un bloque wp:buttons final donde insertar de forma segura.`);
      continue;
    }
    const insertBlock = `<!-- wp:paragraph -->\n<p>${SENTENCE}</p>\n<!-- /wp:paragraph -->\n\n`;
    const newContent = page.contentHtml.slice(0, insertIdx) + insertBlock + page.contentHtml.slice(insertIdx);
    plan.push({ target, title: page.title, excerpt: page.excerpt, newContent });
    console.log(`OK ${target.slug} (id ${target.pageId}): parrafo insertado justo antes del CTA final.`);
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

  const answer = await plainPrompt(`Vas a ANADIR el enlace contextual a ${plan.length} paginas de sector YA PUBLICADAS de STAGING. Escribe "si" para confirmar: `);
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
