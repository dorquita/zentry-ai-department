import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "../core/client-paths";
import { extractJsonFromModelResponse } from "../core/claude-employee-runtime";
import { DepartmentEmployeeRun, parseEmployeeRunRecord } from "./employee-runs";
import {
  assertSupportedContractVersion,
  DEPARTMENT_RUN_CONTRACT_VERSION,
  DEPARTMENT_STAGE_NAMES,
  DEPARTMENT_STAGE_PHASE,
  DepartmentRunManifest,
  DepartmentStageName,
  DepartmentStageRecord,
  DepartmentStageStatus,
  isDepartmentStageName,
  isDepartmentStageStatus,
} from "./types";

/**
 * Almacen de UNA pasada coordinada del departamento: rutas
 * deterministas + manifiesto versionado.
 *
 * Regla central de esta fase (ver docs/department-coordination.md): la
 * informacion pasa de una etapa a la siguiente por FICHEROS JSON en
 * rutas deterministas dentro de `reports/department/<departmentRunId>/`,
 * nunca por scraping de logs y nunca buscando "el ultimo artifact" de
 * una ejecucion historica ambigua. Cada etapa escribe donde este modulo
 * dice, y la siguiente lee de donde este modulo dice.
 *
 * Este modulo NO invoca a Claude, NO valida contenido de dominio (eso lo
 * siguen haciendo los validadores de cada empleado, sin relajarse) y NO
 * escribe en ningun sistema externo.
 */

const PROJECT_ROOT = path.join(__dirname, "..", "..");

export const DEPARTMENT_RUN_NOTE =
  "Pasada coordinada de solo lectura/propuesta (READ / ANALYZE / PROPOSE). Ningun empleado de esta pasada aplica nada: no se ha escrito en WordPress, staging, produccion, Google Ads, GA4/GTM, Search Console, n8n ni email, y nada se ha commiteado en el repositorio. Toda accion propuesta requiere aprobacion humana explicita.";

export interface DepartmentRunPaths {
  departmentRunId: string;
  /** Directorio raiz del run, absoluto. */
  runDir: string;
  manifestPath: string;
  promotionPath: string;
  briefJsonPath: string;
  briefMdPath: string;
  stepSummaryPath: string;
  qaInputPath: string;
  /** Contrato de APPLY de esta pasada: un elemento por recomendacion, con su estado, aprobacion, validacion y rollback. */
  applySummaryPath: string;
  /** Email del Daily Brief realmente construido en esta pasada (texto + HTML), para poder auditarlo despues. */
  emailPath: string;
}

/** Convierte una ruta absoluta a repo-relativa (o la deja tal cual si cae fuera del repo, caso que no deberia darse dentro de un run). */
export function toRepoRelative(absolutePath: string): string {
  const relative = path.relative(PROJECT_ROOT, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return absolutePath;
  return relative.split(path.sep).join("/");
}

/** Resuelve una ruta repo-relativa (tal como se guarda en el manifiesto) a ruta absoluta en disco. */
export function fromRepoRelative(relativePath: string): string {
  return path.isAbsolute(relativePath) ? relativePath : path.join(PROJECT_ROOT, relativePath);
}

export function resolveDepartmentRunPaths(departmentRunId: string): DepartmentRunPaths {
  const runDir = path.join(resolveActiveClientPaths().reportsDir, "department", departmentRunId);
  return {
    departmentRunId,
    runDir,
    manifestPath: path.join(runDir, "manifest.json"),
    promotionPath: path.join(runDir, "promotion.json"),
    briefJsonPath: path.join(runDir, "department-daily-brief.json"),
    briefMdPath: path.join(runDir, "department-daily-brief.md"),
    stepSummaryPath: path.join(runDir, "step-summary.md"),
    // El nombre del fichero incluye el departmentRunId a proposito:
    // qa-reviewer deriva su `artifactId` del basename del fichero que
    // revisa (ver inferArtifactIdentity en
    // src/employees/qa-reviewer/context.ts), asi que asi la identidad
    // del artifact revisado queda atada a ESTA pasada y no a un nombre
    // generico reutilizado en todas.
    qaInputPath: path.join(runDir, `${departmentRunId}-qa-input.json`),
    applySummaryPath: path.join(runDir, "apply-summary.json"),
    emailPath: path.join(runDir, "daily-brief-email.json"),
  };
}

export function resolveStageDir(departmentRunId: string, stage: DepartmentStageName): string {
  return path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "stages", stage);
}

export interface StageFilePaths {
  stageDir: string;
  contextPath: string;
  promptPath: string;
  outputPath: string;
  artifactPath: string;
  /**
   * Metricas de LA invocacion de Claude de esta etapa (empleado, modelo,
   * duracion, coste, turnos, origen de salida, resultado), escritas por
   * el runtime comun via su input opcional `execution-record-path`. Una
   * ruta POR ETAPA a proposito: el `execution_file` de
   * claude-code-action no es unico por invocacion, asi que con seis
   * empleados en el mismo job solo sobrevivia el ultimo.
   */
  executionRecordPath: string;
}

export function resolveStageFilePaths(departmentRunId: string, stage: DepartmentStageName): StageFilePaths {
  const stageDir = resolveStageDir(departmentRunId, stage);
  return {
    stageDir,
    contextPath: path.join(stageDir, "context.json"),
    promptPath: path.join(stageDir, "prompt.md"),
    outputPath: path.join(stageDir, "output.json"),
    artifactPath: path.join(stageDir, "artifact.json"),
    executionRecordPath: path.join(stageDir, "claude-execution.json"),
  };
}

/**
 * Lee las metricas de las invocaciones de Claude de ESTA pasada, una por
 * etapa. Una etapa sin fichero simplemente no aparece: nunca se sustituye
 * por un coste 0 (ver src/department/employee-runs.ts).
 */
export function readDepartmentEmployeeRuns(departmentRunId: string): DepartmentEmployeeRun[] {
  const runs: DepartmentEmployeeRun[] = [];
  for (const stage of DEPARTMENT_STAGE_NAMES) {
    const { executionRecordPath } = resolveStageFilePaths(departmentRunId, stage);
    if (!fs.existsSync(executionRecordPath)) continue;
    let rawText: string;
    try {
      rawText = fs.readFileSync(executionRecordPath, "utf-8");
    } catch {
      continue;
    }
    const run = parseEmployeeRunRecord(rawText, stage);
    if (run) runs.push(run);
  }
  return runs;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export function readManifest(departmentRunId: string): DepartmentRunManifest {
  const { manifestPath } = resolveDepartmentRunPaths(departmentRunId);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No existe el manifiesto del department run "${departmentRunId}" (${toRepoRelative(manifestPath)}). Ejecuta antes la fase "init".`);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`manifest.json del run "${departmentRunId}" invalido: se esperaba un objeto JSON.`);
  }
  const manifest = raw as DepartmentRunManifest;
  assertSupportedContractVersion(manifest.contractVersion, `manifest.json (${departmentRunId})`);
  if (manifest.departmentRunId !== departmentRunId) {
    throw new Error(
      `manifest.json incoherente: contiene departmentRunId "${manifest.departmentRunId}" pero se leyo desde el directorio del run "${departmentRunId}". Fail-closed -- no se mezcla informacion de dos pasadas distintas.`
    );
  }
  if (!Array.isArray(manifest.stages) || !manifest.stages.every((s) => isDepartmentStageName(s.stage) && isDepartmentStageStatus(s.status))) {
    throw new Error(`manifest.json del run "${departmentRunId}" invalido: stages[] debe tener stage/status validos.`);
  }
  return manifest;
}

/**
 * Crea el directorio del run y su manifiesto. Idempotente solo en el
 * sentido de que falla explicitamente si ya existe -- una pasada
 * coordinada nunca debe reescribir por accidente el manifiesto de otra.
 */
export function initDepartmentRun(departmentRunId: string, now: Date = new Date()): DepartmentRunManifest {
  const paths = resolveDepartmentRunPaths(departmentRunId);
  if (fs.existsSync(paths.manifestPath)) {
    throw new Error(`Ya existe un manifiesto para el department run "${departmentRunId}" (${toRepoRelative(paths.manifestPath)}). No se sobrescribe.`);
  }
  const manifest: DepartmentRunManifest = {
    contractVersion: DEPARTMENT_RUN_CONTRACT_VERSION,
    departmentRunId,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    note: DEPARTMENT_RUN_NOTE,
    stages: [],
  };
  fs.mkdirSync(paths.runDir, { recursive: true });
  writeJson(paths.manifestPath, manifest);
  return manifest;
}

export interface RecordStageInput {
  departmentRunId: string;
  stage: DepartmentStageName;
  status: DepartmentStageStatus;
  reason: string;
  /** Ruta (absoluta o relativa al cwd) del fichero de salida ya validado del empleado -- se COPIA dentro del run. */
  sourceOutputPath?: string;
  /** Ruta del artifact propio del empleado (artifact.json / review.json) -- se COPIA dentro del run. */
  sourceArtifactPath?: string;
  sourceRunId?: string | null;
  auditWarningCount?: number | null;
  now?: Date;
}

/**
 * Registra (o re-registra) una etapa en el manifiesto, copiando sus
 * ficheros dentro del run para que la siguiente fase los lea de una ruta
 * determinista. Copiar (en vez de referenciar la ruta original del
 * empleado) es deliberado: el artifact del departamento debe ser
 * autocontenido y seguir siendo legible aunque el directorio propio del
 * empleado se limpie o se pierda.
 */
export function recordStage(input: RecordStageInput): DepartmentStageRecord {
  const manifest = readManifest(input.departmentRunId);
  const now = input.now ?? new Date();
  const stagePaths = resolveStageFilePaths(input.departmentRunId, input.stage);
  fs.mkdirSync(stagePaths.stageDir, { recursive: true });

  let outputPath: string | null = null;
  if (input.sourceOutputPath) {
    const source = path.resolve(input.sourceOutputPath);
    if (!fs.existsSync(source)) {
      throw new Error(`recordStage(${input.stage}): el fichero de salida indicado no existe: ${source}`);
    }
    if (path.resolve(stagePaths.outputPath) !== source) {
      fs.copyFileSync(source, stagePaths.outputPath);
    }
    outputPath = toRepoRelative(stagePaths.outputPath);
  } else if (fs.existsSync(stagePaths.outputPath)) {
    // La etapa ya escribio su salida directamente en la ruta canonica
    // (caso de growth/web-engineer, cuyo prompt y salida los prepara
    // esta misma capa) -- se registra igual, sin copiar nada.
    outputPath = toRepoRelative(stagePaths.outputPath);
  }

  let artifactPath: string | null = null;
  if (input.sourceArtifactPath) {
    const source = path.resolve(input.sourceArtifactPath);
    if (!fs.existsSync(source)) {
      throw new Error(`recordStage(${input.stage}): el artifact indicado no existe: ${source}`);
    }
    if (path.resolve(stagePaths.artifactPath) !== source) {
      fs.copyFileSync(source, stagePaths.artifactPath);
    }
    artifactPath = toRepoRelative(stagePaths.artifactPath);
  } else if (fs.existsSync(stagePaths.artifactPath)) {
    artifactPath = toRepoRelative(stagePaths.artifactPath);
  }

  const record: DepartmentStageRecord = {
    stage: input.stage,
    phase: DEPARTMENT_STAGE_PHASE[input.stage],
    status: input.status,
    reason: input.reason,
    outputPath,
    artifactPath,
    sourceRunId: input.sourceRunId ?? null,
    auditWarningCount: input.auditWarningCount ?? null,
    recordedAt: now.toISOString(),
  };

  const stages = manifest.stages.filter((s) => s.stage !== input.stage);
  stages.push(record);
  const updated: DepartmentRunManifest = { ...manifest, updatedAt: now.toISOString(), stages };
  writeJson(resolveDepartmentRunPaths(input.departmentRunId).manifestPath, updated);
  return record;
}

export function findStageRecord(manifest: DepartmentRunManifest, stage: DepartmentStageName): DepartmentStageRecord | undefined {
  return manifest.stages.find((s) => s.stage === stage);
}

/**
 * Parsea el TEXTO de la salida de una etapa. Funcion pura (sin I/O) para
 * poder testearla directamente.
 *
 * Tolerante a fences de markdown (```json ... ```) por la misma razon
 * que todos los runners de empleado de este repositorio: el runtime
 * comun escribe en `expected-output-path` el texto que devolvio Claude
 * TAL CUAL, sin reinterpretarlo, y ese texto puede venir envuelto en
 * fences aunque las instrucciones del agente pidan no hacerlo. Usar
 * `JSON.parse` directo aqui rompia la lectura de una salida por lo demas
 * perfectamente valida (fallo real observado en el primer E2E
 * coordinado, run 31892955242).
 *
 * Devuelve `undefined` (nunca lanza) si el texto no es recuperable: quien
 * llama lo registra como degradacion explicita (`invalid_output`), que es
 * justo el comportamiento fail-closed de este sistema -- pero no tumba la
 * fase entera por un fichero roto.
 */
export function parseStageOutputText(text: string, label: string): unknown | undefined {
  try {
    return extractJsonFromModelResponse(text);
  } catch (err) {
    console.error(`[department] La salida registrada de ${label} no es JSON recuperable (${err instanceof Error ? err.message : String(err)}). Se trata como ausente, no se reinterpreta.`);
    return undefined;
  }
}

/**
 * Lee la salida ya validada de una etapa desde su ruta determinista.
 * Devuelve `undefined` si esa etapa no llego a producir salida (no
 * lanza): "no hay salida" es un estado NORMAL y explicito de este
 * sistema, no un error -- quien la consuma debe decidir que hacer
 * sabiendo que no existe, nunca rellenarla.
 */
export function readStageOutput(manifest: DepartmentRunManifest, stage: DepartmentStageName): unknown | undefined {
  const record = findStageRecord(manifest, stage);
  if (!record || record.status !== "executed" || !record.outputPath) return undefined;
  const absolute = fromRepoRelative(record.outputPath);
  if (!fs.existsSync(absolute)) return undefined;
  return parseStageOutputText(fs.readFileSync(absolute, "utf-8"), `${stage} (${record.outputPath})`);
}

export function writeStageContext(departmentRunId: string, stage: DepartmentStageName, context: unknown): string {
  const { contextPath } = resolveStageFilePaths(departmentRunId, stage);
  writeJson(contextPath, context);
  return contextPath;
}

export function writeStagePrompt(departmentRunId: string, stage: DepartmentStageName, prompt: string): string {
  const { promptPath, stageDir } = resolveStageFilePaths(departmentRunId, stage);
  fs.mkdirSync(stageDir, { recursive: true });
  fs.writeFileSync(promptPath, prompt, "utf-8");
  return promptPath;
}

/**
 * Busca la pasada coordinada ANTERIOR (la mas reciente cuyo id sea menor
 * que el actual) que ya tenga daily brief escrito en este checkout. Sirve
 * unicamente para la seccion "que ha cambiado" del brief: si no hay
 * ninguna, el brief lo dice explicitamente en vez de inventar una
 * comparativa. El orden lexicografico es valido porque
 * `buildDepartmentCoordinationRunId()` genera ids con fecha ISO de ancho
 * fijo (`dept-YYYY-MM-DDTHHMMSSZ`).
 */
export function findPreviousDepartmentRunBriefPath(currentDepartmentRunId: string): string | undefined {
  const departmentRoot = path.join(resolveActiveClientPaths().reportsDir, "department");
  if (!fs.existsSync(departmentRoot)) return undefined;
  const candidates = fs
    .readdirSync(departmentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < currentDepartmentRunId)
    .map((entry) => path.join(departmentRoot, entry.name, "department-daily-brief.json"))
    .filter((briefPath) => fs.existsSync(briefPath))
    .sort();
  return candidates.length > 0 ? candidates[candidates.length - 1] : undefined;
}

export { writeJson as writeDepartmentJson };
