import * as dotenv from "dotenv";
dotenv.config();
import { classifyReadyForReviewChangePacks, ChangePackVerdict } from "../src/agents/classify-change-packs";

/**
 * Fase O30 -- informe de solo lectura: clasifica los change packs
 * "ready_for_review" contra los clusters SEO. No cambia ningun estado
 * (ver scripts/o30-apply-classification.ts para la parte que si
 * escribe).
 *
 * Uso: npx ts-node scripts/o30-classify-change-packs.ts
 */
function main(): void {
  const { results } = classifyReadyForReviewChangePacks();

  console.log(`\n=== O30 -- Clasificacion de ${results.length} change packs "ready_for_review" contra clusters SEO ===\n`);

  const byVerdict = new Map<ChangePackVerdict, typeof results>();
  for (const r of results) {
    if (!byVerdict.has(r.verdict)) byVerdict.set(r.verdict, []);
    byVerdict.get(r.verdict)!.push(r);
  }

  for (const verdict of ["eligible", "supersede_duplicate", "reject_cluster", "unmatched"] as ChangePackVerdict[]) {
    const items = byVerdict.get(verdict) ?? [];
    console.log(`\n-- ${verdict} (${items.length}) --`);
    for (const r of items) {
      console.log(`  ${r.changePackId.slice(0, 8)} | ${r.changeType} | "${r.keyword}" -> ${r.page ?? "(sin URL)"} | cluster: ${r.clusterLabel} [${r.clusterStatus ?? "n/a"}]`);
      console.log(`    ${r.reason}`);
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`eligible (candidatos reales a promocionar): ${(byVerdict.get("eligible") ?? []).length}`);
  console.log(`supersede_duplicate (duplican staging ya existente, cerrar sin ejecutar): ${(byVerdict.get("supersede_duplicate") ?? []).length}`);
  console.log(`reject_cluster (pertenecen a un cluster rechazado/pospuesto): ${(byVerdict.get("reject_cluster") ?? []).length}`);
  console.log(`unmatched (revisar a mano): ${(byVerdict.get("unmatched") ?? []).length}`);
}

main();
