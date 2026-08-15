import { WebEngineerContext } from "./context";
import { WebEngineerOutput } from "./types";

/**
 * Contrato de resultado + artefacto del runner de `web-engineer` -- mismo
 * patron que V2Result/RunnerResultSummary/LandingArchitectComparisonArtifact
 * en src/core/landing-architect-comparison.ts, adaptado a este dominio
 * (sin comparacion V1/V2: web-engineer no tiene una version determinista
 * previa con la que comparar, solo produce UNA especificacion tecnica).
 *
 * Deliberadamente en un fichero PROPIO (no reutiliza
 * src/core/runner-result-parser.ts): ese modulo importa `RunnerResultSummary`
 * directamente de src/core/landing-architect-comparison.ts, acoplado a
 * los campos exactos de ese empleado (v2Status, expectedV2OutputPath...)
 * -- ver docs/claude-employee-runtime.md, "cada empleado define los
 * campos que tengan sentido para su dominio", no un contrato TypeScript
 * compartido.
 */
export type WebEngineerResult =
  | { status: "pending_execution"; promptFilePath: string }
  | { status: "invalid_output"; error: string; rawOutputPath: string }
  | { status: "executed"; output: WebEngineerOutput; capabilityAuditWarnings: string[] };

/**
 * Contrato machine-readable que imprime scripts/run-web-engineer.ts al
 * final de cada ejecucion (linea `RUNNER_RESULT_JSON=...`). Estructura
 * FIJA e IDENTICA en los 3 estados posibles de `status` -- quien
 * orquesta esto (.github/workflows/web-engineer.yml) no tiene que
 * ramificar su logica de lectura segun el estado para saber donde esta
 * cada fichero.
 */
export interface WebEngineerRunnerResultSummary {
  changePackId: string;
  keyword: string;
  status: WebEngineerResult["status"];
  /** Ruta del prompt preparado para web-engineer -- ruta deterministica, exista o no ya en disco en el momento de esta llamada concreta. */
  promptFilePath: string;
  /** Ruta donde el runner espera encontrar la respuesta de web-engineer si se le llama con --web-engineer-output. */
  expectedOutputPath: string;
  specJsonPath: string;
  specMdPath: string;
  /** null salvo que status sea "executed" (unico estado en el que existen capabilityAuditWarnings que contar). */
  capabilityAuditWarningCount: number | null;
}

export function buildWebEngineerRunnerResultSummary(
  changePackId: string,
  keyword: string,
  paths: { promptFilePath: string; expectedOutputPath: string; specJsonPath: string; specMdPath: string },
  result: WebEngineerResult
): WebEngineerRunnerResultSummary {
  return {
    changePackId,
    keyword,
    status: result.status,
    promptFilePath: paths.promptFilePath,
    expectedOutputPath: paths.expectedOutputPath,
    specJsonPath: paths.specJsonPath,
    specMdPath: paths.specMdPath,
    capabilityAuditWarningCount: result.status === "executed" ? result.capabilityAuditWarnings.length : null,
  };
}

/**
 * Busca la ULTIMA linea que empieza por `RUNNER_RESULT_JSON=` en un log
 * de texto (puede haber ruido de npm/ts-node antes o despues). Mismo
 * criterio que extractLastRunnerResultJsonLine() en
 * src/core/runner-result-parser.ts (fichero compartido, sin modificar):
 * la ULTIMA coincidencia es la unica garantia robusta de "la salida
 * final de esta ejecucion del runner".
 */
export function extractLastWebEngineerRunnerResultJsonLine(log: string): string | undefined {
  const matches = [...log.matchAll(/^RUNNER_RESULT_JSON=(.*)$/gm)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1];
}

/**
 * Valida (fail-closed, sin librerias externas) que el JSON parseado tiene
 * la forma minima de un WebEngineerRunnerResultSummary antes de confiar
 * en sus campos -- un runner roto que imprimiera JSON valido pero
 * incompleto no debe pasar desapercibido como si tuviera todas las rutas
 * esperadas.
 */
export function parseWebEngineerRunnerResultJson(jsonText: string): WebEngineerRunnerResultSummary {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`RUNNER_RESULT_JSON no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("RUNNER_RESULT_JSON invalido: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;
  const isString = (v: unknown): v is string => typeof v === "string";

  const REQUIRED_STRING_FIELDS = ["changePackId", "keyword", "status", "promptFilePath", "expectedOutputPath", "specJsonPath", "specMdPath"] as const;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isString(o[field])) {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo string "${field}".`);
    }
  }
  if (!["pending_execution", "executed", "invalid_output"].includes(o.status as string)) {
    throw new Error(`RUNNER_RESULT_JSON invalido: status "${String(o.status)}" no es uno de los 3 valores esperados.`);
  }
  if (o.capabilityAuditWarningCount !== null && typeof o.capabilityAuditWarningCount !== "number") {
    throw new Error(`RUNNER_RESULT_JSON invalido: capabilityAuditWarningCount debe ser number o null, encontrado "${typeof o.capabilityAuditWarningCount}".`);
  }

  return o as unknown as WebEngineerRunnerResultSummary;
}

/** Combina las dos funciones de arriba -- el punto de entrada que usa scripts/parse-web-engineer-runner-result-for-ci.ts. */
export function extractAndParseWebEngineerRunnerResult(log: string): WebEngineerRunnerResultSummary {
  const jsonText = extractLastWebEngineerRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseWebEngineerRunnerResultJson(jsonText);
}

// --- Artefacto de especificacion tecnica ---

export interface WebEngineerSpecArtifact {
  changePackId: string;
  generatedAt: string;
  input: WebEngineerContext;
  result: WebEngineerResult;
  note: string;
}

export function buildWebEngineerSpecArtifact(context: WebEngineerContext, result: WebEngineerResult): WebEngineerSpecArtifact {
  return {
    changePackId: context.changePackId,
    generatedAt: new Date().toISOString(),
    input: context,
    result,
    note: "Artefacto de solo lectura/especificacion. Ningun cambio descrito aqui se ha aplicado a WordPress, staging ni produccion. approvalRequired es siempre true (verificado por validateWebEngineerOutput) -- cualquier decision de ejecutar algo de esta especificacion la toma un humano, fuera de este sistema, nunca este runner ni el propio subagente.",
  };
}

function fmtProposedChange(c: { description: string; rationale: string; targetPageOrComponent: string }): string {
  return `**${c.targetPageOrComponent}** -- ${c.description} _(${c.rationale})_`;
}

export function renderWebEngineerSpecMarkdown(artifact: WebEngineerSpecArtifact): string {
  const lines: string[] = [];
  lines.push(`# Especificacion tecnica web-engineer — ${artifact.changePackId}`);
  lines.push("");
  lines.push(`- **Generado:** ${artifact.generatedAt}`);
  lines.push(`- **Keyword:** ${artifact.input.keyword}`);
  lines.push(`- **Marca:** ${artifact.input.targetBrand} | **Intencion:** ${artifact.input.brandIntent}`);
  lines.push(`- **targetWordpressPageId:** ${artifact.input.targetWordpressPageId ?? "(ninguno)"}`);
  lines.push("");
  lines.push("**Fase de solo especificacion. No se ha aplicado ningun cambio a WordPress/staging/produccion. approvalRequired es siempre true.**");
  lines.push("");

  lines.push("## Input (contexto estructurado entregado a web-engineer)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(artifact.input, null, 2));
  lines.push("```");
  lines.push("");

  lines.push("## Especificacion tecnica");
  lines.push("");
  if (artifact.result.status === "pending_execution") {
    lines.push(`- **Estado: pendiente de ejecucion.** Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("- Para completar la especificacion: invocar el subagente `web-engineer` con ese prompt y volver a ejecutar este runner con `--web-engineer-output <fichero-json-de-respuesta>`.");
  } else if (artifact.result.status === "invalid_output") {
    lines.push(`- **Estado: salida invalida.** ${artifact.result.error}`);
    lines.push(`- Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
  } else {
    const output = artifact.result.output;
    lines.push(`- **implementationSummary:** ${output.implementationSummary}`);
    lines.push(`- **targetPages:** ${output.targetPages.length > 0 ? output.targetPages.join(", ") : "(ninguna)"}`);
    lines.push(`- **targetComponents:** ${output.targetComponents.length > 0 ? output.targetComponents.join(", ") : "(ninguno)"}`);
    lines.push(`- **approvalRequired:** ${output.approvalRequired}`);
    lines.push("");
    lines.push("### proposedChanges");
    lines.push("");
    if (output.proposedChanges.length === 0) {
      lines.push("_(ninguno)_");
    } else {
      for (const change of output.proposedChanges) lines.push(`- ${fmtProposedChange(change)}`);
    }
    lines.push("");
    lines.push("### acceptanceCriteria");
    lines.push("");
    for (const c of output.acceptanceCriteria) lines.push(`- ${c}`);
    lines.push("");
    lines.push("### validationPlan");
    lines.push("");
    for (const c of output.validationPlan) lines.push(`- ${c}`);
    lines.push("");
    lines.push("### rollbackPlan");
    lines.push("");
    for (const c of output.rollbackPlan) lines.push(`- ${c}`);
    lines.push("");
    lines.push("### dependencies");
    lines.push("");
    if (output.dependencies.length === 0) {
      lines.push("_(ninguna)_");
    } else {
      for (const c of output.dependencies) lines.push(`- ${c}`);
    }
    lines.push("");
    lines.push("### unknowns");
    lines.push("");
    if (output.unknowns.length === 0) {
      lines.push("_(ninguno)_");
    } else {
      for (const c of output.unknowns) lines.push(`- ${c}`);
    }
    lines.push("");
    if (artifact.result.capabilityAuditWarnings.length > 0) {
      lines.push(`**⚠️ Auditoria de capacidad tecnica: ${artifact.result.capabilityAuditWarnings.length} aviso(s) para revision humana:**`);
      for (const warning of artifact.result.capabilityAuditWarnings) lines.push(`- ${warning}`);
    } else {
      lines.push("Auditoria de capacidad tecnica: sin avisos (ninguna afirmacion confiada de plugin/tema/API/pagina existente sin respaldo en el contexto).");
    }
  }
  lines.push("");

  lines.push(`_${artifact.note}_`);
  lines.push("");

  return lines.join("\n");
}
