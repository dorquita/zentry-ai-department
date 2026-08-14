import * as dotenv from "dotenv";
dotenv.config();
import { setChangePackStatus, findChangePackById } from "../src/core/change-packs";

/**
 * Fase O31 -- cierre puntual de UN change pack "approved_to_execute"
 * preexistente (de antes de esta fase, por tanto sin
 * targetWordpressPageId) que el dry-run de scripts/o31-dry-run-batch30.ts
 * detecto que crearia una pagina DUPLICADA si se ejecutara: su
 * canonicalKey apunta a la pagina de staging 1959, que ya no existe
 * (404 confirmado en O27.2, ejecucion asociada ya marcada rolled_back
 * por ese motivo) -- el trabajo real de "taquillas escolares" ya esta
 * cubierto por el cluster "Taquillas para colegios / escolares"
 * (borrador de staging 2098, visualmente aprobado) y por el deploy de
 * produccion ya completado (pagina 127, /taquillas-para-colegios/).
 *
 * Uso: npx ts-node scripts/o31-close-stale-approved.ts
 */
const CHANGE_PACK_ID = "e21b2a0d-b0b1-4080-8b5a-ea0d4a404ca5";
const CHANGED_BY = "o31-stale-preexisting-approved-cleanup";

function main(): void {
  const existing = findChangePackById(CHANGE_PACK_ID);
  if (!existing) {
    console.log("No encontrado -- nada que hacer.");
    return;
  }
  if (existing.status !== "approved_to_execute") {
    console.log(`Status actual ya es "${existing.status}" (no approved_to_execute) -- no se toca.`);
    return;
  }
  const updated = setChangePackStatus(CHANGE_PACK_ID, "superseded", CHANGED_BY);
  console.log(updated ? `Cerrado: ${updated.changePackId} -> ${updated.status}` : "No encontrado.");
}

main();
