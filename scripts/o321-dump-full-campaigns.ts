import * as dotenv from "dotenv";
dotenv.config();
import { getGoogleAdsSnapshot } from "../src/adapters/google-ads";

/**
 * Fase O32.1 -- diagnostico puntual de solo lectura: el informe de
 * sem-watcher.ts solo detalla la campana "principal" por nombre: el
 * resumen de la lectura real reporto 3 campanas y 4 ad groups, pero el
 * markdown generado solo describe 1 campana + un ad group "Test1" de
 * otra distinta ("SEM | ES | Compra | Taquillas") sin decir si esa
 * OTRA campana esta activa o gastando. Antes de dar ningun diagnostico
 * a Pau hace falta ver el estado real de LAS 3. Llama a
 * getGoogleAdsSnapshot() directamente (misma funcion de solo lectura
 * que ya usa sem-watcher.ts, sin ninguna llamada de mutacion) y
 * imprime TODAS las campanas con su status/canal/presupuesto real, y
 * las metricas de 30 dias por campana (para saber si alguna ha gastado
 * algo).
 *
 * Uso: npx ts-node scripts/o321-dump-full-campaigns.ts
 */
async function main(): Promise<void> {
  const snapshot = await getGoogleAdsSnapshot();

  console.log(`\n=== O32.1 -- TODAS las campanas reales (customer ${snapshot.customerId}) ===\n`);
  for (const c of snapshot.campaigns) {
    const budget = c.dailyBudgetMicros !== null ? `${(c.dailyBudgetMicros / 1_000_000).toFixed(2)} EUR/dia` : "(sin presupuesto asignado)";
    console.log(`- [${c.status}] "${c.name}" (id ${c.id}) -- canal: ${c.channelType} -- presupuesto: ${budget}`);
  }

  console.log(`\n=== Ad groups por campana ===\n`);
  for (const ag of snapshot.adGroups) {
    console.log(`- [${ag.status}] "${ag.name}" -- campana: "${ag.campaignName}" (id ${ag.campaignId})`);
  }

  console.log(`\n=== Metricas 30 dias por campana (¿alguna ha gastado?) ===\n`);
  if (snapshot.metrics.length === 0) {
    console.log("Sin filas de metricas devueltas (probable: 0 actividad en las 3 campanas en el periodo).");
  } else {
    for (const m of snapshot.metrics) {
      const costEur = (m.costMicros / 1_000_000).toFixed(2);
      console.log(`- "${m.campaignName}": impresiones=${m.impressions}, clics=${m.clicks}, coste=${costEur} EUR, conversiones=${m.conversions}, CTR=${(m.ctr * 100).toFixed(2)}%`);
    }
  }

  console.log(`\nOK -- solo lectura (googleAds:search), ninguna mutacion, nada modificado.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
