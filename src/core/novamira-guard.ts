import * as fs from "fs";
import * as path from "path";
import { resolveWordpressEnv } from "../adapters/wordpress-backend";

/**
 * Novamira MCP Guard (Fase O14) — capa de seguridad/allowlist para el
 * MCP de Novamira, que declara explicitamente "unrestricted control
 * over this WordPress installation" (execute-php, run-wp-cli,
 * write-file, edit-file, delete-file, create-admin-access-link, entre
 * otras 24 abilities mas). Este modulo es el UNICO sitio del proyecto
 * que decide si una ability de Novamira puede invocarse desde codigo
 * automatico -- ningun adaptador/agente debe llamar a una ability de
 * Novamira sin pasar antes por `assertNovamiraAbilityAllowed()` (o
 * `isNovamiraAbilityAllowed()` si solo se necesita inspeccionar sin
 * lanzar).
 *
 * Diseno fail-closed: cualquier ability que no aparezca en
 * config/novamira-allowlist.json (incluidas abilities nuevas que
 * Novamira anada en el futuro) se trata como `dangerous_forbidden` por
 * defecto -- nunca "permitida por no estar prohibida explicitamente".
 *
 * Cuatro niveles de riesgo (ver el propio JSON para la descripcion
 * completa de cada uno):
 *   - safe_read: siempre permitida, cualquier entorno, sin flag/aprobacion.
 *   - safe_write_staging_only: requiere WORDPRESS_ENV=staging +
 *     NOVAMIRA_STAGING_WRITES_ENABLED=true + (si la ability concreta
 *     tiene requiresApproval:true) una aprobacion humana ya concedida.
 *     Bloqueada SIEMPRE en produccion, sin excepcion.
 *   - dangerous_forbidden: bloqueada de forma incondicional, para
 *     siempre, desde el pipeline automatico. Ninguna combinacion de
 *     flags/entorno/aprobacion la desbloquea.
 *   - manual_only: igual de bloqueada que dangerous_forbidden desde el
 *     punto de vista de este guard (un humano SI puede seguir usandola
 *     directamente en un chat con Novamira, fuera de este codebase).
 *
 * Nada en este modulo ejecuta ninguna ability de verdad -- es
 * unicamente la capa de decision. La invocacion real (si algun dia
 * existe un cliente MCP conectado desde Node) vive en
 * src/adapters/novamira-mcp-client.ts, que llama a este guard primero.
 */

export type NovamiraRiskLevel = "safe_read" | "safe_write_staging_only" | "dangerous_forbidden" | "manual_only";

const ALLOWLIST_PATH = path.join(__dirname, "..", "..", "config", "novamira-allowlist.json");

interface NovamiraAbilityConfig {
  risk: NovamiraRiskLevel;
  reason: string;
  requiresApproval?: boolean;
}

interface NovamiraAllowlistFile {
  defaultRiskForUnknownAbility: NovamiraRiskLevel;
  abilities: Record<string, NovamiraAbilityConfig>;
}

/**
 * Sin cache, relee el JSON en cada llamada -- mismo patron que
 * src/core/autonomy-policy.ts, para que un cambio en el fichero de
 * politica se refleje de inmediato sin reiniciar ningun proceso.
 */
function loadAllowlist(): NovamiraAllowlistFile {
  const raw = fs.readFileSync(ALLOWLIST_PATH, "utf-8");
  return JSON.parse(raw) as NovamiraAllowlistFile;
}

/** Nombre normalizado (minusculas, sin espacios) para comparar de forma tolerante. */
function normalizeAbilityName(abilityName: string): string {
  return abilityName.trim().toLowerCase();
}

function getAbilityConfig(abilityName: string): { config: NovamiraAbilityConfig | undefined; defaultRisk: NovamiraRiskLevel } {
  const allowlist = loadAllowlist();
  const normalized = normalizeAbilityName(abilityName);
  const match = Object.entries(allowlist.abilities).find(([name]) => normalizeAbilityName(name) === normalized);
  return { config: match?.[1], defaultRisk: allowlist.defaultRiskForUnknownAbility };
}

/**
 * Clasifica una ability segun config/novamira-allowlist.json. Cualquier
 * ability no listada devuelve el `defaultRiskForUnknownAbility` del
 * propio fichero (hoy "dangerous_forbidden") -- nunca "permitida".
 */
export function classifyNovamiraAbility(abilityName: string): NovamiraRiskLevel {
  const { config, defaultRisk } = getAbilityConfig(abilityName);
  return config?.risk ?? defaultRisk;
}

/**
 * Igual que `(process.env.NOVAMIRA_STAGING_WRITES_ENABLED ?? "").trim()
 * === "true"` -- funcion propia (en vez de leer el env var inline en
 * cada sitio) para que exista un unico punto de verdad, igual que
 * `isProductionExecutionEnabled()` en wordpress-production.ts. Hoy
 * (Fase O14) esta variable no existe en ningun `.env` real -- ver
 * .env.example.
 */
export function isNovamiraStagingWritesEnabled(): boolean {
  return (process.env.NOVAMIRA_STAGING_WRITES_ENABLED ?? "").trim().toLowerCase() === "true";
}

export interface NovamiraGuardContext {
  /**
   * Solo relevante para abilities `safe_write_staging_only` con
   * `requiresApproval:true` en el JSON (p.ej. gutenberg-write-content,
   * gutenberg-enable-batch-finalization). El propio guard NUNCA
   * consulta el registro de aprobaciones por si solo -- quien llama
   * debe haber verificado ya una ApprovalRequest real con
   * `relatedType: "novamira_staging_write"` y `status: "approved"`
   * (ver src/core/approval-requests.ts) y pasar el resultado aqui.
   * Por defecto `false` (nunca se asume aprobacion).
   */
  approvalGranted?: boolean;
}

export interface NovamiraGuardResult {
  allowed: boolean;
  risk: NovamiraRiskLevel;
  reason: string;
}

/**
 * Version pura (sin lanzar) de la decision del guard -- pensada para
 * tests y para que un llamante pueda decidir que hacer sin try/catch.
 * `assertNovamiraAbilityAllowed()` es la version que SI lanza, pensada
 * para integrarse directamente en un adaptador/agente real.
 */
export function isNovamiraAbilityAllowed(abilityName: string, context: NovamiraGuardContext = {}): NovamiraGuardResult {
  const { config, defaultRisk } = getAbilityConfig(abilityName);
  const risk = config?.risk ?? defaultRisk;

  if (!config) {
    return {
      allowed: false,
      risk,
      reason: `Ability "${abilityName}" no esta en config/novamira-allowlist.json -- tratada como "${defaultRisk}" por defecto (fail-closed). Anadela al allowlist explicitamente si de verdad se necesita.`,
    };
  }

  if (risk === "safe_read") {
    return { allowed: true, risk, reason: "Lectura segura -- siempre permitida." };
  }

  if (risk === "dangerous_forbidden") {
    return { allowed: false, risk, reason: `Bloqueada permanentemente: ${config.reason}` };
  }

  if (risk === "manual_only") {
    return {
      allowed: false,
      risk,
      reason: `Solo uso humano directo, nunca desde el pipeline automatico: ${config.reason}`,
    };
  }

  // risk === "safe_write_staging_only"
  let env: string;
  try {
    env = resolveWordpressEnv();
  } catch (err) {
    return {
      allowed: false,
      risk,
      reason: `No se pudo resolver WORDPRESS_ENV (${err instanceof Error ? err.message : String(err)}) -- bloqueada por seguridad.`,
    };
  }

  // Guardrail incondicional y redundante a proposito (mismo estilo que
  // assertWordpressWriteAllowed() en wordpress-backend.ts): produccion
  // esta bloqueada aunque el resto de condiciones se cumplieran.
  if (env === "production") {
    return {
      allowed: false,
      risk,
      reason: 'BLOQUEADO: WORDPRESS_ENV="production". Novamira nunca puede escribir en produccion desde el pipeline automatico, bajo ninguna circunstancia. Produccion solo usa REST controlado (src/adapters/wordpress-production.ts) con sus propios flags/snapshots/aprobaciones.',
    };
  }
  if (env !== "staging") {
    return { allowed: false, risk, reason: `Bloqueada: WORDPRESS_ENV="${env}" no es "staging".` };
  }
  if (!isNovamiraStagingWritesEnabled()) {
    return {
      allowed: false,
      risk,
      reason: 'Bloqueada: NOVAMIRA_STAGING_WRITES_ENABLED no esta activo (por defecto false/ausente).',
    };
  }
  if (config.requiresApproval && context.approvalGranted !== true) {
    return {
      allowed: false,
      risk,
      reason: `Bloqueada: esta ability requiere aprobacion humana explicita (relatedType "novamira_staging_write") y no se ha confirmado. ${config.reason}`,
    };
  }

  return { allowed: true, risk, reason: `Permitida: staging + NOVAMIRA_STAGING_WRITES_ENABLED=true${config.requiresApproval ? " + aprobacion humana confirmada" : ""}.` };
}

/**
 * Version que lanza -- integrarla al principio de cualquier funcion que
 * este a punto de invocar una ability de Novamira de verdad. Nunca deja
 * pasar una llamada no permitida.
 */
export function assertNovamiraAbilityAllowed(abilityName: string, context: NovamiraGuardContext = {}): void {
  const result = isNovamiraAbilityAllowed(abilityName, context);
  if (!result.allowed) {
    throw new Error(`Novamira MCP Guard: llamada bloqueada a "${abilityName}" (riesgo: ${result.risk}). ${result.reason}`);
  }
}
