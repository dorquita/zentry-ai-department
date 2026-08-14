import * as dotenv from "dotenv";
dotenv.config();
import { getGoogleAdsSnapshot } from "../src/adapters/google-ads";

/**
 * Fase O32.1 -- complemento de solo lectura al informe de sem-watcher.ts
 * (que trunca las keywords positivas a las primeras 20 y solo da un
 * conteo de negativas). Aqui se listan TODAS las positivas, TODAS las
 * negativas (agrupadas por nivel), y los textos completos de los 4
 * anuncios RSA -- necesario para el punto 3 de la auditoria de Pau
 * (concordancias, negativas, anuncios completos). Misma funcion de
 * solo lectura que ya usa sem-watcher.ts.
 *
 * Uso: npx ts-node scripts/o321-dump-keywords-ads.ts
 */
async function main(): Promise<void> {
  const snapshot = await getGoogleAdsSnapshot();

  const adGroupById = new Map(snapshot.adGroups.map((ag) => [ag.id, ag]));

  console.log(`\n=== TODAS las keywords positivas (${snapshot.positiveKeywords.length}) ===\n`);
  for (const k of snapshot.positiveKeywords) {
    const ag = adGroupById.get(k.adGroupId);
    console.log(`  [${k.status}] "${k.text}" (${k.matchType}) -- ad group: ${ag?.name ?? k.adGroupId}`);
  }

  const negAdGroup = snapshot.negativeKeywords.filter((k) => k.level === "ad_group");
  const negCampaign = snapshot.negativeKeywords.filter((k) => k.level === "campaign");

  console.log(`\n=== Negativas a nivel de AD GROUP (${negAdGroup.length}) ===\n`);
  for (const k of negAdGroup) {
    const ag = adGroupById.get(k.adGroupId);
    console.log(`  "${k.text}" (${k.matchType}) -- ad group: ${ag?.name ?? k.adGroupId}`);
  }

  console.log(`\n=== Negativas a nivel de CAMPAÑA (${negCampaign.length}) ===\n`);
  for (const k of negCampaign) {
    console.log(`  "${k.text}" (${k.matchType})`);
  }

  console.log(`\n=== Anuncios RSA completos (${snapshot.ads.length}) ===\n`);
  for (const ad of snapshot.ads) {
    const ag = adGroupById.get(ad.adGroupId);
    console.log(`\n-- Ad ${ad.adId} [${ad.status}] -- ad group: ${ag?.name ?? ad.adGroupId} --`);
    console.log(`  Titulares (${ad.headlines.length}):`);
    for (const h of ad.headlines) console.log(`    - ${h}`);
    console.log(`  Descripciones (${ad.descriptions.length}):`);
    for (const d of ad.descriptions) console.log(`    - ${d}`);
  }

  console.log(`\nOK -- solo lectura (googleAds:search), ninguna mutacion, nada modificado.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
