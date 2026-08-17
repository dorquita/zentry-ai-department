/**
 * Fase O56 — implementacion real del puerto contra MongoDB.
 *
 * Las dos primitivas del puerto se traducen a UNA sola operacion atomica
 * de MongoDB cada una. Esa es la razon de que no haga falta ningun lock
 * global: MongoDB garantiza atomicidad a nivel de documento, y un indice
 * unico convierte "no deberiamos duplicar" en "no se puede duplicar".
 *
 *   insertIfAbsent -> updateOne({clave}, {$setOnInsert: doc}, {upsert})
 *       Dos escritores concurrentes con la misma clave: uno inserta, el
 *       otro no modifica nada. Si ademas chocan exactamente a la vez, el
 *       perdedor recibe E11000, que aqui es EXITO ("duplicate_prevented"),
 *       no un fallo.
 *
 *   upsertIfNewer  -> updateOne({clave, frescura: {$lte: entrante}},
 *                               {$set: doc}, {upsert})
 *       Si lo almacenado es mas nuevo, el filtro no casa, el upsert
 *       intenta insertar y choca contra el indice unico: eso significa
 *       "ha llegado tarde", y se traduce a "stale_ignored". El estado
 *       nuevo NO se revierte.
 *
 * `writeConcern: majority` a proposito: cuando MongoDB sea la fuente de
 * verdad, "escrito" tiene que significar "confirmado por la mayoria del
 * conjunto", no "aceptado por un nodo que puede caerse a continuacion".
 */
import type { Collection, Db, MongoClient as MongoClientType } from "mongodb";
import {
  COLLECTION_SPECS,
  CollectionSpec,
  findCollectionSpec,
  indexName,
} from "./collections";
import {
  DocumentFilter,
  DocumentKey,
  PersistedDocument,
  StateCollection,
  StateDatabase,
  WriteOutcome,
  assertUsableKey,
} from "./collection-port";
import { MongoConfig } from "./mongo-config";
import { MongoPersistenceError, isDuplicateKeyError, toMongoPersistenceError } from "./mongo-errors";

/** Si el cluster no responde en este plazo, se falla cerrado. */
export const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 10_000;

/**
 * Plazo maximo de UNA operacion antes de darla por perdida.
 *
 * POR QUE HACE FALTA, con nombre y apellidos: `serverSelectionTimeoutMS`
 * solo acota encontrar un servidor al que hablar; NO acota lo que tarda
 * una operacion ya enviada. Sin esto, si Atlas cierra un socket sin RST
 * (o la conexion se queda a medias), el driver espera indefinidamente.
 *
 * Se vio en el run 32017411162: la primera migracion completa tardo 2m44s
 * y la segunda, con exactamente el mismo trabajo, se quedo colgada mas de
 * media hora. Con 25 escrituras en vuelo basta con que unas pocas se
 * queden esperando para siempre para que sus slots no se liberen nunca y
 * la migracion no avance mas, sin error y sin final.
 *
 * Fallar es mejor que colgarse: la migracion ya cuenta cada operacion
 * fallida por separado y la reejecucion las recupera, porque es
 * idempotente.
 */
export const DEFAULT_SOCKET_TIMEOUT_MS = 45_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;

function readFreshness(document: PersistedDocument, field: string): string {
  const value = document[field];
  return typeof value === "string" ? value : "";
}

/** Quita `_id` para que el documento devuelto sea del dominio, no de Mongo. */
function stripInternalId(document: Record<string, unknown> | null): PersistedDocument | null {
  if (!document) return null;
  const copy = { ...document };
  delete copy._id;
  return copy as PersistedDocument;
}

export class MongoStateCollection implements StateCollection {
  readonly name: string;

  constructor(
    name: string,
    private readonly collection: Collection<Record<string, unknown>>
  ) {
    this.name = name;
  }

  async insertIfAbsent(key: DocumentKey, document: PersistedDocument): Promise<WriteOutcome> {
    assertUsableKey(this.name, key);
    try {
      const result = await this.collection.updateOne(
        { ...key },
        { $setOnInsert: { ...key, ...document } },
        { upsert: true }
      );
      return { result: result.upsertedCount === 1 ? "inserted" : "duplicate_prevented" };
    } catch (err) {
      // Choque contra el indice unico: otro escritor gano la carrera.
      // Es exactamente la garantia que pedimos, no un fallo.
      if (isDuplicateKeyError(err)) return { result: "duplicate_prevented" };
      throw toMongoPersistenceError(err, `${this.name}.insertIfAbsent`);
    }
  }

  async upsertIfNewer(
    key: DocumentKey,
    document: PersistedDocument,
    freshnessField: string
  ): Promise<WriteOutcome> {
    assertUsableKey(this.name, key);
    const incoming = readFreshness(document, freshnessField);

    try {
      const result = await this.collection.updateOne(
        { ...key, [freshnessField]: { $lte: incoming } },
        { $set: { ...key, ...document } },
        { upsert: true }
      );
      if (result.upsertedCount === 1) return { result: "inserted" };
      // `modifiedCount === 0` con `matchedCount > 0` significa que el
      // documento ya era identico: la escritura no ha cambiado nada. Se
      // reporta como duplicado evitado, que es lo que permite demostrar
      // que reejecutar la migracion no escribe.
      if (result.matchedCount > 0 && result.modifiedCount === 0) {
        return { result: "duplicate_prevented" };
      }
      return { result: "updated" };
    } catch (err) {
      if (!isDuplicateKeyError(err)) {
        throw toMongoPersistenceError(err, `${this.name}.upsertIfNewer`);
      }
      return this.resolveUpsertConflict(key, document, freshnessField, incoming);
    }
  }

  /**
   * El upsert ha chocado contra el indice unico. Solo hay dos motivos
   * posibles, y se distinguen releyendo el documento:
   *
   *   a) lo almacenado es MAS NUEVO -> nuestra escritura llega tarde y se
   *      descarta. Nunca se revierte estado nuevo con estado viejo.
   *   b) otro escritor inserto entre nuestro filtro y nuestro insert ->
   *      se reintenta una vez, ya sin upsert, y ahora si casa.
   */
  private async resolveUpsertConflict(
    key: DocumentKey,
    document: PersistedDocument,
    freshnessField: string,
    incoming: string
  ): Promise<WriteOutcome> {
    const stored = await this.findOne(key);
    if (stored && readFreshness(stored, freshnessField) > incoming) {
      return { result: "stale_ignored" };
    }
    try {
      const retry = await this.collection.updateOne(
        { ...key, [freshnessField]: { $lte: incoming } },
        { $set: { ...key, ...document } }
      );
      if (retry.matchedCount === 0) {
        // Alguien ha vuelto a adelantarse con algo mas nuevo entre la
        // relectura y el reintento. Su version gana.
        return { result: "stale_ignored" };
      }
      if (retry.modifiedCount === 0) return { result: "duplicate_prevented" };
      return { result: "updated" };
    } catch (err) {
      throw toMongoPersistenceError(err, `${this.name}.upsertIfNewer.retry`);
    }
  }

  async findOne(key: DocumentKey): Promise<PersistedDocument | null> {
    assertUsableKey(this.name, key);
    try {
      return stripInternalId(await this.collection.findOne({ ...key }));
    } catch (err) {
      throw toMongoPersistenceError(err, `${this.name}.findOne`);
    }
  }

  async find(filter: DocumentFilter): Promise<PersistedDocument[]> {
    try {
      const documents = await this.collection.find({ ...filter }).toArray();
      return documents.map((d) => stripInternalId(d) as PersistedDocument);
    } catch (err) {
      throw toMongoPersistenceError(err, `${this.name}.find`);
    }
  }

  async count(filter: DocumentFilter = {}): Promise<number> {
    try {
      return await this.collection.countDocuments({ ...filter });
    } catch (err) {
      throw toMongoPersistenceError(err, `${this.name}.count`);
    }
  }
}

export class MongoStateDatabase implements StateDatabase {
  private readonly collections = new Map<string, MongoStateCollection>();

  constructor(
    private readonly client: MongoClientType,
    private readonly db: Db
  ) {}

  collection(name: string): StateCollection {
    let existing = this.collections.get(name);
    if (!existing) {
      // findCollectionSpec falla si el nombre no esta declarado: no se
      // crean colecciones sueltas por un error de tecleo.
      const spec: CollectionSpec = findCollectionSpec(name);
      existing = new MongoStateCollection(
        spec.name,
        this.db.collection<Record<string, unknown>>(spec.name)
      );
      this.collections.set(name, existing);
    }
    return existing;
  }

  /**
   * Crea los indices declarados en `collections.ts`. Idempotente: si ya
   * existen con la misma definicion, MongoDB no hace nada.
   *
   * Se llama SIEMPRE antes de la primera escritura de un proceso. Un
   * indice unico que no existe no protege de nada, y el precio de
   * comprobarlo es despreciable comparado con descubrir duplicados dentro
   * de un mes.
   */
  async ensureIndexes(): Promise<void> {
    for (const spec of COLLECTION_SPECS) {
      const collection = this.db.collection<Record<string, unknown>>(spec.name);
      for (const index of spec.indexes) {
        const keys: Record<string, 1> = {};
        for (const field of index.fields) keys[field] = 1;
        try {
          await collection.createIndex(keys, { unique: index.unique, name: indexName(index) });
        } catch (err) {
          throw toMongoPersistenceError(err, `ensureIndexes(${spec.name}.${indexName(index)})`);
        }
      }
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // Cerrar la conexion nunca puede tumbar una pasada que ya escribio
      // correctamente. El estado ya esta confirmado por el write concern.
    }
  }

  /** Ping al servidor. Falla cerrado y sin filtrar la URI. */
  async ping(): Promise<void> {
    try {
      await this.db.command({ ping: 1 });
    } catch (err) {
      throw toMongoPersistenceError(err, "ping");
    }
  }
}

export interface ConnectOptions {
  serverSelectionTimeoutMS?: number;
  socketTimeoutMS?: number;
}

/**
 * Abre la conexion y hace ping. Fail-closed: si no se puede conectar,
 * lanza un `MongoPersistenceError` clasificado y SANEADO — nunca se cae
 * en silencio a leer un JSON viejo.
 *
 * El driver se carga con `require` diferido para que importar este modulo
 * (por ejemplo desde un test que no toca Mongo) no obligue a tener el
 * paquete resuelto.
 */
export async function connectStateDatabase(
  config: MongoConfig,
  options: ConnectOptions = {}
): Promise<MongoStateDatabase> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const driver = require("mongodb") as typeof import("mongodb");

  let client: MongoClientType;
  try {
    client = new driver.MongoClient(config.uri, {
      serverSelectionTimeoutMS:
        options.serverSelectionTimeoutMS ?? DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
      // Sin estos dos, una operacion enviada puede esperar para siempre.
      socketTimeoutMS: options.socketTimeoutMS ?? DEFAULT_SOCKET_TIMEOUT_MS,
      connectTimeoutMS: DEFAULT_CONNECT_TIMEOUT_MS,
      // El pool tiene que dar de si para el paralelismo de la migracion,
      // pero sin pasarse: Atlas limita conexiones por cluster.
      maxPoolSize: 50,
      writeConcern: { w: "majority" },
      retryWrites: true,
    });
    await client.connect();
  } catch (err) {
    throw toMongoPersistenceError(err, "connect");
  }

  const database = new MongoStateDatabase(client, client.db(config.dbName));
  try {
    await database.ping();
  } catch (err) {
    await database.close();
    if (err instanceof MongoPersistenceError) throw err;
    throw toMongoPersistenceError(err, "ping");
  }
  return database;
}
