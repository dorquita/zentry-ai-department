import * as dotenv from "dotenv";
dotenv.config();
import { classifyReadyForReviewChangePacks } from "../src/agents/classify-change-packs";
import { setChangePackStatus, findChangePackById } from "../src/core/change-packs";

/**
 * Fase O30 -- decision de Pau: cerrar los 42 change packs "ready_for_review"
 * (0 eran seguros de ejecutar tal cual: 38 duplicaban staging ya existente,
 * 4 pertenecian a clusters rechazados/pospuestos) y parar ahi, sin
 * promocionar ni ejecutar nada. No toca produccion, no publica nada, no
 * ejecuta ningun batch de staging-executor -- solo cierra change packs
 * (status append-only, reversible).
 *
 * Uso: npx ts-node scripts/o30-apply-classification.ts
 */
const CHANGED_BY = "o30-carril-a-cluster-cleanup";

function main(): void {
  const { results } = classifyReadyForReviewChangePacks();

  let superseded = 0;
  let rejected = 0;
  let skipped = 0;

  console.log(`\n=== O30 -- Cerrando ${results.length} change packs "ready_for_review" segun clasificacion por cluster ===\n`);

  for (const r of results) {
    const existing = findChangePackById(r.changePackId);
    if (!existing || existing.status !== "ready_for_review") {
      skipped += 1;
      continue;
    }

    if (r.verdict === "supersede_duplicate") {
      setChangePackStatus(r.changePackId, "superseded", CHANGED_BY);
      superseded += 1;
      console.log(`  [superseded] ${r.changePackId.slice(0, 8)} "${r.keyword}" -> ${r.page ?? "(sin URL)"} -- ${r.reason}`);
    } else if (r.verdict === "reject_cluster") {
      setChangePackStatus(r.changePackId, "rejected", CHANGED_BY);
      rejected += 1;
      console.log(`  [rejected] ${r.changePackId.slice(0, 8)} "${r.keyword}" -> ${r.page ?? "(sin URL)"} -- ${r.reason}`);
    } else {
      // eligible / unmatched: no deberia haber ninguno en esta pasada (ver
      // informe de o30-classify-change-packs.ts), se dejan intactos para
      // revision manual si aparecieran.
      skipped += 1;
      console.log(`  [sin tocar, verdict=${r.verdict}] ${r.changePackId.slice(0, 8)} "${r.keyword}"`);
    }
  }

  console.log(`\n=== Resultado ===`);
  console.log(`superseded: ${superseded} | rejected: ${rejected} | sin tocar: ${skipped}`);
  console.log(`\nOK -- no se ha promocionado ningun change pack a approved_to_execute, no se ha ejecutado staging-executor, no se ha tocado produccion, no se ha publicado nada.`);
}

main();
