import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * O21.5a -- ROLLBACK preparado, NO ejecutado todavia (la landing de
 * produccion no existe hasta O21.5b). Mueve la pagina a la papelera
 * SOLO si su status actual es "draft" (el caso esperado, ya que este
 * proyecto nunca publica produccion automaticamente). Si ya esta
 * "publish" (porque Pau la publico manualmente), este script se niega y
 * pide la reversion manual desde wp-admin -- coherente con que la
 * publicacion en produccion es siempre una decision humana.
 *
 * Uso:
 *   npx ts-node scripts/o215-rollback-landing.ts --pageId <id>
 *   npx ts-node scripts/o215-rollback-landing.ts --pageId <id> --confirm
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
  const pageId = Number(args.pageId);
  if (!Number.isInteger(pageId)) {
    console.error("Uso: --pageId <numero> [--confirm]");
    process.exit(1);
    return;
  }

  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  const getRes = await fetch(`${baseUrl}/wp-json/wp/v2/pages/${pageId}?context=edit&_cb=${Date.now()}`, { headers: { Authorization: authHeader, "Cache-Control": "no-cache" } });
  if (!getRes.ok) {
    console.error(`GET pagina ${pageId} respondio ${getRes.status}`);
    process.exit(1);
    return;
  }
  const page = (await getRes.json()) as { status: string; title: { rendered: string } };
  console.log("=== O21.5 ROLLBACK: landing de PRODUCCION ===");
  console.log(`Pagina ${pageId}: "${page.title.rendered}" -- status actual: "${page.status}"`);

  if (page.status !== "draft") {
    console.error(
      `Bloqueado: la pagina esta en status "${page.status}" (no "draft"). Si ya fue publicada manualmente, la reversion tambien debe ser manual desde wp-admin (Mover a borrador / Papelera) -- este proyecto no cambia el status de una pagina publicada de produccion.`
    );
    return;
  }

  if (!args.confirm) {
    console.log("SIMULACION: falta --confirm. Accion propuesta: mover a papelera (DELETE sin force, reversible desde la Papelera de wp-admin).");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion.");
    process.exit(1);
    return;
  }
  const answer = await plainPrompt(`Vas a MOVER A PAPELERA la pagina ${pageId} de PRODUCCION. Escribe "si" para confirmar: `);
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado.");
    return;
  }
  const delRes = await fetch(`${baseUrl}/wp-json/wp/v2/pages/${pageId}?force=false`, { method: "DELETE", headers: { Authorization: authHeader } });
  if (!delRes.ok) {
    console.error("Fallo:", delRes.status, (await delRes.text()).slice(0, 300));
    process.exit(1);
    return;
  }
  console.log("--- MOVIDA A PAPELERA ---");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
