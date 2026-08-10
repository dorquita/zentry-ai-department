import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import sharp from "sharp";
import { findAssetRequestById } from "../src/core/asset-requests";
import {
  recordProposedOptimization,
  markOptimizationUploaded,
  markOptimizationFailed,
} from "../src/core/image-optimizations";
import { getWordpressStatusForReport, uploadMediaToWordpress } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { logger } from "../src/core/logger";

/**
 * CLI de optimizacion (Fase O12.9): genera una version WebP de un asset
 * ya generado/subido y la sube como MEDIA NUEVA a staging -- nunca
 * borra ni toca el original (PNG/JPG), nunca sustituye nada en ningun
 * draft. La sustitucion (usar el WebP en vez del original dentro del
 * draft) es un paso SEPARADO y deliberadamente manual
 * (scripts/swap-draft-image.ts), nunca automatico desde aqui.
 */

const DEFAULT_QUALITY = 80;

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

function parseDataUri(dataUri: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([\w/+-]+);base64,(.*)$/s.exec(dataUri);
  if (!match) {
    throw new Error('generatedImageUrl no tiene forma de data URI ("data:<mime>;base64,..."). No se puede optimizar.');
  }
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

function humanKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const assetRequestId = args.assetRequestId;
  const quality = args.quality ? Number(args.quality) : DEFAULT_QUALITY;

  if (!assetRequestId) {
    console.error("Uso: npm run assets:optimize-webp -- --assetRequestId <id> [--quality 80]");
    process.exit(1);
    return;
  }

  const assetRequest = findAssetRequestById(assetRequestId);
  if (!assetRequest) {
    console.error(`No existe ninguna peticion con assetRequestId="${assetRequestId}".`);
    process.exit(1);
    return;
  }
  if (assetRequest.status !== "uploaded_to_wordpress" || !assetRequest.wordpressMediaId || !assetRequest.generatedImageUrl) {
    console.error(
      `La peticion "${assetRequestId}" tiene status "${assetRequest.status}" o le falta wordpressMediaId/generatedImageUrl. ` +
        `Bloqueado: solo se optimiza una imagen que ya este generada Y subida a WordPress.`
    );
    process.exit(1);
    return;
  }

  const { mimeType: sourceMimeType, buffer: sourceBuffer } = parseDataUri(assetRequest.generatedImageUrl);

  console.log("=== Optimizacion WebP (Fase O12.9) ===");
  console.log(`assetRequestId: ${assetRequestId}`);
  console.log(`sourceWordpressMediaId: ${assetRequest.wordpressMediaId}`);
  console.log(`sourceFormat: ${sourceMimeType} | sourceFileSize: ${humanKb(sourceBuffer.length)} (${sourceBuffer.length} bytes)`);
  console.log(`quality: ${quality}`);
  console.log("");

  const webpBuffer = await sharp(sourceBuffer).webp({ quality }).toBuffer();
  const webpMeta = await sharp(webpBuffer).metadata();
  const reduction = 100 - (webpBuffer.length / sourceBuffer.length) * 100;

  console.log(`Resultado WebP: ${humanKb(webpBuffer.length)} (${webpBuffer.length} bytes) | ${webpMeta.width}x${webpMeta.height}`);
  console.log(`Reduccion: ${reduction.toFixed(1)}%`);
  console.log("");

  const wpStatus = getWordpressStatusForReport();
  const backend = (() => {
    try {
      return resolveWordpressBackend();
    } catch {
      return "desconocido";
    }
  })();
  const canUpload = wpStatus.enabled && backend === "rest" && wpStatus.environment === "staging" && wpStatus.configured;

  console.log(`WORDPRESS_DRAFTS_ENABLED: ${wpStatus.enabled}`);
  console.log(`WORDPRESS_BACKEND: ${backend}`);
  console.log(`WORDPRESS_ENV: ${wpStatus.environment}`);
  console.log("");

  if (!canUpload) {
    console.log(
      "SIMULACION (no se toca la red): faltan una o mas condiciones (WORDPRESS_DRAFTS_ENABLED=true, " +
        "WORDPRESS_BACKEND=rest, WORDPRESS_ENV=staging, credenciales). No se sube nada. El WebP ya se genero localmente " +
        "(en memoria) para el analisis de arriba, pero no se ha escrito nada en WordPress."
    );
    return;
  }
  if (wpStatus.environment !== "staging") {
    console.error("Bloqueado: WORDPRESS_ENV no es staging. No se sube nada.");
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(
    `Vas a SUBIR una nueva media WebP (${humanKb(webpBuffer.length)}) a la Media Library de ${wpStatus.targetUrl} (staging). ` +
      `El PNG original (media ${assetRequest.wordpressMediaId}) NO se toca ni se borra. El draft NO se modifica todavia -- ` +
      `eso es un paso aparte que requiere tu aprobacion explicita. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se subio nada.");
    return;
  }

  const optimization = recordProposedOptimization({
    assetRequestId,
    sourceWordpressMediaId: assetRequest.wordpressMediaId,
    sourceFormat: sourceMimeType,
    sourceFileSize: sourceBuffer.length,
    outputQuality: quality,
  });
  console.log(`Registro de optimizacion creado: optimizationId=${optimization.optimizationId}`);

  logger.info("optimize-and-upload-webp: subiendo WebP real", {
    assetRequestId,
    optimizationId: optimization.optimizationId,
  });

  try {
    const baseFilename = assetRequest.filenameSuggestion.replace(/\.(jpg|jpeg|png|webp)$/i, "");
    const result = await uploadMediaToWordpress({
      fileBuffer: webpBuffer,
      filename: `${baseFilename}.webp`,
      mimeType: "image/webp",
      altText: assetRequest.altText,
    });

    markOptimizationUploaded(optimization.optimizationId, {
      outputWordpressMediaId: result.wordpressMediaId,
      outputWordpressMediaUrl: result.wordpressMediaUrl,
      outputFileSize: result.fileSize,
      width: result.width,
      height: result.height,
    });

    console.log("");
    console.log("=== WebP subido (nueva media, PNG original intacto) ===");
    console.log(`outputWordpressMediaId: ${result.wordpressMediaId}`);
    console.log(`outputWordpressMediaUrl: ${result.wordpressMediaUrl}`);
    console.log(`fileSize: ${result.fileSize} bytes (${humanKb(result.fileSize)})`);
    console.log(`optimizationId (para el paso de sustitucion, si se aprueba): ${optimization.optimizationId}`);
    console.log("");
    console.log(
      "El draft NO se ha modificado. Para sustituir la imagen del draft por esta version WebP hace falta " +
        "ejecutar aparte `npm run drafts:swap-image` con confirmacion explicita."
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo la subida del WebP: ${message}`);
    markOptimizationFailed(optimization.optimizationId, message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
