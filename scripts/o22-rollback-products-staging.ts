import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { trashStagingProduct } from "../src/adapters/woocommerce-staging-catalog";

/**
 * O22.3 -- ROLLBACK: mueve una lista de IDs de producto de STAGING a
 * la papelera (nunca borrado permanente -- trashStagingProduct() usa
 * force=false). Dry-run por defecto. Mismo patron que
 * o215-rollback-products.ts (produccion, Bancos) pero apuntando a
 * staging.
 *
 * Uso:
 *   npx ts-node scripts/o22-rollback-products-staging.ts --productIds 3001,3002,3003
 *   STAGING_EXECUTION_ENABLED=true WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o22-rollback-products-staging.ts --productIds 3001,3002,3003 --confirm
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
  if (!args.productIds) {
    console.error("Uso: --productIds <id,id,...> [--confirm]");
    process.exit(1);
    return;
  }
  const productIds = args.productIds.split(",").map(Number);

  console.log("=== O22 ROLLBACK: mover productos de Cerraduras de STAGING a papelera ===");
  for (const id of productIds) {
    const dryRunResult = await trashStagingProduct(id, true);
    console.log(`  dry-run ${id}:`, JSON.stringify(dryRunResult));
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  const answer = await plainPrompt(`Vas a MOVER A PAPELERA ${productIds.length} productos de STAGING. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  for (const id of productIds) {
    try {
      const result = await trashStagingProduct(id, false);
      console.log(`  papelera: ${id} -> status ${result.status}`);
    } catch (err) {
      console.error(`  FALLO en ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("--- ROLLBACK COMPLETADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
