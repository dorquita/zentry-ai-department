import { ContentStrategistContext } from "./context";
import { ContentStrategistOutput } from "./output";

/**
 * Artefacto/resultado del runner de dos pasos de content-strategist --
 * ver scripts/run-content-strategist.ts. Modulo TOOL puro (sin I/O): no
 * llama a ningun modelo, no decide nada, solo (a) representa el
 * resultado de una pasada del runner en sus 4 estados posibles, (b)
 * monta un artefacto legible con input/output/avisos, y (c) construye el
 * resumen machine-readable `RUNNER_RESULT_JSON` -- mismo espiritu que
 * RunnerResultSummary/buildComparisonArtifact en
 * src/core/landing-architect-comparison.ts, con un estado extra
 * (`no_eligible_work`) que landing-architect-v2 no necesita: ese
 * empleado siempre asume que existe al menos un change pack elegible
 * (lanza si no), pero content-strategist debe representar
 * explicitamente "no hay ninguna oportunidad de contenido que revisar
 * ahora" en vez de fabricar una.
 */
export type ContentStrategistResult =
  | { status: "no_eligible_work" }
  | { status: "pending_execution"; promptFilePath: string }
  | { status: "invalid_output"; error: string; rawOutputPath: string }
  | { status: "executed"; output: ContentStrategistOutput; auditWarnings: string[] };

/**
 * Contrato machine-readable que imprime el runner al final de cada
 * ejecucion (linea `RUNNER_RESULT_JSON=...`). Estructura FIJA e
 * IDENTICA en los 4 estados posibles de `status` -- quien orquesta esto
 * (el workflow de GitHub Actions) no tiene que ramificar su logica de
 * lectura segun el estado para saber donde esta cada campo. Los campos
 * de ruta/texto son cadena vacia (nunca `undefined`/`null`) cuando no
 * aplican, para que $GITHUB_OUTPUT (que solo admite strings) siempre
 * reciba un valor valido en los 4 estados.
 */
export interface ContentStrategistRunnerResultSummary {
  status: ContentStrategistResult["status"];
  changePackId: string;
  keyword: string;
  promptFilePath: string;
  expectedOutputPath: string;
  artifactJsonPath: string;
  artifactMdPath: string;
  /** null salvo que status sea "executed" (unico estado en el que existen auditWarnings que contar). */
  auditWarningCount: number | null;
}

export function buildRunnerResultSummary(
  changePack: { changePackId: string; keyword: string } | undefined,
  paths: { promptFilePath: string; expectedOutputPath: string; artifactJsonPath: string; artifactMdPath: string } | undefined,
  result: ContentStrategistResult
): ContentStrategistRunnerResultSummary {
  return {
    status: result.status,
    changePackId: changePack?.changePackId ?? "",
    keyword: changePack?.keyword ?? "",
    promptFilePath: paths?.promptFilePath ?? "",
    expectedOutputPath: paths?.expectedOutputPath ?? "",
    artifactJsonPath: paths?.artifactJsonPath ?? "",
    artifactMdPath: paths?.artifactMdPath ?? "",
    auditWarningCount: result.status === "executed" ? result.auditWarnings.length : null,
  };
}

export interface ContentStrategistBriefArtifact {
  changePackId: string;
  generatedAt: string;
  input: ContentStrategistContext | null;
  result: ContentStrategistResult;
  note: string;
}

export function buildBriefArtifact(context: ContentStrategistContext | undefined, result: ContentStrategistResult): ContentStrategistBriefArtifact {
  return {
    changePackId: context?.changePackId ?? "",
    generatedAt: new Date().toISOString(),
    input: context ?? null,
    result,
    note: "Artefacto de solo lectura/propuesta. Ningun brief de este empleado se ha publicado en WordPress, Google Ads, GA4, GTM, n8n ni qdrant. La redaccion del contenido final (nunca generada por defecto por este empleado) y la decision de publicar las hace un humano por fuera de este sistema.",
  };
}

function fmtInternalLink(link: { anchorIdea: string; targetDescription: string; isRealLink: boolean }): string {
  return `${link.anchorIdea} -> ${link.targetDescription}${link.isRealLink ? "" : " (sin URL real todavia)"}`;
}

export function renderBriefMarkdown(artifact: ContentStrategistBriefArtifact): string {
  const lines: string[] = [];
  lines.push(`# Brief de estrategia de contenido — ${artifact.changePackId || "(sin change pack elegible)"}`);
  lines.push("");
  lines.push(`- **Generado:** ${artifact.generatedAt}`);
  if (artifact.input) {
    lines.push(`- **Keyword:** ${artifact.input.keyword}`);
    lines.push(`- **Marca:** ${artifact.input.targetBrand} | **brandIntent:** ${artifact.input.brandIntent}`);
    lines.push(`- **Tipo de contenido (hint del pipeline determinista):** ${artifact.input.contentTypeHint}`);
  }
  lines.push("");
  lines.push("**No se ha publicado ningun contenido. Este brief es solo una propuesta estrategica para revision humana.**");
  lines.push("");

  if (artifact.result.status === "no_eligible_work") {
    lines.push("## Estado: sin trabajo elegible");
    lines.push("");
    lines.push(
      "No hay ningun change pack de contenido (`changeType` new_content_page/content_update) en estado `ready_for_review`/`approved_to_execute` en este momento. No se ha inventado ninguna oportunidad de contenido -- vuelve a ejecutar este runner cuando el pipeline determinista de contenido (content-work-order-builder / content-change-pack-builder) tenga trabajo nuevo."
    );
  } else if (artifact.result.status === "pending_execution") {
    lines.push("## Estado: pendiente de ejecucion");
    lines.push("");
    lines.push(`Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("Para completar el brief: invocar el subagente `content-strategist` con ese prompt y volver a ejecutar este runner con `--content-strategist-output <fichero-json-de-respuesta>`.");
  } else if (artifact.result.status === "invalid_output") {
    lines.push("## Estado: salida invalida");
    lines.push("");
    lines.push(artifact.result.error);
    lines.push(`Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
  } else {
    const o = artifact.result.output;
    lines.push("## Estado: brief completado");
    lines.push("");
    lines.push(`- **Oportunidad:** ${o.contentOpportunity.title} — ${o.contentOpportunity.summary}`);
    lines.push(`- **Audiencia objetivo:** ${o.targetAudience}`);
    lines.push(`- **Intencion de busqueda:** ${o.searchIntent} | **Intencion comercial:** ${o.commercialIntent}`);
    lines.push(`- **Angulo:** ${o.angle}`);
    lines.push(`- **Tipo de contenido:** ${o.contentType} | **Marca:** ${o.targetBrand} | **Prioridad:** ${o.priority}`);
    lines.push("");
    lines.push(`### Estructura propuesta`);
    lines.push("");
    lines.push(`**H1:** ${o.recommendedStructure.h1}`);
    lines.push("");
    for (const section of o.recommendedStructure.sections) {
      lines.push(`- ${section.level}: ${section.heading} — ${section.purpose}`);
    }
    lines.push("");
    lines.push(`### CTA`);
    lines.push("");
    lines.push(`- **Principal:** ${o.ctaStrategy.primaryCta}`);
    if (o.ctaStrategy.secondaryCta) lines.push(`- **Secundario:** ${o.ctaStrategy.secondaryCta}`);
    lines.push(`- **Razonamiento:** ${o.ctaStrategy.rationale}`);
    lines.push("");
    lines.push(`### Enlaces internos propuestos`);
    lines.push("");
    if (o.internalLinks.length === 0) {
      lines.push("Ninguno propuesto.");
    } else {
      for (const link of o.internalLinks) lines.push(`- ${fmtInternalLink(link)}`);
    }
    lines.push("");
    lines.push(`### Evidencia de soporte`);
    lines.push("");
    for (const e of o.supportingEvidence) lines.push(`- ${e}`);
    lines.push("");
    lines.push(`### Riesgos / incognitas`);
    lines.push("");
    for (const r of o.risksAndUnknowns) lines.push(`- ${r}`);
    lines.push("");
    lines.push("**reasoningNotes (justificacion del subagente, no auto-evaluacion):**");
    lines.push("");
    for (const n of o.reasoningNotes) lines.push(`- ${n}`);
    lines.push("");
    if (artifact.result.auditWarnings.length > 0) {
      lines.push(`> ⚠️ Auditoria: ${artifact.result.auditWarnings.length} aviso(s) para revision humana:`);
      for (const w of artifact.result.auditWarnings) lines.push(`> - ${w}`);
    } else {
      lines.push("Auditoria: sin avisos (ninguna afirmacion sensible ni enlace interno marcado como real sin respaldo en el contexto).");
    }
  }

  lines.push("");
  lines.push(`_${artifact.note}_`);
  lines.push("");
  return lines.join("\n");
}
