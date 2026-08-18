import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import {
  DEPARTMENT_RUNNER_RESULT_FIELDS,
  extractAndParseDepartmentRunnerResult,
  parseDepartmentRunnerResultJson,
} from "../src/department/runner-result";
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
  // Bucle QA -> correccion -> re-QA. Van en el contrato COMUN, no solo
  // en las fases del bucle: el workflow lee siempre los mismos campos
  // sin ramificar por fase, que es justamente lo que hace que este
  // contrato sea util.
  qaLoopStatus: "",
  correctionRequired: false,
  nextRound: 0,
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
      name: "Solo el runner de GitHub Actions cablea WordPress para el apply, y unicamente con las 5 funciones permitidas",
      fn: () => {
        // El apply del departamento pasa a poder escribir tambien en
        // PRODUCCION -- pero solo tras una aprobacion humana explicita de
        // la version exacta que hay en staging (ver
        // src/department/apply/production-executor.ts y la maquina de
        // estados). Este guard acota que puede tocarse, y desde donde.
        // Desde la fase serverless hay UN solo cableado de WordPress para
        // el apply: el runner de GitHub Actions. La funcion serverless NO
        // toca WordPress bajo ninguna circunstancia -- eso se comprueba
        // aparte, en el guard del Worker.
        const wiringFiles = [path.join(PROJECT_ROOT, "scripts", "run-department-apply.ts")];

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
      // AMPLIACION DELIBERADA DEL ALCANCE. Hasta ahora "novamira" estaba
      // en la lista de prohibidos del test de arriba, porque el apply de
      // la pasada diaria solo sabia hacer title/meta por REST. Esa
      // prohibicion tenia un efecto que NO era el buscado: el
      // departamento producia ChangePlans ejecutables y despues no los
      // ejecutaba, porque el unico camino capaz de aplicarlos
      // (`novamira/execute-php`) estaba vetado justo en el script que
      // tenia que llamarlo. Se aplicaban a mano, o no se aplicaban.
      //
      // El veto se levanta, pero NO se afloja: lo que antes era "no lo
      // menciones" pasa a ser "solo puedes usarlo asi", que es una
      // condicion mas fuerte y comprobable. El executor es el MISMO que
      // ya certifico el E2E controlado, con su guard determinista, su
      // catalogo cerrado de operaciones y produccion bloqueada.
      name: "El apply diario solo puede usar Novamira para execute-php en STAGING, nunca para otra cosa ni en otro entorno",
      fn: () => {
        const runner = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "run-department-apply.ts"), "utf-8");

        // 1. La UNICA ability invocable es execute-php.
        const abilities = [...runner.matchAll(/abilityName:\s*"([^"]+)"/g)].map((m) => m[1]);
        assert.ok(abilities.length > 0, "el apply debe declarar explicitamente que ability usa");
        for (const ability of abilities) {
          assert.equal(ability, "novamira/execute-php", `ability no permitida en el apply diario: "${ability}"`);
        }

        // 2. El UNICO entorno alcanzable desde aqui es staging.
        const environments = [...runner.matchAll(/environment:\s*"([^"]+)"/g)].map((m) => m[1]);
        assert.ok(environments.length > 0, "cada invocacion de execute-php debe declarar su entorno");
        for (const environment of environments) {
          assert.equal(environment, "staging", `el apply diario no puede invocar execute-php sobre "${environment}"`);
        }

        // 3. Se pasa por el executor guardado, no por el cliente MCP a pelo.
        assert.ok(
          runner.includes("runExecutableChangePlan"),
          "el ChangePlan debe ejecutarse por el executor compartido (snapshot, read-back, validacion y rollback), nunca llamando al MCP directamente"
        );
        assert.ok(
          !/callNovamiraExecutePhp\s*\(\s*\{[^}]*environment:\s*"production"/s.test(runner),
          "ninguna invocacion de execute-php desde el apply diario puede apuntar a produccion"
        );

        // 4. La decision de ejecutar es de la capa de politica, no del bucle.
        assert.ok(
          runner.includes("decideChangePlanExecution"),
          "ejecutar o no un ChangePlan debe decidirlo la funcion pura de politica, que es la que se puede testear sin red"
        );
      },
    },
    {
      // REGRESION REAL (pasada dept-2026-08-18T012804Z, run 32088261661).
      //
      // QA bloqueo con 9 correcciones estructuradas, el bucle decidio
      // `request_correction` y lo dejo escrito en `qa-loop-growth.json`
      // con `finalStatus: in_progress`. Y no paso NADA: ninguna ronda de
      // correccion se ejecuto.
      //
      // El motivo: el parser de CI enumeraba a mano los campos que
      // publica como outputs, y esa lista se quedo sin
      // `correctionRequired` cuando el contrato crecio. El workflow
      // condiciona TODO el bucle -- el de Growth y el del plan -- a
      // `steps.qa_gate.outputs.correctionRequired == 'true'`, asi que
      // leia un output que nunca existio y la condicion era
      // permanentemente falsa.
      //
      // La misma forma que los demas cortes de esta puesta en marcha: el
      // sistema DECIDE bien y la decision no llega a quien tiene que
      // actuar. Un output que falta no rompe nada de forma visible --
      // simplemente apaga una rama entera en silencio.
      name: "El parser de CI publica TODOS los campos del contrato, incluidos los que gobiernan el bucle de correccion",
      fn: () => {
        const parser = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "parse-department-runner-result-for-ci.ts"), "utf-8");
        const workflow = fs.readFileSync(path.join(PROJECT_ROOT, ".github", "workflows", "zentry-ai-department-daily.yml"), "utf-8");

        // 1. La lista de campos se DERIVA del contrato, no se escribe a
        //    mano: es lo unico que impide que vuelva a desincronizarse.
        assert.ok(
          parser.includes("DEPARTMENT_RUNNER_RESULT_FIELDS"),
          "el parser debe recorrer la lista derivada del contrato, no una enumeracion a mano"
        );

        // 2. Todo output que el workflow lea DE UN STEP DE ESTE PARSER
        //    tiene que ser un campo real del contrato. Si lee
        //    `steps.X.outputs.foo` y `foo` no existe, la condicion es
        //    falsa para siempre y nadie se entera.
        //
        //    Se acota a los steps de ESTE parser a proposito: el
        //    workflow lee ademas outputs de la composite action del
        //    runtime y de los parsers por empleado, que tienen sus
        //    propios contratos. Una lista blanca de nombres ajenos se
        //    quedaria obsoleta igual que se quedo la del parser.
        const contract = new Set<string>(DEPARTMENT_RUNNER_RESULT_FIELDS as readonly string[]);
        const parserStepIds = new Set<string>();
        for (const chunk of workflow.split(/^      - name:/m)) {
          if (!chunk.includes("department:parse-runner-result-for-ci")) continue;
          const id = /^\s*id:\s*([A-Za-z0-9_-]+)\s*$/m.exec(chunk);
          if (id) parserStepIds.add(id[1]);
        }
        assert.ok(parserStepIds.size > 0, "no se ha encontrado ningun step que use el parser: el test no estaria comprobando nada");

        // El guion cuenta: los outputs de la composite action se llaman
        // `claude-outcome`, `output-source`... y un patron sin guion los
        // trunca a `claude`.
        for (const [, stepId, output] of workflow.matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g)) {
          if (!parserStepIds.has(stepId)) continue;
          assert.ok(
            contract.has(output),
            `el workflow lee "steps.${stepId}.outputs.${output}", pero "${output}" no es un campo del contrato que ese step publica: la condicion seria falsa para siempre`
          );
        }

        // 3. Y en concreto los tres del bucle, que son los que faltaban.
        for (const field of ["qaLoopStatus", "correctionRequired", "nextRound"]) {
          assert.ok(contract.has(field), `"${field}" debe formar parte del contrato publicado como output`);
        }
      },
    },
    {
      // REGRESION REAL (run 32087245294). Todo envoltorio que entregue
      // PHP a `callNovamiraExecutePhp` tiene que DEDUCIR la fase del PHP
      // que recibe, nunca fijarla.
      //
      // El E2E la fijaba en "apply". Cuando el executor lanzo su rollback
      // automatico, el guard comparo el PHP de reversion contra la
      // plantilla determinista del apply, no coincidio, y bloqueo la
      // propia reversion (`php_not_deterministic`). El apply ya habia
      // escrito: la pagina quedo a medias.
      //
      // El guard hizo su trabajo. Lo que mentia era la fase declarada, y
      // una fase mal declarada convierte el rollback -- la unica red de
      // seguridad que tiene una escritura -- en una llamada que el propio
      // sistema rechaza.
      name: "La fase de una escritura de execute-php se DEDUCE del PHP, nunca se fija a mano",
      fn: () => {
        const wrappers = [
          path.join(PROJECT_ROOT, "scripts", "run-department-apply.ts"),
          path.join(PROJECT_ROOT, "scripts", "o47-execute-php-e2e.ts"),
        ];
        for (const file of wrappers) {
          const source = fs.readFileSync(file, "utf-8");
          const name = path.relative(PROJECT_ROOT, file);

          // Ninguna fase literal: ni "apply" ni "rollback" cableadas.
          const literalPhases = [...source.matchAll(/^\s*phase:\s*"([^"]+)"/gm)].map((m) => m[1]);
          assert.deepEqual(
            literalPhases,
            [],
            `${name} fija la fase a ${JSON.stringify(literalPhases)}. Una fase fija bloquea el rollback automatico en el guard y deja la pagina a medias.`
          );

          // Y la deduccion existe, comparando con el PHP del apply.
          assert.ok(
            /phase:\s*php === buildPhpForPlan\(/.test(source),
            `${name} debe deducir la fase comparando el PHP recibido con buildPhpForPlan(plan): lo que no es el PHP del apply es un rollback.`
          );
        }
      },
    },
    {
      name: "PRODUCCION solo es alcanzable desde el carril encolado, y la pasada diaria no puede llegar ahi",
      fn: () => {
        const executor = fs.readFileSync(path.join(PROJECT_ROOT, "src", "department", "apply", "production-executor.ts"), "utf-8");
        assert.ok(executor.includes("isProductionApplyAllowedFrom"), "el executor de produccion consulta la maquina de estados");
        assert.ok(executor.includes("matchesApprovedVersion"), "y recomprueba que staging sigue siendo la version aprobada (anti-TOCTOU)");
        assert.ok(executor.includes("checkProductionApplyGuards"), "y comprueba los interruptores de produccion");

        // Y la pasada diaria no puede publicar en produccion de ninguna
        // manera: ni tiene la fase, ni importa el executor de produccion,
        // ni conoce el adaptador de produccion.
        const daily = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "run-department-apply.ts"), "utf-8");
        for (const forbidden of ["applyApprovedChangeToProduction", "wordpress-production", "--phase production"]) {
          assert.ok(!daily.includes(forbidden), `scripts/run-department-apply.ts no puede mencionar "${forbidden}"`);
        }

        // Quien SI publica lo hace solo desde el carril encolado y tras
        // recomprobar que staging sigue siendo la version aprobada.
        const runner = fs.readFileSync(path.join(PROJECT_ROOT, "scripts", "run-production-apply.ts"), "utf-8");
        assert.ok(runner.includes("production_queued"), "el runner de produccion solo actua sobre aprobaciones ya encoladas");
        assert.ok(runner.includes("computeVersionHash"), "y recomprueba la version real de staging antes de escribir");
      },
    },
    {
      name: "Publicar en produccion ocurre en UN solo workflow, y ese workflow no se dispara solo",
      fn: () => {
        const productionWorkflow = path.join(PROJECT_ROOT, ".github", "workflows", "department-production-apply.yml");
        assert.ok(fs.existsSync(productionWorkflow), "falta el workflow de publicacion en produccion");
        const content = fs.readFileSync(productionWorkflow, "utf-8");
        const withoutComments = content
          .split("\n")
          .filter((line) => !line.trim().startsWith("#"))
          .join("\n");

        // Sin schedule: producir en produccion nunca puede ocurrir "porque
        // toca". Siempre lo dispara una decision humana ya registrada.
        assert.ok(!/^\s*schedule:/m.test(withoutComments), "el workflow de produccion NO puede tener schedule");
        assert.ok(/workflow_dispatch:|repository_dispatch:/.test(withoutComments), "debe dispararse por dispatch");
        assert.ok(/permissions:\s*\n\s*contents:\s*read/.test(withoutComments), "solo contents: read");
        assert.ok(!withoutComments.includes("contents: write"));
        assert.ok(!withoutComments.includes("id-token: write"));
        // Concurrency por aprobacion: dos dispatch del mismo approval no
        // pueden publicar a la vez.
        assert.ok(/concurrency:/.test(withoutComments), "debe declarar concurrency por aprobacion");
        assert.ok(!/cancel-in-progress:\s*true/.test(withoutComments), "nunca se cancela una publicacion a medias");
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
        // Fase O55: el workflow tiene ahora DOS jobs. El que ejecuta a
        // los seis empleados Claude sigue en `contents: read` y eso no se
        // negocia; el segundo (persist-state) necesita `contents: write`
        // para guardar el estado en su rama dedicada, no ejecuta Claude,
        // no llama a ninguna API externa y no corre codigo del
        // repositorio. Por eso el guard pasa de "el fichero no contiene
        // contents: write" a "el job de Claude no lo tiene": lo primero
        // dejaria de distinguir quien escribe.
        const claudeJobConfig = withoutComments.slice(0, withoutComments.indexOf("persist-state:"));
        assert.ok(
          !/^\s*contents:\s*write\s*$/m.test(claudeJobConfig),
          "el job que ejecuta a los empleados Claude NUNCA puede tener permiso de escritura"
        );
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
        // Estos nunca pueden aparecer, en ningun job.
        for (const forbidden of ["bypassPermissions", "--mcp", "mcp-config", "wp-json", "googleads"]) {
          assert.ok(!configLines.includes(forbidden), `el workflow contiene "${forbidden}" fuera de un comentario`);
        }
        // `git commit`/`git push` SI existen desde la Fase O55, pero
        // unicamente dentro del job persist-state y unicamente contra la
        // rama de estado. Lo que se sigue prohibiendo -- y es lo que de
        // verdad importaba -- es que el job donde corre Claude commitee
        // algo, y que cualquiera de los dos empuje a main.
        const claudeJobConfig = configLines.slice(0, configLines.indexOf("persist-state:"));
        for (const forbidden of ["git push", "git commit"]) {
          assert.ok(
            !claudeJobConfig.includes(forbidden),
            `el job que ejecuta a los empleados Claude contiene "${forbidden}": no puede escribir en el repositorio`
          );
        }
        assert.ok(
          !/git push[^\n]*(origin main|HEAD:main|:main\b)/.test(configLines),
          "ningun job de la pasada diaria puede empujar a main"
        );
        assert.ok(
          configLines.includes('git push --force-with-lease origin "HEAD:$STATE_BRANCH"'),
          "el unico push permitido es el de la rama de estado, y con --force-with-lease"
        );
      },
    },
    {
      name: "La pasada diaria solo analiza y propone: no aplica, no depende del serverless, y NUNCA toca produccion",
      fn: () => {
        const configLines = readWorkflowConfigLines();

        // La pasada diaria ANALIZA Y PROPONE, y nada mas: planifica el
        // contrato de apply y manda el email. Aplicar lo decide despues
        // una persona sobre el Daily Brief numerado.
        assert.ok(configLines.includes("--phase plan"), "la pasada diaria debe planificar el contrato de apply");

        // INVERSION DELIBERADA. Antes se exigia que la pasada diaria NO
        // ejecutara "--phase stage": el apply era manual y posterior. Esa
        // condicion era exactamente la causa de que el departamento
        // produjera ChangePlans ejecutables y terminara diciendo que
        // hacia falta implementarlos a mano, teniendo el executor
        // certificado al lado. Ahora se exige lo contrario: que SI se
        // ejecute, porque staging es el entorno de trabajo y el cambio es
        // reversible, esta validado por read-back y tiene rollback
        // automatico.
        assert.ok(configLines.includes("--phase stage"), "la pasada diaria debe aplicar en staging los ChangePlans ejecutables");

        // Lo que NO cambia: "--phase notify" pertenece al carril de
        // Telegram, que sigue apagado. Y la pasada no puede depender de
        // la infraestructura serverless, que no esta desplegada -- el
        // registro del cambio va a MongoDB, que si es el estado
        // autoritativo.
        assert.ok(!configLines.includes("--phase notify"), "la pasada diaria NO debe ejecutar la fase notify: el carril de Telegram sigue apagado");
        for (const forbidden of ["APPROVALS_API_URL", "APPROVALS_API_TOKEN", "TELEGRAM_BOT_TOKEN", "TELEGRAM_APPROVALS_ENABLED"]) {
          assert.ok(!configLines.includes(forbidden), `la pasada diaria no debe necesitar "${forbidden}"`);
        }
        // El email diario, en cambio, es obligatorio.
        assert.ok(configLines.includes("department:email"), "el Daily Brief por email es obligatorio en la pasada diaria");

        // Lo que NUNCA puede hacer. Publicar en produccion ocurre en UN
        // solo sitio (department-production-apply.yml) y siempre despues
        // de una aprobacion humana explicita.
        assert.ok(!/--phase\s+production/.test(configLines), "la pasada diaria NO puede lanzar la fase de produccion");
        for (const forbidden of [
          "DEPARTMENT_PRODUCTION_APPLY_ENABLED",
          "PRODUCTION_EXECUTION_ENABLED",
          "PRODUCTION_DRAFTS_ENABLED",
          "PRODUCTION_BACKEND",
          "WORDPRESS_PRODUCTION_APP_PASSWORD",
          "WORDPRESS_PRODUCTION_USERNAME",
          "WORDPRESS_PRODUCTION_BASE_URL",
        ]) {
          assert.ok(!configLines.includes(forbidden), `la pasada diaria no debe recibir "${forbidden}": no puede escribir en produccion`);
        }
        // Y no puede fijar el entorno de WordPress a produccion a mano.
        assert.ok(!/WORDPRESS_ENV:\s*["']?production/.test(configLines), "la pasada diaria nunca apunta su adaptador a produccion");
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
        // El invariante REAL no es un numero: es que NINGUNA invocacion
        // comparta ruta de registro con otra. El `execution_file` de
        // claude-code-action no es unico por invocacion, asi que dos
        // invocaciones con la misma ruta hacen que solo sobreviva el coste
        // de la ultima -- y con el bucle de correccion de QA hay varias
        // invocaciones DEL MISMO agente en la misma pasada, que es
        // justamente donde eso es mas facil de romper.
        const recordPaths = [...workflow.matchAll(/execution-record-path:\s*(.+)/g)].map((m) => m[1].trim());
        assert.ok(recordPaths.length >= 6, `se esperaban al menos 6 invocaciones con registro propio; encontradas ${recordPaths.length}`);
        assert.equal(new Set(recordPaths).size, recordPaths.length, "dos invocaciones comparten ruta de registro: el coste de una pisaria al de la otra");
        for (const agent of ["seo-specialist", "content-strategist", "analytics-specialist", "growth-director-v2", "qa-reviewer", "web-engineer"]) {
          assert.ok(
            recordPaths.some((p) => p.includes(`/stages/${agent}/`)),
            `falta el registro de coste propio de ${agent}`
          );
        }
      },
    },
    {
      name: "Cada etapa Claude del workflow usa el runtime comun SIN modificarlo, y CADA step caller declara su propio timeout-minutes acotado",
      fn: () => {
        const workflow = fs.readFileSync(WORKFLOW_PATH, "utf-8");
        const runtimeUses = workflow.match(/uses:\s*\.\/\.github\/actions\/claude-employee-runtime/g) ?? [];
        // Antes se exigia un numero exacto (6). Ese numero dejo de ser un
        // invariante al anadir el bucle QA -> correccion -> re-QA: la
        // misma pasada puede invocar a qa-reviewer y a web-engineer
        // varias veces, en rondas distintas. Lo que SI sigue siendo
        // invariante -- y es lo que de verdad protege este test -- es que
        // ninguna etapa Claude se invoque por fuera del runtime comun.
        assert.ok(runtimeUses.length >= 6, `cada etapa Claude debe invocar el runtime comun; encontradas ${runtimeUses.length}`);
        const agentNames = [...workflow.matchAll(/agent-name:\s*(\S+)/g)].map((m) => m[1].trim());
        assert.equal(
          agentNames.length,
          runtimeUses.length,
          "hay un `agent-name` que no corresponde a una invocacion del runtime comun (o al reves): ninguna etapa Claude puede invocarse por fuera"
        );

        // El invariante REAL que protege este test no es el numero 10: es
        // que ninguna invocacion de Claude pueda correr sin backstop de
        // tiempo, y que ese backstop siga siendo pequeno comparado con el
        // del job (120 min). seo-specialist lleva 20 en vez de 10 desde
        // que tiene StructuredOutput concedido: con --json-schema ya
        // operativo el SDK re-pregunta al modelo cuando la salida no
        // cumple el schema (2-3 turnos en vez de 1), y ademas ese
        // presupuesto tiene que cubrir el reintento clasificado del
        // runtime comun. Fijar "10" literal habria obligado a elegir entre
        // el test y el fix.
        const timeouts = (workflow.match(/timeout-minutes:\s*(\d+)/g) ?? []).map((line) => Number(line.split(":")[1].trim()));
        const stepTimeouts = timeouts.filter((minutes) => minutes <= 30);
        assert.ok(
          stepTimeouts.length >= runtimeUses.length,
          `cada step del runtime comun debe llevar su propio timeout-minutes acotado (<=30); ${runtimeUses.length} invocaciones y ${stepTimeouts.length} timeouts acotados: ${JSON.stringify(timeouts)}`
        );
        for (const minutes of stepTimeouts) {
          assert.ok(minutes >= 5, `un timeout-minutes de ${minutes} es demasiado corto para una invocacion real de Claude`);
        }
        assert.ok(workflow.includes("agent-name: sem-specialist") === false, "sem-specialist NO se ejecuta en esta fase");
      },
    },
  ];
}
