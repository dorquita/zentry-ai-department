import * as readline from "readline";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5a -- ROLLBACK preparado, NO ejecutado todavia (el item de menu
 * de produccion no existe hasta O21.5b). Restaura el menu_order
 * original de los items de nivel superior del "Menu principal" (id 17)
 * de PRODUCCION desde un backup JSON, y borra el item nuevo
 * "Bancos de vestuario". Mismo patron que scripts/o214-menu-rollback.ts
 * (staging), repuntado a produccion.
 *
 * Uso (una vez exista el backup real de O21.5b):
 *   npx ts-node scripts/o215-rollback-menu.ts --backupFile <path> --newItemId <id>
 *   npx ts-node scripts/o215-rollback-menu.ts --backupFile <path> --newItemId <id> --confirm
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
  if (!args.backupFile || !args.newItemId) {
    console.error("Uso: --backupFile <path> --newItemId <id> [--confirm]");
    process.exit(1);
    return;
  }
  const backup = JSON.parse(fs.readFileSync(args.backupFile, "utf-8")) as Array<{ id: number; menu_order: number }>;
  const newItemId = Number(args.newItemId);

  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  console.log("=== O21.5 ROLLBACK: restaurar Menu principal de PRODUCCION ===");
  console.log(`Restaurar menu_order original de ${backup.length} items desde ${args.backupFile}`);
  console.log(`Borrar item nuevo: ${newItemId}`);

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion.");
    process.exit(1);
    return;
  }
  const answer = await plainPrompt(`Vas a REVERTIR el Menu principal de PRODUCCION a su estado anterior. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }

  const delRes = await fetch(`${baseUrl}/wp-json/wp/v2/menu-items/${newItemId}?force=true`, { method: "DELETE", headers: { Authorization: authHeader } });
  console.log(`Borrado item ${newItemId}: ${delRes.status}`);

  for (const item of backup) {
    const res = await fetch(`${baseUrl}/wp-json/wp/v2/menu-items/${item.id}`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ menu_order: item.menu_order }),
    });
    console.log(`  ${res.ok ? "restaurado" : "FALLO"}: ${item.id} -> order ${item.menu_order} (${res.status})`);
  }
  console.log("--- ROLLBACK COMPLETADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
