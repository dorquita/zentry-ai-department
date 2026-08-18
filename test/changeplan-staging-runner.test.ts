import * as assert from "assert";
import {
  decideChangePlanExecution,
  mapOutcomeToChangeStatus,
} from "../src/department/apply/changeplan-staging-runner";
import { isRefusedBeforeExecuting } from "../src/department/apply/execute-php-executor";
import { ExecutablePlanRecord } from "../src/department/apply/types";

/**
 * LA REGRESION QUE ESTOS TESTS IMPIDEN.
 *
 * El departamento sabia construir ChangePlans ejecutables y sabia
 * ejecutarlos -- pero no en la misma pasada. La fase `stage` filtraba por
 * la capacidad LEGACY (la que interpreta prosa buscando `page_id=N`), asi
 * que un ChangePlan estructurado, ya resuelto contra el inventario real y
 * con su ancla de version, se descartaba en silencio y la pasada
 * terminaba diciendo "requiere implementacion manual en staging".
 *
 * La decision de ejecutar vive ahora en una funcion PURA para poder
 * fijarla aqui, sin WordPress, sin MCP y sin red.
 */

function planFor(overrides: Partial<ExecutablePlanRecord> = {}): ExecutablePlanRecord {
  return {
    plan: {
      contractVersion: "execute-php/v1",
      operation: "update_post_title",
      targetId: 1867,
      expectedBeforeHash: "abcdef0123456789abcdef0123456789",
      payload: { value: "Taquillas metalicas para vestuarios" },
      scopeFields: ["post_title"],
    },
    capability: {
      executionPath: "execute_php_fallback",
      nativeAbility: null,
      reason: "El bloque objetivo no lo soporta ninguna ability nativa.",
    } as ExecutablePlanRecord["capability"],
    wordpressPageId: 1867,
    stagingUrl: "https://staging.zentrylockers.com/taquillas-metalicas/",
    beforeValue: "Taquillas",
    afterValue: "Taquillas metalicas para vestuarios",
    operation: "update_post_title",
    rationale: "El title actual no contiene la keyword objetivo.",
    ...overrides,
  };
}

const ON = { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "staging" };

export function runChangePlanStagingRunnerTests(): { name: string; fn: () => void }[] {
  return [
    {
      name: "Un ChangePlan ejecutable con los interruptores encendidos SI se ejecuta -- este es el fallo que se estaba corrigiendo",
      fn: () => {
        const decision = decideChangePlanExecution({ executableChangePlan: planFor(), flags: ON });
        assert.equal(decision.executable, true);
        assert.equal(decision.refusal, null);
        // El motivo no puede ser generico: tiene que decir sobre QUE se va
        // a escribir, porque es lo que despues se lee en el log de la
        // pasada para saber que paso.
        assert.ok(decision.reason.includes("1867"), `el motivo debe citar la pagina destino: ${decision.reason}`);
        assert.ok(decision.reason.includes("update_post_title"), `el motivo debe citar la operacion: ${decision.reason}`);
      },
    },
    {
      name: "Sin ChangePlan no se ejecuta nada, y el motivo lo dice",
      fn: () => {
        const decision = decideChangePlanExecution({ executableChangePlan: null, flags: ON });
        assert.equal(decision.executable, false);
        assert.equal(decision.refusal, "no_executable_plan");
        assert.ok(decision.reason.trim().length > 0);
      },
    },
    {
      name: "PRODUCCION es inalcanzable por este camino, aunque el plan sea perfecto y los interruptores esten encendidos",
      fn: () => {
        for (const env of ["production", "produccion", "", "PRODUCTION"]) {
          const decision = decideChangePlanExecution({
            executableChangePlan: planFor(),
            flags: { ...ON, wordpressEnv: env },
          });
          assert.equal(decision.executable, false, `entorno "${env}" no puede ser ejecutable`);
          assert.equal(decision.refusal, "production_environment");
        }
      },
    },
    {
      name: "El camino native_ability se dice, no se finge: no esta cableado y por tanto no se ejecuta",
      fn: () => {
        const decision = decideChangePlanExecution({
          executableChangePlan: planFor({
            capability: {
              executionPath: "native_ability",
              nativeAbility: "novamira/update-heading",
              reason: "El bloque es un core/heading soportado.",
            } as ExecutablePlanRecord["capability"],
          }),
          flags: ON,
        });
        assert.equal(decision.executable, false);
        assert.equal(decision.refusal, "native_ability_not_wired");
        assert.ok(decision.reason.includes("novamira/update-heading"));
      },
    },
    {
      name: "Cada interruptor de escritura apagado, por separado, basta para no escribir nada",
      fn: () => {
        const sinFallback = decideChangePlanExecution({
          executableChangePlan: planFor(),
          flags: { ...ON, executePhpFallbackEnabled: false },
        });
        assert.equal(sinFallback.executable, false);
        assert.equal(sinFallback.refusal, "writes_disabled");
        assert.ok(sinFallback.reason.includes("NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED"));

        const sinWrites = decideChangePlanExecution({
          executableChangePlan: planFor(),
          flags: { ...ON, novamiraStagingWritesEnabled: false },
        });
        assert.equal(sinWrites.executable, false);
        assert.equal(sinWrites.refusal, "writes_disabled");
        assert.ok(sinWrites.reason.includes("NOVAMIRA_STAGING_WRITES_ENABLED"));
      },
    },
    {
      name: "El motivo NUNCA esta vacio, tambien cuando la respuesta es que si",
      fn: () => {
        const casos = [
          decideChangePlanExecution({ executableChangePlan: planFor(), flags: ON }),
          decideChangePlanExecution({ executableChangePlan: null, flags: ON }),
          decideChangePlanExecution({ executableChangePlan: planFor(), flags: { ...ON, wordpressEnv: "production" } }),
        ];
        for (const caso of casos) assert.ok(caso.reason.trim().length > 10, "un motivo vacio es indistinguible de no haber evaluado");
      },
    },
    {
      name: "REGRESION REAL: una llamada RECHAZADA no se reporta como dano en staging",
      fn: () => {
        // Paso de verdad (run 32086012465): el guard de execute-php
        // rechazo la llamada por actor no autorizado, el apply no
        // escribio nada, el rollback fue rechazado por lo MISMO, y el
        // sistema lo reporto como "CRITICO: el post puede haber quedado
        // en un estado intermedio. Requiere intervencion humana
        // inmediata". La pagina estaba intacta.
        //
        // Una falsa alarma en la senal MAS grave del sistema entrena a
        // ignorar justo lo que nunca hay que ignorar.
        assert.equal(isRefusedBeforeExecuting("execute-php guard: llamada BLOQUEADA (actor). Actor no autorizado."), true);
        assert.equal(isRefusedBeforeExecuting("Bloqueado por el guard (environment): produccion no permitida."), true);

        // Lo que NO puede colar como "no paso nada": un fallo a mitad de
        // camino deja el estado en duda y sigue siendo critico.
        assert.equal(isRefusedBeforeExecuting("Fallo de red: socket hang up"), false);
        assert.equal(isRefusedBeforeExecuting("HTTP 500 del servidor MCP"), false);
        assert.equal(isRefusedBeforeExecuting("PHP Fatal error: allowed memory size exhausted"), false);
        assert.equal(isRefusedBeforeExecuting("timeout tras 30000 ms"), false);
        assert.equal(isRefusedBeforeExecuting(""), false);
      },
    },
    {
      name: "Solo `applied` se traduce a exito: cualquier otro resultado, incluido uno desconocido, NUNCA se lee como aplicado",
      fn: () => {
        assert.equal(mapOutcomeToChangeStatus("applied"), "staging_applied");
        assert.equal(mapOutcomeToChangeStatus("validation_failed"), "staging_validation_failed");
        assert.equal(mapOutcomeToChangeStatus("rolled_back"), "staging_rolled_back");
        // Rollback fallido es el unico CRITICO: staging quedo en un estado
        // que no hemos podido devolver al original.
        assert.equal(mapOutcomeToChangeStatus("rollback_failed"), "blocked");
        for (const status of ["stale", "blocked_by_guard", "failed"] as const) {
          assert.equal(mapOutcomeToChangeStatus(status), "proposed", `"${status}" no puede parecerse a un exito`);
        }
      },
    },
  ];
}
