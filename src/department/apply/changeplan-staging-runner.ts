import { CapabilitySelection } from "../../core/execute-php-operations";
import { ExecutePhpAuditRecord } from "../../core/execute-php-audit";
import { ExecutePhpContext, ExecutePhpDeps, ExecutePhpOutcome, applyChangePlanWithPhp } from "./execute-php-executor";
import { DepartmentChangeStatus } from "./state-machine";
import { ExecutablePlanRecord } from "./types";

/**
 * EL PUENTE QUE FALTABA entre un `executableChangePlan` y el executor
 * real de staging.
 *
 * EL PROBLEMA. La capacidad de ejecutar un ChangePlan sobre staging
 * (snapshot -> apply -> read-back -> validacion de scope -> rollback
 * verificado) ya existia y estaba probada end-to-end:
 * `applyChangePlanWithPhp()` en `./execute-php-executor.ts`. Pero solo la
 * llamaban dos sitios: el E2E controlado (`scripts/o47-execute-php-e2e.ts`)
 * y la SESION DE APROBACION MANUAL (`scripts/run-approval-session.ts`).
 *
 * La pasada DIARIA no. Su fase `stage`
 * (`scripts/run-department-apply.ts`) filtraba asi:
 *
 *     if (item.applyStatus !== "proposed" || !item.applyCapability.supported) continue;
 *
 * `applyCapability` es el camino LEGACY: interpreta la PROSA de
 * web-engineer buscando `page_id=N` y lineas `TITLE:` / `META:`. Un
 * ChangePlan estructurado y ya resuelto contra el inventario real no
 * satisface ese predicado -- `buildApplyPlan()` lo asciende a `proposed`
 * a proposito (`hasExecutablePlan`), y acto seguido la fase `stage` lo
 * descartaba en silencio por no tener capacidad legacy.
 *
 * Resultado observable: el departamento producia planes ejecutables y
 * terminaba diciendo "requiere implementacion manual en staging" con la
 * capacidad de ejecutarlos ya construida y probada al lado.
 *
 * ESTE MODULO no inventa un executor nuevo. Extrae, TAL CUAL, el cableado
 * que la sesion de aprobacion ya usaba -- contexto, adaptadores de
 * lectura/escritura, auditoria -- para que los dos caminos (aprobacion
 * manual y pasada diaria automatica) ejecuten exactamente el mismo
 * codigo. Duplicarlo habria significado dos caminos que divergen, y la
 * divergencia en la capa que ESCRIBE en un sitio real es justo lo que no
 * se puede permitir.
 *
 * La decision de POLITICA (que es ejecutable automaticamente en staging y
 * que no) vive en `decideChangePlanExecution()`, que es PURA y por tanto
 * testeable sin WordPress, sin MCP y sin red.
 */

export interface ChangePlanExecutionFlags {
  executePhpFallbackEnabled: boolean;
  novamiraStagingWritesEnabled: boolean;
  wordpressEnv: string;
}

/**
 * Por que un ChangePlan NO se ejecuta automaticamente. Cada valor es una
 * causa distinta con remedio distinto: agruparlas en "no ejecutable"
 * seria repetir el error de `requires_manual_staging_implementation`.
 */
export type ChangePlanExecutionRefusal =
  | "no_executable_plan"
  | "native_ability_not_wired"
  | "production_environment"
  | "writes_disabled";

export interface ChangePlanExecutionDecision {
  executable: boolean;
  refusal: ChangePlanExecutionRefusal | null;
  /** Siempre no vacio, tambien cuando SI es ejecutable. */
  reason: string;
}

export interface DecideChangePlanExecutionInput {
  executableChangePlan: ExecutablePlanRecord | null;
  flags: ChangePlanExecutionFlags;
}

/**
 * PURA. Decide si este ChangePlan puede ejecutarse automaticamente en
 * staging AHORA. Fail-closed: cualquier duda es `executable: false` con
 * el motivo literal.
 *
 * Ojo con lo que esta funcion NO comprueba: no vuelve a validar el plan
 * (ya lo valido `buildChangePlanFromDraft` contra el contrato), no
 * comprueba el hash (eso lo hace el executor leyendo el sitio de verdad,
 * que es el unico momento en el que esa comprobacion significa algo) y
 * no mira aprobaciones humanas -- en este flujo staging-first la
 * aprobacion humana gobierna el paso a PRODUCCION, nunca el de staging.
 */
export function decideChangePlanExecution(input: DecideChangePlanExecutionInput): ChangePlanExecutionDecision {
  const executable = input.executableChangePlan;
  if (!executable) {
    return {
      executable: false,
      refusal: "no_executable_plan",
      reason: "Esta recomendacion no llego a producir ningun ChangePlan ejecutable en esta pasada.",
    };
  }

  // Guardarrail de entorno duplicado a proposito. El executor y el
  // adaptador de WordPress ya bloquean produccion por su cuenta; aqui se
  // vuelve a comprobar porque esta es la capa que DECIDE ejecutar, y una
  // sola linea de defensa en el camino que escribe no es suficiente.
  if (input.flags.wordpressEnv !== "staging") {
    return {
      executable: false,
      refusal: "production_environment",
      reason: `El entorno de WordPress resuelto es "${input.flags.wordpressEnv}", no "staging". El apply automatico solo actua sobre staging: produccion exige aprobacion humana explicita y su propio camino.`,
    };
  }

  if (executable.capability.executionPath === "native_ability") {
    return {
      executable: false,
      refusal: "native_ability_not_wired",
      reason: `El camino elegido es "native_ability" (${executable.capability.nativeAbility}) y ese executor todavia NO esta cableado. No se ejecuta nada: se dice, en vez de fingir que se aplico.`,
    };
  }

  if (!input.flags.executePhpFallbackEnabled || !input.flags.novamiraStagingWritesEnabled) {
    const off = [
      input.flags.executePhpFallbackEnabled ? null : "NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED",
      input.flags.novamiraStagingWritesEnabled ? null : "NOVAMIRA_STAGING_WRITES_ENABLED",
    ].filter((name): name is string => name !== null);
    return {
      executable: false,
      refusal: "writes_disabled",
      reason: `Interruptor(es) de escritura apagado(s): ${off.join(", ")}. No se intenta escribir nada en staging.`,
    };
  }

  return {
    executable: true,
    refusal: null,
    reason: `ChangePlan ejecutable: operacion "${executable.operation}" sobre el post ${executable.wordpressPageId} de staging (${executable.stagingUrl}), camino "${executable.capability.executionPath}", anclado a la version ${executable.plan.expectedBeforeHash.slice(0, 12)}.`,
  };
}

export interface RunChangePlanInput {
  executable: ExecutablePlanRecord;
  departmentRunId: string;
  recommendationId: string;
  changeId: string;
  qaStatus: string;
  flags: ChangePlanExecutionFlags;
  /**
   * Adaptadores reales (lectura del sitio y ejecucion de PHP). Se
   * inyectan en vez de construirse aqui para que este modulo siga siendo
   * testeable sin red, igual que el executor al que envuelve.
   */
  deps: ExecutePhpDeps;
  /** Se llama con CADA registro de auditoria producido, en orden. */
  onAudit?: (record: ExecutePhpAuditRecord) => void;
}

/** Construye el contexto que espera el executor. Separado para poder verificarlo en tests. */
export function buildExecutePhpContext(input: {
  departmentRunId: string;
  recommendationId: string;
  changeId: string;
  qaStatus: string;
  capability: CapabilitySelection;
  flags: ChangePlanExecutionFlags;
}): ExecutePhpContext {
  return {
    departmentRunId: input.departmentRunId,
    recommendationId: input.recommendationId,
    changeId: input.changeId,
    qaStatus: input.qaStatus,
    capabilitySelection: input.capability,
    flags: {
      executePhpFallbackEnabled: input.flags.executePhpFallbackEnabled,
      novamiraStagingWritesEnabled: input.flags.novamiraStagingWritesEnabled,
      wordpressEnv: input.flags.wordpressEnv,
    },
  };
}

/**
 * Ejecuta un ChangePlan ya resuelto contra staging, con TODA la
 * maquinaria de seguridad del executor existente: snapshot, ancla de
 * version (STALE si la pagina cambio), guard de PHP determinista,
 * read-back por una via distinta a la de escritura, validacion de scope
 * (nada fuera del campo declarado puede haber cambiado) y rollback
 * verificado si la validacion falla.
 *
 * No decide nada por su cuenta: quien llama debe haber pasado antes por
 * `decideChangePlanExecution()`.
 */
export async function runExecutableChangePlan(input: RunChangePlanInput): Promise<ExecutePhpOutcome> {
  const context = buildExecutePhpContext({
    departmentRunId: input.departmentRunId,
    recommendationId: input.recommendationId,
    changeId: input.changeId,
    qaStatus: input.qaStatus,
    capability: input.executable.capability,
    flags: input.flags,
  });

  const outcome = await applyChangePlanWithPhp(input.executable.plan, context, input.deps);

  // La auditoria se emite SIEMPRE, tambien cuando el resultado fue un
  // fallo o un rollback: un apply que se revirtio tiene que quedar
  // registrado como tal, nunca en silencio.
  if (input.onAudit) {
    for (const record of outcome.audit) input.onAudit(record);
  }

  return outcome;
}

/**
 * Traduce el resultado del executor al vocabulario de la maquina de
 * estados persistente del cambio. Fail-closed: lo que no se reconoce
 * NUNCA se traduce a un estado de exito.
 */
export function mapOutcomeToChangeStatus(status: ExecutePhpOutcome["status"]): DepartmentChangeStatus {
  switch (status) {
    case "applied":
      return "staging_applied";
    case "validation_failed":
      return "staging_validation_failed";
    case "rolled_back":
      return "staging_rolled_back";
    case "rollback_failed":
      // Rollback fallido es el unico estado CRITICO: staging queda en un
      // estado que no hemos podido devolver al original.
      return "blocked";
    case "stale":
    case "blocked_by_guard":
    case "failed":
    default:
      return "proposed";
  }
}
