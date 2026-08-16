import { ALLOWED_POST_META_KEYS } from "../core/execute-php-operations";
import { resolveNovamiraCredentials } from "./novamira-mcp-transport";
import { emptyStagingInventory, StagingInventory, StagingPageSnapshot, STAGING_INVENTORY_CONTRACT_VERSION } from "../department/staging-inventory";

/**
 * LECTURA del inventario real de staging. SOLO LECTURA, siempre.
 *
 * Es lo que permite que la pasada diaria deje de adivinar `pageId`: lee
 * las paginas publicadas de staging por REST del core de WordPress con
 * las credenciales `WP_API_*` (las mismas que ya usa el probe de
 * Novamira) y devuelve un inventario con el BEFORE real de cada pagina.
 *
 * Este modulo NO escribe. No tiene ninguna funcion que escriba, no
 * importa ningun executor y no conoce ningun interruptor de escritura.
 * La pasada diaria sigue siendo PLANIFICACION: staging writes = 0.
 *
 * FAIL-SOFT a proposito: si falta configuracion o la lectura falla,
 * devuelve un inventario VACIO con el motivo, en vez de lanzar. Un
 * inventario vacio hace que todas las propuestas queden MANUAL con su
 * razon -- que es el resultado correcto y seguro -- en vez de tumbar la
 * pasada entera del departamento.
 *
 * SECRETOS: nunca imprime ni propaga el valor de ninguna credencial. Los
 * errores citan el host, jamas la URL completa con credenciales.
 */

interface RestPage {
  id: number;
  status: string;
  slug: string;
  link: string;
  title?: { raw?: string; rendered?: string };
  content?: { raw?: string; rendered?: string };
  excerpt?: { raw?: string; rendered?: string };
  meta?: Record<string, unknown>;
}

/** Deriva la base del REST del core desde `WP_API_URL` sin exponer su valor. */
export function resolveCoreRestBase(rawUrl: string): string {
  const trimmed = String(rawUrl ?? "").trim().replace(/\/+$/, "");
  return `${trimmed.replace(/\/wp-json\/mcp\/.*$/, "")}/wp-json/wp/v2`;
}

function metaOf(page: RestPage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const raw = page.meta ?? {};
  for (const key of ALLOWED_POST_META_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function toSnapshot(page: RestPage): StagingPageSnapshot {
  return {
    wordpressPageId: page.id,
    slug: page.slug,
    stagingUrl: page.link,
    status: page.status,
    title: page.title?.raw ?? page.title?.rendered ?? "",
    excerpt: page.excerpt?.raw ?? page.excerpt?.rendered ?? "",
    contentHtml: page.content?.raw ?? page.content?.rendered ?? "",
    meta: metaOf(page),
  };
}

/**
 * Lee UNA pagina de staging. Es el `getState` que consume el executor:
 * la lectura de validacion va por REST, un camino DISTINTO al de la
 * escritura (MCP), asi que la validacion no puede confirmarse a si
 * misma. Esta SI lanza: durante un apply, no poder leer es un fallo que
 * tiene que detener el cambio, no degradarse en silencio.
 */
export async function readStagingPage(postId: number, fetchImpl: typeof fetch = fetch): Promise<StagingPageSnapshot> {
  const credentials = resolveNovamiraCredentials();
  const restBase = resolveCoreRestBase(credentials.url);
  const host = new URL(restBase).host;
  const authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;

  let response: Response;
  try {
    response = await fetchImpl(`${restBase}/pages/${postId}?context=edit`, { method: "GET", headers: { Authorization: authHeader } });
  } catch (err) {
    throw new Error(`Fallo de red leyendo la pagina ${postId} en ${host}: ${err instanceof Error ? err.message : String(err)}.`);
  }
  if (!response.ok) throw new Error(`El REST del core de ${host} respondio HTTP ${response.status} al leer la pagina ${postId}.`);
  return toSnapshot((await response.json()) as RestPage);
}

export interface ReadStagingInventoryOptions {
  /** Maximo de paginas a leer. Defensivo: un sitio grande no debe reventar el prompt. */
  maxPages?: number;
  now?: () => Date;
  /** Inyectable para tests. Por defecto, `fetch`. */
  fetchImpl?: typeof fetch;
  /** Inyectable para tests: espera entre reintentos de RED. Por defecto, un `setTimeout` real. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Esperas entre reintentos de la lectura del inventario, en ms.
 *
 * Tres intentos con backoff en vez de dos seguidos, y la razon es
 * concreta: en la pasada `dept-2026-08-16T161309Z` el inventario fallo
 * con `fetch failed` tras dos intentos inmediatos, y eso dejo la pasada
 * ENTERA sin ninguna pagina resoluble -- incluida una recomendacion de
 * title/meta sobre una pagina real que habria sido ejecutable. Un corte
 * de red de dos segundos no deberia costar una pasada de departamento.
 *
 * Sigue siendo solo para fallos de RED: un HTTP de error es una
 * respuesta del servidor y no se reintenta nunca.
 */
export const INVENTORY_RETRY_DELAYS_MS = [1000, 3000];

/**
 * Lee las paginas PUBLICADAS de staging. Nunca lanza: devuelve el motivo
 * dentro del inventario.
 */
export async function readStagingInventory(options: ReadStagingInventoryOptions = {}): Promise<StagingInventory> {
  const clock = options.now ?? (() => new Date());
  const capturedAt = clock().toISOString();
  const doFetch = options.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? 100;

  let credentials: { url: string; username: string; password: string };
  try {
    credentials = resolveNovamiraCredentials();
  } catch (err) {
    return emptyStagingInventory(err instanceof Error ? err.message : String(err), capturedAt);
  }

  const restBase = resolveCoreRestBase(credentials.url);
  let host = "(host no parseable)";
  try {
    host = new URL(restBase).host;
  } catch {
    return emptyStagingInventory("WP_API_URL no es una URL valida. No se intenta ninguna lectura.", capturedAt);
  }

  const authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
  const url = `${restBase}/pages?per_page=${Math.min(maxPages, 100)}&status=publish&context=edit&orderby=modified&order=desc`;

  // Reintentos con espera para fallos de RED (la lectura es idempotente);
  // nunca para un HTTP de error, que es una respuesta del servidor y no
  // un corte.
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const totalAttempts = INVENTORY_RETRY_DELAYS_MS.length + 1;
  let lastNetworkError = "";
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    let response: Response;
    try {
      response = await doFetch(url, { method: "GET", headers: { Authorization: authHeader } });
    } catch (err) {
      lastNetworkError = err instanceof Error ? err.message : String(err);
      if (attempt < totalAttempts) {
        await sleep(INVENTORY_RETRY_DELAYS_MS[attempt - 1]);
        continue;
      }
      return emptyStagingInventory(
        `Fallo de red leyendo el inventario de staging en ${host} (${lastNetworkError}) tras ${totalAttempts} intentos con espera.`,
        capturedAt
      );
    }
    if (!response.ok) {
      return emptyStagingInventory(`El REST del core de ${host} respondio HTTP ${response.status} al leer el inventario de staging.`, capturedAt);
    }
    let pages: RestPage[];
    try {
      pages = (await response.json()) as RestPage[];
    } catch (err) {
      return emptyStagingInventory(`La respuesta del inventario de staging no es JSON utilizable (${err instanceof Error ? err.message : String(err)}).`, capturedAt);
    }
    if (!Array.isArray(pages)) {
      return emptyStagingInventory("La respuesta del inventario de staging no es una lista de paginas.", capturedAt);
    }
    return {
      contractVersion: STAGING_INVENTORY_CONTRACT_VERSION,
      capturedAt,
      pages: pages.map(toSnapshot),
      unavailableReason: "",
    };
  }
  return emptyStagingInventory(`Fallo de red leyendo el inventario de staging en ${host} (${lastNetworkError}) tras ${totalAttempts} intentos con espera.`, capturedAt);
}
