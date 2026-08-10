import * as fs from "fs";
import * as path from "path";
import { AutonomyLevel, AutonomyRiskLevel } from "./autonomy-policy";

/**
 * Notification Policy (Fase O8): decide CUANDO avisar a Pau (y por que
 * canal), no QUE se le permite al sistema auto-procesar — eso lo decide
 * la politica de autonomia (autonomy-policy.ts). Una accion puede estar
 * auto-aprobada para planificacion (AUTO_PLAN) y aun asi no generar
 * ningun aviso (NO_NOTIFICATION) porque preparar un plan no tiene
 * impacto real. Solo lo que prepararia/ejecutaria algo con impacto real
 * llega a interrumpir por Telegram.
 */

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "notification-policy.json");

export type NotificationLevel = "NO_NOTIFICATION" | "DAILY_SUMMARY_ONLY" | "INSTANT_APPROVAL_REQUIRED" | "BLOCKED";
export type NotificationChannel = "none" | "email_digest" | "telegram";
export type NotifiableSubjectKind = "action" | "work_order" | "change_pack" | "report" | "job" | "minor_warning";

export interface NotificationLevelConfig {
  label: string;
  channel: NotificationChannel;
  requiresResponse: boolean;
  description: string;
  actionTypePatterns?: string[];
  operations: string[];
}

export interface NotificationPolicyConfig {
  version: string;
  phase: string;
  updatedAt: string;
  description: string;
  defaultLevel: NotificationLevel;
  levels: Record<NotificationLevel, NotificationLevelConfig>;
  channels: Record<string, unknown>;
  howToChange: string;
}

/** Sin cache a proposito: relee config/notification-policy.json en cada llamada, igual que autonomy-policy.ts. */
export function loadNotificationPolicy(): NotificationPolicyConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as NotificationPolicyConfig;
}

export interface NotifiableSubject {
  subjectKind: NotifiableSubjectKind;
  autonomyLevel?: AutonomyLevel;
  riskLevel?: AutonomyRiskLevel;
  status?: string;
  actionType?: string;
}

export interface NotificationClassification {
  notificationLevel: NotificationLevel;
  channel: NotificationChannel;
  requiresResponse: boolean;
  reason: string;
}

function matchesAnyPattern(actionType: string | undefined, patterns: string[] | undefined): boolean {
  if (!actionType || !patterns) return false;
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? actionType.startsWith(pattern.slice(0, -1)) : actionType === pattern
  );
}

const WORK_ORDER_DIGEST_STATUSES = ["auto_prepared", "ready_for_review"];

function classificationFromLevel(level: NotificationLevel, config: NotificationLevelConfig, reason: string): NotificationClassification {
  return { notificationLevel: level, channel: config.channel, requiresResponse: config.requiresResponse, reason };
}

/**
 * Clasifica un "sujeto" (una accion, una work order, un warning...) segun
 * la politica de notificacion. Orden de evaluacion (lo mas restrictivo
 * gana primero, igual que en autonomy-policy.ts):
 *   1. BLOCKED — nunca se notifica, pase lo que pase.
 *   2. INSTANT_APPROVAL_REQUIRED — avisa ya, espera respuesta.
 *   3. DAILY_SUMMARY_ONLY — se menciona en el email, sin prisa.
 *   4. NO_NOTIFICATION — mecanica interna / planificacion de bajo riesgo.
 *   5. Fallback seguro configurado en defaultLevel.
 */
export function classifyNotification(subject: NotifiableSubject): NotificationClassification {
  const policy = loadNotificationPolicy();

  if (subject.autonomyLevel === "FORBIDDEN" || subject.riskLevel === "critical") {
    return classificationFromLevel(
      "BLOCKED",
      policy.levels.BLOCKED,
      "Nivel FORBIDDEN de la politica de autonomia o riskLevel critico: nunca se envia ningun aviso, por ningun canal."
    );
  }

  const instantConfig = policy.levels.INSTANT_APPROVAL_REQUIRED;
  if (
    subject.autonomyLevel === "HUMAN_APPROVAL_REQUIRED" ||
    subject.riskLevel === "high" ||
    matchesAnyPattern(subject.actionType, instantConfig.actionTypePatterns)
  ) {
    return classificationFromLevel(
      "INSTANT_APPROVAL_REQUIRED",
      instantConfig,
      "Nivel HUMAN_APPROVAL_REQUIRED, riskLevel alto, o actionType de impacto real (WordPress/Ads/GA4/GTM/formularios): requiere aprobacion explicita antes de preparar o ejecutar nada."
    );
  }

  const dailyConfig = policy.levels.DAILY_SUMMARY_ONLY;
  if (subject.subjectKind === "work_order" && subject.status && WORK_ORDER_DIGEST_STATUSES.includes(subject.status)) {
    return classificationFromLevel(
      "DAILY_SUMMARY_ONLY",
      dailyConfig,
      `Work order lista para revisar (status: ${subject.status}): se incluye en el resumen diario, no interrumpe con un aviso instantaneo.`
    );
  }
  if (subject.subjectKind === "change_pack" && subject.status === "ready_for_review") {
    return classificationFromLevel(
      "DAILY_SUMMARY_ONLY",
      dailyConfig,
      "Change pack listo para revisar (categoria reservada, todavia sin agentes que generen change packs reales): se incluiria en el resumen diario."
    );
  }
  if (subject.subjectKind === "minor_warning") {
    return classificationFromLevel("DAILY_SUMMARY_ONLY", dailyConfig, "Warning menor: se incluye en el resumen diario, no interrumpe.");
  }

  const noneConfig = policy.levels.NO_NOTIFICATION;
  if (subject.autonomyLevel === "AUTO_INTERNAL" || subject.autonomyLevel === "AUTO_PLAN") {
    return classificationFromLevel(
      "NO_NOTIFICATION",
      noneConfig,
      `Nivel ${subject.autonomyLevel} de la politica de autonomia: mecanica interna o planificacion de riesgo bajo/medio, no necesita ningun aviso.`
    );
  }
  if (subject.subjectKind === "report" || subject.subjectKind === "job") {
    return classificationFromLevel("NO_NOTIFICATION", noneConfig, "Informe o job interno: nunca genera notificacion.");
  }

  const fallbackConfig = policy.levels[policy.defaultLevel];
  return classificationFromLevel(
    policy.defaultLevel,
    fallbackConfig,
    `Sujeto no reconocido por ningun patron de la politica de notificacion. Se aplica el nivel por defecto "${policy.defaultLevel}" (seguro ante la duda).`
  );
}

export function shouldNotifyInstantly(subject: NotifiableSubject): boolean {
  return classifyNotification(subject).notificationLevel === "INSTANT_APPROVAL_REQUIRED";
}

export function isNotificationBlocked(subject: NotifiableSubject): boolean {
  return classifyNotification(subject).notificationLevel === "BLOCKED";
}
