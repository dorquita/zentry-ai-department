import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { getWoocommerceProductionStatusForReport, createProductionCategory, getProductionCategories } from "../src/adapters/woocommerce-production";

/**
 * O22 Ajuste -- Etapa A (produccion) -- crea SOLO las 4 categorias de
 * Cerraduras en produccion (1 padre + 3 hijas), replicando exactamente
 * la estructura ya validada en staging (ids 117-120, ver
 * o22c-create-cerraduras-categories-staging.ts). No crea productos ni
 * atributos. No toca el atributo global "Tipo de cerradura" existente.
 * Backup de categorias existentes antes de escribir. dry-run
 * obligatorio antes de --confirm.
 *
 * Uso:
 *   npx ts-node scripts/o22j-create-cerraduras-categories-production.ts                      (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o22j-create-cerraduras-categories-production.ts --confirm
 */

const PARENT = { name: "Cerraduras", slug: "cerraduras" };
const CHILDREN = [
  { name: "Cerraduras electrónicas", slug: "cerraduras-electronicas" },
  { name: "Cerraduras mecánicas", slug: "cerraduras-mecanicas" },
  { name: "Cerraduras para taquillas", slug: "cerraduras-para-taquillas" },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getWoocommerceProductionStatusForReport();
  console.log("woocommerce-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const before = await getProductionCategories();
  const backupPath = `data/o22j-categories-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(before, null, 2));
  console.log(`Backup escrito: ${backupPath} (${before.length} categorias existentes en produccion antes de este cambio)`);

  const existingCerraduras = before.filter((c) => c.slug.startsWith("cerraduras"));
  if (existingCerraduras.length > 0) {
    console.log("AVISO: ya existen categorias 'cerraduras*' en produccion:", JSON.stringify(existingCerraduras));
  }

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const parentResult = await createProductionCategory({ name: PARENT.name, slug: PARENT.slug, parent: 0, dryRun });
  console.log("padre:", JSON.stringify(parentResult));

  if (dryRun) {
    for (const child of CHILDREN) {
      const r = await createProductionCategory({ name: child.name, slug: child.slug, parent: 0, dryRun: true });
      console.log(`hija (${child.slug}):`, JSON.stringify(r));
    }
    console.log("\nDry-run completo. Repite con --confirm (+ flags inline) para escribir de verdad.");
    return;
  }

  const parentId = parentResult.createdId ?? parentResult.existingId!;
  const createdIds: Record<string, number> = { [PARENT.slug]: parentId };
  for (const child of CHILDREN) {
    const r = await createProductionCategory({ name: child.name, slug: child.slug, parent: parentId, dryRun: false });
    console.log(`hija (${child.slug}):`, JSON.stringify(r));
    createdIds[child.slug] = r.createdId ?? r.existingId!;
  }

  console.log("\n=== IDs creados ===");
  console.log(JSON.stringify(createdIds, null, 2));

  const idsPath = `data/o22j-categories-created-${Date.now()}.json`;
  fs.writeFileSync(idsPath, JSON.stringify(createdIds, null, 2));
  console.log(`Guardado en: ${idsPath}`);

  console.log("\n=== Rollback (si hace falta, solo si count=0 en cada una) ===");
  console.log(
    `npx ts-node scripts/o215-rollback-categories-attributes.ts --categoryIds ${Object.values(createdIds).join(",")} --confirm`
  );
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
