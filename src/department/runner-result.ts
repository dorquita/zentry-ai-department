/**
 * Contrato machine-readable `RUNNER_RESULT_JSON=...` que imprime
 * `scripts/run-department-coordination.ts` al final de CADA fase --
 * mismo patron que los runners de cada empleado (ver
 * src/core/runner-result-parser.ts y los `*RunnerResultSummary` de cada
 * empleado), con la forma propia de esta capa de orquestacion.
 *
 * Estructura FIJA e IDENTICA en todas las fases: el workflow no debe
 * ramificar su logica de lectura segun la fase para saber donde esta
 * cada campo. Los campos que no aplican van a cadena vacia o 0, nunca a
 * `undefined` (todo acaba en `$GITHUB_OUTPUT`, que solo admite strings).
 *
 * Esto NO es "pasar informacion entre agentes por el log": la
 * informacion entre etapas viaja por ficheros JSON en rutas
 * deterministas (ver run-store.ts). Esta linea solo transporta RUTAS y
 * ESTADO al workflow que orquesta, exactamente igual que ya hacen todos
 * los empleados existentes.
 */

export type DepartmentRunnerPhase =
  | "init"
  | "record-stage"
  | "prepare-growth"
  | "complete-growth"
  | "prepare-qa"
  | "complete-qa"
  | "prepare-web-engineer"
  | "complete-web-engineer"
  // Bucle QA -> correccion -> re-QA sobre el PLAN (lo unico que se
  // escribe de verdad en staging, y lo unico que antes no revisaba nadie).
  | "prepare-growth-correction"
  | "prepare-plan-qa"
  | "complete-plan-qa"
  | "prepare-web-engineer-correction"
  | "brief"
  | "gate";

export const DEPARTMENT_RUNNER_PHASES: DepartmentRunnerPhase[] = [
  "init",
  "record-stage",
  "prepare-growth",
  "complete-growth",
  "prepare-qa",
  "complete-qa",
  "prepare-web-engineer",
  "complete-web-engineer",
  "prepare-growth-correction",
  "prepare-plan-qa",
  "complete-plan-qa",
  "prepare-web-engineer-correction",
  "brief",
  "gate",
];

export interface DepartmentRunnerResultSummary {
  phase: DepartmentRunnerPhase;
  departmentRunId: string;
  /** Estado de la etapa afectada (`executed`/`blocked`/...) o un estado propio de la fase (`initialized`, `prepared`, `ok`, `degraded`). */
  status: string;
  reason: string;
  runDir: string;
  manifestPath: string;
  promptFilePath: string;
  expectedOutputPath: string;
  qaInputPath: string;
  promotionPath: string;
  briefJsonPath: string;
  briefMdPath: string;
  stepSummaryPath: string;
  /** `true` si el workflow debe invocar a Claude para esta etapa. `false` = la etapa se resolvio sin gastar inferencia (degradacion explicita). */
  claudeRequired: boolean;
  promotedCount: number;
  blockedCount: number;
  departmentQaStatus: string;
  auditWarningCount: number;
  priorityCount: number;
  /** Veredicto del bucle de QA del plan: `in_progress` / `PASS` / `NEEDS_HUMAN_REVIEW`. Vacio si el bucle no corrio. */
  qaLoopStatus: string;
  /** `true` si el workflow debe ejecutar una ronda de correccion. */
  correctionRequired: boolean;
  /** Ronda que hay que ejecutar a continuacion. 0 = ninguna. */
  nextRound: number;
}

export const EMPTY_DEPARTMENT_RUNNER_RESULT: Omit<DepartmentRunnerResultSummary, "phase" | "departmentRunId" | "status" | "reason"> = {
  runDir: "",
  manifestPath: "",
  promptFilePath: "",
  expectedOutputPath: "",
  qaInputPath: "",
  promotionPath: "",
  briefJsonPath: "",
  briefMdPath: "",
  stepSummaryPath: "",
  claudeRequired: false,
  promotedCount: 0,
  blockedCount: 0,
  departmentQaStatus: "",
  auditWarningCount: 0,
  priorityCount: 0,
  qaLoopStatus: "",
  correctionRequired: false,
  nextRound: 0,
};

/**
 * TODOS los campos del contrato, en un unico sitio del que se derivan
 * los outputs de GitHub Actions.
 *
 * POR QUE ES UNA LISTA DERIVADA Y NO ESCRITA A MANO. El parser de CI
 * enumeraba los campos uno a uno, y cuando el contrato crecio con
 * `qaLoopStatus` / `correctionRequired` / `nextRound` esa lista no
 * crecio con el. Consecuencia: el departamento decidia "pide una
 * correccion", lo escribia en disco, y el workflow -- que condiciona
 * todo el bucle a `steps.qa_gate.outputs.correctionRequired == 'true'`
 * -- leia un output que NUNCA existio. El bucle entero estaba muerto sin
 * que ningun test ni ningun log lo dijera.
 *
 * Derivando la lista de `EMPTY_DEPARTMENT_RUNNER_RESULT`, que el
 * compilador ya obliga a estar completo, un campo nuevo del contrato
 * aparece como output solo.
 */
export const DEPARTMENT_RUNNER_RESULT_FIELDS: readonly (keyof DepartmentRunnerResultSummary)[] = [
  "phase",
  "departmentRunId",
  "status",
  "reason",
  ...(Object.keys(EMPTY_DEPARTMENT_RUNNER_RESULT) as (keyof DepartmentRunnerResultSummary)[]),
];

export function extractLastDepartmentRunnerResultJsonLine(log: string): string | undefined {
  const matches = [...log.matchAll(/^RUNNER_RESULT_JSON=(.*)$/gm)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1];
}

const STRING_FIELDS = [
  "phase",
  "departmentRunId",
  "status",
  "reason",
  "runDir",
  "manifestPath",
  "promptFilePath",
  "expectedOutputPath",
  "qaInputPath",
  "promotionPath",
  "briefJsonPath",
  "briefMdPath",
  "stepSummaryPath",
  "departmentQaStatus",
  "qaLoopStatus",
] as const;

const NUMBER_FIELDS = ["promotedCount", "blockedCount", "auditWarningCount", "priorityCount", "nextRound"] as const;

/** Valida (fail-closed, sin librerias externas) que el JSON parseado tiene la forma minima esperada antes de confiar en sus campos. */
export function parseDepartmentRunnerResultJson(jsonText: string): DepartmentRunnerResultSummary {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`RUNNER_RESULT_JSON no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("RUNNER_RESULT_JSON invalido: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;
  for (const field of STRING_FIELDS) {
    if (typeof o[field] !== "string") {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo string "${field}".`);
    }
  }
  for (const field of NUMBER_FIELDS) {
    if (typeof o[field] !== "number") {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo numerico "${field}".`);
    }
  }
  for (const field of ["claudeRequired", "correctionRequired"] as const) {
    if (typeof o[field] !== "boolean") {
      throw new Error(`RUNNER_RESULT_JSON invalido: falta el campo booleano "${field}".`);
    }
  }
  if (!(DEPARTMENT_RUNNER_PHASES as string[]).includes(o.phase as string)) {
    throw new Error(`RUNNER_RESULT_JSON invalido: phase "${String(o.phase)}" no es una fase conocida.`);
  }
  return o as unknown as DepartmentRunnerResultSummary;
}

export function extractAndParseDepartmentRunnerResult(log: string): DepartmentRunnerResultSummary {
  const jsonText = extractLastDepartmentRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  return parseDepartmentRunnerResultJson(jsonText);
}
