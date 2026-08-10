import { logger } from "../core/logger";
import {
  resolveActiveClientConfig,
  resolveActiveClientId,
  resolveClientEnvVar,
  resolveClientSecret,
} from "../core/client-config";

/**
 * WordPress PRODUCTION Adapter (Fase O13.2) — el UNICO fichero de todo
 * el proyecto capaz de escribir en WordPress produccion, y solo si TODAS
 * estas condiciones se cumplen a la vez:
 *
 *   1. `PRODUCTION_EXECUTION_ENABLED=true` (interruptor maestro del
 *      Production Draft Executor)
 *   2. `PRODUCTION_DRAFTS_ENABLED=true` (interruptor especifico de
 *      escritura de este adapter -- mismo patron de doble interruptor
 *      que WORDPRESS_DRAFTS_ENABLED en staging)
 *   3. `PRODUCTION_BACKEND=rest`
 *
 * Deliberadamente un fichero SEPARADO de `src/adapters/wordpress.ts`
 * (staging): ninguna de las dos rutas de codigo puede escribir en el
 * entorno del otro por error. `wordpress.ts` bloquea produccion
 * incondicionalmente (`assertWordpressWriteAllowed()`); este fichero
 * bloquea staging por diseno (nunca conoce `WORDPRESS_STAGING_BASE_URL`
 * ni las credenciales de staging).
 *
 * Solo sabe hacer DOS cosas, igual que la version de staging al
 * principio (Fase O10): crear una pagina NUEVA en `status: draft`
 * (nunca publicar, nunca actualizar una pagina existente todavia -- eso
 * es `update_existing_draft`, fuera de alcance de la Fase O13.2), y
 * subir un archivo NUEVO a la Media Library (nunca borra, nunca la
 * asocia a ninguna pagina). No existe ninguna funcion aqui para
 * publicar, borrar, actualizar una pagina existente, tocar
 * WooCommerce/formularios/precios/checkout, ni usar Novamira/
 * execute-php/run-wp-cli — eso no es una omision, es la garantia de
 * seguridad de esta fase.
 */

const WORDPRESS_API_PAGES_PATH = "/wp-json/wp/v2/pages";
const WORDPRESS_API_MEDIA_PATH = "/wp-json/wp/v2/media";

// Misma lista que src/adapters/wordpress.ts (Fase O10.6) -- defensa en
// profundidad duplicada a proposito, para que este fichero nunca dependa
// de que el otro exista o se mantenga igual.
const PROTECTED_SLUG_TERMS = [
  "checkout",
  "cart",
  "carrito",
  "my-account",
  "mi-cuenta",
  "pago",
  "tienda",
  "shop",
  "home",
  "inicio",
];

export function isProductionExecutionEnabled(): boolean {
  return (process.env.PRODUCTION_EXECUTION_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function isProductionDraftsEnabled(): boolean {
  return (process.env.PRODUCTION_DRAFTS_ENABLED ?? "").trim().toLowerCase() === "true";
}

export type ProductionBackend = "local_preview" | "rest";
const VALID_PRODUCTION_BACKENDS: ProductionBackend[] = ["local_preview", "rest"];

export function resolveProductionBackend(): ProductionBackend {
  const raw = (process.env.PRODUCTION_BACKEND ?? "local_preview").trim().toLowerCase();
  if ((VALID_PRODUCTION_BACKENDS as string[]).includes(raw)) {
    return raw as ProductionBackend;
  }
  throw new Error(
    `PRODUCTION_BACKEND desconocido: "${raw}". Valores validos: ${VALID_PRODUCTION_BACKENDS.join(", ")}. Revisa .env.example.`
  );
}

/**
 * Las TRES condiciones a la vez, y solo asi -- ademas de la propia
 * aprobacion de Telegram de ejecucion (fuera de este fichero, ver
 * src/agents/production-draft-executor.ts) y de `plan_approved` +
 * `execution_approved` en el plan/ejecucion de origen.
 */
export function canAttemptProductionWrites(): boolean {
  let backend: ProductionBackend;
  try {
    backend = resolveProductionBackend();
  } catch {
    return false;
  }
  return isProductionExecutionEnabled() && isProductionDraftsEnabled() && backend === "rest";
}

/**
 * Fase O16.2: prefiere `productionUrl` del ClientConfig ACTIVO, cae a
 * `WORDPRESS_PRODUCTION_BASE_URL` de `.env` si el cliente no define uno
 * (nunca pasa hoy para "zentry"). Sigue siendo un resolver SEPARADO del
 * de staging (`resolveWordpressTargetUrl` en wordpress-backend.ts), a
 * proposito -- ninguno de los dos conoce la URL/credenciales del otro.
 */
export function resolveProductionTargetUrl(): string {
  const configuredUrl = resolveActiveClientConfig().productionUrl;
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }
  const raw = process.env.WORDPRESS_PRODUCTION_BASE_URL;
  if (!raw) {
    throw new Error("Falta WORDPRESS_PRODUCTION_BASE_URL en .env. Revisa .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

interface ProductionConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}

/**
 * Nunca loguea ni expone WORDPRESS_PRODUCTION_APP_PASSWORD fuera de esta
 * funcion. Fase O16.2: prefiere `<CLIENTID>_WORDPRESS_PRODUCTION_USERNAME`/
 * `<CLIENTID>_WORDPRESS_PRODUCTION_APP_PASSWORD`, cae a las variables sin
 * prefijo solo para "zentry".
 */
function resolveProductionConfig(): ProductionConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  return { baseUrl, username, appPassword };
}

/**
 * Para informes/CLI/logs: nunca devuelve las credenciales, solo si estan
 * presentes.
 */
export function getProductionStatusForReport(): {
  executionEnabled: boolean;
  draftsEnabled: boolean;
  backend: ProductionBackend | "desconocido";
  canWrite: boolean;
  configured: boolean;
  targetUrl?: string;
} {
  const executionEnabled = isProductionExecutionEnabled();
  const draftsEnabled = isProductionDraftsEnabled();
  let backend: ProductionBackend | "desconocido" = "desconocido";
  try {
    backend = resolveProductionBackend();
  } catch {
    backend = "desconocido";
  }
  let targetUrl: string | undefined;
  try {
    targetUrl = resolveProductionTargetUrl();
  } catch {
    targetUrl = undefined;
  }
  const activeClientId = resolveActiveClientId();
  const configured =
    Boolean(targetUrl) &&
    Boolean(resolveClientEnvVar(activeClientId, "WORDPRESS_PRODUCTION_USERNAME")) &&
    Boolean(resolveClientEnvVar(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD"));
  return { executionEnabled, draftsEnabled, backend, canWrite: canAttemptProductionWrites(), configured, targetUrl };
}

function sanitizeProductionError(raw: string, appPassword: string): string {
  const withoutPassword = appPassword ? raw.split(appPassword).join("[REDACTED]") : raw;
  return withoutPassword.length > 500 ? withoutPassword.slice(0, 500) + "...[truncated]" : withoutPassword;
}

function assertSlugNotProtected(input: { title: string; slug?: string }): void {
  const haystack = `${input.title} ${input.slug ?? ""}`.toLowerCase();
  const hit = PROTECTED_SLUG_TERMS.find((term) => haystack.includes(term));
  if (hit) {
    throw new Error(
      `Titulo/slug propuesto contiene el termino protegido "${hit}" (home/checkout/carrito/cuenta/tienda). Bloqueado por seguridad: no se crea nada en produccion.`
    );
  }
}

export interface CreateProductionDraftInput {
  title: string;
  contentHtml: string;
  excerpt?: string;
  slug?: string;
}

export interface CreateProductionDraftResult {
  wordpressPageId: number;
  wordpressDraftUrl: string;
}

/**
 * Crea una pagina NUEVA en WordPress PRODUCCION con `status: "draft"`.
 * Nunca publica, nunca actualiza una pagina existente, nunca borra, nunca
 * sube media. Lanza si alguna de las 3 condiciones no se cumple --
 * defensa en profundidad, ademas del gate que ya debe haber hecho quien
 * llame (production-draft-executor.ts).
 */
export async function createProductionDraftPage(input: CreateProductionDraftInput): Promise<CreateProductionDraftResult> {
  if (!canAttemptProductionWrites()) {
    throw new Error(
      "createProductionDraftPage() llamado sin las 3 condiciones activas (PRODUCTION_EXECUTION_ENABLED=true, PRODUCTION_DRAFTS_ENABLED=true, PRODUCTION_BACKEND=rest). Bloqueado."
    );
  }
  assertSlugNotProtected(input);

  const config = resolveProductionConfig();
  logger.info("WordPress PRODUCTION adapter: creando borrador real (3 condiciones verificadas)", {
    targetUrl: config.baseUrl,
  });
  const authHeader = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  const body = {
    title: input.title,
    content: input.contentHtml,
    excerpt: input.excerpt ?? "",
    status: "draft" as const,
    ...(input.slug ? { slug: input.slug } : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WORDPRESS_API_PAGES_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red creando el borrador en WordPress produccion: ${sanitizeProductionError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WordPress PRODUCCION REST API respondio ${response.status}: ${sanitizeProductionError(bodyText, config.appPassword)}`
    );
  }

  const json = (await response.json()) as { id?: number; link?: string; status?: string };
  if (typeof json.id !== "number" || json.status !== "draft") {
    throw new Error(
      `Respuesta inesperada de WordPress produccion al crear el borrador (sin id numerico o status != "draft"). No se puede confirmar que quedo como borrador; tratar como fallo.`
    );
  }

  logger.info("Borrador creado en WordPress PRODUCCION (nunca publicado)", { wordpressPageId: json.id, status: json.status });
  return { wordpressPageId: json.id, wordpressDraftUrl: json.link ?? "" };
}

export interface ProductionPageInfo {
  id: number;
  status: string;
  title: string;
  contentHtml: string;
  excerpt: string;
  slug: string;
  link: string;
}

/**
 * Lee una pagina de PRODUCCION (GET, solo lectura -- sin gate de
 * escritura, igual que getWordpressPage() en staging). Usado por QA y
 * por updateProductionDraftPage() para verificar el status ANTES de
 * escribir. Requiere credenciales de produccion configuradas (para
 * poder leer un draft, que nunca es publico).
 */
export async function getProductionPage(pageId: number): Promise<ProductionPageInfo> {
  const config = resolveProductionConfig();
  const authHeader = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WORDPRESS_API_PAGES_PATH}/${pageId}?context=edit`, {
      method: "GET",
      headers: { Authorization: authHeader },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red leyendo la pagina de produccion: ${sanitizeProductionError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WordPress PRODUCCION REST API respondio ${response.status} leyendo la pagina ${pageId}: ${sanitizeProductionError(bodyText, config.appPassword)}`
    );
  }

  const json = (await response.json()) as {
    id?: number;
    status?: string;
    title?: { raw?: string; rendered?: string };
    content?: { raw?: string; rendered?: string };
    excerpt?: { raw?: string; rendered?: string };
    slug?: string;
    link?: string;
  };
  if (typeof json.id !== "number") {
    throw new Error(`Respuesta inesperada de WordPress produccion leyendo la pagina ${pageId} (sin id numerico).`);
  }

  return {
    id: json.id,
    status: json.status ?? "",
    title: json.title?.raw ?? json.title?.rendered ?? "",
    contentHtml: json.content?.raw ?? json.content?.rendered ?? "",
    excerpt: json.excerpt?.raw ?? json.excerpt?.rendered ?? "",
    slug: json.slug ?? "",
    link: json.link ?? "",
  };
}

export interface UpdateProductionDraftInput {
  pageId: number;
  title: string;
  contentHtml: string;
  excerpt?: string;
  slug?: string;
}

/**
 * Actualiza una pagina de PRODUCCION EXISTENTE -- SOLO si su status
 * ACTUAL (verificado con un GET justo antes, en la misma llamada) es
 * "draft". Si esta en cualquier otro estado (publish, trash,
 * private...), rechaza sin tocar nada: nunca actualiza una pagina
 * publicada. El POST fuerza siempre `status: "draft"` (defensa en
 * profundidad). Mismas garantias que `createProductionDraftPage()`: no
 * borra, no publica, no sube media. Mismas 3 condiciones de entorno.
 */
export async function updateProductionDraftPage(input: UpdateProductionDraftInput): Promise<CreateProductionDraftResult> {
  if (!canAttemptProductionWrites()) {
    throw new Error(
      "updateProductionDraftPage() llamado sin las 3 condiciones activas (PRODUCTION_EXECUTION_ENABLED=true, PRODUCTION_DRAFTS_ENABLED=true, PRODUCTION_BACKEND=rest). Bloqueado."
    );
  }
  assertSlugNotProtected(input);

  const current = await getProductionPage(input.pageId);
  if (current.status !== "draft") {
    throw new Error(
      `La pagina de produccion ${input.pageId} tiene status "${current.status}" (no "draft"). Bloqueado: updateProductionDraftPage() SOLO actualiza paginas que ya estan en borrador, nunca una publicada.`
    );
  }

  const config = resolveProductionConfig();
  logger.info("WordPress PRODUCTION adapter: actualizando borrador existente (status draft verificado antes de escribir)", {
    targetUrl: config.baseUrl,
    pageId: input.pageId,
  });
  const authHeader = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  const body = {
    title: input.title,
    content: input.contentHtml,
    excerpt: input.excerpt ?? "",
    status: "draft" as const,
    ...(input.slug ? { slug: input.slug } : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WORDPRESS_API_PAGES_PATH}/${input.pageId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red actualizando el borrador en WordPress produccion: ${sanitizeProductionError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WordPress PRODUCCION REST API respondio ${response.status} actualizando la pagina ${input.pageId}: ${sanitizeProductionError(bodyText, config.appPassword)}`
    );
  }

  const json = (await response.json()) as { id?: number; link?: string; status?: string };
  if (typeof json.id !== "number" || json.status !== "draft") {
    throw new Error(
      `Respuesta inesperada de WordPress produccion al actualizar el borrador (sin id numerico o status != "draft"). No se puede confirmar que sigue como borrador; tratar como fallo.`
    );
  }

  logger.info("Borrador de PRODUCCION actualizado (sigue sin publicar)", { wordpressPageId: json.id, status: json.status });
  return { wordpressPageId: json.id, wordpressDraftUrl: json.link ?? "" };
}

export interface TrashProductionPageResult {
  pageId: number;
  status: string;
}

/**
 * Ajuste O22 -- mueve una pagina de PRODUCCION que esta actualmente
 * "publish" a la papelera (status: "trash", reversible -- WordPress
 * conserva el contenido hasta que un humano la vacie manualmente desde
 * wp-admin, nunca un borrado permanente). Primera funcion de este
 * fichero capaz de retirar una pagina YA PUBLICADA de produccion --
 * usa el mismo POST de cambio de status que publishStagingDraftPage()
 * usa en staging (nunca DELETE), y exige las mismas 3 condiciones de
 * escritura que el resto del adapter. Rollback simetrico:
 * restoreProductionPageFromTrash().
 */
export async function trashProductionPage(pageId: number): Promise<TrashProductionPageResult> {
  if (!canAttemptProductionWrites()) {
    throw new Error(
      "trashProductionPage() llamado sin las 3 condiciones activas (PRODUCTION_EXECUTION_ENABLED=true, PRODUCTION_DRAFTS_ENABLED=true, PRODUCTION_BACKEND=rest). Bloqueado."
    );
  }
  const current = await getProductionPage(pageId);
  if (current.status !== "publish") {
    throw new Error(
      `La pagina de produccion ${pageId} tiene status "${current.status}" (no "publish"). Bloqueado: trashProductionPage() SOLO retira paginas que estan publicadas ahora mismo.`
    );
  }

  const config = resolveProductionConfig();
  logger.info("WordPress PRODUCTION adapter: moviendo pagina a papelera (nunca borrado permanente)", {
    targetUrl: config.baseUrl,
    pageId,
  });
  const authHeader = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  // WordPress REST API rechaza `status:"trash"` como valor valido en un
  // POST de actualizacion (el schema del endpoint lo excluye a
  // proposito) -- mover a papelera SOLO se hace via DELETE con
  // force=false (WordPress lo interpreta como trash, no como borrado
  // permanente), igual que trashProductionProduct() en
  // woocommerce-production.ts.
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WORDPRESS_API_PAGES_PATH}/${pageId}?force=false`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red moviendo a papelera la pagina ${pageId}: ${sanitizeProductionError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WordPress PRODUCCION REST API respondio ${response.status} moviendo a papelera la pagina ${pageId}: ${sanitizeProductionError(bodyText, config.appPassword)}`
    );
  }

  // Con force=false, WordPress devuelve el recurso ya en "trash"
  // directamente (no el envoltorio {deleted,previous} que usa force=true).
  const json = (await response.json()) as { id?: number; status?: string; previous?: { id?: number; status?: string } };
  const resultId = json.id ?? json.previous?.id;
  const resultStatus = json.status ?? json.previous?.status;
  if (typeof resultId !== "number" || resultStatus !== "trash") {
    throw new Error(
      `Respuesta inesperada de WordPress produccion al mover a papelera la pagina ${pageId} (sin id numerico o status != "trash"). Tratar como fallo.`
    );
  }

  logger.info("Pagina de produccion movida a papelera", { pageId: resultId, status: resultStatus });
  return { pageId: resultId, status: resultStatus };
}

/**
 * Rollback simetrico de trashProductionPage(): restaura una pagina de
 * PRODUCCION que esta en "trash" de vuelta al status indicado (por
 * defecto "publish", su estado previo tipico). Solo actua si el status
 * ACTUAL es "trash".
 */
export async function restoreProductionPageFromTrash(pageId: number, restoreStatus: "publish" | "draft" = "publish"): Promise<TrashProductionPageResult> {
  if (!canAttemptProductionWrites()) {
    throw new Error(
      "restoreProductionPageFromTrash() llamado sin las 3 condiciones activas (PRODUCTION_EXECUTION_ENABLED=true, PRODUCTION_DRAFTS_ENABLED=true, PRODUCTION_BACKEND=rest). Bloqueado."
    );
  }
  const current = await getProductionPage(pageId);
  if (current.status !== "trash") {
    throw new Error(
      `La pagina de produccion ${pageId} tiene status "${current.status}" (no "trash"). Bloqueado: restoreProductionPageFromTrash() SOLO restaura paginas que estan en la papelera ahora mismo.`
    );
  }

  const config = resolveProductionConfig();
  logger.info("WordPress PRODUCTION adapter: restaurando pagina desde la papelera", {
    targetUrl: config.baseUrl,
    pageId,
    restoreStatus,
  });
  const authHeader = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  const response = await fetch(`${config.baseUrl}${WORDPRESS_API_PAGES_PATH}/${pageId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ status: restoreStatus }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `WordPress PRODUCCION REST API respondio ${response.status} restaurando la pagina ${pageId}: ${sanitizeProductionError(bodyText, config.appPassword)}`
    );
  }
  const json = (await response.json()) as { id?: number; status?: string };
  if (typeof json.id !== "number") {
    throw new Error(`Respuesta inesperada de WordPress produccion al restaurar la pagina ${pageId} (sin id numerico). Tratar como fallo.`);
  }

  logger.info("Pagina de produccion restaurada desde la papelera", { pageId: json.id, status: json.status });
  return { pageId: json.id, status: json.status ?? "" };
}

export interface UpdateProductionPublishedPageInput {
  pageId: number;
  title: string;
  contentHtml: string;
  excerpt?: string;
}

/**
 * Corrige el CONTENIDO de una pagina de PRODUCCION que YA esta
 * PUBLICADA -- a diferencia de updateProductionDraftPage() (que solo
 * toca borradores y rechaza cualquier pagina publicada), esta funcion
 * es lo opuesto: SOLO acepta paginas cuyo status ACTUAL (verificado con
 * un GET justo antes de escribir) sea "publish", y rechaza cualquier
 * otro estado. El status se fuerza siempre a "publish" en el POST
 * (nunca lo cambia, ni a borrador ni a papelera) y esta funcion NUNCA
 * acepta un slug -- cambiar el slug de una pagina ya publicada rompe
 * enlaces/SEO existentes, asi que ni siquiera es un parametro posible
 * aqui (a diferencia de updateProductionDraftPage). Pensada para
 * correcciones puntuales post-publicacion (Fase O13.7b): nunca publica
 * ni despublica nada, solo actualiza el contenido de algo que un humano
 * ya publico.
 */
export async function updateProductionPublishedPageContent(input: UpdateProductionPublishedPageInput): Promise<CreateProductionDraftResult> {
  if (!canAttemptProductionWrites()) {
    throw new Error(
      "updateProductionPublishedPageContent() llamado sin las 3 condiciones activas (PRODUCTION_EXECUTION_ENABLED=true, PRODUCTION_DRAFTS_ENABLED=true, PRODUCTION_BACKEND=rest). Bloqueado."
    );
  }
  assertSlugNotProtected({ title: input.title });

  const current = await getProductionPage(input.pageId);
  if (current.status !== "publish") {
    throw new Error(
      `La pagina de produccion ${input.pageId} tiene status "${current.status}" (no "publish"). Bloqueado: updateProductionPublishedPageContent() SOLO actualiza paginas ya publicadas y nunca cambia su estado de publicacion.`
    );
  }

  const config = resolveProductionConfig();
  logger.info("WordPress PRODUCTION adapter: actualizando CONTENIDO de pagina ya publicada (status publish verificado antes de escribir, status y slug nunca se tocan)", {
    targetUrl: config.baseUrl,
    pageId: input.pageId,
  });
  const authHeader = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  const body = {
    title: input.title,
    content: input.contentHtml,
    excerpt: input.excerpt ?? current.excerpt,
    status: "publish" as const,
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WORDPRESS_API_PAGES_PATH}/${input.pageId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red actualizando el contenido en WordPress produccion: ${sanitizeProductionError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WordPress PRODUCCION REST API respondio ${response.status} actualizando la pagina publicada ${input.pageId}: ${sanitizeProductionError(bodyText, config.appPassword)}`
    );
  }

  const json = (await response.json()) as { id?: number; link?: string; status?: string };
  if (typeof json.id !== "number" || json.status !== "publish") {
    throw new Error(
      `Respuesta inesperada de WordPress produccion al actualizar la pagina publicada (sin id numerico o status != "publish"). No se puede confirmar que sigue publicada; tratar como fallo.`
    );
  }

  logger.info("Contenido de pagina PRODUCCION actualizado (sigue publicada, status y slug sin cambios)", { wordpressPageId: json.id, status: json.status });
  return { wordpressPageId: json.id, wordpressDraftUrl: json.link ?? "" };
}

export interface UploadProductionMediaInput {
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
  altText: string;
}

export interface UploadProductionMediaResult {
  wordpressMediaId: number;
  wordpressMediaUrl: string;
  width?: number;
  height?: number;
  fileSize: number;
}

function sanitizeMediaFilename(raw: string, mimeType: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const hasKnownExtension = /\.(jpg|jpeg|png|webp)$/i.test(base);
  const safe = base || `asset-${Date.now()}`;
  return hasKnownExtension ? safe : `${safe}${extension}`;
}

/**
 * Sube un archivo NUEVO a la Media Library de WordPress PRODUCCION.
 * Nunca borra media existente, nunca la asocia a ninguna pagina/post.
 * Mismas 3 condiciones que `createProductionDraftPage()`.
 */
export async function uploadMediaToProduction(input: UploadProductionMediaInput): Promise<UploadProductionMediaResult> {
  if (!canAttemptProductionWrites()) {
    throw new Error(
      "uploadMediaToProduction() llamado sin las 3 condiciones activas (PRODUCTION_EXECUTION_ENABLED=true, PRODUCTION_DRAFTS_ENABLED=true, PRODUCTION_BACKEND=rest). Bloqueado."
    );
  }

  const config = resolveProductionConfig();
  const safeFilename = sanitizeMediaFilename(input.filename, input.mimeType);
  logger.info("WordPress PRODUCTION adapter: subiendo media real a la Media Library (3 condiciones verificadas)", {
    targetUrl: config.baseUrl,
    filename: safeFilename,
    fileSize: input.fileBuffer.length,
  });
  const authHeader = "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WORDPRESS_API_MEDIA_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": input.mimeType,
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        Authorization: authHeader,
      },
      body: input.fileBuffer,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red subiendo media a WordPress produccion: ${sanitizeProductionError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WordPress PRODUCCION REST API respondio ${response.status} subiendo media: ${sanitizeProductionError(bodyText, config.appPassword)}`
    );
  }

  const json = (await response.json()) as {
    id?: number;
    source_url?: string;
    media_details?: { width?: number; height?: number; filesize?: number };
  };
  if (typeof json.id !== "number" || !json.source_url) {
    throw new Error(
      `Respuesta inesperada de WordPress produccion al subir media (sin id numerico o source_url). No se puede confirmar la subida; tratar como fallo.`
    );
  }

  try {
    const altResponse = await fetch(`${config.baseUrl}${WORDPRESS_API_MEDIA_PATH}/${json.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ alt_text: input.altText }),
    });
    if (!altResponse.ok) {
      logger.warn("WordPress PRODUCTION adapter: la media se subio pero no se pudo fijar alt_text", {
        wordpressMediaId: json.id,
        status: altResponse.status,
      });
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    logger.warn("WordPress PRODUCTION adapter: la media se subio pero fallo la llamada de alt_text", {
      wordpressMediaId: json.id,
      error: sanitizeProductionError(raw, config.appPassword),
    });
  }

  logger.info("Media subida a WordPress PRODUCCION (Media Library, sin asociar a ninguna pagina)", {
    wordpressMediaId: json.id,
    width: json.media_details?.width,
    height: json.media_details?.height,
  });

  return {
    wordpressMediaId: json.id,
    wordpressMediaUrl: json.source_url,
    width: json.media_details?.width,
    height: json.media_details?.height,
    fileSize: json.media_details?.filesize ?? input.fileBuffer.length,
  };
}
