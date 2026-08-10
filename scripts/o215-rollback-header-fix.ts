import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5a -- ROLLBACK preparado, NO ejecutado todavia. Revierte
 * blocksy_meta.disable_header de la pagina 1636 en produccion de "no"
 * de vuelta a "yes" (estado original antes de la Etapa A del deploy).
 * Mismo patron dry-run+confirm que el resto del proyecto.
 *
 * Uso:
 *   npx ts-node scripts/o215-rollback-header-fix.ts
 *   npx ts-node scripts/o215-rollback-header-fix.ts --confirm
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
    headers: { Authorization: authHeader, "Cache-Control": "no-cache" },
  });
  const current = (await getRes.json()) as { blocksy_meta: Record<string, unknown> };
  console.log("=== O21.5 ROLLBACK: restaurar disable_header en produccion (pagina 1636) ===");
  console.log("blocksy_meta ACTUAL:", JSON.stringify(current.blocksy_meta));

  if (current.blocksy_meta?.disable_header !== "no") {
    console.log(`disable_header ya no es "no" (es "${current.blocksy_meta?.disable_header}"). Nada que revertir.`);
    return;
  }
  const reverted = { ...current.blocksy_meta, disable_header: "yes" };
  console.log("blocksy_meta PROPUESTO (rollback):", JSON.stringify(reverted));

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion (PRODUCTION_EXECUTION_ENABLED/PRODUCTION_DRAFTS_ENABLED/PRODUCTION_BACKEND=rest).");
    process.exit(1);
    return;
  }
  const answer = await plainPrompt(`Vas a REVERTIR disable_header a "yes" en la pagina ${PAGE_ID} de PRODUCCION. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  const patchRes = await fetch(`${baseUrl}/wp-json/wp/v2/pages/${PAGE_ID}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ blocksy_meta: reverted }),
  });
  if (!patchRes.ok) {
    console.error("Fallo:", patchRes.status, (await patchRes.text()).slice(0, 300));
    process.exit(1);
    return;
  }
  console.log("--- ROLLBACK APLICADO ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
