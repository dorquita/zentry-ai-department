import { logger } from "../core/logger";
import { resolveActiveClientId, resolveClientSecret } from "../core/client-config";
import { assertWordpressWriteAllowed, resolveWordpressTargetUrl } from "./wordpress-backend";

/**
 * WooCommerce STAGING CATALOG Adapter (Fase O22.3) -- escritura de
 * categorias y productos de catalogo (no solo imagenes, a diferencia
 * de src/adapters/woocommerce.ts) contra la REST API de WooCommerce
 * (wc/v3) en STAGING. Fichero SEPARADO de
 * src/adapters/woocommerce-production.ts a proposito, mismo patron de
 * aislamiento de esa fase: ninguna de las dos rutas de codigo puede
 * escribir en el entorno del otro por error -- este fichero nunca
 * conoce WORDPRESS_PRODUCTION_BASE_URL ni WORDPRESS_PRODUCTION_APP_PASSWORD,
 * y ademas verifica explicitamente que el host resuelto sea
 * EXACTAMENTE "staging.zentrylockers.com" (ver
 * assertStagingHostIsExpected()), ademas de reutilizar el guardrail
 * incondicional ya existente assertWordpressWriteAllowed() (bloquea
 * cualquier escritura si WORDPRESS_ENV="production").
 *
 * Gate de 3 condiciones para escritura real (mismo patron que
 * canAttemptProductionWrites() de wordpress-production.ts, aplicado
 * al lado staging): STAGING_EXECUTION_ENABLED=true Y
 * WORDPRESS_DRAFTS_ENABLED=true Y WORDPRESS_BACKEND="rest". Los 3 flags
 * ya existen en .env con sus valores seguros por defecto (false /
 * false / local_preview) desde fases anteriores (O10.6/O12).
 *
 * TODA funcion de escritura de este fichero es dry-run por defecto
 * (dryRun=true): solo LEE y construye/valida el payload que se
 * enviaria, nunca toca la red en modo escritura.
 */

const WC_CATEGORIES_PATH = "/wp-json/wc/v3/products/categories";
const WC_PRODUCTS_PATH = "/wp-json/wc/v3/products";
const EXPECTED_STAGING_HOST = "staging.zentrylockers.com";

interface WoocommerceStagingConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}

/**
 * Defensa en profundidad (mismo patron que
 * assertProductionHostIsZentrylockers() del adapter de produccion):
 * aunque WORDPRESS_STAGING_BASE_URL este mal configurado en .env,
 * bloquea cualquier lectura/escritura si el host resuelto no es
 * EXACTAMENTE "staging.zentrylockers.com".
 */
function assertStagingHostIsExpected(baseUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`URL de staging "${baseUrl}" no es valida. Bloqueado.`);
  }
  if (hostname !== EXPECTED_STAGING_HOST) {
    throw new Error(
      `El target resuelto ("${hostname}") no es "${EXPECTED_STAGING_HOST}". Bloqueado por seguridad: este adapter SOLO opera contra staging, nunca contra produccion ni ningun otro host.`
    );
  }
}

export function canAttemptStagingCatalogWrites(): boolean {
  return (
    process.env.STAGING_EXECUTION_ENABLED === "true" &&
    process.env.WORDPRESS_DRAFTS_ENABLED === "true" &&
    process.env.WORDPRESS_BACKEND === "rest"
  );
}

/** Nunca loguea ni expone WORDPRESS_APP_PASSWORD fuera de esta funcion. */
function resolveWoocommerceStagingConfig(): WoocommerceStagingConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveWordpressTargetUrl();
  assertStagingHostIsExpected(baseUrl);
  const username = resolveClientSecret(activeClientId, "WORDPRESS_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_APP_PASSWORD");
  if (!username || !appPassword) {
    throw new Error("Faltan WORDPRESS_USERNAME/WORDPRESS_APP_PASSWORD. Bloqueado.");
  }
  return { baseUrl, username, appPassword };
}

function sanitizeStagingError(raw: string, appPassword: string): string {
  const withoutPassword = appPassword ? raw.split(appPassword).join("[REDACTED]") : raw;
  return withoutPassword.length > 500 ? withoutPassword.slice(0, 500) + "...[truncated]" : withoutPassword;
}

function authHeaderFor(config: WoocommerceStagingConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}

/** Para informes/CLI/logs -- nunca devuelve credenciales. */
export function getWoocommerceStagingCatalogStatusForReport(): {
  canWrite: boolean;
  targetUrl?: string;
  hostOk: boolean;
} {
  let targetUrl: string | undefined;
  let hostOk = false;
  try {
    targetUrl = resolveWordpressTargetUrl();
    assertStagingHostIsExpected(targetUrl);
    hostOk = true;
  } catch {
    hostOk = false;
  }
  return { canWrite: canAttemptStagingCatalogWrites() && hostOk, targetUrl, hostOk };
}

// ===================== Categorias =====================

export interface WoocommerceStagingCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
}

/** Solo lectura. Lista todas las categorias de producto en staging (paginado a 100, suficiente para este catalogo). */
export async function getStagingCategories(): Promise<WoocommerceStagingCategory[]> {
  const config = resolveWoocommerceStagingConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_CATEGORIES_PATH}?per_page=100&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce STAGING respondio ${res.status} listando categorias: ${sanitizeStagingError(bodyText, config.appPassword)}`);
  }
  return (await res.json()) as WoocommerceStagingCategory[];
}

export interface CreateStagingCategoryInput {
  name: string;
  slug: string;
  parent?: number;
  description?: string;
  dryRun?: boolean;
}

export interface CreateStagingCategoryResult {
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
 * Crea una categoria de producto en staging. Dry-run por defecto --
 * SIEMPRE comprueba antes si ya existe una categoria con ese slug
 * (evita duplicados tanto en dry-run como en escritura real).
 */
export async function createStagingCategory(input: CreateStagingCategoryInput): Promise<CreateStagingCategoryResult> {
  const dryRun = input.dryRun ?? true;
  const existing = await getStagingCategories();
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

  if (!canAttemptStagingCatalogWrites()) {
    throw new Error("createStagingCategory() llamado con dryRun:false sin las 3 condiciones de staging activas. Bloqueado.");
  }
  assertWordpressWriteAllowed();
  const config = resolveWoocommerceStagingConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce STAGING catalog adapter: creando categoria real", { targetUrl: config.baseUrl, slug: input.slug });

  const res = await fetch(`${config.baseUrl}${WC_CATEGORIES_PATH}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, slug: input.slug, parent: input.parent ?? 0, description: input.description ?? "" }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce STAGING respondio ${res.status} creando la categoria "${input.slug}": ${sanitizeStagingError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, name: input.name, slug: input.slug, parent: input.parent ?? 0, alreadyExists: false, createdId: json.id };
}

// ===================== Productos =====================

export interface WoocommerceStagingProductSummary {
  id: number;
  name: string;
  slug: string;
  sku: string;
  status: string;
  type: string;
  categories: Array<{ id: number; name: string; slug: string }>;
  regular_price: string;
}

/** Solo lectura. */
export async function getStagingProduct(productId: number): Promise<WoocommerceStagingProductSummary> {
  const config = resolveWoocommerceStagingConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}/${productId}?_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce STAGING respondio ${res.status} leyendo el producto ${productId}: ${sanitizeStagingError(bodyText, config.appPassword)}`);
  }
  return (await res.json()) as WoocommerceStagingProductSummary;
}

/** Solo lectura -- busca un producto por slug (para comprobar duplicados antes de crear). */
export async function findStagingProductBySlug(slug: string): Promise<WoocommerceStagingProductSummary | undefined> {
  const config = resolveWoocommerceStagingConfig();
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}?slug=${encodeURIComponent(slug)}&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce STAGING respondio ${res.status} buscando el slug "${slug}": ${sanitizeStagingError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as WoocommerceStagingProductSummary[];
  return json[0];
}

export interface CreateStagingSimpleProductInput {
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

export interface CreateStagingSimpleProductResult {
  dryRun: boolean;
  applied: boolean;
  slug: string;
  alreadyExists: boolean;
  existingId?: number;
  createdId?: number;
  payloadPreview: Record<string, unknown>;
}

/** Crea un producto simple (type: "simple") en staging. Dry-run por defecto, comprueba duplicados por slug. */
export async function createStagingSimpleProduct(
  input: CreateStagingSimpleProductInput
): Promise<CreateStagingSimpleProductResult> {
  const dryRun = input.dryRun ?? true;
  const existing = await findStagingProductBySlug(input.slug);

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
  if (!canAttemptStagingCatalogWrites()) {
    throw new Error("createStagingSimpleProduct() llamado con dryRun:false sin las 3 condiciones de staging activas. Bloqueado.");
  }
  assertWordpressWriteAllowed();
  const config = resolveWoocommerceStagingConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce STAGING catalog adapter: creando producto simple real", { targetUrl: config.baseUrl, slug: input.slug });

  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce STAGING respondio ${res.status} creando el producto "${input.slug}": ${sanitizeStagingError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { id: number };
  return { dryRun: false, applied: true, slug: input.slug, alreadyExists: false, createdId: json.id, payloadPreview: payload };
}

export interface TrashStagingProductResult {
  dryRun: boolean;
  applied: boolean;
  productId: number;
  status?: string;
}

/**
 * ROLLBACK: mueve un producto a la papelera (status: "trash", nunca
 * borrado permanente -- force=false). Sigue exigiendo dryRun:false +
 * canAttemptStagingCatalogWrites() como cualquier otra escritura.
 */
export async function trashStagingProduct(productId: number, dryRun = true): Promise<TrashStagingProductResult> {
  if (dryRun) {
    await getStagingProduct(productId);
    return { dryRun: true, applied: false, productId };
  }
  if (!canAttemptStagingCatalogWrites()) {
    throw new Error("trashStagingProduct() llamado con dryRun:false sin las 3 condiciones de staging activas. Bloqueado.");
  }
  assertWordpressWriteAllowed();
  const config = resolveWoocommerceStagingConfig();
  const authHeader = authHeaderFor(config);
  logger.info("WooCommerce STAGING catalog adapter: moviendo producto a papelera (rollback)", { targetUrl: config.baseUrl, productId });

  const res = await fetch(`${config.baseUrl}${WC_PRODUCTS_PATH}/${productId}?force=false`, {
    method: "DELETE",
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`WooCommerce STAGING respondio ${res.status} moviendo a papelera el producto ${productId}: ${sanitizeStagingError(bodyText, config.appPassword)}`);
  }
  const json = (await res.json()) as { status?: string };
  return { dryRun: false, applied: true, productId, status: json.status };
}
