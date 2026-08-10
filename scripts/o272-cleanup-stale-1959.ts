import { findStagingExecutionById, markExecutionRolledBack } from "../src/core/staging-executions";

/**
 * Fase O27.2 -- limpieza puntual del borrador huerfano
 * page_id=1959 en staging (executionId
 * staging-exec-c419f90b-54b2-4b1a-8fb0-97c68b7b783c).
 *
 * Verificado contra WordPress staging real (2026-08-10): GET
 * /wp-json/wp/v2/pages/1959?context=edit&status=any,trash -> 404
 * ("rest_post_invalid_id") -- la pagina NO existe, ni siquiera en la
 * papelera. No hay nada que mover a papelera porque ya no esta en
 * ningun sitio.
 *
 * IMPORTANTE (no es un rollback funcional): esta misma ejecucion
 * (staging-exec-c419f90b-...) fue el origen real del deploy a
 * produccion de "taquillas escolares" que SI se completo con exito el
 * 2026-08-05 (ver production-deployment-plans.jsonl, plan
 * prod-deploy-326ef325-..., status applied_to_production_draft, y la
 * pagina de produccion 127 /taquillas-para-colegios/ modificada el
 * 2026-08-08). El borrador de staging que origino ese deploy
 * probablemente se limpio DESPUES de haberse usado con exito -- no es
 * un fallo, es un artefacto ya consumido. Se marca "rolled_back" (el
 * unico estado manual disponible aparte de "rejected", que el propio
 * sistema bloquea desde "applied_to_staging" por diseno) unicamente
 * para que Staging QA Agent deje de intentar verificar cada dia una
 * pagina que ya no existe -- no porque se haya revertido nada real. El
 * motivo completo queda documentado aqui y en rollbackNotes.
 *
 * Uso: npx ts-node scripts/o272-cleanup-stale-1959.ts
 */

const EXECUTION_ID = "staging-exec-c419f90b-54b2-4b1a-8fb0-97c68b7b783c";
const REASON =
  "O27.2: pagina 1959 confirmada 404 en WordPress staging (ni siquiera en papelera) -- limpieza de un artefacto ya consumido, no un fallo. El deploy real a produccion que origino ('taquillas escolares', plan prod-deploy-326ef325) ya se completo con exito el 2026-08-05 (pagina produccion 127, /taquillas-para-colegios/). Se marca rolled_back solo para dejar de generar el mismo bloqueo de QA cada dia -- no se ha tocado ni se toca WordPress en este script.";

function main(): void {
  const before = findStagingExecutionById(EXECUTION_ID);
  if (!before) {
    console.error(`No existe ninguna ejecucion con executionId="${EXECUTION_ID}".`);
    process.exit(1);
  }
  console.log(`Estado actual: "${before!.status}"`);
  if (before!.status !== "applied_to_staging") {
    console.log("Sin cambios: ya no esta en applied_to_staging, no hace falta limpiar de nuevo.");
    return;
  }
  const updated = markExecutionRolledBack(EXECUTION_ID, REASON);
  if (!updated) {
    console.error("No se pudo actualizar el registro (inesperado).");
    process.exit(1);
  }
  console.log(`OK: "${EXECUTION_ID}" -> "${updated.status}".`);
  console.log("No se ha realizado ninguna llamada a WordPress (la pagina ya no existe).");
}

main();
