import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Fase O49 — vigia de credenciales.
 *
 * Antes de esta fase, un `invalid_grant` de un refresh token OAuth
 * caducado (Search Console, GA4, GTM, Google Ads) solo dejaba rastro en
 * los logs del servidor (journalctl) — nadie lo veia hasta que alguien
 * entraba a mirar. Ocurrio de verdad entre el 10 y el 13 de agosto de
 * 2026: GA4/GTM fallaron 4 dias seguidos sin que el informe diario lo
 * mencionara nunca.
 *
 * `recordCredentialFailure`/`recordCredentialSuccess` dejan un rastro
 * append-only (mismo patron snapshot que action-backlog.ts) en
 * `data/credential-health.jsonl`, con la fecha del PRIMER fallo de la
 * racha actual (para poder calcular antigüedad real) y el comando exacto
 * para arreglarlo. `readActiveCredentialFailures()` lo consume el
 * informe ejecutivo (Fase O49, ver executive-report.ts) para escalarlo
 * como bloqueo real desde el primer dia, no despues de que se acumulen
 * varios.
 */

export type CredentialService = "search_console" | "ga4" | "gtm" | "google_ads";

export interface CredentialHealthSnapshot {
  service: CredentialService;
  status: "failing" | "recovered";
  firstFailedAt: string | null;
  lastFailedAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  fixCommand: string;
  note: string;
  recordedAt: string;
}

const FIX_COMMANDS: Record<CredentialService, string> = {
  search_console: "npm run auth:gsc",
  ga4: "npm run auth:analytics",
  gtm: "npm run auth:analytics",
  google_ads: "npm run auth:google-ads",
};

const OAUTH_TESTING_NOTE =
  "Si vuelve a fallar de nuevo pasados ~7 dias tras cada re-autenticacion, es probable que la app OAuth de Google Cloud Console siga en modo Testing (los refresh tokens de apps en Testing caducan a los 7 dias) — revisar y publicar la app a Produccion para que deje de caducar solo.";

function resolveFilePath(): string {
  const dataDir = resolveActiveClientPaths().dataDir;
  return path.join(dataDir, "credential-health.jsonl");
}

function readLatestByService(): Partial<Record<CredentialService, CredentialHealthSnapshot>> {
  const filePath = resolveFilePath();
  if (!fs.existsSync(filePath)) return {};
  const lines = fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const latest: Partial<Record<CredentialService, CredentialHealthSnapshot>> = {};
  for (const line of lines) {
    const snapshot = JSON.parse(line) as CredentialHealthSnapshot;
    latest[snapshot.service] = snapshot;
  }
  return latest;
}

function append(snapshot: CredentialHealthSnapshot): void {
  const filePath = resolveFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(snapshot) + "\n", "utf-8");
}

/**
 * Registra un fallo. Si ya habia una racha de fallos abierta para este
 * servicio, mantiene `firstFailedAt` original (asi la antigüedad real del
 * bloqueo se puede calcular sin ambigüedad) y suma 1 a
 * `consecutiveFailures`. El mensaje de error que se pase aqui DEBE venir
 * ya saneado (sin credenciales) por el propio adapter, igual que ya hacen
 * hoy con `sanitizeError()`/`logger.error()`.
 */
export function recordCredentialFailure(service: CredentialService, sanitizedError: string): void {
  const latest = readLatestByService()[service];
  const now = new Date().toISOString();
  const alreadyFailing = latest?.status === "failing";
  append({
    service,
    status: "failing",
    firstFailedAt: alreadyFailing ? latest!.firstFailedAt ?? latest!.recordedAt : now,
    lastFailedAt: now,
    consecutiveFailures: alreadyFailing ? latest!.consecutiveFailures + 1 : 1,
    lastError: sanitizedError,
    fixCommand: FIX_COMMANDS[service],
    note: OAUTH_TESTING_NOTE,
    recordedAt: now,
  });
}

/**
 * Registra una recuperacion. Escribe una instantanea "recovered" SOLO si
 * habia una racha de fallos abierta — evita ruido de escribir en cada
 * exito cuando todo ya iba bien.
 */
export function recordCredentialSuccess(service: CredentialService): void {
  const latest = readLatestByService()[service];
  if (!latest || latest.status !== "failing") return;
  const now = new Date().toISOString();
  append({
    service,
    status: "recovered",
    firstFailedAt: null,
    lastFailedAt: null,
    consecutiveFailures: 0,
    lastError: null,
    fixCommand: FIX_COMMANDS[service],
    note: "",
    recordedAt: now,
  });
}

/** Solo los servicios con una racha de fallos abierta ahora mismo. */
export function readActiveCredentialFailures(): CredentialHealthSnapshot[] {
  return Object.values(readLatestByService()).filter(
    (snapshot): snapshot is CredentialHealthSnapshot => snapshot?.status === "failing"
  );
}

const SERVICE_LABELS: Record<CredentialService, string> = {
  search_console: "Search Console",
  ga4: "GA4",
  gtm: "GTM",
  google_ads: "Google Ads",
};

/**
 * Linea lista para el informe ejecutivo (seccion "Bloqueos reales"):
 * edad real desde el primer fallo, comando exacto para arreglarlo,
 * responsable siempre "Pau" (esto no lo puede resolver el sistema solo).
 */
export function describeCredentialFailure(snapshot: CredentialHealthSnapshot, nowISO: string): string {
  const label = SERVICE_LABELS[snapshot.service];
  const days = snapshot.firstFailedAt
    ? Math.max(0, Math.floor((new Date(nowISO).getTime() - new Date(snapshot.firstFailedAt).getTime()) / 86_400_000))
    : 0;
  const ageText = days === 0 ? "desde hoy" : days === 1 ? "desde hace 1 dia" : `desde hace ${days} dias`;
  return `Credenciales de ${label} fallando (${snapshot.consecutiveFailures} intento(s) seguido(s), ${ageText}) — depende de Pau: ejecutar \`${snapshot.fixCommand}\`. ${snapshot.note}`.trim();
}
