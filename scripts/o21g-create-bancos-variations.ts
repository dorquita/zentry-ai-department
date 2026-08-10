import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import {
  getWoocommerceProductionStatusForReport,
  createProductionVariation,
} from "../src/adapters/woocommerce-production";

/**
 * O21.5b Etapa G -- crea SOLO las 45 variaciones de los 9 productos
 * padre de Bancos ya creados en produccion (Etapa F). No crea
 * productos padre nuevos, no toca media/landing/menu/enlaces
 * internos/taquillas/cerraduras. Datos leidos EN VIVO de staging en
 * cada ejecucion (sku, precio, atributos, stock_status, descripcion,
 * imagen) -- nunca hardcodeados. El mapping staging->produccion de
 * producto padre se construye a partir de data/o21f-products-created-*.json
 * (por slug, nunca por coincidencia numerica de IDs entre entornos).
 *
 * Uso:
 *   npx ts-node scripts/o21g-create-bancos-variations.ts                                     (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o21g-create-bancos-variations.ts --confirm
 */

const STAGING_BASE = "https://staging.zentrylockers.com";
const STAGING_PRODUCT_IDS = [1966, 1970, 1977, 1984, 1988, 1995, 2002, 2006, 2013];
const PRODUCTS_CREATED_PATH = "data/o21f-products-created-1786133549982.json";
const MEDIA_MAPPING_PATH = "data/o21e-media-mapping-1786132769365.json";

const ATTRIBUTE_MAP: Record<string, number> = {
  Longitud: 9,
  Cara: 10,
};

interface StagingConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}
function resolveStagingConfig(): StagingConfig {
  const activeClientId = resolveActiveClientId();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_APP_PASSWORD");
  return { baseUrl: STAGING_BASE, username, appPassword };
}
function stagingAuthHeader(config: StagingConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}
async function stagingGet<T>(path: string): Promise<T> {
  const config = resolveStagingConfig();
  const res = await fetch(`${config.baseUrl}${path}`, { headers: { Authorization: stagingAuthHeader(config) } });
  if (!res.ok) throw new Error(`GET staging ${path} respondio ${res.status}`);
  return (await res.json()) as T;
}

interface StagingVariation {
  id: number;
  sku: string;
  regular_price: string;
  stock_status: string;
  description: string;
  image: { id: number } | null;
  attributes: Array<{ id: number; name: string; option: string }>;
}

interface ProductCreatedEntry {
  slug: string;
  result: { createdId?: number; existingId?: number };
}

interface MediaMappingEntry {
  stagingMediaId: number;
  productionMediaId: number | null;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getWoocommerceProductionStatusForReport();
  console.log("woocommerce-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const productsCreated: ProductCreatedEntry[] = JSON.parse(fs.readFileSync(PRODUCTS_CREATED_PATH, "utf-8"));
  const productionIdBySlug = new Map(productsCreated.map((p) => [p.slug, p.result.createdId ?? p.result.existingId]));

  const mediaMapping: MediaMappingEntry[] = JSON.parse(fs.readFileSync(MEDIA_MAPPING_PATH, "utf-8"));
  const mediaMap = new Map(mediaMapping.map((m) => [m.stagingMediaId, m.productionMediaId]));

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const results: Array<Record<string, unknown>> = [];

  for (const stagingProductId of STAGING_PRODUCT_IDS) {
    const p = await stagingGet<{ slug: string }>(`/wp-json/wc/v3/products/${stagingProductId}`);
    const productionProductId = productionIdBySlug.get(p.slug);
    if (!productionProductId) throw new Error(`Producto padre de produccion no encontrado para slug ${p.slug}`);

    const variations = await stagingGet<StagingVariation[]>(`/wp-json/wc/v3/products/${stagingProductId}/variations?per_page=100`);
    console.log(`\n--- ${p.slug} (produccion ${productionProductId}) -- ${variations.length} variaciones ---`);

    for (const v of variations) {
      const attributes = v.attributes.map((a) => {
        const mappedId = ATTRIBUTE_MAP[a.name];
        if (!mappedId) throw new Error(`Atributo staging sin mapping a produccion: ${a.name} (variacion ${v.sku})`);
        return { id: mappedId, option: a.option };
      });

      let imageId: number | undefined;
      if (v.image) {
        const mapped = mediaMap.get(v.image.id);
        if (mapped === undefined || mapped === null) throw new Error(`Media staging sin mapping a produccion: ${v.image.id} (variacion ${v.sku})`);
        imageId = mapped;
      }

      const result = await createProductionVariation({
        productId: productionProductId,
        sku: v.sku,
        regularPrice: v.regular_price,
        attributes,
        stockStatus: v.stock_status,
        description: v.description,
        imageId,
        dryRun,
      });

      console.log(
        `  ${v.sku}:`,
        JSON.stringify({ dryRun: result.dryRun, applied: result.applied, alreadyExists: result.alreadyExists, createdId: result.createdId, existingId: result.existingId })
      );
      results.push({ productSlug: p.slug, productionProductId, sku: v.sku, regularPrice: v.regular_price, attributes, imageId, result });
    }
  }

  const outPath = `data/o21g-variations-${confirm ? "created" : "dryrun"}-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nGuardado en: ${outPath}`);

  if (!confirm) {
    console.log("\nDry-run completo. Repite con --confirm (+ flags inline) para crear de verdad.");
    return;
  }

  console.log("\n=== IDs de variacion creados por producto ===");
  const rollbackPairs: string[] = [];
  for (const r of results) {
    const res = r.result as { createdId?: number; existingId?: number };
    const id = res.createdId ?? res.existingId;
    const slug = r.productSlug as string;
    const productionProductId = r.productionProductId as number;
    console.log(`${slug} | ${r.sku}: ${id}`);
    if (id) rollbackPairs.push(`${productionProductId}:${id}`);
  }

  console.log("\n=== Rollback (elimina SOLO las variaciones, nunca los productos padre) ===");
  console.log(`npx ts-node scripts/o21g-rollback-variations.ts --variationIds ${rollbackPairs.join(",")}`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
