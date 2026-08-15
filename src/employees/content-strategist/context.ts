import { BrandIntentCategory, BrandTarget, ChangePack, ChangePackStatus, Priority } from "../../core/types";

/**
 * Context builder para el empleado `content-strategist` -- ver
 * docs/claude-employee-runtime.md y .claude/agents/content-strategist.md.
 *
 * Separacion CLAUDE / TOOLS explicita (mismo principio que
 * src/core/landing-architect-v2-context.ts): esta funcion es la parte
 * TOOL (deterministica, sin LLM) -- extrae y normaliza del change pack
 * de contenido ya generado por el pipeline determinista existente
 * (src/agents/content-work-order-builder.ts ->
 * src/agents/content-change-pack-builder.ts) exactamente los campos que
 * el subagente Claude necesita para razonar. Deliberadamente NO decide
 * nada de angulo, estructura, CTA ni enlazado interno -- eso es lo que
 * pasa al modelo (subagente `content-strategist`), que recibe este
 * objeto ya resuelto dentro de su prompt y nunca accede el repositorio
 * por su cuenta (`tools: []`).
 *
 * `proposedChanges` del ChangePack es `Record<string, unknown>` a nivel
 * de tipo (ver src/core/types.ts) -- en la practica, para un change pack
 * de contenido, lo rellena buildContentProposal() en
 * src/agents/content-work-order-builder.ts con la forma
 * `ContentProposedChanges` (contentType, recommendedTitle,
 * primaryKeyword, secondaryKeywords, structure, intent, targetBrand,
 * brandRationale, recommendedCta, internalLinks, clusterNote). Esta
 * funcion lee esos campos de forma DEFENSIVA (sin asumir el tipo en
 * tiempo de compilacion): un campo ausente o del tipo equivocado se
 * degrada a un valor por defecto vacio en vez de lanzar -- esto no es la
 * validacion fail-closed de la SALIDA de Claude (esa vive en
 * validateContentStrategistOutput(), sobre datos que SI decide confiar
 * el pipeline), es solo tolerancia de lectura sobre un campo interno del
 * propio departamento que ya paso por su propio pipeline determinista.
 */
export interface ContentStrategistContext {
  changePackId: string;
  workOrderId: string;
  keyword: string;
  page?: string;
  /** "new_content_page" | "content_update" -- ver resolveChangeType() en content-change-pack-builder.ts. */
  changeType: string;
  priority: Priority;
  status: ChangePackStatus;
  targetBrand: BrandTarget;
  brandIntent: BrandIntentCategory;
  /** Etiqueta humana ya calculada por el pipeline (p.ej. "Articulo", "FAQ", "Mejora de title/meta") -- pista, no orden. */
  contentTypeHint: string;
  recommendedTitleHint: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  /** H2/H3 ya propuestos por el Content Work Order Builder determinista -- punto de partida, el subagente puede ajustarlos con justificacion. */
  proposedStructureHint: string[];
  intentHint: string;
  brandRationale: string;
  recommendedCtaHint: string;
  /**
   * SOLO texto descriptivo de enlazado interno ("Enlazar hacia la
   * landing/categoria principal relacionada") -- NUNCA URLs reales. A
   * diferencia de LandingArchitectContext.internalLinks (que si filtra
   * URLs reales via isRealInternalUrl), este pipeline de contenido no
   * genera URLs de destino todavia (el contenido nuevo aun no existe
   * como pagina publicada) -- por eso el unico link real disponible es
   * `page` (la propia URL del change pack, si ya existe).
   */
  internalLinkHints: string[];
  clusterNote: string;
  /** Supuestos explicitos del pipeline previo -- unica fuente de "hechos confirmados" para la auditoria anti-fabricacion (ver audit.ts). */
  currentAssumptions: string[];
  risks: string[];
}

function readString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function buildContentStrategistContext(changePack: ChangePack): ContentStrategistContext {
  const proposal = (changePack.proposedChanges ?? {}) as Record<string, unknown>;

  return {
    changePackId: changePack.changePackId,
    workOrderId: changePack.workOrderId,
    keyword: changePack.keyword,
    page: changePack.page,
    changeType: changePack.changeType,
    priority: changePack.priority,
    status: changePack.status,
    targetBrand: changePack.targetBrand,
    brandIntent: changePack.brandIntent,
    contentTypeHint: readString(proposal, "contentType", changePack.changeType),
    recommendedTitleHint: readString(proposal, "recommendedTitle", changePack.keyword),
    primaryKeyword: readString(proposal, "primaryKeyword", changePack.keyword),
    secondaryKeywords: readStringArray(proposal, "secondaryKeywords"),
    proposedStructureHint: readStringArray(proposal, "structure"),
    intentHint: readString(proposal, "intent", ""),
    brandRationale: readString(proposal, "brandRationale", ""),
    recommendedCtaHint: readString(proposal, "recommendedCta", ""),
    internalLinkHints: readStringArray(proposal, "internalLinks"),
    clusterNote: readString(proposal, "clusterNote", ""),
    currentAssumptions: changePack.currentAssumptions,
    risks: changePack.risks,
  };
}
