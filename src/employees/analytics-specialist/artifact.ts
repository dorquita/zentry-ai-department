import { AnalyticsSpecialistContextReady } from "./context";
import { AnalyticsSpecialistResult } from "./runner-result";
import { Finding } from "./types";

/**
 * Artefacto de solo lectura/reporte del empleado analytics-specialist --
 * mismo espiritu que LandingArchitectComparisonArtifact/renderComparisonMarkdown
 * en src/core/landing-architect-comparison.ts: nunca aplica nada a
 * GA4/GTM, solo documenta lo que el subagente Claude produjo a partir del
 * contexto real que se le entrego.
 */

/** El runner (scripts/run-analytics-specialist.ts) solo construye un artefacto cuando el resultado es "pending_execution", "executed" o "invalid_output" -- nunca para "no_analytics_data" (en ese caso no hay nada que reportar, ver AGENT_NAME en el runner). */
export type AnalyticsSpecialistArtifactResult = Exclude<AnalyticsSpecialistResult, { status: "no_analytics_data" }>;

export interface AnalyticsSpecialistArtifact {
  generatedAt: string;
  context: AnalyticsSpecialistContextReady;
  result: AnalyticsSpecialistArtifactResult;
  note: string;
}

export function buildAnalyticsSpecialistArtifact(context: AnalyticsSpecialistContextReady, result: AnalyticsSpecialistArtifactResult): AnalyticsSpecialistArtifact {
  return {
    generatedAt: new Date().toISOString(),
    context,
    result,
    note: "Artefacto de solo lectura. analytics-specialist nunca modifica GA4 ni GTM -- solo interpreta datos ya leidos por analytics-watcher. Ninguna hipotesis debe leerse como causalidad confirmada; toda cifra citada deberia poder rastrearse hasta el contexto real (ver auditWarnings).",
  };
}

function renderFindingList(title: string, findings: Finding[]): string[] {
  const lines: string[] = [`### ${title}`, ""];
  if (findings.length === 0) {
    lines.push("(ninguno)");
  } else {
    for (const f of findings) {
      lines.push(`- **[${f.claimType}]** ${f.statement}${f.evidenceIds.length > 0 ? ` _(evidencia: ${f.evidenceIds.join(", ")})_` : ""}`);
    }
  }
  lines.push("");
  return lines;
}

export function renderAnalyticsSpecialistMarkdown(artifact: AnalyticsSpecialistArtifact): string {
  const lines: string[] = [];
  lines.push(`# Analytics Specialist — ${artifact.context.departmentRunId}`);
  lines.push("");
  lines.push(`- **Generado:** ${artifact.generatedAt}`);
  lines.push(`- **departmentRunId (analytics-watcher):** \`${artifact.context.departmentRunId}\``);
  lines.push(`- **Informe fuente:** \`${artifact.context.reportPath}\``);
  lines.push(`- **GA4 conectado:** ${artifact.context.ga4Connected ? "si" : "no"} | **GTM conectado:** ${artifact.context.gtmConnected ? "si" : "no"}`);
  lines.push("");
  lines.push("**No se ha modificado GA4 ni GTM. No se ha aplicado ninguna recomendacion.**");
  lines.push("");

  if (artifact.context.watcherWarnings.length > 0) {
    lines.push("## Avisos de analytics-watcher (misma pasada)");
    lines.push("");
    for (const w of artifact.context.watcherWarnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Resultado");
  lines.push("");
  if (artifact.result.status === "pending_execution") {
    lines.push(`- **Estado: pendiente de ejecucion.** Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("- Para completar: invocar el subagente `analytics-specialist` con ese prompt y volver a ejecutar este runner con `--analytics-specialist-output <fichero-json-de-respuesta>`.");
  } else if (artifact.result.status === "invalid_output") {
    lines.push(`- **Estado: salida invalida.** ${artifact.result.error}`);
    lines.push(`- Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
  } else {
    const output = artifact.result.output;
    lines.push(`- **Estado: ejecutado.** Avisos de auditoria: ${artifact.result.auditWarnings.length}.`);
    lines.push("");
    lines.push(...renderFindingList("Measurement findings", output.measurementFindings));
    lines.push(...renderFindingList("Funnel observations", output.funnelObservations));
    lines.push(...renderFindingList("Traffic observations", output.trafficObservations));
    lines.push(...renderFindingList("Conversion observations", output.conversionObservations));
    lines.push(...renderFindingList("Tracking issues", output.trackingIssues));
    lines.push(...renderFindingList("Anomaly candidates", output.anomalyCandidates));
    lines.push(...renderFindingList("Hypotheses", output.hypotheses));
    lines.push(...renderFindingList("Recommended measurements", output.recommendedMeasurements));

    lines.push("### Prioritized actions");
    lines.push("");
    if (output.prioritizedActions.length === 0) {
      lines.push("(ninguna)");
    } else {
      for (const a of output.prioritizedActions) {
        lines.push(`- **[${a.priority}]** ${a.statement}${a.evidenceIds.length > 0 ? ` _(evidencia: ${a.evidenceIds.join(", ")})_` : ""}`);
      }
    }
    lines.push("");

    lines.push("### Evidence");
    lines.push("");
    if (output.evidence.length === 0) {
      lines.push("(ninguna)");
    } else {
      lines.push("| id | source | description |");
      lines.push("|---|---|---|");
      for (const e of output.evidence) lines.push(`| \`${e.id}\` | ${e.source} | ${e.description} |`);
    }
    lines.push("");

    lines.push("### Unknowns");
    lines.push("");
    if (output.unknowns.length === 0) {
      lines.push("(ninguno)");
    } else {
      for (const u of output.unknowns) lines.push(`- ${u}`);
    }
    lines.push("");

    if (artifact.result.auditWarnings.length > 0) {
      lines.push(`### ⚠️ Auditoria: ${artifact.result.auditWarnings.length} aviso(s) para revision humana`);
      lines.push("");
      for (const w of artifact.result.auditWarnings) lines.push(`- ${w}`);
      lines.push("");
    } else {
      lines.push("### Auditoria: sin avisos");
      lines.push("");
    }
  }

  lines.push(`_${artifact.note}_`);
  lines.push("");
  return lines.join("\n");
}
