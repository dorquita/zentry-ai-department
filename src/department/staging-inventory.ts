import { computeVersionHash } from "./apply/version";
import { parseBlockInventory } from "../core/gutenberg-blocks";

/**
 * INVENTARIO REAL DE STAGING -- la evidencia con la que se resuelve un
 * `pageId`, y la razon de que dejemos de adivinarlo.
 *
 * El cuello de botella del departamento no era el permiso: era que
 * web-engineer producia PROSA y la capa de apply tenia que interpretarla
 * ("busca `page_id=N` en el texto"). Cualquier recomendacion que no
 * citara literalmente un id acababa en
 * `requires_manual_staging_implementation`, que es exactamente lo que
 * paso con las 7 propuestas del Daily Brief del 2026-08-15.
 *
 * La solucion no es que Claude adivine mejor: es que NO adivine. Este
 * modulo define el inventario REAL (leido de WordPress por REST, solo
 * lectura) y la resolucion determinista URL/slug -> pageId. Claude
 * declara a que PAGINA apunta el cambio; el `pageId`, el BEFORE y el
 * hash de version salen de aqui, de datos leidos.
 *
 * Modulo PURO en su logica de resolucion: la lectura de red vive en
 * `scripts/` y se inyecta. Asi se testea entero sin WordPress.
 */

/** Una pagina real de staging, tal como se leyo. */
export interface StagingPageSnapshot {
  wordpressPageId: number;
  slug: string;
  /** URL publica REAL, tal como la devuelve WordPress. Nunca construida a mano. */
  stagingUrl: string;
  status: string;
  title: string;
  excerpt: string;
  contentHtml: string;
  /** Valor actual de las claves de meta de la allowlist. Ausente = la clave no existe. */
  meta: Record<string, string | undefined>;
  /**
   * Tipo de post real. Opcional por compatibilidad con inventarios ya
   * escritos en disco antes de que este campo existiera -- usa
   * `postTypeOf()` para leerlo, nunca el campo a pelo.
   */
  postType?: string;
  /**
   * Claves de meta de la allowlist que la lectura REALMENTE observo en
   * la respuesta de WordPress (aunque su valor sea cadena vacia).
   *
   * Existe porque "la clave no viene en `meta`" y "la clave existe y
   * vale vacio" son cosas DISTINTAS y la diferencia es peligrosa: el
   * REST del core solo expone en `meta` las claves registradas con
   * `show_in_rest`, y las de Yoast no lo estan por defecto. Sin este
   * campo, un `meta: {}` se leeria como "el SEO title actual es vacio",
   * que es exactamente el BEFORE falso que haria que un rollback
   * borrara un valor que si existia.
   *
   * Ausente = inventario antiguo, sin informacion; ver
   * `metaValueObserved()`.
   */
  metaObservedKeys?: string[];
}

/** Tipo de post de una pagina del inventario. Solo se leen paginas, pero se declara explicitamente. */
export function postTypeOf(page: StagingPageSnapshot): string {
  const declared = String(page.postType ?? "").trim();
  return declared.length > 0 ? declared : "page";
}

/**
 * ¿Se puede AFIRMAR el valor actual de una clave de meta a partir de
 * este snapshot? Fail-closed: si la lectura declaro que claves observo
 * (`metaObservedKeys`) manda esa lista; si no la declaro (inventario
 * antiguo), solo se afirma la clave cuando trae un valor de tipo string.
 */
export function metaValueObserved(page: StagingPageSnapshot, metaKey: string): boolean {
  if (Array.isArray(page.metaObservedKeys)) return page.metaObservedKeys.includes(metaKey);
  return typeof page.meta[metaKey] === "string";
}

export interface StagingInventory {
  contractVersion: string;
  capturedAt: string;
  pages: StagingPageSnapshot[];
  /** Motivo por el que el inventario esta vacio, si lo esta. Vacio = se leyo bien. */
  unavailableReason: string;
}

export const STAGING_INVENTORY_CONTRACT_VERSION = "staging-inventory/v1";

export function emptyStagingInventory(reason: string, capturedAt: string): StagingInventory {
  return { contractVersion: STAGING_INVENTORY_CONTRACT_VERSION, capturedAt, pages: [], unavailableReason: reason };
}

function normalizeUrl(url: string): string {
  return String(url ?? "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
}

function normalizeSlug(slug: string): string {
  return String(slug ?? "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
}

/**
 * Ruta normalizada de una URL: sin esquema, sin host, sin query, sin
 * barras sobrantes. Es lo que permite resolver de forma determinista una
 * recomendacion que cita la URL de PRODUCCION
 * (`https://zentrylockers.com/taquillas-para-hospitales/`) contra la
 * pagina equivalente de STAGING: el entorno cambia, la ruta no.
 */
function normalizePath(url: string): string {
  return normalizeSlug(normalizeUrl(url).replace(/^https?:\/\/[^/]+/, ""));
}

function looksLikeUrl(reference: string): boolean {
  return /^https?:\/\//i.test(reference) || reference.startsWith("/");
}

export interface PageResolution {
  page: StagingPageSnapshot | null;
  /** Siempre no vacio: por que se resolvio, o por que no. */
  reason: string;
}

// --- Resolucion de EXECUTION TARGET --------------------------------------

/**
 * Resultado estructurado de resolver el destino de un cambio. La causa
 * viaja como DATO (`outcome`), no solo dentro de un texto: quien
 * clasifica una propuesta necesita distinguir "no existe" de "hay
 * varias" sin leer prosa.
 */
export type TargetResolutionOutcome = "RESOLVED" | "UNRESOLVED_TARGET" | "AMBIGUOUS_TARGET";

export type TargetResolutionMethod = "explicit_page_id" | "exact_url" | "exact_path" | "exact_slug" | "none";

export interface ExecutionTargetResolution {
  outcome: TargetResolutionOutcome;
  /** No `null` unicamente cuando `outcome` es `RESOLVED`. */
  page: StagingPageSnapshot | null;
  method: TargetResolutionMethod;
  /** Ids que competian por la referencia cuando el resultado es ambiguo. */
  candidateIds: number[];
  /** Siempre no vacio: por que se resolvio, o por que exactamente no. */
  reason: string;
}

function unresolved(reason: string): ExecutionTargetResolution {
  return { outcome: "UNRESOLVED_TARGET", page: null, method: "none", candidateIds: [], reason };
}

function ambiguous(reason: string, candidateIds: number[]): ExecutionTargetResolution {
  return { outcome: "AMBIGUOUS_TARGET", page: null, method: "none", candidateIds: [...candidateIds].sort((a, b) => a - b), reason };
}

function resolved(page: StagingPageSnapshot, method: TargetResolutionMethod, reason: string): ExecutionTargetResolution {
  return { outcome: "RESOLVED", page, method, candidateIds: [page.wordpressPageId], reason };
}

/**
 * ¿La referencia menciona MAS DE UN destino?
 *
 * Es el caso que separa `affectedPages` de `executionTarget`: una
 * recomendacion puede citar 7 paginas como contexto, pero UN cambio
 * escribe en UNA pagina. Una referencia que enumera varias no se
 * "reparte" ni se queda con la primera: es ambigua, y el reparto en
 * varios planes (uno por destino) es trabajo de quien redacta los
 * `changePlans[]`, no de este resolvedor.
 */
export function countDistinctReferences(reference: string): number {
  const raw = String(reference ?? "").trim();
  if (raw.length === 0) return 0;

  const urls = new Set([...raw.matchAll(/https?:\/\/[^\s,;|]+/gi)].map((m) => normalizeUrl(m[0])));
  const ids = new Set([...raw.matchAll(/page_id=(\d{1,9})/gi)].map((m) => m[1]));
  const explicit = urls.size + ids.size;
  if (explicit > 0) return explicit;

  // Sin URLs ni ids: una lista separada por comas / punto y coma /
  // barra vertical / saltos de linea sigue siendo una lista.
  const parts = raw
    .split(/[,;|\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length;
}

/**
 * Resuelve el destino de UN cambio contra el inventario REAL, con
 * prioridad fija y sin adivinar nunca:
 *
 *   1. `page_id` explicito, si existe en el inventario.
 *   2. URL exacta conocida (misma URL, normalizada).
 *   3. Ruta exacta -- solo si la referencia es una URL. Es lo que hace
 *      que una recomendacion escrita sobre la URL de produccion resuelva
 *      contra la pagina equivalente de staging.
 *   4. Slug exacto.
 *
 * Cualquier otro criterio queda fuera a proposito: no hay coincidencias
 * parciales, ni "la que mas se parece", ni prefijos. El coste de un
 * falso positivo es escribir en la pagina equivocada.
 *
 * 0 resultados -> `UNRESOLVED_TARGET`. Mas de 1 -> `AMBIGUOUS_TARGET`.
 * Nunca se elige "el primero".
 */
export function resolveExecutionTarget(reference: string, inventory: StagingInventory): ExecutionTargetResolution {
  const raw = String(reference ?? "").trim();
  if (raw.length === 0) return unresolved("La referencia de pagina esta vacia.");
  if (inventory.pages.length === 0) {
    return unresolved(
      `El inventario de staging esta vacio${inventory.unavailableReason ? `: ${inventory.unavailableReason}` : ""}. Sin inventario real no se resuelve ningun pageId.`
    );
  }

  const references = countDistinctReferences(raw);
  if (references > 1) {
    return ambiguous(
      `La referencia "${raw.slice(0, 160)}" menciona ${references} destinos distintos. Un cambio escribe en UNA pagina: si la recomendacion afecta a varias, hace falta un plan por destino, no un plan ambiguo.`,
      []
    );
  }

  const idMatch = raw.match(/(?:page_id=)?(\d{1,9})/);
  if (idMatch && /^(?:page_id=)?\d{1,9}$/.test(raw)) {
    const id = Number.parseInt(idMatch[1], 10);
    const page = inventory.pages.find((p) => p.wordpressPageId === id);
    return page
      ? resolved(page, "explicit_page_id", `Resuelta por id explicito (${id}).`)
      : unresolved(`El id ${id} no existe en el inventario real de staging.`);
  }

  const byUrl = inventory.pages.filter((p) => normalizeUrl(p.stagingUrl) === normalizeUrl(raw));
  if (byUrl.length === 1) return resolved(byUrl[0], "exact_url", `Resuelta por URL exacta de staging (page ${byUrl[0].wordpressPageId}).`);
  if (byUrl.length > 1) {
    return ambiguous(
      `La URL "${raw}" casa con ${byUrl.length} paginas del inventario. Ambiguo: no se resuelve.`,
      byUrl.map((p) => p.wordpressPageId)
    );
  }

  if (looksLikeUrl(raw)) {
    const path = normalizePath(raw);
    const byPath = inventory.pages.filter((p) => path.length > 0 && normalizePath(p.stagingUrl) === path);
    if (byPath.length === 1) {
      return resolved(
        byPath[0],
        "exact_path",
        `Resuelta por ruta exacta "/${path}/" (page ${byPath[0].wordpressPageId}): la URL citada apunta a otro entorno, pero la ruta es la misma y en staging existe UNA sola pagina con ella.`
      );
    }
    if (byPath.length > 1) {
      return ambiguous(
        `La ruta "/${path}/" casa con ${byPath.length} paginas del inventario. Ambiguo: no se resuelve.`,
        byPath.map((p) => p.wordpressPageId)
      );
    }
  }

  const slug = normalizeSlug(raw.replace(/^https?:\/\/[^/]+/, ""));
  const bySlug = inventory.pages.filter((p) => normalizeSlug(p.slug) === slug && slug.length > 0);
  if (bySlug.length === 1) return resolved(bySlug[0], "exact_slug", `Resuelta por slug exacto "${slug}" (page ${bySlug[0].wordpressPageId}).`);
  if (bySlug.length > 1) {
    return ambiguous(
      `El slug "${slug}" casa con ${bySlug.length} paginas. Ambiguo: no se resuelve.`,
      bySlug.map((p) => p.wordpressPageId)
    );
  }

  return unresolved(
    `"${raw}" no casa con ninguna pagina del inventario real de staging (${inventory.pages.length} paginas leidas). No se adivina el destino de una escritura.`
  );
}

/**
 * Vista SIMPLE (pagina + motivo) de `resolveExecutionTarget()`. Se
 * mantiene porque hay codigo que solo necesita "¿que pagina es?" y el
 * motivo textual; toda la logica -- y la causa estructurada -- vive en
 * `resolveExecutionTarget()`.
 */
export function resolveStagingPage(reference: string, inventory: StagingInventory): PageResolution {
  const resolution = resolveExecutionTarget(reference, inventory);
  return { page: resolution.page, reason: resolution.reason };
}

/** Hash de version de la pagina, con el mismo calculo que usa el executor para detectar STALE. */
export function versionHashOfPage(page: StagingPageSnapshot): string {
  return computeVersionHash({ status: page.status, title: page.title, metaDescription: page.excerpt, contentHtml: page.contentHtml });
}

/**
 * Resumen de UNA pagina para meterlo en el prompt de web-engineer. Se
 * recorta el cuerpo a proposito: el prompt necesita saber QUE bloques
 * hay y como empieza el contenido, no arrastrar 40 KB de HTML por
 * pagina.
 */
export interface StagingPageBrief {
  wordpressPageId: number;
  slug: string;
  stagingUrl: string;
  status: string;
  postType: string;
  title: string;
  excerpt: string;
  /** Tipos de bloque REALES de la pagina. Es lo que decide si una ability nativa sirve. */
  blockTypes: string[];
  /** Encabezados H2 actuales, para poder proponer un cambio concreto sin ver todo el HTML. */
  h2Headings: string[];
  contentLength: number;
  /** Version actual. La propuesta se ancla a este hash. */
  versionHash: string;
}

export function summarizePageForPrompt(page: StagingPageSnapshot): StagingPageBrief {
  const inventory = parseBlockInventory(page.contentHtml);
  const h2Headings = [...page.contentHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
  );
  return {
    wordpressPageId: page.wordpressPageId,
    slug: page.slug,
    stagingUrl: page.stagingUrl,
    status: page.status,
    postType: postTypeOf(page),
    title: page.title,
    excerpt: page.excerpt,
    blockTypes: inventory.blockTypes,
    h2Headings,
    contentLength: page.contentHtml.length,
    versionHash: versionHashOfPage(page),
  };
}

export function summarizeInventoryForPrompt(inventory: StagingInventory): StagingPageBrief[] {
  // Solo paginas PUBLICADAS: el flujo de revision necesita una URL
  // abrible, y el executor rechaza cualquier otra cosa.
  return inventory.pages.filter((page) => page.status === "publish").map(summarizePageForPrompt);
}
