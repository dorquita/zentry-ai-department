import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, canAttemptProductionWrites } from "../src/adapters/wordpress-production";

/**
 * Correccion puntual pre-Etapa F: el termino 'Unica' del atributo Cara
 * (id 115) se creo en produccion sin tilde por un problema de escritura
 * del script de la Etapa D. count=0 (sin productos asociados todavia),
 * por lo que renombrarlo es seguro. Requiere --confirm + flags inline.
 *
 * Uso:
 *   npx ts-node scripts/o21f-fix-unica-term.ts            (dry-run, solo lee el estado actual)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o21f-fix-unica-term.ts --confirm
 */

const ATTRIBUTE_ID = 10;
const TERM_ID = 115;
const CORRECT_NAME = "\u00danica";

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  const before = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes/${ATTRIBUTE_ID}/terms/${TERM_ID}`, { headers: { Authorization: authHeader } }).then((r) => r.json()) as { name: string; count: number };
  console.log("Termino actual:", JSON.stringify(before));

  if (before.count !== 0) {
    console.error("BLOQUEADO: el termino ya tiene productos asociados (count != 0). No se toca.");
    process.exit(1);
    return;
  }

  if (!confirm) {
    console.log(`Dry-run: se renombraria \"${before.name}\" -> \"${CORRECT_NAME}\". Repite con --confirm (+ flags inline) para aplicar.`);
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion (pasa los flags inline en el comando).");
    process.exit(1);
    return;
  }

  const res = await fetch(`${baseUrl}/wp-json/wc/v3/products/attributes/${ATTRIBUTE_ID}/terms/${TERM_ID}`, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ name: CORRECT_NAME }),
  });
  const after = await res.json() as { name: string; slug: string; count: number };
  console.log("Termino actualizado:", JSON.stringify(after));
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
