import * as fs from "fs";
import * as path from "path";
import { ActionStatus } from "./types";

/**
 * Autonomy Policy (Fase O7): decide, por `actionType` del Action Backlog,
 * si el sistema puede auto-procesar o auto-preparar-para-planificacion
 * una accion sin esperar aprobacion humana, o si tiene que esperar.
 *
 * Nunca decide sobre ejecucion real en produccion — eso sigue sin existir
 * en este sistema (no hay modo APPLY). Solo decide el ESTADO local de una
 * accion/work order (Action Backlog / Work Order Registry), igual que
 * antes de esta fase.
 */

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "autonomy-policy.json");

export type AutonomyLevel = "AUTO_INTERNAL" | "AUTO_PLAN" | "AUTO_DRAFT" | "HUMAN_APPROVAL_REQUIRED" | "FORBIDDEN";
export type AutonomyRiskLevel = "none" | "low_medium" | "medium" | "high" | "critical";

export interface AutonomyLevelConfig {
  label: string;
  riskLevel: AutonomyRiskLevel;
  enabled: boolean;
  requiresApproval: boolean;
  backlogStatus: ActionStatus;
  description: string;
  operations: string[];
  actionTypePatterns: string[];
}

export interface AutonomyPolicyConfig {
  version: string;
  phase: string;
  updatedAt: string;
  description: string;
  defaultLevelForUnknownActionType: AutonomyLevel;
  levels: Record<AutonomyLevel, AutonomyLevelConfig>;
  guardrails: Record<string, unknown>;
  howToChange: string;
}

export interface AutonomyClassification {
  autonomyLevel: AutonomyLevel;
  allowed: boolean;
  requiresApproval: boolean;
  riskLevel: AutonomyRiskLevel;
  reason: string;
  backlogStatus: ActionStatus;
}

/**
 * Sin cache entre llamadas a proposito: la politica se lee del disco cada
 * vez, asi que editar config/autonomy-policy.json cambia el comportamiento
 * en la siguiente ejecucion, sin recompilar ni reiniciar nada persistente
 * (los scripts de este proyecto son procesos de un solo uso via ts-node).
 */
export function loadAutonomyPolicy(): AutonomyPolicyConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as AutonomyPolicyConfig;
}

function matchesAnyPattern(actionType: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? actionType.startsWith(pattern.slice(0, -1)) : actionType === pattern
  );
}

// Orden de evaluacion: lo mas restrictivo gana primero. Un actionType que
// (por error de configuracion) coincidiera con dos niveles a la vez nunca
// se resuelve hacia el mas permisivo.
const EVALUATION_ORDER: AutonomyLevel[] = [
  "FORBIDDEN",
  "HUMAN_APPROVAL_REQUIRED",
  "AUTO_DRAFT",
  "AUTO_PLAN",
  "AUTO_INTERNAL",
];

export interface ClassifiableAction {
  actionType: string;
}

export function classifyActionAutonomy(action: ClassifiableAction): AutonomyClassification {
  const policy = loadAutonomyPolicy();

  for (const level of EVALUATION_ORDER) {
    const config = policy.levels[level];
    if (!config || !matchesAnyPattern(action.actionType, config.actionTypePatterns)) continue;

    if (!config.enabled) {
      // Nivel definido pero desactivado (hoy: AUTO_DRAFT): cae al nivel
      // seguro por defecto, nunca se auto-ejecuta ni se auto-prepara.
      const fallback = policy.levels.HUMAN_APPROVAL_REQUIRED;
      return {
        autonomyLevel: "HUMAN_APPROVAL_REQUIRED",
        allowed: true,
        requiresApproval: true,
        riskLevel: fallback.riskLevel,
        reason: `actionType "${action.actionType}" coincide con el nivel "${level}" (${config.label}), pero ese nivel esta desactivado (enabled:false) en esta fase. Cae a HUMAN_APPROVAL_REQUIRED por seguridad.`,
        backlogStatus: fallback.backlogStatus,
      };
    }

    return {
      autonomyLevel: level,
      allowed: level !== "FORBIDDEN",
      requiresApproval: config.requiresApproval,
      riskLevel: config.riskLevel,
      reason: `actionType "${action.actionType}" coincide con el nivel "${level}" (${config.label}).`,
      backlogStatus: config.backlogStatus,
    };
  }

  const fallbackLevel = policy.defaultLevelForUnknownActionType;
  const fallbackConfig = policy.levels[fallbackLevel];
  return {
    autonomyLevel: fallbackLevel,
    allowed: fallbackLevel !== "FORBIDDEN",
    requiresApproval: fallbackConfig.requiresApproval,
    riskLevel: fallbackConfig.riskLevel,
    reason: `actionType "${action.actionType}" no coincide con ningun patron conocido. Se aplica el nivel por defecto "${fallbackLevel}" (seguro: exige aprobacion humana ante cualquier tipo de accion nuevo/no clasificado).`,
    backlogStatus: fallbackConfig.backlogStatus,
  };
}

export function canAutoPlan(action: ClassifiableAction): boolean {
  const classification = classifyActionAutonomy(action);
  return classification.allowed && classification.autonomyLevel === "AUTO_PLAN";
}

export function requiresHumanApproval(action: ClassifiableAction): boolean {
  return classifyActionAutonomy(action).requiresApproval;
}

export function isForbidden(action: ClassifiableAction): boolean {
  return classifyActionAutonomy(action).autonomyLevel === "FORBIDDEN";
}
