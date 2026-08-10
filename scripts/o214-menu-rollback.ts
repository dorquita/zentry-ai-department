import * as readline from "readline";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { assertWordpressWriteAllowed, resolveWordpressTargetUrl, resolveWordpressEnv } from "../src/adapters/wordpress-backend";
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { isWordpressDraftsEnabled } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";

/**
 * O21.4 -- rollback de o214-menu-add-bancos.ts: restaura el menu_order
 * original de todos los items de nivel superior de "Menu principal"
 * (id 17) a partir del backup guardado ANTES de la insercion
 * (scratchpad/backups/o214-menu17-backup.json), y borra el item nuevo
 * "Bancos de vestuario" (--newItemId).
 *
 * Uso:
 *   npx ts-node scripts/o214-menu-rollback.ts --backupFile <path> --newItemId <id>
 *   npx ts-node scripts/o214-menu-rollback.ts --backupFile <path> --newItemId <id> --confirm
 */

const MENU_ID = 17;

interface WpConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}

function resolveConfig(): WpConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveWordpressTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_APP_PASSWORD");
  return { baseUrl, username, appPassword };
}

function authHeaderFor(config: WpConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
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
  if (!args.backupFile || !args.newItemId) {
    console.error("Uso: --backupFile <path> --newItemId <id> [--confirm]");
    process.exit(1);
    return;
  }
  const backup = JSON.parse(fs.readFileSync(args.backupFile, "utf-8")) as Array<{ id: number; menu_order: number; parent: number }>;
  const newItemId = Number(args.newItemId);

  console.log("=== O21.4 ROLLBACK: restaurar Menu principal ===");
  console.log(`Restaurar menu_order original de ${backup.length} items desde ${args.backupFile}`);
  console.log(`Borrar item nuevo: ${newItemId}`);

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm. No se ha revertido nada.");
    return;
  }
  if (!isWordpressDraftsEnabled()) {
    console.error("Bloqueado: WORDPRESS_DRAFTS_ENABLED != true.");
    process.exit(1);
    return;
  }
  assertWordpressWriteAllowed();
  const backend = resolveWordpressBackend();
  const env = resolveWordpressEnv();
  if (backend !== "rest" || env !== "staging") {
    console.error(`Bloqueado: BACKEND="${backend}" ENV="${env}" (se requiere rest/staging).`);
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(`Vas a REVERTIR el Menu principal de STAGING a su estado anterior. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario.");
    return;
  }

  const config = resolveConfig();
  const authHeader = authHeaderFor(config);

  const delRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items/${newItemId}?force=true`, {
    method: "DELETE",
    headers: { Authorization: authHeader },
  });
  console.log(`Borrado item ${newItemId}: ${delRes.status}`);

  for (const item of backup) {
    const res = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items/${item.id}`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ menu_order: item.menu_order }),
    });
    if (!res.ok) {
      console.error(`Fallo restaurando el item ${item.id}: ${res.status}`);
      continue;
    }
    console.log(`  restaurado: ${item.id} -> order ${item.menu_order}`);
  }
  console.log("--- ROLLBACK COMPLETADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
