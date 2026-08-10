import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressPage, getWordpressStatusForReport, unpublishStagingPage } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";

/**
 * O21.3 -- rollback simetrico de o213-publish-landing.ts: vuelve una
 * pagina de STAGING que esta "publish" a "draft" de nuevo. Misma
 * gating/confirmacion que la publicacion.
 *
 * Uso:
 *   npx ts-node scripts/o213-unpublish-landing.ts --pageId 2048
 *   npx ts-node scripts/o213-unpublish-landing.ts --pageId 2048 --confirm
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

  console.log("=== Rollback (unpublish) de pagina de STAGING (Fase O21.3) ===");
  const current = await getWordpressPage(pageId);
  console.log(`Pagina ${pageId}: "${current.title}" -- status actual: "${current.status}" -- link: ${current.link}`);

  if (current.status !== "publish") {
    console.error(`Bloqueado: la pagina ${pageId} no esta en status "publish" (esta en "${current.status}"). No se hace nada.`);
    process.exit(1);
    return;
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm. No se ha revertido nada.");
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

  if (!canWrite) {
    console.log("SIMULACION (no se toca la red): faltan condiciones de escritura. No se revierte nada.");
    return;
  }
  if (wpStatus.environment !== "staging") {
    console.error("Bloqueado: WORDPRESS_ENV no es staging. No se revierte nada.");
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(
    `Vas a REVERTIR a borrador de verdad la pagina ${pageId} ("${current.title}") en STAGING. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se revierte nada.");
    return;
  }

  const result = await unpublishStagingPage(pageId);
  console.log("--- REVERTIDO A BORRADOR ---");
  console.log(`pageId: ${result.pageId}`);
  console.log(`status: ${result.status}`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
