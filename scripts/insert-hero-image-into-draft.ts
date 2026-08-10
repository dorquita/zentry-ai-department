import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { findAssetRequestById } from "../src/core/asset-requests";
import { recordPendingInsertion, markInsertionFailed } from "../src/core/draft-image-insertions";
import {
  getWordpressPage,
  getWordpressStatusForReport,
  updateWordpressDraftPage,
} from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { logger } from "../src/core/logger";

/**
 * CLI de insercion controlada (Fase O12.8): inserta la imagen de UN
 * asset request ya subido a WordPress (status "uploaded_to_wordpress")
 * como bloque hero de Gutenberg al PRINCIPIO del contenido de un draft
 * ya existente. Nunca publica (siempre fuerza status "draft" via
 * updateWordpressDraftPage), nunca toca una pagina que no este ya en
 * draft. Snapshot completo del contenido previo ANTES de escribir
 * (data/draft-image-insertions.jsonl) para poder revertir con
 * npm run drafts:rollback-image-insertion.
 */

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

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHeroImageBlock(mediaId: number, mediaUrl: string, altText: string): string {
  const safeAlt = escapeHtmlAttr(altText);
  const safeUrl = escapeHtmlAttr(mediaUrl);
  return (
    `<!-- wp:image {"id":${mediaId},"sizeSlug":"large","linkDestination":"none","className":"hero-image"} -->\n` +
    `<figure class="wp-block-image size-large hero-image"><img src="${safeUrl}" alt="${safeAlt}" class="wp-image-${mediaId}"/></figure>\n` +
    `<!-- /wp:image -->`
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pageId = Number(args.pageId);
  const assetRequestId = args.assetRequestId;

  if (!pageId || !assetRequestId) {
    console.error("Uso: npm run drafts:insert-hero-image -- --pageId <id> --assetRequestId <id>");
    process.exit(1);
    return;
  }

  const assetRequest = findAssetRequestById(assetRequestId);
  if (!assetRequest) {
    console.error(`No existe ninguna peticion con assetRequestId="${assetRequestId}".`);
    process.exit(1);
    return;
  }
  if (assetRequest.status !== "uploaded_to_wordpress" || !assetRequest.wordpressMediaId || !assetRequest.wordpressMediaUrl) {
    console.error(
      `La peticion "${assetRequestId}" tiene status "${assetRequest.status}" o le falta wordpressMediaId/wordpressMediaUrl. ` +
        `Bloqueado: solo se inserta una imagen que ya este realmente subida a la Media Library (Fase O12.7).`
    );
    process.exit(1);
    return;
  }

  console.log("=== Insercion de imagen hero en draft (Fase O12.8) ===");
  console.log(`pageId: ${pageId}`);
  console.log(`assetRequestId: ${assetRequestId}`);
  console.log(`wordpressMediaId: ${assetRequest.wordpressMediaId}`);
  console.log(`wordpressMediaUrl: ${assetRequest.wordpressMediaUrl}`);
  console.log(`altText: ${assetRequest.altText}`);
  console.log("");

  const wpStatus = getWordpressStatusForReport();
  const backend = (() => {
    try {
      return resolveWordpressBackend();
    } catch {
      return "desconocido";
    }
  })();
  const canWrite = wpStatus.enabled && backend === "rest" && wpStatus.environment === "staging" && wpStatus.configured;

  console.log(`WORDPRESS_DRAFTS_ENABLED: ${wpStatus.enabled}`);
  console.log(`WORDPRESS_BACKEND: ${backend}`);
  console.log(`WORDPRESS_ENV: ${wpStatus.environment}`);
  console.log(`Credenciales configuradas: ${wpStatus.configured}`);
  console.log("");

  if (!canWrite) {
    console.log(
      "SIMULACION (no se toca la red): faltan una o mas condiciones (WORDPRESS_DRAFTS_ENABLED=true, " +
        "WORDPRESS_BACKEND=rest, WORDPRESS_ENV=staging, credenciales). No se modifica nada."
    );
    return;
  }
  if (wpStatus.environment !== "staging") {
    console.error("Bloqueado: WORDPRESS_ENV no es staging. No se modifica nada.");
    process.exit(1);
    return;
  }

  // 1. Leer el contenido ACTUAL del draft (tambien sirve de snapshot previo).
  const page = await getWordpressPage(pageId);
  console.log(`Estado actual de la pagina ${pageId}: status="${page.status}", title="${page.title}"`);

  if (page.status !== "draft") {
    console.error(`La pagina ${pageId} no esta en status "draft" (esta en "${page.status}"). Bloqueado: no se toca.`);
    process.exit(1);
    return;
  }

  const marker = `wp-image-${assetRequest.wordpressMediaId}`;
  if (page.contentHtml.includes(marker)) {
    console.log(`La imagen (media ${assetRequest.wordpressMediaId}) ya esta insertada en el draft ${pageId}. No se duplica. Nada que hacer.`);
    return;
  }

  const heroBlock = buildHeroImageBlock(assetRequest.wordpressMediaId, assetRequest.wordpressMediaUrl, assetRequest.altText);
  const newContentHtml = `${heroBlock}\n${page.contentHtml}`;

  console.log("");
  console.log("--- Bloque hero que se insertaria al principio ---");
  console.log(heroBlock);
  console.log("---------------------------------------------------");
  console.log("");

  const answer = await plainPrompt(
    `Vas a ACTUALIZAR el draft ${pageId} en ${wpStatus.targetUrl} (staging) insertando esta imagen como bloque hero al inicio. ` +
      `El resto del contenido se mantiene igual. Sigue en status "draft", no se publica. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se modifico nada.");
    return;
  }

  // 2. Snapshot previo -- ANTES de tocar la red.
  const insertion = recordPendingInsertion({
    pageId,
    assetRequestId,
    wordpressMediaId: assetRequest.wordpressMediaId,
    wordpressMediaUrl: assetRequest.wordpressMediaUrl,
    previousContentHtml: page.contentHtml,
    newContentHtml,
  });
  console.log(`Snapshot previo guardado: insertionId=${insertion.insertionId}`);

  logger.info("insert-hero-image-into-draft: iniciando actualizacion real", {
    pageId,
    assetRequestId,
    insertionId: insertion.insertionId,
  });

  try {
    const result = await updateWordpressDraftPage({
      pageId,
      title: page.title,
      contentHtml: newContentHtml,
      excerpt: page.excerpt,
    });

    console.log("");
    console.log("=== Insercion completada ===");
    console.log(`wordpressDraftId: ${result.wordpressDraftId}`);
    console.log(`wordpressDraftUrl (frontend): ${result.wordpressDraftUrl}`);
    console.log(`URL del editor: ${wpStatus.targetUrl}/wp-admin/post.php?post=${pageId}&action=edit`);
    console.log(`URL de preview: ${wpStatus.targetUrl}/?page_id=${pageId}&preview=true (requiere sesion de administrador)`);
    console.log(`insertionId (para rollback si hace falta): ${insertion.insertionId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo la insercion real: ${message}`);
    markInsertionFailed(insertion.insertionId, message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
