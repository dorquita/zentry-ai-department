import { phpMatchesPlan, phpMatchesRollback } from "./execute-php-builder";
import {
  CapabilitySelection,
  EXECUTE_PHP_OPERATIONS,
  ExecutePhpChangePlan,
  selectExecutionPath,
  validateExecutePhpChangePlan,
} from "./execute-php-operations";
import { READ_ONLY_EMPLOYEES } from "./novamira-profiles";

/**
 * GUARD DE `novamira/execute-php` -- la capa de seguridad especifica del
 * fallback de PHP.
 *
 * Lo que este modulo NO hace, y es lo primero que hay que entender:
 *
 *     NO reclasifica `novamira/execute-php`.
 *
 * En config/novamira-allowlist.json esa ability sigue siendo
 * `dangerous_forbidden`, y por tanto `isNovamiraAbilityAllowed()` y
 * `isAbilityAllowedForProfile()` la siguen rechazando SIEMPRE, para
 * cualquier perfil y cualquier empleado. Una llamada directa de un
 * especialista sigue fallando exactamente igual que antes de existir
 * este fichero.
 *
 * Lo que SI hace: abrir UNA puerta lateral, estrecha y tipada, que exige
 * mucho mas que la clasificacion general. Para pasar por ella hace falta
 * construir un `ExecutePhpRequest` completo, y un especialista no puede
 * construirlo: no tiene ChangePlan, no es el actor autorizado y no puede
 * fabricar el PHP (que se re-deriva aqui de forma determinista).
 *
 * Orden de comprobacion, todo fail-closed y sin cortocircuitos que
 * "confien" en un paso anterior:
 *
 *   1. Actor: solo la capa de APPLY (web engineer). Ningun empleado Claude.
 *   2. Entorno: staging. Produccion bloqueada de forma incondicional.
 *   3. Interruptores propios, ademas de los de Novamira.
 *   4. QA: veredicto permitido.
 *   5. Trazabilidad: departmentRunId + recommendationId + changeId.
 *   6. Plan valido, operacion habilitada, objetivo explicito.
 *   7. Camino de capacidad: se RECALCULA desde el plan. Si la ability
 *      nativa soporta realmente el cambio, no se ejecuta PHP; y la
 *      incompatibilidad no se acepta declarada, se deriva.
 *   8. El PHP es EXACTAMENTE el que generan las plantillas deterministas.
 *   9. Escaneo de operaciones prohibidas sobre el PHP final.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj. Los flags llegan resueltos.
 */

/**
 * Actores. Es un tipo cerrado a proposito: no se puede pasar una cadena
 * arbitraria como actor.
 */
export type ExecutePhpActor = "web_engineer_apply";

export const EXECUTE_PHP_ACTOR: ExecutePhpActor = "web_engineer_apply";

/** Veredictos de QA con los que se puede llegar a escribir. `BLOCKED` nunca. */
export const QA_STATUSES_ALLOWING_EXECUTION = ["PASS", "PASS_WITH_WARNINGS"] as const;

export interface ExecutePhpFlags {
  /** `NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED=true` -- interruptor propio de ESTE fallback, aparte de todos los demas. */
  executePhpFallbackEnabled: boolean;
  /** `NOVAMIRA_STAGING_WRITES_ENABLED=true` -- interruptor general de escritura por Novamira. */
  novamiraStagingWritesEnabled: boolean;
  /** `WORDPRESS_ENV` ya resuelto. */
  wordpressEnv: string;
}

export interface ExecutePhpRequest {
  actor: string;
  /** Nombre de la ability REAL que se va a invocar. Se inspecciona aqui, nunca el nombre generico del tool MCP. */
  abilityName: string;
  environment: string;
  qaStatus: string;
  departmentRunId: string;
  recommendationId: string;
  changeId: string;
  plan: ExecutePhpChangePlan;
  /** El PHP exacto que se enviaria. Se re-deriva del plan y se exige igualdad. */
  php: string;
  /**
   * Que escritura es esta. Se exige explicito porque cada fase admite UNA
   * sola plantilla: el apply solo puede escribir `plan.payload.value`, y
   * el rollback solo puede escribir el valor del snapshot. Sin este
   * campo, aceptar "cualquiera de las dos" dejaba un hueco: bastaba
   * declarar como snapshot el mismo contenido que se queria escribir para
   * que el guard aprobase un PHP que no correspondia al plan.
   */
  phase: "apply" | "rollback";
  capabilitySelection: CapabilitySelection;
  flags: ExecutePhpFlags;
  /** Valor previo REAL leido en el snapshot. Obligatorio en la fase de rollback. */
  snapshotPreviousValue?: string;
  snapshotPreviousExisted?: boolean;
}

export interface ExecutePhpGuardResult {
  allowed: boolean;
  /** Siempre no vacio. Explica exactamente que falta o por que se bloquea. */
  reason: string;
  /** Comprobacion que fallo, en forma de identificador estable para tests y audit. */
  failedCheck: string | null;
}

/**
 * Operaciones PROHIBIDAS incluso dentro del fallback. Lista negra que se
 * suma a la lista blanca de plantillas: si algun dia una plantilla se
 * modificara mal, esto lo caza igualmente.
 *
 * Cada patron lleva la categoria que Pau enumero, para que el motivo del
 * bloqueo sea legible sin leer el regex.
 */
interface ForbiddenPattern {
  category: string;
  pattern: RegExp;
}

const FORBIDDEN_PHP_PATTERNS: ForbiddenPattern[] = [
  // Usuarios, roles, capabilities, admins
  { category: "usuarios/admin", pattern: /\b(wp_(insert|create|update|delete)_user|wp_set_current_user|add_role|remove_role|add_cap|remove_cap|map_meta_cap|grant_super_admin|WP_User\b)/i },
  { category: "usuarios/admin", pattern: /\b(user_pass|user_login|wp_set_password|wp_hash_password|wp_generate_password)\b/i },
  // Secretos y configuracion sensible
  { category: "secrets/config", pattern: /\b(wp-config|AUTH_KEY|SECURE_AUTH_KEY|LOGGED_IN_KEY|NONCE_KEY|DB_PASSWORD|DB_USER|DB_HOST|DB_NAME)\b/i },
  { category: "secrets/config", pattern: /(\$_ENV|\$_SERVER|getenv\s*\(|putenv\s*\()/i },
  { category: "secrets/config", pattern: /\.env\b/i },
  { category: "secrets/config", pattern: /\b(update_option|add_option|delete_option|update_site_option|switch_to_blog)\s*\(/i },
  // Filesystem
  { category: "filesystem", pattern: /\b(file_put_contents|file_get_contents|fopen|fwrite|fputs|unlink|rename|copy|mkdir|rmdir|scandir|glob|opendir|readfile|WP_Filesystem)\s*\(/i },
  // Shell / comandos de sistema
  { category: "shell/system", pattern: /\b(exec|shell_exec|system|passthru|proc_open|popen|pcntl_exec|escapeshellcmd|escapeshellarg)\s*\(/i },
  { category: "shell/system", pattern: /`[^`]*`/ },
  // WP-CLI
  { category: "wp-cli", pattern: /\bWP_CLI\b/i },
  // Plugins / themes / core
  { category: "plugins/themes/core", pattern: /\b(activate_plugin|deactivate_plugins|delete_plugins|install_plugin|switch_theme|update_core|Plugin_Upgrader|Theme_Upgrader|Core_Upgrader)\b/i },
  // Networking arbitrario
  { category: "networking", pattern: /\b(wp_remote_(get|post|request|head)|curl_init|curl_exec|fsockopen|stream_socket_client|file\s*\(\s*['"]https?:)/i },
  // Ejecucion de codigo dinamico
  { category: "codigo dinamico", pattern: /\b(eval|assert|create_function|call_user_func(_array)?|preg_replace_callback|include|include_once|require|require_once)\s*\(/i },
  { category: "codigo dinamico", pattern: /\$\$|\$\{\s*\$/ },
  // SQL directo: existe API de WordPress para todo lo habilitado
  { category: "sql directo", pattern: /\b(\$wpdb|mysqli_|PDO\b)/i },
  // Produccion
  { category: "produccion", pattern: /\bproduction\b/i },
];

/**
 * Escanea el PHP en busca de operaciones prohibidas. Se aplica SIEMPRE,
 * tambien al PHP que generan nuestras propias plantillas: si una
 * plantilla se rompiera en el futuro, esto lo detiene.
 */
export function scanPhpForForbiddenOperations(php: string): { clean: boolean; category: string; detail: string } {
  for (const { category, pattern } of FORBIDDEN_PHP_PATTERNS) {
    const match = php.match(pattern);
    if (match) {
      return {
        clean: false,
        category,
        detail: `El PHP contiene una construccion prohibida de la categoria "${category}" (coincidencia: "${match[0].slice(0, 40)}").`,
      };
    }
  }
  return { clean: true, category: "", detail: "" };
}

function fail(failedCheck: string, reason: string): ExecutePhpGuardResult {
  return { allowed: false, reason, failedCheck };
}

/**
 * La decision completa, sin lanzar. `assertExecutePhpAllowed()` es la
 * version que lanza, pensada para incrustarse justo antes de la llamada
 * real.
 */
export function isExecutePhpAllowed(request: ExecutePhpRequest): ExecutePhpGuardResult {
  // 1. ACTOR. Solo la capa de apply. Ningun empleado Claude, y el nombre
  //    se compara contra el censo real de empleados de solo lectura para
  //    que añadir un empleado nuevo no pueda concederle PHP por olvido.
  if (request.actor !== EXECUTE_PHP_ACTOR) {
    const isEmployee = (READ_ONLY_EMPLOYEES as readonly string[]).includes(request.actor);
    return fail(
      "actor",
      isEmployee
        ? `El empleado "${request.actor}" es READ / ANALYZE / PROPOSE y NUNCA puede ejecutar PHP. Solo la capa de apply ("${EXECUTE_PHP_ACTOR}") esta autorizada, y solo sobre un ChangePlan ya revisado.`
        : `Actor "${request.actor}" no autorizado. El unico actor que puede solicitar execute-php es "${EXECUTE_PHP_ACTOR}".`
    );
  }

  // 2. ABILITY. Se inspecciona el nombre REAL. Nunca se confia en el
  //    nombre generico del tool MCP (`mcp-adapter-execute-ability`).
  if (request.abilityName !== "novamira/execute-php") {
    return fail(
      "ability_name",
      `Este guard es exclusivamente para "novamira/execute-php" y llego "${request.abilityName}". Cualquier otra ability tiene que pasar por el guard general (isAbilityAllowedForProfile), no por aqui.`
    );
  }

  // 3. ENTORNO. Produccion bloqueada de forma incondicional, y ademas
  //    cualquier entorno que no sea exactamente staging.
  if (request.environment === "production" || request.flags.wordpressEnv === "production") {
    return fail(
      "production",
      "BLOQUEADO: produccion. `execute-php` NO queda habilitado en produccion en esta fase, bajo ninguna combinacion de flags ni aprobaciones. Produccion sigue usando su carril REST con aprobacion humana explicita."
    );
  }
  if (request.environment !== "staging") {
    return fail("environment", `El fallback de PHP solo actua en STAGING y el entorno declarado es "${request.environment}".`);
  }
  if (request.flags.wordpressEnv !== "staging") {
    return fail("wordpress_env", `WORDPRESS_ENV="${request.flags.wordpressEnv}" no es "staging". Fail-closed.`);
  }

  // 4. INTERRUPTORES. Dos, independientes: el general de Novamira y el
  //    especifico de este fallback. Apagar cualquiera lo desactiva.
  if (!request.flags.executePhpFallbackEnabled) {
    return fail("flag_execute_php", "NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED no es true: el fallback de PHP esta desactivado en este entorno.");
  }
  if (!request.flags.novamiraStagingWritesEnabled) {
    return fail("flag_novamira_writes", "NOVAMIRA_STAGING_WRITES_ENABLED no es true: Novamira no puede escribir en staging en este entorno.");
  }

  // 5. QA.
  if (!(QA_STATUSES_ALLOWING_EXECUTION as readonly string[]).includes(request.qaStatus)) {
    return fail("qa", `El veredicto de QA es "${request.qaStatus}". Solo se ejecuta con ${QA_STATUSES_ALLOWING_EXECUTION.join(" o ")}.`);
  }

  // 6. TRAZABILIDAD. Sin ids no hay audit trail, y sin audit trail no se
  //    escribe.
  for (const [field, value] of [
    ["departmentRunId", request.departmentRunId],
    ["recommendationId", request.recommendationId],
    ["changeId", request.changeId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return fail("traceability", `Falta ${field}. Sin trazabilidad completa no se ejecuta PHP: el audit trail es parte del permiso, no un extra.`);
    }
  }

  // 7. PLAN.
  const planValidation = validateExecutePhpChangePlan(request.plan);
  if (!planValidation.ok) {
    return fail("plan", `ChangePlan invalido: ${planValidation.reason}`);
  }
  const spec = EXECUTE_PHP_OPERATIONS[request.plan.operation];
  if (!spec.enabled || spec.rollback === "none") {
    return fail("operation_not_enabled", `La operacion "${request.plan.operation}" no tiene rollback seguro en esta fase. ${spec.reason}`);
  }

  // 8. CAMINO DE CAPACIDAD. PHP nunca por comodidad -- y tampoco se
  //    enruta a una nativa que iba a rechazar la escritura.
  //
  //    La seleccion se RECALCULA aqui desde el plan. No se comprueba que
  //    "coincida con el catalogo": se comprueba que sea EXACTAMENTE la
  //    que este sistema habria derivado. Un caller que declare
  //    `nativeAbility: null`, o que invente un motivo de incompatibilidad
  //    para colar PHP sobre contenido que la nativa SI soporta, no pasa
  //    de aqui.
  const expected = selectExecutionPath({ plan: request.plan });
  const declared = request.capabilitySelection;
  if (
    declared.executionPath !== expected.executionPath ||
    declared.nativeAbility !== expected.nativeAbility ||
    declared.nativeAbilityUnsuitableReason.trim() !== expected.nativeAbilityUnsuitableReason.trim()
  ) {
    return fail(
      "capability_selection_mismatch",
      `La seleccion de capacidad declarada no coincide con la que se deriva del propio ChangePlan. Declarada: {path:"${declared.executionPath}", nativa:"${String(declared.nativeAbility)}"}. Derivada: {path:"${expected.executionPath}", nativa:"${String(expected.nativeAbility)}"}. ${expected.reason}`
    );
  }
  if (expected.executionPath !== "execute_php_fallback") {
    return fail(
      "native_ability_preferred",
      `La ability nativa "${String(expected.nativeAbility)}" SI resuelve este cambio, asi que no se ejecuta PHP. ${expected.reason}`
    );
  }

  // 9. EL PHP ES EL NUESTRO, Y ES EL DE ESTA FASE. Igualdad exacta contra
  //    UNA sola plantilla -- la del apply escribe lo que dice el plan, la
  //    del rollback escribe lo que dice el snapshot. Un PHP escrito por un
  //    modelo no puede coincidir con ninguna de las dos.
  let matches: boolean;
  if (request.phase === "apply") {
    matches = phpMatchesPlan(request.php, request.plan);
  } else {
    if (typeof request.snapshotPreviousValue !== "string") {
      return fail("rollback_without_snapshot", "Una fase de rollback sin `snapshotPreviousValue` no se puede verificar: no se ejecuta.");
    }
    matches = phpMatchesRollback(request.php, request.plan, request.snapshotPreviousValue, request.snapshotPreviousExisted ?? false);
  }
  if (!matches) {
    return fail(
      "php_not_deterministic",
      `El PHP recibido NO coincide con la plantilla determinista de la fase "${request.phase}" para este plan. Solo se ejecuta codigo producido por src/core/execute-php-builder.ts -- nunca PHP de otra procedencia, y nunca el de la otra fase.`
    );
  }

  // 10. LISTA NEGRA, ademas de la lista blanca.
  const scan = scanPhpForForbiddenOperations(request.php);
  if (!scan.clean) {
    return fail("forbidden_operation", `${scan.detail} Bloqueado incluso dentro del fallback.`);
  }

  return {
    allowed: true,
    failedCheck: null,
    reason: `Permitido: actor ${EXECUTE_PHP_ACTOR}, STAGING, QA "${request.qaStatus}", operacion "${request.plan.operation}" sobre el post ${request.plan.targetId}, PHP generado de forma determinista y sin operaciones prohibidas.`,
  };
}

/** Version que lanza. Se llama justo antes de invocar la ability, nunca antes. */
export function assertExecutePhpAllowed(request: ExecutePhpRequest): void {
  const decision = isExecutePhpAllowed(request);
  if (!decision.allowed) {
    throw new Error(`execute-php guard: llamada BLOQUEADA (${decision.failedCheck}). ${decision.reason}`);
  }
}

/**
 * Guard del TOOL MCP. El servidor de Novamira no expone una tool por
 * ability: expone `mcp-adapter-execute-ability`, y la ability real viaja
 * en el parametro `ability_name`. Confiar en el nombre del tool seria
 * confiar en un nombre que no dice nada de lo que se va a ejecutar.
 *
 * Esta funcion es la que hay que llamar en el cliente MCP: extrae el
 * `ability_name` de los parametros y devuelve que ability se va a
 * invocar de verdad, o un error si no se puede determinar.
 */
export interface ResolvedAbilityCall {
  ok: boolean;
  abilityName: string;
  reason: string;
}

export const MCP_EXECUTE_ABILITY_TOOL = "mcp-adapter-execute-ability";

export function resolveAbilityNameFromToolCall(toolName: string, parameters: Record<string, unknown>): ResolvedAbilityCall {
  if (toolName !== MCP_EXECUTE_ABILITY_TOOL) {
    // Tools que no ejecutan abilities (discover/get-info) se identifican
    // por su propio nombre; no hay ability interna que inspeccionar.
    return { ok: true, abilityName: toolName, reason: `El tool "${toolName}" no ejecuta ninguna ability: se clasifica por su propio nombre.` };
  }
  const abilityName = parameters.ability_name;
  if (typeof abilityName !== "string" || abilityName.trim().length === 0) {
    return {
      ok: false,
      abilityName: "",
      reason: `Llamada a "${MCP_EXECUTE_ABILITY_TOOL}" sin "ability_name" utilizable. Fail-closed: no se puede clasificar el riesgo de una ability que no se sabe cual es.`,
    };
  }
  return { ok: true, abilityName: abilityName.trim(), reason: `Ability real extraida del parametro ability_name: "${abilityName.trim()}".` };
}
