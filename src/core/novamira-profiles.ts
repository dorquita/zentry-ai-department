import { classifyNovamiraAbility, isNovamiraAbilityAllowed, NovamiraGuardContext, NovamiraGuardResult, NovamiraRiskLevel } from "./novamira-guard";

/**
 * PERFILES DE PERMISO sobre el MCP de Novamira -- quien puede llamar a
 * que, dentro de lo que el allowlist ya permite.
 *
 * Relacion EXACTA con `novamira-guard.ts`, y es la invariante central de
 * este modulo: un perfil solo puede ESTRECHAR, nunca ampliar. El guard
 * decide primero si una ability es invocable en absoluto (riesgo,
 * entorno, flag, aprobacion); el perfil decide despues si ADEMAS este
 * llamante concreto tiene derecho a usarla. Una ability que el guard
 * rechaza sigue rechazada con cualquier perfil, y ningun perfil existente
 * o futuro puede desbloquear `dangerous_forbidden` ni `manual_only`.
 *
 * Por que hace falta esta segunda capa: sin ella, "el departamento puede
 * escribir en staging" significaria que CUALQUIER empleado puede escribir
 * en staging -- incluidos los seis especialistas Claude, que son
 * READ / ANALYZE / PROPOSE por diseno. La escritura es competencia de UN
 * solo componente (la capa de apply, actuando sobre un ChangePlan ya
 * revisado), no de quien redacta la propuesta.
 *
 * Los tres perfiles:
 *
 *   - `specialists_read_only`: SEO, Content, Analytics, Growth y QA.
 *     Solo abilities `safe_read`. Nunca escriben, en ningun entorno, con
 *     ningun flag, con ninguna aprobacion.
 *   - `web_engineer_staging_write`: la capa de apply que ejecuta un
 *     ChangePlan. Anade las `safe_write_staging_only`, que el guard sigue
 *     condicionando a WORDPRESS_ENV=staging +
 *     NOVAMIRA_STAGING_WRITES_ENABLED + (si aplica) aprobacion humana.
 *   - `production_write`: existe para poder NOMBRARLO y bloquearlo de
 *     forma explicita. Hoy no concede ninguna escritura: produccion no se
 *     toca por MCP en esta fase, y el guard la bloquea ademas por su
 *     cuenta de forma incondicional. Que el perfil exista no lo habilita.
 *
 * Modulo PURO: no lee ficheros (delega en el guard, que relee el
 * allowlist en cada llamada), no abre red, no invoca ninguna ability.
 */

export type NovamiraProfile = "specialists_read_only" | "web_engineer_staging_write" | "production_write";

export const NOVAMIRA_PROFILES: NovamiraProfile[] = ["specialists_read_only", "web_engineer_staging_write", "production_write"];

/**
 * Niveles de riesgo que cada perfil puede llegar a usar -- techo, no
 * garantia. Que un nivel figure aqui no significa que la llamada se
 * permita: el guard vuelve a comprobar entorno, flag y aprobacion
 * despues, y su "no" es definitivo.
 *
 * Ningun perfil incluye `dangerous_forbidden` ni `manual_only`, y un test
 * de invariante lo verifica sobre TODOS los perfiles para que anadir uno
 * nuevo mal configurado rompa la suite en vez de abrir un agujero.
 */
const PROFILE_RISK_CEILING: Record<NovamiraProfile, NovamiraRiskLevel[]> = {
  specialists_read_only: ["safe_read"],
  web_engineer_staging_write: ["safe_read", "safe_write_staging_only"],
  // Deliberadamente solo lectura: esta fase NO conecta produccion por
  // MCP. Cambiar esto no bastaria para escribir en produccion (el guard
  // lo bloquea igualmente), pero tampoco debe cambiarse aqui: la via de
  // produccion es el carril REST con aprobacion humana explicita.
  production_write: ["safe_read"],
};

export const PROFILE_DESCRIPTION: Record<NovamiraProfile, string> = {
  specialists_read_only:
    "SEO, Content, Analytics, Growth y QA. Solo lectura: inspeccionar paginas, contenido, estructura, metadatos y estado de WordPress. Nunca escriben.",
  web_engineer_staging_write:
    "La capa de apply que ejecuta un ChangePlan ya revisado. Lectura + escritura de contenido en STAGING, siempre bajo los interruptores y la validacion del guard.",
  production_write:
    "Reservado y explicitamente NO habilitado en esta fase: produccion no se toca por MCP. Solo lectura; cualquier escritura sigue siendo del carril REST con aprobacion humana explicita.",
};

/** Empleados Claude que operan en modo READ / ANALYZE / PROPOSE: nunca escriben. */
export const READ_ONLY_EMPLOYEES = [
  "seo-specialist",
  "content-strategist",
  "analytics-specialist",
  "sem-specialist",
  "growth-director-v2",
  "qa-reviewer",
  "web-engineer",
] as const;

/**
 * Resuelve el perfil de un empleado por su nombre.
 *
 * Ojo con `web-engineer`, que es contraintuitivo a proposito: el EMPLEADO
 * web-engineer tambien es de solo lectura. Es un especificador -- produce
 * un ChangePlan, no escribe. Quien escribe es la CAPA DE APPLY que
 * ejecuta ese plan despues de pasar por el guard, y esa capa no es un
 * empleado Claude ni recibe su perfil por esta funcion.
 *
 * Cualquier nombre desconocido cae en `specialists_read_only`: el valor
 * fail-closed de esta funcion es el perfil mas estrecho, nunca el mas
 * ancho.
 */
export function resolveProfileForEmployee(_employee: string): NovamiraProfile {
  // Sin ramas a proposito: TODOS los empleados Claude son de solo
  // lectura, y un nombre desconocido tambien. Que esta funcion no pueda
  // devolver un perfil de escritura es la garantia, no un descuido --
  // asi anadir un empleado nuevo no puede concederle escritura por
  // olvido. `READ_ONLY_EMPLOYEES` documenta el censo conocido y los
  // tests lo recorren entero contra esta funcion.
  return "specialists_read_only";
}

export interface NovamiraProfileDecision extends NovamiraGuardResult {
  profile: NovamiraProfile;
  /** `true` solo si el perfil permite el nivel de riesgo Y el guard permite la llamada. */
  allowed: boolean;
}

/**
 * Decision COMPLETA: perfil + guard. Es la unica funcion que deberia
 * usarse para decidir si un llamante concreto puede invocar una ability.
 *
 * Orden deliberado: primero el perfil (mas barato, y su "no" es
 * suficiente), despues el guard. Los dos tienen que decir que si.
 */
export function isAbilityAllowedForProfile(
  profile: NovamiraProfile,
  abilityName: string,
  context: NovamiraGuardContext = {}
): NovamiraProfileDecision {
  const risk = classifyNovamiraAbility(abilityName);
  const ceiling = PROFILE_RISK_CEILING[profile];

  if (!ceiling) {
    return {
      profile,
      allowed: false,
      risk,
      reason: `Perfil "${profile}" desconocido -- fail-closed: no se permite ninguna ability.`,
    };
  }

  if (!ceiling.includes(risk)) {
    return {
      profile,
      allowed: false,
      risk,
      reason: `El perfil "${profile}" no puede usar abilities de riesgo "${risk}" (solo ${ceiling.join(", ")}). ${PROFILE_DESCRIPTION[profile]}`,
    };
  }

  // El perfil deja pasar el nivel de riesgo; ahora manda el guard, que
  // vuelve a comprobar entorno, flag y aprobacion. Su "no" es definitivo.
  const guard = isNovamiraAbilityAllowed(abilityName, context);
  return { profile, allowed: guard.allowed, risk: guard.risk, reason: guard.reason };
}

/** Version que lanza, para incrustar justo antes de una invocacion real. */
export function assertAbilityAllowedForProfile(
  profile: NovamiraProfile,
  abilityName: string,
  context: NovamiraGuardContext = {}
): void {
  const decision = isAbilityAllowedForProfile(profile, abilityName, context);
  if (!decision.allowed) {
    throw new Error(`Novamira profile guard: llamada bloqueada a "${abilityName}" con perfil "${profile}" (riesgo: ${decision.risk}). ${decision.reason}`);
  }
}

/** Techo de riesgo de un perfil -- expuesto para los tests de invariante y para poder documentarlo sin duplicar la tabla. */
export function riskCeilingForProfile(profile: NovamiraProfile): NovamiraRiskLevel[] {
  return [...(PROFILE_RISK_CEILING[profile] ?? [])];
}
