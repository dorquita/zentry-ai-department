import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { associateProductFeaturedImage, addProductGalleryImage } from "../src/adapters/woocommerce";
import { getWordpressStatusForReport } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { findProductAssetRequestById, setProductAssetStatus } from "../src/core/product-asset-requests";
import { logger } from "../src/core/logger";

/**
 * CLI de asociacion controlada de UNA imagen ya subida a la Media
 * Library de staging a UN producto WooCommerce (Fase O21.2b, ampliado
 * en O21.2f con --mode gallery). Dry-run por defecto -- solo con
 * --confirm Y las 3 condiciones de escritura reales
 * (WORDPRESS_DRAFTS_ENABLED=true, WORDPRESS_BACKEND=rest,
 * WORDPRESS_ENV=staging) hace la escritura real, y aun con eso pide
 * confirmacion interactiva explicita "si".
 *
 * --mode featured (por defecto, comportamiento sin cambios desde
 *   O21.2b): sustituye la imagen destacada del producto.
 * --mode gallery (nuevo en O21.2f): ANADE la imagen al final de la
 *   galeria existente, sin tocar la destacada ni el resto de la
 *   galeria -- usa addProductGalleryImage() en vez de
 *   associateProductFeaturedImage().
 *
 * Uso:
 *   npm run assets:associate-product -- --productId 1966 --mediaId 4210
 *   npm run assets:associate-product -- --productId 1966 --mediaId 4210 --confirm
 *   npm run assets:associate-product -- --productId 1970 --mediaId 4300 --mode gallery --confirm --assetRequestId prod-asset-...
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const productId = Number(args.productId);
  const mediaId = Number(args.mediaId);
  const mode = args.mode === "gallery" ? "gallery" : "featured";
  if (!Number.isInteger(productId) || !Number.isInteger(mediaId)) {
    console.error('Uso: --productId <numero> --mediaId <numero> [--mode featured|gallery] [--confirm] [--assetRequestId <id>]');
    process.exit(1);
    return;
  }

  console.log(`=== Asociacion de imagen a producto WooCommerce (modo: ${mode}) ===`);
  console.log(`productId: ${productId}`);
  console.log(`mediaId: ${mediaId}`);
  console.log("");

  // --- Paso 1: dry-run SIEMPRE primero, valida producto+media existen ---
  let dryRunResult;
  try {
    dryRunResult =
      mode === "gallery"
        ? await addProductGalleryImage({ productId, mediaId, dryRun: true })
        : await associateProductFeaturedImage({ productId, mediaId, dryRun: true });
  } catch (err) {
    console.error("Dry-run fallido -- no se intenta la escritura real:", err instanceof Error ? err.message : err);
    process.exit(1);
    return;
  }

  console.log("--- DRY-RUN ---");
  console.log(`Producto encontrado: "${dryRunResult.productName}" (slug: ${dryRunResult.productSlug})`);
  if (mode === "gallery" && "existingImageIds" in dryRunResult) {
    const galleryDryRun = dryRunResult as { existingImageIds: number[] };
    console.log(`Imagenes actuales (posicion 0 = destacada, sin tocar): [${galleryDryRun.existingImageIds.join(", ")}]`);
  }
  console.log(`Payload que se enviaria (PUT wc/v3/products/${productId}):`);
  console.log(JSON.stringify({ images: dryRunResult.imagesPayload }, null, 2));
  console.log("");

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm. No se ha escrito nada.");
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
  const canWrite = wpStatus.enabled && backend === "rest" && wpStatus.environment === "staging" && wpStatus.configured;

  console.log(`WORDPRESS_DRAFTS_ENABLED: ${wpStatus.enabled}`);
  console.log(`WORDPRESS_BACKEND: ${backend}`);
  console.log(`WORDPRESS_ENV: ${wpStatus.environment}`);
  console.log(`Credenciales configuradas: ${wpStatus.configured}`);
  console.log("");

  if (!canWrite) {
    console.log("SIMULACION (no se toca la red): faltan condiciones de escritura. No se asocia nada.");
    return;
  }
  if (wpStatus.environment !== "staging") {
    console.error("Bloqueado: WORDPRESS_ENV no es staging. No se asocia nada.");
    process.exit(1);
    return;
  }

  const actionLabel = mode === "gallery" ? "ANADIR A LA GALERIA (sin tocar la destacada)" : "ASOCIAR como imagen DESTACADA";
  const answer = await plainPrompt(
    `Vas a ${actionLabel} la media ${mediaId} en el producto ${productId} ("${dryRunResult.productName}") en STAGING. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se asocia nada.");
    return;
  }

  let result;
  try {
    result =
      mode === "gallery"
        ? await addProductGalleryImage({ productId, mediaId, dryRun: false })
        : await associateProductFeaturedImage({ productId, mediaId, dryRun: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fallo asociando la imagen:", message);
    if (args.assetRequestId) {
      setProductAssetStatus(args.assetRequestId, "failed", { notes: message });
    }
    process.exit(1);
    return;
  }

  console.log("--- APLICADO ---");
  console.log(
    mode === "gallery"
      ? `Producto ${result.productId} ("${result.productName}") ahora tiene mediaId=${result.mediaId} anadida a su galeria (destacada sin cambios).`
      : `Producto ${result.productId} ("${result.productName}") ahora tiene imagen destacada mediaId=${result.mediaId}.`
  );

  if (args.assetRequestId) {
    const existing = findProductAssetRequestById(args.assetRequestId);
    if (existing) {
      setProductAssetStatus(args.assetRequestId, "associated", { associatedProductId: result.productId });
      console.log(`Registro ${args.assetRequestId} actualizado a status "associated" en data/product-asset-requests.jsonl.`);
    } else {
      console.log(`Aviso: no se encontro assetRequestId="${args.assetRequestId}" en el registro -- la asociacion en WooCommerce se aplico igualmente, pero no se pudo anotar en el registro.`);
    }
  }

  logger.info("associate-product-image: asociacion aplicada en staging", { productId: result.productId, mediaId: result.mediaId, mode });
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
