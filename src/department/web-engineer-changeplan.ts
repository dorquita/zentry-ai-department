import {
  ALLOWED_POST_META_KEYS,
  EXECUTE_PHP_CONTRACT_VERSION,
  ExecutePhpChangePlan,
  ExecutePhpOperation,
  EXECUTE_PHP_OPERATIONS,
  CapabilitySelection,
  isAllowedPostMetaKey,
  selectExecutionPath,
  validateExecutePhpChangePlan,
} from "../core/execute-php-operations";
import { PageResolution, resolveStagingPage, StagingInventory, StagingPageSnapshot, versionHashOfPage } from "./staging-inventory";

/**
 * DE PROSA A CHANGEPLAN EJECUTABLE.
 *
 * Reparto de responsabilidades, y es el punto entero de este modulo:
 *
 *   CLAUDE (web-engineer) declara la INTENCION:
 *     - a que pagina apunta (URL de staging o slug),
 *     - que operacion (del catalogo cerrado),
 *     - el contenido nuevo.
 *
 *   ESTE MODULO resuelve los HECHOS, leidos del inventario real:
 *     - `wordpressPageId`,
 *     - el BEFORE real,
 *     - el `expectedBeforeHash`,
 *     - la capability y el `executionPath`.
 *
 * Claude NUNCA aporta pageId ni hash. No puede: no tiene herramientas y
 * este constructor los ignora aunque vinieran. Si la pagina no se
 * resuelve contra el inventario REAL, el resultado es `manual` con el
 * motivo exacto -- nunca un id adivinado.
 *
 * Y "ACTIONABLE" significa literalmente: si Pau la aprueba, el sistema
 * sabe ejecutarla. Un plan que no valida, o cuya pagina no se resuelve,
 * NO es actionable, por muy bien redactada que este la propuesta.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

/** Lo que Claude declara. Deliberadamente NO tiene pageId ni hash. */
export interface WebEngineerChangePlanDraft {
  /** Recomendacion de Growth/QA a la que corresponde. */
  recommendationId: string;
  /** Pagina objetivo: URL de staging o slug. Nunca un id inventado. */
  targetPage: string;
  operation: string;
  /** Contenido nuevo completo del campo del scope. */
  newValue: string;
  /** Solo para `update_post_meta`. Debe estar en la allowlist. */
  metaKey?: string;
  /** Por que este cambio responde a la recomendacion. Va al Daily Brief. */
  rationale: string;
}

export type ProposalStatus = "ACTIONABLE" | "BLOCKED" | "MANUAL" | "STALE";

export interface ResolvedChangePlan {
  recommendationId: string;
  status: ProposalStatus;
  /** El plan real, listo para ejecutar. `null` salvo en ACTIONABLE. */
  plan: ExecutePhpChangePlan | null;
  capability: CapabilitySelection | null;
  /** Pagina resuelta contra el inventario real. `null` si no se resolvio. */
  page: StagingPageSnapshot | null;
  /** Valor REAL actual del campo del scope, leido. */
  beforeValue: string;
  /** Valor propuesto. */
  afterValue: string;
  operation: string;
  rationale: string;
  /** Siempre no vacio: por que es ACTIONABLE, o exactamente que falta. */
  reason: string;
}

/** Campo del post que toca cada operacion, ya resuelto contra el snapshot. */
export function beforeValueFor(page: StagingPageSnapshot, operation: ExecutePhpOperation, metaKey?: string): string {
  switch (operation) {
    case "update_post_content":
      return page.contentHtml;
    case "update_post_title":
      return page.title;
    case "update_post_excerpt":
      return page.excerpt;
    case "update_post_meta":
      return page.meta[String(metaKey)] ?? "";
    default:
      return "";
  }
}

function manual(draft: WebEngineerChangePlanDraft, reason: string, page: StagingPageSnapshot | null = null): ResolvedChangePlan {
  return {
    recommendationId: draft.recommendationId,
    status: "MANUAL",
    plan: null,
    capability: null,
    page,
    beforeValue: "",
    afterValue: typeof draft.newValue === "string" ? draft.newValue : "",
    operation: String(draft.operation ?? ""),
    rationale: String(draft.rationale ?? ""),
    reason,
  };
}

export interface BuildChangePlanInput {
  draft: WebEngineerChangePlanDraft;
  inventory: StagingInventory;
}

/**
 * Construye el ChangePlan REAL a partir de la intencion declarada y del
 * inventario leido. Fail-closed en cada paso: cualquier hueco produce
 * `MANUAL` con el motivo, nunca un plan a medias.
 */
export function buildChangePlanFromDraft(input: BuildChangePlanInput): ResolvedChangePlan {
  const { draft, inventory } = input;

  if (typeof draft.recommendationId !== "string" || draft.recommendationId.trim().length === 0) {
    return manual(draft, "El draft no cita ninguna recommendationId. Sin trazabilidad no se construye plan.");
  }

  // 1. OPERACION: del catalogo cerrado y habilitada.
  const operation = String(draft.operation ?? "");
  const spec = (EXECUTE_PHP_OPERATIONS as Record<string, { enabled: boolean; reason: string; scopeFields: string[] }>)[operation];
  if (!spec) {
    return manual(draft, `Operacion "${operation}" desconocida. Solo existen: ${Object.keys(EXECUTE_PHP_OPERATIONS).join(", ")}.`);
  }
  if (!spec.enabled) {
    return manual(draft, `La operacion "${operation}" no esta habilitada en esta fase. ${spec.reason}`);
  }

  // 2. PAGINA: resuelta contra el inventario REAL. Aqui es donde se deja
  //    de adivinar.
  const resolution: PageResolution = resolveStagingPage(draft.targetPage ?? "", inventory);
  if (!resolution.page) {
    return manual(draft, `No se pudo resolver la pagina objetivo. ${resolution.reason}`);
  }
  const page = resolution.page;

  if (page.status !== "publish") {
    return manual(
      draft,
      `La pagina ${page.wordpressPageId} tiene status "${page.status}" y no "publish". Este flujo solo actua sobre paginas de staging publicadas (tienen que ser revisables abriendo una URL normal).`,
      page
    );
  }

  // 3. PAYLOAD.
  if (typeof draft.newValue !== "string" || draft.newValue.trim().length === 0) {
    return manual(draft, "El draft no trae contenido nuevo (`newValue`). Sin valor propuesto no hay nada que escribir.", page);
  }
  if (operation === "update_post_meta" && !isAllowedPostMetaKey(String(draft.metaKey))) {
    return manual(
      draft,
      `metaKey "${String(draft.metaKey)}" no esta en la allowlist (${ALLOWED_POST_META_KEYS.join(", ")}). Una clave libre seria una puerta para escribir en cualquier metadato del sitio.`,
      page
    );
  }

  const beforeValue = beforeValueFor(page, operation as ExecutePhpOperation, draft.metaKey);
  if (beforeValue === draft.newValue) {
    return manual(draft, "El valor propuesto es identico al actual: no hay ningun cambio que aplicar.", page);
  }

  // 4. ANCLA DE VERSION: leida, nunca declarada.
  const expectedBeforeHash = versionHashOfPage(page);

  const plan: ExecutePhpChangePlan = {
    contractVersion: EXECUTE_PHP_CONTRACT_VERSION,
    operation: operation as ExecutePhpOperation,
    targetId: page.wordpressPageId,
    expectedBeforeHash,
    payload:
      operation === "update_post_meta"
        ? { metaKey: String(draft.metaKey), value: draft.newValue }
        : { value: draft.newValue },
    scopeFields: [...spec.scopeFields],
  };

  const validation = validateExecutePhpChangePlan(plan);
  if (!validation.ok) {
    return manual(draft, `El plan construido no valida contra el contrato: ${validation.reason}`, page);
  }

  // 5. CAPABILITY: derivada del plan (tipos de bloque reales incluidos).
  const capability = selectExecutionPath({ plan });

  return {
    recommendationId: draft.recommendationId,
    status: "ACTIONABLE",
    plan,
    capability,
    page,
    beforeValue,
    afterValue: draft.newValue,
    operation,
    rationale: String(draft.rationale ?? ""),
    reason: `Ejecutable: ${resolution.reason} Operacion "${operation}" sobre el post ${page.wordpressPageId}, anclada a la version ${expectedBeforeHash.slice(0, 12)}. Camino: ${capability.executionPath}.`,
  };
}

/**
 * Valida la FORMA de los drafts que devuelve Claude. Un draft mal
 * formado no se interpreta a medias: se descarta con su motivo.
 */
export function parseChangePlanDrafts(raw: unknown): { drafts: WebEngineerChangePlanDraft[]; rejected: string[] } {
  if (raw === undefined || raw === null) return { drafts: [], rejected: [] };
  if (!Array.isArray(raw)) return { drafts: [], rejected: ["`changePlans` no es un array: se ignora entero."] };

  const drafts: WebEngineerChangePlanDraft[] = [];
  const rejected: string[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      rejected.push(`changePlans[${index}] no es un objeto.`);
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const allowed = ["recommendationId", "targetPage", "operation", "newValue", "metaKey", "rationale"];
    const unknownKey = Object.keys(candidate).find((key) => !allowed.includes(key));
    if (unknownKey) {
      rejected.push(`changePlans[${index}] trae la clave desconocida "${unknownKey}".`);
      return;
    }
    for (const field of ["recommendationId", "targetPage", "operation", "newValue", "rationale"]) {
      if (typeof candidate[field] !== "string" || String(candidate[field]).trim().length === 0) {
        rejected.push(`changePlans[${index}] no trae "${field}" como texto no vacio.`);
        return;
      }
    }
    if (candidate.metaKey !== undefined && typeof candidate.metaKey !== "string") {
      rejected.push(`changePlans[${index}].metaKey no es texto.`);
      return;
    }
    drafts.push({
      recommendationId: String(candidate.recommendationId),
      targetPage: String(candidate.targetPage),
      operation: String(candidate.operation),
      newValue: String(candidate.newValue),
      ...(typeof candidate.metaKey === "string" ? { metaKey: candidate.metaKey } : {}),
      rationale: String(candidate.rationale),
    });
  });
  return { drafts, rejected };
}
