/**
 * Fase O50 — frescura y procedencia de los snapshots que alimentan a los
 * especialistas Claude.
 *
 * POR QUE EXISTE (hallazgo real de la auditoria de dependencias
 * externas, ver docs/external-dependencies-audit.md): la pasada diaria
 * de GitHub Actions NO leia Google en vivo. Leia
 * `data/department-events.jsonl`, `data/jobs.jsonl` y
 * `reports/analytics/*.md` tal y como estaban COMMITEADOS en el
 * repositorio, y esos ficheros los generaba el VPS legacy. Como ningun
 * paso comprobaba la antigüedad del snapshot, cada pasada presentaba a
 * los especialistas datos de hace dias exactamente igual que si fueran
 * de esta manana — sin una sola senal de que no lo eran.
 *
 * Este modulo es logica PURA (sin I/O, sin red, sin relojes ocultos:
 * `now` siempre se inyecta) que responde tres preguntas separadas y no
 * intercambiables:
 *
 *   1. ¿CUANDO se leyo la fuente externa de verdad? (`sourceGeneratedAt`)
 *   2. ¿Se leyo en ESTA pasada, o viene de otra anterior? (procedencia)
 *   3. ¿Es lo bastante reciente para presentarlo como estado actual?
 *
 * Nunca hay un cuarto camino silencioso: un snapshot que no supera el
 * umbral se marca `stale` y se dice, no se maquilla.
 */

export type SnapshotFreshnessStatus =
  /** Generado en ESTA misma pasada: el especialista razona sobre una lectura live de esta ejecucion. */
  | "live_this_run"
  /** De una pasada anterior, pero dentro del umbral de antigüedad aceptable. */
  | "fresh"
  /** Mas viejo que el umbral: NO puede presentarse como estado actual. */
  | "stale"
  /** Sin marca de tiempo utilizable: la procedencia no se puede demostrar, asi que se trata como no fiable. */
  | "unknown";

/**
 * 26 horas: la cadencia real del departamento es diaria (cron 07:00 UTC
 * en Actions, timer 08:00 UTC en el VPS), asi que 24h justas marcarian
 * como `stale` un snapshot de la pasada de ayer por unos minutos de
 * desplazamiento. 26h da margen para el retraso conocido de los
 * `schedule` de GitHub Actions sin llegar a aceptar un snapshot de
 * anteayer.
 */
export const DEFAULT_SNAPSHOT_MAX_AGE_HOURS = 26;

export interface SnapshotFreshnessInput {
  /** ISO 8601 del momento en que se leyo la FUENTE EXTERNA (no cuando se leyo el fichero). */
  sourceGeneratedAt: string | null | undefined;
  /** ISO 8601 del ahora, siempre inyectado — esta funcion no mira el reloj por su cuenta. */
  now: string;
  maxAgeHours?: number;
  /** departmentRunId de la pasada EN CURSO, si se conoce. */
  currentDepartmentRunId?: string | null;
  /** departmentRunId que quedo grabado EN el snapshot. */
  snapshotDepartmentRunId?: string | null;
}

export interface SnapshotFreshness {
  status: SnapshotFreshnessStatus;
  /** Antigüedad en horas, redondeada a 1 decimal. `null` si no hay marca de tiempo utilizable. */
  ageHours: number | null;
  maxAgeHours: number;
  sourceGeneratedAt: string | null;
  /** true SOLO si el snapshot lleva el departmentRunId de la pasada en curso. */
  producedInThisRun: boolean;
  /** Frase lista para incrustar en el prompt del especialista, en su idioma. */
  humanSummary: string;
}

function parseIso(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function roundHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/**
 * Clasifica un snapshot. NUNCA lanza: una marca de tiempo ausente o
 * ilegible produce `unknown`, que aguas arriba se trata igual de mal que
 * `stale` — lo que no se puede demostrar no se presenta como actual.
 */
export function classifySnapshotFreshness(input: SnapshotFreshnessInput): SnapshotFreshness {
  const maxAgeHours = input.maxAgeHours ?? DEFAULT_SNAPSHOT_MAX_AGE_HOURS;
  const generatedMs = parseIso(input.sourceGeneratedAt);
  const nowMs = parseIso(input.now);
  const sourceGeneratedAt = generatedMs !== null ? (input.sourceGeneratedAt as string) : null;

  const producedInThisRun = Boolean(
    input.currentDepartmentRunId &&
      input.snapshotDepartmentRunId &&
      input.currentDepartmentRunId === input.snapshotDepartmentRunId
  );

  if (generatedMs === null || nowMs === null) {
    return {
      status: "unknown",
      ageHours: null,
      maxAgeHours,
      sourceGeneratedAt,
      producedInThisRun,
      humanSummary:
        "PROCEDENCIA NO DEMOSTRABLE: este snapshot no trae una marca de tiempo utilizable, asi que no se puede afirmar de cuando son los datos. Trata cualquier cifra de aqui como historica, nunca como el estado actual.",
    };
  }

  // Un snapshot con fecha futura (reloj desincronizado entre el VPS y el
  // runner) se trata como antigüedad 0, no como un numero negativo que
  // pasaria cualquier umbral por accidente.
  const ageHours = roundHours(Math.max(0, nowMs - generatedMs));

  if (producedInThisRun) {
    return {
      status: "live_this_run",
      ageHours,
      maxAgeHours,
      sourceGeneratedAt,
      producedInThisRun,
      humanSummary: `DATOS LIVE DE ESTA PASADA: la fuente externa se leyo en esta misma ejecucion (${sourceGeneratedAt}, hace ${ageHours} h). Puedes hablar de estos datos como el estado actual.`,
    };
  }

  if (ageHours > maxAgeHours) {
    return {
      status: "stale",
      ageHours,
      maxAgeHours,
      sourceGeneratedAt,
      producedInThisRun,
      humanSummary: `DATOS ANTIGUOS (${ageHours} h, umbral ${maxAgeHours} h): la fuente externa se leyo por ultima vez el ${sourceGeneratedAt}, NO en esta pasada. NO presentes estas cifras como el estado actual; di explicitamente de que fecha son y que puede haber cambiado desde entonces.`,
    };
  }

  return {
    status: "fresh",
    ageHours,
    maxAgeHours,
    sourceGeneratedAt,
    producedInThisRun,
    humanSummary: `DATOS RECIENTES PERO NO DE ESTA PASADA (${ageHours} h, umbral ${maxAgeHours} h): la fuente externa se leyo el ${sourceGeneratedAt}. Son utilizables, pero cita siempre esa fecha en vez de dar a entender que son de hoy.`,
  };
}

/** `true` solo para `live_this_run` — el unico estado que permite decir "ahora mismo". */
export function isLiveThisRun(freshness: SnapshotFreshness): boolean {
  return freshness.status === "live_this_run";
}

/** `true` para `stale` y `unknown`: lo que no se puede presentar como estado actual. */
export function isStaleOrUnknown(freshness: SnapshotFreshness): boolean {
  return freshness.status === "stale" || freshness.status === "unknown";
}

/**
 * Umbral configurable por entorno (`SNAPSHOT_MAX_AGE_HOURS`). Un valor
 * no numerico o <= 0 es un error explicito, no una caida silenciosa al
 * valor por defecto: si alguien intenta configurar el umbral y se
 * equivoca, tiene que enterarse.
 */
export function resolveSnapshotMaxAgeHours(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = (env.SNAPSHOT_MAX_AGE_HOURS ?? "").trim();
  if (raw.length === 0) return DEFAULT_SNAPSHOT_MAX_AGE_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `SNAPSHOT_MAX_AGE_HOURS invalido: "${raw}". Debe ser un numero de horas positivo (por defecto ${DEFAULT_SNAPSHOT_MAX_AGE_HOURS}).`
    );
  }
  return parsed;
}

/**
 * Modo fail-closed. Con `REQUIRE_LIVE_SOURCES=true`, un snapshot que no
 * sea de esta pasada hace fallar la etapa de forma explicita en vez de
 * dejar que un especialista razone sobre historico. Por defecto esta
 * DESACTIVADO: la migracion a lectura live desde Actions se activa
 * fuente a fuente, y hasta que una fuente este migrada su snapshot sigue
 * siendo utilizable — pero siempre etiquetado, nunca disfrazado.
 */
export function resolveRequireLiveSources(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env.REQUIRE_LIVE_SOURCES ?? "").trim().toLowerCase() === "true";
}

/**
 * Lanza si el snapshot no puede usarse bajo la politica activa. El
 * mensaje dice SIEMPRE que fuente es, de cuando son los datos y como
 * arreglarlo — nunca un fallo generico.
 */
export function assertSnapshotUsable(
  sourceLabel: string,
  freshness: SnapshotFreshness,
  options: { requireLive?: boolean } = {}
): void {
  const requireLive = options.requireLive ?? false;
  if (requireLive && !isLiveThisRun(freshness)) {
    throw new Error(
      `REQUIRE_LIVE_SOURCES=true pero el snapshot de ${sourceLabel} no se genero en esta pasada (estado: ${freshness.status}${
        freshness.ageHours !== null ? `, ${freshness.ageHours} h de antigüedad` : ""
      }). Fail-closed: no se razona sobre datos historicos presentados como actuales. Ejecuta el watcher correspondiente en esta misma pasada, o desactiva REQUIRE_LIVE_SOURCES si aceptas trabajar con el ultimo snapshot conocido.`
    );
  }
}
