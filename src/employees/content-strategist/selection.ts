import { ChangePack, ChangePackStatus } from "../../core/types";

/**
 * Seleccion del change pack objetivo para una pasada del empleado
 * `content-strategist` -- ver docs/claude-employee-runtime.md y
 * scripts/run-content-strategist.ts. Modulo TOOL puro (sin I/O, sin
 * llamadas a ningun modelo) -- separado del runner para poder testearlo
 * sin pasar por el CLI ni por ficheros reales, mismo patron que
 * src/core/landing-architect-change-pack-selection.ts.
 *
 * A diferencia de ux-ui-landing-architect-v2 (que trabaja sobre
 * CUALQUIER change pack elegible), content-strategist solo debe ver
 * change packs de la categoria CONTENIDO: los que produce
 * src/agents/content-change-pack-builder.ts, reconocibles por su
 * `changeType` ("new_content_page" / "content_update", ver
 * resolveChangeType() en ese fichero) -- change packs de SEO
 * (seo_on_page_update) o CRO (cro_conversion_update) quedan fuera a
 * proposito: no son brief de contenido, son otro dominio.
 */
export const ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY: string[] = ["new_content_page", "content_update"];

export const ELIGIBLE_STATUSES_FOR_CONTENT_STRATEGY: ChangePackStatus[] = ["ready_for_review", "approved_to_execute"];

export function isContentChangePack(changePack: ChangePack): boolean {
  return ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY.includes(changePack.changeType);
}

export function filterEligibleChangePacksForContentStrategy(changePacks: ChangePack[]): ChangePack[] {
  return changePacks.filter((cp) => isContentChangePack(cp) && ELIGIBLE_STATUSES_FOR_CONTENT_STRATEGY.includes(cp.status));
}

/**
 * Elige UN change pack de contenido elegible al azar (no siempre el
 * primero del array) -- mismo motivo que
 * selectRandomEligibleChangePack() en landing-architect: una ejecucion
 * automatica recurrente sin aleatoriedad compararia siempre el mismo
 * change pack. `randomFn` es inyectable (por defecto `Math.random`) para
 * que los tests puedan verificar el comportamiento de forma
 * deterministica.
 *
 * Devuelve `undefined` si no hay ningun change pack de contenido
 * elegible -- quien llama (scripts/run-content-strategist.ts) debe
 * representar ese caso como "sin trabajo elegible" en vez de fabricar
 * una oportunidad, nunca lanzar una excepcion opaca.
 */
export function selectRandomEligibleChangePackForContentStrategy(changePacks: ChangePack[], randomFn: () => number = Math.random): ChangePack | undefined {
  const eligible = filterEligibleChangePacksForContentStrategy(changePacks);
  if (eligible.length === 0) return undefined;
  const index = Math.floor(randomFn() * eligible.length);
  // Clamp defensivo: randomFn() debe devolver [0,1), pero un randomFn
  // inyectado por un test podria (por error) devolver exactamente 1.
  const safeIndex = Math.min(index, eligible.length - 1);
  return eligible[safeIndex];
}
