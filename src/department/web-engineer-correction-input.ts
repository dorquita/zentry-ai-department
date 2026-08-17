import { PreviousHumanFeedback } from "../approvals/human-feedback-context";
import { WebEngineerOutput } from "../employees/web-engineer/types";
import { buildDepartmentPrompt } from "./prompt";
import { QaCorrectionRequest } from "./qa-correction";
import { PlanQaChangePlanSummary } from "./plan-qa-input";
import { DepartmentWebEngineerContext, WEB_ENGINEER_COORDINATION_RULES } from "./web-engineer-input";

/**
 * CORRECCION DIRIGIDA.
 *
 * Cuando QA bloquea, no se vuelve a ejecutar el departamento entero para
 * arreglar una recomendacion: se reinvoca UNICAMENTE al responsable del
 * cambio, y se le da exactamente lo que necesita para corregir:
 *
 *   - su propuesta anterior, LITERAL (no un resumen);
 *   - el output de QA convertido en correcciones accionables;
 *   - la evidencia que respalda cada correccion;
 *   - los ChangePlans tal y como quedaron resueltos, con el BEFORE real;
 *   - el mismo contexto de recomendaciones y estado de staging que tuvo
 *     la primera vez.
 *
 * Sin la propuesta anterior, "corregir" seria "volver a proponer desde
 * cero", y no habria forma de saber si la correccion atendio lo que se
 * pidio. Por eso va entera y sin reescribir.
 */

export interface WebEngineerCorrectionContext {
  contractVersion: string;
  departmentRunId: string;
  /** Ronda de correccion que se esta pidiendo. 1 = primera correccion. */
  round: number;
  maxRounds: number;
  /** Contexto original: recomendaciones aprobadas, inventario, BEFORE. */
  original: DepartmentWebEngineerContext;
  /** La propuesta anterior, tal cual la devolvio el empleado. */
  previousOutput: WebEngineerOutput;
  /** Como quedaron resueltos los planes de la propuesta anterior. */
  previousChangePlans: PlanQaChangePlanSummary[];
  /** Veredicto literal de QA sobre esa propuesta. */
  qaVerdict: { reviewStatus: string; summary: string; safetyConcerns: string[]; unsupportedClaims: string[] };
  /** Lo que hay que corregir. Nunca vacio: sin esto no se pide correccion. */
  corrections: QaCorrectionRequest[];
}

export const WEB_ENGINEER_CORRECTION_RULES: string[] = [
  "ESTO ES UNA CORRECCION, NO UNA PROPUESTA NUEVA. Ya hiciste esta especificacion una vez y QA la ha bloqueado. Tu trabajo ahora es arreglar lo que QA ha senalado, conservando todo lo demas.",
  "Tienes tu propuesta anterior integra en `previousOutput`. Partes de ella: no empieces de cero, no cambies lo que QA no ha cuestionado, y no aproveches para reescribir cosas que ya estaban bien.",
  "Cada entrada de `corrections` es un encargo concreto: `field` dice que campo esta mal, `problem` que le pasa, `expectedCriterion` con que criterio se dara por resuelto, y `evidence` en que se basa QA. Atiendelas TODAS las que tengan `blocking: true`.",
  "Si crees que una correccion es incorrecta, NO la ignores en silencio: manten tu propuesta en ese punto y explica por que en `assumptions`. Un desacuerdo argumentado es un resultado valido; un desacuerdo mudo se lee como no haberlo intentado.",
  "`previousChangePlans` trae el BEFORE REAL leido del sitio para cada plan. Si corriges el contenido nuevo, hazlo contra ese BEFORE, no contra lo que supongas que hay en la pagina.",
  "Vuelve a declarar `changePlans[]` COMPLETO en tu salida, tambien los planes que no cambian: la salida de esta ronda sustituye entera a la anterior, no se fusiona con ella.",
  "No inventes paginas ni ids. La pagina objetivo se declara igual que la primera vez (`targetPage` con la URL de staging o el slug); el sistema resuelve el id y el hash, tu no.",
  "Tu salida se volvera a revisar. La revision sera sobre ESTA version, no sobre la anterior, y comprobara una por una si las correcciones quedaron resueltas.",
];

export const WEB_ENGINEER_CORRECTION_CONTRACT_VERSION = "web-engineer-correction/v1";

export function buildWebEngineerCorrectionContext(input: {
  departmentRunId: string;
  round: number;
  maxRounds: number;
  original: DepartmentWebEngineerContext;
  previousOutput: WebEngineerOutput;
  previousChangePlans: PlanQaChangePlanSummary[];
  qaVerdict: WebEngineerCorrectionContext["qaVerdict"];
  corrections: QaCorrectionRequest[];
}): WebEngineerCorrectionContext {
  return {
    contractVersion: WEB_ENGINEER_CORRECTION_CONTRACT_VERSION,
    departmentRunId: input.departmentRunId,
    round: input.round,
    maxRounds: input.maxRounds,
    original: input.original,
    previousOutput: input.previousOutput,
    previousChangePlans: input.previousChangePlans,
    qaVerdict: input.qaVerdict,
    corrections: input.corrections,
  };
}

export function buildWebEngineerCorrectionPrompt(
  context: WebEngineerCorrectionContext,
  previousHumanFeedback: PreviousHumanFeedback[] = []
): string {
  return buildDepartmentPrompt({
    agentName: "web-engineer",
    departmentRunId: context.departmentRunId,
    contextTitle: `Contexto estructurado (WebEngineerCorrectionContext -- CORRECCION ronda ${context.round} de ${context.maxRounds}, pedida por QA)`,
    context,
    // Las reglas de correccion van PRIMERO: son las que cambian que se
    // espera de esta invocacion. Las de coordinacion se mantienen porque
    // siguen aplicando (contrato de salida, prohibiciones, formato de
    // changePlans) y quitarlas seria abrir la puerta a una salida que ya
    // no valida.
    coordinationRules: [...WEB_ENGINEER_CORRECTION_RULES, ...WEB_ENGINEER_COORDINATION_RULES],
    previousHumanFeedback,
  });
}
