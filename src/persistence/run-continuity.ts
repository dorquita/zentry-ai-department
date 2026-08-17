/**
 * Fase O57 — continuidad ENTRE PASADAS sin depender de `reports/`.
 *
 * El Daily Brief tiene una seccion "que ha cambiado desde la pasada
 * anterior". Hasta ahora ese dato salia de leer el JSON del brief de la
 * pasada anterior en `reports/department/<runId>/`, lo que ataba la
 * continuidad a restaurar la rama `department-state` en cada runner.
 *
 * `reports/` es un ARTIFACT (clase D): no es estado autoritativo y no se
 * migra a MongoDB. Pero el resumen de una pasada SI es estado de la
 * pasada, y la coleccion de pasadas ya existe. Guardarlo ahi no amplia
 * el dominio: lo coloca donde le corresponde, y de paso quita el ultimo
 * motivo por el que la pasada de manana necesitaba los ficheros de hoy.
 *
 * FALLA CERRADO en modo `mongo`, igual que el resto: si MongoDB no
 * responde no se cae al fichero en silencio.
 */
import { DepartmentStateRepository } from "./repositories";
import { PersistenceMode, openPersistenceSession, resolvePersistenceMode } from "./runtime";

/** Lo minimo que la pasada siguiente necesita saber de la anterior. */
export interface RunBriefSummary {
  departmentRunId: string;
  priorityCount: number;
  departmentQaStatus: string;
  executedStages: number;
}

/** "dept-..." es la pasada coordinada; "growth-department-..." es la v1. */
export function resolveRunKind(departmentRunId: string): string {
  if (departmentRunId.startsWith("growth-department-")) return "growth-v1";
  if (departmentRunId.startsWith("dept-")) return "coordinated";
  return "otro";
}

function toSummary(raw: unknown): RunBriefSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.departmentRunId !== "string") return null;
  return {
    departmentRunId: record.departmentRunId,
    priorityCount: typeof record.priorityCount === "number" ? record.priorityCount : 0,
    departmentQaStatus:
      typeof record.departmentQaStatus === "string" ? record.departmentQaStatus : "unknown",
    executedStages: typeof record.executedStages === "number" ? record.executedStages : 0,
  };
}

export interface RunContinuityOptions {
  env?: NodeJS.ProcessEnv;
  mode?: PersistenceMode;
  /** Repositorio ya abierto. Cuando se pasa, no se abre ni se cierra sesion. */
  repository?: DepartmentStateRepository;
}

/**
 * Ejecuta `fn` con un repositorio, abriendo sesion solo si hace falta.
 * Devuelve `null` cuando el modo no es `mongo`: quien llama decide que
 * hacer con el camino legacy, aqui no se adivina.
 */
async function withRepository<T>(
  options: RunContinuityOptions,
  fn: (repository: DepartmentStateRepository) => Promise<T>
): Promise<T | null> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? resolvePersistenceMode(env);
  if (mode !== "mongo") return null;
  if (options.repository) return fn(options.repository);

  const session = await openPersistenceSession({ env, mode });
  if (!session.repository) {
    throw new Error(
      "MongoDB es la fuente de verdad y no hay repositorio para leer la continuidad entre pasadas."
    );
  }
  try {
    return await fn(session.repository);
  } finally {
    await session.repository.close();
  }
}

/**
 * Resumen de la pasada ANTERIOR a `departmentRunId`, desde MongoDB.
 *
 * Una sola consulta a `department_runs` (coleccion pequena, una entrada
 * por pasada), no un recorrido del historico de eventos.
 *
 * Devuelve `null` si el modo no es `mongo` (quien llama usa el camino de
 * fichero) o si no hay ninguna pasada anterior con resumen — que es el
 * arranque en frio legitimo, no un fallo.
 */
export async function loadPreviousRunSummaryFromState(
  departmentRunId: string,
  options: RunContinuityOptions = {}
): Promise<RunBriefSummary | null> {
  const found = await withRepository(options, async (repository) => {
    const previous = await repository.runs.findPreviousRun(departmentRunId);
    return previous ? toSummary(previous.briefSummary) : null;
  });
  return found ?? null;
}

/**
 * Guarda el resumen de ESTA pasada para que la siguiente lo lea.
 *
 * No-op fuera del modo `mongo`: en shadow/legacy la continuidad sigue
 * saliendo de `reports/`, y escribir aqui daria una falsa sensacion de
 * que ya no hace falta.
 */
export async function recordRunBriefSummary(
  summary: RunBriefSummary,
  at: string,
  options: RunContinuityOptions = {}
): Promise<boolean> {
  const written = await withRepository(options, async (repository) => {
    await repository.runs.recordBriefSummary({
      departmentRunId: summary.departmentRunId,
      runKind: resolveRunKind(summary.departmentRunId),
      briefSummary: { ...summary },
      at,
    });
    return true;
  });
  return written === true;
}
