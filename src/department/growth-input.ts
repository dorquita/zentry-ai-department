import { PreviousHumanFeedback } from "../approvals/human-feedback-context";
import { buildGrowthDirectorV2Context, GrowthDirectorV2Context } from "../employees/growth-director-v2/context";
import { buildDepartmentPrompt } from "./prompt";
import { withFreshOperationalBacklog } from "./fresh-backlog";
import { DepartmentSpecialistInput, LoadedSpecialistInputs } from "./specialist-inputs";

/**
 * FASE 2 -- contexto de `growth-director-v2` DENTRO de una pasada
 * coordinada.
 *
 * Decision de diseno (ver docs/department-coordination.md): NO se
 * modifica ni el runner ni el context builder del empleado. Este modulo
 * REUTILIZA `buildGrowthDirectorV2Context()` tal cual (los mismos
 * resumenes deterministas del backlog/work orders/change packs/approval
 * requests/jobs que ya usaba en solitario) y le ANADE, encima:
 *
 * - `specialistInputs[]`: la salida REAL de cada especialista de ESTA
 *   misma pasada, o el motivo explicito de su ausencia.
 * - entradas nuevas de `evidenceCatalog` (`dept-*`) para que Growth
 *   pueda citar esas salidas con `evidenceRefs` verificables. El auditor
 *   del propio empleado (`auditGrowthDirectorV2Output`) valida esas refs
 *   contra este mismo catalogo, sin cambios ni excepciones.
 *
 * El tipo resultante EXTIENDE `GrowthDirectorV2Context`, asi que el
 * validador y el auditor del empleado lo aceptan sin modificacion
 * alguna.
 */

export interface DepartmentGrowthContext extends GrowthDirectorV2Context {
  /** Marca explicita de que este contexto viene de la orquestacion del departamento, no del runner individual del empleado. */
  contextKind: "department_coordination_v1";
  /** Id de la pasada COORDINADA (distinto del `departmentRunId` del bus de eventos, ver src/department/types.ts). */
  departmentCoordinationRunId: string;
  specialistInputs: DepartmentSpecialistInput[];
}

export const GROWTH_COORDINATION_RULES: string[] = [
  "Los `specialistInputs[]` del contexto son la salida REAL de seo-specialist, content-strategist y analytics-specialist producida en ESTA MISMA pasada coordinada, no un historico ni un ejemplo. Sintetiza sobre ellos: elimina duplicados entre canales, senala contradicciones entre especialistas de forma explicita, y prioriza.",
  "Un especialista cuyo `status` NO sea `executed` NO tiene datos en esta pasada. Prohibido rellenar ese hueco: ni con conocimiento general, ni con datos de otra pasada, ni con supuestos plausibles. Declaralo en `dependencies[]` con status `missing`/`partial` y, si afecta a una decision, tambien en `unknowns[]`.",
  "sem-specialist esta FUERA de esta fase (pendiente / no disponible). Debe aparecer en `dependencies[]` como `missing` y nunca como una senal de que SEM va bien o mal. No infieras nada sobre Google Ads.",
  "Cada `evidenceRefs` debe apuntar a un `ref` que exista en `evidenceCatalog` del contexto o que definas tu mismo en `evidence[]`. Las refs que empiezan por `dept-` corresponden a la salida real de los especialistas de esta pasada: usalas cuando una prioridad venga de ellos, para que el informe final pueda remontar cada prioridad hasta su origen.",
  "Si dos especialistas dicen cosas incompatibles, NO elijas en silencio: registra la contradiccion (en `bottlenecks[]` o `risks[]`, con las dos refs) y baja la `confidence` de cualquier prioridad que dependa de ella.",
  "Esta fase es READ / ANALYZE / PROPOSE. Ninguna prioridad tuya se aplica automaticamente a ningun sistema: son propuestas para revision humana.",
];

export function buildDepartmentGrowthContext(
  departmentCoordinationRunId: string,
  specialists: LoadedSpecialistInputs,
  eventBusDepartmentRunId?: string,
  options: { freshBacklog?: boolean } = {}
): DepartmentGrowthContext {
  const historic = buildGrowthDirectorV2Context(eventBusDepartmentRunId);
  // Con `freshBacklog`, el trabajo pendiente acumulado NO entra en esta
  // pasada: la pregunta que se le hace al agente es "que merece hacerse
  // AHORA con los datos de hoy", no "que quedaba por hacer". El historico
  // no se borra -- solo deja de alimentar la cola de esta pasada.
  const base = options.freshBacklog ? withFreshOperationalBacklog(historic) : historic;
  return {
    ...base,
    contextKind: "department_coordination_v1",
    departmentCoordinationRunId,
    specialistInputs: specialists.inputs,
    // Orden deliberado: primero la evidencia de los especialistas de
    // ESTA pasada (lo nuevo y especifico), luego el catalogo
    // determinista de siempre.
    evidenceCatalog: [...specialists.evidenceCatalog, ...base.evidenceCatalog],
  };
}

export function buildDepartmentGrowthPrompt(context: DepartmentGrowthContext, previousHumanFeedback: PreviousHumanFeedback[] = []): string {
  return buildDepartmentPrompt({
    agentName: "growth-director-v2",
    departmentRunId: context.departmentCoordinationRunId,
    contextTitle: "Contexto estructurado (DepartmentGrowthContext = GrowthDirectorV2Context + specialistInputs de esta pasada)",
    context,
    coordinationRules: GROWTH_COORDINATION_RULES,
    previousHumanFeedback,
  });
}
