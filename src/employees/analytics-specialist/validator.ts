import { AnalyticsSpecialistOutput, ClaimType, EvidenceItem, EvidenceSource, Finding, PrioritizedAction, RunSummary } from "./types";

/**
 * Validador de forma (fail-closed, sin librerias externas -- mismo patron
 * que validateV2Output() en src/core/landing-architect-comparison.ts):
 * cualquier campo obligatorio ausente o del tipo equivocado lanza, nunca
 * se "rellena" con un valor por defecto que disfrazaria una salida rota
 * del subagente como si fuera valida.
 *
 * Esta funcion recibe el `unknown` YA validado contra
 * config/analytics-specialist-output.schema.json por el runtime comun
 * (src/core/claude-employee-runtime.ts) -- nunca al reves. Repite la
 * validacion estructural en TypeScript (en vez de confiar solo en el
 * schema JSON) por el mismo motivo que el resto de empleados: el schema
 * cubre forma/enum, pero tipar en TypeScript da errores mas especificos
 * y es lo que consume el resto del dominio (auditor, runner, artifact).
 */

const CLAIM_TYPES: ClaimType[] = ["FACT", "OBSERVATION", "HYPOTHESIS", "RECOMMENDATION"];
const EVIDENCE_SOURCES: EvidenceSource[] = [
  "ga4_channel_traffic",
  "ga4_landing_pages",
  "ga4_key_events",
  "ga4_source_medium",
  "gtm_container",
  "gtm_tags",
  "gtm_triggers",
  "key_events_catalog",
];
const PRIORITIES: Array<PrioritizedAction["priority"]> = ["high", "medium", "low"];

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertFinding(v: unknown, label: string): Finding {
  if (!isRecord(v)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}" debe ser un objeto Finding.`);
  }
  if (!isString(v.claimType) || !CLAIM_TYPES.includes(v.claimType as ClaimType)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}.claimType" debe ser uno de ${CLAIM_TYPES.join(", ")}.`);
  }
  if (!isString(v.statement)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}.statement" debe ser string.`);
  }
  if (!isStringArray(v.evidenceIds)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}.evidenceIds" debe ser string[].`);
  }
  return { claimType: v.claimType as ClaimType, statement: v.statement, evidenceIds: v.evidenceIds };
}

function assertFindingArray(v: unknown, label: string): Finding[] {
  if (!Array.isArray(v)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}" debe ser un array.`);
  }
  return v.map((item, index) => assertFinding(item, `${label}[${index}]`));
}

function assertPrioritizedAction(v: unknown, label: string): PrioritizedAction {
  const base = assertFinding(v, label);
  const o = v as Record<string, unknown>;
  if (!isString(o.priority) || !PRIORITIES.includes(o.priority as PrioritizedAction["priority"])) {
    throw new Error(`Salida analytics-specialist invalida: "${label}.priority" debe ser uno de ${PRIORITIES.join(", ")}.`);
  }
  return { ...base, priority: o.priority as PrioritizedAction["priority"] };
}

function assertEvidenceItem(v: unknown, label: string): EvidenceItem {
  if (!isRecord(v)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}" debe ser un objeto EvidenceItem.`);
  }
  if (!isString(v.id)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}.id" debe ser string.`);
  }
  if (!isString(v.source) || !EVIDENCE_SOURCES.includes(v.source as EvidenceSource)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}.source" debe ser uno de ${EVIDENCE_SOURCES.join(", ")}.`);
  }
  if (!isString(v.description)) {
    throw new Error(`Salida analytics-specialist invalida: "${label}.description" debe ser string.`);
  }
  return { id: v.id, source: v.source as EvidenceSource, description: v.description };
}

function assertRunSummary(v: unknown): RunSummary {
  if (!isRecord(v)) {
    throw new Error('Salida analytics-specialist invalida: falta "runSummary" (objeto).');
  }
  if (!isString(v.departmentRunId) || !isString(v.reportGeneratedAt)) {
    throw new Error('Salida analytics-specialist invalida: runSummary.departmentRunId / runSummary.reportGeneratedAt deben ser string.');
  }
  if (typeof v.ga4Connected !== "boolean" || typeof v.gtmConnected !== "boolean") {
    throw new Error("Salida analytics-specialist invalida: runSummary.ga4Connected / runSummary.gtmConnected deben ser boolean.");
  }
  return {
    departmentRunId: v.departmentRunId,
    reportGeneratedAt: v.reportGeneratedAt,
    ga4Connected: v.ga4Connected,
    gtmConnected: v.gtmConnected,
  };
}

export function validateAnalyticsSpecialistOutput(raw: unknown): AnalyticsSpecialistOutput {
  if (!isRecord(raw)) {
    throw new Error("Salida analytics-specialist invalida: se esperaba un objeto JSON.");
  }

  const runSummary = assertRunSummary(raw.runSummary);
  const measurementFindings = assertFindingArray(raw.measurementFindings, "measurementFindings");
  const funnelObservations = assertFindingArray(raw.funnelObservations, "funnelObservations");
  const trafficObservations = assertFindingArray(raw.trafficObservations, "trafficObservations");
  const conversionObservations = assertFindingArray(raw.conversionObservations, "conversionObservations");
  const trackingIssues = assertFindingArray(raw.trackingIssues, "trackingIssues");
  const anomalyCandidates = assertFindingArray(raw.anomalyCandidates, "anomalyCandidates");
  const hypotheses = assertFindingArray(raw.hypotheses, "hypotheses");
  const recommendedMeasurements = assertFindingArray(raw.recommendedMeasurements, "recommendedMeasurements");

  if (!Array.isArray(raw.prioritizedActions)) {
    throw new Error('Salida analytics-specialist invalida: "prioritizedActions" debe ser un array.');
  }
  const prioritizedActions = raw.prioritizedActions.map((item, index) => assertPrioritizedAction(item, `prioritizedActions[${index}]`));

  if (!Array.isArray(raw.evidence)) {
    throw new Error('Salida analytics-specialist invalida: "evidence" debe ser un array.');
  }
  const evidence = raw.evidence.map((item, index) => assertEvidenceItem(item, `evidence[${index}]`));

  if (!isStringArray(raw.unknowns)) {
    throw new Error('Salida analytics-specialist invalida: "unknowns" debe ser string[].');
  }

  return {
    runSummary,
    measurementFindings,
    funnelObservations,
    trafficObservations,
    conversionObservations,
    trackingIssues,
    anomalyCandidates,
    hypotheses,
    recommendedMeasurements,
    prioritizedActions,
    evidence,
    unknowns: raw.unknowns,
  };
}
