import * as readline from "readline";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { assertWordpressWriteAllowed, resolveWordpressTargetUrl, resolveWordpressEnv } from "../src/adapters/wordpress-backend";
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { isWordpressDraftsEnabled, getWordpressStatusForReport } from "../src/adapters/wordpress";
import { resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { logger } from "../src/core/logger";

/**
 * O21.4 -- inserta "Bancos de vestuario" como item de nivel superior en
 * el menu "Menu principal" (id 17, ubicaciones menu_1 + menu_mobile),
 * justo despues del grupo de Taquillas (mismo nivel comercial). Requiere
 * desplazar +1 el menu_order de los items que ya estan en o despues de
 * esa posicion -- unico reordenamiento que se hace, nunca se toca el
 * resto del menu ni se borra nada existente.
 *
 * Backup ya guardado ANTES de ejecutar este script:
 * scratchpad/backups/o214-menu17-backup.json (22 items, snapshot
 * completo via GET context=edit). Rollback: scripts/o214-menu-rollback.ts.
 *
 * Mismo patron de seguridad que el resto del proyecto: dry-run por
 * defecto, solo escribe con --confirm Y WORDPRESS_DRAFTS_ENABLED=true Y
 * WORDPRESS_BACKEND=rest Y WORDPRESS_ENV=staging, y aun asi pide "si"
 * interactivo.
 */

const INSERT_AFTER_ORDER = 9; // "Taquillas exterior" (id 1827)
const NEW_ITEM_ORDER = INSERT_AFTER_ORDER + 1; // 10
const NEW_ITEM_TITLE = "Bancos de vestuario";
const NEW_ITEM_URL = "https://staging.zentrylockers.com/bancos-de-vestuario/";
const MENU_ID = 17;

interface WpMenuItem {
  id: number;
  menu_order: number;
  parent: number;
  title: { raw?: string; rendered?: string };
  url: string;
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

async function fetchCurrentItems(config: WpConfig): Promise<WpMenuItem[]> {
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items?menus=${MENU_ID}&per_page=100&context=edit&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GET menu-items respondio ${res.status}`);
  return (await res.json()) as WpMenuItem[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log("=== O21.4: insertar 'Bancos de vestuario' en Menu principal (staging) ===");
  const current = await fetchCurrentItems(resolveConfig());
  const toShift = current.filter((i) => i.parent === 0 && i.menu_order > INSERT_AFTER_ORDER).sort((a, b) => b.menu_order - a.menu_order);

  console.log(`Items de nivel superior a desplazar +1 (${toShift.length}):`);
  for (const i of toShift) {
    console.log(`  ${i.id} "${i.title.raw ?? i.title.rendered}" order ${i.menu_order} -> ${i.menu_order + 1}`);
  }
  console.log(`Nuevo item: "${NEW_ITEM_TITLE}" -> ${NEW_ITEM_URL}, parent:0, menu_order:${NEW_ITEM_ORDER}`);

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm. No se ha escrito nada.");
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

  const answer = await plainPrompt(
    `Vas a ANADIR "${NEW_ITEM_TITLE}" al Menu principal de STAGING y desplazar ${toShift.length} items existentes. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se ha escrito nada.");
    return;
  }

  const config = resolveConfig();
  const authHeader = authHeaderFor(config);

  for (const item of toShift) {
    const res = await fetch(`${config.baseUrl}/wp-json/wp/v2/menu-items/${item.id}`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ menu_order: item.menu_order + 1 }),
    });
    if (!res.ok) {
      console.error(`Fallo desplazando el item ${item.id}: ${res.status}. DETENIDO -- revisar manualmente con el backup.`);
      process.exit(1);
      return;
    }
    console.log(`  desplazado: ${item.id} -> order ${item.menu_order + 1}`);
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
    const bodyText = await createRes.text();
    console.error(`Fallo creando el nuevo item de menu: ${createRes.status} ${bodyText.slice(0, 300)}`);
    process.exit(1);
    return;
  }
  const created = (await createRes.json()) as { id: number };
  console.log(`--- CREADO ---`);
  console.log(`Nuevo menu-item id: ${created.id}`);
  logger.info("o214: item de menu creado en staging", { menuItemId: created.id, menuId: MENU_ID });
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
