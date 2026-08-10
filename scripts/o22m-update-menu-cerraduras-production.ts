import * as readline from "readline";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { canAttemptProductionWrites, resolveProductionTargetUrl } from "../src/adapters/wordpress-production";

/**
 * Ajuste O22 -- Etapa E (produccion) -- cambia SOLO el campo `url` del
 * item de menu YA EXISTENTE "Cerraduras" (id 307, menu 17 "Menu
 * principal", el mismo menu que sirve escritorio y movil -- ver
 * comentario de o214-menu-add-bancos.ts) para que apunte a
 * /cerraduras-para-taquillas/ en vez de /cerraduras/. NO crea un item
 * nuevo, NO toca el texto "Cerraduras", NO reordena nada. Backup
 * completo del menu (los 23 items) antes de escribir.
 *
 * Uso:
 *   npx ts-node scripts/o22m-update-menu-cerraduras-production.ts                      (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true PRODUCTION_BACKEND=rest npx ts-node scripts/o22m-update-menu-cerraduras-production.ts --confirm
 */

const MENU_ID = 17;
const ITEM_ID = 307;
const NEW_URL = "https://zentrylockers.com/cerraduras-para-taquillas/";
const OLD_URL = "https://zentrylockers.com/cerraduras/";

interface WpConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}
function resolveConfig(): WpConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  return { baseUrl, username, appPassword };
}
function authHeaderFor(config: WpConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = "true";
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
  const config = resolveConfig();
  const authHeader = authHeaderFor(config);

  console.log("=== Ajuste O22 Etapa E: actualizar item de menu 'Cerraduras' (produccion) ===");

  const listRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items?menus=${MENU_ID}&per_page=100&context=edit&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!listRes.ok) throw new Error(`GET menu-items respondio ${listRes.status}`);
  const allItems = (await listRes.json()) as Array<{ id: number; title: { raw?: string; rendered?: string }; url: string; menu_order: number; parent: number }>;

  const backupPath = `data/o22m-menu17-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(allItems, null, 2));
  console.log(`Backup completo del menu escrito: ${backupPath} (${allItems.length} items)`);

  const target = allItems.find((i) => i.id === ITEM_ID);
  if (!target) throw new Error(`Item ${ITEM_ID} no encontrado en el menu ${MENU_ID}. Bloqueado -- no se toca nada.`);

  const titleText = target.title.raw ?? target.title.rendered ?? "";
  console.log(`Item actual: id ${target.id}, titulo "${titleText}", url actual "${target.url}"`);
  if (titleText.trim() !== "Cerraduras") {
    throw new Error(`El titulo actual del item ${ITEM_ID} es "${titleText}", no "Cerraduras". Bloqueado por seguridad -- no se toca.`);
  }
  if (target.url !== OLD_URL) {
    console.log(`AVISO: la url actual ("${target.url}") no es exactamente "${OLD_URL}" -- se actualizara igualmente a "${NEW_URL}".`);
  }

  console.log(`Cambio propuesto: url "${target.url}" -> "${NEW_URL}" (titulo, orden y padre SIN cambios).`);

  if (!args.confirm) {
    console.log("\nSIMULACION: falta --confirm. No se ha escrito nada.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion (PRODUCTION_EXECUTION_ENABLED/PRODUCTION_DRAFTS_ENABLED/PRODUCTION_BACKEND=rest).");
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(`Vas a cambiar la URL del item de menu "${titleText}" (id ${ITEM_ID}) en PRODUCCION. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se ha escrito nada.");
    return;
  }

  const updateRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items/${ITEM_ID}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ url: NEW_URL }),
  });
  if (!updateRes.ok) {
    const bodyText = await updateRes.text().catch(() => "");
    console.error(`Fallo actualizando el item ${ITEM_ID}: ${updateRes.status} ${bodyText.slice(0, 300)}`);
    process.exit(1);
    return;
  }
  const updated = (await updateRes.json()) as { id: number; url: string; title: { raw?: string; rendered?: string } };
  console.log("--- ACTUALIZADO ---");
  console.log(`item ${updated.id}: titulo "${updated.title.raw ?? updated.title.rendered}", url nueva "${updated.url}"`);

  console.log("\n=== Rollback (restaurar url anterior) ===");
  console.log(`npx ts-node scripts/o22m-rollback-menu-cerraduras-production.ts --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
