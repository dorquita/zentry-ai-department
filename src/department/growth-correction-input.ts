import { PreviousHumanFeedback } from "../approvals/human-feedback-context";
import { GrowthDirectorV2Output } from "../employees/growth-director-v2/types";
import { buildDepartmentPrompt } from "./prompt";
import { DepartmentGrowthContext, GROWTH_COORDINATION_RULES } from "./growth-input";
import { QaCorrectionRequest } from "./qa-correction";

/**
 * CORRECCION DIRIGIDA DE LA SINTESIS DE GROWTH.
 *
 * POR QUE HACIA FALTA ADEMAS DE LA DEL PLAN. El bucle de correccion se
 * construyo primero sobre el PLAN (la salida de web-engineer), porque es
 * lo que se escribe en staging. Pero la primera pasada fresca real
 * demostro que ese no es el punto donde el departamento se para mas a
 * menudo: QA bloqueo en la puerta ANTERIOR -- la que revisa las
 * recomendaciones de Growth -- por una cifra de SEM sin respaldo. Y ahi
 * seguia vigente el comportamiento viejo:
 *
 *     Growth -> QA -> FAIL -> FIN
 *
 * Con la puerta cerrada, web-engineer ni siquiera se invoca, asi que el
 * bucle del plan no llega a existir. Corregir solo aguas abajo dejaba sin
 * arreglar justamente el caso que ocurre.
 *
 * Lo que se corrige aqui es tipicamente barato y muy concreto: una
 * afirmacion sin evidencia que la respalde, una contradiccion entre dos
 * especialistas resuelta en silencio, una prioridad que cita un dato de
 * una fuente que no corrio. Nada de eso exige rehacer el analisis: exige
 * quitar o respaldar una frase.
 */

export interface GrowthCorrectionContext {
  contractVersion: string;
  departmentRunId: string;
  /** Ronda de correccion que se esta pidiendo. 1 = primera correccion. */
  round: number;
  maxRounds: number;
  /** El mismo contexto que tuvo la primera vez: especialistas, evidencia, backlog. */
  original: DepartmentGrowthContext;
  /** Su sintesis anterior, tal cual la devolvio. */
  previousOutput: GrowthDirectorV2Output;
  /** Veredicto literal de QA sobre esa sintesis. */
  qaVerdict: {
    reviewStatus: string;
    summary: string;
    safetyConcerns: string[];
    unsupportedClaims: string[];
    contradictions: string[];
  };
  /** Lo que hay que corregir. Nunca vacio: sin esto no se pide correccion. */
  corrections: QaCorrectionRequest[];
}

export const GROWTH_CORRECTION_RULES: string[] = [
  "ESTO ES UNA CORRECCION, NO UN ANALISIS NUEVO. Ya hiciste esta sintesis una vez y QA la ha bloqueado. Tu trabajo ahora es arreglar exactamente lo que QA ha senalado, conservando intacto todo lo demas.",
  "Tienes tu sintesis anterior integra en `previousOutput`. Partes de ella: no rehagas el analisis, no reordenes prioridades que QA no ha cuestionado, y no aproveches para reescribir lo que ya estaba bien.",
  "Cada entrada de `corrections` es un encargo concreto: `field` dice que campo esta mal, `problem` que le pasa, `expectedCriterion` con que criterio se dara por resuelto, y `evidence` en que se basa QA. Atiende TODAS las que tengan `blocking: true`.",
  "La correccion tipica aqui NO es investigar mas: es QUITAR o RESPALDAR una afirmacion. Si una cifra o un dato no tiene una entrada de `evidenceCatalog` que lo sostenga, la respuesta correcta casi siempre es eliminar esa afirmacion, no buscarle una justificacion nueva.",
  "Si un especialista no corrio en esta pasada, NO puedes citar ningun dato suyo, ni siquiera de pasadas anteriores ni como orden de magnitud. Declaralo en `dependencies[]` como `missing` y quita cualquier cifra que dependiera de el.",
  "Si crees que una correccion de QA es incorrecta, NO la ignores en silencio: manten tu posicion en ese punto y explica por que en `unknowns[]` o en `risks[]`. Un desacuerdo argumentado es un resultado valido; un desacuerdo mudo se lee como no haberlo intentado.",
  "Devuelve la salida COMPLETA con el mismo contrato de siempre, no un parche ni un diff: esta version sustituye entera a la anterior.",
  "Tu salida se volvera a revisar. La revision sera sobre ESTA version, no sobre la anterior, y comprobara una por una si las correcciones quedaron resueltas.",
];

export const GROWTH_CORRECTION_CONTRACT_VERSION = "growth-correction/v1";

export function buildGrowthCorrectionContext(input: {
  departmentRunId: string;
  round: number;
  maxRounds: number;
  original: DepartmentGrowthContext;
  previousOutput: GrowthDirectorV2Output;
  qaVerdict: GrowthCorrectionContext["qaVerdict"];
  corrections: QaCorrectionRequest[];
}): GrowthCorrectionContext {
  return {
    contractVersion: GROWTH_CORRECTION_CONTRACT_VERSION,
    departmentRunId: input.departmentRunId,
    round: input.round,
    maxRounds: input.maxRounds,
    original: input.original,
    previousOutput: input.previousOutput,
    qaVerdict: input.qaVerdict,
    corrections: input.corrections,
  };
}

export function buildGrowthCorrectionPrompt(
  context: GrowthCorrectionContext,
  previousHumanFeedback: PreviousHumanFeedback[] = []
): string {
  return buildDepartmentPrompt({
    agentName: "growth-director-v2",
    departmentRunId: context.departmentRunId,
    contextTitle: `Contexto estructurado (GrowthCorrectionContext -- CORRECCION ronda ${context.round} de ${context.maxRounds}, pedida por QA)`,
    context,
    // Las de correccion primero: son las que cambian que se espera de
    // esta invocacion. Las de coordinacion se mantienen porque siguen
    // aplicando (contrato de salida, prohibiciones, evidencia citable) y
    // quitarlas abriria la puerta a una salida que ya no valida.
    coordinationRules: [...GROWTH_CORRECTION_RULES, ...GROWTH_COORDINATION_RULES],
    previousHumanFeedback,
  });
}
