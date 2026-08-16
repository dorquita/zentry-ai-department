/**
 * Runner del empleado `seo-specialist` -- ver docs/claude-employee-runtime.md.
 *
 * Este script NUNCA llama a WordPress, staging, produccion, Google Ads,
 * GA4/GTM, Search Console, n8n ni ningun otro sistema externo. Solo lee
 * datos SEO ya persistidos localmente (data/jobs.jsonl,
 * config/seo-target-keywords.json, config/seo-clusters-catalog.json,
 * reports/seo/, reports/seo-director/, ver
 * src/employees/seo-specialist/context.ts) y escribe ficheros locales de
 * analisis bajo reports/seo-specialist/. Ninguna recomendacion se aplica.
 *
 * Dos pasos, porque el subagente es Claude Code (no una llamada de red
 * desde este proceso Node): este script no puede "invocar" al subagente
 * por si mismo.
 *
 *   Paso 1 (preparar):
 *     npm run seo-specialist:run
 *   Agrega los datos SEO locales disponibles en un
 *   `SeoSpecialistContext` y escribe un prompt ya listo (`prompt.md`)
 *   para pasarselo al subagente `seo-specialist`. El artefacto se guarda
 *   igualmente, con status = "pending_execution".
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su
 *   respuesta JSON en un fichero:
 *     npm run seo-specialist:run -- --runId <id> --seo-specialist-output <fichero.json>
 *   Valida esa salida, audita afirmaciones sin respaldo, y regenera el
 *   artefacto con status = "executed" (o "invalid_output" si la
 *   respuesta no tiene la forma esperada). --runId debe coincidir con el
 *   runId impreso por el paso 1 (mismo directorio de reports).
 */
import * as fs from "fs";
import * as path from "path";
import { buildSeoSpecialistContext, SeoSpecialistContext } from "../src/employees/seo-specialist/context";
import {
  auditSeoSpecialistOutputForUnsupportedClaims,
  buildRunnerResultSummary,
  buildSeoSpecialistArtifact,
  renderSeoSpecialistArtifactMarkdown,
  SeoSpecialistResult,
  validateSeoSpecialistOutput,
} from "../src/employees/seo-specialist/domain";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { renderSchemaContractSummary } from "../src/core/schema-contract-summary";
import { JsonSchemaLite } from "../src/core/json-schema-lite";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { resolveActiveClientPaths } from "../src/core/client-paths";

const AGENT_NAME = "seo-specialist";
/** Ruta (relativa al repo) del JSON Schema versionado del empleado -- la MISMA que recibe --json-schema y contra la que valida el runtime comun. */
const OUTPUT_SCHEMA_RELATIVE_PATH = `config/${AGENT_NAME}-output.schema.json`;

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

function generateRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `seo-specialist-${stamp}-${randomSuffix}`;
}

function buildPromptMarkdown(context: SeoSpecialistContext, runId: string): string {
  const projectRoot = path.join(__dirname, "..");
  const agentPath = path.join(projectRoot, ".claude", "agents", `${AGENT_NAME}.md`);
  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME} — run ${runId}`);
  lines.push("");
  lines.push("Este fichero es la union de: (1) instrucciones del subagente, (2) el contrato exacto de salida generado desde su JSON Schema versionado, (3) contexto estructurado agregado de datos SEO locales.");
  lines.push("Pegalo tal cual como prompt del subagente `seo-specialist`. El subagente no tiene herramientas -- todo lo que necesita esta aqui.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(agentInstructions.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Contrato exacto de salida (generado desde el JSON Schema versionado)");
  lines.push("");
  // Generado, nunca escrito a mano: es lo unico que impide que las
  // instrucciones en prosa del agente y el schema contra el que se valida
  // su respuesta se contradigan (ver src/core/schema-contract-summary.ts
  // para el incidente que lo motivo).
  const outputSchema = JSON.parse(fs.readFileSync(path.join(projectRoot, OUTPUT_SCHEMA_RELATIVE_PATH), "utf-8")) as JsonSchemaLite;
  lines.push(renderSchemaContractSummary(outputSchema, OUTPUT_SCHEMA_RELATIVE_PATH));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 3. Contexto estructurado (SeoSpecialistContext)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), respetando el contrato exacto de la seccion 2, sin texto adicional.');
  lines.push("");
  return lines.join("\n");
}

function resolveResult(seoOutputArg: string | undefined, outDir: string, context: SeoSpecialistContext, promptPath: string): SeoSpecialistResult {
  if (!seoOutputArg) {
    fs.writeFileSync(promptPath, buildPromptMarkdown(context, path.basename(outDir)), "utf-8");
    console.log(`seo-specialist: prompt preparado en ${promptPath}.`);
    console.log(`Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt, guardar su respuesta JSON, y volver a llamar con --runId ${path.basename(outDir)} --seo-specialist-output <fichero>.`);
    return { status: "pending_execution", promptFilePath: promptPath };
  }

  const outputPath = path.resolve(seoOutputArg);
  const rawText = fs.readFileSync(outputPath, "utf-8");
  const rawCopyPath = path.join(outDir, "output-raw-invalid.json");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown (```json ... ```) alrededor del
    // JSON -- ver extractJsonFromModelResponse en
    // src/core/claude-employee-runtime.ts.
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.writeFileSync(rawCopyPath, rawText, "utf-8");
    console.error(`seo-specialist: JSON invalido en ${outputPath}.`);
    return { status: "invalid_output", error: `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`, rawOutputPath: rawCopyPath };
  }

  try {
    const output = validateSeoSpecialistOutput(raw);
    const warnings = auditSeoSpecialistOutputForUnsupportedClaims(context, output);
    console.log(`seo-specialist: salida valida. Avisos de auditoria: ${warnings.length}.`);
    return { status: "executed", output, warnings };
  } catch (err) {
    fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`seo-specialist: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): aunque este runner nunca invoca al
  // subagente por si mismo (ver cabecera), se verifica igualmente que
  // seo-specialist sigue cumpliendo las 4 condiciones de "cero
  // herramientas" antes de preparar nada.
  assertSubagentIsToolless(AGENT_NAME);

  const runId = args.runId ?? generateRunId();
  if (args.runId === undefined && args["seo-specialist-output"] !== undefined) {
    throw new Error("--seo-specialist-output requiere --runId <id> (el mismo runId impreso por el paso 1) para saber en que directorio de reports/seo-specialist/ escribir.");
  }

  const outDir = path.join(resolveActiveClientPaths().reportsDir, "seo-specialist", runId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`SEO Specialist — analisis ${runId}`);

  const context = buildSeoSpecialistContext();
  const promptPath = path.join(outDir, "prompt.md");
  const expectedOutputPath = path.join(outDir, "output.json");

  const result = resolveResult(args["seo-specialist-output"], outDir, context, promptPath);

  const artifact = buildSeoSpecialistArtifact(runId, context, result);
  const jsonPath = path.join(outDir, "artifact.json");
  const mdPath = path.join(outDir, "artifact.md");
  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf-8");
  fs.writeFileSync(mdPath, renderSeoSpecialistArtifactMarkdown(artifact), "utf-8");

  console.log("");
  console.log(`Artefacto de analisis: ${mdPath}`);
  console.log(`(JSON: ${jsonPath})`);
  console.log("");
  console.log("Recordatorio: ninguna recomendacion se ha aplicado a WordPress/staging/produccion/Search Console. Solo lectura + reportes locales.");

  const resultSummary = buildRunnerResultSummary(
    runId,
    {
      promptFilePath: promptPath,
      expectedOutputPath,
      artifactJsonPath: jsonPath,
      artifactMdPath: mdPath,
    },
    result
  );
  console.log("RUNNER_RESULT_JSON=" + JSON.stringify(resultSummary));

  // Fail-closed para automatizacion: una salida invalida debe ser
  // detectable por codigo de salida (nunca silenciosa), aunque el
  // artefacto ya se haya guardado para inspeccion humana.
  if (result.status === "invalid_output") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
