import { ChangePack, ChangePackStatus } from "../../core/types";

/**
 * Seleccion del change pack objetivo para una pasada del empleado
 * `web-engineer` -- mismo patron que
 * src/core/landing-architect-change-pack-selection.ts (ver ese fichero
 * para el razonamiento completo). Modulo TOOL puro (sin I/O, sin
 * llamadas a ningun modelo) -- separado de scripts/run-web-engineer.ts
 * para poder testearlo sin pasar por el CLI ni por ficheros reales.
 *
 * `web-engineer` traduce propuestas YA aprobables (no borradores a medio
 * hacer) a especificacion tecnica, asi que los mismos dos estados que ya
 * usa la seleccion de ux-ui-landing-architect-v2 aplican aqui: un
 * ChangePack en `ready_for_review` o `approved_to_execute` ya tiene su
 * `proposedChanges`/`implementationSteps` completos (ver
 * src/core/change-packs.ts, upsertChangePack: un ChangePack nuevo nace
 * directamente en `ready_for_review`, nunca en `draft`). `draft`,
 * `rejected`, `superseded` y `applied_manually` quedan fuera a proposito
 * (ver ChangePackStatus en src/core/types.ts para los 6 valores reales).
 */
export const ELIGIBLE_STATUSES_FOR_WEB_ENGINEER: ChangePackStatus[] = ["ready_for_review", "approved_to_execute"];

export function filterEligibleChangePacksForWebEngineer(changePacks: ChangePack[]): ChangePack[] {
  return changePacks.filter((cp) => ELIGIBLE_STATUSES_FOR_WEB_ENGINEER.includes(cp.status));
}

/**
 * Elige UN change pack elegible al azar (no siempre el mismo primero del
 * array) -- pensado para una ejecucion automatica recurrente (mismo
 * razonamiento que selectRandomEligibleChangePack() en
 * landing-architect-change-pack-selection.ts): sin aleatoriedad, una
 * pasada diaria procesaria SIEMPRE el mismo change pack (el primero
 * elegible del log append-only), sin aportar cobertura nueva dia a dia.
 *
 * `randomFn` es inyectable (por defecto `Math.random`) para que los
 * tests puedan verificar el comportamiento con un generador
 * determinista, sin depender de aleatoriedad real.
 */
export function selectRandomEligibleChangePackForWebEngineer(changePacks: ChangePack[], randomFn: () => number = Math.random): ChangePack | undefined {
  const eligible = filterEligibleChangePacksForWebEngineer(changePacks);
  if (eligible.length === 0) return undefined;
  const index = Math.floor(randomFn() * eligible.length);
  // Clamp defensivo: randomFn() debe devolver [0,1), pero un randomFn
  // inyectado por un test podria (por error) devolver exactamente 1.
  const safeIndex = Math.min(index, eligible.length - 1);
  return eligible[safeIndex];
}
