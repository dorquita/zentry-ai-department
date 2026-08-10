import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressMedia } from "../src/adapters/wordpress";
import { uploadMediaToProduction, getProductionStatusForReport } from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa E -- sube SOLO las 20 imagenes aprobadas de Bancos
 * (staging -> Media Library de produccion). No crea productos, no
 * asocia nada, no toca menu/paginas/landing/categorias/atributos.
 * Flags de produccion se pasan INLINE en el comando (nunca escritos en
 * .env) -- ver instrucciones de uso mas abajo.
 *
 * Uso:
 *   npx ts-node scripts/o21e-upload-bancos-media.ts            (dry-run: solo confirma que las 20 existen en staging)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o21e-upload-bancos-media.ts --confirm
 */

const MEDIA_GROUPS: Record<string, number[]> = {
  main: [2021, 2027, 2028, 2029, 2024, 2030, 2031, 2032, 2025],
  detail: [2033, 2034, 2036, 2039, 2040, 2041],
  family: [2042, 2043, 2044, 2046],
  heroCrop16x9: [2047],
};

interface MappingEntry {
  group: string;
  stagingMediaId: number;
  filename: string;
  altText: string;
  mimeType: string;
  productionMediaId: number | null;
  productionMediaUrl: string | null;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getProductionStatusForReport();
  console.log("wordpress-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const allIds = Object.entries(MEDIA_GROUPS).flatMap(([group, ids]) => ids.map((id) => ({ group, id })));
  console.log(`Total media a procesar: ${allIds.length} (9 principal + 6 detalle + 4 familia + 1 hero 16:9)`);

  console.log(confirm ? "\n=== ESCRITURA REAL (--confirm) ===" : "\n=== DRY-RUN: confirmando existencia en staging (sin --confirm) ===");

  const mapping: MappingEntry[] = [];

  for (const { group, id } of allIds) {
    const media = await getWordpressMedia(id);
    const filename = media.sourceUrl.split("/").pop() ?? `media-${id}`;
    console.log(`  [${group}] staging ${id} | ${filename} | alt:\"${media.altText}\" | ${media.mimeType} | ${media.width}x${media.height}`);

    if (!confirm) {
      mapping.push({ group, stagingMediaId: id, filename, altText: media.altText, mimeType: media.mimeType, productionMediaId: null, productionMediaUrl: null });
      continue;
    }

    const fileResponse = await fetch(media.sourceUrl);
    if (!fileResponse.ok) {
      throw new Error(`No se pudo descargar de staging la media ${id} (HTTP ${fileResponse.status}).`);
    }
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const uploaded = await uploadMediaToProduction({ fileBuffer, filename, mimeType: media.mimeType, altText: media.altText });
    console.log(`    -> produccion ${uploaded.wordpressMediaId} | ${uploaded.wordpressMediaUrl}`);
    mapping.push({
      group,
      stagingMediaId: id,
      filename,
      altText: media.altText,
      mimeType: media.mimeType,
      productionMediaId: uploaded.wordpressMediaId,
      productionMediaUrl: uploaded.wordpressMediaUrl,
    });
  }

  const outPath = `data/o21e-media-mapping-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2));
  console.log(`\nMapping guardado en: ${outPath}`);

  if (!confirm) {
    console.log("\nDry-run completo -- las 20 existen en staging. Repite con --confirm (+ flags inline) para subir de verdad.");
    return;
  }

  console.log("\n=== IDs de produccion creados ===");
  console.log(mapping.map((m) => `${m.stagingMediaId} -> ${m.productionMediaId}`).join("\n"));

  console.log("\n=== Rollback disponible (NO se borra nada automaticamente) ===");
  console.log("IDs de media de produccion creados en esta etapa (para limpieza manual solo si se aprueba):");
  console.log(mapping.map((m) => m.productionMediaId).join(","));
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
