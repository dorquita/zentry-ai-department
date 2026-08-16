/**
 * Runner de dos pasos del empleado Claude `analytics-specialist` -- ver
 * .claude/agents/analytics-specialist.md y docs/claude-employee-runtime.md.
 *
 * Este script NUNCA llama a GA4, GTM, WordPress, staging, produccion,
 * Google Ads, Search Console, n8n ni ningun otro sistema externo -- solo
 * lee el bus de eventos ya persistido (data/department-events.jsonl) y el
 * ultimo informe de analytics-watcher (reports/analytics/*.md), y escribe
 * ficheros locales de reporte bajo reports/analytics-specialist/. Ninguna
 * recomendacion se aplica a nada.
 *
 * Dos pasos, porque analytics-specialist es un subagente de Claude Code
 * (no una llamada de red desde este proceso Node):
 *
 *   Paso 1 (preparar):
 *     npm run analytics-specialist:run
 *   Construye el contexto real (ultimo snapshot de analytics-watcher) y
 *   escribe un prompt listo (`prompt.md`) para pasarselo al subagente
 *   `analytics-specialist`. Si nunca se ha ejecutado analytics-watcher en
 *   este repositorio (sin ningun evento "agent_finished" committeado), NO
 *   fabrica ningun contexto -- termina con status "no_analytics_data".
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su respuesta
 *   JSON en un fichero:
 *     npm run analytics-specialist:run -- --analytics-specialist-output <fichero.json>
 *   Valida esa salida contra AnalyticsSpecialistOutput, la audita
 *   (metricas inventadas, HYPOTHESIS con lenguaje causal, evidenceIds
 *   colgantes), y escribe el artefacto final (JSON + Markdown).
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { assertSnapshotUsable, resolveRequireLiveSources } from "../src/core/snapshot-freshness";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { buildAnalyticsSpecialistContext, AnalyticsSpecialistContextReady } from "../src/employees/analytics-specialist/context";
import { validateAnalyticsSpecialistOutput } from "../src/employees/analytics-specialist/validator";
import { auditAnalyticsSpecialistOutput } from "../src/employees/analytics-specialist/audit";
import { buildAnalyticsSpecialistArtifact, renderAnalyticsSpecialistMarkdown } from "../src/employees/analytics-specialist/artifact";
import { AnalyticsSpecialistResult, buildAnalyticsSpecialistRunnerResultSummary } from "../src/employees/analytics-specialist/runner-result";

const AGENT_NAME = "analytics-specialist";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

function buildPromptMarkdown(context: AnalyticsSpecialistContextReady): string {
  const projectRoot = path.join(__dirname, "..");
  const agentPath = path.join(projectRoot, ".claude", "agents", `${AGENT_NAME}.md`);
  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME} — departmentRunId ${context.departmentRunId}`);
  lines.push("");
  lines.push("Este fichero es la union de: (1) instrucciones del subagente, (2) contexto real de GA4/GTM ya leido por analytics-watcher.");
  lines.push("Pegalo tal cual como prompt del subagente `analytics-specialist`. El subagente no tiene herramientas -- todo lo que necesita esta aqui.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(agentInstructions.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  // Fase O50 -- antes de cualquier dato. Un especialista que lee primero
  // las tablas y despues la procedencia ya ha formado la conclusion
  // equivocada; la etiqueta de frescura va delante, no en una nota al pie.
  lines.push("## 2. PROCEDENCIA Y FRESCURA DE ESTOS DATOS (leer antes que las cifras)");
  lines.push("");
  lines.push(`- **Estado:** \`${context.freshness.status}\``);
  lines.push(`- **GA4/GTM se leyeron de verdad el:** ${context.sourceGeneratedAt}`);
  lines.push(
    `- **Antigüedad:** ${context.freshness.ageHours !== null ? `${context.freshness.ageHours} h` : "desconocida"} (umbral ${context.freshness.maxAgeHours} h)`
  );
  lines.push(`- **Generado en esta pasada:** ${context.freshness.producedInThisRun ? "SI" : "NO"}`);
  lines.push("");
  lines.push(context.freshness.humanSummary);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Contexto estructurado (AnalyticsSpecialistContext)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Mision"), sin texto adicional.');
  lines.push("");
  return lines.join("\n");
}

function outDirFor(departmentRunId: string): string {
  return path.join(resolveActiveClientPaths().reportsDir, "analytics-specialist", departmentRunId);
}

function resolveResult(outputArg: string | undefined, context: AnalyticsSpecialistContextReady, outDir: string): AnalyticsSpecialistResult {
  const promptPath = path.join(outDir, "prompt.md");
  const expectedOutputPath = path.join(outDir, "output.json");

  if (!outputArg) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(promptPath, buildPromptMarkdown(context), "utf-8");
    console.log(`analytics-specialist: prompt preparado en ${promptPath}.`);
    console.log(`Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt, guardar su respuesta JSON en ${expectedOutputPath}, y volver a llamar con --analytics-specialist-output ${expectedOutputPath}.`);
    return { status: "pending_execution", promptFilePath: promptPath, departmentRunId: context.departmentRunId };
  }

  const outputPath = path.resolve(outputArg);
  const rawText = fs.readFileSync(outputPath, "utf-8");
  const rawCopyPath = path.join(outDir, "output-raw-invalid.json");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown alrededor del JSON -- ver
    // extractJsonFromModelResponse en src/core/claude-employee-runtime.ts.
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(rawCopyPath, rawText, "utf-8");
    console.error(`analytics-specialist: JSON invalido en ${outputPath}.`);
    return { status: "invalid_output", error: `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`, rawOutputPath: rawCopyPath, departmentRunId: context.departmentRunId };
  }

  try {
    const output = validateAnalyticsSpecialistOutput(raw);
    const auditWarnings = auditAnalyticsSpecialistOutput(context, output);
    console.log(`analytics-specialist: salida valida. Avisos de auditoria: ${auditWarnings.length}.`);
    return { status: "executed", output, auditWarnings, departmentRunId: context.departmentRunId };
  } catch (err) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`analytics-specialist: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath, departmentRunId: context.departmentRunId };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): este runner nunca invoca al
  // subagente por si mismo (ver cabecera), pero se verifica igualmente
  // que analytics-specialist sigue cumpliendo las 4 condiciones de "cero
  // herramientas" antes de preparar nada.
  assertSubagentIsToolless(AGENT_NAME);

  const context = buildAnalyticsSpecialistContext();

  if (context.status === "no_data") {
    console.log(`analytics-specialist: sin datos suficientes -- ${context.reason}`);
    const resultSummary = buildAnalyticsSpecialistRunnerResultSummary(
      { promptFilePath: "", expectedOutputPath: "", artifactJsonPath: "", artifactMdPath: "" },
      { status: "no_analytics_data", reason: context.reason }
    );
    console.log("RUNNER_RESULT_JSON=" + JSON.stringify(resultSummary));
    // No es un fallo del runner: es un estado transitorio real (analytics-watcher
    // todavia no se ha ejecutado nunca en este repositorio) -- exit 0 a
    // proposito, para que el workflow pueda distinguirlo de un error real.
    return;
  }

  // Fase O50 -- fail-closed opcional. Con REQUIRE_LIVE_SOURCES=true, un
  // snapshot que no sea de esta pasada corta aqui con un error explicito
  // en vez de dejar que el especialista razone sobre historico creyendo
  // que es el estado actual. Sin la variable, el snapshot se sigue
  // usando -- pero SIEMPRE etiquetado con su procedencia real en el
  // prompt (seccion 2), nunca disfrazado de live.
  assertSnapshotUsable("analytics-watcher (GA4/GTM)", context.freshness, {
    requireLive: resolveRequireLiveSources(),
  });

  const outDir = outDirFor(context.departmentRunId);
  console.log(`Analytics Specialist — analizando departmentRunId ${context.departmentRunId} (GA4 conectado=${context.ga4Connected}, GTM conectado=${context.gtmConnected})`);
  console.log(
    `Procedencia del snapshot: ${context.freshness.status} (leido el ${context.sourceGeneratedAt}` +
      `${context.freshness.ageHours !== null ? `, hace ${context.freshness.ageHours} h` : ""}).`
  );

  const result = resolveResult(args["analytics-specialist-output"], context, outDir);

  const artifactJsonPath = path.join(outDir, "artifact.json");
  const artifactMdPath = path.join(outDir, "artifact.md");

  if (result.status === "executed" || result.status === "invalid_output") {
    const artifact = buildAnalyticsSpecialistArtifact(context, result);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(artifactJsonPath, JSON.stringify(artifact, null, 2), "utf-8");
    fs.writeFileSync(artifactMdPath, renderAnalyticsSpecialistMarkdown(artifact), "utf-8");
    console.log("");
    console.log(`Artefacto: ${artifactMdPath}`);
    console.log(`(JSON: ${artifactJsonPath})`);
  }

  console.log("");
  console.log("Recordatorio: no se ha modificado GA4 ni GTM. Solo lectura + reportes locales.");

  const resultSummary = buildAnalyticsSpecialistRunnerResultSummary(
    { promptFilePath: path.join(outDir, "prompt.md"), expectedOutputPath: path.join(outDir, "output.json"), artifactJsonPath, artifactMdPath },
    result
  );
  console.log("RUNNER_RESULT_JSON=" + JSON.stringify(resultSummary));

  // Fail-closed para automatizacion: una salida invalida debe ser
  // detectable por codigo de salida, aunque el artefacto ya se haya
  // guardado para inspeccion humana.
  if (result.status === "invalid_output") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
