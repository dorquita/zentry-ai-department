import { ExecutePhpChangePlan, PostFieldPayload } from "./execute-php-operations";
import { nonNovamiraBlocks, parseBlockInventory } from "./gutenberg-blocks";

/**
 * CAPACIDADES REALES de las abilities nativas de Novamira.
 *
 * Por que existe este modulo: que una ability EXISTA no significa que
 * sirva para el cambio que se quiere hacer. `gutenberg-write-content`
 * existe para `post_content`, pero solo acepta un subconjunto muy
 * concreto de contenido. Tratar "existe" como "es aplicable" enruta a la
 * nativa cambios que esa nativa RECHAZA, y deja el sistema sin camino.
 *
 * Todo lo que hay aqui esta LEIDO del servidor real con
 * `mcp-adapter-get-ability-info` (modo `ability-info` de
 * scripts/o47-execute-php-e2e.ts), no supuesto. Las citas son textuales.
 *
 * ---------------------------------------------------------------------
 * `novamira/gutenberg-write-content` -- descripcion textual del servidor:
 *
 *   "Directly writes Gutenberg post_content ONLY when every supplied
 *    block is a registered Novamira-owned dynamic-only block.
 *    Native/static Gutenberg blocks require browser JS finalization;
 *    queue them with gutenberg-add-pending-change, then call
 *    gutenberg-enable-batch-finalization and send the finalization link
 *    to the user."
 *
 *   `block_spec`: "Only registered novamira/* dynamic-only blocks are
 *    accepted here."
 *
 *   instructions: "Use this only for Novamira-owned dynamic-only
 *    Gutenberg blocks where save:null means no static saved HTML is
 *    needed. For static/native blocks, THIS ABILITY REFUSES THE WRITE."
 *
 * Consecuencia directa: un `core/heading`, un `core/paragraph`, un
 * `core/list` o un `core/buttons` NO son escribibles por esa ability.
 *
 * ---------------------------------------------------------------------
 * ¿Y la cola de bloques nativos?
 *
 * `gutenberg-add-pending-change` + `gutenberg-enable-batch-finalization`
 * SI aceptan bloques nativos, pero el propio servidor dice que:
 *
 *   "Queued changes are NOT LIVE until gutenberg-enable-batch-finalization
 *    marks the batch ready and an OPEN Block Editor Queue PAGE completes
 *    it."
 *
 *   "if online is false, ask the USER to open dashboard_url and KEEP THE
 *    Block Editor Queue PAGE OPEN while you work."
 *
 * Es decir: exige un navegador humano abierto y no escribe nada por si
 * sola. No es un camino automatizable para una pasada del departamento,
 * asi que NO cuenta como alternativa nativa aplicable. Se documenta aqui
 * para que quede dicho por que se descarta, en vez de omitirlo.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

export const GUTENBERG_WRITE_CONTENT = "novamira/gutenberg-write-content";

export interface NativeAbilitySupport {
  /** `true` solo si la ability nativa puede resolver ESTE cambio concreto. */
  supported: boolean;
  /** Motivo VERIFICABLE, derivado del contenido real. Nunca texto libre de quien llama. */
  reason: string;
  /** Tipos de bloque encontrados en el contenido propuesto. */
  blockTypes: string[];
  /** Los que la ability nativa no acepta. Vacio si los acepta todos. */
  unsupportedBlockTypes: string[];
}

/**
 * ¿Puede `gutenberg-write-content` escribir este `post_content`?
 *
 * Regla derivada de la descripcion textual del servidor: SI y solo si
 * TODOS los bloques de primer nivel son `novamira/*`. Cualquier bloque
 * `core/*` (o de otro plugin) hace que la ability rechace la escritura.
 *
 * Casos limite, todos fail-closed hacia el fallback:
 *
 * - Contenido CLASICO (sin delimitadores de bloque): no es un
 *   `block_spec`, no se puede componer sin reinterpretarlo. No soportado.
 * - Contenido VACIO: no hay bloques que enviar. No soportado.
 */
export function assessGutenbergWriteContentSupport(contentHtml: string): NativeAbilitySupport {
  const inventory = parseBlockInventory(contentHtml);

  if (inventory.isEmpty) {
    return {
      supported: false,
      reason: `El contenido propuesto esta vacio: no hay ningun \`block_spec\` que enviar a ${GUTENBERG_WRITE_CONTENT}.`,
      blockTypes: [],
      unsupportedBlockTypes: [],
    };
  }

  if (inventory.isClassicContent) {
    return {
      supported: false,
      reason: `El contenido propuesto no trae delimitadores de bloque de Gutenberg (contenido clasico / HTML plano). ${GUTENBERG_WRITE_CONTENT} exige un \`block_spec\` de bloques registrados, y convertir HTML plano a bloques seria reinterpretar el contenido.`,
      blockTypes: [],
      unsupportedBlockTypes: [],
    };
  }

  const unsupported = nonNovamiraBlocks(inventory.blockTypes);
  if (unsupported.length > 0) {
    return {
      supported: false,
      reason: `${GUTENBERG_WRITE_CONTENT} solo acepta bloques \`novamira/*\` dynamic-only ("Only registered novamira/* dynamic-only blocks are accepted here"), y este contenido incluye ${unsupported.length} tipo(s) que no lo son: ${unsupported.join(", ")}. Para bloques nativos/estaticos esa ability RECHAZA la escritura; la unica alternativa nativa (gutenberg-add-pending-change + enable-batch-finalization) no escribe por si sola: exige que una persona tenga abierta la pagina del Block Editor Queue, asi que no es un camino automatizable.`,
      blockTypes: inventory.blockTypes,
      unsupportedBlockTypes: unsupported,
    };
  }

  return {
    supported: true,
    reason: `Todos los bloques del contenido propuesto son \`novamira/*\` (${inventory.blockTypes.join(", ")}), que es exactamente lo que ${GUTENBERG_WRITE_CONTENT} acepta. Se usa la ability nativa.`,
    blockTypes: inventory.blockTypes,
    unsupportedBlockTypes: [],
  };
}

/**
 * Aplicabilidad de la ability nativa para un ChangePlan cualquiera.
 * Devuelve `null` cuando la operacion no tiene ninguna ability nativa
 * asociada -- ahi no hay nada que evaluar.
 */
export function assessNativeAbilityForPlan(plan: ExecutePhpChangePlan): NativeAbilitySupport | null {
  if (plan.operation !== "update_post_content") return null;
  return assessGutenbergWriteContentSupport((plan.payload as PostFieldPayload).value);
}
