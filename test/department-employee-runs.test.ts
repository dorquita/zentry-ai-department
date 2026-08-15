import * as assert from "node:assert/strict";
import { buildClaudeEmployeeExecutionRecord, CLAUDE_EXECUTION_RECORD_CONTRACT_VERSION } from "../src/core/claude-employee-execution-record";
import { parseEmployeeRunRecord, summarizeDepartmentRunCost } from "../src/department/employee-runs";
import { resolveStageFilePaths, toRepoRelative } from "../src/department/run-store";
import { DEPARTMENT_STAGE_NAMES } from "../src/department/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const RUN_ID = "dept-2026-08-15T120000Z";

function executionFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    { type: "system", subtype: "init", model: "claude-opus-x" },
    { type: "assistant", message: { model: "claude-opus-x" } },
    { type: "result", subtype: "success", is_error: false, num_turns: 4, duration_ms: 65_000, total_cost_usd: 0.1234, result: '{"ok":true}', ...overrides },
  ]);
}

export function runDepartmentEmployeeRunsTests(): TestCase[] {
  return [
    // --- El fallo que esta fase corrige ---
    {
      name: "Cada empleado tiene su PROPIA ruta de registro dentro del departmentRunId (ya no se pisan entre si)",
      fn: () => {
        const paths = DEPARTMENT_STAGE_NAMES.map((stage) => toRepoRelative(resolveStageFilePaths(RUN_ID, stage).executionRecordPath));
        assert.equal(new Set(paths).size, DEPARTMENT_STAGE_NAMES.length, "las rutas de registro deben ser todas distintas");
        for (const p of paths) assert.ok(p.startsWith(`reports/department/${RUN_ID}/stages/`), `ruta fuera del run: ${p}`);
      },
    },

    // --- Parseo del execution file ---
    {
      name: "Del execution file se extraen empleado, modelo, duracion, coste, turnos y resultado",
      fn: () => {
        const record = buildClaudeEmployeeExecutionRecord({
          employee: "seo-specialist",
          executionFileContent: executionFile(),
          outputSource: "structured_output",
          claudeOutcome: "success",
        });
        assert.equal(record.contractVersion, CLAUDE_EXECUTION_RECORD_CONTRACT_VERSION);
        assert.equal(record.employee, "seo-specialist");
        assert.equal(record.model, "claude-opus-x");
        assert.equal(record.durationMs, 65_000);
        assert.equal(record.costUsd, 0.1234);
        assert.equal(record.numTurns, 4);
        assert.equal(record.outputSource, "structured_output");
        assert.equal(record.outcome, "success");
      },
    },
    {
      name: "Un execution file ausente o roto NO lanza: deja las metricas en null con una nota explicita",
      fn: () => {
        const missing = buildClaudeEmployeeExecutionRecord({ employee: "qa-reviewer" });
        assert.equal(missing.costUsd, null);
        assert.equal(missing.numTurns, null);
        assert.match(missing.note, /No hubo execution_file/);

        const broken = buildClaudeEmployeeExecutionRecord({ employee: "qa-reviewer", executionFileContent: "{no es json" });
        assert.equal(broken.costUsd, null);
        assert.match(broken.note, /no es JSON valido/);

        const noResult = buildClaudeEmployeeExecutionRecord({ employee: "qa-reviewer", executionFileContent: JSON.stringify([{ type: "system", model: "m" }]) });
        assert.equal(noResult.model, "m");
        assert.equal(noResult.costUsd, null);
      },
    },
    {
      name: "Una invocacion fallida se registra como error (es justo la que mas interesa medir)",
      fn: () => {
        const record = buildClaudeEmployeeExecutionRecord({
          employee: "growth-director-v2",
          executionFileContent: executionFile({ is_error: true, subtype: "error_max_turns" }),
          claudeOutcome: "failure",
        });
        assert.equal(record.outcome, "error");
        assert.equal(record.numTurns, 4, "las metricas siguen reportandose aunque la invocacion fallara");
      },
    },
    {
      name: "Regresion (E2E run 31897976465): la sesion de Claude manda sobre el codigo de salida del step de la Action",
      fn: () => {
        // Caso REAL de la primera pasada con coste por empleado: los seis
        // empleados ejecutaron y validaron bien, pero claude-code-action
        // termino en "failure" por no entregar structured_output y la
        // salida se recupero via execution_file. El registro decia
        // "error" para los seis, lo cual era simplemente falso.
        const record = buildClaudeEmployeeExecutionRecord({
          employee: "seo-specialist",
          executionFileContent: executionFile(),
          outputSource: "execution_file_fallback",
          claudeOutcome: "failure",
        });
        assert.equal(record.outcome, "success", "la sesion de Claude fue bien: el fallo fue de la ENTREGA de la salida");
        assert.equal(record.outputSource, "execution_file_fallback", "como se entrego la salida se cuenta aqui, que es donde pertenece");
      },
    },
    {
      name: "Sin execution file, el resultado del step de la Action sigue siendo la unica pista disponible",
      fn: () => {
        assert.equal(buildClaudeEmployeeExecutionRecord({ employee: "qa-reviewer", claudeOutcome: "failure" }).outcome, "error");
        assert.equal(buildClaudeEmployeeExecutionRecord({ employee: "qa-reviewer", claudeOutcome: "success" }).outcome, "success");
        assert.equal(buildClaudeEmployeeExecutionRecord({ employee: "qa-reviewer" }).outcome, "unknown");
      },
    },
    {
      name: "Un registro de OTRO empleado no se acepta para esta etapa (fail-closed contra mezclas)",
      fn: () => {
        const record = buildClaudeEmployeeExecutionRecord({ employee: "qa-reviewer", executionFileContent: executionFile() });
        assert.equal(parseEmployeeRunRecord(JSON.stringify(record), "seo-specialist"), undefined);
        assert.ok(parseEmployeeRunRecord(JSON.stringify(record), "qa-reviewer"));
        assert.equal(parseEmployeeRunRecord("{roto", "qa-reviewer"), undefined);
        assert.equal(parseEmployeeRunRecord(JSON.stringify({ contractVersion: "otra/v9", employee: "qa-reviewer" }), "qa-reviewer"), undefined);
      },
    },

    // --- Agregacion de coste ---
    {
      name: "El coste total suma solo lo REALMENTE reportado y se marca parcial si falta alguno",
      fn: () => {
        const summary = summarizeDepartmentRunCost([
          { employee: "seo-specialist", model: "m", durationMs: 1000, costUsd: 0.1, numTurns: 2, outputSource: "structured_output", outcome: "success", note: "" },
          { employee: "qa-reviewer", model: "m", durationMs: 2000, costUsd: 0.2, numTurns: 3, outputSource: "structured_output", outcome: "success", note: "" },
          { employee: "web-engineer", model: null, durationMs: null, costUsd: null, numTurns: null, outputSource: "unknown", outcome: "unknown", note: "sin fichero" },
        ]);
        assert.ok(Math.abs((summary.totalCostUsd ?? 0) - 0.3) < 1e-9);
        assert.equal(summary.totalDurationMs, 3000);
        assert.equal(summary.totalTurns, 5);
        assert.equal(summary.employeesWithCost, 2);
        assert.equal(summary.employeesWithoutCost, 1);
        assert.equal(summary.partial, true, "un coste ausente NO cuenta como 0: el total queda marcado como parcial");
      },
    },
    {
      name: "Sin ningun registro, el coste total es null (no 0)",
      fn: () => {
        const summary = summarizeDepartmentRunCost([]);
        assert.equal(summary.totalCostUsd, null);
        assert.equal(summary.partial, true);
      },
    },
  ];
}
