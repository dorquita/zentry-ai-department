/**
 * Tipos de dominio de la salida del empleado Claude `growth-director-v2`
 * -- ver `.claude/agents/growth-director-v2.md` (fuente de verdad del
 * contrato en lenguaje natural) y
 * `config/growth-director-v2-output.schema.json` (el mismo contrato
 * como JSON Schema, pasado a `claude-code-action` via `--json-schema`).
 * Cualquier cambio aqui debe reflejarse en el schema EN EL MISMO commit
 * -- ver `test/growth-director-v2-output-schema.test.ts`, que verifica
 * que ambas capas aceptan/rechazan los mismos fixtures.
 *
 * NOTA de naming (ver docs/claude-employee-runtime.md y la PR que
 * introduce este empleado): `growth-director` (sin sufijo) ya existe
 * como agente determinista v1 (`src/agents/growth-director.ts`,
 * genera reports/daily/*.md). Este directorio es un empleado Claude
 * NUEVO y DISTINTO, `growth-director-v2` -- mismo patron que
 * `ux-ui-landing-architect` (v1) / `ux-ui-landing-architect-v2` (Claude).
 * No reemplaza a v1, no toca reports/daily/*.md.
 */

export type GrowthChannel = "seo" | "sem" | "content" | "cro" | "analytics" | "product" | "brand" | "ops" | "other";
export type GrowthLevel = "high" | "medium" | "low";
export type GrowthDependencyStatus = "available" | "partial" | "missing";

export const GROWTH_CHANNELS: GrowthChannel[] = ["seo", "sem", "content", "cro", "analytics", "product", "brand", "ops", "other"];
export const GROWTH_LEVELS: GrowthLevel[] = ["high", "medium", "low"];
export const GROWTH_DEPENDENCY_STATUSES: GrowthDependencyStatus[] = ["available", "partial", "missing"];

/** Forma comun de currentSignals[] / bottlenecks[] / opportunities[]. */
export interface GrowthChannelSignal {
  channel: GrowthChannel;
  description: string;
  evidenceRefs: string[];
}

export interface GrowthExperimentIdea {
  title: string;
  hypothesis: string;
  channel: GrowthChannel;
  successMetric: string;
  evidenceRefs: string[];
}

/**
 * `rationale` y `evidenceRefs` son el nucleo de la regla de negocio de
 * este empleado: "no priority ranking without a stated reason" -- ver
 * `validateGrowthDirectorV2Output()`/`auditGrowthDirectorV2Output()` en
 * `./domain.ts`. El schema (`config/growth-director-v2-output.schema.json`)
 * ya exige que ambos campos EXISTAN; que no esten VACIOS es una
 * comprobacion de negocio adicional que solo hace el auditor (JSON
 * Schema-lite no soporta `minLength`/`minItems`, ver
 * `src/core/json-schema-lite.ts`).
 */
export interface GrowthPriority {
  title: string;
  rationale: string;
  impact: GrowthLevel;
  confidence: GrowthLevel;
  effort: GrowthLevel;
  dependsOn: string[];
  evidenceRefs: string[];
}

export interface GrowthDependencyItem {
  name: string;
  status: GrowthDependencyStatus;
  note: string;
}

export interface GrowthRiskItem {
  description: string;
  severity: GrowthLevel;
  evidenceRefs: string[];
}

export interface GrowthEvidenceItem {
  ref: string;
  description: string;
}

export interface GrowthDirectorV2Output {
  growthSummary: string;
  currentSignals: GrowthChannelSignal[];
  bottlenecks: GrowthChannelSignal[];
  opportunities: GrowthChannelSignal[];
  experiments: GrowthExperimentIdea[];
  recommendedPriorities: GrowthPriority[];
  dependencies: GrowthDependencyItem[];
  risks: GrowthRiskItem[];
  evidence: GrowthEvidenceItem[];
  unknowns: string[];
}
