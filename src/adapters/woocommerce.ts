import { assertWordpressWriteAllowed, resolveWordpressTargetUrl } from "./wordpress-backend";
import { resolveActiveClientId, resolveClientSecret } from "../core/client-config";

/**
 * WooCommerce Adapter (Fase O21.2b) — PRIMER punto de contacto de este
 * proyecto con la REST API de WooCommerce (wc/v3), deliberadamente
 * separado de src/adapters/wordpress.ts: ese fichero documenta
 * explicitamente que NO toca WooCommerce, como garantia de seguridad de
 * una fase anterior (Fase O10). Este adapter nuevo respeta esa misma
 * garantia para todo lo que YA cubria wordpress.ts (paginas/media) --
 * solo anade lo minimo necesario para asociar una imagen ya subida a la
 * Media Library como imagen destacada de un producto.
 *
 * Reutiliza las MISMAS credenciales que wordpress.ts
 * (WORDPRESS_USERNAME/WORDPRESS_APP_PASSWORD via resolveClientSecret --
 * la REST API de WooCommerce con Application Password usa la misma
 * autenticacion Basic que wp/v2) y el MISMO guardrail incondicional de
 * produccion (assertWordpressWriteAllowed()/resolveWordpressTargetUrl()
 * de wordpress-backend.ts) -- si WORDPRESS_ENV="production", cualquier
 * funcion de escritura de este fichero lanza ANTES de tocar la red,
 * exactamente igual que en wordpress.ts.
 */

const WOOCOMMERCE_API_PRODUCTS_PATH = "/wp-json/wc/v3/products";

interface WoocommerceConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}

function resolveWoocommerceConfig(): WoocommerceConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveWordpressTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_APP_PASSWORD");
  return { baseUrl, username, appPassword };
}

function sanitizeWoocommerceError(raw: string, appPassword: string): string {
  if (!appPassword) return raw;
  return raw.split(appPassword).join("[REDACTED]");
}

function authHeaderFor(config: WoocommerceConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}

export interface WoocommerceProductSummary {
  id: number;
  name: string;
  slug: string;
  status: string;
  type: string;
  images: Array<{ id: number; src: string }>;
}

/** Solo lectura -- confirma que un producto existe antes de intentar asociarle nada. */
export async function getWoocommerceProduct(productId: number): Promise<WoocommerceProductSummary> {
  const config = resolveWoocommerceConfig();
  const authHeader = authHeaderFor(config);

  // O21.2f: cache-busting obligatorio -- se confirmo en vivo que LiteSpeed
  // Cache puede servir una respuesta CACHEADA y desactualizada de este
  // mismo endpoint autenticado (mismo problema ya documentado para la
  // Store API en O19.3). Sin esto, leer el array de imagenes actual antes de
  // anadir una imagen a la galeria podria basarse en datos viejos y
  // sobrescribir/perder la imagen destacada real. El parametro cb + cabeceras
  // no-cache fuerzan una respuesta fresca.
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WOOCOMMERCE_API_PRODUCTS_PATH}/${productId}?_cb=${Date.now()}`, {
      method: "GET",
      headers: { Authorization: authHeader, "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red leyendo el producto WooCommerce ${productId}: ${sanitizeWoocommerceError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WooCommerce REST API respondio ${response.status} leyendo el producto ${productId}: ${sanitizeWoocommerceError(bodyText, config.appPassword)}`
    );
  }

  const json = (await response.json()) as {
    id?: number;
    name?: string;
    slug?: string;
    status?: string;
    type?: string;
    images?: Array<{ id: number; src: string }>;
  };
  if (typeof json.id !== "number") {
    throw new Error(`Respuesta inesperada de WooCommerce leyendo el producto ${productId} (sin id numerico).`);
  }

  return {
    id: json.id,
    name: json.name ?? "",
    slug: json.slug ?? "",
    status: json.status ?? "",
    type: json.type ?? "",
    images: json.images ?? [],
  };
}

/** Solo lectura -- confirma que una media existe en la Media Library antes de intentar asociarla. */
export async function getWoocommerceMediaExists(mediaId: number): Promise<boolean> {
  const config = resolveWoocommerceConfig();
  const authHeader = authHeaderFor(config);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/wp-json/wp/v2/media/${mediaId}`, {
      method: "GET",
      headers: { Authorization: authHeader },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red comprobando la media ${mediaId}: ${sanitizeWoocommerceError(raw, config.appPassword)}`);
  }
  return response.ok;
}

export interface AssociateProductImageInput {
  productId: number;
  mediaId: number;
  /**
   * Por ahora solo se usa como imagen DESTACADA (primera del array,
   * WooCommerce la trata como principal). Dejar espacio para galeria
   * completa en el futuro: si se pasan mas mediaIds en `additionalMediaIds`,
   * se anaden detras sin sustituir la principal.
   */
  additionalMediaIds?: number[];
  /** true por defecto -- no escribe nada, solo valida y describe lo que HARIA. */
  dryRun?: boolean;
}

export interface AssociateProductImageResult {
  dryRun: boolean;
  productId: number;
  productName: string;
  productSlug: string;
  mediaId: number;
  imagesPayload: Array<{ id: number }>;
  applied: boolean;
}

/**
 * Asocia una imagen ya subida a la Media Library de WordPress como
 * imagen destacada de un producto WooCommerce (PUT wc/v3/products/{id},
 * campo `images`). Dry-run por defecto -- solo con `dryRun: false`
 * explicito hace la escritura real, y aun asi llama primero a
 * assertWordpressWriteAllowed() (bloquea produccion incondicionalmente)
 * y confirma que el producto Y la media existen antes de escribir nada.
 */
export async function associateProductFeaturedImage(
  input: AssociateProductImageInput
): Promise<AssociateProductImageResult> {
  const dryRun = input.dryRun ?? true;

  const product = await getWoocommerceProduct(input.productId);
  const mediaExists = await getWoocommerceMediaExists(input.mediaId);
  if (!mediaExists) {
    throw new Error(`No se encontro la media ${input.mediaId} en la Media Library -- no se asocia nada.`);
  }

  const imagesPayload = [{ id: input.mediaId }, ...(input.additionalMediaIds ?? []).map((id) => ({ id }))];

  if (dryRun) {
    return {
      dryRun: true,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      mediaId: input.mediaId,
      imagesPayload,
      applied: false,
    };
  }

  assertWordpressWriteAllowed();
  const config = resolveWoocommerceConfig();
  const authHeader = authHeaderFor(config);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WOOCOMMERCE_API_PRODUCTS_PATH}/${input.productId}`, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ images: imagesPayload }),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red asociando la imagen al producto ${input.productId}: ${sanitizeWoocommerceError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WooCommerce REST API respondio ${response.status} asociando la imagen al producto ${input.productId}: ${sanitizeWoocommerceError(bodyText, config.appPassword)}`
    );
  }

  return {
    dryRun: false,
    productId: product.id,
    productName: product.name,
    productSlug: product.slug,
    mediaId: input.mediaId,
    imagesPayload,
    applied: true,
  };
}

export interface AddProductGalleryImageInput {
  productId: number;
  mediaId: number;
  /** true por defecto -- no escribe nada, solo valida y describe lo que HARIA. */
  dryRun?: boolean;
}

export interface AddProductGalleryImageResult {
  dryRun: boolean;
  productId: number;
  productName: string;
  productSlug: string;
  /** Imagenes ANTES de anadir la nueva (tal como estaban, primera = destacada). */
  existingImageIds: number[];
  mediaId: number;
  imagesPayload: Array<{ id: number }>;
  applied: boolean;
}

/**
 * O21.2f -- anade una imagen a la GALERIA de un producto SIN tocar la
 * imagen destacada: lee el array `images` actual del producto (posicion
 * 0 = destacada, WooCommerce la trata asi por convencion) y anade la
 * nueva media al final, preservando el orden y el contenido de todo lo
 * que ya habia. Distinto de associateProductFeaturedImage(), que
 * siempre pone su `mediaId` en la posicion 0 (sustituye la destacada) --
 * esa funcion sigue existiendo tal cual para cuando el objetivo SI es
 * cambiar la principal.
 *
 * Mismas garantias que associateProductFeaturedImage(): dry-run por
 * defecto, confirma que producto y media existen, assertWordpressWriteAllowed()
 * bloquea produccion incondicionalmente antes de cualquier escritura real.
 */
export async function addProductGalleryImage(
  input: AddProductGalleryImageInput
): Promise<AddProductGalleryImageResult> {
  const dryRun = input.dryRun ?? true;

  const product = await getWoocommerceProduct(input.productId);
  const mediaExists = await getWoocommerceMediaExists(input.mediaId);
  if (!mediaExists) {
    throw new Error(`No se encontro la media ${input.mediaId} en la Media Library -- no se anade a la galeria.`);
  }

  const existingImageIds = product.images.map((img) => img.id);
  if (existingImageIds.includes(input.mediaId)) {
    throw new Error(`La media ${input.mediaId} ya esta en la galeria del producto ${input.productId} -- no se duplica.`);
  }

  const imagesPayload = [...existingImageIds.map((id) => ({ id })), { id: input.mediaId }];

  if (dryRun) {
    return {
      dryRun: true,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      existingImageIds,
      mediaId: input.mediaId,
      imagesPayload,
      applied: false,
    };
  }

  assertWordpressWriteAllowed();
  const config = resolveWoocommerceConfig();
  const authHeader = authHeaderFor(config);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${WOOCOMMERCE_API_PRODUCTS_PATH}/${input.productId}`, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ images: imagesPayload }),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red anadiendo imagen a galeria del producto ${input.productId}: ${sanitizeWoocommerceError(raw, config.appPassword)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(
      `WooCommerce REST API respondio ${response.status} anadiendo imagen a galeria del producto ${input.productId}: ${sanitizeWoocommerceError(bodyText, config.appPassword)}`
    );
  }

  return {
    dryRun: false,
    productId: product.id,
    productName: product.name,
    productSlug: product.slug,
    existingImageIds,
    mediaId: input.mediaId,
    imagesPayload,
    applied: true,
  };
}
