import * as fs from "fs";
import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { updateProductionPublishedPageContent, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa J -- ROLLBACK: restaura el contenido EXACTO (title,
 * contentHtml, excerpt) que tenia cada pagina antes de o21j-add-internal-links-production.ts,
 * a partir del backup json. Nunca cambia el status (sigue "publish").
 *
 * Uso:
 *   npx ts-node scripts/o21j-rollback-links-production.ts --backupFile <path>
 *   npx ts-node scripts/o21j-rollback-links-production.ts --backupFile <path> --confirm
 */

interface BackupEntry {
  pageId: number;
  slug: string;
  status: string;
  title: string;
  excerpt: string;
  contentHtml: string;
}

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
  if (!args.backupFile) {
    console.error("Uso: --backupFile <path> [--confirm]");
    process.exit(1);
    return;
  }
  const backup: BackupEntry[] = JSON.parse(fs.readFileSync(args.backupFile, "utf-8"));

  console.log("=== O21.5j ROLLBACK: restaurar contenido original de ", backup.length, "paginas de PRODUCCION ===");
  for (const b of backup) console.log(`  ${b.slug} (id ${b.pageId}): restaurar a ${b.contentHtml.length} caracteres`);

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion.");
    process.exit(1);
    return;
  }
  const answer = await plainPrompt(`Vas a RESTAURAR el contenido original de ${backup.length} paginas de PRODUCCION. Escribe \"si\" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  for (const b of backup) {
    try {
      const result = await updateProductionPublishedPageContent({ pageId: b.pageId, title: b.title, contentHtml: b.contentHtml, excerpt: b.excerpt });
      console.log(`  restaurado: ${b.slug} (id ${result.wordpressPageId})`);
    } catch (err) {
      console.error(`  FALLO en ${b.slug}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("--- ROLLBACK COMPLETADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
