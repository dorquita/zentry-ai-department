import { PreviousHumanFeedback } from "../approvals/human-feedback-context";
import { GrowthEvidenceItem } from "../employees/growth-director-v2/types";
import { NO_PLUGIN_THEME_API_INVENTORY_NOTICE, WebEngineerContext } from "../employees/web-engineer/context";
import { buildDepartmentPrompt } from "./prompt";
import { DepartmentPromotionResult, DepartmentRecommendation } from "./promotion";
import { DepartmentQaStatus } from "./types";
import { DepartmentSpecialistInput } from "./specialist-inputs";
import { StagingPageBrief } from "./staging-inventory";

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
  /** URLs de staging REALES, leidas del sitio. Ya no va vacio cuando el inventario se pudo leer. */
  confirmedExistingPageUrls: string[];
  noPluginThemeApiInventoryNotice: string;
  noConfirmedPageInventoryNotice: string;
  /**
   * INVENTARIO REAL de staging, leido por REST antes de esta fase. Es la
   * evidencia con la que web-engineer puede citar una pagina sin
   * adivinarla. Vacio = no se pudo leer, y entonces no debe declarar
   * ningun `changePlans`.
   */
  stagingInventory: StagingPageBrief[];
  /** Motivo por el que el inventario esta vacio. Vacio = se leyo bien. */
  stagingInventoryUnavailableReason: string;
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
  "`stagingInventory[]` es el inventario REAL de staging leido del sitio antes de invocarte: id, slug, URL, titulo, excerpt, tipos de bloque y H2 actuales de cada pagina publicada. Es la UNICA fuente valida para citar una pagina.",
  "Cuando puedas resolver una recomendacion contra una pagina CONCRETA de `stagingInventory[]`, declarala en `changePlans[]`: `targetPage` con la URL de staging o el slug EXACTOS copiados del inventario, la `operation` del catalogo, y `newValue` con el contenido nuevo COMPLETO del campo. Para `update_post_content`, el `post_content` ENTERO resultante -- no un fragmento, no un diff.",
  "UN plan de `changePlans[]` = UN destino. `targetPage` cita UNA sola pagina, nunca una lista ni un grupo (\"las 6 paginas con CTR 0%\"). Si la recomendacion afecta de verdad a varias paginas, produce UN PLAN POR PAGINA, cada uno con su propio `newValue`; una referencia que enumera varios destinos se rechaza entera y no se ejecuta ninguna.",
  "`targetPages[]` y `changePlans[]` NO son lo mismo: `targetPages[]` es el contexto afectado (puede citar varias paginas) y `changePlans[]` es donde se escribiria. Que una pagina aparezca como contexto no la convierte en objetivo de una escritura.",
  "`newValue` es el VALOR FINAL del campo, no una instruccion: \"optimizar el meta title\" NO es un meta title. Si no puedes decidir el texto exacto con lo que tienes, NO incluyas esa recomendacion en `changePlans[]` -- quedara marcada como que le falta detalle de ingenieria, y ese es el resultado correcto, no un fallo tuyo.",
  "NUNCA pongas un pageId ni un hash de version en `changePlans[]`: no existen esos campos y el sistema los resuelve por su cuenta contra el inventario. Si no puedes citar la pagina de forma exacta, NO incluyas esa recomendacion en `changePlans[]`: quedara como implementacion manual, y ese es el resultado correcto, no un fallo tuyo.",
  "Tampoco declaras el BEFORE: el estado actual de la pagina lo lee el sistema del sitio real. Tu trabajo es QUE cambiar y COMO debe quedar; DONDE se cambia, QUE hay ahora, si se puede ejecutar y si sigue siendo valido lo resuelve codigo determinista.",
  "Si `stagingInventory[]` viene vacio, `changePlans[]` debe ir vacio: sin inventario no hay evidencia con la que resolver ninguna pagina.",
  "Las unicas operaciones del catalogo son `update_post_content`, `update_post_title`, `update_post_excerpt` y `update_post_meta` (esta ultima solo con `_yoast_wpseo_title` o `_yoast_wpseo_metadesc`). Cualquier otra cosa -- redirecciones, media, usuarios, plugins, temas, ficheros, WP-CLI, SQL -- esta fuera de alcance y no se declara aqui.",
];

export function buildDepartmentWebEngineerContext(input: {
  departmentRunId: string;
  promotion: DepartmentPromotionResult;
  growthSummary: string;
  evidenceCatalog: GrowthEvidenceItem[];
  specialistInputs: DepartmentSpecialistInput[];
  /** Inventario REAL de staging ya leido. Vacio si no se pudo leer. */
  stagingInventory?: StagingPageBrief[];
  stagingInventoryUnavailableReason?: string;
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
    confirmedExistingPageUrls: (input.stagingInventory ?? []).map((page) => page.stagingUrl).filter((url) => url.trim().length > 0),
    stagingInventory: input.stagingInventory ?? [],
    stagingInventoryUnavailableReason: input.stagingInventoryUnavailableReason ?? "",
    noPluginThemeApiInventoryNotice: NO_PLUGIN_THEME_API_INVENTORY_NOTICE,
    noConfirmedPageInventoryNotice:
      (input.stagingInventory ?? []).length > 0
        ? "Esta pasada SI trae inventario real de staging (`stagingInventory[]`, leido por REST). Las paginas que aparecen ahi estan CONFIRMADAS: existen, con ese id, ese slug, esa URL y esos tipos de bloque. Cualquier pagina que NO este en esa lista sigue sin confirmar, y sobre ella no puedes declarar ningun changePlan."
        : NO_CONFIRMED_PAGE_INVENTORY_NOTICE,
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
