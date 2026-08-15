/**
 * Runner de dos pasos para el empleado Claude `growth-director-v2` (ver
 * docs/claude-employee-runtime.md, `.claude/agents/growth-director-v2.md`).
 *
 * Este script NUNCA llama a WordPress, staging, produccion, Google Ads,
 * GA4/GTM, Search Console, n8n ni ningun otro sistema externo. Solo lee
 * registros ya existentes del departamento (action backlog, work
 * orders, change packs, approval requests, jobs, eventos -- todos via
 * `src/employees/growth-director-v2/context.ts`, que REUTILIZA las
 * mismas funciones lectoras que ya usa el agente v1 determinista
 * `src/agents/growth-director.ts`) y escribe ficheros locales de reporte
 * bajo `reports/growth-director-v2/`. No aplica nada a ningun sistema.
 *
 * Dos pasos, porque `growth-director-v2` es un subagente de Claude Code
 * (no una llamada de red desde este proceso Node): este script no puede
 * "invocar" al subagente por si mismo.
 *
 *   Paso 1 (preparar):
 *     npm run growth-director-v2:run
 *   Construye el contexto cross-channel real (departmentRunId mas
 *   reciente por defecto, o `--departmentRunId <id>` explicito) y
 *   escribe un prompt ya listo (`prompt.md`) para pasarselo al subagente
 *   `growth-director-v2`. El artefacto se guarda igualmente, con
 *   `status = "pending_execution"`.
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su
 *   respuesta JSON en un fichero:
 *     npm run growth-director-v2:run -- --growth-director-v2-output <fichero.json>
 *   Valida esa salida, audita rationale/evidenceRefs/dependencias, y
 *   regenera el artefacto con `status = "executed"` (o
 *   `"invalid_output"` si la respuesta no tiene la forma esperada).
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { buildGrowthDirectorV2Context, GrowthDirectorV2Context } from "../src/employees/growth-director-v2/context";
import {
  auditGrowthDirectorV2Output,
  buildGrowthDirectorV2Artifact,
  buildRunnerResultSummary,
  GrowthDirectorV2Result,
  renderGrowthDirectorV2Markdown,
  validateGrowthDirectorV2Output,
} from "../src/employees/growth-director-v2/domain";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { resolveActiveClientPaths } from "../src/core/client-paths";

const AGENT_NAME = "growth-director-v2";
const NO_RUN_SENTINEL = "no-department-run-data";

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

function sanitizeForFolderName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function buildPromptMarkdown(context: GrowthDirectorV2Context): string {
  const projectRoot = path.join(__dirname, "..");
  const agentPath = path.join(projectRoot, ".claude", "agents", `${AGENT_NAME}.md`);

  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME}`);
  lines.push("");
  lines.push("Este fichero es la union de: (1) instrucciones del subagente, (2) contexto estructurado cross-channel.");
  lines.push(`Pegalo tal cual como prompt del subagente \`${AGENT_NAME}\` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(agentInstructions.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Contexto estructurado (GrowthDirectorV2Context)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional.');
  lines.push("");
  return lines.join("\n");
}

function resolveResult(outputArg: string | undefined, outDir: string, context: GrowthDirectorV2Context): GrowthDirectorV2Result {
  if (!outputArg) {
    const promptPath = path.join(outDir, "prompt.md");
    fs.writeFileSync(promptPath, buildPromptMarkdown(context), "utf-8");
    console.log(`growth-director-v2: prompt preparado en ${promptPath}.`);
    console.log(
      `Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt (herramienta Agent), guardar su respuesta JSON en ${path.join(outDir, "output.json")}, y volver a llamar con --growth-director-v2-output ${path.join(outDir, "output.json")}.`
    );
    return { status: "pending_execution", promptFilePath: promptPath };
  }

  const outputPath = path.resolve(outputArg);
  const rawText = fs.readFileSync(outputPath, "utf-8");
  const rawCopyPath = path.join(outDir, "output-raw-invalid.json");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown (```json ... ```) alrededor del
    // JSON, mismo motivo que ux-ui-landing-architect-v2 -- ver
    // extractJsonFromModelResponse (runtime comun).
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.writeFileSync(rawCopyPath, rawText, "utf-8");
    console.error(`growth-director-v2: JSON invalido en ${outputPath}.`);
    return { status: "invalid_output", error: `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`, rawOutputPath: rawCopyPath };
  }

  try {
    const output = validateGrowthDirectorV2Output(raw);
    const auditWarnings = auditGrowthDirectorV2Output(context, output);
    console.log(`growth-director-v2: salida valida. Avisos de auditoria de dominio: ${auditWarnings.length}.`);
    return { status: "executed", output, auditWarnings };
  } catch (err) {
    fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`growth-director-v2: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): aunque este runner nunca invoca al
  // subagente por si mismo (ver cabecera), se verifica igualmente que
  // growth-director-v2 sigue cumpliendo las 4 condiciones de "cero
  // herramientas" antes de preparar nada.
  assertSubagentIsToolless(AGENT_NAME);

  const context = buildGrowthDirectorV2Context(args.departmentRunId);
  const departmentRunIdForPaths = context.departmentRunId ?? NO_RUN_SENTINEL;

  const outDir = path.join(resolveActiveClientPaths().reportsDir, "growth-director-v2", sanitizeForFolderName(departmentRunIdForPaths));
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`growth-director-v2 -- departmentRunId: ${context.departmentRunId ?? "(ninguno disponible)"}`);
  if (!context.hasDepartmentRunData) {
    console.log("growth-director-v2: no hay ninguna pasada de departamento registrada todavia -- el contexto sigue construyendose (vacio en la mayoria de campos) en vez de fallar.");
  }

  const result = resolveResult(args["growth-director-v2-output"], outDir, context);

  const artifact = buildGrowthDirectorV2Artifact(context, result);
  const jsonPath = path.join(outDir, "artifact.json");
  const mdPath = path.join(outDir, "artifact.md");
  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf-8");
  fs.writeFileSync(mdPath, renderGrowthDirectorV2Markdown(artifact), "utf-8");

  console.log("");
  console.log(`Artefacto: ${mdPath}`);
  console.log(`(JSON: ${jsonPath})`);
  console.log("");
  console.log("Recordatorio: no se ha aplicado ni escrito nada externo (WordPress/staging/produccion/Ads/GA4/GTM/n8n). Solo lectura + reportes locales.");

  const resultSummary = buildRunnerResultSummary(
    departmentRunIdForPaths,
    {
      promptFilePath: path.join(outDir, "prompt.md"),
      expectedOutputPath: path.join(outDir, "output.json"),
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
