import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5a -- ROLLBACK preparado, NO ejecutado todavia (las categorias y
 * atributos de produccion no existen hasta O21.5b). Borra las 4
 * categorias banco y los 2 atributos (+ 5 terminos) de PRODUCCION SOLO
 * SI su `count` de productos asociados es 0 -- si algun producto banco
 * sigue vivo, se niega (evita dejar productos con categorias/atributos
 * rotos). Por eso el orden de rollback correcto es: primero
 * o215-rollback-products.ts, despues este script.
 *
 * Uso (una vez existan los IDs reales de O21.5b):
 *   npx ts-node scripts/o215-rollback-categories-attributes.ts --categoryIds 501,502,503,504 --attributeIds 12,13
 *   npx ts-node scripts/o215-rollback-categories-attributes.ts --categoryIds ... --attributeIds ... --confirm
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
  const attributeIds = args.attributeIds ? args.attributeIds.split(",").map(Number) : [];
  if (categoryIds.length === 0 && attributeIds.length === 0) {
    console.error("Uso: --categoryIds <id,...> --attributeIds <id,...> [--confirm]");
    process.exit(1);
    return;
  }

  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  console.log("=== O21.5 ROLLBACK: borrar categorias/atributos vacios de PRODUCCION ===");

  const deletable: Array<{ type: "category" | "attribute"; id: number; count: number }> = [];
  for (const id of categoryIds) {
    const res = await fetch(`${baseUrl}/wp-json/wc/v3/products/categories/${id}?_cb=${Date.now()}`, { headers: { Authorization: authHeader, "Cache-Control": "no-cache" } });
    const cat = (await res.json()) as { name: string; count: number };
    console.log(`  categoria ${id} "${cat.name}": count=${cat.count} -> ${cat.count === 0 ? "BORRABLE" : "BLOQUEADA (tiene productos)"}`);
    if (cat.count === 0) deletable.push({ type: "category", id, count: cat.count });
  }
  for (const id of attributeIds) {
    // Los atributos globales no exponen "count" directamente -- se comprueba a traves de sus terminos.
    const res = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes/${id}/terms?per_page=100&_cb=${Date.now()}`, { headers: { Authorization: authHeader, "Cache-Control": "no-cache" } });
    const terms = (await res.json()) as Array<{ count: number }>;
    const totalCount = terms.reduce((s, t) => s + t.count, 0);
    console.log(`  atributo ${id}: uso total en productos=${totalCount} -> ${totalCount === 0 ? "BORRABLE" : "BLOQUEADO (tiene productos)"}`);
    if (totalCount === 0) deletable.push({ type: "attribute", id, count: totalCount });
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion.");
    process.exit(1);
    return;
  }
  if (deletable.length === 0) {
    console.log("Nada borrable (todo sigue en uso).");
    return;
  }
  const answer = await plainPrompt(`Vas a BORRAR ${deletable.length} objetos vacios en PRODUCCION. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  for (const item of deletable) {
    const path = item.type === "category" ? `/wp-json/wc/v3/products/categories/${item.id}?force=true` : `/wp-json/wc/v3/products/attributes/${item.id}?force=true`;
    const res = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers: { Authorization: authHeader } });
    console.log(`  ${res.ok ? "borrado" : "FALLO"}: ${item.type} ${item.id} (${res.status})`);
  }
  console.log("--- ROLLBACK COMPLETADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
