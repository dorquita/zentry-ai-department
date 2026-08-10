import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { readCurrentAssetRequests, setAssetRequestStatus } from "../src/core/asset-requests";
import { getWordpressStatusForReport, uploadMediaToWordpress } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { logger } from "../src/core/logger";

/**
 * CLI de subida controlada de UN asset ya generado (status "generated")
 * a la Media Library de WordPress staging (Fase O12.7). Nunca inserta la
 * media en ninguna pagina/post -- eso es una fase posterior (O12.8).
 * Simula (sin tocar la red) salvo que WORDPRESS_DRAFTS_ENABLED=true Y
 * WORDPRESS_BACKEND=rest Y WORDPRESS_ENV=staging, y aun asi pide
 * confirmacion explicita "si" antes de la llamada real.
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

function parseDataUri(dataUri: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([\w/+-]+);base64,(.*)$/s.exec(dataUri);
  if (!match) {
    throw new Error('generatedImageUrl no tiene forma de data URI ("data:<mime>;base64,..."). No se puede subir.');
  }
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const current = readCurrentAssetRequests();
  const candidate = args.assetRequestId
    ? current.find((r) => r.assetRequestId === args.assetRequestId)
    : [...current].filter((r) => r.status === "generated").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (!candidate) {
    console.error(
      args.assetRequestId
        ? `No existe ninguna peticion con assetRequestId="${args.assetRequestId}".`
        : 'No hay ninguna peticion en status "generated" en data/asset-requests.jsonl.'
    );
    process.exit(1);
    return;
  }

  if (candidate.status !== "generated") {
    console.error(
      `La peticion "${candidate.assetRequestId}" tiene status "${candidate.status}", no "generated". ` +
        `Bloqueado: solo se sube a WordPress una imagen ya generada con exito (evita re-subir, o subir un fallo).`
    );
    process.exit(1);
    return;
  }

  if (!candidate.generatedImageUrl) {
    console.error(`La peticion "${candidate.assetRequestId}" no tiene generatedImageUrl. No hay nada que subir.`);
    process.exit(1);
    return;
  }

  console.log("=== Subida de asset a WordPress Media Library (Fase O12.7) ===");
  console.log(`assetRequestId: ${candidate.assetRequestId}`);
  console.log(`imagePurpose: ${candidate.imagePurpose} | changePackId: ${candidate.changePackId}`);
  console.log(`altText: ${candidate.altText}`);
  console.log(`filenameSuggestion: ${candidate.filenameSuggestion}`);
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
  console.log(`Credenciales configuradas: ${wpStatus.configured}`);
  console.log("");

  const { buffer, mimeType } = parseDataUri(candidate.generatedImageUrl);
  console.log(`Tamano decodificado: ${buffer.length} bytes | mimeType: ${mimeType}`);
  console.log("");

  if (!canUpload) {
    console.log(
      "SIMULACION (no se toca la red): faltan una o mas condiciones (WORDPRESS_DRAFTS_ENABLED=true, " +
        "WORDPRESS_BACKEND=rest, WORDPRESS_ENV=staging, credenciales). No se sube nada."
    );
    return;
  }

  if (wpStatus.environment !== "staging") {
    console.error("Bloqueado: WORDPRESS_ENV no es staging. No se sube nada.");
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(
    `Vas a subir un archivo REAL de ${buffer.length} bytes a la Media Library de ${wpStatus.targetUrl} (staging). ` +
      `Esto NO publica ni modifica ninguna pagina. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se subio nada.");
    return;
  }

  logger.info("upload-asset-to-wordpress: iniciando subida real", {
    assetRequestId: candidate.assetRequestId,
    environment: wpStatus.environment,
  });

  try {
    const result = await uploadMediaToWordpress({
      fileBuffer: buffer,
      filename: candidate.filenameSuggestion,
      mimeType,
      altText: candidate.altText,
    });

    const updated = setAssetRequestStatus(candidate.assetRequestId, "uploaded_to_wordpress", {
      wordpressMediaId: result.wordpressMediaId,
      wordpressMediaUrl: result.wordpressMediaUrl,
      uploadedAt: new Date().toISOString(),
      fileSize: result.fileSize,
      width: result.width,
      height: result.height,
    });

    console.log("");
    console.log("=== Subida completada ===");
    console.log(`wordpressMediaId: ${result.wordpressMediaId}`);
    console.log(`wordpressMediaUrl: ${result.wordpressMediaUrl}`);
    console.log(`fileSize: ${result.fileSize} bytes`);
    console.log(`dimensiones reales en WordPress: ${result.width ?? "?"}x${result.height ?? "?"}`);
    console.log(`Nuevo status del asset request: ${updated?.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo la subida real: ${message}`);
    setAssetRequestStatus(candidate.assetRequestId, "failed", { lastError: message });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
