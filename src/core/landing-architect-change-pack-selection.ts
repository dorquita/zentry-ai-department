import { ChangePack, ChangePackStatus } from "./types";

/**
 * Seleccion del change pack objetivo para una pasada del experimento
 * ux-ui-landing-architect-v2 (runner de comparacion V1 vs V2). Modulo
 * TOOL puro (sin I/O, sin llamadas a ningun modelo) -- separado de
 * scripts/run-landing-architect-comparison.ts para poder testearlo sin
 * pasar por el CLI ni por ficheros reales.
 */
export const ELIGIBLE_STATUSES_FOR_COMPARISON: ChangePackStatus[] = ["ready_for_review", "approved_to_execute"];

export function filterEligibleChangePacksForComparison(changePacks: ChangePack[]): ChangePack[] {
  return changePacks.filter((cp) => ELIGIBLE_STATUSES_FOR_COMPARISON.includes(cp.status));
}

/**
 * Elige UN change pack elegible al azar (no siempre el mismo primero del
 * array) -- pensado para una ejecucion automatica recurrente (ver
 * docs/ux-ui-landing-architect-v2-experiment.md, "Ejecucion autonoma en
 * Claude Cloud"): sin aleatoriedad, una pasada diaria compararia
 * SIEMPRE el mismo change pack (el primero elegible del log
 * append-only), sin aportar ninguna cobertura nueva dia a dia.
 *
 * `randomFn` es inyectable (por defecto `Math.random`) para que los
 * tests puedan verificar el comportamiento con un generador
 * determinista, sin depender de aleatoriedad real.
 */
export function selectRandomEligibleChangePack(changePacks: ChangePack[], randomFn: () => number = Math.random): ChangePack | undefined {
  const eligible = filterEligibleChangePacksForComparison(changePacks);
  if (eligible.length === 0) return undefined;
  const index = Math.floor(randomFn() * eligible.length);
  // Clamp defensivo: randomFn() debe devolver [0,1), pero un randomFn
  // inyectado por un test podria (por error) devolver exactamente 1.
  const safeIndex = Math.min(index, eligible.length - 1);
  return eligible[safeIndex];
}
