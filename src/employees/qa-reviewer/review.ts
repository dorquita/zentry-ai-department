import { QaReviewedArtifactRef, QaReviewerOutput, QaReviewSummaryCounts } from "./output";

/**
 * Ensamblado de artifact/runner-result del empleado `qa-reviewer` -- TOOL
 * puro (sin llamar a ningun modelo, sin decidir nada de dominio nuevo):
 * solo sabe (a) montar el artifact final de revision combinando identidad
 * + resultado, (b) renderizarlo como markdown legible, y (c) construir el
 * `RUNNER_RESULT_JSON` machine-readable que imprime
 * scripts/run-qa-reviewer.ts. Mismo patron que
 * src/core/landing-architect-comparison.ts
 * (buildComparisonArtifact/renderComparisonMarkdown/buildRunnerResultSummary),
 * adaptado al dominio de revision.
 */

export type QaReviewerResult =
  | { status: "pending_execution"; promptFilePath: string }
  | { status: "invalid_output"; error: string; rawOutputPath: string }
  | { status: "executed"; output: QaReviewerOutput; summaryCounts: QaReviewSummaryCounts };

export interface QaReviewArtifact {
  reviewedArtifact: QaReviewedArtifactRef;
  generatedAt: string;
  result: QaReviewerResult;
  note: string;
}

export function buildQaReviewArtifact(identity: QaReviewedArtifactRef, result: QaReviewerResult): QaReviewArtifact {
  return {
    reviewedArtifact: identity,
    generatedAt: new Date().toISOString(),
    result,
    note:
      "Artefacto de solo lectura/revision. qa-reviewer no vuelve a hacer el trabajo original ni aplica ninguna correccion -- solo evalua el artifact ya producido. La decision de aplicar/rechazar cualquier correccion la toma un humano.",
  };
}

function fmtFindingsList(items: string[], emptyLabel: string): string {
  if (items.length === 0) return `_${emptyLabel}_`;
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Escapa un valor de texto LIBRE (viene de Claude, nunca de confianza
 * total en su formato exacto) antes de interpolarlo dentro de una celda
 * de tabla markdown -- un `|` literal o un salto de linea dentro de
 * `finding.description` rompería el alineado de columnas de la tabla
 * (las instrucciones del propio agente piden citar texto EXACTO de
 * campos, asi que un `|` incidental es plausible, no solo teorico).
 */
function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderQaReviewMarkdown(artifact: QaReviewArtifact): string {
  const lines: string[] = [];
  lines.push(`# QA Reviewer -- revision de ${artifact.reviewedArtifact.artifactType} (${artifact.reviewedArtifact.artifactId})`);
  lines.push("");
  lines.push(`- **Generado:** ${artifact.generatedAt}`);
  lines.push(`- **sourceEmployee:** ${artifact.reviewedArtifact.sourceEmployee}`);
  lines.push(`- **artifactPath:** \`${artifact.reviewedArtifact.artifactPath}\``);
  lines.push("");
  lines.push("**qa-reviewer no vuelve a hacer el trabajo original ni aplica correcciones -- solo evalua.**");
  lines.push("");

  if (artifact.result.status === "pending_execution") {
    lines.push("## Estado: pendiente de ejecucion");
    lines.push("");
    lines.push(`Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("Para completar la revision: invocar el subagente `qa-reviewer` con ese prompt y volver a ejecutar este runner con `--qa-reviewer-output <fichero-json-de-respuesta>`.");
  } else if (artifact.result.status === "invalid_output") {
    lines.push("## Estado: salida invalida");
    lines.push("");
    lines.push(artifact.result.error);
    lines.push(`Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
  } else {
    const { output, summaryCounts } = artifact.result;
    lines.push("## Resultado");
    lines.push("");
    lines.push(`- **reviewStatus:** \`${output.reviewStatus}\``);
    lines.push(`- **overallPass:** ${summaryCounts.overallPass ? "si" : "no"} | **hasWarnings:** ${summaryCounts.hasWarnings ? "si" : "no"}`);
    lines.push(`- **findings:** ${output.findings.length} (critical: ${summaryCounts.criticalFindingsCount}, warning: ${summaryCounts.warningFindingsCount}, info: ${summaryCounts.infoFindingsCount})`);
    lines.push(`- **approvalRecommendation:** \`${output.approvalRecommendation.recommendedStatus}\` (riesgo: \`${output.approvalRecommendation.riskLevel}\`)`);
    lines.push("");
    lines.push(`**Resumen:** ${output.summary}`);
    lines.push("");

    lines.push("### Findings");
    lines.push("");
    if (output.findings.length === 0) {
      lines.push("_Sin findings._");
    } else {
      lines.push("| Categoria | Severidad | Descripcion |");
      lines.push("|---|---|---|");
      for (const f of output.findings) {
        lines.push(`| ${f.category} | ${f.severity} | ${escapeMarkdownTableCell(f.description)} |`);
      }
    }
    lines.push("");

    lines.push("### Unsupported claims");
    lines.push("");
    lines.push(fmtFindingsList(output.unsupportedClaims, "Sin afirmaciones sin respaldo detectadas."));
    lines.push("");

    lines.push("### Contradictions");
    lines.push("");
    lines.push(fmtFindingsList(output.contradictions, "Sin contradicciones detectadas."));
    lines.push("");

    lines.push("### Safety concerns");
    lines.push("");
    lines.push(fmtFindingsList(output.safetyConcerns, "Sin problemas de seguridad detectados."));
    lines.push("");

    lines.push("### Required corrections");
    lines.push("");
    lines.push(fmtFindingsList(output.requiredCorrections, "Sin correcciones requeridas."));
    lines.push("");

    lines.push("### Approval recommendation");
    lines.push("");
    lines.push(`- **recommendedStatus:** \`${output.approvalRecommendation.recommendedStatus}\``);
    lines.push(`- **riskLevel:** \`${output.approvalRecommendation.riskLevel}\``);
    lines.push(`- **rationale:** ${output.approvalRecommendation.rationale}`);
    lines.push("");

    lines.push("### Evidence");
    lines.push("");
    lines.push(fmtFindingsList(output.evidence, "Sin evidencia citada."));
    lines.push("");
  }

  lines.push(`_${artifact.note}_`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Contrato machine-readable que imprime scripts/run-qa-reviewer.ts al
 * final de cada ejecucion (linea `RUNNER_RESULT_JSON=...`) -- estructura
 * FIJA e IDENTICA en los 3 estados posibles de `qaStatus`, mismo patron
 * que RunnerResultSummary (src/core/landing-architect-comparison.ts).
 */
export interface QaReviewerRunnerResultSummary {
  artifactId: string;
  artifactType: string;
  sourceEmployee: string;
  artifactPath: string;
  qaStatus: QaReviewerResult["status"];
  /** Ruta del prompt preparado -- ruta deterministica, exista o no ya en disco en el momento de esta llamada concreta. */
  promptFilePath: string;
  /** Ruta donde el runner espera encontrar la respuesta de qa-reviewer si se le llama con --qa-reviewer-output. */
  expectedOutputPath: string;
  reviewJsonPath: string;
  reviewMdPath: string;
  /** null salvo que qaStatus sea "executed" (unico estado en el que existe una salida validada con findings que contar). */
  findingsCount: number | null;
}

export function buildQaReviewerRunnerResultSummary(
  identity: QaReviewedArtifactRef,
  paths: { promptFilePath: string; expectedOutputPath: string; reviewJsonPath: string; reviewMdPath: string },
  result: QaReviewerResult
): QaReviewerRunnerResultSummary {
  return {
    artifactId: identity.artifactId,
    artifactType: identity.artifactType,
    sourceEmployee: identity.sourceEmployee,
    artifactPath: identity.artifactPath,
    qaStatus: result.status,
    promptFilePath: paths.promptFilePath,
    expectedOutputPath: paths.expectedOutputPath,
    reviewJsonPath: paths.reviewJsonPath,
    reviewMdPath: paths.reviewMdPath,
    findingsCount: result.status === "executed" ? result.output.findings.length : null,
  };
}

/**
 * Parser TOOL (puro, sin I/O) de la linea `RUNNER_RESULT_JSON=...` de
 * qa-reviewer -- mismo patron que parseRunnerResultJson()
 * (src/core/runner-result-parser.ts), pero con la forma propia de
 * QaReviewerRunnerResultSummary en vez de la de landing-architect.
 * Fail-closed: cualquier campo obligatorio ausente o de tipo/enum
 * equivocado lanza.
 */
export function parseQaReviewerRunnerResultJson(jsonText: string): QaReviewerRunnerResultSummary {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`RUNNER_RESULT_JSON (qa-reviewer) no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("RUNNER_RESULT_JSON (qa-reviewer) invalido: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;
  const isString = (v: unknown): v is string => typeof v === "string";

  const REQUIRED_STRING_FIELDS = ["artifactId", "artifactType", "sourceEmployee", "artifactPath", "qaStatus", "promptFilePath", "expectedOutputPath", "reviewJsonPath", "reviewMdPath"] as const;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isString(o[field])) {
      throw new Error(`RUNNER_RESULT_JSON (qa-reviewer) invalido: falta el campo string "${field}".`);
    }
  }
  if (!["pending_execution", "executed", "invalid_output"].includes(o.qaStatus as string)) {
    throw new Error(`RUNNER_RESULT_JSON (qa-reviewer) invalido: qaStatus "${String(o.qaStatus)}" no es uno de los 3 valores esperados.`);
  }
  if (o.findingsCount !== null && typeof o.findingsCount !== "number") {
    throw new Error(`RUNNER_RESULT_JSON (qa-reviewer) invalido: findingsCount debe ser number o null, encontrado "${typeof o.findingsCount}".`);
  }

  return o as unknown as QaReviewerRunnerResultSummary;
}
