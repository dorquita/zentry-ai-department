import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();
import sharp from "sharp";
import { requestAssetGeneration, isN8nAssetGenerationEnabled } from "../src/adapters/n8n-asset-webhook";
import { uploadMediaToWordpress, getWordpressStatusForReport } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { createProposedProductAssetRequest, setProductAssetStatus, ProductAssetType } from "../src/core/product-asset-requests";

/**
 * O21.2b -- pipeline de UNA imagen ancla: registra la peticion, llama al
 * webhook real de n8n (debe estar activo ANTES de ejecutar este script
 * -- este script no lo activa/desactiva por si mismo, eso se hace desde
 * fuera con publish_workflow/unpublish_workflow), guarda el PNG
 * resultante, lo convierte a WebP, lo sube a la Media Library de
 * staging, y deja el registro listo para el paso final de asociacion
 * (scripts/associate-product-image.ts, por separado).
 *
 * O21.2g -- soporta tambien --assetType family: estas imagenes no estan
 * ligadas a ningun producto concreto (son para la futura landing
 * /bancos-de-vestuario/), asi que --productId/--productSlug/--productName
 * dejan de ser obligatorios y el registro se crea con esos campos en
 * null, tal como especifica el esquema de product-asset-requests.ts.
 * Nunca se asocian a un producto -- el script solo genera y sube.
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const assetType = (args.assetType as ProductAssetType) || "main";
  const isFamily = assetType === "family";

  const required = isFamily
    ? ["prompt", "negativePrompt", "width", "height", "filenameSuggestion", "altText"]
    : ["productId", "productSlug", "productName", "prompt", "negativePrompt", "width", "height", "filenameSuggestion", "altText"];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    console.error("Faltan argumentos: " + missing.join(", "));
    process.exit(1);
    return;
  }

  console.log(`=== O21.2b/O21.2g: generar + subir imagen (${assetType}) ===`);
  console.log(isFamily ? `imagen de familia (sin producto): ${args.filenameSuggestion}` : `producto: ${args.productName} (ID ${args.productId})`);
  console.log("");

  if (!isN8nAssetGenerationEnabled()) {
    console.error("Bloqueado: N8N_ASSET_GENERATION_ENABLED no es true. No se llama a n8n.");
    process.exit(1);
    return;
  }

  const registryEntry = createProposedProductAssetRequest({
    productId: isFamily ? null : Number(args.productId),
    productSlug: isFamily ? null : args.productSlug,
    productName: isFamily ? null : args.productName,
    assetType,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    dimensions: { width: Number(args.width), height: Number(args.height) },
    filenameSuggestion: args.filenameSuggestion,
    altText: args.altText,
    notes: isFamily
      ? "Imagen de familia O21.2g -- para la futura landing /bancos-de-vestuario/, no asociada a ningun producto."
      : "Imagen ancla O21.2b -- generada antes de escalar al resto de la cola.",
  });
  console.log(`Registro creado: ${registryEntry.assetRequestId}`);

  console.log("Llamando al webhook de n8n (Zentry - AI Asset Generation - Staging)...");
  const n8nResponse = await requestAssetGeneration({
    assetRequestId: registryEntry.assetRequestId,
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    dimensions: { width: Number(args.width), height: Number(args.height) },
    filenameSuggestion: args.filenameSuggestion,
    altText: args.altText,
    targetEnv: "staging",
    targetWordPress: "staging.zentrylockers.com",
  });

  if (n8nResponse.status !== "generated" || !n8nResponse.imageUrl) {
    console.error(`Generacion fallida: status="${n8nResponse.status}" error="${n8nResponse.error ?? ""}"`);
    setProductAssetStatus(registryEntry.assetRequestId, "failed", { notes: n8nResponse.error ?? "Generacion fallida sin detalle" });
    process.exit(1);
    return;
  }

  const match = /^data:([\w/+-]+);base64,(.*)$/s.exec(n8nResponse.imageUrl);
  if (!match) {
    console.error("La respuesta de n8n no tiene forma de data URI. Abortando.");
    setProductAssetStatus(registryEntry.assetRequestId, "failed", { notes: "imageUrl no es un data URI valido" });
    process.exit(1);
    return;
  }
  const [, mimeType, base64Data] = match;
  const pngBuffer = Buffer.from(base64Data, "base64");
  console.log(`Imagen generada: ${pngBuffer.length} bytes, mimeType=${mimeType}`);

  const outDir = "/tmp/o212-anchor-assets";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const baseName = isFamily ? args.filenameSuggestion.replace(/\.(png|jpg|jpeg|webp)$/i, "") : args.productSlug;
  const pngPath = path.join(outDir, `${baseName}-${assetType}.png`);
  fs.writeFileSync(pngPath, pngBuffer);

  setProductAssetStatus(registryEntry.assetRequestId, "generated", { generatedFilePath: pngPath });
  console.log(`PNG guardado localmente: ${pngPath}`);

  console.log("Convirtiendo a WebP...");
  const webpBuffer = await sharp(pngBuffer).webp({ quality: 85 }).toBuffer();
  const webpFilename = args.filenameSuggestion.replace(/\.(png|jpg|jpeg)$/i, ".webp");
  console.log(`WebP generado: ${webpBuffer.length} bytes`);

  const wpStatus = getWordpressStatusForReport();
  const backend = (() => {
    try {
      return resolveWordpressBackend();
    } catch {
      return "desconocido";
    }
  })();
  const canUpload = wpStatus.enabled && backend === "rest" && wpStatus.environment === "staging" && wpStatus.configured;
  console.log(`WORDPRESS_DRAFTS_ENABLED=${wpStatus.enabled} BACKEND=${backend} ENV=${wpStatus.environment} configured=${wpStatus.configured}`);

  if (!canUpload) {
    console.log("SIMULACION de subida (no se toca la red): faltan condiciones de escritura. El PNG/WebP quedan solo en local.");
    return;
  }

  console.log("Subiendo WebP a la Media Library de staging...");
  const uploadResult = await uploadMediaToWordpress({
    fileBuffer: webpBuffer,
    filename: webpFilename,
    mimeType: "image/webp",
    altText: args.altText,
  });

  setProductAssetStatus(registryEntry.assetRequestId, "uploaded_to_wordpress", {
    uploadedMediaId: uploadResult.wordpressMediaId,
    finalMediaUrl: uploadResult.wordpressMediaUrl,
  });

  console.log("--- SUBIDO ---");
  console.log(`wordpressMediaId: ${uploadResult.wordpressMediaId}`);
  console.log(`wordpressMediaUrl: ${uploadResult.wordpressMediaUrl}`);
  console.log(`assetRequestId: ${registryEntry.assetRequestId}`);
  console.log("");
  if (isFamily) {
    console.log("Imagen de familia subida a la Media Library, sin asociar a ningun producto (queda disponible para la futura landing).");
  } else {
    console.log(
      `Siguiente paso: npm run assets:associate-product -- --productId ${args.productId} --mediaId ${uploadResult.wordpressMediaId} --confirm --assetRequestId ${registryEntry.assetRequestId}`
    );
  }
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
