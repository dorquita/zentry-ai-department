import {
  ExecutePhpChangePlan,
  ExecutePhpOperation,
  EXECUTE_PHP_OPERATIONS,
  PostMetaPayload,
  RollbackStrategy,
} from "../core/execute-php-operations";
import { StagingPageSnapshot, postTypeOf, versionHashOfPage } from "./staging-inventory";

/**
 * EL SOBRE EJECUTABLE de un cambio: `ExecutableChangePlan`.
 *
 * No es un sistema paralelo. Envuelve el `ExecutePhpChangePlan` que ya
 * existe (`src/core/execute-php-operations.ts`, el contrato que consume
 * el executor) y le añade, de forma EXPLICITA e inspeccionable, lo que
 * hasta ahora vivia implicito o repartido:
 *
 *   - a que apunta exactamente (`target`: pageId, URL, postType),
 *   - que hay AHORA (`before`, leido, nunca recordado),
 *   - como debe quedar (`after`),
 *   - que tiene que seguir siendo cierto para poder ejecutarlo
 *     (`preconditions`),
 *   - como se comprueba despues que se hizo -- y SOLO se hizo -- lo
 *     pedido (`validation`),
 *   - como se deshace (`rollback`, derivado del BEFORE real),
 *   - y por que es o no es ejecutable (`status`).
 *
 * `preconditions` y `validation` no inventan semantica nueva: DECLARAN
 * lo que el executor de staging ya hace hoy
 * (`src/department/apply/execute-php-executor.ts`) -- comparar el hash
 * de version antes de escribir, releer el campo del scope, comprobar que
 * nada fuera del scope cambio y que el status sigue igual. Escribirlo en
 * el plan permite INSPECCIONAR el contrato antes de conectar el
 * executor, que es justo la fase en la que estamos.
 *
 * PERSISTENCIA: este objeto es JSON plano (sin fechas vivas, sin clases,
 * sin referencias). Se puede guardar en un fichero, en una fila de
 * PostgreSQL o en ningun sitio. Este modulo no persiste nada y no conoce
 * ningun backend de persistencia, a proposito.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

export const EXECUTABLE_CHANGE_PLAN_CONTRACT_VERSION = "executable-change-plan/v1";

/**
 * Por que una propuesta es -- o no es -- ejecutable. Sustituye al
 * generico "requiere implementacion manual": la causa es un DATO, no una
 * frase, y cada valor apunta a una accion distinta.
 */
export type ChangePlanExecutionStatus =
  /** Todo resuelto: destino real, BEFORE leido, AFTER concreto, rollback derivado. Falta unicamente ejecutar. */
  | "READY_TO_EXECUTE"
  /** La pagina citada no existe en el inventario real. No se adivina. */
  | "UNRESOLVED_TARGET"
  /** La referencia casa con varias paginas, o enumera varios destinos. Un cambio escribe en UNA. */
  | "AMBIGUOUS_TARGET"
  /** La pagina existe pero no admite este flujo (p.ej. no esta publicada y no seria revisable abriendo una URL). */
  | "TARGET_NOT_EXECUTABLE"
  /** La operacion no esta en el catalogo, o esta en el catalogo pero no habilitada en esta fase. */
  | "UNSUPPORTED_OPERATION"
  /** Falta el AFTER concreto: no hay valor, es una instruccion en vez de un valor, o es identico al BEFORE. */
  | "NEEDS_ENGINEERING_DETAIL"
  /** El destino y la operacion son validos, pero el BEFORE real no se pudo leer. Sin BEFORE no hay rollback. */
  | "BEFORE_UNAVAILABLE"
  /** QA bloqueo la recomendacion de la que sale este plan. No se evalua nada mas. */
  | "BLOCKED_BY_QA"
  /** Staging cambio despues de construir el plan: lo que se propuso ya no es lo que hay. */
  | "STALE"
  /** El plan construido no valida contra el contrato del executor. No deberia pasar; si pasa, no se ejecuta. */
  | "INVALID_PLAN";

export const CHANGE_PLAN_EXECUTION_STATUSES: ChangePlanExecutionStatus[] = [
  "READY_TO_EXECUTE",
  "UNRESOLVED_TARGET",
  "AMBIGUOUS_TARGET",
  "TARGET_NOT_EXECUTABLE",
  "UNSUPPORTED_OPERATION",
  "NEEDS_ENGINEERING_DETAIL",
  "BEFORE_UNAVAILABLE",
  "BLOCKED_BY_QA",
  "STALE",
  "INVALID_PLAN",
];

/** Etiqueta legible de cada estado, para informes. Una sola fuente. */
export const CHANGE_PLAN_STATUS_LABEL: Record<ChangePlanExecutionStatus, string> = {
  READY_TO_EXECUTE: "READY TO EXECUTE (destino, BEFORE, AFTER y rollback resueltos)",
  UNRESOLVED_TARGET: "UNRESOLVED TARGET (la pagina citada no existe en staging)",
  AMBIGUOUS_TARGET: "AMBIGUOUS TARGET (la referencia casa con mas de una pagina)",
  TARGET_NOT_EXECUTABLE: "TARGET NOT EXECUTABLE (la pagina existe pero no admite este flujo)",
  UNSUPPORTED_OPERATION: "UNSUPPORTED OPERATION (no hay executor reversible para esa operacion)",
  NEEDS_ENGINEERING_DETAIL: "NEEDS ENGINEERING DETAIL (falta el valor concreto del AFTER)",
  BEFORE_UNAVAILABLE: "BEFORE UNAVAILABLE (no se pudo leer el estado actual del campo)",
  BLOCKED_BY_QA: "BLOCKED BY QA",
  STALE: "STALE (staging cambio despues de proponer el cambio)",
  INVALID_PLAN: "INVALID PLAN (el plan no valida contra el contrato del executor)",
};

export interface ChangePlanTarget {
  /** Entorno del cambio. Hoy siempre staging: produccion tiene su propio camino, con aprobacion humana. */
  environment: "staging";
  pageId: number;
  /** URL publica REAL de staging, tal como la devolvio WordPress. */
  url: string;
  slug: string;
  postType: string;
  /** Como se resolvio el destino (id explicito, URL exacta, ruta exacta, slug exacto). */
  resolvedBy: string;
}

/**
 * Condicion que debe seguir siendo cierta EN EL MOMENTO de ejecutar. No
 * es documentacion: es lo que el executor ya comprueba antes de escribir.
 */
export interface ChangePlanPrecondition {
  kind: "page_exists" | "page_status_is" | "version_hash_matches" | "field_equals";
  /** Campo del post al que se refiere la condicion (`post_title`, `post_meta`...). Vacio si no aplica. */
  field: string;
  /** Clave de meta, solo para `post_meta`. Vacio si no aplica. */
  metaKey: string;
  /** Valor exacto que se espera encontrar. */
  expected: string;
  /** Por que esta condicion existe, en una frase. */
  description: string;
}

/** Comprobacion posterior a la escritura. Se hace releyendo el sitio, nunca fiandose de la respuesta de la escritura. */
export interface ChangePlanValidationCheck {
  kind: "field_equals" | "out_of_scope_unchanged" | "page_status_unchanged";
  field: string;
  metaKey: string;
  expected: string;
  description: string;
}

/** Como se deshace el cambio. Se deriva del BEFORE leido, nunca de lo que alguien recuerde. */
export interface ChangePlanRollback {
  operation: ExecutePhpOperation;
  strategy: RollbackStrategy;
  /** Valores exactos a restaurar: campo -> valor de ANTES. */
  values: Record<string, string>;
  /**
   * `false` cuando la clave de meta NO existia antes: revertir entonces
   * es BORRARLA, no escribir cadena vacia (si no, el rollback dejaria un
   * metadato que nadie habia puesto).
   */
  targetExistedBefore: boolean;
  description: string;
}

/**
 * El plan ejecutable completo. Todo lo que hace falta para ejecutar --
 * y para decidir que NO se ejecuta -- sin volver a interpretar prosa.
 */
export interface ExecutableChangePlan {
  contractVersion: string;
  changePlanId: string;
  recommendationId: string;
  environment: "staging";
  target: ChangePlanTarget;
  operation: ExecutePhpOperation;
  /** Estado REAL leido del campo (o campos) del scope, antes del cambio. */
  before: Record<string, string>;
  /** Estado deseado, concreto. Mismas claves que `before`. */
  after: Record<string, string>;
  preconditions: ChangePlanPrecondition[];
  validation: ChangePlanValidationCheck[];
  rollback: ChangePlanRollback;
  status: ChangePlanExecutionStatus;
  /** El plan de bajo nivel que consume el executor. Mismo objeto, sin duplicar la verdad. */
  executePhpPlan: ExecutePhpChangePlan;
  /** Momento en que se leyo el inventario del que sale el BEFORE. Para poder razonar sobre antiguedad. */
  observedAt: string;
  /** Por que esta en este estado. Siempre no vacio. */
  reason: string;
}

/** Nombre del campo del post que toca cada operacion. */
export function scopeFieldFor(operation: ExecutePhpOperation, metaKey?: string): string {
  if (operation === "update_post_meta") return String(metaKey ?? "");
  const spec = EXECUTE_PHP_OPERATIONS[operation];
  return spec ? spec.scopeFields[0] ?? "" : "";
}

/**
 * Id determinista del plan: misma recomendacion + misma operacion +
 * mismo destino -> mismo id. Estable a proposito, para que replanificar
 * no duplique planes ni al persistirlos en PostgreSQL mas adelante.
 */
export function buildChangePlanId(recommendationId: string, operation: string, pageId: number, metaKey?: string): string {
  const suffix = metaKey && metaKey.trim().length > 0 ? `:${metaKey}` : "";
  return `${recommendationId}#plan-${operation}${suffix}@${pageId}`;
}

// --- ¿El AFTER es un VALOR o es una instruccion? -------------------------

/**
 * Marcadores de "esto es un hueco por rellenar" que lo son en CUALQUIER
 * campo, cuerpo de pagina incluido.
 */
const PLACEHOLDER_PATTERN = /\b(TBD|TODO|FIXME|XXX|lorem ipsum)\b|\{\{[^}]*\}\}/i;

/**
 * Marcadores que solo se pueden tratar como hueco en campos CORTOS
 * (title/excerpt/meta). En el cuerpo de una pagina real cualquiera de
 * estos aparece de forma legitima: "<h2>" es HTML, "pendiente" es una
 * palabra normal en castellano y unos puntos suspensivos son puntuacion.
 */
const SHORT_FIELD_PLACEHOLDER_PATTERN = /\b(PENDIENTE|por definir|por completar|a rellenar)\b|<[^>]{1,40}>|\[\.\.\.\]|\.\.\.\s*$/i;

/**
 * Frases que describen QUE hacer en vez de decir COMO queda. Es el
 * corazon del cuello de botella: "optimizar el meta title" no es un meta
 * title. Solo se aplica a campos CORTOS (title/excerpt/meta): el cuerpo
 * de una pagina puede empezar con un verbo legitimamente.
 */
const INSTRUCTION_PATTERN =
  /^\s*(optimiz|mejor|revis|actualiz|reescrib|reescrit|ajust|añad|anad|incluir|incluye|redact|proponer|propon|crear|crea|generar|genera|definir|define|elaborar|elabora|reforz)[a-zñáéíóú]*\b/i;

/** Longitudes maximas defensivas por campo. Un valor desproporcionado es señal de texto capturado por error. */
export const MAX_TITLE_VALUE_LENGTH = 200;
export const MAX_SHORT_TEXT_VALUE_LENGTH = 400;

export interface AfterValueAssessment {
  concrete: boolean;
  /** Vacio si es concreto. Si no, exactamente que falta. */
  reason: string;
}

/**
 * ¿El AFTER propuesto es un valor CONCRETO que se pueda escribir tal
 * cual? Determinista y conservador: ante la duda, no es ejecutable --
 * `NEEDS_ENGINEERING_DETAIL` es un resultado correcto, no un fallo.
 */
export function assessAfterValue(operation: ExecutePhpOperation, afterValue: string, beforeValue: string): AfterValueAssessment {
  const value = String(afterValue ?? "");
  if (value.trim().length === 0) {
    return { concrete: false, reason: "El AFTER propuesto esta vacio: no hay ningun valor que escribir." };
  }
  if (value === beforeValue) {
    return {
      concrete: false,
      reason:
        "El valor propuesto es identico al actual: no hay ningun cambio que aplicar (y el actual se leyo del sitio, no del contexto del modelo).",
    };
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    return {
      concrete: false,
      reason: `El AFTER propuesto contiene un marcador de hueco por rellenar ("${value.slice(0, 80)}"), no un valor final.`,
    };
  }

  const isShortField = operation !== "update_post_content";
  if (isShortField) {
    if (SHORT_FIELD_PLACEHOLDER_PATTERN.test(value)) {
      return {
        concrete: false,
        reason: `El AFTER propuesto contiene un marcador de hueco por rellenar ("${value.slice(0, 80)}"), no un valor final.`,
      };
    }
    if (INSTRUCTION_PATTERN.test(value)) {
      return {
        concrete: false,
        reason: `El AFTER propuesto ("${value.slice(0, 80)}") describe QUE hacer, no COMO queda el campo. Hace falta el texto final exacto.`,
      };
    }
    const max = operation === "update_post_title" ? MAX_TITLE_VALUE_LENGTH : MAX_SHORT_TEXT_VALUE_LENGTH;
    if (value.length > max) {
      return {
        concrete: false,
        reason: `El AFTER propuesto mide ${value.length} caracteres, por encima del maximo defensivo de ${max} para "${operation}". Un valor asi de largo suele ser texto capturado por error, no el valor del campo.`,
      };
    }
  }

  return { concrete: true, reason: "" };
}

// --- Construccion del sobre ejecutable -----------------------------------

export interface BuildExecutableChangePlanInput {
  recommendationId: string;
  page: StagingPageSnapshot;
  operation: ExecutePhpOperation;
  metaKey?: string;
  beforeValue: string;
  afterValue: string;
  executePhpPlan: ExecutePhpChangePlan;
  /** Como se resolvio el destino, tal cual lo explico el resolvedor. */
  resolvedBy: string;
  /** `capturedAt` del inventario del que salio el BEFORE. */
  observedAt: string;
  status: ChangePlanExecutionStatus;
  reason: string;
  /** `false` solo cuando la operacion es sobre meta y la clave NO existia antes. */
  targetExistedBefore?: boolean;
}

/**
 * Construye el sobre a partir de datos YA resueltos. No resuelve nada
 * por su cuenta: quien llama (`buildChangePlanFromDraft`) es quien ha
 * hecho la resolucion determinista contra el inventario real.
 */
export function buildExecutableChangePlan(input: BuildExecutableChangePlanInput): ExecutableChangePlan {
  const { page, operation, metaKey } = input;
  const spec = EXECUTE_PHP_OPERATIONS[operation];
  const field = scopeFieldFor(operation, metaKey);
  const metaKeyValue = operation === "update_post_meta" ? String(metaKey ?? "") : "";
  const versionHash = versionHashOfPage(page);
  const targetExistedBefore = input.targetExistedBefore ?? true;

  const preconditions: ChangePlanPrecondition[] = [
    {
      kind: "page_exists",
      field: "",
      metaKey: "",
      expected: String(page.wordpressPageId),
      description: `El post ${page.wordpressPageId} debe seguir existiendo en staging. Se resolvio contra el inventario real leido en ${input.observedAt}.`,
    },
    {
      kind: "page_status_is",
      field: "status",
      metaKey: "",
      expected: page.status,
      description: `El status del post debe seguir siendo "${page.status}": este flujo no publica ni despublica nada, solo edita lo ya publicado.`,
    },
    {
      kind: "version_hash_matches",
      field: "",
      metaKey: "",
      expected: versionHash,
      description:
        "La version de la pagina debe seguir siendo la misma sobre la que se propuso el cambio. Si no coincide, el plan es STALE y no se ejecuta: el AFTER se penso sobre otro contenido.",
    },
    {
      kind: "field_equals",
      field,
      metaKey: metaKeyValue,
      expected: input.beforeValue,
      description: `El valor actual de "${field}" debe seguir siendo exactamente el BEFORE leido. Es la condicion que protege contra escribir encima de una edicion de otra persona.`,
    },
  ];

  const validation: ChangePlanValidationCheck[] = [
    {
      kind: "field_equals",
      field,
      metaKey: metaKeyValue,
      expected: input.afterValue,
      description: `Tras escribir, se RELEE el sitio y "${field}" debe valer exactamente el AFTER. La respuesta de la escritura no cuenta como prueba.`,
    },
    {
      kind: "out_of_scope_unchanged",
      field: (spec?.scopeFields ?? []).join(","),
      metaKey: metaKeyValue,
      expected: "",
      description: `Ningun campo fuera del scope declarado (${(spec?.scopeFields ?? []).join(", ") || "ninguno"}) puede haber cambiado. "Funciono lo que pedi" y "solo cambio lo que pedi" son cosas distintas.`,
    },
    {
      kind: "page_status_unchanged",
      field: "status",
      metaKey: "",
      expected: page.status,
      description: `El status debe seguir siendo "${page.status}" despues del cambio.`,
    },
  ];

  const rollback: ChangePlanRollback = {
    operation,
    strategy: spec?.rollback ?? "none",
    values: { [field]: input.beforeValue },
    targetExistedBefore,
    description: targetExistedBefore
      ? `Revertir es reescribir "${field}" con el BEFORE leido del sitio, con la misma API. El valor no depende de que nadie recuerde nada: viaja dentro de este plan.`
      : `La clave "${field}" NO existia antes del cambio: revertir es BORRARLA, no escribir cadena vacia (si no, el rollback dejaria un metadato que nadie habia puesto).`,
  };

  return {
    contractVersion: EXECUTABLE_CHANGE_PLAN_CONTRACT_VERSION,
    changePlanId: buildChangePlanId(input.recommendationId, operation, page.wordpressPageId, metaKey),
    recommendationId: input.recommendationId,
    environment: "staging",
    target: {
      environment: "staging",
      pageId: page.wordpressPageId,
      url: page.stagingUrl,
      slug: page.slug,
      postType: postTypeOf(page),
      resolvedBy: input.resolvedBy,
    },
    operation,
    before: { [field]: input.beforeValue },
    after: { [field]: input.afterValue },
    preconditions,
    validation,
    rollback,
    status: input.status,
    executePhpPlan: input.executePhpPlan,
    observedAt: input.observedAt,
    reason: input.reason,
  };
}

// --- Frescura ------------------------------------------------------------

export interface ChangePlanFreshness {
  fresh: boolean;
  status: "READY_TO_EXECUTE" | "STALE";
  /** Preconditions que ya NO se cumplen. Vacio si el plan sigue fresco. */
  failedPreconditions: ChangePlanPrecondition[];
  reason: string;
}

/**
 * ¿Sigue siendo valido este plan contra el estado ACTUAL de la pagina?
 *
 * Se evalua releyendo, nunca recordando: quien llama pasa el snapshot
 * fresco. Cualquier precondition incumplida deja el plan en `STALE` --
 * no se "reajusta" el plan al estado nuevo, porque el AFTER se penso
 * sobre el contenido viejo y podria dejar de tener sentido.
 */
export function evaluateChangePlanFreshness(plan: ExecutableChangePlan, currentPage: StagingPageSnapshot | null): ChangePlanFreshness {
  if (currentPage === null) {
    const missing = plan.preconditions.filter((p) => p.kind === "page_exists");
    return {
      fresh: false,
      status: "STALE",
      failedPreconditions: missing,
      reason: `El post ${plan.target.pageId} ya no existe en staging (o no se pudo leer). El plan no se ejecuta.`,
    };
  }

  const currentValues: Record<ChangePlanPrecondition["kind"], (p: ChangePlanPrecondition) => string> = {
    page_exists: () => String(currentPage.wordpressPageId),
    page_status_is: () => currentPage.status,
    version_hash_matches: () => versionHashOfPage(currentPage),
    field_equals: (p) => currentFieldValue(currentPage, plan.operation, p.metaKey),
  };

  const failed = plan.preconditions.filter((p) => currentValues[p.kind](p) !== p.expected);
  if (failed.length === 0) {
    return {
      fresh: true,
      status: "READY_TO_EXECUTE",
      failedPreconditions: [],
      reason: `Las ${plan.preconditions.length} preconditions siguen cumpliendose contra el estado actual del post ${plan.target.pageId}.`,
    };
  }

  return {
    fresh: false,
    status: "STALE",
    failedPreconditions: failed,
    reason: `Staging cambio despues de construir el plan: ${failed
      .map((p) => `${p.kind}${p.field ? ` (${p.field})` : ""}`)
      .join(", ")} ya no se cumple${failed.length === 1 ? "" : "n"}. El AFTER se penso sobre otro estado, asi que hay que volver a proponerlo sobre el actual.`,
  };
}

function currentFieldValue(page: StagingPageSnapshot, operation: ExecutePhpOperation, metaKey: string): string {
  switch (operation) {
    case "update_post_content":
      return page.contentHtml;
    case "update_post_title":
      return page.title;
    case "update_post_excerpt":
      return page.excerpt;
    case "update_post_meta":
      return page.meta[metaKey] ?? "";
    default:
      return "";
  }
}

/** Valor de meta que declara el plan, para no repetir el cast en cada sitio. */
export function metaKeyOfPlan(plan: ExecutableChangePlan): string {
  return plan.operation === "update_post_meta" ? (plan.executePhpPlan.payload as PostMetaPayload).metaKey : "";
}
