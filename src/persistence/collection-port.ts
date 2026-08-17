/**
 * Fase O56 — el PUERTO de persistencia.
 *
 * La logica de negocio del departamento no debe saber que existe
 * MongoDB. Habla con este puerto, que expone exactamente DOS primitivas
 * de escritura, ni una mas:
 *
 *   insertIfAbsent  -> para lo INMUTABLE (eventos, decisiones humanas).
 *                      Escribe una vez y jamas modifica. Reejecutar la
 *                      misma operacion no duplica: devuelve
 *                      "duplicate_prevented".
 *
 *   upsertIfNewer   -> para el ESTADO ACTUAL (backlog, change packs,
 *                      work orders...). Escribe solo si el documento
 *                      entrante es mas nuevo que el almacenado. Una
 *                      escritura vieja que llega tarde NO pisa a una
 *                      nueva: devuelve "stale_ignored".
 *
 * Las dos son ATOMICAS a nivel de documento y IDEMPOTENTES. Con eso
 * sobran los locks globales: un reintento, un rerun de GitHub Actions o
 * dos workflows compitiendo por el mismo `recommendationId` convergen al
 * mismo resultado sin coordinacion externa.
 *
 * Deliberadamente NO se expone `delete` ni `deleteMany`. Nada de esta
 * fase borra estado: si algo hay que retirar, se hace con una operacion
 * explicita y revisada, no a traves del puerto que usan los agentes.
 */

/** Valor admisible en una clave de identidad. */
export type KeyValue = string | number;

/** Clave de identidad de un documento: el conjunto de campos de su indice unico. */
export interface DocumentKey {
  readonly [field: string]: KeyValue;
}

export interface PersistedDocument {
  [field: string]: unknown;
}

export type WriteResult =
  /** El documento no existia y se ha creado. */
  | "inserted"
  /** El documento existia y se ha actualizado porque el entrante era mas nuevo. */
  | "updated"
  /**
   * Ya existia con esa identidad y el documento no cambia: no se ha
   * duplicado ni se ha reescrito nada. Es exito, no fallo — y es la señal
   * que demuestra que reejecutar una operacion es un no-op.
   */
  | "duplicate_prevented"
  /** El entrante era MAS VIEJO que el almacenado: no se ha pisado nada. */
  | "stale_ignored";

export interface WriteOutcome {
  readonly result: WriteResult;
}

/** Filtro de lectura: igualdad exacta sobre campos de primer nivel. */
export interface DocumentFilter {
  readonly [field: string]: KeyValue | undefined;
}

export interface StateCollection {
  readonly name: string;

  /** Inserta si no existe. Nunca modifica un documento ya presente. */
  insertIfAbsent(key: DocumentKey, document: PersistedDocument): Promise<WriteOutcome>;

  /**
   * Escribe el documento solo si su `freshnessField` es mayor o igual que
   * el almacenado. Con `>=` en vez de `>` una reejecucion identica se
   * considera "updated" y no falla, que es lo que queremos de un writer
   * idempotente.
   */
  upsertIfNewer(
    key: DocumentKey,
    document: PersistedDocument,
    freshnessField: string
  ): Promise<WriteOutcome>;

  findOne(key: DocumentKey): Promise<PersistedDocument | null>;

  find(filter: DocumentFilter): Promise<PersistedDocument[]>;

  count(filter?: DocumentFilter): Promise<number>;
}

/**
 * Acceso a las colecciones. Existe para que los repositorios no sepan si
 * detras hay un cluster real o el doble en memoria de los tests.
 */
export interface StateDatabase {
  collection(name: string): StateCollection;
  /** Crea los indices declarados. Idempotente. */
  ensureIndexes(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Serializa una clave de forma estable para poder compararla e indexarla.
 *
 * Se codifica en JSON y no concatenando con un separador: los valores de
 * una clave son ids de dominio y podrian contener el separador que se
 * eligiera, con lo que dos claves distintas colisionarian. El encoding
 * JSON es inyectivo, asi que eso no puede pasar.
 */
export function serializeKey(key: DocumentKey): string {
  const pairs = Object.keys(key)
    .sort()
    .map((field) => [field, key[field]] as const);
  return JSON.stringify(pairs);
}

/** Comprueba que la clave esta completa: ningun campo vacio, indefinido o NaN. */
export function assertUsableKey(collectionName: string, key: DocumentKey): void {
  const fields = Object.keys(key);
  if (fields.length === 0) {
    throw new Error(`La coleccion "${collectionName}" no admite una clave vacia.`);
  }
  for (const field of fields) {
    const value = key[field];
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(`Clave invalida en "${collectionName}": el campo "${field}" no es un numero finito.`);
      }
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        `Clave invalida en "${collectionName}": el campo "${field}" esta vacio. ` +
          `Sin identidad estable no se puede escribir de forma idempotente.`
      );
    }
  }
}

/** Contadores de observabilidad de una pasada. Nunca contienen datos sensibles. */
export interface WriteStats {
  writesAttempted: number;
  writesSucceeded: number;
  writesFailed: number;
  duplicateWritesPrevented: number;
  staleWritesIgnored: number;
}

export function emptyWriteStats(): WriteStats {
  return {
    writesAttempted: 0,
    writesSucceeded: 0,
    writesFailed: 0,
    duplicateWritesPrevented: 0,
    staleWritesIgnored: 0,
  };
}

/** Suma el resultado de una escritura a los contadores. */
export function recordWrite(stats: WriteStats, outcome: WriteOutcome): WriteOutcome {
  stats.writesAttempted += 1;
  switch (outcome.result) {
    case "inserted":
    case "updated":
      stats.writesSucceeded += 1;
      break;
    case "duplicate_prevented":
      stats.writesSucceeded += 1;
      stats.duplicateWritesPrevented += 1;
      break;
    case "stale_ignored":
      stats.writesSucceeded += 1;
      stats.staleWritesIgnored += 1;
      break;
  }
  return outcome;
}

/** Suma un fallo a los contadores. */
export function recordWriteFailure(stats: WriteStats): void {
  stats.writesAttempted += 1;
  stats.writesFailed += 1;
}

export function mergeWriteStats(a: WriteStats, b: WriteStats): WriteStats {
  return {
    writesAttempted: a.writesAttempted + b.writesAttempted,
    writesSucceeded: a.writesSucceeded + b.writesSucceeded,
    writesFailed: a.writesFailed + b.writesFailed,
    duplicateWritesPrevented: a.duplicateWritesPrevented + b.duplicateWritesPrevented,
    staleWritesIgnored: a.staleWritesIgnored + b.staleWritesIgnored,
  };
}
