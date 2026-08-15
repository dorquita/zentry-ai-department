/**
 * Runner del empleado `qa-reviewer` -- ver .claude/agents/qa-reviewer.md y
 * docs/claude-employee-runtime.md. Mismo patron de dos pasos que
 * scripts/run-landing-architect-comparison.ts.
 *
 * Este script NUNCA llama a WordPress, staging, produccion, Google Ads,
 * GA4/GTM, Search Console, n8n ni ningun otro sistema externo. Solo lee
 * un artifact JSON YA EXISTENTE (de otro empleado, o el fixture
 * embebido) y escribe ficheros locales de reporte bajo
 * reports/qa-reviewer/<artifactId>/. No aplica nada, no escribe en
 * ningun otro sitio.
 *
 * Dos pasos, porque qa-reviewer es un subagente de Claude Code (no una
 * llamada de red desde este proceso Node): este script no puede
 * "invocar" al subagente por si mismo.
 *
 *   Paso 1 (preparar):
 *     npm run qa-reviewer:run -- [--artifact-path <fichero.json>]
 *   Carga el artifact a revisar (el fichero indicado, validando que
 *   existe y es JSON parseable -- o, si no se pasa --artifact-path, el
 *   fixture embebido test/fixtures/qa-reviewer-example-artifact.json,
 *   para que el empleado sea ejercitable incluso sin artifacts reales de
 *   los demas empleados nuevos todavia), infiere su identidad
 *   (sourceEmployee/artifactType/artifactId/artifactPath), construye el
 *   contexto y escribe un prompt ya listo (`prompt.md`) para pasarselo al
 *   subagente `qa-reviewer`. El artifact de revision se guarda igualmente,
 *   con qaStatus = "pending_execution".
 *
 *   Paso 2 (completar), tras ejecutar el subagente y guardar su respuesta
 *   JSON en un fichero:
 *     npm run qa-reviewer:run -- [--artifact-path <fichero.json>] --qa-reviewer-output <fichero.json>
 *   Valida esa salida contra QaReviewerOutput, verifica que
 *   reviewedArtifact coincide EXACTAMENTE con lo que se le suministro
 *   (fail-closed si no), y regenera el artifact de revision con
 *   qaStatus = "executed" (o "invalid_output" si la respuesta no tiene la
 *   forma esperada o reclama haber revisado otra cosa).
 */
import * as fs from "fs";
import * as path from "path";
import { buildQaReviewerContext, inferArtifactIdentity } from "../src/employees/qa-reviewer/context";
import { assertReviewedArtifactMatches, QaReviewedArtifactRef, summarizeQaReviewerOutput, validateQaReviewerOutput } from "../src/employees/qa-reviewer/output";
import { buildQaReviewArtifact, buildQaReviewerRunnerResultSummary, QaReviewerResult, renderQaReviewMarkdown } from "../src/employees/qa-reviewer/review";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { resolveActiveClientPaths } from "../src/core/client-paths";

const AGENT_NAME = "qa-reviewer";
const PROJECT_ROOT = path.join(__dirname, "..");
export const DEFAULT_FIXTURE_PATH = path.join(PROJECT_ROOT, "test", "fixtures", "qa-reviewer-example-artifact.json");

export function parseArgs(argv: string[]): Record<string, string> {
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

export interface LoadedArtifact {
  /** Ruta REPO-RELATIVA usada como etiqueta de trazabilidad (nunca una ruta absoluta de maquina, que no seria estable entre entornos). */
  relativePath: string;
  parsed: unknown;
  /** Si viene del fixture embebido (sin --artifact-path) o de un fichero explicito. */
  isFallbackFixture: boolean;
}

/**
 * Carga y valida (existe + JSON parseable) el artifact a revisar. Fail-closed:
 * un --artifact-path que no existe, o cuyo contenido no es JSON valido,
 * aborta con un mensaje explicito -- nunca cae en silencio al fixture.
 * Exportada (junto con parseArgs/DEFAULT_FIXTURE_PATH) para que
 * test/qa-reviewer-runner.test.ts pueda verificar el comportamiento de
 * preparacion (explicito vs. fixture por defecto) sin invocar el CLI
 * completo como subproceso.
 */
export function loadArtifact(artifactPathArg: string | undefined): LoadedArtifact {
  if (!artifactPathArg) {
    const raw = fs.readFileSync(DEFAULT_FIXTURE_PATH, "utf-8");
    return { relativePath: path.relative(PROJECT_ROOT, DEFAULT_FIXTURE_PATH), parsed: JSON.parse(raw) as unknown, isFallbackFixture: true };
  }

  const resolved = path.resolve(artifactPathArg);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--artifact-path no existe: "${resolved}".`);
  }
  const raw = fs.readFileSync(resolved, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`--artifact-path no es JSON valido ("${resolved}"): ${err instanceof Error ? err.message : String(err)}`);
  }
  // path.relative + comprobar que no empieza por ".." (en vez de un
  // startsWith de texto sobre PROJECT_ROOT): un startsWith de texto
  // clasificaria erroneamente un directorio HERMANO cuyo nombre extiende
  // el de PROJECT_ROOT (p.ej. "/repo" vs "/repo-backup/artifact.json")
  // como si estuviera DENTRO del repo.
  const relativeToRoot = path.relative(PROJECT_ROOT, resolved);
  const isInsideRepo = !relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot);
  const relativePath = isInsideRepo ? relativeToRoot : resolved;
  return { relativePath, parsed, isFallbackFixture: false };
}

function buildPromptMarkdown(identity: QaReviewedArtifactRef, artifact: unknown): string {
  const agentPath = path.join(PROJECT_ROOT, ".claude", "agents", `${AGENT_NAME}.md`);
  const agentRaw = fs.readFileSync(agentPath, "utf-8");
  const agentInstructions = agentRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const context = buildQaReviewerContext(identity, artifact);

  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${AGENT_NAME} -- artifact ${identity.artifactId}`);
  lines.push("");
  lines.push("Este fichero es la union de: (1) instrucciones del subagente, (2) contexto estructurado del artifact bajo revision.");
  lines.push("Pegalo tal cual como prompt del subagente `qa-reviewer` (p.ej. via la herramienta Agent de Claude Code). El subagente no tiene herramientas -- todo lo que necesita esta aqui.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(agentInstructions.trim());
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Contexto estructurado (QaReviewerContext)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional. `reviewedArtifact` en tu salida debe ser EXACTAMENTE `context.identity` de arriba.');
  lines.push("");
  return lines.join("\n");
}

function resolveQaReviewerResult(qaOutputArg: string | undefined, outDir: string, identity: QaReviewedArtifactRef): QaReviewerResult {
  if (!qaOutputArg) {
    const promptPath = path.join(outDir, "prompt.md");
    console.log(`qa-reviewer: prompt preparado en ${promptPath}.`);
    console.log(`Siguiente paso: invocar el subagente ${AGENT_NAME} con ese prompt (herramienta Agent), guardar su respuesta JSON, y volver a llamar con --qa-reviewer-output <fichero>.`);
    return { status: "pending_execution", promptFilePath: promptPath };
  }

  const outputPath = path.resolve(qaOutputArg);
  const rawText = fs.readFileSync(outputPath, "utf-8");
  const rawCopyPath = path.join(outDir, "output-raw-invalid.json");

  let raw: unknown;
  try {
    // Tolerante a fences de markdown (```json ... ```) alrededor del JSON --
    // ver extractJsonFromModelResponse (runtime comun): la respuesta cruda
    // de un subagente Claude puede envolverlos aunque sus instrucciones
    // pidan no hacerlo.
    raw = extractJsonFromModelResponse(rawText);
  } catch (err) {
    fs.writeFileSync(rawCopyPath, rawText, "utf-8");
    console.error(`qa-reviewer: JSON invalido en ${outputPath}.`);
    return { status: "invalid_output", error: `No es JSON valido: ${err instanceof Error ? err.message : String(err)}`, rawOutputPath: rawCopyPath };
  }

  try {
    const output = validateQaReviewerOutput(raw);
    assertReviewedArtifactMatches(identity, output.reviewedArtifact);
    const summaryCounts = summarizeQaReviewerOutput(output);
    console.log(`qa-reviewer: salida valida. reviewStatus=${output.reviewStatus}, findings=${output.findings.length}.`);
    return { status: "executed", output, summaryCounts };
  } catch (err) {
    fs.writeFileSync(rawCopyPath, JSON.stringify(raw, null, 2), "utf-8");
    const error = err instanceof Error ? err.message : String(err);
    console.error(`qa-reviewer: salida invalida -- ${error}`);
    return { status: "invalid_output", error, rawOutputPath: rawCopyPath };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Segunda capa de seguridad (defensa en profundidad, ver
  // src/core/subagent-tool-guard.ts): aunque este runner nunca invoca al
  // subagente por si mismo (ver cabecera), se verifica igualmente que
  // qa-reviewer sigue cumpliendo las 4 condiciones de "cero herramientas"
  // antes de preparar nada. Cualquier inconsistencia aborta con el motivo
  // exacto.
  assertSubagentIsToolless(AGENT_NAME);

  const loaded = loadArtifact(args["artifact-path"]);
  const identity = inferArtifactIdentity(loaded.relativePath, loaded.parsed);

  const outDir = path.join(resolveActiveClientPaths().reportsDir, "qa-reviewer", identity.artifactId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`qa-reviewer -- revision de ${identity.artifactType} "${identity.artifactId}" (sourceEmployee=${identity.sourceEmployee}, artifactPath=${identity.artifactPath}).`);
  if (loaded.isFallbackFixture) {
    console.log("qa-reviewer: sin --artifact-path -- usando el fixture embebido test/fixtures/qa-reviewer-example-artifact.json.");
  }

  const promptPath = path.join(outDir, "prompt.md");
  fs.writeFileSync(promptPath, buildPromptMarkdown(identity, loaded.parsed), "utf-8");

  const expectedOutputPath = path.join(outDir, "output.json");
  const qaResult = resolveQaReviewerResult(args["qa-reviewer-output"], outDir, identity);

  const artifact = buildQaReviewArtifact(identity, qaResult);
  const reviewJsonPath = path.join(outDir, "review.json");
  const reviewMdPath = path.join(outDir, "review.md");
  fs.writeFileSync(reviewJsonPath, JSON.stringify(artifact, null, 2), "utf-8");
  fs.writeFileSync(reviewMdPath, renderQaReviewMarkdown(artifact), "utf-8");

  console.log("");
  console.log(`Artefacto de revision: ${reviewMdPath}`);
  console.log(`(JSON: ${reviewJsonPath})`);
  console.log("");
  console.log("Recordatorio: qa-reviewer no aplica nada. Solo lectura + reportes locales.");

  const resultSummary = buildQaReviewerRunnerResultSummary(identity, { promptFilePath: promptPath, expectedOutputPath, reviewJsonPath, reviewMdPath }, qaResult);
  console.log("RUNNER_RESULT_JSON=" + JSON.stringify(resultSummary));

  // Fail-closed para automatizacion: una salida invalida (incluido el
  // caso "reviewedArtifact no coincide") debe ser detectable por codigo
  // de salida (nunca silenciosa), aunque el artifact ya se haya guardado
  // para inspeccion humana.
  if (qaResult.status === "invalid_output") {
    process.exitCode = 1;
  }
}

// Guardado tras require.main === module (patron estandar de Node) para
// que test/qa-reviewer-runner.test.ts pueda importar las funciones puras
// exportadas de arriba (loadArtifact, parseArgs, DEFAULT_FIXTURE_PATH)
// SIN disparar la ejecucion completa del CLI (I/O de ficheros, escritura
// de reports/) como efecto secundario de un simple `import`.
if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
