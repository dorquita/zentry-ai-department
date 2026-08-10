/**
 * Fase O16 / O16.1 — resuelve donde viviria data/reports/logs de cada
 * cliente.
 *
 * Regla de compatibilidad, deliberada: "zentry" sigue apuntando a las
 * carpetas historicas de la raiz del proyecto (data/, reports/, logs/),
 * NUNCA a clients/zentry/data/ — ahi es donde ya vive todo el historico
 * real (jobs.jsonl, action-backlog.jsonl, etc., ver [[project_zentry_ai_department]]
 * en la memoria del asistente) y moverlo seria una migracion destructiva
 * que el cliente pidio explicitamente evitar. Desde la Fase O16.1, los
 * ficheros de `src/core` y `src/agents` que antes definian su propio
 * `DATA_DIR`/`REPORTS_DIR`/`LOGS_DIR` (path.join(__dirname, "..", "..",
 * "data")) usan `resolveActiveClientPaths()` de aqui en su lugar — para
 * "zentry" (el cliente activo por defecto) resuelve exactamente a las
 * mismas rutas de siempre, asi que el comportamiento no cambia para
 * nadie que no pase `--client`/`CLIENT_ID` explicitamente.
 */
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_CLIENT_ID, resolveClientId } from "./client-config";

const PROJECT_ROOT = path.join(__dirname, "..", "..");

export interface ClientPaths {
  clientDir: string;
  dataDir: string;
  reportsDir: string;
  logsDir: string;
  usesLegacyRootPaths: boolean;
}

export function resolveClientPaths(clientId: string): ClientPaths {
  const clientDir = path.join(PROJECT_ROOT, "clients", clientId);

  if (clientId === DEFAULT_CLIENT_ID) {
    return {
      clientDir,
      dataDir: path.join(PROJECT_ROOT, "data"),
      reportsDir: path.join(PROJECT_ROOT, "reports"),
      logsDir: path.join(PROJECT_ROOT, "logs"),
      usesLegacyRootPaths: true,
    };
  }

  return {
    clientDir,
    dataDir: path.join(clientDir, "data"),
    reportsDir: path.join(clientDir, "reports"),
    logsDir: path.join(clientDir, "logs"),
    usesLegacyRootPaths: false,
  };
}

/**
 * Crea (si hace falta) las carpetas data/reports/logs de un cliente NO
 * legacy. Nunca se llama para "zentry" (usesLegacyRootPaths=true) — esa
 * rama nunca crea ni toca directorios, solo los referencia de lectura.
 * Idempotente: si ya existen, no hace nada.
 */
export function ensureClientDirsExist(clientId: string): ClientPaths {
  const paths = resolveClientPaths(clientId);
  if (paths.usesLegacyRootPaths) {
    return paths;
  }
  for (const dir of [paths.dataDir, paths.reportsDir, paths.logsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return paths;
}

let cachedActivePaths: ClientPaths | null = null;

/**
 * Fase O16.1 — resuelve las carpetas data/reports/logs del cliente
 * ACTIVO del proceso actual (via `resolveClientId()`: `--client` /
 * `CLIENT_ID` / fallback fijo "zentry"), memoizado una sola vez por
 * proceso (Node ya cachea el modulo que la llama a nivel de import, asi
 * que en la practica cada fichero solo la invoca una vez de todas
 * formas — el cache de aqui evita ademas recalcular si varios modulos
 * la llaman en el mismo arranque).
 *
 * Punto de entrada compartido que usan los registros/agentes que antes
 * hardcodeaban su propio `DATA_DIR`/`REPORTS_DIR`/`LOGS_DIR` relativo a
 * `__dirname`. NUNCA crea directorios (a diferencia de
 * `ensureClientDirsExist`) — para "zentry" las carpetas ya existen
 * siempre (son las historicas de la raiz); para otros clientes, quien
 * necesite escribir de verdad debe llamar a `ensureClientDirsExist`
 * primero (como ya hace el paso de dry-run del orquestador).
 */
export function resolveActiveClientPaths(): ClientPaths {
  if (cachedActivePaths) {
    return cachedActivePaths;
  }
  cachedActivePaths = resolveClientPaths(resolveClientId());
  return cachedActivePaths;
}
