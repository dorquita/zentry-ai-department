import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import {
  getWoocommerceStagingCatalogStatusForReport,
  createStagingSimpleProduct,
  getStagingCategories,
  getStagingProduct,
} from "../src/adapters/woocommerce-staging-catalog";

/**
 * O22.3 Etapa D -- crea SOLO los 4 productos simples de Cerraduras
 * electronicas en staging (ARES, ORBIS, BOXIS, NEO). No crea
 * cerraduras mecanicas. No toca el atributo global "Tipo de
 * cerradura" (id 4) existente -- estos productos no lo usan (son
 * productos simples, no variables). No se aplica ningun descuento
 * comercial: regular_price = PVP base dado por Pau; los descuentos
 * (hasta 40%, segun cantidad/cliente) se gestionan comercialmente
 * fuera de WooCommerce.
 *
 * Requiere que la categoria "cerraduras-electronicas" ya exista
 * (creada por o22c-create-cerraduras-categories-staging.ts) -- la
 * resuelve EN VIVO por slug en cada ejecucion, nunca hardcodea su id.
 *
 * Uso:
 *   npx ts-node scripts/o22d-create-cerraduras-electronicas-products-staging.ts                      (dry-run)
 *   STAGING_EXECUTION_ENABLED=true WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o22d-create-cerraduras-electronicas-products-staging.ts --confirm
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
  const status = getWoocommerceStagingCatalogStatusForReport();
  console.log("woocommerce-staging-catalog canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const categories = await getStagingCategories();
  const electronicasCategory = categories.find((c) => c.slug === "cerraduras-electronicas");
  if (!electronicasCategory) {
    throw new Error(
      'Categoria "cerraduras-electronicas" no encontrada en staging. Ejecuta primero o22c-create-cerraduras-categories-staging.ts --confirm.'
    );
  }
  console.log(`Categoria "cerraduras-electronicas" resuelta: id ${electronicasCategory.id}`);

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const results: Array<Record<string, unknown>> = [];
  for (const p of PRODUCTS) {
    const result = await createStagingSimpleProduct({
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

  const outPath = `data/o22d-products-${confirm ? "created" : "dryrun"}-${Date.now()}.json`;
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
    const p = await getStagingProduct(id);
    console.log(
      `  id ${id}: name=${p.name} slug=${p.slug} sku=${p.sku} status=${p.status} type=${p.type} regular_price=${p.regular_price} categorias=${p.categories.map((c) => c.slug).join(",")}`
    );
  }

  console.log("\n=== Rollback (si hace falta, mueve a papelera, nunca borra) ===");
  console.log(
    `STAGING_EXECUTION_ENABLED=true WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o22-rollback-products-staging.ts --productIds ${createdIds.join(",")} --confirm`
  );
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
