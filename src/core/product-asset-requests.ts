import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Product Asset Request Registry (Fase O21.2a) — registro SEPARADO de
 * src/core/asset-requests.ts a proposito: ese registro exige un
 * `changePackId` real (esta pensado para imagenes de contenido de
 * blog/landing ligadas a un change pack). Las imagenes de producto
 * WooCommerce (bancos, y mas adelante cerraduras) no tienen change pack
 * detras, asi que forzar el mismo esquema habria significado inventar un
 * changePackId falso. Mismo patron append-only que el resto del
 * proyecto (asset-requests.ts/change-packs.ts/staging-executions.ts): el
 * estado ACTUAL de una peticion es su instantanea mas reciente en
 * data/product-asset-requests.jsonl, nunca se borra ni se reescribe una
 * linea existente.
 *
 * Igual que su equivalente de blog: SOLO propone/registra. Ningun
 * codigo de este fichero llama a n8n, genera una imagen, la sube a
 * WordPress ni la asocia a un producto — eso vive en
 * src/adapters/n8n-asset-webhook.ts, src/adapters/wordpress.ts (subida
 * de media, ya existente) y src/adapters/woocommerce.ts (asociacion a
 * producto, nuevo en esta fase).
 */

export type ProductAssetType = "main" | "detail" | "family";

export type ProductAssetStatus =
  | "proposed"
  | "generated"
  | "uploaded_to_wordpress"
  | "associated"
  | "superseded"
  | "failed";

export const PRODUCT_ASSET_STATUSES: ProductAssetStatus[] = [
  "proposed",
  "generated",
  "uploaded_to_wordpress",
  "associated",
  "superseded",
  "failed",
];

export interface ProductAssetDimensions {
  width: number;
  height: number;
}

export interface ProductAssetRequest {
  assetRequestId: string;
  /** null para las imagenes de familia (no estan ligadas a un producto concreto). */
  productId: number | null;
  productSlug: string | null;
  productName: string | null;
  assetType: ProductAssetType;
  status: ProductAssetStatus;
  prompt: string;
  negativePrompt: string;
  dimensions: ProductAssetDimensions;
  filenameSuggestion: string;
  altText: string;
  /** Ruta local (VPS) del archivo ya generado/descargado, si existe. */
  generatedFilePath?: string;
  /** ID de la Media Library de WordPress staging tras subirlo. */
  uploadedMediaId?: number;
  /** URL publica final de la media en staging. */
  finalMediaUrl?: string;
  /** ID del producto WooCommerce al que se asocio de verdad (puede diferir de productId en teoria; en la practica siempre coincide). */
  associatedProductId?: number;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

const DATA_DIR = resolveActiveClientPaths().dataDir;
const PRODUCT_ASSET_REQUESTS_FILE = path.join(DATA_DIR, "product-asset-requests.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(request: ProductAssetRequest): void {
  ensureDataDir();
  fs.appendFileSync(PRODUCT_ASSET_REQUESTS_FILE, JSON.stringify(request) + "\n", "utf-8");
}

export function getProductAssetRequestsFilePath(): string {
  return PRODUCT_ASSET_REQUESTS_FILE;
}

export function readAllProductAssetSnapshots(): ProductAssetRequest[] {
  if (!fs.existsSync(PRODUCT_ASSET_REQUESTS_FILE)) return [];
  const raw = fs.readFileSync(PRODUCT_ASSET_REQUESTS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ProductAssetRequest);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada assetRequestId. */
export function readCurrentProductAssetRequests(): ProductAssetRequest[] {
  const byId = new Map<string, ProductAssetRequest>();
  for (const snapshot of readAllProductAssetSnapshots()) {
    byId.set(snapshot.assetRequestId, snapshot);
  }
  return [...byId.values()];
}

export function findProductAssetRequestById(assetRequestId: string): ProductAssetRequest | undefined {
  return readCurrentProductAssetRequests().find((r) => r.assetRequestId === assetRequestId);
}

export interface CreateProductAssetRequestInput {
  productId: number | null;
  productSlug: string | null;
  productName: string | null;
  assetType: ProductAssetType;
  prompt: string;
  negativePrompt: string;
  dimensions: ProductAssetDimensions;
  filenameSuggestion: string;
  altText: string;
  notes?: string;
}

/** Crea una peticion nueva en estado "proposed". No hace dedup -- cada llamada crea una fila nueva a proposito, igual que se pediria una imagen de repuesto si la primera no convence. */
export function createProposedProductAssetRequest(
  input: CreateProductAssetRequestInput
): ProductAssetRequest {
  const now = new Date().toISOString();
  const request: ProductAssetRequest = {
    assetRequestId: `prod-asset-${randomUUID()}`,
    productId: input.productId,
    productSlug: input.productSlug,
    productName: input.productName,
    assetType: input.assetType,
    status: "proposed",
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    dimensions: input.dimensions,
    filenameSuggestion: input.filenameSuggestion,
    altText: input.altText,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(request);
  return request;
}

export function isValidProductAssetStatus(value: string): value is ProductAssetStatus {
  return (PRODUCT_ASSET_STATUSES as string[]).includes(value);
}

/**
 * Cambia el status de una peticion (CLI/futuro agente de ejecucion).
 * NUNCA llama a n8n, a WordPress ni a WooCommerce por si misma -- eso es
 * responsabilidad de quien la invoca (scripts/associate-product-image.ts
 * y los pasos manuales de generacion/subida de esta fase).
 */
export function setProductAssetStatus(
  assetRequestId: string,
  newStatus: ProductAssetStatus,
  updates: Partial<
    Pick<
      ProductAssetRequest,
      "generatedFilePath" | "uploadedMediaId" | "finalMediaUrl" | "associatedProductId" | "notes"
    >
  > = {}
): ProductAssetRequest | undefined {
  const current = readCurrentProductAssetRequests();
  const existing = current.find((r) => r.assetRequestId === assetRequestId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: ProductAssetRequest = { ...existing, ...updates, status: newStatus, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
