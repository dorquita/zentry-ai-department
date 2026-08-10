import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import {
  getWoocommerceStagingCatalogStatusForReport,
  createStagingCategory,
  getStagingCategories,
} from "../src/adapters/woocommerce-staging-catalog";

/**
 * O22.3 Etapa C -- crea SOLO las categorias de Cerraduras en staging
 * (1 padre + 3 hijas). No crea productos ni atributos. No toca el
 * atributo global "Tipo de cerradura" (id 4) existente. Backup de
 * categorias existentes antes de escribir. dry-run obligatorio antes
 * de --confirm.
 *
 * Uso:
 *   npx ts-node scripts/o22c-create-cerraduras-categories-staging.ts                      (dry-run)
 *   STAGING_EXECUTION_ENABLED=true WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o22c-create-cerraduras-categories-staging.ts --confirm
 */

const PARENT = { name: "Cerraduras", slug: "cerraduras" };
const CHILDREN = [
  { name: "Cerraduras electrónicas", slug: "cerraduras-electronicas" },
  { name: "Cerraduras mecánicas", slug: "cerraduras-mecanicas" },
  { name: "Cerraduras para taquillas", slug: "cerraduras-para-taquillas" },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getWoocommerceStagingCatalogStatusForReport();
  console.log("woocommerce-staging-catalog canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const before = await getStagingCategories();
  const backupPath = `data/o22c-categories-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(before, null, 2));
  console.log(`Backup escrito: ${backupPath} (${before.length} categorias existentes en staging antes de este cambio)`);

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const parentResult = await createStagingCategory({ name: PARENT.name, slug: PARENT.slug, parent: 0, dryRun });
  console.log("padre:", JSON.stringify(parentResult));

  if (dryRun) {
    for (const child of CHILDREN) {
      const r = await createStagingCategory({ name: child.name, slug: child.slug, parent: 0, dryRun: true });
      console.log(`hija (${child.slug}):`, JSON.stringify(r));
    }
    console.log("\nDry-run completo. Repite con --confirm (+ flags inline) para escribir de verdad.");
    return;
  }

  const parentId = parentResult.createdId ?? parentResult.existingId!;
  const createdIds: Record<string, number> = { [PARENT.slug]: parentId };
  for (const child of CHILDREN) {
    const r = await createStagingCategory({ name: child.name, slug: child.slug, parent: parentId, dryRun: false });
    console.log(`hija (${child.slug}):`, JSON.stringify(r));
    createdIds[child.slug] = r.createdId ?? r.existingId!;
  }

  console.log("\n=== IDs creados ===");
  console.log(JSON.stringify(createdIds, null, 2));

  const idsPath = `data/o22c-categories-created-${Date.now()}.json`;
  fs.writeFileSync(idsPath, JSON.stringify(createdIds, null, 2));
  console.log(`Guardado en: ${idsPath}`);

  console.log("\n=== Rollback (si hace falta, solo si count=0 en cada una) ===");
  console.log(
    `STAGING_EXECUTION_ENABLED=true WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o22-rollback-categories-staging.ts --categoryIds ${Object.values(createdIds).join(",")} --confirm`
  );
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
