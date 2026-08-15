import { SeoSpecialistContext } from "./context";
import { extractLastRunnerResultJsonLine } from "../../core/runner-result-parser";

/**
 * Dominio del empleado `seo-specialist` -- ver docs/claude-employee-runtime.md.
 * Este modulo es TOOL puro: no llama a ningun modelo, no decide que
 * accion SEO aplicar, no aplica nada. Solo sabe (a) validar que la
 * salida del subagente tiene la forma esperada (fail-closed, sin
 * librerias externas, mismo patron que validateV2Output() en
 * src/core/landing-architect-comparison.ts), (b) auditar esa salida en
 * busca de afirmaciones sin respaldo real en el contexto suministrado, y
 * (c) montar un artefacto de solo lectura (input + resultado) para
 * revision humana -- SIN veredicto ni aplicacion automatica de ninguna
 * accion SEO.
 */

export type SeoBasis = "evidence" | "inference";
export type SeoPriority = "high" | "medium" | "low";
export type SeoEffortOrImpact = "low" | "medium" | "high";

export type SeoFindingCategory = "technical" | "content" | "keyword_strategy" | "structure" | "search_intent" | "internal_linking" | "cannibalization" | "other";

export type SeoOpportunityKind = "quick_win" | "low_ctr" | "position_drop" | "content_gap" | "internal_linking" | "technical" | "cannibalization" | "future_opportunity";

export type SeoEvidenceSource = "job_data" | "target_keyword_catalog" | "cluster_catalog" | "prior_report" | "other";

export interface SeoFinding {
  id: string;
  category: SeoFindingCategory;
  description: string;
  basis: SeoBasis;
  evidenceRefs: string[];
}

export interface SeoOpportunityFinding {
  id: string;
  keyword: string;
  page?: string;
  kind: SeoOpportunityKind;
  priority: SeoPriority;
  recommendedAction: string;
  rationale: string;
  basis: SeoBasis;
  evidenceRefs: string[];
}

export interface SeoTechnicalIssue {
  id: string;
  page: string;
  issue: string;
  severity: SeoPriority;
  basis: SeoBasis;
  evidenceRefs: string[];
}

export interface SeoContentGap {
  id: string;
  topic: string;
  relatedKeyword?: string;
  page?: string;
  rationale: string;
  basis: SeoBasis;
  evidenceRefs: string[];
}

export interface SeoInternalLinkRecommendation {
  id: string;
  fromPage: string;
  toPage: string;
  anchorTextSuggestion: string;
  rationale: string;
  basis: SeoBasis;
  evidenceRefs: string[];
}

export interface SeoPrioritizedAction {
  rank: number;
  title: string;
  relatedIds: string[];
  priority: SeoPriority;
  effort: SeoEffortOrImpact;
  impact: SeoEffortOrImpact;
}

export interface SeoEvidenceItem {
  id: string;
  source: SeoEvidenceSource;
  keyword?: string;
  page?: string;
  description: string;
}

export interface SeoSpecialistOutput {
  executiveSummary: string;
  findings: SeoFinding[];
  opportunities: SeoOpportunityFinding[];
  technicalIssues: SeoTechnicalIssue[];
  contentGaps: SeoContentGap[];
  internalLinkRecommendations: SeoInternalLinkRecommendation[];
  prioritizedActions: SeoPrioritizedAction[];
  evidence: SeoEvidenceItem[];
  unknowns: string[];
}

const BASIS_VALUES: readonly SeoBasis[] = ["evidence", "inference"];
const PRIORITY_VALUES: readonly SeoPriority[] = ["high", "medium", "low"];
const EFFORT_IMPACT_VALUES: readonly SeoEffortOrImpact[] = ["low", "medium", "high"];
const FINDING_CATEGORY_VALUES: readonly SeoFindingCategory[] = ["technical", "content", "keyword_strategy", "structure", "search_intent", "internal_linking", "cannibalization", "other"];
const OPPORTUNITY_KIND_VALUES: readonly SeoOpportunityKind[] = ["quick_win", "low_ctr", "position_drop", "content_gap", "internal_linking", "technical", "cannibalization", "future_opportunity"];
const EVIDENCE_SOURCE_VALUES: readonly SeoEvidenceSource[] = ["job_data", "target_keyword_catalog", "cluster_catalog", "prior_report", "other"];

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || isString(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}
function isOneOf<T extends string>(v: unknown, values: readonly T[]): v is T {
  return typeof v === "string" && (values as readonly string[]).includes(v);
}
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

function isFinding(v: unknown): v is SeoFinding {
  const o = asRecord(v);
  return !!o && isString(o.id) && isOneOf(o.category, FINDING_CATEGORY_VALUES) && isString(o.description) && isOneOf(o.basis, BASIS_VALUES) && isStringArray(o.evidenceRefs);
}

function isOpportunity(v: unknown): v is SeoOpportunityFinding {
  const o = asRecord(v);
  return (
    !!o &&
    isString(o.id) &&
    isString(o.keyword) &&
    isOptionalString(o.page) &&
    isOneOf(o.kind, OPPORTUNITY_KIND_VALUES) &&
    isOneOf(o.priority, PRIORITY_VALUES) &&
    isString(o.recommendedAction) &&
    isString(o.rationale) &&
    isOneOf(o.basis, BASIS_VALUES) &&
    isStringArray(o.evidenceRefs)
  );
}

function isTechnicalIssue(v: unknown): v is SeoTechnicalIssue {
  const o = asRecord(v);
  return !!o && isString(o.id) && isString(o.page) && isString(o.issue) && isOneOf(o.severity, PRIORITY_VALUES) && isOneOf(o.basis, BASIS_VALUES) && isStringArray(o.evidenceRefs);
}

function isContentGap(v: unknown): v is SeoContentGap {
  const o = asRecord(v);
  return !!o && isString(o.id) && isString(o.topic) && isOptionalString(o.relatedKeyword) && isOptionalString(o.page) && isString(o.rationale) && isOneOf(o.basis, BASIS_VALUES) && isStringArray(o.evidenceRefs);
}

function isInternalLinkRecommendation(v: unknown): v is SeoInternalLinkRecommendation {
  const o = asRecord(v);
  return (
    !!o &&
    isString(o.id) &&
    isString(o.fromPage) &&
    isString(o.toPage) &&
    isString(o.anchorTextSuggestion) &&
    isString(o.rationale) &&
    isOneOf(o.basis, BASIS_VALUES) &&
    isStringArray(o.evidenceRefs)
  );
}

function isPrioritizedAction(v: unknown): v is SeoPrioritizedAction {
  const o = asRecord(v);
  return (
    !!o &&
    typeof o.rank === "number" &&
    isString(o.title) &&
    isStringArray(o.relatedIds) &&
    isOneOf(o.priority, PRIORITY_VALUES) &&
    isOneOf(o.effort, EFFORT_IMPACT_VALUES) &&
    isOneOf(o.impact, EFFORT_IMPACT_VALUES)
  );
}

function isEvidenceItem(v: unknown): v is SeoEvidenceItem {
  const o = asRecord(v);
  return !!o && isString(o.id) && isOneOf(o.source, EVIDENCE_SOURCE_VALUES) && isOptionalString(o.keyword) && isOptionalString(o.page) && isString(o.description);
}

/**
 * Valida (sin librerias externas -- ninguna dependencia nueva) que un
 * objeto crudo tiene la forma minima de un `SeoSpecialistOutput`.
 * Fail-closed: cualquier campo obligatorio ausente o del tipo equivocado
 * lanza -- nunca se "rellena" con un valor por defecto que disfrazaria
 * una salida rota del subagente como si fuera valida.
 */
export function validateSeoSpecialistOutput(raw: unknown): SeoSpecialistOutput {
  const o = asRecord(raw);
  if (!o) {
    throw new Error("Salida seo-specialist invalida: se esperaba un objeto JSON.");
  }

  if (!isString(o.executiveSummary)) {
    throw new Error("Salida seo-specialist invalida: falta executiveSummary (string).");
  }
  if (!Array.isArray(o.findings) || !o.findings.every(isFinding)) {
    throw new Error("Salida seo-specialist invalida: findings debe ser SeoFinding[].");
  }
  if (!Array.isArray(o.opportunities) || !o.opportunities.every(isOpportunity)) {
    throw new Error("Salida seo-specialist invalida: opportunities debe ser SeoOpportunityFinding[].");
  }
  if (!Array.isArray(o.technicalIssues) || !o.technicalIssues.every(isTechnicalIssue)) {
    throw new Error("Salida seo-specialist invalida: technicalIssues debe ser SeoTechnicalIssue[].");
  }
  if (!Array.isArray(o.contentGaps) || !o.contentGaps.every(isContentGap)) {
    throw new Error("Salida seo-specialist invalida: contentGaps debe ser SeoContentGap[].");
  }
  if (!Array.isArray(o.internalLinkRecommendations) || !o.internalLinkRecommendations.every(isInternalLinkRecommendation)) {
    throw new Error("Salida seo-specialist invalida: internalLinkRecommendations debe ser SeoInternalLinkRecommendation[].");
  }
  if (!Array.isArray(o.prioritizedActions) || !o.prioritizedActions.every(isPrioritizedAction)) {
    throw new Error("Salida seo-specialist invalida: prioritizedActions debe ser SeoPrioritizedAction[].");
  }
  if (!Array.isArray(o.evidence) || !o.evidence.every(isEvidenceItem)) {
    throw new Error("Salida seo-specialist invalida: evidence debe ser SeoEvidenceItem[].");
  }
  if (!isStringArray(o.unknowns)) {
    throw new Error("Salida seo-specialist invalida: unknowns debe ser string[].");
  }

  return o as unknown as SeoSpecialistOutput;
}

interface ClaimItem {
  id: string;
  basis: SeoBasis;
  evidenceRefs: string[];
}

/**
 * Auditoria de afirmaciones sin respaldo real en el contexto -- NO es un
 * check semantico completo, es una red de seguridad estructural de dos
 * capas (en el espiritu de auditV2OutputForFabrication() en
 * src/core/landing-architect-comparison.ts, pero sin copiar su mecanismo
 * textual, adaptada al dominio SEO):
 *
 *   1. Coherencia interna de la salida: cualquier finding/opportunity/
 *      technicalIssue/contentGap/internalLinkRecommendation con
 *      `basis: "evidence"` pero `evidenceRefs` vacio, o con una
 *      referencia a un id de `evidence[]` que no existe, se reporta como
 *      warning.
 *   2. Coherencia contra el contexto real: cualquier entrada de
 *      `evidence[]` cuyo `keyword`/`page` no aparezca literalmente en los
 *      datos deterministas suministrados (actionItems/targetKeywords/
 *      clusters) se reporta como warning -- posible dato inventado.
 *
 * Nunca bloquea nada automaticamente: este runner solo genera reportes
 * locales para revision humana, no aplica ninguna accion SEO.
 */
export function auditSeoSpecialistOutputForUnsupportedClaims(context: SeoSpecialistContext, output: SeoSpecialistOutput): string[] {
  const warnings: string[] = [];

  const evidenceIds = new Set(output.evidence.map((e) => e.id));

  const knownKeywords = new Set<string>();
  for (const item of context.actionItems) knownKeywords.add(item.keyword.trim().toLowerCase());
  for (const kw of context.targetKeywords) knownKeywords.add(kw.keyword.trim().toLowerCase());
  for (const cluster of context.clusters) {
    for (const pattern of cluster.matchPatterns) knownKeywords.add(pattern.trim().toLowerCase());
  }

  const knownPages = new Set<string>();
  for (const item of context.actionItems) knownPages.add(item.page.trim().toLowerCase());
  for (const cluster of context.clusters) {
    if (cluster.targetUrl) knownPages.add(cluster.targetUrl.trim().toLowerCase());
  }

  for (const e of output.evidence) {
    if (e.keyword && !knownKeywords.has(e.keyword.trim().toLowerCase())) {
      warnings.push(`Evidencia "${e.id}" cita la keyword "${e.keyword}", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.`);
    }
    if (e.page && !knownPages.has(e.page.trim().toLowerCase())) {
      warnings.push(`Evidencia "${e.id}" cita la pagina "${e.page}", que no aparece en los datos locales suministrados en el contexto (actionItems/clusters) -- posible dato inventado.`);
    }
  }

  const claimGroups: Array<{ label: string; items: ClaimItem[] }> = [
    { label: "findings", items: output.findings },
    { label: "opportunities", items: output.opportunities },
    { label: "technicalIssues", items: output.technicalIssues },
    { label: "contentGaps", items: output.contentGaps },
    { label: "internalLinkRecommendations", items: output.internalLinkRecommendations },
  ];

  for (const group of claimGroups) {
    for (const item of group.items) {
      if (item.basis === "evidence" && item.evidenceRefs.length === 0) {
        warnings.push(`${group.label}: "${item.id}" se declara basado en evidencia (basis=evidence) pero no referencia ninguna entrada de evidence[].`);
      }
      for (const ref of item.evidenceRefs) {
        if (!evidenceIds.has(ref)) {
          warnings.push(`${group.label}: "${item.id}" referencia el id de evidencia "${ref}", que no existe en evidence[].`);
        }
      }
    }
  }

  const noDataAtAll = !context.dataAvailability.hasJobData && !context.dataAvailability.hasTargetKeywordCatalog && !context.dataAvailability.hasClusterCatalog;
  if (noDataAtAll && (output.findings.length > 0 || output.opportunities.length > 0)) {
    warnings.push("No habia ningun dato SEO local disponible en el contexto (jobs/keywords objetivo/clusters vacios), pero la salida contiene findings/opportunities -- deberia haberse limitado a explicar la ausencia de datos en unknowns.");
  }

  return warnings;
}

export type SeoSpecialistResult = { status: "pending_execution"; promptFilePath: string } | { status: "invalid_output"; error: string; rawOutputPath: string } | { status: "executed"; output: SeoSpecialistOutput; warnings: string[] };

export interface RunnerResultSummary {
  runId: string;
  status: SeoSpecialistResult["status"];
  promptFilePath: string;
  expectedOutputPath: string;
  artifactJsonPath: string;
  artifactMdPath: string;
  /** null salvo que status sea "executed". */
  findingCount: number | null;
  opportunityCount: number | null;
  warningCount: number | null;
}

export function buildRunnerResultSummary(
  runId: string,
  paths: { promptFilePath: string; expectedOutputPath: string; artifactJsonPath: string; artifactMdPath: string },
  result: SeoSpecialistResult
): RunnerResultSummary {
  return {
    runId,
    status: result.status,
    promptFilePath: paths.promptFilePath,
    expectedOutputPath: paths.expectedOutputPath,
    artifactJsonPath: paths.artifactJsonPath,
    artifactMdPath: paths.artifactMdPath,
    findingCount: result.status === "executed" ? result.output.findings.length : null,
    opportunityCount: result.status === "executed" ? result.output.opportunities.length : null,
    warningCount: result.status === "executed" ? result.warnings.length : null,
  };
}

/**
 * Valida (fail-closed, sin librerias externas) que el JSON parseado tiene
 * la forma minima de un RunnerResultSummary de este empleado -- mismo
 * patron que parseRunnerResultJson() en src/core/runner-result-parser.ts,
 * pero para el contrato propio de seo-specialist (nunca importa
 * RunnerResultSummary de landing-architect-comparison.ts, son dos
 * contratos independientes).
 */
export function parseSeoSpecialistRunnerResultJson(jsonText: string): RunnerResultSummary {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`RUNNER_RESULT_JSON no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
  }

  const o = asRecord(raw);
  if (!o) {
    throw new Error("RUNNER_RESULT_JSON invalido: se esperaba un objeto JSON.");
  }

  const REQUIRED_STRING_FIELDS = ["runId", "status", "promptFilePath", "expectedOutputPath", "artifactJsonPath", "artifactMdPath"] as const;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isString(o[field])) {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo string "${field}".`);
    }
  }
  if (!["pending_execution", "executed", "invalid_output"].includes(o.status as string)) {
    throw new Error(`RUNNER_RESULT_JSON invalido: status "${String(o.status)}" no es uno de los 3 valores esperados.`);
  }
  for (const field of ["findingCount", "opportunityCount", "warningCount"] as const) {
    if (o[field] !== null && typeof o[field] !== "number") {
      throw new Error(`RUNNER_RESULT_JSON invalido: ${field} debe ser number o null, encontrado "${typeof o[field]}".`);
    }
  }

  return o as unknown as RunnerResultSummary;
}

/** Reutiliza extractLastRunnerResultJsonLine() (generico, sin dependencia de dominio) de src/core/runner-result-parser.ts -- solo la logica de parseo/validacion del JSON en si es propia de este empleado. */
export function extractAndParseSeoSpecialistRunnerResult(log: string): RunnerResultSummary {
  const jsonText = extractLastRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseSeoSpecialistRunnerResultJson(jsonText);
}

export interface SeoSpecialistArtifact {
  runId: string;
  generatedAt: string;
  context: SeoSpecialistContext;
  result: SeoSpecialistResult;
  note: string;
}

export function buildSeoSpecialistArtifact(runId: string, context: SeoSpecialistContext, result: SeoSpecialistResult): SeoSpecialistArtifact {
  return {
    runId,
    generatedAt: new Date().toISOString(),
    context,
    result,
    note: "Artefacto de solo lectura/analisis. Ninguna de las recomendaciones se ha aplicado a WordPress, staging, produccion, Google Ads, GA4/GTM ni Search Console. La decision de que aplicar la toma un humano, nunca este runner ni el propio subagente.",
  };
}

function fmtPriorityCounts(items: Array<{ priority: SeoPriority }>): string {
  const high = items.filter((i) => i.priority === "high").length;
  const medium = items.filter((i) => i.priority === "medium").length;
  const low = items.filter((i) => i.priority === "low").length;
  return `${high} alta / ${medium} media / ${low} baja`;
}

export function renderSeoSpecialistArtifactMarkdown(artifact: SeoSpecialistArtifact): string {
  const lines: string[] = [];
  lines.push(`# SEO Specialist — analisis ${artifact.runId}`);
  lines.push("");
  lines.push(`- **Generado:** ${artifact.generatedAt}`);
  lines.push(`- **runId de datos analizados:** \`${artifact.context.dataAvailability.latestRunId ?? "(sin datos de jobs)"}\``);
  lines.push(`- **actionItems en contexto:** ${artifact.context.actionItems.length}`);
  lines.push(`- **targetKeywords en contexto:** ${artifact.context.targetKeywords.length}`);
  lines.push(`- **clusters en contexto:** ${artifact.context.clusters.length}`);
  lines.push("");
  lines.push("**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**");
  lines.push("");

  lines.push("## Resultado");
  lines.push("");
  if (artifact.result.status === "pending_execution") {
    lines.push(`- **Estado: pendiente de ejecucion.** Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("- Para completar el analisis: invocar el subagente `seo-specialist` con ese prompt y volver a ejecutar este runner con `--seo-specialist-output <fichero-json-de-respuesta>`.");
  } else if (artifact.result.status === "invalid_output") {
    lines.push(`- **Estado: salida invalida.** ${artifact.result.error}`);
    lines.push(`- Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
  } else {
    const output = artifact.result.output;
    lines.push(`- **Estado: ejecutado.** ${artifact.result.warnings.length} aviso(s) de auditoria.`);
    lines.push("");
    lines.push("### Resumen ejecutivo");
    lines.push("");
    lines.push(output.executiveSummary);
    lines.push("");
    lines.push(`### Findings (${output.findings.length})`);
    lines.push("");
    for (const f of output.findings) {
      lines.push(`- [${f.category}] (${f.basis}) ${f.description}`);
    }
    lines.push("");
    lines.push(`### Oportunidades (${output.opportunities.length}, prioridad: ${fmtPriorityCounts(output.opportunities)})`);
    lines.push("");
    for (const o of output.opportunities) {
      lines.push(`- [${o.priority}] (${o.kind}, ${o.basis}) "${o.keyword}"${o.page ? ` — ${o.page}` : ""}: ${o.recommendedAction}`);
    }
    lines.push("");
    lines.push(`### Problemas tecnicos (${output.technicalIssues.length})`);
    lines.push("");
    for (const t of output.technicalIssues) {
      lines.push(`- [${t.severity}] ${t.page}: ${t.issue}`);
    }
    lines.push("");
    lines.push(`### Huecos de contenido (${output.contentGaps.length})`);
    lines.push("");
    for (const c of output.contentGaps) {
      lines.push(`- ${c.topic}${c.relatedKeyword ? ` (keyword relacionada: "${c.relatedKeyword}")` : ""}: ${c.rationale}`);
    }
    lines.push("");
    lines.push(`### Enlazado interno recomendado (${output.internalLinkRecommendations.length})`);
    lines.push("");
    for (const l of output.internalLinkRecommendations) {
      lines.push(`- ${l.fromPage} -> ${l.toPage} ("${l.anchorTextSuggestion}"): ${l.rationale}`);
    }
    lines.push("");
    lines.push(`### Acciones priorizadas (${output.prioritizedActions.length})`);
    lines.push("");
    lines.push("| # | Titulo | Prioridad | Esfuerzo | Impacto |");
    lines.push("|---|---|---|---|---|");
    for (const a of [...output.prioritizedActions].sort((x, y) => x.rank - y.rank)) {
      lines.push(`| ${a.rank} | ${a.title} | ${a.priority} | ${a.effort} | ${a.impact} |`);
    }
    lines.push("");
    lines.push(`### Desconocidos (${output.unknowns.length})`);
    lines.push("");
    for (const u of output.unknowns) lines.push(`- ${u}`);
    lines.push("");
    if (artifact.result.warnings.length > 0) {
      lines.push(`**⚠️ Auditoria: ${artifact.result.warnings.length} aviso(s) para revision humana:**`);
      for (const w of artifact.result.warnings) lines.push(`- ${w}`);
    } else {
      lines.push("Auditoria: sin avisos (ninguna afirmacion sin respaldo detectada en el contexto suministrado).");
    }
  }
  lines.push("");

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.");
  lines.push("- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.");
  lines.push("- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.");
  lines.push("");

  return lines.join("\n");
}
