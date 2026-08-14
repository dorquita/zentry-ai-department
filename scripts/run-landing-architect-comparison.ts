/**
 * Runner de comparacion UX/UI Landing Architect V1 (determinista) vs V2
 * (subagente Claude) -- ver docs/ux-ui-landing-architect-v2-experiment.md.
 *
 * Este script NUNCA llama a WordPress, staging, produccion, Google Ads,
 * GA4/GTM, Search Console, n8n ni ningun otro sistema externo. Solo lee
 * change packs ya existentes (data/change-packs.jsonl) y escribe
 * ficheros locales de reporte bajo reports/ux-ui-landing-comparison/.
 * Ninguna de las dos propuestas (V1 o V2) se aplica a nada.
 *
 * Dos pasos, porque V2 es un subagente de Claude Code (no una llamada
 * de red desde este proceso Node): este script no puede "invocar" al
 * subagente por si mismo.
 *
 *   Paso 1 (preparar):
 *     npm run landing-architect:compare -- --changePackId <id>
 *   Calcula V1 de verdad, construye el contexto estructurado de V2 y
 *   escribe un prompt ya listo (`v2-prompt.md`) para pasarselo al
 *   subagente `ux-ui-landing-architect-v2` (p.ej. desde una sesion de
 *   Claude Code, con la herramienta Agent). El artefacto de comparacion
 *   se guarda igualmente, con v2.status = "pending_execution".
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su
 *   respuesta JSON en un fichero:
 *     npm run landing-architect:compare -- --changePackId <id> --v2-output <fichero.json>
 *   Valida esa salida, audita fabricacion de datos, y regenera el
 *   artefacto de comparacion con v2.status = "executed" (o
 *   "invalid_output" si la respuesta no tiene la forma esperada).
 *
 * Sin --changePackId, elige UN change pack elegible AL AZAR
 * (ready_for_review / approved_to_execute) -- ver
 * src/core/landing-architect-change-pack-selection.ts. Aleatorio (no
 * "el primero") a proposito: una ejecucion automatica recurrente (ver
 * docs/ux-ui-landing-architect-v2-experiment.md, "Ejecucion autonoma en
 * Claude Cloud") que siempre comparase el mismo change pack no aportaria
 * cobertura nueva dia a dia.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { readCurrentChangePacks, findChangePackById } from "../src/core/change-packs";
import { buildBlueprintInput } from "../src/agents/ux-ui-landing-architect";
import { buildLandingArchitectContext } from "../src/core/landing-architect-v2-context";
import { selectRandomEligibleChangePack } from "../src/core/landing-architect-change-pack-selection";
import { auditV2OutputForFabrication, buildComparisonArtifact, extractJsonFromModelResponse, renderComparisonMarkdown, validateV2Output, V2Result } from "../src/core/landing-architect-comparison";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { ChangePack } from "../src/core/types";

const AGENT_NAME = "ux-ui-landing-architect-v2";

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
  const selected = selectRandomEligibleChangePack(readCurrentChangePacks());
  if (!selected) {
    throw new Error("No hay ningun change pack elegible (ready_for_review / approved_to_execute). Pasa --changePackId <id> explicitamente o genera change packs primero.");
  }
  return selected;
}

function buildV2PromptMarkdown(context: ReturnType<typeof buildLandingArchitectContext>, changePackId: string): string {
  const projectRoot = path.join(__dirname, "..");
  const skillPath = path.join(projectRoot, ".claude", "skills", "zentry-brand", "SKILL.md");
  const agentPath = path.join(projectRoot, ".claude", "agents", `${AGENT_NAME}.md`);

  const skillContent = fs.readFileSync(skillPath, "utf-8");
  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME} — changePack ${changePackId}`);
  lines.push("");
  lines.push("Este fichero es la union de: (1) instrucciones del subagente, (2) skill zentry-brand, (3) contexto estructurado del change pack.");
  lines.push("Pegalo tal cual como prompt del subagente `ux-ui-landing-architect-v2` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.");
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
  lines.push("## 3. Contexto estructurado (LandingArchitectContext)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion \"Que debes producir\"), sin texto adicional.");
  lines.push("");
  return lines.join("\n");
}

function resolveV2Result(v2OutputArg: string | undefined, outDir: string, context: ReturnType<typeof buildLandingArchitectContext>, changePack: ChangePack): V2Result {
  if (!v2OutputArg) {
    const promptPath = path.join(outDir, "v2-prompt.md");
    const expectedOutputPath = path.join(outDir, "v2-output.json");
    fs.writeFileSync(promptPath, buildV2PromptMarkdown(context, changePack.changePackId), "utf-8");
    console.log(`V2: prompt preparado en ${promptPath}.`);
    console.log(`Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt (herramienta Agent), guardar su respuesta JSON en ${expectedOutputPath}, y volver a llamar con --v2-output ${expectedOutputPath}.`);
    return { status: "pending_execution", promptFilePath: promptPath };
  }

  const v2OutputPath = path.resolve(v2OutputArg);
  const rawText = fs.readFileSync(v2OutputPath, "utf-8");
  const rawCopyPath = path.join(outDir, "v2-output-raw-invalid.json");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown (```json ... ```) alrededor del
    // JSON -- ver extractJsonFromModelResponse: la respuesta cruda de un
    // subagente Claude puede incluirlos aunque sus instrucciones pidan
    // no hacerlo (ver caso real documentado en
    // docs/ux-ui-landing-architect-v2-experiment.md).
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.writeFileSync(rawCopyPath, rawText, "utf-8");
    console.error(`V2: JSON invalido en ${v2OutputPath}.`);
    return { status: "invalid_output", error: `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`, rawOutputPath: rawCopyPath };
  }

  try {
    const output = validateV2Output(raw);
    const fabricationWarnings = auditV2OutputForFabrication(context, output);
    console.log(`V2: salida valida. Avisos de posible fabricacion de datos: ${fabricationWarnings.length}.`);
    return { status: "executed", output, fabricationWarnings };
  } catch (err) {
    fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`V2: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const changePack = resolveTargetChangePack(args.changePackId);

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): aunque este runner nunca invoca al
  // subagente por si mismo (ver cabecera), se verifica igualmente que
  // ux-ui-landing-architect-v2 sigue cumpliendo las 4 condiciones de
  // "cero herramientas" (allowlist presente, allowedTools/externalWriteToolsGranted
  // vacios, frontmatter tools: [] ) antes de preparar nada. Cualquier
  // inconsistencia aborta con el motivo exacto.
  assertSubagentIsToolless(AGENT_NAME);

  const outDir = path.join(resolveActiveClientPaths().reportsDir, "ux-ui-landing-comparison", changePack.changePackId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`UX/UI Landing Architect — comparacion V1 vs V2 para ${changePack.changePackId} ("${changePack.keyword}")`);

  // --- V1: determinista, se ejecuta siempre de verdad (funcion pura ya existente) ---
  const v1Output = buildBlueprintInput(changePack);

  // --- V2: contexto estructurado, siempre se construye; la ejecucion del modelo es manual (ver cabecera) ---
  const context = buildLandingArchitectContext(changePack);

  const v2Result = resolveV2Result(args["v2-output"], outDir, context, changePack);

  const artifact = buildComparisonArtifact(context, v1Output, v2Result);
  const jsonPath = path.join(outDir, "comparison.json");
  const mdPath = path.join(outDir, "comparison.md");
  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf-8");
  fs.writeFileSync(mdPath, renderComparisonMarkdown(artifact), "utf-8");

  console.log("");
  console.log(`Artefacto de comparacion: ${mdPath}`);
  console.log(`(JSON: ${jsonPath})`);
  console.log("");
  console.log("Recordatorio: ninguna de las dos propuestas se ha aplicado a WordPress/staging/produccion. Solo lectura + reportes locales.");

  // Linea unica, machine-readable, para que una sesion Claude Cloud
  // orquestando este runner (ver docs/ux-ui-landing-architect-v2-experiment.md,
  // "Ejecucion autonoma en Claude Cloud") no tenga que parsear el resto
  // de la salida en texto libre para saber que paso toca a continuacion
  // ni cuantos avisos de fabricacion hubo.
  console.log(
    "RUNNER_RESULT_JSON=" +
      JSON.stringify({
        changePackId: changePack.changePackId,
        keyword: changePack.keyword,
        v2Status: v2Result.status,
        fabricationWarningCount: v2Result.status === "executed" ? v2Result.fabricationWarnings.length : null,
        comparisonJsonPath: jsonPath,
        comparisonMdPath: mdPath,
      })
  );

  // Fail-closed para automatizacion: una salida V2 invalida debe ser
  // detectable por codigo de salida (nunca silenciosa), aunque el
  // artefacto ya se haya guardado para inspeccion humana.
  if (v2Result.status === "invalid_output") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
