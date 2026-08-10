import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa A -- corrige blocksy_meta.disable_header en la pagina
 * 1636 (/taquillas-por-sector/) de PRODUCCION: "yes" -> "no". Mismo
 * fix ya aplicado y validado en staging (O21.4b). Cambia SOLO esa
 * clave, deja has_hero_section/styles_descriptor intactos, no toca
 * content/title/status/slug.
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  const getRes = await fetch(`${baseUrl}/wp-json/wp/v2/pages/${PAGE_ID}?context=edit&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!getRes.ok) throw new Error(`GET pagina ${PAGE_ID} respondio ${getRes.status}`);
  const current = (await getRes.json()) as { blocksy_meta: Record<string, unknown> };

  console.log("=== O21.5b Etapa A: corregir disable_header en PRODUCCION (pagina 1636) ===");
  console.log("blocksy_meta ACTUAL:", JSON.stringify(current.blocksy_meta));

  if (current.blocksy_meta?.disable_header !== "yes") {
    console.log(`El valor actual ya no es "yes" (es "${current.blocksy_meta?.disable_header}"). Nada que hacer -- abortando por seguridad.`);
    return;
  }

  const correctedMeta = { ...current.blocksy_meta, disable_header: "no" };
  console.log("blocksy_meta PROPUESTO:", JSON.stringify(correctedMeta));

  if (!args.confirm) {
    console.log("\nSIMULACION: falta --confirm. No se ha escrito nada.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion (PRODUCTION_EXECUTION_ENABLED/PRODUCTION_DRAFTS_ENABLED/PRODUCTION_BACKEND=rest).");
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(`Vas a cambiar disable_header a "no" en la pagina ${PAGE_ID} de PRODUCCION. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario.");
    return;
  }

  const patchRes = await fetch(`${baseUrl}/wp-json/wp/v2/pages/${PAGE_ID}`, {
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
