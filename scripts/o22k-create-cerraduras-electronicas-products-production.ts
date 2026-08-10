import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import {
  getWoocommerceProductionStatusForReport,
  createProductionSimpleProduct,
  getProductionCategories,
  getProductionProduct,
} from "../src/adapters/woocommerce-production";

/**
 * O22 Ajuste -- Etapa B (produccion) -- crea SOLO los 4 productos
 * simples de Cerraduras electronicas en produccion (ARES, ORBIS, BOXIS,
 * NEO), replicando exactamente los datos ya validados en staging (ids
 * 2063-2066, ver o22d-create-cerraduras-electronicas-products-staging.ts).
 * No crea cerraduras mecanicas. No toca el atributo global "Tipo de
 * cerradura" existente -- estos productos no lo usan (son productos
 * simples, no variables). Sin descuento aplicado: regular_price = PVP
 * base tal cual.
 *
 * Requiere que la categoria "cerraduras-electronicas" ya exista en
 * produccion (creada por o22j-create-cerraduras-categories-production.ts)
 * -- la resuelve EN VIVO por slug en cada ejecucion, nunca hardcodea su id.
 *
 * Uso:
 *   npx ts-node scripts/o22k-create-cerraduras-electronicas-products-production.ts                      (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o22k-create-cerraduras-electronicas-products-production.ts --confirm
 */

const COPY = "Cerradura electrónica compatible con taquillas Zentry, tecnología Tukandado.";

const PRODUCTS = [
  { name: "ARES", slug: "ares", sku: "TKD-ARES", regularPrice: "51" },
  { name: "ORBIS", slug: "orbis", sku: "TKD-ORBIS", regularPrice: "39" },
  { name: "BOXIS", slug: "boxis", sku: "TKD-BOXIS", regularPrice: "54" },
  { name: "NEO", slug: "neo", sku: "TKD-NEO", regularPrice: "51" },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getWoocommerceProductionStatusForReport();
  console.log("woocommerce-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const categories = await getProductionCategories();
  const electronicasCategory = categories.find((c) => c.slug === "cerraduras-electronicas");
  if (!electronicasCategory) {
    throw new Error(
      'Categoria "cerraduras-electronicas" no encontrada en produccion. Ejecuta primero o22j-create-cerraduras-categories-production.ts --confirm.'
    );
  }
  console.log(`Categoria "cerraduras-electronicas" resuelta: id ${electronicasCategory.id}`);

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const results: Array<Record<string, unknown>> = [];
  for (const p of PRODUCTS) {
    const result = await createProductionSimpleProduct({
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      regularPrice: p.regularPrice,
      description: COPY,
      categoryIds: [electronicasCategory.id],
      status: "publish",
      dryRun,
    });
    console.log(
      `${p.slug}:`,
      JSON.stringify({ dryRun: result.dryRun, applied: result.applied, alreadyExists: result.alreadyExists, createdId: result.createdId, existingId: result.existingId })
    );
    results.push({ slug: p.slug, name: p.name, sku: p.sku, regularPrice: p.regularPrice, result });
  }

  const outPath = `data/o22k-products-${confirm ? "created" : "dryrun"}-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nGuardado en: ${outPath}`);

  if (!confirm) {
    console.log("\nDry-run completo. Repite con --confirm (+ flags inline) para crear de verdad.");
    return;
  }

  console.log("\n=== IDs creados ===");
  const createdIds: number[] = [];
  for (const r of results) {
    const res = r.result as { createdId?: number; existingId?: number };
    const id = res.createdId ?? res.existingId;
    console.log(`${r.slug}: ${id}`);
    if (id) createdIds.push(id);
  }

  console.log("\n=== Verificacion post-creacion (GET autenticado) ===");
  for (const id of createdIds) {
    const p = await getProductionProduct(id);
    console.log(`  id ${id}: name=${p.name} slug=${p.slug} status=${p.status} type=${p.type}`);
  }

  console.log("\n=== Rollback (si hace falta, mueve a papelera, nunca borra) ===");
  console.log(
    `npx ts-node scripts/o215-rollback-products.ts --productIds ${createdIds.join(",")} --confirm`
  );
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
