import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import {
  getWoocommerceProductionStatusForReport,
  getProductionAttributes,
  createProductionAttribute,
  createProductionAttributeTerm,
} from "../src/adapters/woocommerce-production";

/**
 * O21.5b Etapa D -- crea SOLO los 2 atributos globales (Longitud, Cara)
 * + sus 5 terminos en produccion. No crea productos, no sube media, no
 * toca menu/paginas. Backup de atributos existentes antes de escribir.
 * dry-run obligatorio antes de --confirm.
 *
 * Uso:
 *   npx ts-node scripts/o21d-create-bancos-attributes.ts           (dry-run)
 *   npx ts-node scripts/o21d-create-bancos-attributes.ts --confirm  (real, requiere flags de produccion activos)
 */

const ATTRIBUTES = [
  {
    name: "Longitud",
    slug: "longitud",
    terms: [
      { name: "1000mm", slug: "1000mm" },
      { name: "1500mm", slug: "1500mm" },
      { name: "2000mm", slug: "2000mm" },
    ],
  },
  {
    name: "Cara",
    slug: "cara",
    terms: [
      { name: "Unica", slug: "unica" },
      { name: "Doble", slug: "doble" },
    ],
  },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getWoocommerceProductionStatusForReport();
  console.log("woocommerce-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const before = await getProductionAttributes();
  const backupPath = `data/o21d-attributes-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(before, null, 2));
  console.log(`Backup escrito: ${backupPath} (${before.length} atributos existentes en produccion antes de este cambio)`);

  const dryRun = !confirm;
  console.log(dryRun ? "\n=== DRY-RUN (sin --confirm) ===" : "\n=== ESCRITURA REAL (--confirm) ===");

  const createdIds: Record<string, { attributeId: number; terms: Record<string, number> }> = {};

  for (const attr of ATTRIBUTES) {
    const attrResult = await createProductionAttribute({ name: attr.name, slug: attr.slug, dryRun });
    console.log(`atributo \"${attr.name}\":`, JSON.stringify(attrResult));

    if (dryRun) {
      for (const term of attr.terms) {
        console.log(`  termino \"${term.name}\": dry-run, pendiente del id real del atributo padre`);
      }
      continue;
    }

    const attributeId = attrResult.createdId ?? attrResult.existingId!;
    createdIds[attr.slug] = { attributeId, terms: {} };
    for (const term of attr.terms) {
      const termResult = await createProductionAttributeTerm({ attributeId, name: term.name, slug: term.slug, dryRun: false });
      console.log(`  termino \"${term.name}\":`, JSON.stringify(termResult));
      createdIds[attr.slug].terms[term.slug] = termResult.createdId ?? termResult.existingId!;
    }
  }

  if (dryRun) {
    console.log("\nDry-run completo. Repite con --confirm para escribir de verdad (requiere flags de produccion activos).");
    return;
  }

  console.log("\n=== IDs creados ===");
  console.log(JSON.stringify(createdIds, null, 2));

  const idsPath = `data/o21d-attributes-created-${Date.now()}.json`;
  fs.writeFileSync(idsPath, JSON.stringify(createdIds, null, 2));
  console.log(`Guardado en: ${idsPath}`);

  const attributeIds = Object.values(createdIds).map((c) => c.attributeId);
  console.log("\n=== Rollback (si hace falta) ===");
  console.log(`npx ts-node scripts/o215-rollback-categories-attributes.ts --attributeIds ${attributeIds.join(",")} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
