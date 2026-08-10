import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { getWoocommerceProductionStatusForReport, createProductionCategory, getProductionCategories } from "../src/adapters/woocommerce-production";

/**
 * O21.5b Etapa C -- crea SOLO las 4 categorias de Bancos en produccion
 * (1 padre + 3 hijas). No crea productos. Backup de categorias
 * existentes antes de escribir. dry-run obligatorio antes de --confirm.
 *
 * Uso:
 *   npx ts-node scripts/o21c-create-bancos-categories.ts           (dry-run)
 *   npx ts-node scripts/o21c-create-bancos-categories.ts --confirm  (real, requiere flags de produccion activos)
 */

const CATEGORIES = [
  { name: "Bancos de vestuario", slug: "bancos-de-vestuario" },
  { name: "Bancos de melamina", slug: "bancos-de-melamina" },
  { name: "Bancos de pino", slug: "bancos-de-pino" },
  { name: "Bancos fenolicos", slug: "bancos-de-fenolicos" },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getWoocommerceProductionStatusForReport();
  console.log("woocommerce-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const before = await getProductionCategories();
  const backupPath = `data/o21c-categories-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(before, null, 2));
  console.log(`Backup escrito: ${backupPath} (${before.length} categorias existentes en produccion antes de este cambio)`);

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const parentResult = await createProductionCategory({ name: CATEGORIES[0].name, slug: CATEGORIES[0].slug, parent: 0, dryRun });
  console.log("padre:", JSON.stringify(parentResult));

  if (dryRun) {
    for (const child of CATEGORIES.slice(1)) {
      const r = await createProductionCategory({ name: child.name, slug: child.slug, parent: 0, dryRun: true });
      console.log(`hija (${child.slug}):`, JSON.stringify(r));
    }
    console.log("\nDry-run completo. Repite con --confirm para escribir de verdad (requiere flags de produccion activos).");
    return;
  }

  const parentId = parentResult.createdId ?? parentResult.existingId!;
  const createdIds: Record<string, number> = { [CATEGORIES[0].slug]: parentId };
  for (const child of CATEGORIES.slice(1)) {
    const r = await createProductionCategory({ name: child.name, slug: child.slug, parent: parentId, dryRun: false });
    console.log(`hija (${child.slug}):`, JSON.stringify(r));
    createdIds[child.slug] = r.createdId ?? r.existingId!;
  }

  console.log("\n=== IDs creados ===");
  console.log(JSON.stringify(createdIds, null, 2));

  const idsPath = `data/o21c-categories-created-${Date.now()}.json`;
  fs.writeFileSync(idsPath, JSON.stringify(createdIds, null, 2));
  console.log(`Guardado en: ${idsPath}`);

  console.log("\n=== Rollback (si hace falta) ===");
  console.log(`npx ts-node scripts/o215-rollback-categories-attributes.ts --categoryIds ${Object.values(createdIds).join(",")} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
