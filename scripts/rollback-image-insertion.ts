import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { findDraftImageInsertionById, markInsertionRolledBack } from "../src/core/draft-image-insertions";
import { getWordpressPage, getWordpressStatusForReport, updateWordpressDraftPage } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { logger } from "../src/core/logger";

/**
 * Revierte una insercion de imagen (Fase O12.8): restaura
 * `previousContentHtml` guardado en el snapshot, tal cual, en el draft
 * correspondiente. Nunca publica, nunca toca una pagina que no este ya
 * en draft. Idempotente: si el insertionId ya esta "rolled_back", avisa
 * y no vuelve a escribir nada.
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
  const insertionId = args.insertionId;
  if (!insertionId) {
    console.error("Uso: npm run drafts:rollback-image-insertion -- --insertionId <id>");
    process.exit(1);
    return;
  }

  const insertion = findDraftImageInsertionById(insertionId);
  if (!insertion) {
    console.error(`No existe ninguna insercion con insertionId="${insertionId}".`);
    process.exit(1);
    return;
  }
  if (insertion.status === "rolled_back") {
    console.log(`La insercion "${insertionId}" ya esta revertida. Nada que hacer.`);
    return;
  }

  console.log("=== Rollback de insercion de imagen (Fase O12.8) ===");
  console.log(`insertionId: ${insertionId}`);
  console.log(`pageId: ${insertion.pageId}`);
  console.log(`wordpressMediaId: ${insertion.wordpressMediaId}`);
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
        "WORDPRESS_BACKEND=rest, WORDPRESS_ENV=staging, credenciales). No se revierte nada."
    );
    return;
  }
  if (wpStatus.environment !== "staging") {
    console.error("Bloqueado: WORDPRESS_ENV no es staging. No se revierte nada.");
    process.exit(1);
    return;
  }

  const page = await getWordpressPage(insertion.pageId);
  if (page.status !== "draft") {
    console.error(`La pagina ${insertion.pageId} no esta en status "draft" (esta en "${page.status}"). Bloqueado: no se toca.`);
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(
    `Vas a RESTAURAR el contenido previo del draft ${insertion.pageId} (quitando la imagen insertada). Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se revirtio nada.");
    return;
  }

  logger.info("rollback-image-insertion: restaurando contenido previo", { insertionId, pageId: insertion.pageId });

  const result = await updateWordpressDraftPage({
    pageId: insertion.pageId,
    title: page.title,
    contentHtml: insertion.previousContentHtml,
    excerpt: page.excerpt,
  });

  markInsertionRolledBack(insertionId);

  console.log("");
  console.log("=== Rollback completado ===");
  console.log(`wordpressDraftId: ${result.wordpressDraftId}`);
  console.log(`wordpressDraftUrl: ${result.wordpressDraftUrl}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
