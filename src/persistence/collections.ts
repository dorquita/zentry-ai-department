/**
 * Fase O56 — las colecciones del departamento y sus indices.
 *
 * POR QUE CINCO COLECCIONES Y NO VEINTINUEVE (una por cada `.jsonl`):
 *
 * El inventario del estado actual encontro 29 ficheros en `data/`, pero
 * NO 29 comportamientos distintos. Hay exactamente cuatro:
 *
 *   1. La pasada.            -> `department_runs`
 *   2. Entidades con estado  -> `department_entities`
 *      actual (backlog, change packs, work orders, aprobaciones,
 *      ejecuciones...). Todas comparten literalmente la misma semantica:
 *      JSONL append-only donde la ULTIMA linea con ese id es el estado
 *      vigente, con `createdAt`/`updatedAt` y un `status`. Esa identidad
 *      de comportamiento es la razon arquitectonica para unificarlas
 *      bajo un discriminante `kind`: un unico camino de escritura
 *      idempotente y un unico indice unico, en vez de veinte copias del
 *      mismo codigo que se desincronizan.
 *   3. Historico inmutable   -> `department_events`
 *      (eventos, auditorias, jobs, logs diarios). Se escribe una vez y
 *      no se modifica jamas.
 *   4. Decision humana       -> `human_decisions`
 *      Es historico inmutable, pero tiene coleccion propia A PROPOSITO:
 *      es el dato cuya perdida motiva esta fase entera, el unico que no
 *      se puede reconstruir de ninguna forma, y el que los agentes
 *      consultan. Mezclarlo con los 13.500 eventos de rutina seria
 *      enterrarlo.
 *
 * Y una quinta, `state_migrations`, que no es estado del departamento
 * sino la bitacora de la propia migracion (cuantos registros, en que
 * modo, que colisiones). Sirve para demostrar idempotencia.
 *
 * NUNCA se consulta `department_entities` sin `kind`: el indice unico es
 * compuesto y todas las lecturas lo llevan por delante.
 */

export const RUNS_COLLECTION = "department_runs";
export const ENTITIES_COLLECTION = "department_entities";
export const EVENTS_COLLECTION = "department_events";
export const DECISIONS_COLLECTION = "human_decisions";
export const MIGRATIONS_COLLECTION = "state_migrations";

export interface IndexSpec {
  /** Campos del indice, en orden. */
  readonly fields: readonly string[];
  readonly unique: boolean;
  /** Por que existe este indice. Se documenta aqui, no en un wiki aparte. */
  readonly reason: string;
}

export interface CollectionSpec {
  readonly name: string;
  readonly purpose: string;
  readonly indexes: readonly IndexSpec[];
}

/**
 * Declaracion unica de los indices. `ensureIndexes()` la aplica y la
 * documentacion se genera a partir de aqui, para que no puedan divergir.
 *
 * Toda invariante de unicidad tiene un indice unico: es lo que convierte
 * "intentamos no duplicar" en "la base de datos no permite duplicar".
 */
export const COLLECTION_SPECS: readonly CollectionSpec[] = [
  {
    name: RUNS_COLLECTION,
    purpose: "Una pasada del departamento. Ciclo de vida y contadores de persistencia.",
    indexes: [
      {
        fields: ["departmentRunId"],
        unique: true,
        reason:
          "Reejecutar la misma pasada (rerun de GitHub Actions) no puede crear un segundo run. " +
          "Es la clave de la idempotencia del orquestador.",
      },
      {
        fields: ["startedAt"],
        unique: false,
        reason: "Encontrar la pasada anterior sin depender del orden lexicografico de un directorio.",
      },
    ],
  },
  {
    name: ENTITIES_COLLECTION,
    purpose: "Estado ACTUAL de cada entidad del pipeline (backlog, work orders, change packs, aprobaciones...).",
    indexes: [
      {
        fields: ["kind", "entityId"],
        unique: true,
        reason:
          "La identidad real de una entidad es su tipo mas su id. `assetRequestId` existe en DOS stores " +
          "distintos (asset-requests y product-asset-requests) con espacios de ids independientes: sin " +
          "`kind` en la clave se pisarian entre ellos.",
      },
      {
        fields: ["kind", "status"],
        unique: false,
        reason: "Consulta mas frecuente del departamento: que hay pendiente de un tipo dado.",
      },
      {
        fields: ["departmentRunId"],
        unique: false,
        reason: "Reconstruir que produjo una pasada concreta.",
      },
    ],
  },
  {
    name: EVENTS_COLLECTION,
    purpose: "Historico append-only: eventos del bus, auditorias de estado, jobs y logs diarios.",
    indexes: [
      {
        fields: ["kind", "eventId"],
        unique: true,
        reason:
          "Un evento se escribe una sola vez. Si el job se cancela despues de escribir y se relanza, " +
          "el mismo eventId no crea una segunda linea.",
      },
      {
        fields: ["departmentRunId", "occurredAt"],
        unique: false,
        reason: "Leer el historico de una pasada en orden, que es como lo consumen los agentes.",
      },
    ],
  },
  {
    name: DECISIONS_COLLECTION,
    purpose: "Decisiones humanas. Estado autoritativo irreemplazable: se escribe una vez y no se toca nunca mas.",
    indexes: [
      {
        fields: ["decisionKey"],
        unique: true,
        reason:
          "IDEMPOTENCIA REAL. `decisionId` lleva el timestamp con milisegundos, asi que reejecutar la " +
          "sesion de aprobacion generaba un id distinto para la MISMA decision y la duplicaba. " +
          "`decisionKey` es determinista (run + recomendacion + accion + motivo + destino + autor), " +
          "asi que el reintento choca contra este indice y no duplica.",
      },
      {
        fields: ["recommendationId"],
        unique: false,
        reason: "Recuperar el historial de una recomendacion concreta.",
      },
      {
        fields: ["subjectKey"],
        unique: false,
        reason:
          "`recommendationId` lleva el departmentRunId dentro, asi que NUNCA se repite entre pasadas. " +
          "`subjectKey` (titulo normalizado) es lo que permite emparejar la decision de ayer con la " +
          "propuesta equivalente de hoy.",
      },
      {
        fields: ["departmentRunId"],
        unique: false,
        reason: "Auditar que se decidio en una pasada.",
      },
    ],
  },
  {
    name: MIGRATIONS_COLLECTION,
    purpose: "Bitacora de las ejecuciones de la herramienta de migracion. No es estado del departamento.",
    indexes: [
      {
        fields: ["migrationRunId"],
        unique: true,
        reason: "Una ejecucion de migracion se registra una sola vez.",
      },
    ],
  },
];

export function findCollectionSpec(name: string): CollectionSpec {
  const spec = COLLECTION_SPECS.find((c) => c.name === name);
  if (!spec) throw new Error(`Coleccion desconocida: ${name}`);
  return spec;
}

/** Nombre canonico del indice, igual que lo generaria MongoDB. */
export function indexName(spec: IndexSpec): string {
  return spec.fields.map((f) => `${f}_1`).join("_");
}
