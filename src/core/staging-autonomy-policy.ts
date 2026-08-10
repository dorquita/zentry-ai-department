import * as fs from "fs";
import * as path from "path";

/**
 * Staging Autonomy Policy (Fase O27) — decide, por `changeType` de un
 * change pack ya `approved_to_execute`, si el Staging Executor puede
 * aplicarlo sin esperar una aprobacion de Telegram POR EJECUCION (Carril
 * A: "ejecucion segura en staging"), o si sigue necesitando esa
 * aprobacion humana (cualquier changeType no reconocido, fail-safe).
 *
 * Esto es una politica DISTINTA de config/autonomy-policy.json (Fase O7):
 * esa decide si una ACCION del backlog puede convertirse en plan sin
 * aprobacion; esta decide si una EJECUCION REAL contra staging (crear/
 * actualizar un borrador, siempre `draft`, nunca publicar) puede
 * aplicarse sin esperar respuesta de Telegram. Nunca decide sobre
 * produccion — eso sigue exigiendo las 2 aprobaciones de Telegram de
 * production-deployment-planner.ts + production-draft-executor.ts, sin
 * excepcion, pase lo que pase con este fichero.
 *
 * Ver config/staging-autonomy-policy.json y docs/opportunity-states.md.
 */

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "staging-autonomy-policy.json");

export interface StagingAutonomyPolicyConfig {
  version: string;
  phase: string;
  updatedAt: string;
  description: string;
  defaultForUnknownChangeType: "requiresTelegramApproval";
  autoApproveInStaging: {
    enabled: boolean;
    reason: string;
    changeTypePatterns: string[];
  };
  guardrails: Record<string, unknown>;
  howToChange: string;
}

/**
 * Sin cache entre llamadas a proposito, mismo criterio que
 * src/core/autonomy-policy.ts: editar el JSON cambia el comportamiento en
 * la siguiente ejecucion sin recompilar nada.
 */
export function loadStagingAutonomyPolicy(): StagingAutonomyPolicyConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as StagingAutonomyPolicyConfig;
}

function matchesPattern(changeType: string, pattern: string): boolean {
  if (pattern.endsWith("*")) return changeType.startsWith(pattern.slice(0, -1));
  return changeType === pattern;
}

/**
 * `true` solo si autoApproveInStaging.enabled=true Y el changeType
 * coincide con alguno de sus patrones. Cualquier changeType no
 * reconocido, o la politica entera desactivada, cae al comportamiento
 * seguro de siempre (requiere aprobacion de Telegram por ejecucion) —
 * fail-safe por diseno, igual que defaultLevelForUnknownActionType en la
 * politica de autonomia general.
 */
export function canAutoApproveStagingExecution(changeType: string): { autoApprove: boolean; reason: string } {
  const policy = loadStagingAutonomyPolicy();
  if (!policy.autoApproveInStaging.enabled) {
    return { autoApprove: false, reason: "Politica de autonomia de staging (Carril A) desactivada (enabled=false) — requiere aprobacion de Telegram." };
  }
  const matched = policy.autoApproveInStaging.changeTypePatterns.some((p) => matchesPattern(changeType, p));
  if (!matched) {
    return { autoApprove: false, reason: `changeType "${changeType}" no esta en el Carril A (config/staging-autonomy-policy.json) — requiere aprobacion de Telegram.` };
  }
  return { autoApprove: true, reason: `changeType "${changeType}" esta en el Carril A: se aplica en staging sin esperar aprobacion diaria, con notificacion informativa por Telegram.` };
}
