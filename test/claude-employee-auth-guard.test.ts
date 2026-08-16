import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * GUARD DE FACTURACION: el runtime comun de empleados Claude es
 * SOLO-SUSCRIPCION.
 *
 * Regla que se protege aqui: la unica credencial que puede llegar a
 * `anthropics/claude-code-action` desde este repositorio es
 * `CLAUDE_CODE_OAUTH_TOKEN` (el token de larga duracion que emite
 * `claude setup-token` contra una suscripcion Claude). Ninguna API key,
 * por ningun camino.
 *
 * Por que es un test y no solo una convencion: los dos metodos de
 * autenticacion NO cuestan lo mismo. Con el token OAuth, la pasada
 * consume la cuota de la suscripcion ya pagada; con una API key, la
 * misma pasada es consumo de API facturable. El fallback automatico que
 * existia antes (OAuth -> API key) convertia un fallo de credencial
 * (token caducado, secret borrado) en un cambio silencioso de modelo de
 * facturacion, con los seis empleados de la pasada diaria siguiendo en
 * verde. Este guard existe para que ese fallback no pueda volver a
 * aparecer por descuido -- ni en la composite action, ni en un workflow
 * de empleado nuevo copiado de otro.
 *
 * Lo que este guard NO dice: nada sobre si el secret ANTHROPIC_API_KEY
 * existe o no en el repositorio. Puede existir y servir para otras
 * cosas; lo que se verifica es que NINGUN workflow se lo pasa a este
 * runtime.
 */

const PROJECT_ROOT = path.join(__dirname, "..");
const WORKFLOWS_DIR = path.join(PROJECT_ROOT, ".github", "workflows");
const RUNTIME_ACTION_PATH = path.join(PROJECT_ROOT, ".github", "actions", "claude-employee-runtime", "action.yml");

/** Ruta del runtime tal y como la escribe un caller en su `uses:`. */
const RUNTIME_USES = "./.github/actions/claude-employee-runtime";

function readWithoutComments(filePath: string): string {
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function listWorkflowFiles(): string[] {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => path.join(WORKFLOWS_DIR, name));
}

/** Workflows que invocan el runtime comun (los unicos que autentican Claude). */
function listEmployeeWorkflowFiles(): string[] {
  return listWorkflowFiles().filter((file) => readWithoutComments(file).includes(RUNTIME_USES));
}

export function runClaudeEmployeeAuthGuardTests(): TestCase[] {
  return [
    {
      name: "El runtime comun NO declara ningun input de API key (no hay puerta por la que entre)",
      fn: () => {
        assert.ok(fs.existsSync(RUNTIME_ACTION_PATH), "falta .github/actions/claude-employee-runtime/action.yml");
        const config = readWithoutComments(RUNTIME_ACTION_PATH);

        assert.ok(!/^\s*anthropic-api-key:/m.test(config), 'el runtime no puede declarar un input "anthropic-api-key": es la puerta de entrada del fallback a facturacion API');
        assert.ok(/^\s*claude-code-oauth-token:/m.test(config), "el runtime debe seguir declarando el input claude-code-oauth-token");
      },
    },
    {
      name: "El runtime pasa anthropic_api_key EXPLICITAMENTE vacio a claude-code-action (evidencia auditable en cada run)",
      fn: () => {
        const config = readWithoutComments(RUNTIME_ACTION_PATH);

        // Explicito y vacio, nunca interpolado desde un input/secret.
        assert.ok(/^\s*anthropic_api_key:\s*""\s*$/m.test(config), 'el step de invocacion debe pasar anthropic_api_key: "" -- literal y vacio');
        assert.ok(!/anthropic_api_key:\s*\$\{\{/.test(config), "anthropic_api_key nunca puede interpolar una expresion: seria una API key viajando al modelo");
        assert.ok(/^\s*claude_code_oauth_token:\s*\$\{\{\s*inputs\.claude-code-oauth-token\s*\}\}\s*$/m.test(config), "el OAuth debe pasarse tal cual desde el input");
      },
    },
    {
      name: "La resolucion de autenticacion solo contempla oauth o none -- no existe la rama api_key",
      fn: () => {
        const config = readWithoutComments(RUNTIME_ACTION_PATH);

        const methods = [...config.matchAll(/method=([a-z_]+)/g)].map((m) => m[1]);
        assert.ok(methods.length > 0, "el step de autenticacion debe seguir publicando un output `method`");
        for (const method of methods) {
          assert.ok(method === "oauth" || method === "none", `metodo de autenticacion inesperado: "${method}" (solo se admiten oauth y none)`);
        }
        assert.ok(!config.includes("HAS_API_KEY"), "no puede quedar ninguna deteccion de API key en el runtime");
      },
    },
    {
      name: "Falta de OAuth = BLOCKED_BY_AUTH: el runtime aborta, nunca continua sin credencial de suscripcion",
      fn: () => {
        const config = readWithoutComments(RUNTIME_ACTION_PATH);

        assert.ok(config.includes("BLOCKED_BY_AUTH"), "debe seguir existiendo el corte explicito BLOCKED_BY_AUTH");
        assert.ok(/if:\s*steps\.claude-auth\.outputs\.method\s*==\s*'none'/.test(config), "el step de aborto debe dispararse exactamente cuando el metodo es 'none'");
        assert.ok(/exit 1/.test(config), "BLOCKED_BY_AUTH debe terminar el job en rojo");

        // Y todo lo que gasta inferencia debe estar detras de "hay auth".
        for (const gated of ["Ejecutar empleado Claude", "Resolver salida canonica", "Capturar y clasificar intento 1"]) {
          const stepIndex = config.indexOf(gated);
          assert.ok(stepIndex > 0, `falta el step "${gated}" en el runtime`);
        }
        const gatedIfs = [...config.matchAll(/if:\s*steps\.claude-auth\.outputs\.method\s*!=\s*'none'/g)];
        assert.ok(gatedIfs.length >= 4, `los steps que gastan inferencia deben ir condicionados a que haya autenticacion (encontrados ${gatedIfs.length})`);
      },
    },
    {
      name: "NINGUN workflow de empleado pasa una API key al runtime (ni siquiera uno nuevo copiado de otro)",
      fn: () => {
        const employeeWorkflows = listEmployeeWorkflowFiles();
        assert.ok(employeeWorkflows.length > 0, "no se ha encontrado ningun workflow que use el runtime comun");

        for (const file of employeeWorkflows) {
          const config = readWithoutComments(file);
          const relative = path.relative(PROJECT_ROOT, file);

          assert.ok(!config.includes("anthropic-api-key"), `${relative} pasa "anthropic-api-key" al runtime: el runtime es solo-suscripcion`);
          assert.ok(!config.includes("ANTHROPIC_API_KEY"), `${relative} referencia el secret ANTHROPIC_API_KEY en configuracion: este runtime no debe recibirlo por ninguna via (env, with, o input)`);
          assert.ok(config.includes("claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}"), `${relative} debe pasar el token de suscripcion al runtime`);
        }
      },
    },
    {
      name: "Ningun workflow invoca claude-code-action por su cuenta esquivando el runtime comun",
      fn: () => {
        for (const file of listWorkflowFiles()) {
          const config = readWithoutComments(file);
          const relative = path.relative(PROJECT_ROOT, file);
          assert.ok(
            !config.includes("anthropics/claude-code-action"),
            `${relative} invoca anthropics/claude-code-action directamente: toda invocacion de Claude debe pasar por ${RUNTIME_USES}, que es donde vive el guard de autenticacion`
          );
        }
      },
    },
    {
      name: "Las metricas de coste siguen intactas: el runtime sigue registrando total_cost_usd por empleado",
      fn: () => {
        const config = readWithoutComments(RUNTIME_ACTION_PATH);

        // El cambio de autenticacion no puede llevarse por delante la
        // observabilidad del consumo equivalente (que sigue siendo una
        // ESTIMACION del SDK, no una factura -- ver docs).
        assert.ok(/^\s*execution-record-path:/m.test(config), "el input execution-record-path no puede desaparecer");
        assert.ok(config.includes("claude-employee:record-execution-for-ci"), "el step de metricas debe seguir invocandose");
        assert.ok(/if:\s*always\(\)\s*&&\s*inputs\.execution-record-path\s*!=\s*''/.test(config), "las metricas deben seguir registrandose incluso cuando la invocacion falla");

        const employeeWorkflows = listEmployeeWorkflowFiles();
        const withRecord = employeeWorkflows.filter((file) => readWithoutComments(file).includes("execution-record-path:"));
        assert.ok(withRecord.length > 0, "algun workflow debe seguir pidiendo el registro de metricas por invocacion");
      },
    },
  ];
}
