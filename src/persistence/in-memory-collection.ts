/**
 * Fase O56 — doble en memoria del puerto de persistencia.
 *
 * POR QUE EXISTE: `npm test` corre en cualquier maquina y en CI sin
 * credenciales ni red. Si los tests de idempotencia y concurrencia
 * solo pudieran ejecutarse contra un cluster real, en la practica no se
 * ejecutarian nunca — y son justo los que sostienen la garantia de que
 * una aprobacion humana no se duplica ni se pierde.
 *
 * QUE MODELA FIELMENTE Y QUE NO:
 *
 *   SI  — la atomicidad por documento. MongoDB garantiza que un
 *         `updateOne` con `upsert` sobre un indice unico es atomico: o
 *         inserta, o choca. Aqui la seccion critica (leer + decidir +
 *         escribir) es SINCRONA, sin ningun `await` en medio, que es
 *         exactamente la misma garantia.
 *
 *   SI  — la latencia previa. Cada operacion cede el turno del event loop
 *         ANTES de la seccion critica. Sin eso, dos escritores
 *         "concurrentes" en Node se serializarian solos y el test de
 *         concurrencia pasaria sin probar nada. Con esto, un repositorio
 *         que hiciera "leer, decidir, escribir" con un await en medio
 *         quedaria expuesto — que es precisamente lo que el test debe
 *         detectar.
 *
 *   NO  — el comportamiento del cluster (failover, write concern, red).
 *         Eso solo se puede probar contra Mongo de verdad, y por eso
 *         existen la sonda `npm run state:probe-mongodb` y la suite que
 *         solo corre cuando hay `MONGODB_URI`.
 *
 * Este doble NO es una reimplementacion de MongoDB: implementa el puerto,
 * que tiene dos primitivas. Nada mas.
 */
import {
  DocumentFilter,
  DocumentKey,
  PersistedDocument,
  StateCollection,
  StateDatabase,
  WriteOutcome,
  assertUsableKey,
  serializeKey,
} from "./collection-port";

/** Cede el turno del event loop para que dos operaciones puedan interleavarse. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function matchesFilter(document: PersistedDocument, filter: DocumentFilter): boolean {
  for (const field of Object.keys(filter)) {
    const expected = filter[field];
    if (expected === undefined) continue;
    if (document[field] !== expected) return false;
  }
  return true;
}

function readFreshness(document: PersistedDocument, field: string): string {
  const value = document[field];
  return typeof value === "string" ? value : "";
}

/** Serializacion estable, para poder decir si una escritura cambia algo o no. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

export class InMemoryStateCollection implements StateCollection {
  readonly name: string;
  private readonly documents = new Map<string, PersistedDocument>();

  constructor(name: string) {
    this.name = name;
  }

  async insertIfAbsent(key: DocumentKey, document: PersistedDocument): Promise<WriteOutcome> {
    assertUsableKey(this.name, key);
    await yieldToEventLoop();

    // ---- seccion critica: sincrona a proposito (equivale a la
    // atomicidad por documento que da MongoDB). No meter awaits aqui.
    const serialized = serializeKey(key);
    if (this.documents.has(serialized)) {
      return { result: "duplicate_prevented" };
    }
    this.documents.set(serialized, { ...key, ...document });
    return { result: "inserted" };
    // ---- fin seccion critica
  }

  async upsertIfNewer(
    key: DocumentKey,
    document: PersistedDocument,
    freshnessField: string
  ): Promise<WriteOutcome> {
    assertUsableKey(this.name, key);
    await yieldToEventLoop();

    // ---- seccion critica: sincrona a proposito.
    const serialized = serializeKey(key);
    const existing = this.documents.get(serialized);
    if (!existing) {
      this.documents.set(serialized, { ...key, ...document });
      return { result: "inserted" };
    }
    const incoming = readFreshness(document, freshnessField);
    const stored = readFreshness(existing, freshnessField);
    if (incoming < stored) {
      return { result: "stale_ignored" };
    }
    const next = { ...key, ...document };
    // Reescribir un documento IDENTICO no es una escritura: es la misma
    // operacion repetida. Distinguirlo es lo que permite demostrar que la
    // segunda ejecucion de la migracion no escribe nada (MongoDB da esta
    // señal gratis en `modifiedCount`).
    if (stableStringify(existing) === stableStringify(next)) {
      return { result: "duplicate_prevented" };
    }
    this.documents.set(serialized, next);
    return { result: "updated" };
    // ---- fin seccion critica
  }

  async findOne(key: DocumentKey): Promise<PersistedDocument | null> {
    assertUsableKey(this.name, key);
    const found = this.documents.get(serializeKey(key));
    return found ? { ...found } : null;
  }

  async find(filter: DocumentFilter): Promise<PersistedDocument[]> {
    const out: PersistedDocument[] = [];
    for (const document of this.documents.values()) {
      if (matchesFilter(document, filter)) out.push({ ...document });
    }
    return out;
  }

  async count(filter: DocumentFilter = {}): Promise<number> {
    return (await this.find(filter)).length;
  }
}

export class InMemoryStateDatabase implements StateDatabase {
  private readonly collections = new Map<string, InMemoryStateCollection>();
  private indexesEnsured = 0;

  collection(name: string): StateCollection {
    let existing = this.collections.get(name);
    if (!existing) {
      existing = new InMemoryStateCollection(name);
      this.collections.set(name, existing);
    }
    return existing;
  }

  async ensureIndexes(): Promise<void> {
    // En el doble, la unicidad la garantiza el Map: no hay indices que
    // crear. Se cuenta la llamada para poder afirmar en los tests que el
    // arranque real la hace.
    this.indexesEnsured += 1;
  }

  async close(): Promise<void> {
    // No hay conexion que cerrar. Los documentos se conservan para poder
    // simular "una pasada nueva" reutilizando la misma base.
  }

  /** Solo para tests: cuantas veces se ha pedido asegurar los indices. */
  ensureIndexesCallCount(): number {
    return this.indexesEnsured;
  }
}
