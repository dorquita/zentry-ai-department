/**
 * Envia (o simula) UNA peticion de asset de prueba al webhook de n8n
 * (Fase O12.5). Por defecto SIEMPRE simula: solo intenta un envio REAL si
 * se cumplen las 3 condiciones a la vez:
 *
 *   1. N8N_ASSET_GENERATION_ENABLED=true
 *   2. N8N_ASSET_GENERATION_WEBHOOK_URL configurada
 *   3. Confirmacion explicita escrita en el prompt ("si")
 *
 * Si falta cualquiera de las 3, imprime exactamente lo que SE ENVIARIA
 * (el payload) sin tocar la red — nunca llama a n8n "por accidente".
 *
 * Uso:
 *   npm run assets:send-test
 *   npm run assets:send-test -- --assetRequestId asset-req-...
 *
 * Ver docs/n8n-asset-generation.md.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as readline from "readline";
import { readCurrentAssetRequests, setAssetRequestStatus } from "../src/core/asset-requests";
import { getN8nAssetWebhookStatusForReport, requestAssetGeneration } from "../src/adapters/n8n-asset-webhook";
import { resolveWordpressTargetUrl } from "../src/adapters/wordpress-backend";
import { logger } from "../src/core/logger";

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

function targetWordPressForStaging(): string {
  try {
    return resolveWordpressTargetUrl().replace(/^https?:\/\//, "");
  } catch {
    return "staging.zentrylockers.com";
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const current = readCurrentAssetRequests();
  const candidate = args.assetRequestId
    ? current.find((r) => r.assetRequestId === args.assetRequestId)
    : [...current].filter((r) => r.status === "proposed").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!candidate) {
    console.error(
      args.assetRequestId
        ? `No existe ninguna peticion con assetRequestId="${args.assetRequestId}".`
        : 'No hay ninguna peticion en status "proposed" en data/asset-requests.jsonl. Ejecuta primero "npm run visual-assets:plan" o "npm run growth:daily".'
    );
    process.exit(1);
    return;
  }

  const payload = {
    assetRequestId: candidate.assetRequestId,
    prompt: candidate.prompt,
    negativePrompt: candidate.negativePrompt,
    dimensions: candidate.dimensions,
    filenameSuggestion: candidate.filenameSuggestion,
    altText: candidate.altText,
    targetEnv: "staging" as const,
    targetWordPress: targetWordPressForStaging(),
  };

  console.log("=== Peticion de asset de prueba (Fase O12.5) ===");
  console.log(`assetRequestId: ${payload.assetRequestId}`);
  console.log(`imagePurpose: ${candidate.imagePurpose} | dimensiones: ${payload.dimensions.width}x${payload.dimensions.height}`);
  console.log(`altText: ${payload.altText}`);
  console.log(`filenameSuggestion: ${payload.filenameSuggestion}`);
  console.log(`targetEnv: ${payload.targetEnv} | targetWordPress: ${payload.targetWordPress}`);
  console.log("");

  const { enabled, configured, canSend } = getN8nAssetWebhookStatusForReport();
  console.log(`N8N_ASSET_GENERATION_ENABLED: ${enabled}`);
  console.log(`N8N_ASSET_GENERATION_WEBHOOK_URL configurada: ${configured}`);
  console.log("");

  if (!canSend) {
    console.log(
      "SIMULACION (no se ha llamado a n8n): faltan " +
        [!enabled ? "N8N_ASSET_GENERATION_ENABLED=true" : null, !configured ? "N8N_ASSET_GENERATION_WEBHOOK_URL" : null]
          .filter(Boolean)
          .join(" y ") +
        "."
    );
    console.log("Payload que se enviaria (POST):");
    console.log(JSON.stringify(payload, null, 2));
    console.log("");
    console.log('Respuesta simulada esperada mientras el nodo "Generar Imagen" siga desactivado en n8n:');
    console.log(
      JSON.stringify(
        {
          assetRequestId: payload.assetRequestId,
          status: "failed",
          altText: payload.altText,
          error: "Generacion de imagen no configurada todavia (Fase O12.5). Ver docs/asset-generation-workflow.md.",
        },
        null,
        2
      )
    );
    process.exit(0);
    return;
  }

  const confirm = await plainPrompt(
    `Vas a enviar una peticion REAL al webhook de n8n para "${payload.assetRequestId}". El nodo "Generar Imagen"\n` +
      "sigue desactivado en el workflow, asi que n8n respondera status:\"failed\" y no se generara ninguna imagen\n" +
      'real ni se subira nada a WordPress — pero esto SI es una llamada de red real. Escribe "si" para confirmar: '
  );

  if (confirm.trim().toLowerCase() !== "si" && confirm.trim().toLowerCase() !== "s") {
    console.log("Cancelado. No se ha llamado a n8n.");
    process.exit(0);
    return;
  }

  try {
    const response = await requestAssetGeneration(payload);
    console.log("");
    console.log("OK: respuesta real de n8n recibida.");
    console.log(JSON.stringify(response, null, 2));

    const updated = setAssetRequestStatus(candidate.assetRequestId, response.status, {
      generatedImageUrl: response.imageUrl,
      wordpressMediaId: response.wordpressMediaId,
      wordpressMediaUrl: response.wordpressMediaUrl,
      lastError: response.error,
      n8nWebhookSentAt: new Date().toISOString(),
    });
    if (updated) {
      console.log(`Registro actualizado en data/asset-requests.jsonl: status -> "${updated.status}".`);
    }
    logger.info("Prueba de envio a n8n completada", { assetRequestId: payload.assetRequestId, status: response.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo el envio real: ${message}`);
    process.exit(1);
    return;
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("send-test-asset-request fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
