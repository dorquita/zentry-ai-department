import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import {
  getWoocommerceProductionStatusForReport,
  createProductionVariableProduct,
} from "../src/adapters/woocommerce-production";

/**
 * O21.5b Etapa F -- crea SOLO los 9 productos padre (type=variable) de
 * Bancos en produccion, con atributos configurados pero SIN crear
 * variaciones. Reutiliza categorias (Etapa C), atributos (Etapa D) y
 * el mapping de media ya subida (Etapa E). No toca menu, landing,
 * enlaces internos, taquillas ni cerraduras. Datos (nombre, slug, sku,
 * descripcion, categorias, atributos, imagenes) leidos EN VIVO de
 * staging en cada ejecucion -- nunca hardcodeados.
 *
 * Uso:
 *   npx ts-node scripts/o21f-create-bancos-parent-products.ts                                     (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o21f-create-bancos-parent-products.ts --confirm
 */

const STAGING_BASE = "https://staging.zentrylockers.com";
const STAGING_PRODUCT_IDS = [1966, 1970, 1977, 1984, 1988, 1995, 2002, 2006, 2013];

const CATEGORY_MAP: Record<string, number> = {
  "bancos-de-vestuario": 108,
  "bancos-de-melamina": 109,
  "bancos-de-pino": 110,
  "bancos-de-fenolicos": 111,
};

const ATTRIBUTE_MAP: Record<string, number> = {
  Longitud: 9,
  Cara: 10,
};

const MEDIA_MAPPING_PATH = "data/o21e-media-mapping-1786132769365.json";

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

interface StagingProduct {
  id: number;
  name: string;
  slug: string;
  sku: string;
  status: string;
  description: string;
  short_description: string;
  categories: Array<{ id: number; slug: string }>;
  attributes: Array<{ id: number; name: string; options: string[]; variation: boolean; visible: boolean }>;
  images: Array<{ id: number }>;
}

interface MediaMappingEntry {
  stagingMediaId: number;
  productionMediaId: number | null;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getWoocommerceProductionStatusForReport();
  console.log("woocommerce-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const mediaMapping: MediaMappingEntry[] = JSON.parse(fs.readFileSync(MEDIA_MAPPING_PATH, "utf-8"));
  const mediaMap = new Map(mediaMapping.map((m) => [m.stagingMediaId, m.productionMediaId]));

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const results: Array<Record<string, unknown>> = [];

  for (const stagingId of STAGING_PRODUCT_IDS) {
    const p = await stagingGet<StagingProduct>(`/wp-json/wc/v3/products/${stagingId}`);

    const categoryIds = p.categories.map((c) => {
      const mapped = CATEGORY_MAP[c.slug];
      if (!mapped) throw new Error(`Categoria staging sin mapping a produccion: ${c.slug} (producto ${p.slug})`);
      return mapped;
    });

    const attributes = p.attributes.map((a) => {
      const mappedId = ATTRIBUTE_MAP[a.name];
      if (!mappedId) throw new Error(`Atributo staging sin mapping a produccion: ${a.name} (producto ${p.slug})`);
      return { id: mappedId, name: a.name, options: a.options, variation: a.variation, visible: a.visible };
    });

    const imageIds = p.images.map((img) => {
      const mapped = mediaMap.get(img.id);
      if (mapped === undefined || mapped === null) throw new Error(`Media staging sin mapping a produccion: ${img.id} (producto ${p.slug})`);
      return mapped;
    });

    const result = await createProductionVariableProduct({
      name: p.name,
      slug: p.slug,
      description: p.description,
      shortDescription: p.short_description,
      categoryIds,
      attributes,
      imageIds,
      sku: p.sku,
      status: p.status,
      dryRun,
    });

    console.log(
      `${p.slug}:`,
      JSON.stringify({ dryRun: result.dryRun, applied: result.applied, alreadyExists: result.alreadyExists, createdId: result.createdId, existingId: result.existingId })
    );
    results.push({ stagingId, slug: p.slug, name: p.name, sku: p.sku, status: p.status, categoryIds, attributeNames: attributes.map((a) => a.name), imageIds, result });
  }

  const outPath = `data/o21f-products-${confirm ? "created" : "dryrun"}-${Date.now()}.json`;
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

  console.log("\n=== Rollback (si hace falta, mueve a papelera, nunca borra) ===");
  console.log(`npx ts-node scripts/o215-rollback-products.ts --productIds ${createdIds.join(",")} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
