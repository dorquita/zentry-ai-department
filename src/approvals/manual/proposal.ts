import { APPLY_STATUS_LABEL, DepartmentApplyItem, DepartmentApplyStatus, DepartmentApplySummary } from "../../department/apply/types";
import { isInternalTechnicalItem } from "../../department/department-health";

/**
 * PROPUESTAS NUMERADAS del Daily Brief.
 *
 * El flujo operativo es: por la mañana llega un email con una lista
 * numerada, y mas tarde una persona responde "aprueba 1, 2 y 4; rechaza
 * 3 porque...". Para que eso funcione sin ambiguedad hacen falta tres
 * cosas, y las tres viven aqui:
 *
 * 1. El numero visible es DETERMINISTA: sale del `recommendationRank` de
 *    la pasada, no del orden en que se hayan escrito los items. Dos
 *    lecturas del mismo Daily Brief numeran igual.
 * 2. El numero SIEMPRE viaja junto al id real (`changeId` cuando existe,
 *    `recommendationId` si no). El numero es para la persona; el id es
 *    para el sistema. Nunca se ejecuta nada resolviendo solo por numero
 *    sin comprobar que el id sigue siendo el mismo.
 * 3. Se numeran TODAS las propuestas de negocio de la pasada, incluidas
 *    las que no se pueden aplicar. Si se numerasen solo las accionables,
 *    el "3" del email y el "3" que la persona dice podrian no ser el
 *    mismo, que es exactamente el fallo que este modulo existe para
 *    impedir.
 *
 *    UNICA exclusion, y no es de negocio: las INCIDENCIAS TECNICAS
 *    internas del departamento ("el seo-specialist ha fallado"). Esas no
 *    se aprueban, se reintentan o se arreglan, y van a SALUD DEL
 *    DEPARTAMENTO -- ver department-health.ts, que es tambien quien las
 *    reconoce, con un criterio deliberadamente conservador. Se excluyen
 *    AQUI, en la unica funcion que numera, para que el email y la sesion
 *    de aprobacion sigan viendo exactamente la misma lista: si se
 *    filtrasen solo en el render, el "3" del email y el "3" del sistema
 *    dejarian de ser el mismo.
 *
 * Modulo PURO: sin I/O.
 */

export interface NumberedProposal {
  /** Numero visible en el email, 1-based. Estable para una misma pasada. */
  number: number;
  /** Id real del cambio si ya existe registro; si no, el de la recomendacion. */
  id: string;
  recommendationId: string;
  changeId: string | null;
  recommendationRank: number;
  departmentRunId: string;
  title: string;
  /** Por que se propone, tal como lo redacto Growth. */
  description: string;
  /** Empleados de los que procede la evidencia. */
  sourceAgents: string[];
  impact: string;
  confidence: string;
  effort: string;
  /** Paginas/componentes afectados, tal como los declaro web-engineer. */
  targets: string;
  /** URL de staging cuando la propuesta apunta a una pagina concreta. */
  stagingUrl: string;
  capability: string;
  capabilityReason: string;
  qaStatus: string;
  /** Riesgo declarado, derivado del estado y de la capacidad (nunca inventado). */
  risk: string;
  status: DepartmentApplyStatus;
  statusLabel: string;
  /** Cambios concretos propuestos, campo a campo. Vacio si todavia no hay before/after real. */
  changes: { field: string; before: string; after: string }[];
  /** `true` si esta propuesta se puede ejecutar hoy con un executor determinista. */
  actionable: boolean;
  /** Motivo por el que NO es accionable. Vacio si lo es. */
  notActionableReason: string;

  // --- Campos del camino de ChangePlan ejecutable (aditivos) ---------
  /**
   * Estado de la propuesta para el Daily Brief. `ACTIONABLE` significa
   * LITERALMENTE: si Pau la aprueba, el sistema sabe ejecutarla. Nada
   * que todavia necesite interpretacion humana puede llevar esa
   * etiqueta.
   */
  proposalStatus: ProposalStatus;
  /** `native_ability` | `execute_php_fallback`. Vacio si no hay plan. */
  executionPath: string;
  /** Operacion del catalogo. Vacio si no hay plan. */
  operation: string;
  /** pageId REAL resuelto contra el inventario. `null` si no se resolvio. */
  wordpressPageId: number | null;
  /** BEFORE real, recortado para el email. */
  beforeSummary: string;
  /** AFTER propuesto, recortado para el email. */
  afterSummary: string;
}

export type ProposalStatus = "ACTIONABLE" | "BLOCKED" | "MANUAL" | "STALE";

/** Recorte legible para el email. El valor completo vive en el plan persistido. */
function summarizeValue(value: string, max = 220): string {
  const flat = String(value ?? "").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "(vacio)";
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}

/**
 * Estado de la propuesta. El orden importa: BLOCKED gana sobre todo (QA
 * o un guard la detuvo), luego ACTIONABLE solo si hay plan ejecutable
 * real, y MANUAL es el resto. STALE no se decide aqui: depende del
 * estado VIVO de la pagina y se comprueba en el momento de ejecutar.
 */
export function resolveProposalStatus(item: DepartmentApplyItem): ProposalStatus {
  if (item.applyStatus === "blocked" || item.qaStatus === "BLOCKED") return "BLOCKED";
  if (!item.executableChangePlan) return "MANUAL";
  // ACTIONABLE significa que el sistema SABE ejecutarla. Hoy solo hay
  // executor cableado para `execute_php_fallback`; un plan que enrute a
  // la ability nativa es correcto como plan, pero nadie lo ejecutaria
  // todavia -- y llamarlo accionable seria mentir en el Daily Brief.
  return item.executableChangePlan.capability.executionPath === "execute_php_fallback" ? "ACTIONABLE" : "MANUAL";
}

/**
 * Riesgo REAL de una propuesta. No es una etiqueta de marketing: sale de
 * lo que el sistema sabe hacer y de donde escribiria.
 */
export function describeRisk(item: DepartmentApplyItem): string {
  if (item.applyStatus === "blocked") return "BLOQUEADA -- QA o un guard la ha detenido. No se ejecuta.";
  if (item.executableChangePlan) {
    const path = item.executableChangePlan.capability.executionPath;
    return `BAJO -- ${item.executableChangePlan.operation} sobre la pagina ${item.executableChangePlan.wordpressPageId} de STAGING por ${path}, anclada a la version leida, con snapshot previo, validacion releyendo por otra via y rollback verificado. Produccion no se toca.`;
  }
  if (!item.applyCapability.supported) return "SIN EXECUTOR -- no se puede aplicar automaticamente. Requiere trabajo manual en staging.";
  return "BAJO -- cambio reversible de title/meta sobre una pagina ya publicada en STAGING, con snapshot previo, validacion posterior y rollback automatico. Produccion no se toca.";
}

function describeTargets(item: DepartmentApplyItem): string {
  const declared = item.target?.trim();
  if (declared && declared !== "(sin objetivo tecnico declarado en esta pasada)") return declared;
  if (item.applyCapability.target) return `page_id=${item.applyCapability.target.wordpressPageId}`;
  return "(sin pagina objetivo declarada)";
}

function describeChanges(item: DepartmentApplyItem): { field: string; before: string; after: string }[] {
  const target = item.applyCapability.target;
  if (!target) return [];
  const changes: { field: string; before: string; after: string }[] = [];
  // Antes de aplicar no se ha leido la pagina, asi que el "before" real
  // todavia no se conoce: se dice, no se inventa.
  if (target.newTitle !== null) changes.push({ field: "title", before: "(actual en staging, se lee antes de aplicar)", after: target.newTitle });
  if (target.newMetaDescription !== null) {
    changes.push({ field: "meta description", before: "(actual en staging, se lee antes de aplicar)", after: target.newMetaDescription });
  }
  return changes;
}

/** Estados desde los que una decision humana puede llegar a ejecutar algo. */
const ACTIONABLE_STATUSES: DepartmentApplyStatus[] = ["proposed", "staging_applied", "awaiting_approval"];

export function buildNumberedProposals(summary: DepartmentApplySummary): NumberedProposal[] {
  return [...summary.items]
    .filter((item) => !isInternalTechnicalItem(item))
    .sort((a, b) => a.recommendationRank - b.recommendationRank)
    .map((item, index) => {
      const executable = item.executableChangePlan ?? null;
      // Solo cuenta como soportado el plan que ALGUIEN sabe ejecutar hoy.
      const executableToday = executable !== null && executable.capability.executionPath === "execute_php_fallback";
      const supported = executableToday || (item.applyCapability.supported && item.applyCapability.target !== null);
      const statusActionable = ACTIONABLE_STATUSES.includes(item.applyStatus);
      const actionable = supported && statusActionable;
      const proposalStatus = resolveProposalStatus(item);
      return {
        number: index + 1,
        id: item.traceability.changeId ?? item.recommendationId,
        recommendationId: item.recommendationId,
        changeId: item.traceability.changeId,
        recommendationRank: item.recommendationRank,
        departmentRunId: item.departmentRunId,
        title: item.title,
        description: item.proposedChange,
        sourceAgents: [...item.sourceAgents],
        impact: item.impact,
        confidence: item.confidence,
        effort: item.effort,
        targets: describeTargets(item),
        stagingUrl: executable?.stagingUrl ?? item.traceability.stagingUrl ?? item.applyCapability.target?.stagingUrl ?? "",
        capability: item.applyCapability.supported ? String(item.applyCapability.id) : "ninguna",
        capabilityReason: item.applyCapability.reason,
        qaStatus: item.qaStatus,
        risk: describeRisk(item),
        status: item.applyStatus,
        statusLabel: APPLY_STATUS_LABEL[item.applyStatus],
        changes: describeChanges(item),
        actionable,
        notActionableReason: actionable
          ? ""
          : executable !== null && !executableToday
            ? `El plan enruta a la ability nativa "${String(executable.capability.nativeAbility)}", que todavia no tiene executor cableado en esta fase. El plan es valido; lo que falta es quien lo ejecute.`
            : !supported
              ? item.applyCapability.reason
              : `La propuesta esta en estado "${item.applyStatus}", desde el que no se puede ejecutar nada.`,
        proposalStatus,
        executionPath: executable?.capability.executionPath ?? "",
        operation: executable?.operation ?? "",
        wordpressPageId: executable?.wordpressPageId ?? item.applyCapability.target?.wordpressPageId ?? null,
        beforeSummary: executable ? summarizeValue(executable.beforeValue) : "",
        afterSummary: executable ? summarizeValue(executable.afterValue) : "",
      };
    });
}

/** Busca por numero visible. `undefined` si no existe: quien llama debe tratarlo como error, nunca ignorarlo. */
export function findProposalByNumber(proposals: NumberedProposal[], number: number): NumberedProposal | undefined {
  return proposals.find((p) => p.number === number);
}
