import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { isExecutionFileStale, resolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { classifyClaudeEmployeeFailure } from "../src/core/claude-employee-retry";
import { JsonSchemaLite } from "../src/core/json-schema-lite";
import { checkSubagentIsToolless, loadSubagentToolAllowlist, parseAgentFrontmatterTools, hasNoExternalWriteTools, isSubagentToolAllowed, SIDE_EFFECT_FREE_SDK_TOOLS } from "../src/core/subagent-tool-guard";

export interface TestCase {
  name: string;
  fn: () => void;
}

const AGENT = "seo-specialist";
const SCHEMA_PATH = path.join(__dirname, "..", "config", "seo-specialist-output.schema.json");

function seoSchema(): JsonSchemaLite {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8")) as JsonSchemaLite;
}

/**
 * Salida SEO minima pero COMPLETA segun el contrato real. No es un
 * fixture "de juguete": recorre las 9 propiedades obligatorias de nivel
 * superior y al menos un item de cada tipo de objeto anidado, para que
 * este test detecte de verdad un cambio de contrato.
 */
function validSeoOutput(): Record<string, unknown> {
  return {
    executiveSummary: "Resumen ejecutivo de prueba.",
    findings: [{ id: "F1", category: "technical", description: "Hallazgo de prueba.", basis: "evidence", evidenceRefs: ["E1"] }],
    opportunities: [{ id: "O1", keyword: "taquillas metalicas", kind: "quick_win", priority: "high", recommendedAction: "Accion de prueba.", rationale: "Motivo de prueba.", basis: "evidence", evidenceRefs: ["E1"] }],
    technicalIssues: [{ id: "T1", page: "/taquillas-metalicas/", issue: "Problema de prueba.", severity: "medium", basis: "evidence", evidenceRefs: ["E1"] }],
    contentGaps: [{ id: "G1", topic: "Tema de prueba", rationale: "Motivo de prueba.", basis: "inference", evidenceRefs: [] }],
    internalLinkRecommendations: [{ id: "L1", fromPage: "/a/", toPage: "/b/", anchorTextSuggestion: "ancla", rationale: "Motivo.", basis: "inference", evidenceRefs: [] }],
    prioritizedActions: [{ rank: 1, title: "Accion prioritaria", relatedIds: ["O1"], priority: "high", effort: "low", impact: "high" }],
    evidence: [{ id: "E1", source: "job_data", description: "Evidencia de prueba." }],
    unknowns: ["Algo que no se sabe."],
  };
}

function executionFile(resultPayload: unknown): string {
  return JSON.stringify([
    { type: "system", subtype: "init" },
    { type: "result", subtype: "success", is_error: false, result: typeof resultPayload === "string" ? resultPayload : JSON.stringify(resultPayload) },
  ]);
}

export function runSeoSpecialistRuntimeReliabilityTests(): TestCase[] {
  return [
    // =====================================================================
    // A / B -- El camino que el incidente P0 dejo inerte: structured_output
    // =====================================================================
    {
      name: `REGRESION (incidente P0): ${AGENT} tiene concedida StructuredOutput -- sin ella, --json-schema queda INERTE y el contrato depende de que el modelo acierte el JSON a mano`,
      fn: () => {
        const allowlist = loadSubagentToolAllowlist();
        const entry = allowlist.agents[AGENT];
        assert.ok(entry, `${AGENT} deberia existir en el allowlist`);
        assert.deepEqual(entry.allowedTools, ["StructuredOutput"]);
        assert.deepEqual(parseAgentFrontmatterTools(AGENT), ["StructuredOutput"]);
      },
    },
    {
      name: `B (structured output valido): una salida SEO completa recuperada por structured_output pasa el JSON Schema versionado`,
      fn: () => {
        const resolved = resolveClaudeEmployeeOutput({
          structuredOutput: JSON.stringify(validSeoOutput()),
          executionFileContent: undefined,
          outputSchema: seoSchema(),
        });
        assert.equal(resolved.source, "structured_output");
      },
    },
    {
      name: `A (SEO success normal): la MISMA salida recuperada por el fallback del execution_file pasa el MISMO schema -- paridad de contrato entre caso A y caso B`,
      fn: () => {
        const resolved = resolveClaudeEmployeeOutput({
          structuredOutput: undefined,
          executionFileContent: executionFile(validSeoOutput()),
          outputSchema: seoSchema(),
        });
        assert.equal(resolved.source, "execution_file_fallback");
      },
    },
    {
      name: `REGRESION (fallo real reproducido): un technicalIssue sin "page" -- el fallo exacto del run 31949966340 -- se rechaza y se clasifica como reintentable, nunca se acepta`,
      fn: () => {
        const output = validSeoOutput();
        const issues = output.technicalIssues as Array<Record<string, unknown>>;
        delete issues[0].page;
        let thrown: unknown;
        try {
          resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: executionFile(output), outputSchema: seoSchema() });
        } catch (err) {
          thrown = err;
        }
        assert.ok(thrown, "una salida sin technicalIssues[].page NUNCA puede aceptarse");
        assert.match(String((thrown as Error).message), /falta la propiedad requerida "page"/);
        assert.equal(classifyClaudeEmployeeFailure(thrown).retryable, true);
      },
    },

    // =====================================================================
    // F -- El execution_file compartido entre intentos
    // =====================================================================
    {
      name: "F (execution_file stale no se reutiliza): un execution_file escrito ANTES del inicio del intento se considera obsoleto",
      fn: () => {
        const attemptStartedMs = 1_000_000;
        assert.equal(isExecutionFileStale({ mtimeMs: attemptStartedMs - 1, attemptStartedMs }), true);
        assert.equal(isExecutionFileStale({ mtimeMs: attemptStartedMs, attemptStartedMs }), false);
        assert.equal(isExecutionFileStale({ mtimeMs: attemptStartedMs + 1, attemptStartedMs }), false);
      },
    },
    {
      name: "F (compatibilidad): sin marca de inicio de intento, ningun execution_file se descarta -- comportamiento identico al de antes del reintento",
      fn: () => {
        assert.equal(isExecutionFileStale({ mtimeMs: 1, attemptStartedMs: undefined }), false);
        assert.equal(isExecutionFileStale({ mtimeMs: 1, attemptStartedMs: Number.NaN }), false);
      },
    },
    {
      name: "E (los intentos no mezclan salidas): descartar el execution_file obsoleto y no tener structured_output deja el caso C (fallo explicito), nunca la salida del intento anterior",
      fn: () => {
        let thrown: unknown;
        try {
          // Exactamente lo que ve el resolutor cuando el fichero se
          // descarto por obsoleto: executionFileContent === undefined.
          resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: undefined, outputSchema: seoSchema() });
        } catch (err) {
          thrown = err;
        }
        assert.ok(thrown);
        assert.match(String((thrown as Error).message), /no recuperable \(caso C\)/);
      },
    },

    // =====================================================================
    // G -- Volumen real de SEO
    // =====================================================================
    {
      name: "G (SEO input grande no rompe el resolver): una salida con 60 items por coleccion se resuelve y valida sin degradarse",
      fn: () => {
        const base = validSeoOutput();
        const big: Record<string, unknown> = { ...base };
        for (const key of ["findings", "opportunities", "technicalIssues", "contentGaps", "internalLinkRecommendations", "prioritizedActions", "evidence"]) {
          const template = (base[key] as unknown[])[0] as Record<string, unknown>;
          big[key] = Array.from({ length: 60 }, (_unused, index) => ({ ...template, id: `${key}-${index}`, rank: index + 1 }));
        }
        // `prioritizedAction` no admite `id` (additionalProperties:false):
        // se reconstruye con su forma exacta.
        big.prioritizedActions = Array.from({ length: 60 }, (_unused, index) => ({ rank: index + 1, title: `Accion ${index}`, relatedIds: [], priority: "low", effort: "low", impact: "low" }));
        // `evidenceItem` tampoco admite `rank`.
        big.evidence = Array.from({ length: 60 }, (_unused, index) => ({ id: `E${index}`, source: "job_data", description: `Evidencia ${index}` }));
        for (const key of ["findings", "opportunities", "technicalIssues", "contentGaps", "internalLinkRecommendations"]) {
          big[key] = (big[key] as Array<Record<string, unknown>>).map(({ rank: _rank, ...rest }) => rest);
        }

        const resolved = resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: executionFile(big), outputSchema: seoSchema() });
        assert.equal(resolved.source, "execution_file_fallback");
        assert.equal((resolved.parsed as { findings: unknown[] }).findings.length, 60);
      },
    },

    // =====================================================================
    // H -- La concesion no puede convertirse en una puerta trasera
    // =====================================================================
    {
      name: `H (seguridad): conceder StructuredOutput a ${AGENT} NO le concede ninguna capacidad -- lectura, escritura, red y ejecucion siguen denegadas`,
      fn: () => {
        for (const tool of ["Read", "Grep", "Glob", "Write", "Edit", "Bash", "NotebookEdit", "WebFetch", "WebSearch", "Task", "mcp__github__push_files"]) {
          assert.equal(isSubagentToolAllowed(AGENT, tool).allowed, false, `${tool} NO deberia estar permitida para ${AGENT}`);
        }
        assert.equal(hasNoExternalWriteTools(AGENT), true);
        assert.equal(checkSubagentIsToolless(AGENT).ok, true);
      },
    },
    {
      name: "H (seguridad): la lista de herramientas sin efectos es cerrada -- hoy contiene EXACTAMENTE StructuredOutput",
      fn: () => {
        assert.deepEqual([...SIDE_EFFECT_FREE_SDK_TOOLS], ["StructuredOutput"]);
      },
    },
    {
      name: "H (los otros empleados siguen pasando): todo empleado del allowlist sigue cumpliendo el guard, y ninguno gana herramientas de capacidad",
      fn: () => {
        const allowlist = loadSubagentToolAllowlist();
        for (const agentName of Object.keys(allowlist.agents)) {
          const result = checkSubagentIsToolless(agentName, allowlist);
          assert.ok(result.ok, `"${agentName}": ${JSON.stringify(result.reasons)}`);
          for (const tool of allowlist.agents[agentName].allowedTools) {
            assert.ok(SIDE_EFFECT_FREE_SDK_TOOLS.includes(tool), `"${agentName}" no puede tener concedida "${tool}"`);
          }
        }
      },
    },
    {
      name: "H (deteccion de drift en los DOS sentidos): si el allowlist concede StructuredOutput pero el .md no lo declara, el guard lo detecta",
      fn: () => {
        const real = loadSubagentToolAllowlist();
        const drifted = {
          ...real,
          agents: {
            [AGENT]: { ...real.agents[AGENT], definitionFile: "test/fixtures/fake-agent-with-tools.md" },
          },
        };
        const result = checkSubagentIsToolless(AGENT, drifted);
        assert.equal(result.ok, false);
        assert.ok(result.reasons.some((reason) => /NO coincide con allowedTools/.test(reason)), JSON.stringify(result.reasons));
      },
    },
  ];
}
