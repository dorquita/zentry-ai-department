import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { trashProductionProduct } from "../src/adapters/woocommerce-production";

/**
 * O21.5a -- ROLLBACK preparado, NO ejecutado todavia (los 9 productos
 * banco de produccion no existen hasta O21.5b). Mueve una lista de IDs
 * de producto de produccion a la papelera (nunca borrado permanente --
 * trashProductionProduct() usa force=false). Dry-run por defecto.
 *
 * Uso (una vez existan los IDs reales de O21.5b):
 *   npx ts-node scripts/o215-rollback-products.ts --productIds 3001,3002,3003
 *   npx ts-node scripts/o215-rollback-products.ts --productIds 3001,3002,3003 --confirm
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

  console.log("=== O21.5 ROLLBACK: mover productos banco de PRODUCCION a papelera ===");
  for (const id of productIds) {
    const dryRunResult = await trashProductionProduct(id, true);
    console.log(`  dry-run ${id}:`, JSON.stringify(dryRunResult));
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  const answer = await plainPrompt(`Vas a MOVER A PAPELERA ${productIds.length} productos de PRODUCCION. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  for (const id of productIds) {
    try {
      const result = await trashProductionProduct(id, false);
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
