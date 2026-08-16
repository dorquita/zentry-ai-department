import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendExecutePhpAudit,
  ExecutePhpAuditRecord,
  findSecretLeak,
  readExecutePhpAudit,
} from "../src/core/execute-php-audit";
import { buildPhpForPlan, buildRollbackPhpForPlan, PHP_RESULT_MARKER } from "../src/core/execute-php-builder";
import {
  assertExecutePhpAllowed,
  EXECUTE_PHP_ACTOR,
  ExecutePhpRequest,
  isExecutePhpAllowed,
  MCP_EXECUTE_ABILITY_TOOL,
  resolveAbilityNameFromToolCall,
  scanPhpForForbiddenOperations,
} from "../src/core/execute-php-guard";
import {
  CapabilitySelection,
  EXECUTE_PHP_CONTRACT_VERSION,
  ExecutePhpChangePlan,
  ExecutePhpOperation,
  selectExecutionPath,
} from "../src/core/execute-php-operations";
import { isNovamiraAbilityAllowed } from "../src/core/novamira-guard";
import { isAbilityAllowedForProfile, READ_ONLY_EMPLOYEES } from "../src/core/novamira-profiles";
import {
  applyChangePlanWithPhp,
  ExecutePhpContext,
  ExecutePhpDeps,
  ExecutePhpOutcome,
  PhpTargetState,
} from "../src/department/apply/execute-php-executor";
import { computeVersionHash } from "../src/department/apply/version";

export interface TestCase {
  name: string;
  /**
   * El runner (`scripts/run-tests.ts`) hace `await testCase.fn()`, asi que
   * un test asincrono que falle tumba la suite de verdad. El executor del
   * fallback es `async`, y sin esto sus fallos pasarian en silencio.
   */
  fn: () => void | Promise<void>;
}

// --- Fixtures ------------------------------------------------------------

const TARGET_ID = 2091;
const NEW_CONTENT = "<p>Taquillas de melamina para vestuarios, con cerradura Tukandado.</p>";
const RUN_ID = "dept-2026-08-16";

/** Estado real de la pagina en staging ANTES del cambio. */
function baseState(overrides: Partial<PhpTargetState> = {}): PhpTargetState {
  return {
    id: TARGET_ID,
    status: "publish",
    title: "Taquillas de melamina",
    contentHtml: "<p>Contenido antiguo de la familia melamina.</p>",
    excerpt: "Taquillas de melamina para vestuarios.",
    link: "https://staging.zentrylockers.com/taquillas-melamina/",
    slug: "taquillas-melamina",
    meta: { _yoast_wpseo_title: "Taquillas de melamina | Zentry" },
    ...overrides,
  };
}

/** Mismo calculo que usa el executor para decidir si el plan esta STALE. */
function versionHashOfState(state: PhpTargetState): string {
  return computeVersionHash({
    status: state.status,
    title: state.title,
    metaDescription: state.excerpt,
    contentHtml: state.contentHtml,
  });
}

/**
 * Camino de capacidad legitimo: existe `gutenberg-write-content` para
 * `update_post_content`, asi que hay que declarar por que no sirve. Se
 * construye con `selectExecutionPath` a proposito -- si esa politica
 * cambiara, estos tests se enteran.
 */
function fallbackSelection(): CapabilitySelection {
  return selectExecutionPath({
    operation: "update_post_content",
    nativeAbilityUnsuitableReason:
      "El cuerpo trae shortcodes del theme que gutenberg-write-content reescribe a bloques y rompe el render.",
  });
}

function validPlan(overrides: Partial<ExecutePhpChangePlan> = {}): ExecutePhpChangePlan {
  return {
    contractVersion: EXECUTE_PHP_CONTRACT_VERSION,
    operation: "update_post_content",
    targetId: TARGET_ID,
    expectedBeforeHash: versionHashOfState(baseState()),
    payload: { value: NEW_CONTENT },
    scopeFields: ["post_content"],
    ...overrides,
  };
}

/**
 * Peticion COMPLETA y correcta. Cada test cambia UNA cosa: si algo se
 * bloquea, es por esa cosa y no por un fixture a medias.
 */
function validRequest(overrides: Partial<ExecutePhpRequest> = {}): ExecutePhpRequest {
  const plan = overrides.plan ?? validPlan();
  let php: string;
  try {
    php = buildPhpForPlan(plan);
  } catch {
    // Planes deliberadamente invalidos: se adjunta PHP legitimo para que
    // el bloqueo venga del plan, nunca de un PHP vacio.
    php = buildPhpForPlan(validPlan());
  }
  return {
    actor: EXECUTE_PHP_ACTOR,
    abilityName: "novamira/execute-php",
    environment: "staging",
    phase: "apply",
    qaStatus: "PASS",
    departmentRunId: RUN_ID,
    recommendationId: `${RUN_ID}#rec-1`,
    changeId: `${RUN_ID}#change-1`,
    plan,
    php,
    capabilitySelection: fallbackSelection(),
    flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "staging" },
    ...overrides,
  };
}

function validContext(overrides: Partial<ExecutePhpContext> = {}): ExecutePhpContext {
  return {
    departmentRunId: RUN_ID,
    recommendationId: `${RUN_ID}#rec-1`,
    changeId: `${RUN_ID}#change-1`,
    qaStatus: "PASS",
    capabilitySelection: fallbackSelection(),
    flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "staging" },
    ...overrides,
  };
}

interface FakeWorld {
  deps: ExecutePhpDeps;
  /** PHP recibido por `runPhp`, en orden. Su longitud es "cuantas escrituras se intentaron". */
  phpCalls: string[];
  counters: { reads: number };
}

/**
 * Doble de WordPress. `states` se consume en orden (snapshot, relectura de
 * validacion, relectura del rollback); el ultimo se repite si hiciera
 * falta otra lectura.
 */
function fakeWorld(states: PhpTargetState[], options: { throwOnPhpCall?: number; getStateError?: string } = {}): FakeWorld {
  const phpCalls: string[] = [];
  const counters = { reads: 0 };
  const deps: ExecutePhpDeps = {
    getState: async () => {
      if (options.getStateError) throw new Error(options.getStateError);
      const state = states[Math.min(counters.reads, states.length - 1)];
      counters.reads += 1;
      return state;
    },
    runPhp: async (php: string) => {
      phpCalls.push(php);
      if (options.throwOnPhpCall === phpCalls.length) throw new Error("execute-php devolvio 500 desde el sandbox");
      return `${PHP_RESULT_MARKER}${JSON.stringify({ ok: true, postId: TARGET_ID })}${PHP_RESULT_MARKER}`;
    },
    now: () => new Date("2026-08-16T09:00:00.000Z"),
  };
  return { deps, phpCalls, counters };
}

const HEX_64 = /^[0-9a-f]{64}$/;

/** Campos que TODO registro de auditoria debe traer, pase lo que pase. */
function assertAuditShape(record: ExecutePhpAuditRecord, label: string): void {
  assert.equal(record.departmentRunId, RUN_ID, `${label}: departmentRunId`);
  assert.equal(record.recommendationId, `${RUN_ID}#rec-1`, `${label}: recommendationId`);
  assert.equal(record.changeId, `${RUN_ID}#change-1`, `${label}: changeId`);
  assert.equal(record.actor, EXECUTE_PHP_ACTOR, `${label}: actor`);
  assert.equal(record.ability, "novamira/execute-php", `${label}: ability`);
  assert.equal(record.executionPath, "execute_php_fallback", `${label}: executionPath`);
  assert.equal(record.operation, "update_post_content", `${label}: operation`);
  assert.equal(record.target, `post:${TARGET_ID}`, `${label}: target`);
  assert.match(record.phpSha256, HEX_64, `${label}: phpSha256 debe ser sha256 hexadecimal de 64 caracteres`);
  assert.ok(typeof record.outcome === "string" && record.outcome.length > 0, `${label}: outcome`);
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key] as string;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key] as string;
    }
  }
}

export function runExecutePhpGuardTests(): TestCase[] {
  return [
    // --- 1. Actor -------------------------------------------------------
    {
      name: "Ningun especialista puede ejecutar PHP: todo el censo de empleados de solo lectura falla en el check de actor",
      fn: () => {
        for (const employee of READ_ONLY_EMPLOYEES) {
          const decision = isExecutePhpAllowed(validRequest({ actor: employee }));
          assert.equal(decision.allowed, false, `${employee} no puede ejecutar PHP`);
          assert.equal(decision.failedCheck, "actor", `${employee} debe fallar en el check de actor`);
          assert.match(decision.reason, /READ \/ ANALYZE \/ PROPOSE/, `${employee}: el motivo debe nombrar su rol de solo lectura`);
          assert.ok(decision.reason.includes(employee), `${employee}: el motivo debe nombrar al empleado`);
        }
        // Y el mismo web-engineer como EMPLEADO tampoco: quien escribe es
        // la capa de apply, que no es un empleado Claude.
        assert.ok((READ_ONLY_EMPLOYEES as readonly string[]).includes("web-engineer"));
        const anonymous = isExecutePhpAllowed(validRequest({ actor: "algun-agente-nuevo" }));
        assert.equal(anonymous.failedCheck, "actor");
        assert.match(anonymous.reason, /no autorizado/i);
      },
    },

    // --- 2. Camino feliz ------------------------------------------------
    {
      name: "Web Engineer apply + staging + plan valido + PHP determinista + flags + QA PASS: permitido",
      fn: () => {
        const decision = isExecutePhpAllowed(validRequest());
        assert.equal(decision.allowed, true, decision.reason);
        assert.equal(decision.failedCheck, null);
        assert.match(decision.reason, /STAGING/);
        assert.match(decision.reason, /update_post_content/);
        assert.doesNotThrow(() => assertExecutePhpAllowed(validRequest()));
        // PASS_WITH_WARNINGS tambien ejecuta; BLOCKED nunca.
        assert.equal(isExecutePhpAllowed(validRequest({ qaStatus: "PASS_WITH_WARNINGS" })).allowed, true);
        const blocked = isExecutePhpAllowed(validRequest({ qaStatus: "BLOCKED" }));
        assert.equal(blocked.failedCheck, "qa");
      },
    },

    // --- 3. Produccion --------------------------------------------------
    {
      name: "Produccion bloqueada de forma incondicional, aunque TODO lo demas sea perfecto",
      fn: () => {
        const byEnvironment = isExecutePhpAllowed(
          validRequest({
            environment: "production",
            flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "production" },
          })
        );
        assert.equal(byEnvironment.allowed, false);
        assert.equal(byEnvironment.failedCheck, "production");
        assert.match(byEnvironment.reason, /BLOQUEADO: produccion/);

        // Solo el flag en produccion, con el entorno declarado staging:
        // sigue siendo produccion y sigue bloqueado.
        const byFlag = isExecutePhpAllowed(
          validRequest({
            environment: "staging",
            flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "production" },
          })
        );
        assert.equal(byFlag.failedCheck, "production");

        // Y cualquier otro entorno que no sea exactamente staging.
        assert.equal(isExecutePhpAllowed(validRequest({ environment: "local" })).failedCheck, "environment");
      },
    },

    // --- 4. Operacion desconocida ---------------------------------------
    {
      name: "Una operacion que no esta en el catalogo se rechaza en la validacion del plan",
      fn: () => {
        const decision = isExecutePhpAllowed(
          validRequest({ plan: validPlan({ operation: "delete_all_posts" as unknown as ExecutePhpOperation }) })
        );
        assert.equal(decision.allowed, false);
        assert.equal(decision.failedCheck, "plan");
        assert.match(decision.reason, /Operacion "delete_all_posts" desconocida/);

        // Y una version de contrato distinta tampoco pasa (fail-closed).
        const otherContract = isExecutePhpAllowed(validRequest({ plan: validPlan({ contractVersion: "execute-php-plan/v2" }) }));
        assert.equal(otherContract.failedCheck, "plan");
        assert.match(otherContract.reason, /contractVersion/);
      },
    },

    // --- 5. Operacion del catalogo pero NO habilitada --------------------
    {
      name: "Las operaciones sin rollback seguro (create_page, update_redirect, update_term_assignment) estan en el catalogo pero NO se ejecutan",
      fn: () => {
        for (const operation of ["create_page", "update_redirect", "update_term_assignment"] as ExecutePhpOperation[]) {
          const decision = isExecutePhpAllowed(validRequest({ plan: validPlan({ operation }) }));
          assert.equal(decision.allowed, false, operation);
          assert.equal(decision.failedCheck, "plan", operation);
          assert.match(decision.reason, new RegExp(`La operacion "${operation}" NO esta habilitada`), operation);
          assert.match(decision.reason, /APARTE en esta fase/, `${operation}: debe explicar que falta para habilitarla`);
        }
      },
    },

    // --- 6. Objetivo ausente o invalido ----------------------------------
    {
      name: "Sin objetivo explicito no se escribe: targetId 0, negativo, no entero o ausente se rechazan",
      fn: () => {
        for (const targetId of [0, -1, 3.5]) {
          const decision = isExecutePhpAllowed(validRequest({ plan: validPlan({ targetId }) }));
          assert.equal(decision.allowed, false, `targetId=${targetId}`);
          assert.equal(decision.failedCheck, "plan", `targetId=${targetId}`);
          assert.match(decision.reason, /targetId debe ser un entero positivo/, `targetId=${targetId}`);
        }

        const { targetId: _omitted, ...withoutTarget } = validPlan();
        const absent = isExecutePhpAllowed(validRequest({ plan: withoutTarget as unknown as ExecutePhpChangePlan }));
        assert.equal(absent.failedCheck, "plan");
        assert.match(absent.reason, /targetId debe ser un entero positivo/);
        assert.match(absent.reason, /Sin objetivo explicito no se escribe nada/);
      },
    },

    // --- 7. Estado STALE --------------------------------------------------
    {
      name: "Estado STALE: si la pagina cambio desde la propuesta no se ejecuta NADA (runPhp nunca se llama)",
      fn: async () => {
        // La pagina real tiene otro titulo -> otro hash de version.
        const world = fakeWorld([baseState({ title: "Titulo editado a mano en wp-admin" })]);
        const outcome = await applyChangePlanWithPhp(validPlan(), validContext(), world.deps);

        assert.equal(outcome.status, "stale");
        assert.equal(world.phpCalls.length, 0, "no se puede haber ejecutado ni un solo PHP");
        assert.equal(outcome.stagingWritePerformed, false);
        assert.equal(outcome.productionWritePerformed, false);
        assert.equal(outcome.validation, "not_run");
        assert.match(outcome.detail, /STALE/);
        assert.match(outcome.detail, /no se ejecuta nada/);
        assert.equal(outcome.audit.length, 1);
        assert.equal(outcome.audit[0].outcome, "blocked_by_guard");
      },
    },

    // --- 8..12. Escaneo de operaciones prohibidas -------------------------
    {
      name: "PHP de usuarios/admin (wp_insert_user, add_role, wp_set_password) se marca en la categoria usuarios/admin",
      fn: () => {
        const snippets = [
          "<?php wp_insert_user(array('user_login' => 'nuevo_admin'));",
          "<?php add_role('editor_plus', 'Editor Plus', array());",
          "<?php wp_set_password('nueva-clave', 1);",
          "<?php grant_super_admin(1);",
        ];
        for (const php of snippets) {
          const scan = scanPhpForForbiddenOperations(php);
          assert.equal(scan.clean, false, php);
          assert.equal(scan.category, "usuarios/admin", php);
          assert.match(scan.detail, /construccion prohibida/, php);
          // Y ademas el guard lo rechaza: no coincide con ninguna plantilla.
          const decision = isExecutePhpAllowed(validRequest({ php }));
          assert.equal(decision.allowed, false, php);
          assert.equal(decision.failedCheck, "php_not_deterministic", php);
        }
      },
    },
    {
      name: "PHP de filesystem (file_put_contents, unlink, fopen) se marca en la categoria filesystem y no pasa el guard",
      fn: () => {
        const snippets = [
          "<?php file_put_contents('/var/www/html/backdoor.txt', 'hola');",
          "<?php unlink('/var/www/html/index.txt');",
          "<?php $h = fopen('/var/log/zentry.log', 'w');",
        ];
        for (const php of snippets) {
          const scan = scanPhpForForbiddenOperations(php);
          assert.equal(scan.clean, false, php);
          assert.equal(scan.category, "filesystem", php);
          assert.equal(isExecutePhpAllowed(validRequest({ php })).failedCheck, "php_not_deterministic", php);
        }
      },
    },
    {
      name: "PHP de shell/system (exec, shell_exec, system, passthru, proc_open y el operador backtick) se marca en shell/system",
      fn: () => {
        const snippets = [
          "<?php exec('ls -la');",
          "<?php shell_exec('cat /var/www/html/robots.txt');",
          "<?php system('id');",
          "<?php passthru('uname -a');",
          "<?php proc_open('sh', array(), $pipes);",
          "<?php $salida = `ls -la /var/www`;",
        ];
        for (const php of snippets) {
          const scan = scanPhpForForbiddenOperations(php);
          assert.equal(scan.clean, false, php);
          assert.equal(scan.category, "shell/system", php);
          assert.equal(isExecutePhpAllowed(validRequest({ php })).failedCheck, "php_not_deterministic", php);
        }
      },
    },
    {
      name: "PHP de secretos/configuracion (wp-config, DB_PASSWORD, getenv, $_ENV, .env, update_option) se marca en secrets/config",
      fn: () => {
        const snippets = [
          "<?php $ruta = '/var/www/html/wp-config.php';",
          "<?php $clave = DB_PASSWORD;",
          "<?php $token = getenv('TELEGRAM_BOT_TOKEN');",
          "<?php $clave = $_ENV['ANTHROPIC_API_KEY'];",
          "<?php $ruta = '/var/www/html/.env';",
          "<?php update_option('siteurl', 'https://otro-sitio.test');",
        ];
        for (const php of snippets) {
          const scan = scanPhpForForbiddenOperations(php);
          assert.equal(scan.clean, false, php);
          assert.equal(scan.category, "secrets/config", php);
          assert.equal(isExecutePhpAllowed(validRequest({ php })).failedCheck, "php_not_deterministic", php);
        }
      },
    },
    {
      name: "PHP con red arbitraria (wp_remote_get, curl_init, fsockopen) se marca en networking",
      fn: () => {
        const snippets = [
          "<?php $r = wp_remote_get('https://exfiltracion.test/x');",
          "<?php $ch = curl_init('https://exfiltracion.test/x');",
          "<?php $s = fsockopen('exfiltracion.test', 80);",
        ];
        for (const php of snippets) {
          const scan = scanPhpForForbiddenOperations(php);
          assert.equal(scan.clean, false, php);
          assert.equal(scan.category, "networking", php);
          assert.equal(isExecutePhpAllowed(validRequest({ php })).failedCheck, "php_not_deterministic", php);
        }
        // El PHP que SI generan las plantillas pasa el escaneo limpio.
        assert.equal(scanPhpForForbiddenOperations(buildPhpForPlan(validPlan())).clean, true);
      },
    },

    // --- 13. Camino completo aplicado -------------------------------------
    {
      name: "Cambio de contenido valido: se aplica en staging, se valida releyendo y produccion no se toca",
      fn: async () => {
        const after = baseState({ contentHtml: NEW_CONTENT });
        const world = fakeWorld([baseState(), after]);
        const outcome = await applyChangePlanWithPhp(validPlan(), validContext(), world.deps);

        assert.equal(outcome.status, "applied", outcome.detail);
        assert.equal(outcome.stagingWritePerformed, true);
        assert.equal(outcome.productionWritePerformed, false);
        assert.equal(outcome.validation, "passed");
        assert.equal(outcome.rollback, "not_needed");
        assert.equal(outcome.afterValue, NEW_CONTENT, "el valor releido debe ser exactamente el pedido");
        assert.equal(outcome.beforeValue, baseState().contentHtml);
        assert.equal(outcome.beforeHash, versionHashOfState(baseState()));
        assert.equal(outcome.afterHash, versionHashOfState(after));
        assert.equal(world.phpCalls.length, 1, "una sola escritura");
        assert.equal(world.phpCalls[0], buildPhpForPlan(validPlan()), "se ejecuta el PHP de la plantilla, sin retoques");
        assert.equal(world.counters.reads, 2, "snapshot + relectura de validacion");
      },
    },

    // --- 14. Validacion fallida -------------------------------------------
    {
      name: "Si la relectura no devuelve lo pedido, la validacion falla y el cambio se revierte",
      fn: async () => {
        const wrong = baseState({ contentHtml: "<p>Esto no es lo que se pidio.</p>" });
        const world = fakeWorld([baseState(), wrong, baseState()]);
        const outcome = await applyChangePlanWithPhp(validPlan(), validContext(), world.deps);

        assert.equal(outcome.status, "rolled_back", outcome.detail);
        assert.equal(outcome.validation, "failed");
        assert.equal(outcome.rollback, "rolled_back");
        assert.equal(outcome.stagingWritePerformed, true);
        assert.equal(outcome.productionWritePerformed, false);
        assert.equal(world.phpCalls.length, 2, "escritura + rollback");
        assert.match(outcome.detail, /Rollback VERIFICADO/);
        assert.match(outcome.detail, /el valor releido del scope no coincide con lo pedido/);
        // "execute-php respondio ok" no cuenta como exito: el doble
        // devuelve ok:true y aun asi la validacion manda.
        assert.match(outcome.detail, /no se confia en su respuesta/);
      },
    },

    // --- 15. Rollback determinista y verificado ---------------------------
    {
      name: "El rollback usa la plantilla determinista del snapshot y se verifica releyendo hasta coincidir con el estado previo",
      fn: async () => {
        const before = baseState();
        const wrong = baseState({ contentHtml: "<p>Contenido corrupto.</p>" });
        const world = fakeWorld([before, wrong, before]);
        const outcome = await applyChangePlanWithPhp(validPlan(), validContext(), world.deps);

        const expectedRollbackPhp = buildRollbackPhpForPlan(validPlan(), before.contentHtml, true);
        assert.equal(world.phpCalls[1], expectedRollbackPhp, "el rollback debe ser EXACTAMENTE la plantilla de rollback");
        assert.notEqual(world.phpCalls[1], world.phpCalls[0], "el rollback reescribe el valor del snapshot, no el nuevo");
        assert.equal(scanPhpForForbiddenOperations(expectedRollbackPhp).clean, true);

        assert.equal(outcome.status, "rolled_back");
        assert.equal(outcome.afterValue, before.contentHtml, "tras el rollback se relee exactamente el snapshot");
        assert.equal(outcome.afterHash, versionHashOfState(before), "la version releida vuelve a ser la de partida");
        assert.equal(outcome.afterHash, outcome.beforeHash);
        assert.equal(world.counters.reads, 3, "snapshot + validacion + verificacion del rollback");
      },
    },

    // --- 16. Rollback fallido ---------------------------------------------
    {
      name: "Si el propio rollback falla el estado es rollback_failed y se pide intervencion humana",
      fn: async () => {
        const wrong = baseState({ contentHtml: "<p>Contenido corrupto.</p>" });
        const world = fakeWorld([baseState(), wrong, baseState()], { throwOnPhpCall: 2 });
        const outcome = await applyChangePlanWithPhp(validPlan(), validContext(), world.deps);

        assert.equal(outcome.status, "rollback_failed", outcome.detail);
        assert.equal(outcome.rollback, "rollback_failed");
        assert.equal(outcome.stagingWritePerformed, true);
        assert.equal(outcome.productionWritePerformed, false);
        assert.match(outcome.detail, /CRITICO/);
        assert.match(outcome.detail, /intervencion humana/);
        assert.match(outcome.detail, /no volvera a tocarlo/);
        assert.equal(outcome.audit[outcome.audit.length - 1].outcome, "rollback_failed");
      },
    },

    // --- 17. Auditoria ------------------------------------------------------
    {
      name: "Todo camino del executor deja auditoria trazable con sha256 del PHP, y NUNCA el PHP completo",
      fn: async () => {
        const before = baseState();
        const applied = await applyChangePlanWithPhp(validPlan(), validContext(), fakeWorld([before, baseState({ contentHtml: NEW_CONTENT })]).deps);
        const stale = await applyChangePlanWithPhp(validPlan(), validContext(), fakeWorld([baseState({ title: "Otro titulo" })]).deps);
        const blocked = await applyChangePlanWithPhp(validPlan(), validContext({ qaStatus: "BLOCKED" }), fakeWorld([before]).deps);
        const wrong = baseState({ contentHtml: "<p>Corrupto.</p>" });
        const rolledBack = await applyChangePlanWithPhp(validPlan(), validContext(), fakeWorld([before, wrong, before]).deps);
        const rollbackFailed = await applyChangePlanWithPhp(
          validPlan(),
          validContext(),
          fakeWorld([before, wrong, before], { throwOnPhpCall: 2 }).deps
        );

        const paths: Array<{ label: string; outcome: ExecutePhpOutcome }> = [
          { label: "applied", outcome: applied },
          { label: "stale", outcome: stale },
          { label: "blocked_by_guard", outcome: blocked },
          { label: "rolled_back", outcome: rolledBack },
          { label: "rollback_failed", outcome: rollbackFailed },
        ];

        const php = buildPhpForPlan(validPlan());
        for (const { label, outcome } of paths) {
          assert.ok(outcome.audit.length >= 1, `${label}: todo camino deja al menos un registro`);
          for (const record of outcome.audit) {
            assertAuditShape(record, label);
            const serialized = JSON.stringify(record);
            assert.ok(!serialized.includes("<?php"), `${label}: el audit no puede llevar el PHP completo`);
            assert.ok(!serialized.includes("wp_update_post"), `${label}: el audit no puede llevar el cuerpo de la plantilla`);
            assert.ok(!serialized.includes(php), `${label}: el audit no puede llevar el PHP completo`);
            assert.ok(!serialized.includes(NEW_CONTENT), `${label}: el audit no puede llevar el contenido nuevo`);
          }
        }
        assert.equal(blocked.status, "blocked_by_guard");
        assert.match(blocked.detail, /qa/);
      },
    },

    // --- 18. Fuga de secretos ------------------------------------------------
    {
      name: "Un registro de auditoria que llevara el valor de un secreto NO se escribe",
      fn: async () => {
        const secret = "8412345678:AAH-token-de-telegram-falso-para-el-test";
        const outcome = await applyChangePlanWithPhp(
          validPlan(),
          validContext(),
          fakeWorld([baseState(), baseState({ contentHtml: NEW_CONTENT })]).deps
        );
        const clean = outcome.audit[0];
        const leaky: ExecutePhpAuditRecord = { ...clean, detail: `Fallo al llamar al bot con el token ${secret}` };

        // Con un env falso, `findSecretLeak` identifica la variable por
        // NOMBRE (nunca propaga el valor).
        assert.equal(findSecretLeak(JSON.stringify(leaky), { TELEGRAM_BOT_TOKEN: secret }), "TELEGRAM_BOT_TOKEN");
        assert.equal(findSecretLeak(JSON.stringify(clean), { TELEGRAM_BOT_TOKEN: secret }), null);

        const filePath = path.join(os.tmpdir(), `zentry-execute-php-audit-${process.pid}-${Date.now()}.jsonl`);
        try {
          withEnv({ TELEGRAM_BOT_TOKEN: secret }, () => {
            assert.throws(
              () => appendExecutePhpAudit(leaky, filePath),
              /variable sensible TELEGRAM_BOT_TOKEN/,
              "el append debe negarse a escribir el registro con el secreto"
            );
            assert.equal(fs.existsSync(filePath), false, "no se crea ni el fichero cuando el registro filtra un secreto");
            // El registro limpio si se escribe.
            appendExecutePhpAudit(clean, filePath);
          });
          const written = readExecutePhpAudit(filePath);
          assert.equal(written.length, 1);
          assert.equal(written[0].auditId, clean.auditId);
          assert.ok(!JSON.stringify(written[0]).includes(secret));
        } finally {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      },
    },

    // --- 19. Ability nativa antes que PHP ------------------------------------
    {
      name: "La ability nativa gana al fallback: sin motivo declarado el camino es native_ability y el guard lo rechaza",
      fn: () => {
        const native = selectExecutionPath({ operation: "update_post_content" });
        assert.equal(native.executionPath, "native_ability");
        assert.equal(native.nativeAbility, "novamira/gutenberg-write-content");
        assert.match(native.reason, /PHP no se usa por comodidad/);

        const decision = isExecutePhpAllowed(validRequest({ capabilitySelection: native }));
        assert.equal(decision.allowed, false);
        assert.equal(decision.failedCheck, "execution_path");
        assert.match(decision.reason, /no el fallback de PHP/);

        // Sin ability nativa que sirva, el fallback es el unico camino.
        const noNative = selectExecutionPath({ operation: "update_post_title" });
        assert.equal(noNative.executionPath, "execute_php_fallback");
        assert.equal(noNative.nativeAbility, null);
        assert.match(noNative.reason, /No existe ninguna ability nativa/);

        // Y con motivo declarado, el fallback queda justificado en el audit trail.
        const justified = fallbackSelection();
        assert.equal(justified.executionPath, "execute_php_fallback");
        assert.match(justified.reason, /shortcodes/);
      },
    },

    // --- 20. PHP escrito por el modelo ---------------------------------------
    {
      name: "PHP escrito a mano por el modelo: aunque haga lo mismo, no coincide con la plantilla y se bloquea",
      fn: () => {
        const handWritten = [
          "<?php",
          `$post_id = ${TARGET_ID};`,
          "$post = get_post($post_id);",
          `wp_update_post(array('ID' => $post_id, 'post_content' => '${NEW_CONTENT}'));`,
          "echo 'ok';",
        ].join("\n");

        const decision = isExecutePhpAllowed(validRequest({ php: handWritten }));
        assert.equal(decision.allowed, false);
        assert.equal(decision.failedCheck, "php_not_deterministic");
        assert.match(decision.reason, /execute-php-builder\.ts/);
        assert.throws(() => assertExecutePhpAllowed(validRequest({ php: handWritten })), /php_not_deterministic/);

        // Ni siquiera la salida de la plantilla con un cambio cosmetico:
        // la comprobacion es igualdad EXACTA, no parecido.
        const generated = buildPhpForPlan(validPlan());
        for (const tampered of [`${generated}\n`, `${generated}\n// nada importante`, generated.replace("$zentry_post_id", "$post_id")]) {
          assert.equal(isExecutePhpAllowed(validRequest({ php: tampered })).failedCheck, "php_not_deterministic");
        }
        // El generado tal cual si pasa: la lista blanca es de uno.
        assert.equal(isExecutePhpAllowed(validRequest({ php: generated })).allowed, true);
      },
    },

    // --- 21. Nombre del tool MCP y capa general ------------------------------
    {
      name: "El nombre del tool MCP no se cree: la ability real sale de ability_name, y execute-php sigue prohibida en la capa general",
      fn: () => {
        const resolved = resolveAbilityNameFromToolCall(MCP_EXECUTE_ABILITY_TOOL, { ability_name: "novamira/execute-php" });
        assert.equal(resolved.ok, true);
        assert.equal(resolved.abilityName, "novamira/execute-php");
        assert.match(resolved.reason, /ability_name/);

        for (const parameters of [{}, { ability_name: "" }, { ability_name: "   " }, { ability_name: 42 }]) {
          const bad = resolveAbilityNameFromToolCall(MCP_EXECUTE_ABILITY_TOOL, parameters as Record<string, unknown>);
          assert.equal(bad.ok, false, JSON.stringify(parameters));
          assert.equal(bad.abilityName, "");
          assert.match(bad.reason, /Fail-closed/);
        }

        // Un tool que no ejecuta abilities se clasifica por su propio nombre.
        const other = resolveAbilityNameFromToolCall("mcp-adapter-discover-abilities", {});
        assert.equal(other.ok, true);
        assert.equal(other.abilityName, "mcp-adapter-discover-abilities");

        // Y lo esencial: NO se ha reclasificado la ability. La puerta
        // general la sigue rechazando para todos los perfiles.
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          const general = isNovamiraAbilityAllowed("novamira/execute-php", { approvalGranted: true });
          assert.equal(general.allowed, false);
          assert.equal(general.risk, "dangerous_forbidden");

          for (const profile of ["specialists_read_only", "web_engineer_staging_write", "production_write"] as const) {
            const decision = isAbilityAllowedForProfile(profile, "novamira/execute-php", { approvalGranted: true });
            assert.equal(decision.allowed, false, profile);
            assert.equal(decision.risk, "dangerous_forbidden", profile);
          }
        });
      },
    },
  ];
}
