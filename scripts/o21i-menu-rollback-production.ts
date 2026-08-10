import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa I -- ROLLBACK: borra el item de menu "Bancos de
 * vestuario" creado en produccion. Como o21i-menu-add-bancos-production.ts
 * nunca desplazo ningun otro item (uso un hueco libre de menu_order),
 * el rollback es solo un DELETE -- no hace falta restaurar nada mas.
 *
 * Uso:
 *   npx ts-node scripts/o21i-menu-rollback-production.ts --newItemId <id>
 *   npx ts-node scripts/o21i-menu-rollback-production.ts --newItemId <id> --confirm
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
  if (!args.newItemId) {
    console.error("Uso: --newItemId <id> [--confirm]");
    process.exit(1);
    return;
  }
  const newItemId = Number(args.newItemId);

  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  const getRes = await fetch(`${baseUrl}/wp-json/wp/v2/menu-items/${newItemId}?context=edit`, { headers: { Authorization: authHeader } });
  if (!getRes.ok) {
    console.error(`GET item ${newItemId} respondio ${getRes.status}`);
    process.exit(1);
    return;
  }
  const item = (await getRes.json()) as { title: { rendered: string }; url: string };
  console.log("=== O21.5i ROLLBACK: borrar item de menu de PRODUCCION ===");
  console.log(`Item ${newItemId}: \"${item.title.rendered}\" -> ${item.url}`);

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion.");
    process.exit(1);
    return;
  }
  const answer = await plainPrompt(`Vas a BORRAR el item de menu ${newItemId} de PRODUCCION. Escribe \"si\" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  const delRes = await fetch(`${baseUrl}/wp-json/wp/v2/menu-items/${newItemId}?force=true`, { method: "DELETE", headers: { Authorization: authHeader } });
  console.log(`${delRes.ok ? "borrado" : "FALLO"}: ${delRes.status}`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
