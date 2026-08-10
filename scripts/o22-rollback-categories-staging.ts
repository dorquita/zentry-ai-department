import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveWordpressTargetUrl, assertWordpressWriteAllowed } from "../src/adapters/wordpress-backend";
import { canAttemptStagingCatalogWrites } from "../src/adapters/woocommerce-staging-catalog";

/**
 * O22.3 -- ROLLBACK: borra categorias de Cerraduras de STAGING SOLO SI
 * su `count` de productos asociados es 0 -- si algun producto sigue
 * vivo, se niega. Por eso el orden de rollback correcto es: primero
 * o22-rollback-products-staging.ts, despues este script. Mismo patron
 * que o215-rollback-categories-attributes.ts (produccion, Bancos) pero
 * apuntando a staging.
 *
 * Uso:
 *   npx ts-node scripts/o22-rollback-categories-staging.ts --categoryIds 501,502,503,504
 *   STAGING_EXECUTION_ENABLED=true WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o22-rollback-categories-staging.ts --categoryIds 501,502,503,504 --confirm
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
  const categoryIds = args.categoryIds ? args.categoryIds.split(",").map(Number) : [];
  if (categoryIds.length === 0) {
    console.error("Uso: --categoryIds <id,...> [--confirm]");
    process.exit(1);
    return;
  }

  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveWordpressTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  console.log("=== O22 ROLLBACK: borrar categorias de Cerraduras vacias en STAGING ===");

  const deletable: Array<{ id: number; count: number }> = [];
  for (const id of categoryIds) {
    const res = await fetch(`${baseUrl}/wp-json/wc/v3/products/categories/${id}?_cb=${Date.now()}`, { headers: { Authorization: authHeader, "Cache-Control": "no-cache" } });
    const cat = (await res.json()) as { name: string; count: number };
    console.log(`  categoria ${id} "${cat.name}": count=${cat.count} -> ${cat.count === 0 ? "BORRABLE" : "BLOQUEADA (tiene productos)"}`);
    if (cat.count === 0) deletable.push({ id, count: cat.count });
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  if (!canAttemptStagingCatalogWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de staging (STAGING_EXECUTION_ENABLED/WORDPRESS_DRAFTS_ENABLED/WORDPRESS_BACKEND=rest).");
    process.exit(1);
    return;
  }
  assertWordpressWriteAllowed();
  if (deletable.length === 0) {
    console.log("Nada borrable (todo sigue en uso).");
    return;
  }
  const answer = await plainPrompt(`Vas a BORRAR ${deletable.length} categorias vacias en STAGING. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  for (const item of deletable) {
    const res = await fetch(`${baseUrl}/wp-json/wc/v3/products/categories/${item.id}?force=true`, { method: "DELETE", headers: { Authorization: authHeader } });
    console.log(`  ${res.ok ? "borrado" : "FALLO"}: categoria ${item.id} (${res.status})`);
  }
  console.log("--- ROLLBACK COMPLETADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
