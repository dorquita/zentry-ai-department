import * as fs from "fs";
import * as path from "path";
import { WORDPRESS_DRAFT_STATUSES, WordpressDraft, WordpressDraftStatus } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * WordPress Draft Registry: convierte un change pack ya listo en un
 * borrador seguro. Primero SIEMPRE un `local_preview` (fichero markdown,
 * cero llamadas a WordPress). Solo pasa a `wp_draft_created` si
 * WORDPRESS_DRAFTS_ENABLED=true, el change pack esta `approved_to_execute`
 * y hay una aprobacion de Telegram explicita para ESE borrador concreto
 * (ver src/agents/wordpress-draft-agent.ts). Ningun estado de este
 * registro publica nada — ni siquiera `wp_draft_created` (sigue siendo
 * `status: draft` dentro de WordPress).
 *
 * data/wordpress-drafts.jsonl es un log append-only de instantaneas,
 * mismo patron que change-packs.jsonl. El estado actual es su instantanea
 * mas reciente. No hay fichero de auditoria aparte: el propio historico
 * de instantaneas ya reconstruye toda la historia de un draft.
 */

const DATA_DIR = resolveActiveClientPaths().dataDir;
const WORDPRESS_DRAFTS_FILE = path.join(DATA_DIR, "wordpress-drafts.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function appendSnapshot(draft: WordpressDraft): void {
  ensureDataDir();
  fs.appendFileSync(WORDPRESS_DRAFTS_FILE, JSON.stringify(draft) + "\n", "utf-8");
}

export function readAllWordpressDraftSnapshots(): WordpressDraft[] {
  if (!fs.existsSync(WORDPRESS_DRAFTS_FILE)) return [];
  const raw = fs.readFileSync(WORDPRESS_DRAFTS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as WordpressDraft);
}

/** Reduce el log append-only al estado ACTUAL: la instantanea mas reciente de cada draftId. */
export function readCurrentWordpressDrafts(): WordpressDraft[] {
  const byId = new Map<string, WordpressDraft>();
  for (const snapshot of readAllWordpressDraftSnapshots()) {
    byId.set(snapshot.draftId, snapshot);
  }
  return [...byId.values()];
}

export function findWordpressDraftById(draftId: string): WordpressDraft | undefined {
  return readCurrentWordpressDrafts().find((d) => d.draftId === draftId);
}

/**
 * Dedup: un change pack nunca tiene mas de un draft activo. Igual que
 * change-packs.ts deduplica por workOrderId.
 */
export function findWordpressDraftByChangePackId(changePackId: string, current: WordpressDraft[]): WordpressDraft | undefined {
  return current.find((d) => d.changePackId === changePackId);
}

export function getWordpressDraftsFilePath(): string {
  return WORDPRESS_DRAFTS_FILE;
}

export function isValidWordpressDraftStatus(value: string): value is WordpressDraftStatus {
  return (WORDPRESS_DRAFT_STATUSES as string[]).includes(value);
}

export interface CreateLocalPreviewInput {
  // Generado por quien llama (wordpress-draft-agent.ts) ANTES de invocar
  // esta funcion, porque el nombre del fichero de preview (localPreviewPath)
  // tiene que incluir el draftId y el fichero se escribe antes de tocar el
  // registro. Evita una escritura en dos fases (crear registro sin ruta,
  // luego actualizar con la ruta).
  draftId: string;
  changePackId: string;
  workOrderId: string;
  targetBrand: WordpressDraft["targetBrand"];
  page?: string;
  keyword: string;
  draftType: string;
  localPreviewPath: string;
}

export interface UpsertLocalPreviewResult {
  draft: WordpressDraft;
  isNew: boolean;
}

/**
 * Crea un draft `local_preview` nuevo para un change pack que todavia no
 * tiene uno (dedup por changePackId), o "toca" el existente
 * (solo `updatedAt`, nunca regenera el preview ya escrito) si ya lo
 * tenia. Nunca llama a WordPress: escribir el fichero de preview es
 * responsabilidad de quien llama (wordpress-draft-agent.ts), ANTES de
 * invocar esta funcion.
 */
export function upsertLocalPreviewDraft(input: CreateLocalPreviewInput, current: WordpressDraft[]): UpsertLocalPreviewResult {
  const existing = findWordpressDraftByChangePackId(input.changePackId, current);
  if (existing) {
    const touched: WordpressDraft = { ...existing, updatedAt: new Date().toISOString() };
    appendSnapshot(touched);
    const idx = current.indexOf(existing);
    current[idx] = touched;
    return { draft: touched, isNew: false };
  }

  const now = new Date().toISOString();
  const draft: WordpressDraft = {
    draftId: input.draftId,
    changePackId: input.changePackId,
    workOrderId: input.workOrderId,
    targetBrand: input.targetBrand,
    page: input.page,
    keyword: input.keyword,
    draftType: input.draftType,
    status: "local_preview",
    localPreviewPath: input.localPreviewPath,
    createdAt: now,
    updatedAt: now,
  };
  appendSnapshot(draft);
  current.push(draft);
  return { draft, isNew: true };
}

/**
 * Promueve un draft `local_preview` a `wp_draft_created` tras crear de
 * verdad el borrador en WordPress (ver src/adapters/wordpress.ts). Solo
 * debe llamarse despues de una respuesta de exito real de la API — nunca
 * de forma optimista.
 */
export function promoteWordpressDraftCreated(
  draftId: string,
  wordpressDraftId: number,
  wordpressDraftUrl: string
): WordpressDraft | undefined {
  const current = readCurrentWordpressDrafts();
  const existing = current.find((d) => d.draftId === draftId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: WordpressDraft = {
    ...existing,
    status: "wp_draft_created",
    wordpressDraftId,
    wordpressDraftUrl,
    updatedAt: now,
  };
  appendSnapshot(updated);
  return updated;
}

/**
 * Cambia el status de un draft (usado internamente por el agente para
 * marcar `rejected` cuando la solicitud de Telegram asociada se rechaza).
 * Nunca ejecuta ni deshace nada real: si el draft ya habia llegado a
 * `wp_draft_created`, el borrador (sin publicar) sigue existiendo en
 * WordPress hasta que alguien lo gestione manualmente ahi.
 */
export function setWordpressDraftStatus(draftId: string, newStatus: WordpressDraftStatus): WordpressDraft | undefined {
  const current = readCurrentWordpressDrafts();
  const existing = current.find((d) => d.draftId === draftId);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const updated: WordpressDraft = { ...existing, status: newStatus, updatedAt: now };
  appendSnapshot(updated);
  return updated;
}
