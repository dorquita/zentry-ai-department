import { assessNativeAbilityForPlan } from "./novamira-ability-capabilities";

/**
 * CONTRATO DE OPERACIONES para el fallback `novamira/execute-php`.
 *
 * Este modulo es la frontera entre "Claude propone un cambio" y "se
 * ejecuta PHP en staging". Define UNA cosa: el catalogo cerrado de
 * operaciones que el sistema sabe hacer con PHP, y con que forma exacta
 * se describen. No genera PHP, no lo ejecuta y no decide si esta
 * permitido -- eso son otros dos modulos (`execute-php-builder.ts` y
 * `execute-php-guard.ts`).
 *
 * La regla de fondo, y el motivo de que este fichero exista:
 *
 *     Claude NUNCA escribe PHP. Claude escribe un ChangePlan
 *     ESTRUCTURADO. Una capa determinista traduce ese plan al PHP
 *     permitido, siempre a partir de una plantilla fija.
 *
 * Asi la superficie de codigo arbitrario no es "lo que se le ocurra al
 * modelo": es el conjunto finito de plantillas de este catalogo, con los
 * unicos huecos que admiten datos variables ya codificados de forma que
 * no pueden alterar la sintaxis (ver `execute-php-builder.ts`).
 *
 * PRIORIDAD DE CAPACIDAD (no negociable, se registra siempre):
 *
 *   1. Si existe una ability nativa de Novamira que resuelve la
 *      operacion -> se usa esa (`native_ability`).
 *   2. Solo si no existe, o no soporta el caso -> `execute_php_fallback`.
 *
 * Y "resuelve la operacion" no es "existe una ability con ese nombre":
 * `selectExecutionPath()` comprueba que la nativa soporta REALMENTE el
 * contenido concreto (ver `novamira-ability-capabilities.ts`). PHP nunca
 * por comodidad, pero tampoco se enruta a una nativa que va a rechazar
 * la escritura.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

/** Version del contrato. Un plan con otra version no se ejecuta (fail-closed). */
export const EXECUTE_PHP_CONTRACT_VERSION = "execute-php-plan/v1";

/**
 * Operaciones del catalogo. Estar aqui NO significa estar habilitada:
 * `EXECUTE_PHP_OPERATIONS` decide cuales son ejecutables en esta primera
 * fase y cuales quedan aparte por no tener rollback seguro todavia.
 */
export type ExecutePhpOperation =
  | "update_post_content"
  | "update_post_title"
  | "update_post_excerpt"
  | "update_post_meta"
  | "create_page"
  | "update_redirect"
  | "update_term_assignment";

/** Como se deshace una operacion. `none` = no ejecutable en esta fase. */
export type RollbackStrategy = "restore_post_field" | "restore_post_meta" | "none";

export interface ExecutePhpOperationSpec {
  operation: ExecutePhpOperation;
  /**
   * `true` solo si la operacion tiene plantilla determinista Y estrategia
   * de rollback verificable. Una operacion sin rollback seguro NO se
   * ejecuta automaticamente en esta fase, por diseño.
   */
  enabled: boolean;
  /** API de WordPress elegida, y por que es la mas segura para este caso. */
  wordpressApi: string;
  /** Campos del post que la operacion puede tocar. Cualquier otro cambio detectado en la validacion es un fallo. */
  scopeFields: string[];
  rollback: RollbackStrategy;
  /** Motivo textual: por que esta habilitada, o exactamente que falta para habilitarla. */
  reason: string;
}

/**
 * Claves de post meta que el fallback puede tocar. Allowlist cerrada a
 * proposito: `update_post_meta` con clave libre seria una puerta trasera
 * para escribir en cualquier metadato del sitio (incluidos los que
 * plugins usan para permisos o para guardar tokens).
 */
export const ALLOWED_POST_META_KEYS = ["_yoast_wpseo_title", "_yoast_wpseo_metadesc"] as const;

export type AllowedPostMetaKey = (typeof ALLOWED_POST_META_KEYS)[number];

export function isAllowedPostMetaKey(key: string): key is AllowedPostMetaKey {
  return (ALLOWED_POST_META_KEYS as readonly string[]).includes(key);
}

/**
 * El catalogo. Cada entrada declara la API de WordPress elegida en vez de
 * SQL directo: `wp_update_post`/`update_post_meta` disparan los hooks,
 * invalidan caches, respetan revisiones y sanitizan igual que una edicion
 * humana. Un `UPDATE wp_posts` directo no hace nada de eso, y por eso no
 * se usa en ninguna operacion habilitada.
 */
export const EXECUTE_PHP_OPERATIONS: Record<ExecutePhpOperation, ExecutePhpOperationSpec> = {
  update_post_content: {
    operation: "update_post_content",
    enabled: true,
    wordpressApi:
      "wp_update_post(['ID'=>N,'post_content'=>...]) -- API canonica de edicion. Dispara hooks, crea revision y pasa por la sanitizacion normal de WordPress; un UPDATE directo a wp_posts no haria nada de eso.",
    scopeFields: ["post_content"],
    rollback: "restore_post_field",
    reason: "El cuerpo anterior se guarda entero en el snapshot, asi que revertir es volver a escribirlo con la misma API.",
  },
  update_post_title: {
    operation: "update_post_title",
    enabled: true,
    wordpressApi: "wp_update_post(['ID'=>N,'post_title'=>...]) -- misma API canonica; nunca toca post_name/slug.",
    scopeFields: ["post_title"],
    rollback: "restore_post_field",
    reason: "El title anterior esta en el snapshot. Ojo: no se toca el slug, que en WordPress no cambia solo al cambiar el titulo de un post ya publicado.",
  },
  update_post_excerpt: {
    operation: "update_post_excerpt",
    enabled: true,
    wordpressApi: "wp_update_post(['ID'=>N,'post_excerpt'=>...]).",
    scopeFields: ["post_excerpt"],
    rollback: "restore_post_field",
    reason: "El excerpt anterior esta en el snapshot.",
  },
  update_post_meta: {
    operation: "update_post_meta",
    enabled: true,
    wordpressApi:
      "update_post_meta()/delete_post_meta() sobre una clave de ALLOWED_POST_META_KEYS. Solo metadatos de SEO (Yoast); cualquier otra clave se rechaza.",
    scopeFields: ["post_meta"],
    rollback: "restore_post_meta",
    reason:
      "El snapshot guarda el valor anterior y si la clave existia. Revertir es reescribir el valor, o borrar la clave si antes no existia (si no, el rollback dejaria un metadato que nadie habia puesto).",
  },
  create_page: {
    operation: "create_page",
    enabled: false,
    wordpressApi: "wp_insert_post() seria la API correcta.",
    scopeFields: [],
    rollback: "none",
    reason:
      "APARTE en esta fase: el rollback de una creacion es borrar la pagina, y eso deja residuo (ID consumido, entradas de papelera, posibles referencias). Ademas exige politica propia de status/slug/plantilla. Necesita una decision separada, no se ejecuta automaticamente.",
  },
  update_redirect: {
    operation: "update_redirect",
    enabled: false,
    wordpressApi: "Dependeria del plugin de redirecciones instalado; no hay inventario confirmado de plugins en este contexto.",
    scopeFields: [],
    rollback: "none",
    reason:
      "APARTE en esta fase: sin saber que plugin gestiona las redirecciones no se puede elegir una API segura ni un rollback verificable, y adivinarlo seria escribir a ciegas en configuracion global. Requiere inventario de plugins primero.",
  },
  update_term_assignment: {
    operation: "update_term_assignment",
    enabled: false,
    wordpressApi: "wp_set_object_terms() seria la API correcta.",
    scopeFields: [],
    rollback: "none",
    reason:
      "APARTE en esta fase: reasignar taxonomias afecta a archivos, menus y canonicals mas alla de la pagina objetivo, asi que la validacion 'no se toco nada fuera del scope' no se puede comprobar solo releyendo el post. Necesita su propio diseño de validacion.",
  },
};

export function isExecutePhpOperation(value: string): value is ExecutePhpOperation {
  return Object.prototype.hasOwnProperty.call(EXECUTE_PHP_OPERATIONS, value);
}

/** Operaciones realmente ejecutables hoy. */
export function enabledExecutePhpOperations(): ExecutePhpOperation[] {
  return (Object.keys(EXECUTE_PHP_OPERATIONS) as ExecutePhpOperation[]).filter((op) => EXECUTE_PHP_OPERATIONS[op].enabled);
}

// --- El ChangePlan -------------------------------------------------------

/** Payload de una operacion sobre un campo del post. */
export interface PostFieldPayload {
  /** Valor nuevo del unico campo dentro del scope. */
  value: string;
}

/** Payload de una operacion sobre post meta. */
export interface PostMetaPayload {
  metaKey: string;
  value: string;
}

export type ExecutePhpPayload = PostFieldPayload | PostMetaPayload;

/**
 * El plan estructurado. Es lo unico que Claude (via web-engineer) puede
 * producir: nunca una cadena de PHP.
 */
export interface ExecutePhpChangePlan {
  contractVersion: string;
  operation: ExecutePhpOperation;
  /** ID del post/pagina objetivo en WordPress. Entero positivo, siempre explicito. */
  targetId: number;
  /**
   * Hash de la version EXACTA sobre la que se propuso el cambio
   * (`computeVersionHash`). Si al leer el estado real no coincide, el
   * plan es STALE y no se ejecuta.
   */
  expectedBeforeHash: string;
  payload: ExecutePhpPayload;
  /**
   * Campos que el plan declara que va a cambiar. Debe coincidir con
   * `scopeFields` de la operacion: sirve para que la validacion posterior
   * pueda afirmar "no se toco nada fuera del scope" con una lista
   * explicita, no implicita.
   */
  scopeFields: string[];
}

export interface PlanValidationResult {
  ok: boolean;
  /** Vacio si `ok`. Si no, el motivo exacto del rechazo. */
  reason: string;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Valida la FORMA de un plan. Fail-closed: todo lo que no encaje
 * exactamente se rechaza, incluido un plan con campos de mas (un plan con
 * claves desconocidas es un plan que alguien construyo con otro contrato
 * en la cabeza).
 */
export function validateExecutePhpChangePlan(plan: unknown): PlanValidationResult {
  if (typeof plan !== "object" || plan === null) return { ok: false, reason: "El ChangePlan no es un objeto." };
  const candidate = plan as Record<string, unknown>;

  const allowedKeys = ["contractVersion", "operation", "targetId", "expectedBeforeHash", "payload", "scopeFields"];
  const unknownKey = Object.keys(candidate).find((key) => !allowedKeys.includes(key));
  if (unknownKey) {
    return { ok: false, reason: `El ChangePlan trae la clave desconocida "${unknownKey}". Fail-closed: un plan con campos de mas no se interpreta a medias.` };
  }

  if (candidate.contractVersion !== EXECUTE_PHP_CONTRACT_VERSION) {
    return { ok: false, reason: `contractVersion "${String(candidate.contractVersion)}" no soportada (se esperaba "${EXECUTE_PHP_CONTRACT_VERSION}").` };
  }

  const operation = candidate.operation;
  if (typeof operation !== "string" || !isExecutePhpOperation(operation)) {
    return { ok: false, reason: `Operacion "${String(operation)}" desconocida. Solo existen: ${Object.keys(EXECUTE_PHP_OPERATIONS).join(", ")}.` };
  }
  const spec = EXECUTE_PHP_OPERATIONS[operation];
  if (!spec.enabled) {
    return { ok: false, reason: `La operacion "${operation}" NO esta habilitada en esta fase. ${spec.reason}` };
  }

  const targetId = candidate.targetId;
  if (typeof targetId !== "number" || !Number.isInteger(targetId) || targetId <= 0) {
    return { ok: false, reason: `targetId debe ser un entero positivo y llego "${String(targetId)}". Sin objetivo explicito no se escribe nada.` };
  }

  const expectedBeforeHash = candidate.expectedBeforeHash;
  if (typeof expectedBeforeHash !== "string" || !HEX_64.test(expectedBeforeHash)) {
    return { ok: false, reason: "expectedBeforeHash debe ser un sha256 hexadecimal de 64 caracteres. Sin ancla de version no se puede detectar un estado STALE." };
  }

  if (!Array.isArray(candidate.scopeFields) || candidate.scopeFields.length !== spec.scopeFields.length) {
    return { ok: false, reason: `scopeFields debe declarar exactamente [${spec.scopeFields.join(", ")}] para la operacion "${operation}".` };
  }
  const scopeMismatch = spec.scopeFields.find((field) => !(candidate.scopeFields as unknown[]).includes(field));
  if (scopeMismatch) {
    return { ok: false, reason: `scopeFields no declara "${scopeMismatch}", que es justo lo que la operacion "${operation}" modifica.` };
  }

  const payload = candidate.payload;
  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "payload ausente o no es un objeto." };
  const payloadRecord = payload as Record<string, unknown>;

  if (operation === "update_post_meta") {
    const metaKey = payloadRecord.metaKey;
    if (typeof metaKey !== "string" || !isAllowedPostMetaKey(metaKey)) {
      return {
        ok: false,
        reason: `metaKey "${String(metaKey)}" no esta en la allowlist de claves de meta (${ALLOWED_POST_META_KEYS.join(", ")}). Una clave libre seria una puerta para escribir en cualquier metadato del sitio.`,
      };
    }
    if (typeof payloadRecord.value !== "string") return { ok: false, reason: "payload.value debe ser una cadena." };
    const extra = Object.keys(payloadRecord).find((key) => key !== "metaKey" && key !== "value");
    if (extra) return { ok: false, reason: `payload trae la clave desconocida "${extra}".` };
  } else {
    if (typeof payloadRecord.value !== "string") return { ok: false, reason: "payload.value debe ser una cadena." };
    const extra = Object.keys(payloadRecord).find((key) => key !== "value");
    if (extra) return { ok: false, reason: `payload trae la clave desconocida "${extra}".` };
  }

  return { ok: true, reason: "" };
}

// --- Seleccion de capacidad ---------------------------------------------

export type ExecutionPath = "native_ability" | "execute_php_fallback";

export interface CapabilitySelection {
  executionPath: ExecutionPath;
  /** Ability nativa que resolveria la operacion, si existe. `null` = no existe ninguna. */
  nativeAbility: string | null;
  /** Por que se eligio ese camino. Siempre no vacio. */
  reason: string;
  /**
   * Motivo DECLARADO por el que la ability nativa no sirve para este
   * caso. Campo propio, separado de `reason`, justo para que el guard
   * pueda exigirlo: si estuviera mezclado en `reason` (que esta funcion
   * siempre rellena) no habria forma de distinguir "se justifico" de "se
   * genero un texto". Vacio cuando no hay ability nativa que justificar.
   */
  nativeAbilityUnsuitableReason: string;
}

/**
 * Ability nativa de Novamira que resuelve cada operacion, cuando la hay.
 * `null` significa "no existe ninguna ability que haga esto", y es lo
 * unico que autoriza a considerar el fallback de PHP.
 *
 * `gutenberg-write-content` SI puede reemplazar el cuerpo de un post,
 * asi que `update_post_content` tiene camino nativo y NO debe caer en PHP
 * salvo que ese camino no aplique al caso concreto (y entonces hay que
 * decir por que).
 */
export const NATIVE_ABILITY_FOR_OPERATION: Record<ExecutePhpOperation, string | null> = {
  update_post_content: "novamira/gutenberg-write-content",
  update_post_title: null,
  update_post_excerpt: null,
  update_post_meta: null,
  create_page: null,
  update_redirect: null,
  update_term_assignment: null,
};

/**
 * Decide el camino de ejecucion A PARTIR DEL PLAN, no de lo que declare
 * quien llama.
 *
 * Tres pasos, en este orden:
 *
 *   1. ¿Existe una ability nativa para esta operacion?
 *   2. Si existe, ¿soporta REALMENTE este target/contenido? La respuesta
 *      se deriva del ChangePlan (tipos de bloque reales) contra las
 *      capacidades leidas del servidor -- ver
 *      `novamira-ability-capabilities.ts`.
 *   3. Solo si (1) y (2) -> `native_ability`. Si existe pero es
 *      incompatible -> `execute_php_fallback`, con un motivo
 *      VERIFICABLE (no una frase que alguien haya escrito a mano).
 *
 * Por que ya no se acepta un `nativeAbilityUnsuitableReason` de quien
 * llama: era exactamente la puerta que esta funcion existe para cerrar.
 * Si el motivo lo aporta el caller, el caller decide el camino; si se
 * deriva del contenido, lo decide el contenido.
 */
export function selectExecutionPath(input: { plan: ExecutePhpChangePlan }): CapabilitySelection {
  const operation = input.plan.operation;
  const nativeAbility = NATIVE_ABILITY_FOR_OPERATION[operation] ?? null;

  if (nativeAbility === null) {
    return {
      executionPath: "execute_php_fallback",
      nativeAbility: null,
      nativeAbilityUnsuitableReason: "",
      reason: `No existe ninguna ability nativa de Novamira que resuelva "${operation}". El fallback de PHP es el unico camino.`,
    };
  }

  const support = assessNativeAbilityForPlan(input.plan);
  if (support === null) {
    // No deberia ocurrir: hay ability nativa declarada pero nadie sabe
    // evaluar su aplicabilidad. Fail-closed hacia la nativa, que es la
    // opcion conservadora (no ejecuta PHP).
    return {
      executionPath: "native_ability",
      nativeAbility,
      nativeAbilityUnsuitableReason: "",
      reason: `Existe la ability nativa "${nativeAbility}" para "${operation}" y este sistema no sabe evaluar su aplicabilidad. Fail-closed: no se usa PHP.`,
    };
  }

  if (support.supported) {
    return {
      executionPath: "native_ability",
      nativeAbility,
      nativeAbilityUnsuitableReason: "",
      reason: `${support.reason} PHP no se usa por comodidad.`,
    };
  }

  return {
    executionPath: "execute_php_fallback",
    nativeAbility,
    nativeAbilityUnsuitableReason: support.reason,
    reason: `Existe "${nativeAbility}", pero NO soporta este cambio: ${support.reason}`,
  };
}
