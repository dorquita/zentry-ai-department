/**
 * PARSER de tipos de bloque de Gutenberg.
 *
 * Existe para poder responder de forma DETERMINISTA a una pregunta que
 * decide el camino de ejecucion: "¿de que bloques esta hecho este
 * `post_content`?". La respuesta no puede venir de que alguien lo
 * declare: se deriva del contenido real.
 *
 * Gutenberg delimita cada bloque con un comentario HTML:
 *
 *     <!-- wp:heading {"level":2} --> ... <!-- /wp:heading -->
 *     <!-- wp:novamira/hero {...} /-->
 *
 * Reglas del formato que este modulo respeta:
 *
 * - Un nombre sin `/` esta en el namespace `core`: `wp:heading` es
 *   `core/heading`, `wp:paragraph` es `core/paragraph`. Normalizarlo aqui
 *   evita que dos sitios del sistema llamen distinto al mismo bloque.
 * - Los bloques auto-cerrados (`/-->`) son bloques igual: los dinamicos
 *   suelen serlo, y no contarlos seria justo perder los que importan.
 * - Contenido SIN ningun delimitador no es "cero bloques": es contenido
 *   clasico (HTML plano), y eso se dice explicitamente en vez de
 *   devolver una lista vacia que quien llame pueda confundir con "no hay
 *   nada incompatible".
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

/** Delimitador de apertura o auto-cierre. El de cierre (`<!-- /wp:x -->`) se ignora: ya se conto en la apertura. */
const BLOCK_DELIMITER = /<!--\s*wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)[\s\S]*?-->/gi;

export interface BlockInventory {
  /** Tipos de bloque encontrados, normalizados a `namespace/nombre`, sin repetir y en orden alfabetico. */
  blockTypes: string[];
  /** `true` si el contenido no trae NINGUN delimitador de bloque (contenido clasico / HTML plano). */
  isClassicContent: boolean;
  /** `true` si el contenido esta vacio o solo tiene espacios. */
  isEmpty: boolean;
}

/** Normaliza `heading` -> `core/heading`, deja `novamira/hero` como esta. */
export function normalizeBlockName(rawName: string): string {
  const name = rawName.trim().toLowerCase();
  return name.includes("/") ? name : `core/${name}`;
}

export function parseBlockInventory(contentHtml: string): BlockInventory {
  const html = String(contentHtml ?? "");
  if (html.trim().length === 0) {
    return { blockTypes: [], isClassicContent: false, isEmpty: true };
  }

  const found = new Set<string>();
  // El regex es global: se reinicia el indice para que la funcion sea
  // reentrante (un regex global compartido guarda `lastIndex` entre
  // llamadas y devolveria resultados distintos la segunda vez).
  BLOCK_DELIMITER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_DELIMITER.exec(html)) !== null) {
    const raw = match[1];
    // Los cierres llegan como `/wp:heading`; el regex no los captura
    // porque exige `wp:` justo despues del comentario, pero se comprueba
    // igualmente por si el formato cambiara.
    if (raw.startsWith("/")) continue;
    found.add(normalizeBlockName(raw));
  }

  return {
    blockTypes: [...found].sort(),
    isClassicContent: found.size === 0,
    isEmpty: false,
  };
}

/** Namespace de los bloques dinamicos de Novamira. */
export const NOVAMIRA_BLOCK_NAMESPACE = "novamira/";

export function isNovamiraBlock(blockType: string): boolean {
  return blockType.startsWith(NOVAMIRA_BLOCK_NAMESPACE);
}

/** Bloques que NO son de Novamira (core u otros plugins). */
export function nonNovamiraBlocks(blockTypes: string[]): string[] {
  return blockTypes.filter((type) => !isNovamiraBlock(type));
}
