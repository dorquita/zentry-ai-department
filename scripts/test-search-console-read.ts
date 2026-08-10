/**
 * Prueba manual de conexion a Google Search Console. SOLO LECTURA.
 *
 * No se ejecuta automaticamente como parte de `npm run seo:watch`. Requiere
 * credenciales configuradas en un `.env` real (nunca en `.env.example`,
 * nunca commiteado). Ejecutar explicitamente con:
 *
 *   npm run test:search-console
 *
 * Que hace:
 *   1. Lista los sitios accesibles con las credenciales configuradas
 *      (searchconsole.sites.list — solo lectura).
 *   2. Lanza una consulta pequena (searchanalytics.query, ventana fija de
 *      endDate=ayer / startDate=hace 7 dias, hasta 5 filas) para confirmar
 *      que la lectura de metricas funciona.
 *
 * Que NO hace:
 *   - No escribe nada en Search Console.
 *   - No toca WordPress, Google Ads, GA4, GTM ni n8n.
 *   - No imprime tokens, client secret, refresh token ni contenido de
 *     ficheros de credenciales.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { listAccessibleSites, getSearchConsoleData } from "../src/adapters/search-console";

function shiftDateUTC(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("=== Test de lectura: Google Search Console ===");
  console.log(`Metodo de autenticacion: ${process.env.GSC_AUTH_METHOD ?? "service_account"}`);
  console.log(`Site URL configurada: ${process.env.GSC_SITE_URL ?? "(no configurada)"}`);
  console.log("");

  console.log("1) Listando sitios accesibles (solo lectura)...");
  const sites = await listAccessibleSites();
  if (sites.length === 0) {
    console.log("   No se encontraron sitios accesibles con estas credenciales.");
  } else {
    console.log(`   Sitios accesibles (${sites.length}):`);
    for (const site of sites) console.log(`   - ${site}`);
  }

  // Ventana fija de prueba: endDate = ayer, startDate = hace 7 dias (ambas
  // calculadas desde "hoy", no encadenadas entre si). Se fuerza aqui para
  // que este test sea siempre pequeno y predecible, independientemente de
  // lo que haya (o no) en GSC_START_DATE/GSC_END_DATE del .env real.
  const todayStr = new Date().toISOString().slice(0, 10);
  const testEndDate = shiftDateUTC(todayStr, -1);
  const testStartDate = shiftDateUTC(todayStr, -7);

  console.log("");
  console.log(`2) Consultando searchanalytics (${testStartDate} a ${testEndDate}, hasta 5 filas)...`);

  const original = {
    GSC_ROW_LIMIT: process.env.GSC_ROW_LIMIT,
    GSC_START_DATE: process.env.GSC_START_DATE,
    GSC_END_DATE: process.env.GSC_END_DATE,
  };
  process.env.GSC_ROW_LIMIT = "5";
  process.env.GSC_START_DATE = testStartDate;
  process.env.GSC_END_DATE = testEndDate;

  const { rows, siteUrl, analysisStartDate, analysisEndDate } = await getSearchConsoleData();

  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  console.log(`   Sitio: ${siteUrl} | Rango real usado: ${analysisStartDate} a ${analysisEndDate}`);
  console.log(`   Filas devueltas: ${rows.length}`);
  for (const row of rows) {
    console.log(
      `   - "${row.query}" | ${row.page} | pos=${row.position.toFixed(1)} | impresiones=${row.impressions} | clics=${row.clicks} | ctr=${(row.ctr * 100).toFixed(2)}%`
    );
  }

  console.log("");
  console.log("OK: lectura de Search Console verificada. No se realizo ninguna escritura.");
}

main().catch((err) => {
  console.error("Fallo el test de Search Console:", err instanceof Error ? err.message : err);
  process.exit(1);
});
