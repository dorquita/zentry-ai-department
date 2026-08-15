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

function readWorkflowConfigLines(): string {
  return fs
    .readFileSync(WORKFLOW_PATH, "utf-8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/**
 * Fuentes de la capa de COORDINACION (analisis y ensamblado del Daily
 * Brief). Sigue siendo READ / ANALYZE / PROPOSE al 100%: ni un solo
 * modulo de aqui puede alcanzar un sistema externo.
 *
 * Se incluyen tambien `src/department/apply/**`: la PLANIFICACION del
 * apply y su executor son puros a proposito -- el executor recibe sus
 * dependencias inyectadas, y el unico sitio de todo el sistema donde se
 * cablea el adaptador real de WordPress es scripts/run-department-apply.ts
 * (verificado por su propio test mas abajo).
 */
function readDepartmentSources(): { file: string; content: string }[] {
  const departmentDir = path.join(PROJECT_ROOT, "src", "department");
  const applyDir = path.join(departmentDir, "apply");
  const files = [
    ...fs.readdirSync(departmentDir).map((name) => path.join(departmentDir, name)),
    ...fs.readdirSync(applyDir).map((name) => path.join(applyDir, name)),
  ];
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
        // La capa `src/department/**` sigue SIN conocer ningun cliente de
        // ningun sistema externo, incluso ahora que contiene los
        // executors de staging y produccion: sus dependencias llegan
        // INYECTADAS desde los puntos de cableado (scripts/
        // run-department-apply.ts y src/agents/department-telegram-ports.ts).
        // Por eso este guard NO se relaja al añadir el apply: se hace mas
        // preciso ("agents/" cubre cualquier agente, incluido el Staging
        // Executor historico, sin confundirse con el modulo interno
        // src/department/apply/staging-executor.ts).
        const forbiddenImports = [
          "googleapis",
          "nodemailer",
          "../core/mailer",
          "core/telegram-gateway",
          "../core/wordpress-drafts",
          "agents/",
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
      name: "Solo DOS ficheros cablean WordPress para el apply, y unicamente con las 5 funciones permitidas",
      fn: () => {
        // El apply del departamento pasa a poder escribir tambien en
        // PRODUCCION -- pero solo tras una aprobacion humana explicita de
        // la version exacta que hay en staging (ver
        // src/department/apply/production-executor.ts y la maquina de
        // estados). Este guard acota que puede tocarse, y desde donde.
        const wiringFiles = [
          path.join(PROJECT_ROOT, "scripts", "run-department-apply.ts"),
          path.join(PROJECT_ROOT, "src", "agents", "department-telegram-ports.ts"),
        ];

        // Las UNICAS operaciones permitidas: leer (staging/produccion),
        // buscar el destino de produccion por slug, y actualizar el
        // contenido de una pagina YA PUBLICADA (que nunca cambia status
        // ni slug) en cada entorno.
        const allowed = [
          "getWordpressPage",
          "updateStagingPublishedPageContent",
          "getProductionPage",
          "searchProductionPagesBySlug",
          "updateProductionPublishedPageContent",
        ];
        // Nada que cree, publique, despublique, borre o restaure. Y
        // ninguna funcion de BORRADOR: este flujo no usa drafts.
        const forbidden = [
          "createWordpressDraftPage",
          "updateWordpressDraftPage",
          "publishStagingDraftPage",
          "unpublishStagingPage",
          "trashStagingPage",
          "createProductionDraftPage",
          "updateProductionDraftPage",
          "trashProductionPage",
          "restoreProductionPageFromTrash",
          "uploadMediaToWordpress",
          "uploadMediaToProduction",
          "woocommerce",
          "novamira",
          "production-draft-executor",
        ];

        for (const file of wiringFiles) {
          const content = fs.readFileSync(file, "utf-8");
          const relative = path.relative(PROJECT_ROOT, file);
          for (const name of forbidden) {
            assert.ok(!content.includes(name), `${relative} menciona "${name}": fuera del alcance permitido del apply del departamento`);
          }
          const used = allowed.filter((name) => content.includes(name));
          assert.ok(used.length > 0, `${relative} deberia cablear alguna de las funciones permitidas`);
        }

        const runner = fs.readFileSync(wiringFiles[0], "utf-8");
        assert.ok(runner.includes("getWordpressPage"), "el apply necesita leer el estado previo (snapshot)");
        assert.ok(runner.includes("updateStagingPublishedPageContent"), "el apply de staging actualiza paginas ya publicadas, nunca borradores");
      },
    },
    {
      name: "PRODUCCION solo es alcanzable con aprobacion humana: el executor exige `approved` y recomprueba la version de staging",
      fn: () => {
        const executor = fs.readFileSync(path.join(PROJECT_ROOT, "src", "department", "apply", "production-executor.ts"), "utf-8");
        assert.ok(executor.includes("isProductionApplyAllowedFrom"), "el executor de produccion consulta la maquina de estados");
        assert.ok(executor.includes("matchesApprovedVersion"), "y recomprueba que staging sigue siendo la version aprobada (anti-TOCTOU)");
        assert.ok(executor.includes("checkProductionApplyGuards"), "y comprueba los interruptores de produccion");

        // El runner nunca puede publicar sin que los DOS registros (el
        // persistente de cambios y el comun de aprobaciones) coincidan.
        const runner = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "run-department-apply.ts"), "utf-8");
        assert.ok(runner.includes("resolveHumanApproval"), "el runner cruza el registro comun de aprobaciones antes de publicar");
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
      name: "El workflow del departamento existe, mantiene workflow_dispatch y declara contents: read",
      fn: () => {
        assert.ok(fs.existsSync(WORKFLOW_PATH), "falta .github/workflows/zentry-ai-department-daily.yml");
        const withoutComments = readWorkflowConfigLines();

        assert.ok(withoutComments.includes("workflow_dispatch:"), "el disparo manual NUNCA se quita");
        assert.ok(/permissions:\s*\n\s*contents:\s*read/.test(withoutComments), "el workflow debe declarar contents: read y nada mas");
        assert.ok(!withoutComments.includes("contents: write"));
        assert.ok(!withoutComments.includes("id-token: write"));
      },
    },
    {
      name: "El workflow tiene UN UNICO schedule diario (07:00 UTC) -- nunca varias pasadas al dia",
      fn: () => {
        const withoutComments = readWorkflowConfigLines();
        assert.ok(/^\s*schedule:/m.test(withoutComments), "la pasada coordinada debe tener schedule diario");
        const crons = [...withoutComments.matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm)].map((m) => m[1]);
        assert.equal(crons.length, 1, `debe haber exactamente un cron, hay ${crons.length}: ${crons.join(" | ")}`);
        assert.equal(crons[0], "0 7 * * *", "la convencion documentada es 07:00 UTC diario (~09:00 Espana en verano, 08:00 en invierno)");
      },
    },
    {
      name: "La concurrency del departamento sigue protegida (una sola pasada a la vez, sin cancelar la que ya corre)",
      fn: () => {
        const withoutComments = readWorkflowConfigLines();
        assert.ok(/concurrency:\s*\n\s*group:\s*zentry-ai-department-daily/.test(withoutComments), "falta el grupo de concurrency");
        assert.ok(/cancel-in-progress:\s*false/.test(withoutComments), "una pasada en curso nunca se cancela por otra");
      },
    },
    {
      name: "El workflow no relaja ningun guard: sin bypassPermissions, sin MCP, sin commits ni escrituras de contenido",
      fn: () => {
        // Solo lineas de CONFIGURACION: los comentarios del propio
        // workflow mencionan estas palabras precisamente para documentar
        // que NO se usan (p.ej. "sin bypassPermissions").
        const configLines = readWorkflowConfigLines();
        for (const forbidden of ["bypassPermissions", "--mcp", "mcp-config", "git push", "git commit", "wp-json", "googleads"]) {
          assert.ok(!configLines.includes(forbidden), `el workflow contiene "${forbidden}" fuera de un comentario`);
        }
      },
    },
    {
      name: "El workflow NUNCA invoca la fase que escribe de verdad (department:apply --phase apply): solo planifica",
      fn: () => {
        const configLines = readWorkflowConfigLines();
        assert.ok(configLines.includes("--phase plan"), "el workflow debe planificar el contrato de apply");
        assert.ok(
          !/--phase\s+apply/.test(configLines),
          "el workflow del departamento NO puede lanzar la fase de escritura real: exige aprobacion humana registrada y los interruptores de entorno"
        );
        for (const forbidden of ["DEPARTMENT_APPLY_ENABLED", "WORDPRESS_DRAFTS_ENABLED", "WORDPRESS_APP_PASSWORD"]) {
          assert.ok(!configLines.includes(forbidden), `el workflow no debe recibir "${forbidden}": no puede escribir en WordPress`);
        }
      },
    },
    {
      name: "El step de email recibe los secretos SOLO como env de ese step y nunca los imprime",
      fn: () => {
        const workflow = fs.readFileSync(WORKFLOW_PATH, "utf-8");
        // Los secretos de correo solo pueden aparecer como valor de una
        // variable de entorno (`SMTP_PASS: <expresion>`), nunca dentro de
        // un `run:` que los eche por consola.
        const runLines = workflow.split("\n").filter((line) => /echo|cat /.test(line));
        for (const line of runLines) {
          for (const secret of ["SMTP_PASS", "SMTP_USER", "DAILY_BRIEF_EMAIL_TO", "REPORT_EMAIL_TO"]) {
            assert.ok(!line.includes(secret), `una linea que imprime menciona "${secret}": ningun valor de configuracion de correo puede acabar en el log`);
          }
        }
        assert.ok(workflow.includes("SMTP_PASS: ${{ secrets.SMTP_PASS }}"), "el step de email debe recibir SMTP_PASS como secret, no hardcodeado");
        assert.ok(!/SMTP_PASS:\s*['"][^$]/.test(workflow), "ningun secreto puede estar escrito literalmente en el workflow");
      },
    },
    {
      name: "Cada invocacion de Claude guarda su coste en SU PROPIA ruta (el execution file ya no se pisa entre empleados)",
      fn: () => {
        const workflow = fs.readFileSync(WORKFLOW_PATH, "utf-8");
        const recordPaths = [...workflow.matchAll(/execution-record-path:\s*(.+)/g)].map((m) => m[1].trim());
        assert.equal(recordPaths.length, 6, "los seis empleados deben registrar su propio coste");
        assert.equal(new Set(recordPaths).size, 6, "las seis rutas de registro deben ser DISTINTAS entre si");
        for (const agent of ["seo-specialist", "content-strategist", "analytics-specialist", "growth-director-v2", "qa-reviewer", "web-engineer"]) {
          assert.ok(
            recordPaths.some((p) => p.includes(`/stages/${agent}/claude-execution.json`)),
            `falta el registro de coste propio de ${agent}`
          );
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
