/**
 * Runner de dos pasos del empleado Claude `sem-specialist` -- ver
 * docs/claude-employee-runtime.md.
 *
 * Este script NUNCA llama a Google Ads (ni a ningun otro sistema
 * externo). Solo lee el bus de eventos ya persistido
 * (data/department-events.jsonl, via readAllEvents()) y escribe ficheros
 * locales de reporte bajo reports/sem-specialist/. Ninguna propuesta se
 * aplica a Google Ads ni a ningun otro sistema.
 *
 * Dos pasos, porque sem-specialist es un subagente de Claude Code (no una
 * llamada de red desde este proceso Node): este script no puede "invocar"
 * al subagente por si mismo.
 *
 *   Paso 1 (preparar):
 *     npm run sem-specialist:run
 *   Lee el ULTIMO evento sem-watcher (agent_finished) del bus de eventos,
 *   construye el SemSpecialistContext y escribe un prompt ya listo
 *   (sem-specialist-prompt.md) para pasarselo al subagente `sem-specialist`.
 *   Si NO existe ningun evento sem-watcher todavia, este paso NO escribe
 *   ningun prompt y termina en un estado terminal "no_data" (no-op) --
 *   nunca se invoca al subagente sin un snapshot SEM real que darle.
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su respuesta
 *   JSON en un fichero:
 *     npm run sem-specialist:run -- --sem-specialist-output <fichero.json>
 *   Valida esa salida contra la forma esperada, audita afirmaciones
 *   cuantitativas (CPC/conversiones/ROAS/gasto/presupuesto) sin respaldo
 *   trazable en evidence[], y escribe el artefacto final con
 *   status = "executed" (o "invalid_output" si la respuesta no tiene la
 *   forma esperada o contiene una afirmacion sin respaldo).
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { readAllEvents } from "../src/core/department-events";
import { buildSemSpecialistContext, SemSpecialistContext } from "../src/employees/sem-specialist/sem-specialist-context";
import {
  auditSemSpecialistOutputForUnsupportedClaims,
  buildSemRunnerResultSummary,
  buildSemSpecialistArtifact,
  renderSemSpecialistMarkdown,
  SemResult,
  validateSemSpecialistOutput,
} from "../src/employees/sem-specialist/sem-specialist-output";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { resolveActiveClientPaths } from "../src/core/client-paths";

const AGENT_NAME = "sem-specialist";

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

function buildPromptMarkdown(context: SemSpecialistContext): string {
  const projectRoot = path.join(__dirname, "..");
  const agentPath = path.join(projectRoot, ".claude", "agents", `${AGENT_NAME}.md`);

  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME}`);
  lines.push("");
  lines.push(
    "Este fichero es la union de: (1) instrucciones del subagente, (2) contexto SEM estructurado (SemSpecialistContext), leido de la ultima ejecucion de sem-watcher registrada en el bus de eventos del departamento."
  );
  lines.push("Pegalo tal cual como prompt del subagente `sem-specialist`. El subagente no tiene herramientas -- todo lo que necesita esta aqui.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(agentInstructions.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Contexto estructurado (SemSpecialistContext)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional, sin markdown fences.');
  lines.push("");
  return lines.join("\n");
}

function resolveResult(outputArg: string | undefined, outDir: string, promptFilePath: string, context: SemSpecialistContext): SemResult {
  if (!outputArg) {
    fs.writeFileSync(promptFilePath, buildPromptMarkdown(context), "utf-8");
    console.log(`sem-specialist: prompt preparado en ${promptFilePath}.`);
    console.log(`Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt (herramienta Agent), guardar su respuesta JSON, y volver a llamar con --sem-specialist-output <fichero>.`);
    return { status: "pending_execution", promptFilePath };
  }

  const outputPath = path.resolve(outputArg);
  const rawText = fs.readFileSync(outputPath, "utf-8");
  const rawCopyPath = path.join(outDir, "sem-specialist-output-raw-invalid.json");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown (```json ... ```) alrededor del JSON
    // -- ver extractJsonFromModelResponse: la respuesta cruda de un
    // subagente Claude puede incluirlos aunque sus instrucciones pidan no
    // hacerlo (mismo caso real documentado para ux-ui-landing-architect-v2).
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.writeFileSync(rawCopyPath, rawText, "utf-8");
    const error = `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`sem-specialist: JSON invalido en ${outputPath}.`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath, violations: [] };
  }

  try {
    const output = validateSemSpecialistOutput(raw);
    const violations = auditSemSpecialistOutputForUnsupportedClaims(context, output);
    if (violations.length > 0) {
      fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
      console.error(`sem-specialist: salida rechazada -- ${violations.length} afirmacion(es) cuantitativa(s) sin respaldo trazable en evidence[].`);
      return {
        status: "invalid_output",
        error: `${violations.length} afirmacion(es) cuantitativa(s) sin respaldo en evidence[]: ${violations.join(" | ")}`,
        rawOutputPath: rawCopyPath,
        violations,
      };
    }
    console.log("sem-specialist: salida valida. 0 afirmaciones cuantitativas sin respaldo.");
    return { status: "executed", output };
  } catch (err) {
    fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`sem-specialist: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath, violations: [] };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): aunque este runner nunca invoca al
  // subagente por si mismo (ver cabecera), se verifica igualmente que
  // sem-specialist sigue cumpliendo las 4 condiciones de "cero
  // herramientas" antes de preparar nada.
  assertSubagentIsToolless(AGENT_NAME);

  const events = readAllEvents();
  const context = buildSemSpecialistContext(events);

  const dateDir = new Date().toISOString().slice(0, 10);
  const outDir = path.join(resolveActiveClientPaths().reportsDir, "sem-specialist", dateDir);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "sem-specialist-result.json");
  const mdPath = path.join(outDir, "sem-specialist-result.md");
  const promptFilePath = path.join(outDir, "sem-specialist-prompt.md");
  const expectedOutputPath = path.join(outDir, "sem-specialist-output.json");

  console.log("SEM Specialist — analisis de la ultima lectura registrada de sem-watcher.");

  let result: SemResult;
  if (!context) {
    console.log("sem-specialist: no hay ningun evento sem-watcher (agent_finished) registrado en data/department-events.jsonl todavia. No se genera ninguna propuesta (no-op, sin invocar a Claude).");
    result = { status: "no_data" };
  } else {
    console.log(`sem-specialist: usando snapshot de sem-watcher del evento ${context.sourceEventId} (${context.sourceGeneratedAt}).`);
    result = resolveResult(args["sem-specialist-output"], outDir, promptFilePath, context);
  }

  const artifact = buildSemSpecialistArtifact(context, result);
  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf-8");
  fs.writeFileSync(mdPath, renderSemSpecialistMarkdown(artifact), "utf-8");

  console.log("");
  console.log(`Artefacto: ${mdPath}`);
  console.log(`(JSON: ${jsonPath})`);
  console.log("");
  console.log("Recordatorio: sem-specialist NUNCA modifica campanas, presupuestos, keywords ni anuncios de Google Ads. Solo lectura + propuestas locales.");

  // Linea unica, machine-readable, con una estructura FIJA e identica en
  // los 4 estados de status -- ver SemRunnerResultSummary en
  // src/employees/sem-specialist/sem-specialist-output.ts.
  const resultSummary = buildSemRunnerResultSummary(context, { promptFilePath, expectedOutputPath, artifactJsonPath: jsonPath, artifactMdPath: mdPath }, result);
  console.log("RUNNER_RESULT_JSON=" + JSON.stringify(resultSummary));

  // Fail-closed para automatizacion: una salida invalida (forma incorrecta
  // O afirmacion cuantitativa sin respaldo) debe ser detectable por
  // codigo de salida, aunque el artefacto ya se haya guardado para
  // inspeccion humana.
  if (result.status === "invalid_output") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
