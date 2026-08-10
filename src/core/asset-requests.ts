import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ASSET_REQUEST_STATUSES, AssetRequest, AssetRequestStatus } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Asset Request Registry (Fase O12.4): propuesta de un asset visual
 * (imagen) que un change pack/draft necesitaria. SOLO propone — ningun
 * codigo de este proyecto llama a n8n, genera una imagen ni la sube a
 * WordPress todavia. Ver docs/asset-generation-workflow.md y
 * docs/n8n-asset-webhook-contract.md.
 *
 * data/asset-requests.jsonl es un log append-only de instantaneas, mismo
 * patron que change-packs.ts/staging-executions.ts. El estado actual es
 * su instantanea mas reciente. No hay fichero de auditoria aparte: el
 * propio historico de instantaneas ya sirve de auditoria completa.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const ASSET_REQUESTS_FILE = path.join(DATA_DIR, "asset-requests.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(request: AssetRequest): void {
  ensureDataDir();
  fs.appendFileSync(ASSET_REQUESTS_FILE, JSON.stringify(request) + "\n", "utf-8");
}

export function readAllAssetRequestSnapshots(): AssetRequest[] {
  if (!fs.existsSync(ASSET_REQUESTS_FILE)) return [];
  const raw = fs.readFileSync(ASSET_REQUESTS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AssetRequest);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada assetRequestId. */
export function readCurrentAssetRequests(): AssetRequest[] {
  const byId = new Map<string, AssetRequest>();
  for (const snapshot of readAllAssetRequestSnapshots()) {
    byId.set(snapshot.assetRequestId, snapshot);
  }
  return [...byId.values()];
}

export function findAssetRequestById(assetRequestId: string): AssetRequest | undefined {
  return readCurrentAssetRequests().find((r) => r.assetRequestId === assetRequestId);
}

/** Dedup: un mismo change pack puede necesitar varios assets (hero + card + icon...), nunca dos peticiones para el mismo (changePackId, imagePurpose). */
export function findAssetRequestByChangePackAndPurpose(
  changePackId: string,
  imagePurpose: AssetRequest["imagePurpose"],
  current: AssetRequest[]
): AssetRequest | undefined {
  return current.find((r) => r.changePackId === changePackId && r.imagePurpose === imagePurpose);
}

export function getAssetRequestsFilePath(): string {
  return ASSET_REQUESTS_FILE;
}

export function isValidAssetRequestStatus(value: string): value is AssetRequestStatus {
  return (ASSET_REQUEST_STATUSES as string[]).includes(value);
}

export interface CreateAssetRequestInput {
  changePackId: string;
  draftId?: string;
  targetBrand: AssetRequest["targetBrand"];
  sector?: string;
  pageType: string;
  imagePurpose: AssetRequest["imagePurpose"];
  prompt: string;
  negativePrompt: string;
  styleGuide: string;
  altText: string;
  filenameSuggestion: string;
  dimensions: AssetRequest["dimensions"];
}

export interface UpsertAssetRequestResult {
  request: AssetRequest;
  isNew: boolean;
}

/**
 * Crea una peticion `proposed` nueva para (changePackId, imagePurpose) si
 * no existe todavia (dedup, ver findAssetRequestByChangePackAndPurpose),
 * o devuelve la existente sin tocarla — nunca reescribe una propuesta ya
 * hecha solo porque el change pack se vuelva a ver en una pasada
 * posterior.
 */
export function upsertProposedAssetRequest(
  input: CreateAssetRequestInput,
  current: AssetRequest[]
): UpsertAssetRequestResult {
  const existing = findAssetRequestByChangePackAndPurpose(input.changePackId, input.imagePurpose, current);
  if (existing) {
    return { request: existing, isNew: false };
  }

  const now = new Date().toISOString();
  const request: AssetRequest = {
    assetRequestId: `asset-req-${randomUUID()}`,
    changePackId: input.changePackId,
    draftId: input.draftId,
    targetBrand: input.targetBrand,
    sector: input.sector,
    pageType: input.pageType,
    imagePurpose: input.imagePurpose,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    styleGuide: input.styleGuide,
    altText: input.altText,
    filenameSuggestion: input.filenameSuggestion,
    dimensions: input.dimensions,
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(request);
  current.push(request);
  return { request, isNew: true };
}

/**
 * Cambia el status de una peticion (CLI/futuro agente de ejecucion).
 * NUNCA llama a n8n ni a ninguna API de imagen por si misma — eso, si
 * algun dia existe, es responsabilidad explicita de otro modulo (ver
 * src/adapters/n8n-asset-webhook.ts, hoy solo un skeleton que lanza).
 */
export function setAssetRequestStatus(
  assetRequestId: string,
  newStatus: AssetRequestStatus,
  updates: Partial<
    Pick<
      AssetRequest,
      | "lastError"
      | "generatedImageUrl"
      | "wordpressMediaId"
      | "wordpressMediaUrl"
      | "n8nWebhookSentAt"
      | "uploadedAt"
      | "fileSize"
      | "width"
      | "height"
    >
  > = {}
): AssetRequest | undefined {
  const current = readCurrentAssetRequests();
  const existing = current.find((r) => r.assetRequestId === assetRequestId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: AssetRequest = { ...existing, ...updates, status: newStatus, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
