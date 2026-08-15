import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { extractAndParseDepartmentRunnerResult, parseDepartmentRunnerResultJson } from "../src/department/runner-result";
import { parseStageOutputText, resolveDepartmentRunPaths, resolveStageFilePaths, toRepoRelative } from "../src/department/run-store";
import { assertSupportedContractVersion, buildDepartmentCoordinationRunId, DEPARTMENT_RUN_CONTRACT_VERSION, DEPARTMENT_STAGE_NAMES } from "../src/department/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const PROJECT_ROOT = path.join(__dirname, "..");
const WORKFLOW_PATH = path.join(PROJECT_ROOT, ".github", "workflows", "zentry-ai-department-daily.yml");

function readDepartmentSources(): { file: string; content: string }[] {
  const departmentDir = path.join(PROJECT_ROOT, "src", "department");
  const files = fs.readdirSync(departmentDir).map((name) => path.join(departmentDir, name));
  files.push(path.join(PROJECT_ROOT, "scripts", "run-department-coordination.ts"));
  files.push(path.join(PROJECT_ROOT, "scripts", "parse-department-runner-result-for-ci.ts"));
  return files.filter((f) => f.endsWith(".ts")).map((file) => ({ file: path.relative(PROJECT_ROOT, file), content: fs.readFileSync(file, "utf-8") }));
}

const VALID_RESULT = {
  phase: "brief",
  departmentRunId: "dept-2026-08-15T120000Z",
  status: "ok",
  reason: "listo",
  runDir: "reports/department/dept-2026-08-15T120000Z",
  manifestPath: "reports/department/dept-2026-08-15T120000Z/manifest.json",
  promptFilePath: "",
  expectedOutputPath: "",
  qaInputPath: "",
  promotionPath: "",
  briefJsonPath: "reports/department/dept-2026-08-15T120000Z/department-daily-brief.json",
  briefMdPath: "reports/department/dept-2026-08-15T120000Z/department-daily-brief.md",
  stepSummaryPath: "reports/department/dept-2026-08-15T120000Z/step-summary.md",
  claudeRequired: false,
  promotedCount: 1,
  blockedCount: 0,
  departmentQaStatus: "PASS",
  auditWarningCount: 0,
  priorityCount: 1,
};

export function runDepartmentCoordinationSafetyTests(): TestCase[] {
  return [
    // --- departmentRunId comun entre fases ---
    {
      name: "Todas las rutas de todas las fases cuelgan del MISMO departmentRunId (un unico run, sin artifacts historicos ambiguos)",
      fn: () => {
        const departmentRunId = "dept-2026-08-15T120000Z";
        const paths = resolveDepartmentRunPaths(departmentRunId);
        const expectedPrefix = `reports/department/${departmentRunId}/`;

        for (const [label, value] of Object.entries(paths)) {
          if (label === "departmentRunId" || label === "runDir") continue;
          assert.ok(toRepoRelative(value as string).startsWith(expectedPrefix), `${label} no cuelga del run: ${String(value)}`);
        }
        for (const stage of DEPARTMENT_STAGE_NAMES) {
          const stagePaths = resolveStageFilePaths(departmentRunId, stage);
          for (const [label, value] of Object.entries(stagePaths)) {
            assert.ok(toRepoRelative(value).startsWith(`${expectedPrefix}stages/${stage}`), `${stage}.${label} fuera del run: ${value}`);
          }
        }
        // El bundle de QA lleva el id en el nombre: qa-reviewer deriva su
        // artifactId del basename, asi que la revision queda atada a ESTA pasada.
        assert.ok(path.basename(paths.qaInputPath).startsWith(departmentRunId));
      },
    },
    {
      name: "buildDepartmentCoordinationRunId usa un prefijo DISTINTO del departmentRunId del bus de eventos (no se pueden confundir)",
      fn: () => {
        const id = buildDepartmentCoordinationRunId(new Date("2026-08-15T12:34:56.000Z"));
        assert.equal(id, "dept-2026-08-15T123456Z");
        assert.ok(!id.startsWith("growth-department-"));
      },
    },
    {
      name: "assertSupportedContractVersion es fail-closed ante cualquier version distinta",
      fn: () => {
        assert.doesNotThrow(() => assertSupportedContractVersion(DEPARTMENT_RUN_CONTRACT_VERSION, "manifest.json"));
        assert.throws(() => assertSupportedContractVersion("department-run/v2", "manifest.json"), /no soportada/);
        assert.throws(() => assertSupportedContractVersion(undefined, "manifest.json"), /no soportada/);
      },
    },

    // --- Regresion del primer E2E coordinado (run 31892955242) ---
    {
      name: "parseStageOutputText tolera fences de markdown alrededor del JSON (el runtime comun escribe el texto de Claude TAL CUAL)",
      fn: () => {
        const expected = { executiveSummary: "resumen", findings: [] };
        // Caso que rompio el primer E2E coordinado: JSON.parse directo
        // fallaba con Unexpected token backtick y tumbaba prepare-growth,
        // prepare-qa y el brief entero.
        assert.deepEqual(parseStageOutputText('```json\n{"executiveSummary":"resumen","findings":[]}\n```', "seo-specialist"), expected);
        assert.deepEqual(parseStageOutputText('{"executiveSummary":"resumen","findings":[]}', "seo-specialist"), expected);
        assert.deepEqual(parseStageOutputText('```\n{"executiveSummary":"resumen","findings":[]}\n```', "seo-specialist"), expected);
      },
    },
    {
      name: "parseStageOutputText NO lanza ante un fichero irrecuperable: devuelve undefined para que la etapa se degrade a invalid_output",
      fn: () => {
        assert.equal(parseStageOutputText("esto no es json de ninguna manera", "seo-specialist"), undefined);
        assert.equal(parseStageOutputText("", "seo-specialist"), undefined);
      },
    },

    // --- Contrato RUNNER_RESULT_JSON ---
    {
      name: "El parser de RUNNER_RESULT_JSON acepta una linea valida y usa la ULTIMA si hay varias",
      fn: () => {
        const log = ["ruido de npm", `RUNNER_RESULT_JSON=${JSON.stringify({ ...VALID_RESULT, status: "antiguo" })}`, "mas ruido", `RUNNER_RESULT_JSON=${JSON.stringify(VALID_RESULT)}`].join("\n");
        const result = extractAndParseDepartmentRunnerResult(log);
        assert.equal(result.status, "ok");
        assert.equal(result.priorityCount, 1);
      },
    },
    {
      name: "El parser de RUNNER_RESULT_JSON es fail-closed: campos ausentes, tipos incorrectos o fase desconocida lanzan",
      fn: () => {
        assert.throws(() => parseDepartmentRunnerResultJson(JSON.stringify({ ...VALID_RESULT, phase: "fase-inventada" })), /no es una fase conocida/);
        assert.throws(() => parseDepartmentRunnerResultJson(JSON.stringify({ ...VALID_RESULT, claudeRequired: "true" })), /claudeRequired/);
        assert.throws(() => parseDepartmentRunnerResultJson(JSON.stringify({ ...VALID_RESULT, promotedCount: "1" })), /promotedCount/);
        assert.throws(() => parseDepartmentRunnerResultJson("{no es json"), /no es JSON valido/);
        assert.throws(() => extractAndParseDepartmentRunnerResult("sin ninguna linea util"), /No se encontro/);
      },
    },

    // --- Seguridad: cero escrituras externas ---
    {
      name: "Ningun modulo de la capa de departamento importa clientes de sistemas externos (WordPress/Google/email/Telegram/staging/produccion)",
      fn: () => {
        const forbiddenImports = [
          "googleapis",
          "nodemailer",
          "../core/mailer",
          "../core/telegram-gateway",
          "../core/wordpress-drafts",
          "wordpress-draft-agent",
          "staging-executor",
          "production-draft-executor",
          "adapters/",
        ];
        for (const { file, content } of readDepartmentSources()) {
          const importLines = content.split("\n").filter((line) => /^\s*import\s/.test(line) || /require\(/.test(line));
          for (const forbidden of forbiddenImports) {
            assert.ok(
              !importLines.some((line) => line.includes(forbidden)),
              `${file} importa "${forbidden}" -- la pasada coordinada es READ/ANALYZE/PROPOSE y no puede alcanzar ningun sistema externo.`
            );
          }
        }
      },
    },
    {
      name: "Ningun modulo de la capa de departamento hace peticiones de red ni ejecuta comandos",
      fn: () => {
        for (const { file, content } of readDepartmentSources()) {
          for (const forbidden of ["fetch(", "https.request", "http.request", "child_process", "execSync", "spawnSync"]) {
            assert.ok(!content.includes(forbidden), `${file} contiene "${forbidden}" -- prohibido en esta fase.`);
          }
        }
      },
    },
    {
      name: "Los 6 empleados que participan en la pasada siguen siendo cero-herramientas (allowlist + frontmatter)",
      fn: () => {
        for (const agent of ["seo-specialist", "content-strategist", "analytics-specialist", "growth-director-v2", "qa-reviewer", "web-engineer"]) {
          assert.doesNotThrow(() => assertSubagentIsToolless(agent), `${agent} deberia seguir siendo cero-herramientas`);
        }
      },
    },

    // --- Seguridad del workflow ---
    {
      name: "El workflow del departamento existe, es SOLO workflow_dispatch (sin schedule) y declara contents: read",
      fn: () => {
        assert.ok(fs.existsSync(WORKFLOW_PATH), "falta .github/workflows/zentry-ai-department-daily.yml");
        const workflow = fs.readFileSync(WORKFLOW_PATH, "utf-8");
        const withoutComments = workflow
          .split("\n")
          .filter((line) => !/^\s*#/.test(line))
          .join("\n");

        assert.ok(withoutComments.includes("workflow_dispatch:"));
        assert.ok(!/^\s*schedule:/m.test(withoutComments), "esta fase NO activa schedules");
        assert.ok(/permissions:\s*\n\s*contents:\s*read/.test(withoutComments), "el workflow debe declarar contents: read y nada mas");
        assert.ok(!withoutComments.includes("contents: write"));
        assert.ok(!withoutComments.includes("id-token: write"));
      },
    },
    {
      name: "El workflow no relaja ningun guard: sin bypassPermissions, sin MCP, sin escrituras externas ni commits",
      fn: () => {
        // Solo lineas de CONFIGURACION: los comentarios del propio
        // workflow mencionan estas palabras precisamente para documentar
        // que NO se usan (p.ej. "sin bypassPermissions").
        const configLines = fs
          .readFileSync(WORKFLOW_PATH, "utf-8")
          .split("\n")
          .filter((line) => !/^\s*#/.test(line))
          .join("\n");
        for (const forbidden of ["bypassPermissions", "--mcp", "mcp-config", "git push", "git commit", "wp-json", "googleads", "smtp"]) {
          assert.ok(!configLines.includes(forbidden), `el workflow contiene "${forbidden}" fuera de un comentario`);
        }
      },
    },
    {
      name: "Cada etapa Claude del workflow usa el runtime comun SIN modificarlo, con timeout-minutes: 10 en el step caller",
      fn: () => {
        const workflow = fs.readFileSync(WORKFLOW_PATH, "utf-8");
        const runtimeUses = workflow.match(/uses:\s*\.\/\.github\/actions\/claude-employee-runtime/g) ?? [];
        // 6 empleados Claude en la pasada: SEO, Content, Analytics, Growth, QA, Web Engineer.
        assert.equal(runtimeUses.length, 6, "cada etapa Claude debe invocar el runtime comun");
        const timeouts = workflow.match(/timeout-minutes:\s*10/g) ?? [];
        assert.ok(timeouts.length >= 6, "cada step del runtime comun debe llevar su timeout-minutes: 10");
        assert.ok(workflow.includes("agent-name: sem-specialist") === false, "sem-specialist NO se ejecuta en esta fase");
      },
    },
  ];
}
