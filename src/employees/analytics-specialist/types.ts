/**
 * Tipos de dominio del empleado Claude `analytics-specialist` -- ver
 * .claude/agents/analytics-specialist.md y docs/claude-employee-runtime.md.
 *
 * Espejo EXACTO de config/analytics-specialist-output.schema.json --
 * cualquier cambio en una de las dos partes debe ir acompanado del mismo
 * cambio en la otra en el mismo commit (ver
 * test/analytics-specialist-output-schema.test.ts, que verifica que no
 * hay deriva entre ambas capas, mismo patron que
 * test/landing-architect-v2-output-schema.test.ts).
 */

/**
 * Distincion epistemica obligatoria para CADA hallazgo que produce el
 * subagente (ver mision en .claude/agents/analytics-specialist.md):
 *   - FACT: un dato leido tal cual del contexto (GA4/GTM/catalogo de
 *     eventos clave), sin interpretacion.
 *   - OBSERVATION: una lectura/agrupacion de varios FACTs (p.ej. "el
 *     canal Direct concentra la mayoria de conversiones"), todavia sin
 *     explicar una causa.
 *   - HYPOTHESIS: una posible explicacion NO confirmada -- nunca debe
 *     presentarse como causalidad cierta (ver auditAnalyticsSpecialistOutput
 *     en audit.ts, que aplica una heuristica de lenguaje causal sobre
 *     estos items).
 *   - RECOMMENDATION: una accion o medicion propuesta -- nunca aplicada
 *     por este empleado (solo lectura, nunca escribe en GA4/GTM).
 */
export type ClaimType = "FACT" | "OBSERVATION" | "HYPOTHESIS" | "RECOMMENDATION";

/**
 * De donde viene una pieza de evidencia -- siempre datos YA leidos por
 * analytics-watcher (src/agents/analytics-watcher.ts) y persistidos
 * localmente (event bus + reports/analytics/*.md), nunca una llamada en
 * vivo a GA4/GTM desde este empleado (ver
 * src/employees/analytics-specialist/context.ts).
 */
export type EvidenceSource = "ga4_channel_traffic" | "ga4_landing_pages" | "ga4_key_events" | "ga4_source_medium" | "gtm_container" | "gtm_tags" | "gtm_triggers" | "key_events_catalog";

export interface EvidenceItem {
  id: string;
  source: EvidenceSource;
  description: string;
}

export interface Finding {
  claimType: ClaimType;
  statement: string;
  /** ids que deben existir en `evidence[]` -- ver validateAnalyticsSpecialistOutput/auditAnalyticsSpecialistOutput. */
  evidenceIds: string[];
}

export interface PrioritizedAction extends Finding {
  priority: "high" | "medium" | "low";
}

export interface RunSummary {
  departmentRunId: string;
  reportGeneratedAt: string;
  ga4Connected: boolean;
  gtmConnected: boolean;
}

export interface AnalyticsSpecialistOutput {
  runSummary: RunSummary;
  measurementFindings: Finding[];
  funnelObservations: Finding[];
  trafficObservations: Finding[];
  conversionObservations: Finding[];
  trackingIssues: Finding[];
  anomalyCandidates: Finding[];
  hypotheses: Finding[];
  /** Deberian ser todos claimType "RECOMMENDATION" -- ver auditAnalyticsSpecialistOutput (warning, no bloqueo duro). */
  recommendedMeasurements: Finding[];
  prioritizedActions: PrioritizedAction[];
  evidence: EvidenceItem[];
  unknowns: string[];
}
