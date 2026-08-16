/**
 * Driver de CI del RUNTIME COMUN de empleados Claude, sin ningun
 * conocimiento de dominio de negocio -- pensado exclusivamente para
 * `.github/actions/claude-employee-runtime/action.yml`.
 *
 * Tres subcomandos, uno por fase de la invocacion:
 *
 *   prepare  <workdir> <promptFile> <schemaPath>
 *     Deja el terreno limpio ANTES de invocar a Claude:
 *       - PURGA el execution_file compartido de la Action
 *         ($RUNNER_TEMP/claude-execution-output.json). Es la MISMA ruta
 *         para todas las invocaciones del mismo job, asi que sin esta
 *         purga, en la pasada coordinada del departamento (seis
 *         empleados en un unico job), una invocacion que muriera antes
 *         de escribir su fichero heredaria el del empleado ANTERIOR y
 *         lo validaria como suyo. Ver docs/claude-runtime-reliability-incident.md.
 *       - registra tamano/hash del prompt y del schema (nunca su
 *         contenido) para poder correlacionar "mismo input" entre
 *         intentos y entre pasadas.
 *
 *   capture  <workdir> <attempt> <schemaPath>
 *     Recoge la evidencia de UN intento en el borde de la Action, la
 *     persiste de inmediato en una ruta propia de ese intento (para que
 *     el intento siguiente no pueda pisarla) y la clasifica segun la
 *     taxonomia del runtime. Publica en GITHUB_OUTPUT si el intento
 *     quedo resuelto, su failureKind y si esa clase admite reintento.
 *
 *   finalize <workdir> <schemaPath> <expectedOutputPath> <healthPath>
 *     Elige UN unico intento ganador, escribe su salida EXACTA en
 *     expected-output-path, escribe el diagnostico de salud, y sale
 *     != 0 si ningun intento produjo una salida valida (fail-closed).
 *
 * Nunca escribe el prompt, la respuesta del modelo ni ningun secreto en
 * el diagnostico: solo tamanos, hashes y hechos de ejecucion.
 */
import * as fs from "fs";
import * as path from "path";
import { attemptResolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { JsonSchemaLite } from "../src/core/json-schema-lite";
import { ClaudeInvocationEvidence } from "../src/core/claude-runtime-failure-taxonomy";
import { buildAttemptRecord, buildClaudeRuntimeHealthRecord, ClaudeRuntimeAttemptRecord, contentHash } from "../src/core/claude-runtime-health";

interface PrepareManifest {
  purgedAtMs: number;
  purgedExisting: boolean;
  sharedExecutionFilePath: string | null;
  promptBytes: number | null;
  promptHash: string | null;
  schemaBytes: number;
  schemaHash: string;
}

function sharedExecutionFilePath(): string | null {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) return null;
  return path.join(runnerTemp, "claude-execution-output.json");
}

function appendGithubOutput(lines: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const body = Object.entries(lines)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  fs.appendFileSync(outputPath, `${body}\n`, "utf-8");
}

function readIfExists(filePath: string | undefined): string | undefined {
  if (!filePath || filePath.trim().length === 0) return undefined;
  const resolved = path.resolve(filePath.trim());
  if (!fs.existsSync(resolved)) return undefined;
  try {
    return fs.readFileSync(resolved, "utf-8");
  } catch {
    return undefined;
  }
}

function manifestPath(workdir: string): string {
  return path.join(workdir, "prepare-manifest.json");
}

function attemptDir(workdir: string, attempt: number): string {
  return path.join(workdir, `attempt-${attempt}`);
}

// --- prepare -----------------------------------------------------------

function prepare(workdir: string, schemaPath: string): void {
  fs.mkdirSync(workdir, { recursive: true });

  const shared = sharedExecutionFilePath();
  let purgedExisting = false;
  if (shared && fs.existsSync(shared)) {
    // Un fichero AQUI, antes de invocar, solo puede venir de otra
    // invocacion anterior del mismo job. Se borra: es preferible
    // quedarse sin fallback a validar la salida de otro empleado.
    fs.rmSync(shared, { force: true });
    purgedExisting = true;
    console.log(`[runtime] Purgado un execution_file preexistente en ${shared} (residuo de una invocacion anterior de este mismo job).`);
  }

  // El prompt llega por env (PROMPT_TEXT), nunca por argumento de linea
  // de comandos, y de el solo se derivan tamano y hash -- su contenido
  // no se escribe en ningun sitio.
  const promptContent = process.env.PROMPT_TEXT;
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");

  const manifest: PrepareManifest = {
    purgedAtMs: Date.now(),
    purgedExisting,
    sharedExecutionFilePath: shared,
    promptBytes: promptContent !== undefined ? Buffer.byteLength(promptContent, "utf-8") : null,
    promptHash: promptContent !== undefined ? contentHash(promptContent) : null,
    schemaBytes: Buffer.byteLength(schemaContent, "utf-8"),
    schemaHash: contentHash(schemaContent),
  };
  fs.writeFileSync(manifestPath(workdir), JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`[runtime] prompt: ${manifest.promptBytes ?? "(no legible)"} bytes, hash=${manifest.promptHash ?? "(n/a)"}`);
  console.log(`[runtime] schema: ${manifest.schemaBytes} bytes, hash=${manifest.schemaHash}`);

  appendGithubOutput({
    "prompt-bytes": String(manifest.promptBytes ?? ""),
    "prompt-hash": manifest.promptHash ?? "",
    "schema-bytes": String(manifest.schemaBytes),
    "schema-hash": manifest.schemaHash,
  });
}

// --- capture -----------------------------------------------------------

function capture(workdir: string, attempt: number, schemaPath: string): void {
  const dir = attemptDir(workdir, attempt);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(manifestPath(workdir), "utf-8")) as PrepareManifest;

  const claudeOutcome = process.env.CLAUDE_OUTCOME;
  const structuredOutput = process.env.CLAUDE_STRUCTURED_OUTPUT;
  const executionFilePath = process.env.EXECUTION_FILE_PATH;
  const errorMessage = process.env.CLAUDE_ERROR_MESSAGE;

  const resolvedExecutionPath = executionFilePath && executionFilePath.trim().length > 0 ? path.resolve(executionFilePath.trim()) : undefined;
  const executionFileExists = Boolean(resolvedExecutionPath && fs.existsSync(resolvedExecutionPath));

  let executionFileBytes: number | undefined;
  let executionFileStale = false;
  if (resolvedExecutionPath && executionFileExists) {
    const stat = fs.statSync(resolvedExecutionPath);
    executionFileBytes = stat.size;
    // Cinturon y tirantes sobre la purga de `prepare`: si el fichero es
    // ANTERIOR al momento de la purga, no lo escribio esta invocacion.
    executionFileStale = stat.mtimeMs < manifest.purgedAtMs;
  }

  // Persistir AQUI, en cuanto existe, una copia propia de este intento:
  // a partir de este punto ni un reintento ni otro empleado del mismo
  // job pueden pisar la evidencia de este intento.
  let executionFileContent: string | undefined;
  if (resolvedExecutionPath && executionFileExists && !executionFileStale) {
    executionFileContent = readIfExists(resolvedExecutionPath);
    if (executionFileContent !== undefined) {
      fs.writeFileSync(path.join(dir, "execution.json"), executionFileContent, "utf-8");
    }
  }

  const evidence: ClaudeInvocationEvidence = {
    attempt,
    claudeOutcome,
    structuredOutput,
    executionFilePath: resolvedExecutionPath,
    executionFileExists,
    executionFileBytes,
    executionFileStale,
    errorMessage,
  };

  const outputSchema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;
  const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput, executionFileContent, outputSchema, evidence });

  if (resolution.ok) {
    // La salida CANONICA de este intento, guardada tal cual. `finalize`
    // elegira exactamente una; nunca se fusionan dos intentos.
    fs.writeFileSync(path.join(dir, "output.txt"), resolution.resolved.rawText, "utf-8");
  }

  const record = buildAttemptRecord({
    attempt,
    claudeOutcome,
    structuredOutput,
    executionFilePath: resolvedExecutionPath,
    executionFileExists,
    executionFileBytes,
    executionFileStale,
    executionFileContent,
    resolved: resolution.ok,
    outputSource: resolution.ok ? resolution.resolved.source : "none",
    classification: resolution.ok ? null : resolution.classification,
  });
  fs.writeFileSync(path.join(dir, "attempt.json"), JSON.stringify(record, null, 2), "utf-8");

  logAttempt(record);

  appendGithubOutput({
    resolved: record.resolved ? "true" : "false",
    "failure-kind": record.failureKind ?? "",
    retriable: record.retriable === true ? "true" : "false",
    "output-source": record.outputSource,
  });
}

function logAttempt(record: ClaudeRuntimeAttemptRecord): void {
  console.log(`[runtime] --- intento ${record.attempt} ---`);
  console.log(`[runtime]   claude outcome        : ${record.claudeOutcome}`);
  console.log(`[runtime]   structured_output     : ${record.structuredOutputPresent ? "PRESENTE" : "ausente"}`);
  console.log(`[runtime]   execution_file output : ${record.executionFileOutputPresent ? record.executionFilePath : "ausente"}`);
  console.log(`[runtime]   fichero existe/bytes  : ${record.executionFileExists ? "si" : "no"} / ${record.executionFileBytes ?? 0}${record.executionFileStale ? " (RESIDUO de otra invocacion, descartado)" : ""}`);
  console.log(`[runtime]   mensajes SDK          : ${record.sdkMessageCount ?? "(n/a)"} ${record.sdkMessageTypes ? JSON.stringify(record.sdkMessageTypes) : ""}`);
  console.log(`[runtime]   ultimo mensaje        : ${record.lastMessageType ?? "(n/a)"}`);
  console.log(`[runtime]   final subtype/is_error: ${record.finalSubtype ?? "(n/a)"} / ${record.isError === null ? "(n/a)" : String(record.isError)}`);
  console.log(`[runtime]   result presente/long. : ${record.resultPresent ? "si" : "no"} / ${record.resultLength ?? 0}`);
  console.log(`[runtime]   turnos / modelo       : ${record.numTurns ?? "(n/a)"} / ${record.model ?? "(n/a)"}`);
  console.log(`[runtime]   RESULTADO             : ${record.resolved ? `ACEPTADO (origen: ${record.outputSource})` : `RECHAZADO (${record.failureKind}, retriable=${String(record.retriable)})`}`);
  if (!record.resolved) {
    console.log(`[runtime]   motivo                : ${record.failureReason}`);
    console.log(`[runtime]   evidencia             : ${record.failureEvidence}`);
  }
}

// --- finalize ----------------------------------------------------------

function finalize(workdir: string, expectedOutputPath: string, healthPath: string): void {
  const manifest = JSON.parse(fs.readFileSync(manifestPath(workdir), "utf-8")) as PrepareManifest;

  const attempts: ClaudeRuntimeAttemptRecord[] = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    const file = path.join(attemptDir(workdir, attempt), "attempt.json");
    if (!fs.existsSync(file)) break;
    attempts.push(JSON.parse(fs.readFileSync(file, "utf-8")) as ClaudeRuntimeAttemptRecord);
  }

  const health = buildClaudeRuntimeHealthRecord({
    employee: process.env.AGENT_NAME ?? "(desconocido)",
    departmentRunId: process.env.DEPARTMENT_RUN_ID,
    promptBytes: manifest.promptBytes ?? undefined,
    promptHash: manifest.promptHash ?? undefined,
    schemaBytes: manifest.schemaBytes,
    schemaHash: manifest.schemaHash,
    authMethod: process.env.AUTH_METHOD ?? "(desconocido)",
    maxTurns: process.env.MAX_TURNS ? Number(process.env.MAX_TURNS) : undefined,
    attempts,
  });

  fs.mkdirSync(path.dirname(path.resolve(healthPath)), { recursive: true });
  fs.writeFileSync(path.resolve(healthPath), JSON.stringify(health, null, 2), "utf-8");

  console.log(
    `[runtime] SALUD: employee=${health.employee} intentos=${health.attemptCount} reintentado=${health.retried} recuperado=${health.recovered} origen=${health.outputSource} validacion=${health.validationStatus} failureKind=${health.failureKind ?? "(ninguno)"} coste_estimado=${health.totalCostUsd ?? "(no reportado)"}`
  );

  appendGithubOutput({
    source: health.outputSource,
    "failure-kind": health.failureKind ?? "",
    "attempt-count": String(health.attemptCount),
    retried: health.retried ? "true" : "false",
    recovered: health.recovered ? "true" : "false",
    "validation-status": health.validationStatus,
  });

  if (health.validationStatus !== "accepted") {
    // FAIL-CLOSED. El diagnostico ya esta escrito, asi que el motivo
    // exacto queda disponible aunque el job muera aqui.
    const last = attempts[attempts.length - 1];
    console.error(`::error::El runtime comun no obtuvo ninguna salida valida para "${health.employee}" tras ${health.attemptCount} intento(s). failureKind=${health.failureKind}. ${last?.failureReason ?? ""} Evidencia: ${last?.failureEvidence ?? "(sin evidencia)"}`);
    process.exit(1);
  }

  // Un unico intento ganador -- nunca se mezcla la salida de dos.
  const winner = attempts.find((attempt) => attempt.resolved)!;
  const rawText = fs.readFileSync(path.join(attemptDir(workdir, winner.attempt), "output.txt"), "utf-8");
  fs.writeFileSync(path.resolve(expectedOutputPath), rawText, "utf-8");

  console.log(`[runtime] Salida canonica del intento ${winner.attempt} (origen: ${winner.outputSource}) escrita en ${expectedOutputPath}.`);
}

// --- entrada -----------------------------------------------------------

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "prepare": {
      const [workdir, schemaPath] = rest;
      if (!workdir || !schemaPath) throw new Error("Uso: claude-runtime-attempt-for-ci prepare <workdir> <schemaPath>");
      prepare(workdir, schemaPath);
      return;
    }
    case "capture": {
      const [workdir, attempt, schemaPath] = rest;
      if (!workdir || !attempt || !schemaPath) throw new Error("Uso: claude-runtime-attempt-for-ci capture <workdir> <attempt> <schemaPath>");
      capture(workdir, Number(attempt), schemaPath);
      return;
    }
    case "finalize": {
      const [workdir, expectedOutputPath, healthPath] = rest;
      if (!workdir || !expectedOutputPath || !healthPath) throw new Error("Uso: claude-runtime-attempt-for-ci finalize <workdir> <expectedOutputPath> <healthPath>");
      finalize(workdir, expectedOutputPath, healthPath);
      return;
    }
    default:
      throw new Error(`Subcomando desconocido: "${command ?? "(ninguno)"}". Usa prepare | capture | finalize.`);
  }
}

main();
