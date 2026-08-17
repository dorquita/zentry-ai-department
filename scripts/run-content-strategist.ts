/**
 * Runner de dos pasos del empleado Claude `content-strategist` -- ver
 * docs/claude-employee-runtime.md y .claude/agents/content-strategist.md.
 *
 * Este script NUNCA llama a WordPress, staging, produccion, Google Ads,
 * GA4/GTM, Search Console, n8n ni ningun otro sistema externo. Solo lee
 * change packs de contenido ya existentes (data/change-packs.jsonl,
 * generados por el pipeline determinista
 * src/agents/content-work-order-builder.ts ->
 * src/agents/content-change-pack-builder.ts) y escribe ficheros locales
 * de reporte bajo reports/content-strategist/. Ningun brief se aplica a
 * nada ni se redacta como articulo final.
 *
 * Dos pasos, porque `content-strategist` es un subagente de Claude Code
 * (no una llamada de red desde este proceso Node): este script no puede
 * "invocar" al subagente por si mismo.
 *
 *   Paso 1 (preparar):
 *     npm run content-strategist:run -- --changePackId <id>
 *   Selecciona un change pack de contenido elegible, construye el
 *   contexto estructurado y escribe un prompt ya listo (`prompt.md`)
 *   para pasarselo al subagente `content-strategist`. El artefacto del
 *   brief se guarda igualmente, con status "pending_execution".
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su
 *   respuesta JSON en un fichero:
 *     npm run content-strategist:run -- --changePackId <id> --content-strategist-output <fichero.json>
 *   Valida esa salida, audita afirmaciones sin respaldo/enlaces
 *   inventados, y regenera el artefacto del brief con status "executed"
 *   (o "invalid_output" si la respuesta no tiene la forma esperada).
 *
 * Sin --changePackId, elige UN change pack de contenido elegible AL AZAR
 * (ready_for_review / approved_to_execute, changeType
 * new_content_page/content_update) -- ver
 * src/employees/content-strategist/selection.ts. Si no hay NINGUNO
 * elegible, el runner NO fabrica ninguna oportunidad: termina con
 * status "no_eligible_work" (codigo de salida 0, no es un fallo real)
 * -- ver src/employees/content-strategist/brief.ts.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { renderPreviousHumanFeedback } from "../src/approvals/human-feedback-context";
import { loadPreviousHumanFeedbackFromState } from "../src/approvals/manual/state-decision-reader";
import { readCurrentChangePacks, findChangePackById } from "../src/core/change-packs";
import { buildContentStrategistContext, ContentStrategistContext } from "../src/employees/content-strategist/context";
import { ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY, isContentChangePack, selectRandomEligibleChangePackForContentStrategy } from "../src/employees/content-strategist/selection";
import { validateContentStrategistOutput } from "../src/employees/content-strategist/output";
import { auditContentStrategistOutputForUnsupportedClaims } from "../src/employees/content-strategist/audit";
import { buildBriefArtifact, buildRunnerResultSummary, ContentStrategistResult, renderBriefMarkdown } from "../src/employees/content-strategist/brief";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { ChangePack } from "../src/core/types";

const AGENT_NAME = "content-strategist";

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

function resolveTargetChangePack(changePackId: string | undefined): ChangePack | undefined {
  if (changePackId) {
    const found = findChangePackById(changePackId);
    if (!found) throw new Error(`No existe ningun change pack con id "${changePackId}". Usa "npm run change-packs:list" para ver los disponibles.`);
    // Fail-closed incluso en el override manual (--changePackId): un ID
    // explicito de un change pack de OTRO dominio (p.ej. SEO
    // "seo_on_page_update" o CRO "cro_conversion_update") no debe colarse
    // -- buildContentStrategistContext() degradaria en silencio sus
    // campos especificos de contenido (primaryKeyword, structure, cta...)
    // a valores por defecto vacios, produciendo un brief con apariencia
    // valida montado sobre un change pack que nunca fue un item de
    // contenido. La seleccion automatica (mas abajo) ya aplica este mismo
    // filtro via filterEligibleChangePacksForContentStrategy -- este
    // chequeo cierra el mismo hueco para el override manual.
    if (!isContentChangePack(found)) {
      throw new Error(
        `El change pack "${changePackId}" no es de CONTENIDO (changeType="${found.changeType}") -- content-strategist solo puede procesar changeType [${ELIGIBLE_CHANGE_TYPES_FOR_CONTENT_STRATEGY.join(", ")}]. Usa "npm run change-packs:list" para ver los disponibles.`
      );
    }
    return found;
  }
  return selectRandomEligibleChangePackForContentStrategy(readCurrentChangePacks());
}

async function buildPromptMarkdown(context: ContentStrategistContext): Promise<string> {
  const projectRoot = path.join(__dirname, "..");
  const skillPath = path.join(projectRoot, ".claude", "skills", "zentry-brand", "SKILL.md");
  const agentPath = path.join(projectRoot, ".claude", "agents", `${AGENT_NAME}.md`);

  const skillContent = fs.readFileSync(skillPath, "utf-8");
  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME} — changePack ${context.changePackId}`);
  lines.push("");
  lines.push("Este fichero es la union de: (1) instrucciones del subagente, (2) skill zentry-brand, (3) contexto estructurado del change pack de contenido.");
  lines.push("Pegalo tal cual como prompt del subagente `content-strategist` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(agentInstructions.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Skill: zentry-brand");
  lines.push("");
  lines.push(skillContent.trim());
  lines.push("");
  lines.push("---");
  lines.push("");

  // Rechazos humanos anteriores, LITERALES. Van delante del contexto: si
  // una persona ya dijo por que no le valia una propuesta, eso se lee
  // antes de volver a redactar sobre lo mismo.
  const feedbackBlock = renderPreviousHumanFeedback(await loadPreviousHumanFeedbackFromState());
  if (feedbackBlock) {
    lines.push(feedbackBlock.replace(/^## /, "## 3. ").trimEnd());
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## 4. Contexto estructurado (ContentStrategistContext)");
  } else {
    lines.push("## 3. Contexto estructurado (ContentStrategistContext)");
  }
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional.');
  lines.push("");
  return lines.join("\n");
}

async function resolveContentStrategistResult(
  outputArg: string | undefined,
  paths: { promptFilePath: string; expectedOutputPath: string; rawOutputPath: string },
  context: ContentStrategistContext
): Promise<ContentStrategistResult> {
  if (!outputArg) {
    fs.writeFileSync(paths.promptFilePath, await buildPromptMarkdown(context), "utf-8");
    console.log(`content-strategist: prompt preparado en ${paths.promptFilePath}.`);
    console.log(`Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt (herramienta Agent), guardar su respuesta JSON en ${paths.expectedOutputPath}, y volver a llamar con --content-strategist-output ${paths.expectedOutputPath}.`);
    return { status: "pending_execution", promptFilePath: paths.promptFilePath };
  }

  const outputPath = path.resolve(outputArg);
  const rawText = fs.readFileSync(outputPath, "utf-8");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown (```json ... ```) alrededor del
    // JSON -- ver extractJsonFromModelResponse (runtime comun): la
    // respuesta cruda de un subagente Claude puede incluirlos aunque sus
    // instrucciones pidan no hacerlo.
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.writeFileSync(paths.rawOutputPath, rawText, "utf-8");
    console.error(`content-strategist: JSON invalido en ${outputPath}.`);
    return { status: "invalid_output", error: `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`, rawOutputPath: paths.rawOutputPath };
  }

  try {
    const output = validateContentStrategistOutput(raw);
    const auditWarnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
    console.log(`content-strategist: salida valida. Avisos de auditoria (afirmaciones sin respaldo / enlaces sin respaldo): ${auditWarnings.length}.`);
    return { status: "executed", output, auditWarnings };
  } catch (err) {
    fs.writeFileSync(paths.rawOutputPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`content-strategist: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: paths.rawOutputPath };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): aunque este runner nunca invoca al
  // subagente por si mismo (ver cabecera), se verifica igualmente que
  // content-strategist sigue cumpliendo las 4 condiciones de "cero
  // herramientas" antes de preparar nada, incluso en el caso
  // "no_eligible_work" en el que no hay ningun prompt que construir.
  assertSubagentIsToolless(AGENT_NAME);

  const changePack = resolveTargetChangePack(args.changePackId);

  if (!changePack) {
    console.log("content-strategist: no hay ningun change pack de contenido elegible (ready_for_review / approved_to_execute, changeType new_content_page/content_update). No se genera ninguna oportunidad inventada.");
    const result: ContentStrategistResult = { status: "no_eligible_work" };
    const resultSummary = buildRunnerResultSummary(undefined, undefined, result);
    console.log("RUNNER_RESULT_JSON=" + JSON.stringify(resultSummary));
    return;
  }

  const outDir = path.join(resolveActiveClientPaths().reportsDir, "content-strategist", changePack.changePackId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`content-strategist — brief de contenido para ${changePack.changePackId} ("${changePack.keyword}")`);

  const context = buildContentStrategistContext(changePack);

  const paths = {
    promptFilePath: path.join(outDir, "prompt.md"),
    expectedOutputPath: path.join(outDir, "output.json"),
    rawOutputPath: path.join(outDir, "output-raw-invalid.json"),
  };

  const result = await resolveContentStrategistResult(args["content-strategist-output"], paths, context);

  const artifact = buildBriefArtifact(context, result);
  const jsonPath = path.join(outDir, "brief.json");
  const mdPath = path.join(outDir, "brief.md");
  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf-8");
  fs.writeFileSync(mdPath, renderBriefMarkdown(artifact), "utf-8");

  console.log("");
  console.log(`Artefacto del brief: ${mdPath}`);
  console.log(`(JSON: ${jsonPath})`);
  console.log("");
  console.log("Recordatorio: ningun brief se ha publicado en WordPress/staging/produccion. Solo lectura + reportes locales.");

  // Linea unica, machine-readable, con una estructura FIJA e identica en
  // los 4 estados de status -- ver ContentStrategistRunnerResultSummary
  // en src/employees/content-strategist/brief.ts.
  const resultSummary = buildRunnerResultSummary(
    { changePackId: changePack.changePackId, keyword: changePack.keyword },
    { promptFilePath: paths.promptFilePath, expectedOutputPath: paths.expectedOutputPath, artifactJsonPath: jsonPath, artifactMdPath: mdPath },
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
