/**
 * Wrapper de CLI GENERICO (sin conocimiento de ningun dominio de
 * negocio), pensado para `.github/actions/claude-employee-runtime/action.yml`
 * -- ver docs/claude-employee-runtime.md.
 *
 * Dado lo que devolvio `claude-code-action` (structured_output, que
 * puede venir vacio) y, opcionalmente, la ruta de su `execution_file`,
 * resuelve el caso A/B/C con `resolveClaudeEmployeeOutput()`
 * (src/core/claude-employee-runtime.ts, TOOL puro, testeado por
 * separado) y escribe el texto EXACTO recuperado (sin reinterpretar)
 * directamente en el fichero de salida esperado por el empleado --
 * nunca via shell/printf, siempre con fs.writeFileSync, para no
 * interpolar contenido generado por el modelo en ningun comando.
 *
 * Fail-closed: si no hay nada recuperable, o el JSON no cumple el
 * schema, termina con codigo != 0 y un mensaje explicito, y NO escribe
 * el fichero de salida (nunca un fichero vacio o parcial).
 *
 * Uso:
 *   ts-node scripts/resolve-claude-employee-output-for-ci.ts \
 *     <output-schema-path> <expected-output-path> [execution-file-path] [--soft]
 *
 * `--soft` (modo "clasificar, no tumbar"): en vez de terminar con codigo
 * != 0 cuando la resolucion falla, sale con 0 y publica en GITHUB_OUTPUT
 * `resolved=false`, la CLASE del fallo y si esa clase admite reintento
 * (ver src/core/claude-employee-retry.ts). Existe UNICAMENTE para que el
 * runtime comun pueda decidir si lanzar UN segundo intento antes de
 * declarar fallida la invocacion; el intento final SIEMPRE se resuelve
 * sin `--soft`, o sea fail-closed igual que siempre. `--soft` nunca
 * escribe el fichero de salida si la resolucion no fue valida.
 *
 * Env:
 *   CLAUDE_STRUCTURED_OUTPUT -- opcional, el output structured_output de claude-code-action
 *   CLAUDE_EXECUTION_FILE_MIN_MTIME_MS -- opcional. Si esta puesto, un
 *     execution_file cuyo mtime sea ANTERIOR a ese instante se trata como
 *     INEXISTENTE. `claude-code-action` escribe siempre en la MISMA ruta
 *     (`$RUNNER_TEMP/claude-execution-output.json`), asi que sin esta
 *     comprobacion un segundo intento que muriese antes de escribir su
 *     fichero reutilizaria silenciosamente la salida del PRIMER intento
 *     -- mezclando intentos, que es justo lo que no puede pasar.
 */
import * as fs from "fs";
import { isExecutionFileStale, resolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { classifyClaudeEmployeeFailure } from "../src/core/claude-employee-retry";
import { JsonSchemaLite } from "../src/core/json-schema-lite";

function appendGithubOutput(lines: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const payload = Object.entries(lines)
    .map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, " ")}\n`)
    .join("");
  fs.appendFileSync(outputPath, payload, "utf-8");
}

/**
 * Lee el execution_file SOLO si existe y no es un resto de un intento
 * anterior. Devolver `undefined` aqui equivale exactamente a "esta
 * invocacion no dejo execution_file", que `resolveClaudeEmployeeOutput()`
 * ya trata fail-closed.
 */
function readFreshExecutionFile(executionFilePath: string | undefined): { content: string | undefined; staleNote?: string } {
  if (!executionFilePath || !fs.existsSync(executionFilePath)) return { content: undefined };

  const minMtimeRaw = process.env.CLAUDE_EXECUTION_FILE_MIN_MTIME_MS;
  const attemptStartedMs = minMtimeRaw && minMtimeRaw.trim().length > 0 ? Number(minMtimeRaw) : undefined;
  const mtimeMs = fs.statSync(executionFilePath).mtimeMs;
  if (isExecutionFileStale({ mtimeMs, attemptStartedMs })) {
    return {
      content: undefined,
      staleNote: `execution_file DESCARTADO por obsoleto: su mtime (${new Date(mtimeMs).toISOString()}) es anterior al inicio de este intento (${new Date(attemptStartedMs as number).toISOString()}). Es un resto de un intento previo y NO se reutiliza.`,
    };
  }

  return { content: fs.readFileSync(executionFilePath, "utf-8") };
}

function main(): void {
  const args = process.argv.slice(2);
  const soft = args.includes("--soft");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const [outputSchemaPath, expectedOutputPath, executionFilePath] = positional;

  if (!outputSchemaPath || !expectedOutputPath) {
    throw new Error("Uso: ts-node scripts/resolve-claude-employee-output-for-ci.ts <output-schema-path> <expected-output-path> [execution-file-path] [--soft]");
  }

  const outputSchema = JSON.parse(fs.readFileSync(outputSchemaPath, "utf-8")) as JsonSchemaLite;
  const structuredOutput = process.env.CLAUDE_STRUCTURED_OUTPUT;
  const { content: executionFileContent, staleNote } = readFreshExecutionFile(executionFilePath);
  if (staleNote) console.log(`resolve-claude-employee-output-for-ci: ${staleNote}`);

  let resolved;
  try {
    resolved = resolveClaudeEmployeeOutput({ structuredOutput, executionFileContent, outputSchema });
  } catch (err) {
    const classification = classifyClaudeEmployeeFailure(err);
    if (!soft) throw err;

    appendGithubOutput({
      resolved: "false",
      "failure-class": classification.failureClass,
      retryable: classification.retryable ? "true" : "false",
      "failure-reason": classification.reason,
    });
    console.log(`resolve-claude-employee-output-for-ci (--soft): resolucion FALLIDA. clase=${classification.failureClass}, reintentable=${classification.retryable}. Motivo: ${classification.reason}`);
    return;
  }

  fs.writeFileSync(expectedOutputPath, resolved.rawText, "utf-8");

  appendGithubOutput({ source: resolved.source, resolved: "true", "failure-class": "", retryable: "false", "failure-reason": "" });

  console.log(`resolve-claude-employee-output-for-ci: salida resuelta desde "${resolved.source}" y escrita en ${expectedOutputPath}.`);
}

main();
