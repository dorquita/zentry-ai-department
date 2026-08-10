import { logger } from "../core/logger";
import { resolveActiveClientId, resolveClientSecret } from "../core/client-config";
import { canAttemptProductionWrites, resolveProductionTargetUrl } from "./wordpress-production";

/**
 * WooCommerce PRODUCTION Adapter (Fase O21.5a) — PRIMER punto de
 * contacto de todo el proyecto con la REST API de WooCommerce (wc/v3)
 * en PRODUCCION. Deliberadamente un fichero SEPARADO de
 * src/adapters/woocommerce.ts (staging): ninguna de las dos rutas de
 * codigo puede escribir en el entorno del otro por error.
 * woocommerce.ts bloquea produccion incondicionalmente
 * (assertWordpressWriteAllowed()); este fichero bloquea staging por
 * diseno (nunca conoce WORDPRESS_STAGING_BASE_URL ni sus credenciales,
 * y ademas verifica explicitamente que el host resuelto sea
 * "zentrylockers.com" exacto -- ver assertProductionHostIsZentrylockers()).
 *
 * Reutiliza el MISMO gate de 3 condiciones que ya usa
 * wordpress-production.ts (canAttemptProductionWrites():
 * PRODUCTION_EXECUTION_ENABLED=true Y PRODUCTION_DRAFTS_ENABLED=true Y
 * PRODUCTION_BACKEND=rest) en vez de reimplementarlo -- es la misma
 * decision de "produccion esta permitida ahora mismo", no tiene sentido
 * que este fichero tenga un umbral distinto al de paginas/media.
 *
 * TODA funcion de escritura de este fichero es dry-run por defecto
 * (dryRun=true): solo LEE y construye/valida el payload que se
 * enviaria, nunca toca la red en modo escritura. Con dryRun=false
 * explicito, ademas debe cumplirse canAttemptProductionWrites() o
 * lanza antes de intentar la escritura real.
 *
 * Fase O21.5a: esta fase SOLO construye este adapter y lo prueba con
 * dry-run. Ninguna llamada real (dryRun:false) se ha hecho todavia --
 * eso es la Fase O21.5b, pendiente de aprobacion explicita.
 */

const WC_CATEGORIES_PATH = "/wp-json/wc/v3/products/categories";
const WC_ATTRIBUTES_PATH = "/wp-json/wc/v3/products/attributes";
const WC_PRODUCTS_PATH = "/wp-json/wc/v3/products";
const EXPECTED_PRODUCTION_HOST = "zentrylockers.com";

interface WoocommerceProductionConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}

/**
 * Defensa en profundidad explicitamente pedida (Fase O21.5a): aunque
 * WORDPRESS_PRODUCTION_BASE_URL este mal configurado en .env (por
 * ejemplo, apuntando por error a staging), esta funcion bloquea
 * cualquier lectura/escritura si el host resuelto no es EXACTAMENTE
 * "zentrylockers.com" (sin subdominios como "staging.").
 */
function assertProductionHostIsZentrylockers(baseUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`WORDPRESS_PRODUCTION_BASE_URL="${baseUrl}" no es una URL valida. Bloqueado.`);
  }
  if (hostname !== EXPECTED_PRODUCTION_HOST) {
    throw new Error(
      `El target resuelto ("${hostname}") no es "${EXPECTED_PRODUCTION_HOST}". Bloqueado por seguridad: este adapter SOLO opera contra la produccion real de Zentry, nunca contra staging ni ningun otro host.`
    );
  }
}

/**
 * Nunca loguea ni expone WORDPRESS_PRODUCTION_APP_PASSWORD fuera de
 * esta funcion. Lanza si falta cualquier variable esperada
 * (usuario/password/URL) o si el host no es zentrylockers.com.
 */
function resolveWoocommerceProductionConfig(): WoocommerceProductionConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  assertProductionHostIsZentrylockers(baseUrl);
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  if (!username || !appPassword) {
    throw new Error("Faltan WORDPRESS_PRODUCTION_USERNAME/WORDPRESS_PRODUCTION_APP_PASSWORD. Bloqueado.");
  }
  return { baseUrl, username, appPassword };
}

function sanitizeProductionError(raw: string, appPassword: string): string {
  const withoutPassword = appPassword ? raw.split(appPassword).join("[REDACTED]") : raw;
  return withoutPassword.length > 500 ? withoutPassword.slice(0, 500) + "...[truncated]" : withoutPassword;
}

function authHeaderFor(config: WoocommerceProductionConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}

/** Para informes/CLI/logs -- nunca devuelve credenciales. */
export function getWoocommerceProductionStatusForReport(): {
  canWrite: boolean;
  targetUrl?: string;
  hostOk: boolean;
} {
  let targetUrl: string | undefined;
  let hostOk = false;
  try {
    targetUrl = resolveProductionTargetUrl();
    assertProductionHostIsZentrylockers(targetUrl);
    hostOk = true;
  } catch {
    hostOk = false;
  }
  return { canWrite: canAttemptProductionWrites() && hostOk, targetUrl, hostOk };
}

// ===================== Categorias =====================

export interface WoocommerceProductionCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
}

/** Solo lectura. Lista todas las categorias de producto en produccion (paginado a 100, suficiente para este catalogo). */
export async function getProductionCategories(): Promise<WoocommerceProductionCategory[]> {
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_CATEGORIES_PATH}?per_page=100&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} listando categorias: ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as WoocommerceProductionCategory[];
  return json;
}

export interface CreateProductionCategoryInput {
  name: string;
  slug: string;
  parent?: number;
  description?: string;
  dryRun?: boolean;
}

export interface CreateProductionCategoryResult {
  dryRun: boolean;
  applied: boolean;
  name: string;
  slug: string;
  parent: number;
  alreadyExists: boolean;
  existingId?: number;
  createdId?: number;
}

/**
 * Crea una categoria de producto en produccion. Dry-run por defecto --
 * SIEMPRE comprueba antes si ya existe una categoria con ese slug (evita
 * duplicados tanto en dry-run como en escritura real).
 */
export async function createProductionCategory(input: CreateProductionCategoryInput): Promise<CreateProductionCategoryResult> {
  const dryRun = input.dryRun ?? true;
  const existing = await getProductionCategories();
  const match = existing.find((c) => c.slug === input.slug);

  if (match) {
    return {
      dryRun,
      applied: false,
      name: input.name,
      slug: input.slug,
      parent: input.parent ?? 0,
      alreadyExists: true,
      existingId: match.id,
    };
  }

  if (dryRun) {
    return { dryRun: true, applied: false, name: input.name, slug: input.slug, parent: input.parent ?? 0, alreadyExists: false };
  }

  if (!canAttemptProductionWrites()) {
    throw new Error("createProductionCategory() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce PRODUCTION adapter: creando categoria real", { targetUrl: config.baseUrl, slug: input.slug });

  const res = await fetch(`${config.baseUrl}${WC_CATEGORIES_PATH}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, slug: input.slug, parent: input.parent ?? 0, description: input.description ?? "" }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} creando la categoria "${input.slug}": ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, name: input.name, slug: input.slug, parent: input.parent ?? 0, alreadyExists: false, createdId: json.id };
}

// ===================== Atributos =====================

export interface WoocommerceProductionAttribute {
  id: number;
  name: string;
  slug: string;
}

export interface WoocommerceProductionAttributeTerm {
  id: number;
  name: string;
  slug: string;
}

/** Solo lectura. */
export async function getProductionAttributes(): Promise<WoocommerceProductionAttribute[]> {
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_ATTRIBUTES_PATH}?_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} listando atributos: ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  return (await res.json()) as WoocommerceProductionAttribute[];
}

/** Solo lectura. */
export async function getProductionAttributeTerms(attributeId: number): Promise<WoocommerceProductionAttributeTerm[]> {
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_ATTRIBUTES_PATH}/${attributeId}/terms?per_page=100&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} listando terminos del atributo ${attributeId}: ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  return (await res.json()) as WoocommerceProductionAttributeTerm[];
}

export interface CreateProductionAttributeInput {
  name: string;
  slug: string;
  dryRun?: boolean;
}

export interface CreateProductionAttributeResult {
  dryRun: boolean;
  applied: boolean;
  name: string;
  slug: string;
  alreadyExists: boolean;
  existingId?: number;
  createdId?: number;
}

/** Crea un atributo global. Dry-run por defecto, comprueba duplicados por slug (pa_<slug>). */
export async function createProductionAttribute(input: CreateProductionAttributeInput): Promise<CreateProductionAttributeResult> {
  const dryRun = input.dryRun ?? true;
  const existing = await getProductionAttributes();
  const match = existing.find((a) => a.slug === `pa_${input.slug}` || a.slug === input.slug);

  if (match) {
    return { dryRun, applied: false, name: input.name, slug: input.slug, alreadyExists: true, existingId: match.id };
  }
  if (dryRun) {
    return { dryRun: true, applied: false, name: input.name, slug: input.slug, alreadyExists: false };
  }
  if (!canAttemptProductionWrites()) {
    throw new Error("createProductionAttribute() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce PRODUCTION adapter: creando atributo global real", { targetUrl: config.baseUrl, slug: input.slug });

  const res = await fetch(`${config.baseUrl}${WC_ATTRIBUTES_PATH}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, slug: input.slug, type: "select", order_by: "menu_order", has_archives: false }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} creando el atributo "${input.slug}": ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, name: input.name, slug: input.slug, alreadyExists: false, createdId: json.id };
}

export interface CreateProductionAttributeTermInput {
  attributeId: number;
  name: string;
  slug: string;
  dryRun?: boolean;
}

export interface CreateProductionAttributeTermResult {
  dryRun: boolean;
  applied: boolean;
  attributeId: number;
  name: string;
  slug: string;
  alreadyExists: boolean;
  existingId?: number;
  createdId?: number;
}

/** Crea un termino de un atributo global ya existente (p.ej. "1000mm" del atributo Longitud). Dry-run por defecto. */
export async function createProductionAttributeTerm(input: CreateProductionAttributeTermInput): Promise<CreateProductionAttributeTermResult> {
  const dryRun = input.dryRun ?? true;
  const existing = await getProductionAttributeTerms(input.attributeId);
  const match = existing.find((t) => t.slug === input.slug);

  if (match) {
    return { dryRun, applied: false, attributeId: input.attributeId, name: input.name, slug: input.slug, alreadyExists: true, existingId: match.id };
  }
  if (dryRun) {
    return { dryRun: true, applied: false, attributeId: input.attributeId, name: input.name, slug: input.slug, alreadyExists: false };
  }
  if (!canAttemptProductionWrites()) {
    throw new Error("createProductionAttributeTerm() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce PRODUCTION adapter: creando termino de atributo real", { targetUrl: config.baseUrl, attributeId: input.attributeId, slug: input.slug });

  const res = await fetch(`${config.baseUrl}${WC_ATTRIBUTES_PATH}/${input.attributeId}/terms`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, slug: input.slug }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} creando el termino "${input.slug}": ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, attributeId: input.attributeId, name: input.name, slug: input.slug, alreadyExists: false, createdId: json.id };
}

// ===================== Productos =====================

export interface WoocommerceProductionProductSummary {
  id: number;
  name: string;
  slug: string;
  status: string;
  type: string;
  images: Array<{ id: number; src: string }>;
}

/** Solo lectura. */
export async function getProductionProduct(productId: number): Promise<WoocommerceProductionProductSummary> {
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}/${productId}?_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} leyendo el producto ${productId}: ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  return (await res.json()) as WoocommerceProductionProductSummary;
}

/** Solo lectura -- busca un producto por slug (para comprobar duplicados antes de crear). */
export async function findProductionProductBySlug(slug: string): Promise<WoocommerceProductionProductSummary | undefined> {
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}?slug=${encodeURIComponent(slug)}&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} buscando el slug "${slug}": ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as WoocommerceProductionProductSummary[];
  return json[0];
}

export interface CreateProductionVariableProductInput {
  name: string;
  slug: string;
  description: string;
  shortDescription?: string;
  categoryIds: number[];
  /** SKU del producto padre (opcional, igual que en staging si aplica). */
  sku?: string;
  /** status del producto (publish/draft/...). Por defecto "publish" si no se especifica. */
  status?: string;
  /** attributeId y terminos ya remapeados a IDs de produccion. */
  attributes: Array<{ id: number; name: string; options: string[]; variation: boolean; visible: boolean }>;
  /** mediaIds YA subidos a la Media Library de produccion (posicion 0 = destacada). */
  imageIds: number[];
  dryRun?: boolean;
}

export interface CreateProductionVariableProductResult {
  dryRun: boolean;
  applied: boolean;
  slug: string;
  alreadyExists: boolean;
  existingId?: number;
  createdId?: number;
  payloadPreview: Record<string, unknown>;
}

/** Crea un producto variable (padre) en produccion. Dry-run por defecto, comprueba duplicados por slug. */
export async function createProductionVariableProduct(
  input: CreateProductionVariableProductInput
): Promise<CreateProductionVariableProductResult> {
  const dryRun = input.dryRun ?? true;
  const existing = await findProductionProductBySlug(input.slug);

  const payload = {
    name: input.name,
    slug: input.slug,
    type: "variable",
    sku: input.sku ?? "",
    status: input.status ?? "publish",
    description: input.description,
    short_description: input.shortDescription ?? "",
    categories: input.categoryIds.map((id) => ({ id })),
    attributes: input.attributes,
    images: input.imageIds.map((id) => ({ id })),
  };

  if (existing) {
    return { dryRun, applied: false, slug: input.slug, alreadyExists: true, existingId: existing.id, payloadPreview: payload };
  }
  if (dryRun) {
    return { dryRun: true, applied: false, slug: input.slug, alreadyExists: false, payloadPreview: payload };
  }
  if (!canAttemptProductionWrites()) {
    throw new Error("createProductionVariableProduct() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce PRODUCTION adapter: creando producto variable real", { targetUrl: config.baseUrl, slug: input.slug });

  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} creando el producto "${input.slug}": ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, slug: input.slug, alreadyExists: false, createdId: json.id, payloadPreview: payload };
}

export interface CreateProductionSimpleProductInput {
  name: string;
  slug: string;
  sku: string;
  regularPrice: string;
  description: string;
  shortDescription?: string;
  categoryIds: number[];
  /** status del producto (publish/draft/...). Por defecto "publish" si no se especifica. */
  status?: string;
  dryRun?: boolean;
}

export interface CreateProductionSimpleProductResult {
  dryRun: boolean;
  applied: boolean;
  slug: string;
  alreadyExists: boolean;
  existingId?: number;
  createdId?: number;
  payloadPreview: Record<string, unknown>;
}

/**
 * Crea un producto simple (type: "simple", sin variaciones) en
 * produccion. Fase O22 (Cerraduras) -- primer producto de este proyecto
 * que no es "variable" (a diferencia de createProductionVariableProduct,
 * usado por Bancos). Mismas garantias: dry-run por defecto, comprueba
 * duplicados por slug, exige canAttemptProductionWrites() antes de
 * escribir de verdad.
 */
export async function createProductionSimpleProduct(
  input: CreateProductionSimpleProductInput
): Promise<CreateProductionSimpleProductResult> {
  const dryRun = input.dryRun ?? true;
  const existing = await findProductionProductBySlug(input.slug);

  const payload = {
    name: input.name,
    slug: input.slug,
    type: "simple",
    sku: input.sku,
    regular_price: input.regularPrice,
    status: input.status ?? "publish",
    description: input.description,
    short_description: input.shortDescription ?? "",
    categories: input.categoryIds.map((id) => ({ id })),
  };

  if (existing) {
    return { dryRun, applied: false, slug: input.slug, alreadyExists: true, existingId: existing.id, payloadPreview: payload };
  }
  if (dryRun) {
    return { dryRun: true, applied: false, slug: input.slug, alreadyExists: false, payloadPreview: payload };
  }
  if (!canAttemptProductionWrites()) {
    throw new Error("createProductionSimpleProduct() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce PRODUCTION adapter: creando producto simple real", { targetUrl: config.baseUrl, slug: input.slug });

  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} creando el producto "${input.slug}": ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, slug: input.slug, alreadyExists: false, createdId: json.id, payloadPreview: payload };
}

export interface CreateProductionVariationInput {
  productId: number;
  sku: string;
  regularPrice: string;
  /** attributeId ya remapeado + option (nombre del termino, no su id). */
  attributes: Array<{ id: number; option: string }>;
  /** stock_status de la variacion. Por defecto "instock" si no se especifica. */
  stockStatus?: string;
  /** descripcion/medidas de la variacion, igual que en staging. */
  description?: string;
  /** mediaId YA subido a la Media Library de produccion, si la variacion tiene imagen propia. */
  imageId?: number;
  dryRun?: boolean;
}

export interface CreateProductionVariationResult {
  dryRun: boolean;
  applied: boolean;
  productId: number;
  sku: string;
  alreadyExists: boolean;
  existingId?: number;
  createdId?: number;
  payloadPreview: Record<string, unknown>;
}

/** Crea una variacion de un producto variable ya existente en produccion. Dry-run por defecto, comprueba duplicados por SKU dentro del producto. */
export async function createProductionVariation(input: CreateProductionVariationInput): Promise<CreateProductionVariationResult> {
  const dryRun = input.dryRun ?? true;
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);

  const varRes = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}/${input.productId}/variations?per_page=100&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!varRes.ok) {
    const bodyText = await varRes.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${varRes.status} listando variaciones del producto ${input.productId}: ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const existingVariations = (await varRes.json()) as Array<{ id: number; sku: string }>;
  const match = existingVariations.find((v) => v.sku === input.sku);

  const payload = {
    sku: input.sku,
    regular_price: input.regularPrice,
    attributes: input.attributes,
    stock_status: input.stockStatus ?? "instock",
    description: input.description ?? "",
    ...(input.imageId ? { image: { id: input.imageId } } : {}),
  };

  if (match) {
    return { dryRun, applied: false, productId: input.productId, sku: input.sku, alreadyExists: true, existingId: match.id, payloadPreview: payload };
  }
  if (dryRun) {
    return { dryRun: true, applied: false, productId: input.productId, sku: input.sku, alreadyExists: false, payloadPreview: payload };
  }
  if (!canAttemptProductionWrites()) {
    throw new Error("createProductionVariation() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  logger.info("WooCommerce PRODUCTION adapter: creando variacion real", { targetUrl: config.baseUrl, productId: input.productId, sku: input.sku });

  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}/${input.productId}/variations`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} creando la variacion "${input.sku}": ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, productId: input.productId, sku: input.sku, alreadyExists: false, createdId: json.id, payloadPreview: payload };
}

export interface UpdateProductionProductImagesInput {
  productId: number;
  /** posicion 0 = destacada, resto = galeria. */
  imageIds: number[];
  dryRun?: boolean;
}

export interface UpdateProductionProductImagesResult {
  dryRun: boolean;
  applied: boolean;
  productId: number;
  imageIds: number[];
}

/** Actualiza imagen destacada + galeria de un producto ya existente en produccion. Dry-run por defecto. */
export async function updateProductionProductImages(input: UpdateProductionProductImagesInput): Promise<UpdateProductionProductImagesResult> {
  const dryRun = input.dryRun ?? true;
  if (dryRun) {
    await getProductionProduct(input.productId); // valida que el producto existe, solo lectura
    return { dryRun: true, applied: false, productId: input.productId, imageIds: input.imageIds };
  }
  if (!canAttemptProductionWrites()) {
    throw new Error("updateProductionProductImages() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce PRODUCTION adapter: actualizando imagenes de producto real", { targetUrl: config.baseUrl, productId: input.productId });

  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}/${input.productId}`, {
    method: "PUT",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ images: input.imageIds.map((id) => ({ id })) }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} actualizando imagenes del producto ${input.productId}: ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  return { dryRun: false, applied: true, productId: input.productId, imageIds: input.imageIds };
}

export interface TrashProductionProductResult {
  dryRun: boolean;
  applied: boolean;
  productId: number;
  status?: string;
}

/**
 * ROLLBACK: mueve un producto a la papelera (status: "trash", nunca
 * borrado permanente -- force=false). Sigue exigiendo dryRun:false +
 * canAttemptProductionWrites() como cualquier otra escritura: incluso
 * un rollback es una escritura real en produccion y pasa por el mismo
 * gate, nunca se salta.
 */
export async function trashProductionProduct(productId: number, dryRun = true): Promise<TrashProductionProductResult> {
  if (dryRun) {
    await getProductionProduct(productId);
    return { dryRun: true, applied: false, productId };
  }
  if (!canAttemptProductionWrites()) {
    throw new Error("trashProductionProduct() llamado con dryRun:false sin las 3 condiciones de produccion activas. Bloqueado.");
  }
  const config = resolveWoocommerceProductionConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce PRODUCTION adapter: moviendo producto a papelera (rollback)", { targetUrl: config.baseUrl, productId });

  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}/${productId}?force=false`, {
    method: "DELETE",
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce PRODUCCION respondio ${res.status} moviendo a papelera el producto ${productId}: ${sanitizeProductionError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { status?: string };
  return { dryRun: false, applied: true, productId, status: json.status };
}
