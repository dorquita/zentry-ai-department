import { logger } from "../core/logger";
import { CreateWordpressDraftInput, CreateWordpressDraftResult } from "./wordpress";
import { assertWordpressWriteAllowed } from "./wordpress-backend";
import { assertNovamiraAbilityAllowed } from "../core/novamira-guard";

/**
 * WordPress MCP Adapter — SKELETON, Fase O10.5. NO IMPLEMENTADO A
 * PROPOSITO. Ver docs/wordpress-mcp-adapter.md para el diagnostico
 * completo; resumen aqui:
 *
 * El unico servidor MCP conectado hoy a este proyecto (Novamira, activo
 * en el WordPress real de zentrylockers.com — NO instalado en el VPS de
 * `zentry-ai-department`, que no tiene ningun proceso/servicio MCP)
 * declara explicitamente en sus instrucciones: "Novamira gives you
 * unrestricted control over this WordPress installation". No existe
 * ninguna ability estrecha equivalente a "crear una pagina en borrador,
 * nada mas". Las unicas vias para crear contenido a traves de Novamira
 * son:
 *
 *   - `novamira/execute-php`  — ejecuta PHP arbitrario en el servidor,
 *     `destructive: true`. Con esto se podria crear un borrador, pero
 *     tambien se podria hacer literalmente cualquier otra cosa (leer la
 *     base de datos completa, modificar WooCommerce, borrar contenido).
 *   - `novamira/run-wp-cli`   — ejecuta cualquier comando `wp` arbitrario,
 *     tambien `destructive: true`, sin lista blanca de subcomandos.
 *   - `novamira/gutenberg-write-content` / el flujo de "pending batches"
 *     — pensado para EDITAR el contenido de un target que YA EXISTE, no
 *     para crear paginas nuevas, y solo acepta bloques
 *     "Novamira-owned dynamic-only".
 *
 * Usar cualquiera de las dos primeras para "solo crear un borrador"
 * rompe la garantia central del WordPress Draft Agent (Fase O10): una
 * superficie de escritura minima, enumerable y auditable
 * (`src/adapters/wordpress.ts` solo sabe hacer UNA cosa). Por eso este
 * adaptador se deja como skeleton — mismo contrato de tipos que
 * `wordpress.ts` (`CreateWordpressDraftInput`/`CreateWordpressDraftResult`)
 * para que un futuro WORDPRESS_BACKEND=mcp pueda implementarse sin tocar
 * `wordpress-draft-agent.ts` — pero cualquier llamada real lanza un error
 * explicito hasta que exista una ability estrecha dedicada (por parte de
 * Novamira, o conectando un servidor MCP distinto y mas restringido).
 *
 * No se ha anadido ninguna dependencia nueva (SDK de MCP, cliente HTTP,
 * etc.) ni ninguna variable de entorno real todavia — eso es una decision
 * pendiente, documentada en docs/wordpress-mcp-adapter.md, no tomada en
 * esta fase.
 */

/**
 * Siempre false hoy: no existe ninguna variable de entorno real para
 * este backend (no se ha tocado `.env` en esta fase, ver
 * docs/wordpress-mcp-adapter.md, seccion "Config pendiente de decidir").
 * Existe como funcion (en vez de una constante) para que el dia que haya
 * una implementacion real, `wordpress-draft-agent.ts` no necesite cambiar
 * su forma de comprobarlo.
 */
export function isWordpressMcpConfigured(): boolean {
  return false;
}

/**
 * NUNCA debe llegar a ejecutarse en produccion hoy:
 * `resolveWordpressBackend()` por defecto es `"local_preview"`, y aunque
 * alguien fijara `WORDPRESS_BACKEND=mcp` a mano, esta funcion lanza de
 * inmediato sin intentar nada contra WordPress ni contra ningun servidor
 * MCP.
 */
export async function createWordpressDraftPageViaMcp(
  _input: CreateWordpressDraftInput
): Promise<CreateWordpressDraftResult> {
  // Fase O10.6: mismo guardrail incondicional de entorno que
  // src/adapters/wordpress.ts, aplicado aqui tambien para que el dia que
  // esto se implemente de verdad, la comprobacion ya exista desde el
  // primer commit — nunca depender de que quien implemente la ability
  // real se acuerde de anadirla.
  assertWordpressWriteAllowed();
  // Fase O14: guard de Novamira anadido aqui TAMBIEN, como defensa en
  // profundidad -- aunque esta funcion ya lanza incondicionalmente mas
  // abajo, el dia que alguien implemente esto de verdad, el guard debe
  // estar en el camino desde el primer commit. "execute-php" se usa
  // como ability representativa: es la unica via que Novamira expone
  // hoy para crear una pagina nueva (gutenberg-write-content solo edita
  // contenido existente, no crea), y esta permanentemente bloqueada.
  assertNovamiraAbilityAllowed("novamira/execute-php");
  logger.error(
    "createWordpressDraftPageViaMcp() invocado, pero WORDPRESS_BACKEND=mcp no esta implementado todavia (Fase O10.5, solo skeleton de arquitectura)."
  );
  throw new Error(
    'WORDPRESS_BACKEND=mcp no esta implementado. El unico servidor MCP disponible (Novamira) no expone ninguna ability suficientemente estrecha para crear un borrador de forma segura y auditable — ver docs/wordpress-mcp-adapter.md y config/novamira-allowlist.json. Usa WORDPRESS_BACKEND=rest (API REST de WordPress, ver src/adapters/wordpress.ts) o deja WORDPRESS_BACKEND=local_preview (valor por defecto, nunca escribe nada real).'
  );
}
