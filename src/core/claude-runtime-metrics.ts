import { isRetriableFailureKind } from "./claude-runtime-failure-taxonomy";
import { ClaudeRuntimeHealthRecord } from "./claude-runtime-health";

/**
 * Metricas de FIABILIDAD del runtime comun, agregadas a partir de los
 * diagnosticos por invocacion (`claude-runtime-health.json`).
 *
 * Sirven para responder una pregunta concreta y medible en el tiempo:
 * "cual es el success rate del Claude employee runtime", por pasada,
 * por dia o por semana. En esta fase se publican como artifact JSON --
 * no hace falta base de datos todavia.
 *
 * FRONTERA: agrega hechos de ejecucion, nunca contenido de dominio.
 */

export interface ClaudeRuntimeReliabilityMetrics {
  /** Invocaciones del runtime (empleados ejecutados), no intentos. */
  runtimeInvocations: number;
  /** Invocaciones aceptadas SIN necesitar reintento. */
  successesFirstAttempt: number;
  /** Invocaciones que fallaron al primer intento y el reintento salvo. */
  recoveredByRetry: number;
  /** Invocaciones finalmente aceptadas (primer intento + recuperadas). */
  totalSuccesses: number;
  /** Fallos finales cuya clase es DETERMINISTA (no se reintentan a proposito). */
  deterministicFailures: number;
  /** Fallos finales cuya clase es TRANSITORIA (se reintentaron y aun asi fallaron). */
  transientFailures: number;
  /** Fallos finales de cualquier clase -- invocaciones sin salida utilizable. */
  unrecoveredRuntimeFailures: number;
  /** totalSuccesses / runtimeInvocations, redondeado a 4 decimales. null si no hubo invocaciones. */
  successRate: number | null;
  /** Numero total de intentos reales de Claude (>= runtimeInvocations). */
  totalAttempts: number;
  /** Reintentos realmente ejecutados. */
  retriesExecuted: number;
  /**
   * Reintentos EVITADOS por clasificacion determinista: fallos que un
   * "retry ciego" habria repetido y esta politica no repite. Es la
   * medida directa de lo que ahorra clasificar en vez de reintentar
   * todo.
   */
  retriesAvoidedByClassification: number;
  /** Desglose de fallos finales por clase. */
  failureKindBreakdown: Record<string, number>;
  cost: ClaudeRuntimeCostMetrics;
}

export interface ClaudeRuntimeCostMetrics {
  /**
   * Coste ESTIMADO, no facturado. Con autenticacion por suscripcion
   * (CLAUDE_CODE_OAUTH_TOKEN) no se corresponde con ningun cargo: es el
   * consumo equivalente a tarifa de lista que calcula Claude Code en
   * local, util para detectar pasadas anormalmente caras y para poner
   * numero a lo que cuesta el reintento.
   */
  firstAttemptUsd: number | null;
  retryUsd: number | null;
  totalUsd: number | null;
  /** Coste estimado que se habria gastado reintentando los fallos deterministas. */
  estimatedUsdAvoidedByClassification: number | null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length === 0 ? null : round(present.reduce((sum, value) => sum + value, 0), 6);
}

export function aggregateClaudeRuntimeMetrics(records: ClaudeRuntimeHealthRecord[]): ClaudeRuntimeReliabilityMetrics {
  const runtimeInvocations = records.length;

  const accepted = records.filter((record) => record.validationStatus === "accepted");
  const successesFirstAttempt = accepted.filter((record) => !record.recovered).length;
  const recoveredByRetry = accepted.filter((record) => record.recovered).length;

  const failed = records.filter((record) => record.validationStatus !== "accepted");
  const deterministicFailures = failed.filter((record) => record.failureKind !== null && !isRetriableFailureKind(record.failureKind)).length;
  const transientFailures = failed.length - deterministicFailures;

  const failureKindBreakdown: Record<string, number> = {};
  for (const record of failed) {
    const kind = record.failureKind ?? "unknown_runtime_failure";
    failureKindBreakdown[kind] = (failureKindBreakdown[kind] ?? 0) + 1;
  }

  const totalAttempts = records.reduce((sum, record) => sum + record.attemptCount, 0);
  const retriesExecuted = records.reduce((sum, record) => sum + Math.max(0, record.attemptCount - 1), 0);

  // Un fallo determinista es exactamente un reintento que un "retry
  // ciego" habria hecho y esta politica NO hace.
  const retriesAvoidedByClassification = deterministicFailures;

  const firstAttemptCosts = records.map((record) => record.attempts.find((attempt) => attempt.attempt === 1)?.costUsd ?? null);
  const retryCosts = records.flatMap((record) => record.attempts.filter((attempt) => attempt.attempt > 1).map((attempt) => attempt.costUsd ?? null));

  const firstAttemptUsd = sumOrNull(firstAttemptCosts);
  const retryUsd = sumOrNull(retryCosts);
  const totalUsd = sumOrNull([firstAttemptUsd, retryUsd]);

  // Coste medio de un intento, usado para estimar lo que habrian
  // costado los reintentos que la clasificacion evito.
  const measuredAttemptCosts = records.flatMap((record) => record.attempts.map((attempt) => attempt.costUsd)).filter((cost): cost is number => typeof cost === "number");
  const averageAttemptUsd = measuredAttemptCosts.length > 0 ? measuredAttemptCosts.reduce((sum, cost) => sum + cost, 0) / measuredAttemptCosts.length : null;

  return {
    runtimeInvocations,
    successesFirstAttempt,
    recoveredByRetry,
    totalSuccesses: accepted.length,
    deterministicFailures,
    transientFailures,
    unrecoveredRuntimeFailures: failed.length,
    successRate: runtimeInvocations === 0 ? null : round(accepted.length / runtimeInvocations, 4),
    totalAttempts,
    retriesExecuted,
    retriesAvoidedByClassification,
    failureKindBreakdown,
    cost: {
      firstAttemptUsd,
      retryUsd,
      totalUsd,
      estimatedUsdAvoidedByClassification: averageAttemptUsd === null ? null : round(averageAttemptUsd * retriesAvoidedByClassification, 6),
    },
  };
}

/** Resumen de una linea, apto para GitHub Step Summary y para el log. */
export function formatMetricsSummary(metrics: ClaudeRuntimeReliabilityMetrics): string {
  const rate = metrics.successRate === null ? "n/a" : `${round(metrics.successRate * 100, 2)}%`;
  return [
    `invocaciones=${metrics.runtimeInvocations}`,
    `exito_1er_intento=${metrics.successesFirstAttempt}`,
    `recuperadas_por_reintento=${metrics.recoveredByRetry}`,
    `fallos_deterministas=${metrics.deterministicFailures}`,
    `fallos_transitorios_no_recuperados=${metrics.transientFailures}`,
    `success_rate=${rate}`,
    `coste_estimado_total=${metrics.cost.totalUsd ?? "n/a"}`,
  ].join(" ");
}
