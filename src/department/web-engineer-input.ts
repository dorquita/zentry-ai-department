import { PreviousHumanFeedback } from "../approvals/human-feedback-context";
import { GrowthEvidenceItem } from "../employees/growth-director-v2/types";
import { NO_PLUGIN_THEME_API_INVENTORY_NOTICE, WebEngineerContext } from "../employees/web-engineer/context";
import { buildDepartmentPrompt } from "./prompt";
import { DepartmentPromotionResult, DepartmentRecommendation } from "./promotion";
import { DepartmentQaStatus } from "./types";
import { DepartmentSpecialistInput } from "./specialist-inputs";

/**
 * FASE 4 -- que recibe `web-engineer` en una pasada coordinada.
 *
 * Recibe UNICAMENTE las recomendaciones que sobrevivieron Growth + QA
 * (ver promotion.ts). Las bloqueadas se le pasan tambien, pero en una
 * lista SEPARADA y explicitamente marcada como "no especificar" -- para
 * que no pueda confundirlas con trabajo aprobado ni "recuperarlas" por
 * su cuenta, y para que la trazabilidad de por que no estan quede en el
 * propio contexto.
 *
 * Esta fase NO implementa nada: el contrato de salida del empleado
 * (`WebEngineerOutput`, con `approvalRequired` obligatoriamente `true`,
 * verificado por `validateWebEngineerOutput()`) se reutiliza sin
 * cambios.
 */

export interface DepartmentApprovedRecommendation {
  rank: number;
  title: string;
  rationale: string;
  impact: string;
  confidence: string;
  effort: string;
  dependsOn: string[];
  evidenceRefs: string[];
  /** Descripcion de cada evidenceRef, resuelta desde el catalogo de evidencia disponible -- para que el ingeniero no tenga que adivinar de donde sale la recomendacion. */
  evidence: GrowthEvidenceItem[];
  /** Avisos de QA que NO bloquean pero que deben reflejarse en la especificacion (criterios de aceptacion / unknowns). */
  qaWarnings: string[];
}

export interface DepartmentBlockedRecommendation {
  rank: number;
  title: string;
  blockedBy: string[];
}

export interface DepartmentWebEngineerContext {
  contextKind: "department_coordination_v1";
  departmentRunId: string;
  qaStatus: DepartmentQaStatus;
  growthSummary: string;
  sourceOfRecommendations: string;
  approvedRecommendations: DepartmentApprovedRecommendation[];
  blockedRecommendations: DepartmentBlockedRecommendation[];
  specialistStatuses: { employee: string; status: string; note: string }[];
  /** Vacio SIEMPRE en esta fase: esta pasada no vincula ninguna recomendacion a una pagina real ya auditada. Ver `noConfirmedPageInventoryNotice`. */
  confirmedExistingPageUrls: string[];
  noPluginThemeApiInventoryNotice: string;
  noConfirmedPageInventoryNotice: string;
}

export const NO_CONFIRMED_PAGE_INVENTORY_NOTICE =
  "Esta pasada coordinada NO vincula las recomendaciones a ninguna pagina concreta ya auditada de zentrylockers.com (no hay ChangePack ni ExistingPageAudit detras de ellas: vienen de la sintesis del Growth Director sobre senales de SEO/Content/Analytics). Por tanto NO SABES si las paginas o componentes que menciones existen ya, ni con que estructura. Nombra el objetivo por lo que la recomendacion dice (p.ej. la URL o seccion que cita la evidencia), y declara explicitamente en unknowns[] que la existencia y el estado real de esa pagina/componente estan sin confirmar y requieren verificacion humana con acceso al sitio.";

export const WEB_ENGINEER_COORDINATION_RULES: string[] = [
  "En esta pasada NO recibes un ChangePack: recibes las recomendaciones del departamento que han sobrevivido a la sintesis del Growth Director y a la revision de QA. El campo `approvedRecommendations[]` es tu unico punto de partida.",
  "`blockedRecommendations[]` NO es trabajo: son recomendaciones que QA ha bloqueado. No las especifiques, no las conviertas en tareas, no las menciones como si fueran implementables. Estan ahi solo para que sepas que existen y por que no proceden.",
  "Sigues SIN ejecutar nada. Esta fase es exclusivamente de especificacion: `approvalRequired` debe ser `true`. No escribas en WordPress, staging, produccion, Ads, GA4/GTM ni en ningun otro sistema, ni redactes la especificacion como si esa fase ya existiera.",
  "No inventes rutas, plugins, temas, endpoints, IDs de pagina ni componentes existentes. Nada de eso esta confirmado en este contexto -- ver `noPluginThemeApiInventoryNotice` y `noConfirmedPageInventoryNotice`. Todo supuesto de ese tipo va a `unknowns[]` o `dependencies[]`.",
  "Cada `proposedChanges[]` debe poder remontarse a una recomendacion concreta de `approvedRecommendations[]`: cita su titulo en el `rationale` para conservar la trazabilidad de extremo a extremo.",
  "Si una recomendacion aprobada trae `qaWarnings`, reflejalas: o como criterio de aceptacion que las cierre, o como `unknowns[]` explicito. No las ignores.",
];

export function buildDepartmentWebEngineerContext(input: {
  departmentRunId: string;
  promotion: DepartmentPromotionResult;
  growthSummary: string;
  evidenceCatalog: GrowthEvidenceItem[];
  specialistInputs: DepartmentSpecialistInput[];
}): DepartmentWebEngineerContext {
  const byRef = new Map(input.evidenceCatalog.map((e) => [e.ref, e]));
  const resolveEvidence = (rec: DepartmentRecommendation): GrowthEvidenceItem[] =>
    rec.evidenceRefs.map((ref) => byRef.get(ref) ?? { ref, description: "(referencia citada por growth-director-v2 que no aparece en el catalogo de evidencia de esta pasada -- tratala como NO verificada)" });

  return {
    contextKind: "department_coordination_v1",
    departmentRunId: input.departmentRunId,
    qaStatus: input.promotion.departmentQaStatus,
    growthSummary: input.growthSummary,
    sourceOfRecommendations:
      "growth-director-v2 sintetizo las salidas reales de los especialistas de esta misma pasada; qa-reviewer las reviso; solo lo que aparece en approvedRecommendations[] paso ambas puertas.",
    approvedRecommendations: input.promotion.promoted.map((rec) => ({
      rank: rec.rank,
      title: rec.title,
      rationale: rec.rationale,
      impact: rec.impact,
      confidence: rec.confidence,
      effort: rec.effort,
      dependsOn: rec.dependsOn,
      evidenceRefs: rec.evidenceRefs,
      evidence: resolveEvidence(rec),
      qaWarnings: rec.qaWarnings,
    })),
    blockedRecommendations: input.promotion.blocked.map((rec) => ({ rank: rec.rank, title: rec.title, blockedBy: rec.blockedBy })),
    specialistStatuses: input.specialistInputs.map((i) => ({ employee: i.employee, status: i.status, note: i.note })),
    confirmedExistingPageUrls: [],
    noPluginThemeApiInventoryNotice: NO_PLUGIN_THEME_API_INVENTORY_NOTICE,
    noConfirmedPageInventoryNotice: NO_CONFIRMED_PAGE_INVENTORY_NOTICE,
  };
}

/**
 * Adaptador MINIMO para poder reutilizar TAL CUAL la auditoria de
 * capacidades no confirmadas del propio empleado
 * (`auditWebEngineerOutputForUnconfirmedCapabilities`, que espera un
 * `WebEngineerContext`) sin duplicar ni reescribir esa logica de
 * seguridad en esta capa.
 *
 * De todo el objeto, la auditoria SOLO consulta
 * `confirmedExistingPageUrls` (las demas categorias de afirmacion no
 * estan respaldadas NUNCA, por diseno -- ver
 * src/employees/web-engineer/validator.ts, CAPABILITY_CLAIM_CATEGORIES).
 * Los demas campos llevan valores neutros y explicitamente marcados como
 * "no aplica": este objeto es EFIMERO, se usa solo para auditar en
 * memoria y no se persiste ni se muestra en ningun sitio -- no crea, ni
 * insinua, ningun ChangePack que no exista.
 */
export function toWebEngineerAuditContext(context: DepartmentWebEngineerContext): WebEngineerContext {
  return {
    changePackId: "(no aplica: pasada coordinada del departamento, sin ChangePack)",
    keyword: "",
    changeType: "department_coordination_recommendation",
    priority: "medium",
    status: "draft",
    targetBrand: "none",
    brandIntent: "irrelevant_or_low_fit",
    proposedChangesFromChangePack: {},
    implementationSteps: [],
    humanReviewChecklist: [],
    risks: [],
    rollbackNotes: [],
    currentAssumptions: [],
    confirmedExistingPageUrls: context.confirmedExistingPageUrls,
    noPluginThemeApiInventoryNotice: context.noPluginThemeApiInventoryNotice,
  };
}

export function buildDepartmentWebEngineerPrompt(context: DepartmentWebEngineerContext, previousHumanFeedback: PreviousHumanFeedback[] = []): string {
  return buildDepartmentPrompt({
    agentName: "web-engineer",
    departmentRunId: context.departmentRunId,
    contextTitle: "Contexto estructurado (DepartmentWebEngineerContext -- recomendaciones aprobadas por Growth + QA)",
    context,
    coordinationRules: WEB_ENGINEER_COORDINATION_RULES,
    previousHumanFeedback,
  });
}
