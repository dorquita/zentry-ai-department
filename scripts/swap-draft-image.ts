import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { findImageOptimizationById, markOptimizationApplied } from "../src/core/image-optimizations";
import { findAssetRequestById } from "../src/core/asset-requests";
import { recordPendingInsertion, markInsertionFailed } from "../src/core/draft-image-insertions";
import { getWordpressPage, getWordpressStatusForReport, updateWordpressDraftPage } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { logger } from "../src/core/logger";

/**
 * CLI de SUSTITUCION (Fase O12.9): reemplaza, dentro de un draft ya
 * existente, el bloque de imagen que apunta al media ORIGINAL
 * (`sourceWordpressMediaId` de una optimizacion ya `uploaded`) por el
 * bloque que apunta al media WebP optimizado. Deliberadamente un script
 * APARTE de `optimize-and-upload-webp.ts` -- construido en la Fase
 * O12.9 pero NUNCA ejecutado automaticamente; exige confirmacion "si"
 * explicita cada vez, ademas de que quien lo invoque debe hacerlo a
 * proposito (nunca se llama desde growth:daily ni desde ningun otro
 * agente). Guarda snapshot previo (mismo registro que
 * insert-hero-image-into-draft.ts) para poder revertir con
 * `npm run drafts:rollback-image-insertion`. NO borra el media
 * original (PNG/JPG) -- solo deja de estar referenciado en ESTE draft.
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pageId = Number(args.pageId);
  const optimizationId = args.optimizationId;

  if (!pageId || !optimizationId) {
    console.error("Uso: npm run drafts:swap-image -- --pageId <id> --optimizationId <id>");
    process.exit(1);
    return;
  }

  const optimization = findImageOptimizationById(optimizationId);
  if (!optimization) {
    console.error(`No existe ninguna optimizacion con optimizationId="${optimizationId}".`);
    process.exit(1);
    return;
  }
  if (optimization.status !== "uploaded" || !optimization.outputWordpressMediaId || !optimization.outputWordpressMediaUrl) {
    console.error(
      `La optimizacion "${optimizationId}" tiene status "${optimization.status}". Bloqueado: solo se sustituye una ` +
        `optimizacion ya "uploaded" (el WebP ya tiene que existir de verdad en la Media Library).`
    );
    process.exit(1);
    return;
  }

  console.log("=== Sustitucion de imagen en draft por version WebP (Fase O12.9) ===");
  console.log(`pageId: ${pageId}`);
  console.log(`optimizationId: ${optimizationId}`);
  console.log(`sourceWordpressMediaId (PNG, se deja de usar aqui, NO se borra): ${optimization.sourceWordpressMediaId}`);
  console.log(`outputWordpressMediaId (WebP nuevo): ${optimization.outputWordpressMediaId}`);
  console.log(`outputWordpressMediaUrl: ${optimization.outputWordpressMediaUrl}`);
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

  const page = await getWordpressPage(pageId);
  if (page.status !== "draft") {
    console.error(`La pagina ${pageId} no esta en status "draft" (esta en "${page.status}"). Bloqueado: no se toca.`);
    process.exit(1);
    return;
  }

  const oldMarker = `wp-image-${optimization.sourceWordpressMediaId}`;
  if (!page.contentHtml.includes(oldMarker)) {
    console.error(`El draft ${pageId} no contiene ninguna imagen con "${oldMarker}". No hay nada que sustituir.`);
    process.exit(1);
    return;
  }

  const oldBlockRegex = new RegExp(
    `<!-- wp:image \\{[^}]*"id":${optimization.sourceWordpressMediaId}[^}]*\\} -->[\\s\\S]*?<!-- /wp:image -->`
  );
  if (!oldBlockRegex.test(page.contentHtml)) {
    console.error(
      `No se encontro un bloque wp:image completo para el media ${optimization.sourceWordpressMediaId} en el draft ${pageId}. ` +
        `Bloqueado por seguridad: no se hace una sustitucion parcial/heuristica sobre HTML que no coincide con el patron esperado.`
    );
    process.exit(1);
    return;
  }

  const assetRequest = findAssetRequestById(optimization.assetRequestId);
  const safeAlt = escapeHtmlAttr(assetRequest?.altText ?? "");
  const newBlock =
    `<!-- wp:image {"id":${optimization.outputWordpressMediaId},"sizeSlug":"large","linkDestination":"none","className":"hero-image"} -->\n` +
    `<figure class="wp-block-image size-large hero-image"><img src="${escapeHtmlAttr(
      optimization.outputWordpressMediaUrl
    )}" alt="${safeAlt}" class="wp-image-${optimization.outputWordpressMediaId}"/></figure>\n` +
    `<!-- /wp:image -->`;

  const newContentHtml = page.contentHtml.replace(oldBlockRegex, newBlock);

  console.log("--- Bloque que sustituiria al actual ---");
  console.log(newBlock);
  console.log("------------------------------------------");
  console.log("");

  const answer = await plainPrompt(
    `Vas a ACTUALIZAR el draft ${pageId} sustituyendo la imagen PNG (media ${optimization.sourceWordpressMediaId}) por la version WebP ` +
      `(media ${optimization.outputWordpressMediaId}). El PNG original NO se borra, solo deja de usarse en este draft. Sigue en status "draft". ` +
      `Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se modifico nada.");
    return;
  }

  const insertion = recordPendingInsertion({
    pageId,
    assetRequestId: optimization.assetRequestId,
    wordpressMediaId: optimization.outputWordpressMediaId,
    wordpressMediaUrl: optimization.outputWordpressMediaUrl,
    previousContentHtml: page.contentHtml,
    newContentHtml,
  });
  console.log(`Snapshot previo guardado: insertionId=${insertion.insertionId}`);

  logger.info("swap-draft-image: iniciando sustitucion real", { pageId, optimizationId, insertionId: insertion.insertionId });

  try {
    const result = await updateWordpressDraftPage({
      pageId,
      title: page.title,
      contentHtml: newContentHtml,
      excerpt: page.excerpt,
    });

    markOptimizationApplied(optimizationId, pageId);

    console.log("");
    console.log("=== Sustitucion completada ===");
    console.log(`wordpressDraftId: ${result.wordpressDraftId}`);
    console.log(`insertionId (para rollback si hace falta): ${insertion.insertionId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo la sustitucion real: ${message}`);
    markInsertionFailed(insertion.insertionId, message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
