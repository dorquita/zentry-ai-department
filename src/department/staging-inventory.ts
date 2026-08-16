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

export interface PageResolution {
  page: StagingPageSnapshot | null;
  /** Siempre no vacio: por que se resolvio, o por que no. */
  reason: string;
}

/**
 * Resuelve una referencia de pagina contra el inventario REAL.
 *
 * Acepta, en este orden y sin ambiguedad:
 *
 *   1. `page_id=<N>` o el id a secas, si existe en el inventario.
 *   2. La URL exacta de staging (normalizada: sin query, sin barra final).
 *   3. El slug exacto.
 *
 * Deliberadamente NO acepta coincidencias parciales ni "la que mas se
 * parece": el coste de un falso positivo es escribir en la pagina
 * equivocada. Si la referencia no casa con EXACTAMENTE una pagina, no se
 * resuelve y se dice por que.
 */
export function resolveStagingPage(reference: string, inventory: StagingInventory): PageResolution {
  const raw = String(reference ?? "").trim();
  if (raw.length === 0) return { page: null, reason: "La referencia de pagina esta vacia." };
  if (inventory.pages.length === 0) {
    return {
      page: null,
      reason: `El inventario de staging esta vacio${inventory.unavailableReason ? `: ${inventory.unavailableReason}` : ""}. Sin inventario real no se resuelve ningun pageId.`,
    };
  }

  const idMatch = raw.match(/(?:page_id=)?(\d{1,9})/);
  if (idMatch && /^(?:page_id=)?\d{1,9}$/.test(raw)) {
    const id = Number.parseInt(idMatch[1], 10);
    const page = inventory.pages.find((p) => p.wordpressPageId === id);
    return page
      ? { page, reason: `Resuelta por id explicito (${id}).` }
      : { page: null, reason: `El id ${id} no existe en el inventario real de staging.` };
  }

  const byUrl = inventory.pages.filter((p) => normalizeUrl(p.stagingUrl) === normalizeUrl(raw));
  if (byUrl.length === 1) return { page: byUrl[0], reason: `Resuelta por URL exacta de staging (page ${byUrl[0].wordpressPageId}).` };
  if (byUrl.length > 1) return { page: null, reason: `La URL "${raw}" casa con ${byUrl.length} paginas del inventario. Ambiguo: no se resuelve.` };

  const slug = normalizeSlug(raw.replace(/^https?:\/\/[^/]+/, ""));
  const bySlug = inventory.pages.filter((p) => normalizeSlug(p.slug) === slug && slug.length > 0);
  if (bySlug.length === 1) return { page: bySlug[0], reason: `Resuelta por slug exacto "${slug}" (page ${bySlug[0].wordpressPageId}).` };
  if (bySlug.length > 1) return { page: null, reason: `El slug "${slug}" casa con ${bySlug.length} paginas. Ambiguo: no se resuelve.` };

  return {
    page: null,
    reason: `"${raw}" no casa con ninguna pagina del inventario real de staging (${inventory.pages.length} paginas leidas). No se adivina el destino de una escritura.`,
  };
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
