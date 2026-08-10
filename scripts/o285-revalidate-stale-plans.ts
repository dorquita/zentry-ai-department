import * as dotenv from "dotenv";
dotenv.config();
import { setDeploymentPlanStatus, readCurrentProductionDeploymentPlans } from "../src/core/production-deployment-plans";

/**
 * Fase O28.5 -- marca como "needs_revalidation" los planes de deploy a
 * produccion cuyo `seoMeta`/`checklist` se calcularon ANTES de que su
 * pagina de origen se regenerase con el motor visual/contenido nuevo
 * (O27.4b meta description real, O27.4c/O28.1-O28.2 componentes
 * zentry*, O28.3 regeneracion de las 13 paginas). Un plan asi describe
 * una version YA OBSOLETA de la pagina -- aprobarlo tal cual seria
 * aprobar datos que ya no existen.
 *
 * Alcance exacto (11 de los 22 planes totales):
 *  - Los 6 planes de las paginas SEO (2091-2096, tipo seo_on_page_update)
 *    NO se tocan: esas 6 paginas nunca se regeneraron con el motor
 *    nuevo, su plan sigue describiendo el contenido real actual.
 *  - Los 4 planes ya "cancelled" (2097-2100, deduplicados en O27.2) NO
 *    se tocan: ya estan inactivos por otro motivo, documentado aparte.
 *  - El plan "applied_to_production_draft" (taquillas escolares, pagina
 *    1959, creado 2026-08-04) NO se toca: es historico, ya ejecutado,
 *    anterior a todo este ciclo de calidad visual, no relacionado.
 *  - Los 11 planes de 2101-2111 (paginas SI regeneradas con el motor
 *    nuevo en O28.3) SI se marcan needs_revalidation.
 *
 * No cancela, no borra, no genera ningun plan nuevo -- solo pausa estos
 * 11 con una razon documentada. Cuando el planner vuelva a correr (una
 * vez estas paginas ya visually_approved), propondra planes NUEVOS con
 * los datos correctos -- needs_revalidation queda deliberadamente fuera
 * de UNRESOLVED_PLAN_STATUSES para no bloquear esa regeneracion.
 *
 * Uso: npx ts-node scripts/o285-revalidate-stale-plans.ts
 */

const STALE_SOURCE_DRAFT_IDS = [2101, 2102, 2103, 2104, 2105, 2106, 2107, 2108, 2109, 2110, 2111];

const REASON =
  "O28.5: plan generado antes de la regeneracion visual/contenido del draft de origen (O27.4b meta description real, O28.1-O28.3 componentes zentry* y contenido especifico por material) -- seoMeta y checklist desactualizados. No ejecutar. Se propondra un plan nuevo una vez la pagina este visually_approved y el planner vuelva a correr.";

function main(): void {
  const current = readCurrentProductionDeploymentPlans();
  let revalidated = 0;
  let skipped = 0;

  for (const sourceDraftId of STALE_SOURCE_DRAFT_IDS) {
    const plan = current.find((p) => p.sourceDraftId === sourceDraftId && p.status === "plan_ready_for_review");
    if (!plan) {
      console.log(`[SKIP] pagina ${sourceDraftId}: sin plan en plan_ready_for_review (puede que ya este resuelto de otra forma).`);
      skipped += 1;
      continue;
    }
    const updated = setDeploymentPlanStatus(plan.deploymentPlanId, "needs_revalidation", { lastError: REASON });
    console.log(`[OK] ${plan.deploymentPlanId} (pagina ${sourceDraftId}, "${plan.keyword}") -> ${updated?.status}`);
    revalidated += 1;
  }

  console.log(`\nRevalidados: ${revalidated}. Omitidos: ${skipped}.`);
}

main();
