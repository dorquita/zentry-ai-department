import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { isWordpressDraftsEnabled, getWordpressStatusForReport } from "../src/adapters/wordpress";
import { assertWordpressWriteAllowed, resolveWordpressTargetUrl, resolveWordpressEnv, resolveWordpressBackend } from "../src/adapters/wordpress-backend";
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";

/**
 * O21.4b -- causa exacta encontrada: la pagina 1636 (/taquillas-por-sector/)
 * tiene blocksy_meta.disable_header = "yes" (campo REST expuesto por el
 * tema Blocksy, registrado con register_rest_field). Todas las demas
 * paginas comparadas (22, 108, 2048) NO tienen esa clave o la tienen en
 * "no". Fix quirurgico: cambiar SOLO esa clave a "no", dejando el resto
 * de blocksy_meta (has_hero_section, styles_descriptor) exactamente
 * igual -- no se toca content/title/status/slug/enlace interno anadido
 * en O21.4.
 */

const PAGE_ID = 1636;

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConfig();
  const authHeader = authHeaderFor(config);

  const getRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/pages/${PAGE_ID}?context=edit&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!getRes.ok) throw new Error(`GET pagina ${PAGE_ID} respondio ${getRes.status}`);
  const current = (await getRes.json()) as { blocksy_meta: Record<string, unknown> };

  console.log("=== O21.4b: corregir blocksy_meta.disable_header en pagina 1636 ===");
  console.log("blocksy_meta ACTUAL:", JSON.stringify(current.blocksy_meta));

  if (current.blocksy_meta?.disable_header !== "yes") {
    console.log(`El valor actual de disable_header ya no es "yes" (es "${current.blocksy_meta?.disable_header}"). Nada que hacer -- abortando por seguridad.`);
    return;
  }

  const correctedMeta = { ...current.blocksy_meta, disable_header: "no" };
  console.log("blocksy_meta PROPUESTO:", JSON.stringify(correctedMeta));

  if (!args.confirm) {
    console.log("\nSIMULACION: falta --confirm. No se ha escrito nada.");
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

  const answer = await plainPrompt(`Vas a cambiar disable_header a "no" en la pagina ${PAGE_ID} de STAGING. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario.");
    return;
  }

  const patchRes = await fetch(`${config.baseUrl}/wp-json/wp/v2/pages/${PAGE_ID}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ blocksy_meta: correctedMeta }),
  });
  if (!patchRes.ok) {
    const bodyText = await patchRes.text();
    console.error(`Fallo: ${patchRes.status} ${bodyText.slice(0, 500)}`);
    process.exit(1);
    return;
  }
  const updated = (await patchRes.json()) as { id: number; blocksy_meta: Record<string, unknown> };
  console.log("--- ACTUALIZADO ---");
  console.log("blocksy_meta tras la escritura:", JSON.stringify(updated.blocksy_meta));
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
