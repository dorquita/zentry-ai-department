import * as dotenv from "dotenv";
dotenv.config();
import { generateKeywordIdeas, microsToEuros } from "../src/adapters/google-ads";

/**
 * Fase O32.5, tarea 8 -- volumen/CPC real (Keyword Planner, solo lectura,
 * sin crear ningun KeywordPlan) para las keywords de la Campana A
 * (tienda online / compra directa) del plan dual. Complementa la pasada
 * de O32.4 (que cubria sobre todo B2B) con los terminos transaccionales
 * que Pau ha pedido revisar ahora.
 *
 * Uso: npx ts-node scripts/o325-keyword-forecast-ecommerce.ts
 */
const SEED_KEYWORDS = [
  "comprar taquillas",
  "venta de taquillas",
  "taquillas metalicas",
  "taquillas metalicas precio",
  "taquillas melamina",
  "taquillas fenolicas",
  "taquillas vestuario",
  "lockers metalicos",
  "taquillas a medida",
];

function fmtEur(micros: number | null): string {
  if (micros === null) return "n/d";
  const eur = microsToEuros(micros);
  return eur === null ? "n/d" : `${eur.toFixed(2)}€`;
}

async function main(): Promise<void> {
  console.log(`\n=== O32.5 -- Keyword Planner real, campana e-commerce (${SEED_KEYWORDS.length} semillas) ===\n`);
  const ideas = await generateKeywordIdeas(SEED_KEYWORDS);
  console.log(`Ideas devueltas: ${ideas.length}\n`);
  const sorted = [...ideas].sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0));
  console.log(
    `${"Keyword".padEnd(42)} ${"Búsq/mes".padStart(10)} ${"Competencia".padEnd(12)} ${"CPC bajo".padStart(10)} ${"CPC alto".padStart(10)}`
  );
  for (const idea of sorted.slice(0, 45)) {
    console.log(
      `${idea.text.slice(0, 41).padEnd(42)} ${String(idea.avgMonthlySearches ?? "n/d").padStart(10)} ${idea.competition.padEnd(12)} ${fmtEur(
        idea.lowTopOfPageBidMicros
      ).padStart(10)} ${fmtEur(idea.highTopOfPageBidMicros).padStart(10)}`
    );
  }
  console.log(`\nOK -- solo lectura, sin KeywordPlan creado, nada modificado, nada gastado.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
