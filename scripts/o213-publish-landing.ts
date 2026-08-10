import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressPage, getWordpressStatusForReport, publishStagingDraftPage } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";

/**
 * O21.3 -- publica en STAGING (nunca produccion) una pagina que ya esta
 * en status "draft". Dry-run implicito: siempre lee el estado actual de
 * la pagina antes de nada; solo escribe si --confirm Y las 3 condiciones
 * de escritura reales estan activas, y aun asi pide confirmacion
 * interactiva explicita "si".
 *
 * Uso:
 *   npx ts-node scripts/o213-publish-landing.ts --pageId 2048
 *   npx ts-node scripts/o213-publish-landing.ts --pageId 2048 --confirm
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
  const pageId = Number(args.pageId);
  if (!Number.isInteger(pageId)) {
    console.error("Uso: --pageId <numero> [--confirm]");
    process.exit(1);
    return;
  }

  console.log("=== Publicacion de pagina de STAGING (Fase O21.3) ===");
  const current = await getWordpressPage(pageId);
  console.log(`Pagina ${pageId}: "${current.title}" -- status actual: "${current.status}" -- link: ${current.link}`);

  if (current.status !== "draft") {
    console.error(`Bloqueado: la pagina ${pageId} no esta en status "draft" (esta en "${current.status}"). No se hace nada.`);
    process.exit(1);
    return;
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm. No se ha publicado nada.");
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

  if (!canWrite) {
    console.log("SIMULACION (no se toca la red): faltan condiciones de escritura. No se publica nada.");
    return;
  }
  if (wpStatus.environment !== "staging") {
    console.error("Bloqueado: WORDPRESS_ENV no es staging. No se publica nada.");
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(
    `Vas a PUBLICAR de verdad la pagina ${pageId} ("${current.title}") en STAGING (nunca produccion). Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se publica nada.");
    return;
  }

  const result = await publishStagingDraftPage(pageId);
  console.log("--- PUBLICADO EN STAGING ---");
  console.log(`pageId: ${result.pageId}`);
  console.log(`status: ${result.status}`);
  console.log(`link: ${result.link}`);
  console.log("");
  console.log(`Rollback disponible: npx ts-node scripts/o213-unpublish-landing.ts --pageId ${pageId} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
