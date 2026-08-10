import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa G -- ROLLBACK: elimina variaciones concretas de
 * produccion (nunca el producto padre, nunca categorias/atributos/media).
 * Las variaciones no tienen estado \"trash\" en WooCommerce, asi que el
 * borrado es DELETE?force=true -- por eso pide confirmacion explicita.
 * Dry-run por defecto (lista lo que borraria sin tocar nada).
 *
 * Uso:
 *   npx ts-node scripts/o21g-rollback-variations.ts --variationIds <productId>:<variationId>,...
 *   npx ts-node scripts/o21g-rollback-variations.ts --variationIds <productId>:<variationId>,... --confirm
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
  if (!args.variationIds) {
    console.error("Uso: --variationIds <productId>:<variationId>,... [--confirm]");
    process.exit(1);
    return;
  }
  const pairs = args.variationIds.split(",").map((pair) => {
    const [productId, variationId] = pair.split(":").map(Number);
    return { productId, variationId };
  });

  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  console.log("=== O21.5g ROLLBACK: eliminar variaciones de PRODUCCION (producto padre intacto) ===");
  for (const { productId, variationId } of pairs) {
    const res = await fetch(`${baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}`, { headers: { Authorization: authHeader } });
    const v = (await res.json()) as { sku?: string };
    console.log(`  producto ${productId} / variacion ${variationId} (${v.sku ?? "?"}): existe, BORRABLE`);
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion (pasa los flags inline en el comando).");
    process.exit(1);
    return;
  }
  const answer = await plainPrompt(`Vas a ELIMINAR ${pairs.length} variaciones de PRODUCCION (no se pueden mover a papelera). Escribe \"si\" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  for (const { productId, variationId } of pairs) {
    const res = await fetch(`${baseUrl}/wp-json/wc/v3/products/${productId}/variations/${variationId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });
    console.log(`  ${res.ok ? "eliminada" : "FALLO"}: producto ${productId} / variacion ${variationId} (${res.status})`);
  }
  console.log("--- ROLLBACK COMPLETADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
