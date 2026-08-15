/**
 * INTERRUPTORES DE ENTORNO del apply del departamento.
 *
 * Modulo PURO: recibe los valores ya resueltos por quien llama (nunca
 * lee `process.env` aqui) y decide si se puede intentar una escritura
 * real. Es una capa que se SUMA a los guards que los propios adaptadores
 * de WordPress vuelven a comprobar por su cuenta -- defensa en
 * profundidad, no sustitucion.
 *
 * Dos puertas independientes y asimetricas a proposito:
 *
 * - STAGING es el entorno de trabajo/revision. Modificarlo NO requiere
 *   aprobacion humana previa, pero si requiere que los interruptores
 *   esten puestos, snapshot previo, validacion y rollback.
 * - PRODUCCION es zona protegida. Ademas de sus TRES interruptores
 *   propios, exige aprobacion humana explicita de la version EXACTA que
 *   esta en staging -- eso lo comprueba el executor de produccion, no
 *   este modulo, y ninguna de las dos comprobaciones puede saltarse la
 *   otra.
 */

export interface StagingApplyGuards {
  /** `DEPARTMENT_STAGING_APPLY_ENABLED=true` -- interruptor propio del apply automatico a staging. */
  stagingApplyEnabled: boolean;
  /** `WORDPRESS_DRAFTS_ENABLED=true` -- interruptor de escritura del adaptador de staging. */
  wordpressWritesEnabled: boolean;
  /** `WORDPRESS_BACKEND` -- solo "rest" escribe de verdad. */
  wordpressBackend: string;
  /** `WORDPRESS_ENV` -- solo "staging". "production" esta bloqueado de forma incondicional en ese adaptador. */
  wordpressEnv: string;
}

export interface ProductionApplyGuards {
  /** `DEPARTMENT_PRODUCTION_APPLY_ENABLED=true` -- interruptor propio de esta fase, aparte de los del adaptador. */
  departmentProductionApplyEnabled: boolean;
  /** `PRODUCTION_EXECUTION_ENABLED=true`. */
  productionExecutionEnabled: boolean;
  /** `PRODUCTION_DRAFTS_ENABLED=true`. */
  productionWritesEnabled: boolean;
  /** `PRODUCTION_BACKEND` -- solo "rest". */
  productionBackend: string;
}

export interface GuardCheckResult {
  allowed: boolean;
  /** Siempre no vacio: exactamente que interruptor falta, por su NOMBRE (nunca su valor si fuera un secreto). */
  reason: string;
}

export function checkStagingApplyGuards(guards: StagingApplyGuards): GuardCheckResult {
  if (guards.wordpressEnv !== "staging") {
    return {
      allowed: false,
      reason: `WORDPRESS_ENV="${guards.wordpressEnv}". El apply de staging del departamento SOLO escribe en staging; el adaptador de staging bloquea produccion de forma incondicional y este sistema no tiene ninguna via para saltarselo.`,
    };
  }
  if (!guards.stagingApplyEnabled) {
    return { allowed: false, reason: "DEPARTMENT_STAGING_APPLY_ENABLED no es true: no se intenta ninguna escritura real en staging en esta pasada." };
  }
  if (!guards.wordpressWritesEnabled) {
    return { allowed: false, reason: "WORDPRESS_DRAFTS_ENABLED no es true: el adaptador de WordPress de staging tiene prohibido escribir." };
  }
  if (guards.wordpressBackend !== "rest") {
    return { allowed: false, reason: `WORDPRESS_BACKEND="${guards.wordpressBackend}": solo el backend "rest" realiza escrituras reales.` };
  }
  return { allowed: true, reason: "Los interruptores permiten aplicar cambios reversibles en STAGING (nunca produccion)." };
}

/**
 * Los guards de PRODUCCION. Que devuelvan `allowed: true` NO significa
 * que se pueda publicar: significa unicamente que los interruptores
 * estan puestos. La aprobacion humana de la version exacta se comprueba
 * aparte, y sin ella no se escribe nada aunque esto diga que si.
 */
export function checkProductionApplyGuards(guards: ProductionApplyGuards): GuardCheckResult {
  if (!guards.departmentProductionApplyEnabled) {
    return {
      allowed: false,
      reason: "DEPARTMENT_PRODUCTION_APPLY_ENABLED no es true: este entorno no puede publicar en produccion. La aprobacion queda registrada, pero no se escribe nada.",
    };
  }
  if (!guards.productionExecutionEnabled) {
    return { allowed: false, reason: "PRODUCTION_EXECUTION_ENABLED no es true: el executor de produccion esta desactivado." };
  }
  if (!guards.productionWritesEnabled) {
    return { allowed: false, reason: "PRODUCTION_DRAFTS_ENABLED no es true: el adaptador de produccion tiene prohibido escribir." };
  }
  if (guards.productionBackend !== "rest") {
    return { allowed: false, reason: `PRODUCTION_BACKEND="${guards.productionBackend}": solo el backend "rest" realiza escrituras reales en produccion.` };
  }
  return {
    allowed: true,
    reason: "Los cuatro interruptores de produccion estan activos. Sigue haciendo falta aprobacion humana explicita de la version exacta que hay en staging.",
  };
}
