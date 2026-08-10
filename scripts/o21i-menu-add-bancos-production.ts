import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites, getProductionStatusForReport } from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa I -- anade "Bancos de vestuario" al Menu principal (id
 * 17) de PRODUCCION, justo despues de "Taquillas" (order 2) y antes de
 * "Cerraduras" (order 10). Como hay un hueco libre entre esos dos
 * ordenes, se inserta en order 3 -- CERO items existentes se
 * desplazan/reordenan/borran. No toca productos, cerraduras, O19 ni
 * theme/functions.php (esto es un item de menu via REST, no toca
 * ficheros del theme).
 *
 * Uso:
 *   npx ts-node scripts/o21i-menu-add-bancos-production.ts            (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o21i-menu-add-bancos-production.ts --confirm
 */

const MENU_ID = 17;
const NEW_ITEM_TITLE = "Bancos de vestuario";
const NEW_ITEM_URL = "https://zentrylockers.com/bancos-de-vestuario/";
const NEW_ITEM_ORDER = 3;
const AFTER_ITEM_TITLE = "Taquillas";
const BEFORE_ITEM_TITLE = "Cerraduras";

interface WpMenuItem {
  id: number;
  menu_order: number;
  parent: number;
  title: { rendered: string };
  url: string;
}

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

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getProductionStatusForReport();
  console.log("wordpress-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const config = resolveConfig();
  const authHeader = authHeaderFor(config);

  const res = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items?menus=${MENU_ID}&per_page=100&context=edit&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GET menu-items respondio ${res.status}`);
  const allItems = (await res.json()) as WpMenuItem[];
  const top = allItems.filter((i) => i.parent === 0).sort((a, b) => a.menu_order - b.menu_order);

  console.log("\nMenu principal actual (nivel superior):");
  for (const i of top) console.log(`  order ${i.menu_order} | ${i.id} | ${i.title.rendered}`);

  const afterItem = top.find((i) => i.title.rendered === AFTER_ITEM_TITLE);
  const beforeItem = top.find((i) => i.title.rendered === BEFORE_ITEM_TITLE);
  if (!afterItem || !beforeItem) throw new Error(`No se encontraron los items de referencia \"${AFTER_ITEM_TITLE}\"/\"${BEFORE_ITEM_TITLE}\". Bloqueado.`);
  if (!(afterItem.menu_order < NEW_ITEM_ORDER && NEW_ITEM_ORDER < beforeItem.menu_order)) {
    throw new Error(`El order propuesto (${NEW_ITEM_ORDER}) no queda estrictamente entre \"${AFTER_ITEM_TITLE}\" (${afterItem.menu_order}) y \"${BEFORE_ITEM_TITLE}\" (${beforeItem.menu_order}). Bloqueado.`);
  }
  console.log(`\nHueco libre confirmado: \"${AFTER_ITEM_TITLE}\" (order ${afterItem.menu_order}) < ${NEW_ITEM_ORDER} < \"${BEFORE_ITEM_TITLE}\" (order ${beforeItem.menu_order}) -- 0 items a desplazar.`);
  console.log(`Nuevo item: \"${NEW_ITEM_TITLE}\" -> ${NEW_ITEM_URL}, parent:0, menu_order:${NEW_ITEM_ORDER}`);

  // backup: TODOS los items del menu (no solo nivel superior), snapshot completo antes de escribir.
  const backupPath = `data/o21i-menu-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(allItems, null, 2));
  console.log(`\nBackup escrito: ${backupPath} (${allItems.length} items totales del menu ${MENU_ID})`);

  if (!confirm) {
    console.log("\nDry-run completo. Repite con --confirm (+ flags inline) para crear el item de verdad.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion (pasa los flags inline en el comando).");
    process.exit(1);
    return;
  }

  const createRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: NEW_ITEM_TITLE,
      url: NEW_ITEM_URL,
      status: "publish",
      parent: 0,
      menu_order: NEW_ITEM_ORDER,
      menus: MENU_ID,
      type: "custom",
    }),
  });
  if (!createRes.ok) {
    const bodyText = await createRes.text().catch(() => "");
    throw new Error(`Fallo creando el item de menu: ${createRes.status} ${bodyText.slice(0, 300)}`);
  }
  const created = (await createRes.json()) as { id: number };
  console.log("\n=== CREADO ===");
  console.log("Nuevo menu-item id:", created.id);

  const resultPath = `data/o21i-menu-created-${Date.now()}.json`;
  fs.writeFileSync(resultPath, JSON.stringify({ newItemId: created.id, title: NEW_ITEM_TITLE, url: NEW_ITEM_URL, menuOrder: NEW_ITEM_ORDER, backupPath }, null, 2));
  console.log("Guardado en:", resultPath);

  console.log("\n=== Rollback ===");
  console.log(`npx ts-node scripts/o21i-menu-rollback-production.ts --newItemId ${created.id} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
