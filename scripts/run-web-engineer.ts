/**
 * Runner del empleado Claude `web-engineer` -- convierte un ChangePack ya
 * aprobable en una especificacion tecnica implementable (ver
 * .claude/agents/web-engineer.md y docs/claude-employee-runtime.md).
 *
 * Este script NUNCA llama a WordPress, staging, produccion, Google Ads,
 * GA4/GTM, Search Console, n8n ni ningun otro sistema externo. Solo lee
 * registros YA existentes (data/change-packs.jsonl,
 * data/existing-page-audit.jsonl, data/staging-qa-results.jsonl) y
 * escribe ficheros locales de reporte bajo reports/web-engineer/. Ninguna
 * especificacion se aplica a nada -- approvalRequired es siempre true.
 *
 * Dos pasos, porque `web-engineer` es un subagente de Claude Code (no una
 * llamada de red desde este proceso Node): este script no puede
 * "invocar" al subagente por si mismo.
 *
 *   Paso 1 (preparar):
 *     npm run web-engineer:run -- --changePackId <id>
 *   Construye el contexto estructurado (enriquecido con
 *   existing-page-audit / staging-qa-results cuando hay datos reales
 *   disponibles para ese ChangePack) y escribe un prompt ya listo
 *   (`prompt.md`) para pasarselo al subagente `web-engineer`. El
 *   artefacto de especificacion se guarda igualmente, con
 *   status = "pending_execution".
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su
 *   respuesta JSON en un fichero:
 *     npm run web-engineer:run -- --changePackId <id> --web-engineer-output <fichero.json>
 *   Valida esa salida (fail-closed, incluida la regla approvalRequired
 *   === true), audita afirmaciones de capacidad tecnica no confirmadas,
 *   y regenera el artefacto con status = "executed" (o "invalid_output"
 *   si la respuesta no tiene la forma esperada).
 *
 * Sin --changePackId, elige UN ChangePack elegible AL AZAR
 * (ready_for_review / approved_to_execute) -- ver
 * src/employees/web-engineer/change-pack-selection.ts.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { readCurrentChangePacks, findChangePackById } from "../src/core/change-packs";
import { readCurrentExistingPageAudits } from "../src/core/existing-page-audit";
import { readCurrentStagingQaResults } from "../src/core/staging-qa-results";
import { buildWebEngineerContext, WebEngineerContext } from "../src/employees/web-engineer/context";
import { selectRandomEligibleChangePackForWebEngineer } from "../src/employees/web-engineer/change-pack-selection";
import { auditWebEngineerOutputForUnconfirmedCapabilities, validateWebEngineerOutput } from "../src/employees/web-engineer/validator";
import { buildWebEngineerRunnerResultSummary, buildWebEngineerSpecArtifact, renderWebEngineerSpecMarkdown, WebEngineerResult } from "../src/employees/web-engineer/runner-result";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { ChangePack } from "../src/core/types";

const AGENT_NAME = "web-engineer";

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

function resolveTargetChangePack(changePackId: string | undefined): ChangePack {
  if (changePackId) {
    const found = findChangePackById(changePackId);
    if (!found) throw new Error(`No existe ningun change pack con id "${changePackId}". Usa "npm run change-packs:list" para ver los disponibles.`);
    return found;
  }
  const selected = selectRandomEligibleChangePackForWebEngineer(readCurrentChangePacks());
  if (!selected) {
    throw new Error("No hay ningun change pack elegible (ready_for_review / approved_to_execute). Pasa --changePackId <id> explicitamente o genera change packs primero.");
  }
  return selected;
}

function buildPromptMarkdown(context: WebEngineerContext, changePackId: string): string {
  const projectRoot = path.join(__dirname, "..");
  const agentPath = path.join(projectRoot, ".claude", "agents", `${AGENT_NAME}.md`);

  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME} — changePack ${changePackId}`);
  lines.push("");
  lines.push("Este fichero es la union de: (1) instrucciones del subagente, (2) contexto estructurado del change pack.");
  lines.push("Pegalo tal cual como prompt del subagente `web-engineer` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(agentInstructions.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Contexto estructurado (WebEngineerContext)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional.');
  lines.push("");
  return lines.join("\n");
}

function resolveWebEngineerResult(outputArg: string | undefined, outDir: string, context: WebEngineerContext): WebEngineerResult {
  if (!outputArg) {
    const promptPath = path.join(outDir, "prompt.md");
    const expectedOutputPath = path.join(outDir, "web-engineer-output.json");
    fs.writeFileSync(promptPath, buildPromptMarkdown(context, context.changePackId), "utf-8");
    console.log(`web-engineer: prompt preparado en ${promptPath}.`);
    console.log(`Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt (herramienta Agent), guardar su respuesta JSON en ${expectedOutputPath}, y volver a llamar con --web-engineer-output ${expectedOutputPath}.`);
    return { status: "pending_execution", promptFilePath: promptPath };
  }

  const outputPath = path.resolve(outputArg);
  const rawText = fs.readFileSync(outputPath, "utf-8");
  const rawCopyPath = path.join(outDir, "web-engineer-output-raw-invalid.json");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown (```json ... ```) alrededor del
    // JSON -- ver extractJsonFromModelResponse: la respuesta cruda de un
    // subagente Claude puede incluirlos aunque sus instrucciones pidan
    // no hacerlo.
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.writeFileSync(rawCopyPath, rawText, "utf-8");
    console.error(`web-engineer: JSON invalido en ${outputPath}.`);
    return { status: "invalid_output", error: `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`, rawOutputPath: rawCopyPath };
  }

  try {
    const output = validateWebEngineerOutput(raw);
    const capabilityAuditWarnings = auditWebEngineerOutputForUnconfirmedCapabilities(context, output);
    console.log(`web-engineer: salida valida (approvalRequired=${output.approvalRequired}). Avisos de capacidad tecnica no confirmada: ${capabilityAuditWarnings.length}.`);
    return { status: "executed", output, capabilityAuditWarnings };
  } catch (err) {
    fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`web-engineer: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const changePack = resolveTargetChangePack(args.changePackId);

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): aunque este runner nunca invoca al
  // subagente por si mismo (ver cabecera), se verifica igualmente que
  // web-engineer sigue cumpliendo las 4 condiciones de "cero
  // herramientas" antes de preparar nada.
  assertSubagentIsToolless(AGENT_NAME);

  const outDir = path.join(resolveActiveClientPaths().reportsDir, "web-engineer", changePack.changePackId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`web-engineer — especificacion tecnica para ${changePack.changePackId} ("${changePack.keyword}")`);

  // Enriquecimiento con contexto tecnico real ya existente en el repo
  // (nunca llamadas en vivo a WordPress/staging/produccion, ver
  // cabecera de este fichero) -- solo lectores locales ya existentes.
  const existingPageAudits = readCurrentExistingPageAudits();
  const stagingQaResults = readCurrentStagingQaResults();
  const context = buildWebEngineerContext(changePack, existingPageAudits, stagingQaResults);

  const result = resolveWebEngineerResult(args["web-engineer-output"], outDir, context);

  const artifact = buildWebEngineerSpecArtifact(context, result);
  const specJsonPath = path.join(outDir, "spec.json");
  const specMdPath = path.join(outDir, "spec.md");
  fs.writeFileSync(specJsonPath, JSON.stringify(artifact, null, 2), "utf-8");
  fs.writeFileSync(specMdPath, renderWebEngineerSpecMarkdown(artifact), "utf-8");

  console.log("");
  console.log(`Artefacto de especificacion: ${specMdPath}`);
  console.log(`(JSON: ${specJsonPath})`);
  console.log("");
  console.log("Recordatorio: ninguna especificacion de este empleado se ha aplicado a WordPress/staging/produccion. Solo lectura + reportes locales. approvalRequired es siempre true.");

  // Linea unica, machine-readable, con una estructura FIJA e identica en
  // los 3 estados de status -- ver WebEngineerRunnerResultSummary en
  // src/employees/web-engineer/runner-result.ts.
  const resultSummary = buildWebEngineerRunnerResultSummary(
    changePack.changePackId,
    changePack.keyword,
    {
      promptFilePath: path.join(outDir, "prompt.md"),
      expectedOutputPath: path.join(outDir, "web-engineer-output.json"),
      specJsonPath,
      specMdPath,
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
