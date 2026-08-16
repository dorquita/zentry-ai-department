import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { resolveActiveClientPaths } from "./client-paths";
import { ExecutionPath } from "./execute-php-operations";

/**
 * AUDIT TRAIL del fallback `execute-php`.
 *
 * Log append-only, mismo patron que el resto de registros del proyecto.
 * Una escritura por PHP ejecutado (o intentado), con lo necesario para
 * responder despues a "quien ejecuto que, sobre que, y quedo bien".
 *
 * Que NO se guarda, y por que:
 *
 * - NUNCA un secreto, ni el valor de ninguna variable de entorno.
 * - NUNCA el PHP completo. El PHP lleva incrustado el contenido nuevo, y
 *   ese contenido puede ser cualquier cosa; guardar el codigo entero en
 *   un fichero versionado convierte el log en un sitio donde puede
 *   acabar informacion que no deberia estar ahi. Se guarda el TIPO de
 *   operacion (normalizado, de un catalogo cerrado) y el SHA-256 del
 *   PHP, que es suficiente para probar que se ejecuto exactamente el
 *   codigo que las plantillas generan y para correlacionarlo con una
 *   reproduccion posterior.
 * - Tampoco el contenido antes/despues: se guardan sus hashes. Si hiciera
 *   falta el texto, esta en el snapshot del cambio, que es el sitio que
 *   ya existe para eso.
 */

const FILE_NAME = "execute-php-audit.jsonl";

export const EXECUTE_PHP_AUDIT_CONTRACT_VERSION = "execute-php-audit/v1";

/** Resultado final de un intento, en vocabulario cerrado. */
export type ExecutePhpAuditOutcome =
  | "blocked_by_guard"
  | "applied"
  | "validation_failed"
  | "rolled_back"
  | "rollback_failed"
  | "failed";

export interface ExecutePhpAuditRecord {
  contractVersion: string;
  auditId: string;
  at: string;
  departmentRunId: string;
  recommendationId: string;
  changeId: string;
  actor: string;
  /** Ability REAL invocada (nunca el nombre generico del tool MCP). */
  ability: string;
  executionPath: ExecutionPath;
  /** Ability nativa que existia para esta operacion, si la habia. */
  nativeAbilityConsidered: string | null;
  /** Por que se eligio ese camino. */
  capabilityReason: string;
  environment: string;
  /** Tipo de operacion, del catalogo cerrado. Nunca texto libre. */
  operation: string;
  target: string;
  /** SHA-256 del PHP ejecutado. El PHP completo NO se guarda. */
  phpSha256: string;
  beforeHash: string | null;
  afterHash: string | null;
  validation: string;
  rollback: string;
  outcome: ExecutePhpAuditOutcome;
  detail: string;
}

export function getExecutePhpAuditFilePath(dataDir?: string): string {
  return path.join(dataDir ?? resolveActiveClientPaths().dataDir, FILE_NAME);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Nombres de variables cuyo VALOR nunca puede aparecer en un registro.
 * Se comprueba de verdad antes de escribir: un audit trail que filtra un
 * secreto es peor que no tenerlo.
 */
const SENSITIVE_VARS = [
  "WP_API_PASSWORD",
  "WP_API_USERNAME",
  "WP_API_URL",
  "WORDPRESS_APP_PASSWORD",
  "SMTP_PASS",
  "SMTP_USER",
  "TELEGRAM_BOT_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
];

/**
 * Devuelve el NOMBRE de la primera variable sensible cuyo valor aparece
 * en el texto, o `null`. Solo el nombre: el valor jamas se propaga.
 */
export function findSecretLeak(text: string, env: Record<string, string | undefined> = process.env): string | null {
  for (const name of SENSITIVE_VARS) {
    const value = (env[name] ?? "").trim();
    // Valores muy cortos producirian falsos positivos constantes.
    if (value.length >= 8 && text.includes(value)) return name;
  }
  return null;
}

export function appendExecutePhpAudit(record: ExecutePhpAuditRecord, filePath: string = getExecutePhpAuditFilePath()): ExecutePhpAuditRecord {
  const line = JSON.stringify(record);
  const leak = findSecretLeak(line);
  if (leak) {
    throw new Error(`No se escribe el audit trail: el registro contiene el valor de la variable sensible ${leak}. Esto nunca debe ocurrir.`);
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, line + "\n", "utf-8");
  return record;
}

export function readExecutePhpAudit(filePath: string = getExecutePhpAuditFilePath()): ExecutePhpAuditRecord[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ExecutePhpAuditRecord);
}

export function buildAuditId(changeId: string, at: string, phpSha256: string): string {
  return `${changeId}#php-${phpSha256.slice(0, 12)}-${at}`;
}
