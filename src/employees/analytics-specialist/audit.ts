import { AnalyticsSpecialistContextReady } from "./context";
import { AnalyticsSpecialistOutput, Finding } from "./types";

/**
 * Auditoria de dominio de analytics-specialist -- mismo espiritu que
 * auditV2OutputForFabrication() en src/core/landing-architect-comparison.ts
 * (red de seguridad textual, NO un chequeo semantico completo; nunca
 * bloquea nada automaticamente, solo genera warnings para revision
 * humana), pero NO es una copia: las categorias y heuristicas son
 * propias del dominio de medicion/analitica.
 *
 * Cubre las dos reglas de negocio explicitas de la mision (ver
 * .claude/agents/analytics-specialist.md):
 *   1. Ninguna cifra/metrica citada en un `statement` puede ser inventada
 *      -- debe poder rastrearse hasta el contexto REAL (GA4/GTM/catalogo
 *      de eventos clave) que se le entrego al subagente, o hasta la
 *      descripcion de una `evidence[]` que a su vez sea rastreable.
 *   2. Los items marcados HYPOTHESIS no pueden presentarse como
 *      causalidad cierta -- correlacion no es causalidad.
 * Mas dos chequeos de integridad referencial/estructural (evidenceIds
 * colgantes, y que recommendedMeasurements/prioritizedActions sean
 * realmente RECOMMENDATION).
 */

/**
 * Lenguaje causal (heuristica ligera, ES + EN): si un item HYPOTHESIS usa
 * alguna de estas construcciones, probablemente esta afirmando una causa
 * como CIERTA en vez de una posible explicacion -- se marca como warning
 * para que un humano lo redacte con mas cautela ("podria deberse a",
 * "es posible que", "una hipotesis es que"), nunca se reescribe
 * automaticamente.
 */
const CAUSAL_LANGUAGE_PATTERN = /\b(porque|debido a que|causad[oa]s?\s+por|provocad[oa]s?\s+por|hace que|genera que|es la causa de|because|caused by|due to|leads to|results in)\b/i;

/** Tokens numericos (enteros/decimales, con % opcional) presentes en un texto. */
function extractNumberTokens(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
}

/** Un token de 4 digitos sin decimales/porcentaje entre 1900 y 2099 se trata como fecha (ano), no como metrica -- evita falsos positivos constantes al citar reportGeneratedAt/dateRange. */
function looksLikeYear(token: string): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const n = Number(token);
  return n >= 1900 && n <= 2099;
}

function buildTraceableCorpus(context: AnalyticsSpecialistContextReady, evidenceDescriptions: string[]): string {
  const contextText = JSON.stringify({ ga4: context.ga4, gtm: context.gtm, watcherWarnings: context.watcherWarnings, reportGeneratedAt: context.reportGeneratedAt, departmentRunId: context.departmentRunId });
  return [contextText, ...evidenceDescriptions].join(" \n ");
}

function isNumberTraceable(token: string, corpus: string): boolean {
  return corpus.includes(token);
}

interface CategorizedFinding {
  category: string;
  index: number;
  finding: Finding;
}

function collectAllFindings(output: AnalyticsSpecialistOutput): CategorizedFinding[] {
  const categories: Array<[string, Finding[]]> = [
    ["measurementFindings", output.measurementFindings],
    ["funnelObservations", output.funnelObservations],
    ["trafficObservations", output.trafficObservations],
    ["conversionObservations", output.conversionObservations],
    ["trackingIssues", output.trackingIssues],
    ["anomalyCandidates", output.anomalyCandidates],
    ["hypotheses", output.hypotheses],
    ["recommendedMeasurements", output.recommendedMeasurements],
    ["prioritizedActions", output.prioritizedActions],
  ];
  const all: CategorizedFinding[] = [];
  for (const [category, findings] of categories) {
    findings.forEach((finding, index) => all.push({ category, index, finding }));
  }
  return all;
}

export function auditAnalyticsSpecialistOutput(context: AnalyticsSpecialistContextReady, output: AnalyticsSpecialistOutput): string[] {
  const warnings: string[] = [];
  const evidenceIds = new Set(output.evidence.map((e) => e.id));
  const corpus = buildTraceableCorpus(
    context,
    output.evidence.map((e) => e.description)
  );

  // --- 1. Cada evidence[] debe ser rastreable al contexto real (no inventada) ---
  for (const item of output.evidence) {
    const contextOnlyCorpus = buildTraceableCorpus(context, []);
    const tokens = extractNumberTokens(item.description).filter((t) => !looksLikeYear(t));
    for (const token of tokens) {
      if (!isNumberTraceable(token, contextOnlyCorpus)) {
        warnings.push(`Evidencia no rastreable (${item.id}, ${item.source}): la cifra "${token}" citada en "${item.description}" no aparece en el contexto real entregado (GA4/GTM/avisos de analytics-watcher).`);
      }
    }
  }

  // --- 2. Integridad referencial y contenido de cada Finding ---
  for (const { category, index, finding } of collectAllFindings(output)) {
    const label = `${category}[${index}]`;

    // 2a. evidenceIds colgantes (referencian un id que no existe en output.evidence).
    for (const evidenceId of finding.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        warnings.push(`${label}: referencia evidenceIds "${evidenceId}" que no existe en el array "evidence" de la salida.`);
      }
    }

    // 2b. Ninguna cifra citada en el statement puede ser inventada -- debe rastrearse hasta el contexto real o hasta la evidencia citada.
    const numberTokens = extractNumberTokens(finding.statement).filter((t) => !looksLikeYear(t));
    if (numberTokens.length > 0) {
      if (finding.evidenceIds.length === 0) {
        warnings.push(`${label} ("${finding.claimType}"): cita cifra(s) [${numberTokens.join(", ")}] sin ningun evidenceIds -- toda cifra debe estar respaldada por una entrada de evidence[].`);
      }
      for (const token of numberTokens) {
        if (!isNumberTraceable(token, corpus)) {
          warnings.push(`${label}: la cifra "${token}" en "${finding.statement.slice(0, 100)}${finding.statement.length > 100 ? "..." : ""}" no es rastreable ni en el contexto real ni en las evidencias citadas -- posible metrica inventada.`);
        }
      }
    }

    // 2c. HYPOTHESIS no debe presentar la causa como cierta (correlacion != causalidad).
    if (finding.claimType === "HYPOTHESIS" && CAUSAL_LANGUAGE_PATTERN.test(finding.statement)) {
      warnings.push(`${label}: marcada como HYPOTHESIS pero usa lenguaje de causalidad cierta ("${finding.statement.match(CAUSAL_LANGUAGE_PATTERN)?.[0]}") -- correlacion no implica causalidad, redactar como posible explicacion ("podria deberse a", "una hipotesis es que").`);
    }
  }

  // --- 3. recommendedMeasurements / prioritizedActions deberian ser RECOMMENDATION ---
  output.recommendedMeasurements.forEach((f, i) => {
    if (f.claimType !== "RECOMMENDATION") {
      warnings.push(`recommendedMeasurements[${i}]: claimType es "${f.claimType}", se esperaba "RECOMMENDATION" (este array es solo para medidas recomendadas, no hallazgos).`);
    }
  });
  output.prioritizedActions.forEach((a, i) => {
    if (a.claimType !== "RECOMMENDATION") {
      warnings.push(`prioritizedActions[${i}]: claimType es "${a.claimType}", se esperaba "RECOMMENDATION" (este array es solo para acciones propuestas, no hallazgos).`);
    }
  });

  return warnings;
}
