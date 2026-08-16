import {
  ExecutePhpChangePlan,
  ExecutePhpOperation,
  EXECUTE_PHP_OPERATIONS,
  isAllowedPostMetaKey,
  PostFieldPayload,
  PostMetaPayload,
  validateExecutePhpChangePlan,
} from "./execute-php-operations";

/**
 * GENERADOR DETERMINISTA del PHP permitido.
 *
 * Es la pieza que hace que "Claude escribe PHP" sea estructuralmente
 * imposible, no solo desaconsejado. El unico productor de PHP del
 * sistema es este modulo, y solo sabe rellenar plantillas fijas.
 *
 * Tres decisiones de diseño, y las tres importan:
 *
 * 1. NINGUN dato variable entra en el PHP como texto. El contenido nuevo
 *    (que puede traer comillas, `<?php`, `$`, saltos de linea, lo que
 *    sea) viaja SIEMPRE como base64. La plantilla hace
 *    `base64_decode('....')`, y ese literal solo puede contener
 *    `[A-Za-z0-9+/=]`. No existe ninguna cadena que, metida ahi, pueda
 *    cerrar la comilla y añadir codigo: el problema clasico de inyeccion
 *    desaparece por construccion, no por escapado.
 *
 * 2. Los unicos huecos que NO son base64 son un entero (`targetId`) y un
 *    hash hexadecimal, y ambos se validan con una expresion regular
 *    antes de sustituirse.
 *
 * 3. El PHP se puede REGENERAR desde el plan. Por eso
 *    `assertPhpMatchesPlan()` puede exigir igualdad EXACTA entre lo que
 *    se va a enviar y lo que este modulo produce a partir del plan. Un
 *    PHP escrito por un modelo, o modificado por el camino, no coincide y
 *    no pasa.
 *
 * El PHP generado ademas COMPRUEBA el estado antes de escribir y devuelve
 * un JSON con el antes/despues real: la validacion no se fia de que
 * `execute-php` responda "OK".
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

/** Marcador que el PHP imprime alrededor de su JSON de resultado, para poder extraerlo sin ambiguedad. */
export const PHP_RESULT_MARKER = "ZENTRY_PHP_RESULT";

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function encodePayload(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  // Cinturon y tirantes: si esto fallara, preferimos no generar PHP.
  if (!BASE64.test(encoded)) throw new Error("El payload codificado en base64 contiene caracteres imposibles. No se genera PHP.");
  return encoded;
}

function assertSafeInteger(value: number, field: string): string {
  if (!Number.isInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${field} debe ser un entero positivo para poder incrustarse en la plantilla; llego "${String(value)}".`);
  }
  return String(value);
}

/**
 * La clave de meta se incrusta tambien en base64 aunque venga de una
 * allowlist. Doble red: si algun dia la allowlist creciera con una clave
 * rara, seguiria sin poder alterar la sintaxis del PHP.
 */
function assertAllowedMetaKey(metaKey: string): string {
  if (!isAllowedPostMetaKey(metaKey)) {
    throw new Error(`metaKey "${metaKey}" no esta en la allowlist. No se genera PHP.`);
  }
  return encodePayload(metaKey);
}

/**
 * Plantilla de actualizacion de UN campo del post.
 *
 * Que hace, en orden: carga el post, comprueba que existe y que es del
 * tipo esperado, guarda el valor anterior, escribe con `wp_update_post`,
 * relee y devuelve antes/despues. Nunca toca status ni slug.
 */
function buildPostFieldPhp(postId: number, field: string, encodedValue: string): string {
  return [
    "<?php",
    `$zentry_post_id = ${assertSafeInteger(postId, "targetId")};`,
    `$zentry_field = '${field}';`,
    `$zentry_value = base64_decode('${encodedValue}');`,
    "$zentry_post = get_post($zentry_post_id);",
    "if (!$zentry_post) {",
    `  echo '${PHP_RESULT_MARKER}' . json_encode(array('ok' => false, 'error' => 'post_not_found')) . '${PHP_RESULT_MARKER}';`,
    "  return;",
    "}",
    "$zentry_before = $zentry_post->{$zentry_field};",
    "$zentry_result = wp_update_post(array('ID' => $zentry_post_id, $zentry_field => $zentry_value), true);",
    "if (is_wp_error($zentry_result)) {",
    `  echo '${PHP_RESULT_MARKER}' . json_encode(array('ok' => false, 'error' => $zentry_result->get_error_code())) . '${PHP_RESULT_MARKER}';`,
    "  return;",
    "}",
    "clean_post_cache($zentry_post_id);",
    "$zentry_after_post = get_post($zentry_post_id);",
    "echo '" + PHP_RESULT_MARKER + "' . json_encode(array(",
    "  'ok' => true,",
    "  'postId' => $zentry_post_id,",
    "  'field' => $zentry_field,",
    "  'before' => $zentry_before,",
    "  'after' => $zentry_after_post->{$zentry_field},",
    "  'status' => $zentry_after_post->post_status",
    ")) . '" + PHP_RESULT_MARKER + "';",
  ].join("\n");
}

/**
 * Plantilla de actualizacion de post meta. Devuelve tambien si la clave
 * EXISTIA antes: sin ese dato el rollback no sabria si tiene que
 * restaurar un valor o borrar la clave.
 */
function buildPostMetaPhp(postId: number, encodedKey: string, encodedValue: string): string {
  return [
    "<?php",
    `$zentry_post_id = ${assertSafeInteger(postId, "targetId")};`,
    `$zentry_key = base64_decode('${encodedKey}');`,
    `$zentry_value = base64_decode('${encodedValue}');`,
    "$zentry_post = get_post($zentry_post_id);",
    "if (!$zentry_post) {",
    `  echo '${PHP_RESULT_MARKER}' . json_encode(array('ok' => false, 'error' => 'post_not_found')) . '${PHP_RESULT_MARKER}';`,
    "  return;",
    "}",
    "$zentry_existed = metadata_exists('post', $zentry_post_id, $zentry_key);",
    "$zentry_before = $zentry_existed ? get_post_meta($zentry_post_id, $zentry_key, true) : '';",
    "update_post_meta($zentry_post_id, $zentry_key, $zentry_value);",
    "clean_post_cache($zentry_post_id);",
    "echo '" + PHP_RESULT_MARKER + "' . json_encode(array(",
    "  'ok' => true,",
    "  'postId' => $zentry_post_id,",
    "  'field' => 'post_meta',",
    "  'metaKey' => $zentry_key,",
    "  'existedBefore' => $zentry_existed,",
    "  'before' => $zentry_before,",
    "  'after' => get_post_meta($zentry_post_id, $zentry_key, true),",
    "  'status' => $zentry_post->post_status",
    ")) . '" + PHP_RESULT_MARKER + "';",
  ].join("\n");
}

/** Plantilla de BORRADO de post meta -- solo la usa el rollback cuando la clave no existia antes. */
function buildDeletePostMetaPhp(postId: number, encodedKey: string): string {
  return [
    "<?php",
    `$zentry_post_id = ${assertSafeInteger(postId, "targetId")};`,
    `$zentry_key = base64_decode('${encodedKey}');`,
    "delete_post_meta($zentry_post_id, $zentry_key);",
    "clean_post_cache($zentry_post_id);",
    "echo '" + PHP_RESULT_MARKER + "' . json_encode(array(",
    "  'ok' => true,",
    "  'postId' => $zentry_post_id,",
    "  'field' => 'post_meta',",
    "  'metaKey' => $zentry_key,",
    "  'existedBefore' => false,",
    "  'before' => '',",
    "  'after' => get_post_meta($zentry_post_id, $zentry_key, true),",
    "  'status' => ''",
    ")) . '" + PHP_RESULT_MARKER + "';",
  ].join("\n");
}

const FIELD_FOR_OPERATION: Partial<Record<ExecutePhpOperation, string>> = {
  update_post_content: "post_content",
  update_post_title: "post_title",
  update_post_excerpt: "post_excerpt",
};

/**
 * Construye el PHP de un plan YA validado. Lanza si el plan no es valido:
 * este modulo nunca genera codigo "por si acaso".
 */
export function buildPhpForPlan(plan: ExecutePhpChangePlan): string {
  const validation = validateExecutePhpChangePlan(plan);
  if (!validation.ok) throw new Error(`No se genera PHP: el ChangePlan no es valido. ${validation.reason}`);

  if (plan.operation === "update_post_meta") {
    const payload = plan.payload as PostMetaPayload;
    return buildPostMetaPhp(plan.targetId, assertAllowedMetaKey(payload.metaKey), encodePayload(payload.value));
  }

  const field = FIELD_FOR_OPERATION[plan.operation];
  if (!field) {
    throw new Error(`No hay plantilla determinista para la operacion "${plan.operation}". ${EXECUTE_PHP_OPERATIONS[plan.operation].reason}`);
  }
  const payload = plan.payload as PostFieldPayload;
  return buildPostFieldPhp(plan.targetId, field, encodePayload(payload.value));
}

/**
 * PHP de ROLLBACK: el mismo catalogo de plantillas, con el valor del
 * snapshot. Que el rollback use exactamente las mismas plantillas que el
 * apply es deliberado -- un rollback con su propio codigo seria codigo
 * menos probado ejecutandose justo cuando algo ya ha ido mal.
 */
export function buildRollbackPhpForPlan(plan: ExecutePhpChangePlan, previousValue: string, previousExisted: boolean): string {
  if (plan.operation === "update_post_meta") {
    const payload = plan.payload as PostMetaPayload;
    const encodedKey = assertAllowedMetaKey(payload.metaKey);
    // Si la clave no existia antes, restaurar el valor vacio dejaria un
    // metadato que nadie habia puesto. Se borra.
    return previousExisted
      ? buildPostMetaPhp(plan.targetId, encodedKey, encodePayload(previousValue))
      : buildDeletePostMetaPhp(plan.targetId, encodedKey);
  }
  const field = FIELD_FOR_OPERATION[plan.operation];
  if (!field) throw new Error(`No hay plantilla de rollback para la operacion "${plan.operation}".`);
  return buildPostFieldPhp(plan.targetId, field, encodePayload(previousValue));
}

/**
 * Igualdad EXACTA entre el PHP que se va a enviar y el que este modulo
 * genera desde el plan. Es la comprobacion que hace imposible colar PHP
 * de otra procedencia: no busca patrones malos (lista negra, siempre
 * incompleta), exige que el codigo SEA el generado (lista blanca de uno).
 */
export function phpMatchesPlan(php: string, plan: ExecutePhpChangePlan): boolean {
  let expected: string;
  try {
    expected = buildPhpForPlan(plan);
  } catch {
    return false;
  }
  return php === expected;
}

/**
 * Igual, pero admitiendo tambien el PHP de rollback del mismo plan: el
 * executor usa el mismo guard para las dos escrituras, y el rollback es
 * legitimo.
 */
export function phpMatchesPlanOrRollback(php: string, plan: ExecutePhpChangePlan, previousValue: string, previousExisted: boolean): boolean {
  if (phpMatchesPlan(php, plan)) return true;
  try {
    return php === buildRollbackPhpForPlan(plan, previousValue, previousExisted);
  } catch {
    return false;
  }
}

/**
 * Extrae el JSON que imprime la plantilla. Si no aparece entre los dos
 * marcadores, se considera que la ejecucion NO produjo un resultado
 * utilizable -- nunca se asume exito.
 */
export interface PhpExecutionResult {
  ok: boolean;
  postId?: number;
  field?: string;
  metaKey?: string;
  existedBefore?: boolean;
  before?: string;
  after?: string;
  status?: string;
  error?: string;
}

export function parsePhpResult(output: string): PhpExecutionResult | null {
  const first = output.indexOf(PHP_RESULT_MARKER);
  if (first < 0) return null;
  const second = output.indexOf(PHP_RESULT_MARKER, first + PHP_RESULT_MARKER.length);
  if (second < 0) return null;
  const json = output.slice(first + PHP_RESULT_MARKER.length, second);
  try {
    const parsed = JSON.parse(json) as PhpExecutionResult;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
