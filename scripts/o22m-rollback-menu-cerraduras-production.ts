import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { canAttemptProductionWrites, resolveProductionTargetUrl } from "../src/adapters/wordpress-production";

/**
 * Ajuste O22 -- ROLLBACK simetrico de o22m-update-menu-cerraduras-production.ts:
 * restaura la url original ("/cerraduras/") del item de menu "Cerraduras"
 * (id 307, menu 17) en produccion.
 *
 * Uso:
 *   npx ts-node scripts/o22m-rollback-menu-cerraduras-production.ts
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true PRODUCTION_BACKEND=rest npx ts-node scripts/o22m-rollback-menu-cerraduras-production.ts --confirm
 */

const MENU_ID = 17;
const ITEM_ID = 307;
const RESTORE_URL = "https://zentrylockers.com/cerraduras/";

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
  const confirm = process.argv.includes("--confirm");
  const config = resolveConfig();
  const authHeader = authHeaderFor(config);

  const getRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items/${ITEM_ID}?context=edit&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache" },
  });
  if (!getRes.ok) throw new Error(`GET item ${ITEM_ID} respondio ${getRes.status}`);
  const current = (await getRes.json()) as { id: number; url: string; title: { raw?: string; rendered?: string } };
  console.log(`Item ${ITEM_ID} actual: titulo "${current.title.raw ?? current.title.rendered}", url "${current.url}"`);

  if (!confirm) {
    console.log(`SIMULACION: falta --confirm. Se restauraria a "${RESTORE_URL}".`);
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion.");
    process.exit(1);
    return;
  }
  const answer = await plainPrompt(`Vas a RESTAURAR la url del item ${ITEM_ID} a "${RESTORE_URL}" en PRODUCCION. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }

  const updateRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items/${ITEM_ID}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ url: RESTORE_URL }),
  });
  if (!updateRes.ok) {
    console.error(`Fallo restaurando el item ${ITEM_ID}: ${updateRes.status}`);
    process.exit(1);
    return;
  }
  console.log("--- URL RESTAURADA ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
