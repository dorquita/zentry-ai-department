import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { attemptResolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { JsonSchemaLite } from "../src/core/json-schema-lite";
import { ClaudeInvocationEvidence, classifyErrorMessage, classifyInvocationFailure, isRetriableFailureKind } from "../src/core/claude-runtime-failure-taxonomy";
import { buildAttemptRecord, buildClaudeRuntimeHealthRecord, contentHash, extractExecutionFileForensics } from "../src/core/claude-runtime-health";
import { aggregateClaudeRuntimeMetrics } from "../src/core/claude-runtime-metrics";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Tests del incidente P0 de fiabilidad del runtime comun de empleados
 * Claude (ver docs/claude-runtime-reliability-incident.md).
 *
 * Cubren las tres capas que el incidente destapo:
 *   1. clasificacion correcta del fallo (que capa fallo exactamente),
 *   2. politica de reintento (transitorio si, determinista NO),
 *   3. proteccion de la salida recuperable y del diagnostico.
 *
 * Todos los schemas y payloads de aqui son FICTICIOS a proposito: el
 * runtime comun no puede depender de ningun dominio de negocio.
 */

const SCHEMA: JsonSchemaLite = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    score: { type: "number" },
  },
  required: ["summary", "score"],
};

const VALID_PAYLOAD = '{"summary":"todo bien","score":7}';

function evidence(overrides: Partial<ClaudeInvocationEvidence> = {}): ClaudeInvocationEvidence {
  return {
    attempt: 1,
    claudeOutcome: "failure",
    structuredOutput: undefined,
    executionFilePath: "/runner/_temp/claude-execution-output.json",
    executionFileExists: true,
    executionFileBytes: 1234,
    executionFileStale: false,
    ...overrides,
  };
}

function executionFile(messages: unknown[]): string {
  return JSON.stringify(messages, null, 2);
}

function successResultMessage(result: string, extras: Record<string, unknown> = {}): unknown {
  return { type: "result", subtype: "success", is_error: false, result, num_turns: 2, duration_ms: 1000, total_cost_usd: 0.5, ...extras };
}

const INIT_MESSAGE = { type: "system", subtype: "init", model: "claude-sonnet-5" };

function tempDir(): string {
  return fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? "/tmp", "claude-runtime-test-"));
}

export function runClaudeRuntimeReliabilityTests(): TestCase[] {
  return [
    // --- 1. Camino feliz y camino de fallback ------------------------
    {
      name: "normal success: structured_output presente y valido -> aceptado, origen structured_output",
      fn: () => {
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: VALID_PAYLOAD, executionFileContent: undefined, outputSchema: SCHEMA, evidence: evidence({ claudeOutcome: "success" }) });
        assert.equal(resolution.ok, true);
        assert.equal(resolution.ok && resolution.resolved.source, "structured_output");
        assert.equal(resolution.ok && resolution.resolved.rawText, VALID_PAYLOAD);
      },
    },
    {
      name: "structured_output ausente + execution_file valido -> recuperado por fallback (nunca se pierde una respuesta real de Claude)",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, successResultMessage(VALID_PAYLOAD)]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: "", executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, true);
        assert.equal(resolution.ok && resolution.resolved.source, "execution_file_fallback");
      },
    },
    {
      name: "action non-zero + execution_file recuperable -> se recupera igualmente (el outcome del step no es la autoridad)",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, successResultMessage(VALID_PAYLOAD)]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence({ claudeOutcome: "failure" }) });
        assert.equal(resolution.ok, true);
      },
    },

    // --- 2. Clasificacion por capa ------------------------------------
    {
      name: "execution_file missing: la Action publico la ruta pero el fichero no existe -> execution_file_missing (RETRIABLE)",
      fn: () => {
        const classification = classifyInvocationFailure(evidence({ executionFileExists: false, executionFileBytes: undefined }));
        assert.equal(classification.failureKind, "execution_file_missing");
        assert.equal(classification.retriable, true);
      },
    },
    {
      name: "no_output_at_all: ni structured_output ni ruta de execution_file -> no_output_at_all (RETRIABLE)",
      fn: () => {
        const classification = classifyInvocationFailure(evidence({ executionFilePath: undefined, executionFileExists: false, executionFileBytes: undefined }));
        assert.equal(classification.failureKind, "no_output_at_all");
        assert.equal(classification.retriable, true);
      },
    },
    {
      name: "execution_file truncado (JSON a medias) -> execution_file_invalid y NO retriable (fail-closed, no se repara contenido)",
      fn: () => {
        const truncated = '[{"type":"system","subtype":"init"},{"type":"result","subtype":"succ';
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: truncated, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "execution_file_invalid");
        assert.equal(!resolution.ok && resolution.classification.retriable, false);
      },
    },
    {
      name: "result missing: hay mensajes SDK pero ninguno type=result -> result_missing (RETRIABLE: el stream murio por debajo del modelo)",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, { type: "assistant" }]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "result_missing");
        assert.equal(!resolution.ok && resolution.classification.retriable, true);
      },
    },
    {
      name: "result presente pero vacio -> result_missing, nunca se acepta 'hay texto' como exito",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, successResultMessage("   ")]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "result_missing");
      },
    },
    {
      name: "JSON invalido (comilla sin escapar, el fallo real de growth-director-v2 en el run 31884787140) -> result_not_json y NO retriable",
      fn: () => {
        const broken = '{"summary":"dijo "hola" sin escapar","score":7}';
        const content = executionFile([INIT_MESSAGE, successResultMessage(broken)]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "result_not_json");
        assert.equal(!resolution.ok && resolution.classification.retriable, false);
      },
    },
    {
      name: "schema invalido (falta un required, el fallo real de seo-specialist en el run 31949966340) -> schema_validation_failed y NO retriable",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, successResultMessage('{"summary":"falta el score"}')]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "schema_validation_failed");
        assert.equal(!resolution.ok && resolution.classification.retriable, false);
      },
    },
    {
      name: "structured_output presente pero incumpliendo el schema -> schema_validation_failed (misma validacion en caso A y en caso B)",
      fn: () => {
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: '{"summary":"sin score"}', executionFileContent: undefined, outputSchema: SCHEMA, evidence: evidence({ claudeOutcome: "success" }) });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "schema_validation_failed");
      },
    },
    {
      name: "error_max_structured_output_retries del SDK -> schema_validation_failed y NO retriable (el SDK ya reintento por dentro)",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, { type: "result", subtype: "error_max_structured_output_retries", is_error: true, num_turns: 6 }]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "schema_validation_failed");
        assert.equal(!resolution.ok && resolution.classification.retriable, false);
      },
    },
    {
      name: "error_during_execution del SDK -> provider_transient_failure (RETRIABLE)",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, { type: "result", subtype: "error_during_execution", is_error: true }]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(resolution.ok, false);
        assert.equal(!resolution.ok && resolution.classification.failureKind, "provider_transient_failure");
        assert.equal(!resolution.ok && resolution.classification.retriable, true);
      },
    },
    {
      name: "un subtype de error DESCONOCIDO cae en unknown_runtime_failure y NO se reintenta (no se reintenta lo que no se sabe explicar)",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, { type: "result", subtype: "error_algo_nuevo_del_futuro", is_error: true }]);
        const resolution = attemptResolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: content, outputSchema: SCHEMA, evidence: evidence() });
        assert.equal(!resolution.ok && resolution.classification.failureKind, "unknown_runtime_failure");
        assert.equal(!resolution.ok && resolution.classification.retriable, false);
      },
    },

    // --- 3. Firmas de error: transporte / proveedor / auth / timeout ---
    {
      name: "network transient (ECONNRESET, socket hang up, fetch failed) -> network_failure RETRIABLE",
      fn: () => {
        for (const message of ["Error: read ECONNRESET", "socket hang up", "TypeError: fetch failed", "getaddrinfo EAI_AGAIN api.anthropic.com"]) {
          assert.equal(classifyErrorMessage(message), "network_failure", `no clasificado como red: ${message}`);
        }
        assert.equal(isRetriableFailureKind("network_failure"), true);
      },
    },
    {
      name: "provider transient (429, 529, overloaded, rate limit) -> provider_transient_failure RETRIABLE",
      fn: () => {
        for (const message of ["API error 429: rate_limit_error", "Error 529: overloaded_error", "503 Service Unavailable"]) {
          assert.equal(classifyErrorMessage(message), "provider_transient_failure", `no clasificado como proveedor: ${message}`);
        }
        assert.equal(isRetriableFailureKind("provider_transient_failure"), true);
      },
    },
    {
      name: "auth failure (401/403/invalid api key) -> auth_failure y NUNCA retriable, aunque el mensaje parezca de red",
      fn: () => {
        for (const message of ["401 Unauthorized", "403 Forbidden", "authentication_error: invalid api key", "OAuth token expired"]) {
          assert.equal(classifyErrorMessage(message), "auth_failure", `no clasificado como auth: ${message}`);
        }
        assert.equal(isRetriableFailureKind("auth_failure"), false);
      },
    },
    {
      name: "politica de timeout: se detecta y NO se reintenta (un reintento no cabe en el mismo presupuesto de tiempo)",
      fn: () => {
        assert.equal(classifyErrorMessage("The operation timed out"), "timeout");
        assert.equal(classifyErrorMessage("ETIMEDOUT"), "timeout");
        assert.equal(isRetriableFailureKind("timeout"), false);
      },
    },
    {
      name: "auth se comprueba ANTES que las firmas transitorias: un 401 nunca acaba clasificado como 5xx reintentable",
      fn: () => {
        assert.equal(classifyErrorMessage("Request failed with 401 after 503 retries"), "auth_failure");
      },
    },
    {
      name: "tool_policy_failed y domain_validation_failed son deterministas: NUNCA se reintentan",
      fn: () => {
        assert.equal(isRetriableFailureKind("tool_policy_failed"), false);
        assert.equal(isRetriableFailureKind("domain_validation_failed"), false);
        assert.equal(isRetriableFailureKind("schema_validation_failed"), false);
        assert.equal(isRetriableFailureKind("result_not_json"), false);
      },
    },

    // --- 4. Contaminacion cruzada entre empleados del mismo job -------
    {
      name: "execution_file RESIDUAL de otra invocacion del mismo job -> execution_file_stale, jamas se valida como salida propia",
      fn: () => {
        const classification = classifyInvocationFailure(evidence({ executionFileStale: true }));
        assert.equal(classification.failureKind, "execution_file_stale");
        assert.equal(classification.retriable, true);
        assert.ok(/invocacion anterior/.test(classification.evidence));
      },
    },

    // --- 5. Reintento: idempotencia y no mezclar salidas --------------
    {
      name: "retry succeeds: intento 1 transitorio + intento 2 valido -> aceptado, recovered=true, y la salida es la del intento 2 SOLO",
      fn: () => {
        const failed = buildAttemptRecord({
          attempt: 1,
          claudeOutcome: "failure",
          structuredOutput: undefined,
          executionFilePath: undefined,
          executionFileExists: false,
          executionFileBytes: undefined,
          executionFileStale: false,
          executionFileContent: undefined,
          resolved: false,
          outputSource: "none",
          classification: classifyInvocationFailure(evidence({ attempt: 1, executionFilePath: undefined, executionFileExists: false })),
        });
        const succeeded = buildAttemptRecord({
          attempt: 2,
          claudeOutcome: "success",
          structuredOutput: VALID_PAYLOAD,
          executionFilePath: "/runner/_temp/claude-execution-output.json",
          executionFileExists: true,
          executionFileBytes: 900,
          executionFileStale: false,
          executionFileContent: executionFile([INIT_MESSAGE, successResultMessage(VALID_PAYLOAD)]),
          resolved: true,
          outputSource: "structured_output",
          classification: null,
        });

        const health = buildClaudeRuntimeHealthRecord({ employee: "empleado-ficticio", authMethod: "oauth", attempts: [failed, succeeded] });
        assert.equal(health.validationStatus, "accepted");
        assert.equal(health.retried, true);
        assert.equal(health.recovered, true);
        assert.equal(health.attemptCount, 2);
        assert.equal(health.outputSource, "structured_output");
        assert.equal(health.failureKind, null);
      },
    },
    {
      name: "retry fails: los dos intentos fallan -> rejected, recovered=false, y se conserva la clase del ULTIMO intento",
      fn: () => {
        const attempt = (n: number) =>
          buildAttemptRecord({
            attempt: n,
            claudeOutcome: "failure",
            structuredOutput: undefined,
            executionFilePath: undefined,
            executionFileExists: false,
            executionFileBytes: undefined,
            executionFileStale: false,
            executionFileContent: undefined,
            resolved: false,
            outputSource: "none",
            classification: classifyInvocationFailure(evidence({ attempt: n, executionFilePath: undefined, executionFileExists: false })),
          });
        const health = buildClaudeRuntimeHealthRecord({ employee: "empleado-ficticio", authMethod: "oauth", attempts: [attempt(1), attempt(2)] });
        assert.equal(health.validationStatus, "rejected");
        assert.equal(health.recovered, false);
        assert.equal(health.retried, true);
        assert.equal(health.failureKind, "no_output_at_all");
        assert.equal(health.outputSource, "none");
      },
    },
    {
      name: "un exito al PRIMER intento nunca cuenta como 'recuperado' (si contara, la metrica de recuperaciones no mediria nada)",
      fn: () => {
        const first = buildAttemptRecord({
          attempt: 1,
          claudeOutcome: "success",
          structuredOutput: VALID_PAYLOAD,
          executionFilePath: "/x.json",
          executionFileExists: true,
          executionFileBytes: 10,
          executionFileStale: false,
          executionFileContent: executionFile([INIT_MESSAGE, successResultMessage(VALID_PAYLOAD)]),
          resolved: true,
          outputSource: "structured_output",
          classification: null,
        });
        const health = buildClaudeRuntimeHealthRecord({ employee: "e", authMethod: "oauth", attempts: [first] });
        assert.equal(health.recovered, false);
        assert.equal(health.retried, false);
      },
    },
    {
      name: "NO se mezclan salidas de dos intentos: el driver persiste cada intento en su propia ruta y finalize elige UNA",
      fn: () => {
        // Verificacion estructural sobre el driver real: cada intento
        // escribe en attempt-<n>/ y finalize lee output.txt del intento
        // ganador -- nunca concatena ni fusiona.
        const driver = fs.readFileSync(path.join(__dirname, "..", "scripts", "claude-runtime-attempt-for-ci.ts"), "utf-8");
        assert.ok(/attempt-\$\{attempt\}/.test(driver), "cada intento debe persistir en una ruta propia attempt-<n>");
        assert.ok(/attempts\.find\(\(attempt\) => attempt\.resolved\)/.test(driver), "finalize debe elegir UN unico intento ganador");
        assert.ok(!/concat|\+= *rawText/.test(driver), "el driver no puede concatenar salidas de intentos distintos");
      },
    },

    // --- 6. Forensica y watchdog --------------------------------------
    {
      name: "la forensica del execution_file cuenta tipos de mensaje, ultimo mensaje, subtype, turnos, modelo y coste",
      fn: () => {
        const content = executionFile([INIT_MESSAGE, { type: "assistant" }, { type: "assistant" }, successResultMessage(VALID_PAYLOAD, { num_turns: 3, total_cost_usd: 1.25 })]);
        const forensics = extractExecutionFileForensics(content);
        assert.deepEqual(forensics.sdkMessageTypes, { system: 1, assistant: 2, result: 1 });
        assert.equal(forensics.sdkMessageCount, 4);
        assert.equal(forensics.lastMessageType, "result");
        assert.equal(forensics.finalSubtype, "success");
        assert.equal(forensics.isError, false);
        assert.equal(forensics.resultPresent, true);
        assert.equal(forensics.resultLength, VALID_PAYLOAD.length);
        assert.equal(forensics.numTurns, 3);
        assert.equal(forensics.model, "claude-sonnet-5");
        assert.equal(forensics.costUsd, 1.25);
      },
    },
    {
      name: "la forensica NUNCA lanza ante un fichero corrupto: perder el diagnostico no puede tumbar la pasada",
      fn: () => {
        for (const bad of ["", "   ", "{no json", '{"type":"result"}', "[1,2,3]"]) {
          assert.doesNotThrow(() => extractExecutionFileForensics(bad));
        }
      },
    },
    {
      name: "health artifact: contiene employee, intentos, authMethod, duracion, resultado, failureKind, retried, recovered, origen y validacion",
      fn: () => {
        const attempt = buildAttemptRecord({
          attempt: 1,
          claudeOutcome: "success",
          structuredOutput: VALID_PAYLOAD,
          executionFilePath: "/x.json",
          executionFileExists: true,
          executionFileBytes: 10,
          executionFileStale: false,
          executionFileContent: executionFile([INIT_MESSAGE, successResultMessage(VALID_PAYLOAD)]),
          resolved: true,
          outputSource: "structured_output",
          classification: null,
        });
        const health = buildClaudeRuntimeHealthRecord({
          employee: "seo-ficticio",
          departmentRunId: "dept-123",
          promptBytes: 52265,
          promptHash: contentHash("prompt"),
          schemaBytes: 6606,
          schemaHash: contentHash("schema"),
          authMethod: "oauth",
          maxTurns: 8,
          attempts: [attempt],
        });

        for (const key of ["employee", "attemptCount", "authMethod", "durationMs", "actionResult", "failureKind", "retried", "recovered", "outputSource", "validationStatus"]) {
          assert.ok(key in health, `falta el campo "${key}" en el diagnostico de salud`);
        }
        assert.equal(health.employee, "seo-ficticio");
        assert.equal(health.departmentRunId, "dept-123");
        assert.equal(health.authMethod, "oauth");
        assert.equal(health.durationMs, 1000);
        assert.equal(health.totalCostUsd, 0.5);
      },
    },
    {
      name: "secretos redactados: el diagnostico guarda TAMANO y HASH del prompt/schema, nunca su contenido",
      fn: () => {
        const secretPrompt = "TOKEN_SUPER_SECRETO_sk-ant-oat01-abcdef";
        const health = buildClaudeRuntimeHealthRecord({
          employee: "e",
          authMethod: "oauth",
          promptBytes: Buffer.byteLength(secretPrompt),
          promptHash: contentHash(secretPrompt),
          schemaBytes: 10,
          schemaHash: contentHash("{}"),
          attempts: [],
        });
        const serialized = JSON.stringify(health);
        assert.ok(!serialized.includes(secretPrompt), "el contenido del prompt no puede aparecer en el diagnostico");
        assert.ok(!serialized.includes("sk-ant-oat01"), "ningun fragmento de credencial puede aparecer en el diagnostico");
        assert.equal(health.promptHash, contentHash(secretPrompt));
        assert.equal(health.promptBytes, Buffer.byteLength(secretPrompt));
      },
    },
    {
      name: "el hash de contenido es estable y distingue inputs distintos (sirve para correlacionar 'mismo input')",
      fn: () => {
        assert.equal(contentHash("mismo"), contentHash("mismo"));
        assert.notEqual(contentHash("mismo"), contentHash("distinto"));
      },
    },

    // --- 7. Metricas de fiabilidad ------------------------------------
    {
      name: "metrics: cuenta invocaciones, exitos a la primera, recuperadas, deterministas, transitorias y success rate",
      fn: () => {
        const okFirst = buildClaudeRuntimeHealthRecord({ employee: "a", authMethod: "oauth", attempts: [acceptedAttempt(1)] });
        const okRetry = buildClaudeRuntimeHealthRecord({ employee: "b", authMethod: "oauth", attempts: [transientAttempt(1), acceptedAttempt(2)] });
        const deterministic = buildClaudeRuntimeHealthRecord({ employee: "c", authMethod: "oauth", attempts: [schemaFailedAttempt(1)] });
        const transient = buildClaudeRuntimeHealthRecord({ employee: "d", authMethod: "oauth", attempts: [transientAttempt(1), transientAttempt(2)] });

        const metrics = aggregateClaudeRuntimeMetrics([okFirst, okRetry, deterministic, transient]);
        assert.equal(metrics.runtimeInvocations, 4);
        assert.equal(metrics.successesFirstAttempt, 1);
        assert.equal(metrics.recoveredByRetry, 1);
        assert.equal(metrics.totalSuccesses, 2);
        assert.equal(metrics.deterministicFailures, 1);
        assert.equal(metrics.transientFailures, 1);
        assert.equal(metrics.unrecoveredRuntimeFailures, 2);
        assert.equal(metrics.successRate, 0.5);
        assert.equal(metrics.totalAttempts, 6);
        assert.equal(metrics.retriesExecuted, 2);
        assert.equal(metrics.retriesAvoidedByClassification, 1);
        assert.equal(metrics.failureKindBreakdown.schema_validation_failed, 1);
      },
    },
    {
      name: "metrics: separa el coste del primer intento del coste de los reintentos y estima el ahorro de no reintentar deterministas",
      fn: () => {
        const okRetry = buildClaudeRuntimeHealthRecord({ employee: "b", authMethod: "oauth", attempts: [transientAttempt(1), acceptedAttempt(2)] });
        const deterministic = buildClaudeRuntimeHealthRecord({ employee: "c", authMethod: "oauth", attempts: [schemaFailedAttempt(1)] });
        const metrics = aggregateClaudeRuntimeMetrics([okRetry, deterministic]);
        assert.ok(metrics.cost.firstAttemptUsd !== null && metrics.cost.firstAttemptUsd > 0);
        assert.ok(metrics.cost.retryUsd !== null && metrics.cost.retryUsd > 0);
        assert.equal(metrics.cost.totalUsd, (metrics.cost.firstAttemptUsd ?? 0) + (metrics.cost.retryUsd ?? 0));
        assert.ok((metrics.cost.estimatedUsdAvoidedByClassification ?? 0) > 0, "debe estimarse el coste de los reintentos evitados");
      },
    },
    {
      name: "metrics: cero invocaciones no divide por cero ni inventa un success rate",
      fn: () => {
        const metrics = aggregateClaudeRuntimeMetrics([]);
        assert.equal(metrics.runtimeInvocations, 0);
        assert.equal(metrics.successRate, null);
        assert.equal(metrics.cost.totalUsd, null);
      },
    },

    // --- 8. Fail-closed del driver ------------------------------------
    {
      name: "finalize NO escribe el fichero de salida cuando ningun intento fue aceptado (nunca un output vacio o parcial)",
      fn: () => {
        const dir = tempDir();
        try {
          const workdir = path.join(dir, "wd");
          fs.mkdirSync(path.join(workdir, "attempt-1"), { recursive: true });
          fs.writeFileSync(path.join(workdir, "prepare-manifest.json"), JSON.stringify({ purgedAtMs: 0, purgedExisting: false, sharedExecutionFilePath: null, promptBytes: 1, promptHash: "h", schemaBytes: 1, schemaHash: "s" }));
          fs.writeFileSync(path.join(workdir, "attempt-1", "attempt.json"), JSON.stringify(schemaFailedAttempt(1)));

          const outputPath = path.join(dir, "output.json");
          const healthPath = path.join(dir, "health.json");
          const result = runDriver(["finalize", workdir, outputPath, healthPath]);

          assert.notEqual(result.status, 0, "finalize debe salir != 0 si no hay salida valida (fail-closed)");
          assert.equal(fs.existsSync(outputPath), false, "no puede escribirse el fichero de salida sin una salida valida");
          assert.equal(fs.existsSync(healthPath), true, "el diagnostico debe escribirse igualmente, para poder explicar el fallo");
          const health = JSON.parse(fs.readFileSync(healthPath, "utf-8"));
          assert.equal(health.validationStatus, "rejected");
          assert.equal(health.failureKind, "schema_validation_failed");
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: "prepare PURGA el execution_file compartido: un residuo de otro empleado del mismo job nunca sobrevive a la siguiente invocacion",
      fn: () => {
        const dir = tempDir();
        try {
          const stale = path.join(dir, "claude-execution-output.json");
          fs.writeFileSync(stale, executionFile([INIT_MESSAGE, successResultMessage('{"summary":"salida de OTRO empleado","score":1}')]));
          assert.equal(fs.existsSync(stale), true);

          const workdir = path.join(dir, "wd");
          const schemaPath = path.join(dir, "schema.json");
          fs.writeFileSync(schemaPath, JSON.stringify(SCHEMA));
          const result = runDriver(["prepare", workdir, schemaPath], { RUNNER_TEMP: dir, PROMPT_TEXT: "prompt de prueba" });
          assert.equal(result.status, 0, `prepare fallo: ${result.stderr}`);
          assert.equal(fs.existsSync(stale), false, "el execution_file residual debe haberse purgado ANTES de invocar a Claude");

          const manifest = JSON.parse(fs.readFileSync(path.join(workdir, "prepare-manifest.json"), "utf-8"));
          assert.equal(manifest.purgedExisting, true);
          assert.equal(manifest.promptHash, contentHash("prompt de prueba"));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ];
}

// --- helpers -----------------------------------------------------------

function acceptedAttempt(n: number) {
  return buildAttemptRecord({
    attempt: n,
    claudeOutcome: "success",
    structuredOutput: VALID_PAYLOAD,
    executionFilePath: "/x.json",
    executionFileExists: true,
    executionFileBytes: 10,
    executionFileStale: false,
    executionFileContent: executionFile([INIT_MESSAGE, successResultMessage(VALID_PAYLOAD)]),
    resolved: true,
    outputSource: "structured_output",
    classification: null,
  });
}

function transientAttempt(n: number) {
  return buildAttemptRecord({
    attempt: n,
    claudeOutcome: "failure",
    structuredOutput: undefined,
    executionFilePath: undefined,
    executionFileExists: false,
    executionFileBytes: undefined,
    executionFileStale: false,
    executionFileContent: executionFile([INIT_MESSAGE, successResultMessage(VALID_PAYLOAD)]),
    resolved: false,
    outputSource: "none",
    classification: classifyInvocationFailure(evidence({ attempt: n, executionFilePath: undefined, executionFileExists: false })),
  });
}

function schemaFailedAttempt(n: number) {
  return buildAttemptRecord({
    attempt: n,
    claudeOutcome: "failure",
    structuredOutput: undefined,
    executionFilePath: "/x.json",
    executionFileExists: true,
    executionFileBytes: 10,
    executionFileStale: false,
    executionFileContent: executionFile([INIT_MESSAGE, successResultMessage('{"summary":"sin score"}')]),
    resolved: false,
    outputSource: "none",
    classification: {
      failureKind: "schema_validation_failed",
      retriable: false,
      reason: "determinista",
      evidence: 'falta la propiedad requerida "score"',
      attempt: n,
    },
  });
}

function runDriver(args: string[], extraEnv: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const script = path.join(__dirname, "..", "scripts", "claude-runtime-attempt-for-ci.ts");
  const env = { ...process.env, ...extraEnv };
  delete env.GITHUB_OUTPUT;
  return spawnSync("npx", ["ts-node", script, ...args], { encoding: "utf-8", env, cwd: path.join(__dirname, "..") });
}
