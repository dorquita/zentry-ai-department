import * as dotenv from "dotenv";
dotenv.config();
import { generateKeywordIdeas, microsToEuros } from "../src/adapters/google-ads";

/**
 * Fase O32.4, tarea 5 -- volumen/CPC real de Keyword Planner
 * (generateKeywordIdeas, solo lectura, sin crear ningun KeywordPlan) para
 * las keywords principales del plan de septiembre. No crea nada, no
 * gasta nada, no modifica la cuenta.
 *
 * Uso: npx ts-node scripts/o324-keyword-forecast.ts
 */
const SEED_KEYWORDS = [
  "cerradura inteligente para taquillas",
  "cerraduras electronicas para taquillas",
  "digitalizacion de taquillas",
  "convertir taquillas en inteligentes",
  "taquillas para colegios",
  "taquillas escolares",
  "taquillas para empresas",
  "taquillas corporativas",
  "taquillas melamina",
  "taquillas de melamina",
  "comprar taquillas",
  "precio taquillas",
  "venta de taquillas",
];

function fmtEur(micros: number | null): string {
  if (micros === null) return "n/d";
  const eur = microsToEuros(micros);
  return eur === null ? "n/d" : `${eur.toFixed(2)}€`;
}

async function main(): Promise<void> {
  console.log(`\n=== O32.4 -- Keyword Planner real (${SEED_KEYWORDS.length} keywords semilla) ===\n`);
  const ideas = await generateKeywordIdeas(SEED_KEYWORDS);
  console.log(`Ideas devueltas: ${ideas.length}\n`);

  const sorted = [...ideas].sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0));
  console.log(
    `${"Keyword".padEnd(45)} ${"Búsq/mes".padStart(10)} ${"Competencia".padEnd(12)} ${"CPC bajo".padStart(10)} ${"CPC alto".padStart(10)}`
  );
  for (const idea of sorted) {
    console.log(
      `${idea.text.slice(0, 44).padEnd(45)} ${String(idea.avgMonthlySearches ?? "n/d").padStart(10)} ${idea.competition.padEnd(12)} ${fmtEur(
        idea.lowTopOfPageBidMicros
      ).padStart(10)} ${fmtEur(idea.highTopOfPageBidMicros).padStart(10)}`
    );
  }

  console.log(`\nOK -- solo lectura (generateKeywordIdeas, sin KeywordPlan creado), nada modificado, nada gastado.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
