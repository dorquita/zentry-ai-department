/**
 * Contratos VERSIONADOS de una pasada coordinada del departamento
 * ("department run") -- ver docs/department-coordination.md.
 *
 * Esta capa NO es un empleado nuevo ni parte del runtime comun
 * (.github/actions/claude-employee-runtime/, src/core/claude-employee-runtime.ts,
 * que no se tocan): es la capa de ORQUESTACION que ejecuta a los
 * empleados Claude que YA funcionan, en un orden concreto, dentro de UNA
 * misma ejecucion identificada por un `departmentRunId` comun, y hace
 * que la salida REAL de cada fase este disponible para la siguiente
 * mediante ficheros JSON en rutas deterministas -- nunca mediante
 * scraping de logs ni buscando artifacts historicos ambiguos.
 *
 * Fase READ / ANALYZE / PROPOSE unicamente: nada de lo que se produce
 * aqui se aplica a ningun sistema (WordPress, staging, produccion,
 * Google Ads, GA4/GTM, Search Console, n8n, email). No hay APPLY.
 */

/**
 * Version del contrato de ficheros de un department run. Se escribe en
 * `manifest.json`, en el bundle de QA y en el daily brief. Un consumidor
 * que lea un fichero con otra version debe fallar de forma explicita en
 * vez de interpretarlo a medias -- ver `assertSupportedContractVersion()`.
 */
export const DEPARTMENT_RUN_CONTRACT_VERSION = "department-run/v1";

/**
 * Estados explicitos de una etapa. Deliberadamente cinco (no un
 * booleano ok/ko): la diferencia entre "no habia datos" (`not_available`)
 * y "produjo algo que no cumple su contrato" (`invalid_output`) es
 * exactamente lo que permite degradar de forma segura sin inventar
 * nada.
 *
 * - `executed`: el empleado corrio y su salida paso su propia validacion
 *   de dominio (la del empleado, sin relajar).
 * - `blocked`: la etapa no debia correr porque una etapa anterior lo
 *   impide de forma deliberada (p.ej. QA marco BLOCKED y por tanto no se
 *   promueve nada a web-engineer). No es un fallo tecnico.
 * - `invalid_output`: el empleado corrio pero su salida NO cumple su
 *   contrato. Fail-closed: nunca se reinterpreta ni se rellena.
 * - `not_available`: no habia insumos reales para esa etapa (p.ej. no hay
 *   change packs de contenido elegibles, SEM esta fuera de esta fase).
 *   No es un fallo.
 * - `failed`: fallo tecnico real de la etapa (el step murio, timeout,
 *   auth, etc.).
 */
export type DepartmentStageStatus = "executed" | "blocked" | "invalid_output" | "not_available" | "failed";

export const DEPARTMENT_STAGE_STATUSES: DepartmentStageStatus[] = ["executed", "blocked", "invalid_output", "not_available", "failed"];

/**
 * Empleados que participan en la pasada coordinada. `sem-specialist`
 * aparece a proposito: esta fuera de esta fase, y debe quedar SIEMPRE
 * registrado de forma explicita como `not_available` (pendiente) en vez
 * de desaparecer del informe -- pero nunca puede bloquear la pasada.
 */
export type DepartmentStageName =
  | "seo-specialist"
  | "content-strategist"
  | "analytics-specialist"
  | "sem-specialist"
  | "growth-director-v2"
  | "qa-reviewer"
  | "web-engineer";

export const DEPARTMENT_STAGE_NAMES: DepartmentStageName[] = [
  "seo-specialist",
  "content-strategist",
  "analytics-specialist",
  "sem-specialist",
  "growth-director-v2",
  "qa-reviewer",
  "web-engineer",
];

/** Los tres especialistas de la FASE 1 que si se ejecutan en esta fase (SEM queda fuera). */
export const DEPARTMENT_SPECIALIST_STAGES: DepartmentStageName[] = ["seo-specialist", "content-strategist", "analytics-specialist"];

export type DepartmentPhase = "specialists" | "growth" | "qa" | "web-engineering" | "brief";

export const DEPARTMENT_STAGE_PHASE: Record<DepartmentStageName, DepartmentPhase> = {
  "seo-specialist": "specialists",
  "content-strategist": "specialists",
  "analytics-specialist": "specialists",
  "sem-specialist": "specialists",
  "growth-director-v2": "growth",
  "qa-reviewer": "qa",
  "web-engineer": "web-engineering",
};

/**
 * Una etapa registrada en el manifiesto. Todas las rutas son
 * REPO-RELATIVAS (nunca absolutas de la maquina que ejecuto): el
 * manifiesto se sube como artifact y debe seguir siendo legible fuera
 * del runner que lo genero.
 */
export interface DepartmentStageRecord {
  stage: DepartmentStageName;
  phase: DepartmentPhase;
  status: DepartmentStageStatus;
  /** Siempre no vacio: por que la etapa quedo en ese estado, en lenguaje explicito. */
  reason: string;
  /** Salida cruda YA VALIDADA del empleado, copiada dentro del run del departamento. `null` si no hay. */
  outputPath: string | null;
  /** Artefacto propio del empleado (artifact.json / review.json), copiado dentro del run. `null` si no hay. */
  artifactPath: string | null;
  /**
   * Id de la pasada de DATOS que uso ese empleado cuando su dominio
   * tiene uno propio (p.ej. el `departmentRunId` del event bus del que
   * analytics-specialist leyo su snapshot real de GA4/GTM). NO es el
   * `departmentRunId` de esta coordinacion -- se registra por
   * trazabilidad, precisamente para no confundirlos.
   */
  sourceRunId: string | null;
  /** Avisos de la auditoria de dominio del propio empleado (nunca descartados ni reinterpretados). */
  auditWarningCount: number | null;
  recordedAt: string;
}

export interface DepartmentRunManifest {
  contractVersion: string;
  departmentRunId: string;
  startedAt: string;
  updatedAt: string;
  /** Nota fija de seguridad -- esta fase no escribe en ningun sistema externo. */
  note: string;
  stages: DepartmentStageRecord[];
}

/** Estado de QA a nivel de DEPARTAMENTO (vocabulario pedido para esta fase), derivado del `reviewStatus` del empleado qa-reviewer. */
export type DepartmentQaStatus = "PASS" | "PASS_WITH_WARNINGS" | "BLOCKED" | "NOT_AVAILABLE";

export function assertSupportedContractVersion(version: unknown, fileLabel: string): void {
  if (version !== DEPARTMENT_RUN_CONTRACT_VERSION) {
    throw new Error(
      `${fileLabel}: contractVersion "${String(version)}" no soportada (se esperaba "${DEPARTMENT_RUN_CONTRACT_VERSION}"). Fail-closed: no se interpreta un contrato de otra version.`
    );
  }
}

export function isDepartmentStageStatus(value: unknown): value is DepartmentStageStatus {
  return typeof value === "string" && (DEPARTMENT_STAGE_STATUSES as string[]).includes(value);
}

export function isDepartmentStageName(value: unknown): value is DepartmentStageName {
  return typeof value === "string" && (DEPARTMENT_STAGE_NAMES as string[]).includes(value);
}

/**
 * Genera el `departmentRunId` de UNA pasada coordinada. Prefijo `dept-`
 * DELIBERADAMENTE distinto del prefijo `growth-department-` que usa
 * `buildDepartmentRunId()` (src/core/department-run-id.ts) para agrupar
 * eventos del bus determinista: son dos identificadores distintos que
 * conviven, y confundirlos seria el fallo de trazabilidad mas facil de
 * cometer en este sistema.
 */
export function buildDepartmentCoordinationRunId(now: Date = new Date()): string {
  const iso = now.toISOString();
  return `dept-${iso.slice(0, 10)}T${iso.slice(11, 19).replace(/:/g, "")}Z`;
}
