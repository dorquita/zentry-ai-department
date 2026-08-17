/**
 * Fase O56 — arranque de la persistencia y observabilidad de la pasada.
 *
 * Un unico punto donde se decide si esta pasada habla con MongoDB, en que
 * modo, y que se publica al respecto. Los scripts no repiten esta logica:
 * llaman aqui.
 *
 * LOS TRES MODOS, Y POR QUE LA TRANSICION NO ES UN BIG BANG:
 *
 *   legacy  MongoDB no interviene. Es el comportamiento anterior intacto.
 *           Es el modo cuando no hay `MONGODB_URI`.
 *
 *   shadow  El estado sigue funcionando con el sistema de ficheros + rama
 *           `department-state`, pero TODO lo autoritativo se escribe
 *           ademas en MongoDB. Sirve para comparar sin arriesgar nada.
 *           Un fallo de MongoDB en este modo NO tumba la pasada: la
 *           fuente de verdad todavia no es MongoDB, y fingir lo contrario
 *           seria mentir sobre el estado del sistema.
 *
 *   mongo   MongoDB ES la fuente de verdad. Aqui SI se falla cerrado: si
 *           una operacion critica no puede persistir, la pasada falla.
 *           Nunca se cae en silencio a un JSON viejo — ese es exactamente
 *           el bug que esta fase elimina.
 *
 * El modo se declara explicitamente con `DEPARTMENT_PERSISTENCE_MODE`. No
 * se "adivina": pasar de shadow a mongo es una decision de arquitectura,
 * no un efecto secundario de que una variable de entorno este puesta.
 */
import {
  MongoConfig,
  describeMongoTarget,
  isMongoConfigured,
  loadMongoConfig,
  renderMongoTarget,
  sanitizeMongoText,
} from "./mongo-config";
import { MongoPersistenceError } from "./mongo-errors";
import { connectStateDatabase } from "./mongo-database";
import { DepartmentStateRepository } from "./repositories";
import { WriteStats, emptyWriteStats } from "./collection-port";

export const PERSISTENCE_MODE_VAR = "DEPARTMENT_PERSISTENCE_MODE";

export type PersistenceMode = "legacy" | "shadow" | "mongo";

export function resolvePersistenceMode(env: NodeJS.ProcessEnv = process.env): PersistenceMode {
  const declared = (env[PERSISTENCE_MODE_VAR] ?? "").trim().toLowerCase();
  if (declared === "legacy" || declared === "shadow" || declared === "mongo") return declared;
  if (declared.length > 0) {
    throw new Error(
      `${PERSISTENCE_MODE_VAR} tiene un valor desconocido: ${JSON.stringify(declared)}. ` +
        `Valores validos: "legacy", "shadow", "mongo".`
    );
  }
  // Sin declaracion explicita: si hay credenciales, shadow; si no, legacy.
  // Nunca "mongo" por defecto: convertir a MongoDB en fuente de verdad se
  // hace a proposito, no por accidente.
  return isMongoConfigured(env) ? "shadow" : "legacy";
}

/** `true` si en este modo un fallo de persistencia debe tumbar la pasada. */
export function failsClosed(mode: PersistenceMode): boolean {
  return mode === "mongo";
}

export interface PersistenceSession {
  mode: PersistenceMode;
  connected: boolean;
  /** `null` si el modo es legacy o si la conexion fallo en modo shadow. */
  repository: DepartmentStateRepository | null;
  /** Descripcion saneada del destino. Nunca contiene la URI. */
  target: string;
  /** Motivo saneado de por que no hay conexion, si aplica. */
  unavailableReason: string;
}

export interface OpenOptions {
  env?: NodeJS.ProcessEnv;
  /** Fuerza un modo concreto, ignorando la variable de entorno. */
  mode?: PersistenceMode;
  serverSelectionTimeoutMS?: number;
}

/**
 * Abre la persistencia segun el modo.
 *
 * Contrato de fallo, que es la parte importante:
 *   - modo `mongo`  -> cualquier problema LANZA. Fail-closed.
 *   - modo `shadow` -> un problema se registra y se devuelve sesion sin
 *                      repositorio. La pasada continua con el sistema
 *                      legacy, que en shadow sigue siendo el autoritativo.
 *   - modo `legacy` -> ni se intenta conectar.
 */
export async function openPersistenceSession(
  options: OpenOptions = {}
): Promise<PersistenceSession> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? resolvePersistenceMode(env);

  if (mode === "legacy") {
    return {
      mode,
      connected: false,
      repository: null,
      target: "sin MongoDB (modo legacy)",
      unavailableReason: "",
    };
  }

  let config: MongoConfig;
  try {
    config = loadMongoConfig(env);
  } catch (err) {
    const reason = sanitizeMongoText(err);
    if (failsClosed(mode)) {
      throw new Error(
        `MongoDB es la fuente de verdad (modo "${mode}") y no hay configuracion utilizable: ${reason}`
      );
    }
    return { mode, connected: false, repository: null, target: "sin destino", unavailableReason: reason };
  }

  const target = renderMongoTarget(describeMongoTarget(config));

  try {
    const database = await connectStateDatabase(config, {
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS,
    });
    const repository = new DepartmentStateRepository(database);
    // Un indice unico que no existe no protege de nada. Se asegura antes
    // de la primera escritura, siempre.
    await repository.ensureIndexes();
    return { mode, connected: true, repository, target, unavailableReason: "" };
  } catch (err) {
    const reason =
      err instanceof MongoPersistenceError ? err.message : sanitizeMongoText(err);
    if (failsClosed(mode)) {
      throw new Error(
        `MongoDB es la fuente de verdad (modo "${mode}") y no se ha podido conectar. ` +
          `La pasada falla cerrada en vez de seguir con datos viejos: ${reason}`
      );
    }
    return { mode, connected: false, repository: null, target, unavailableReason: reason };
  }
}

// -------------------------------------------------------------------
// Observabilidad
// -------------------------------------------------------------------

export interface PersistenceObservability {
  persistenceBackend: "mongodb" | "filesystem";
  mongoConnected: boolean;
  migrationMode: PersistenceMode;
  writesAttempted: number;
  writesSucceeded: number;
  writesFailed: number;
  duplicateWritesPrevented: number;
  staleWritesIgnored: number;
  /** Destino saneado. NUNCA la URI. */
  target: string;
}

/**
 * Construye el bloque de observabilidad de la pasada.
 *
 * Auditado a proposito: los unicos campos de texto son `migrationMode` y
 * `target`, y `target` viene de `renderMongoTarget()`, que solo produce
 * esquema, numero de hosts y nombre de base de datos. Aqui no puede
 * colarse una credencial.
 */
export function buildObservability(
  session: PersistenceSession,
  stats: WriteStats = emptyWriteStats()
): PersistenceObservability {
  return {
    persistenceBackend: session.mode === "mongo" ? "mongodb" : "filesystem",
    mongoConnected: session.connected,
    migrationMode: session.mode,
    writesAttempted: stats.writesAttempted,
    writesSucceeded: stats.writesSucceeded,
    writesFailed: stats.writesFailed,
    duplicateWritesPrevented: stats.duplicateWritesPrevented,
    staleWritesIgnored: stats.staleWritesIgnored,
    target: session.target,
  };
}

export function renderObservability(observability: PersistenceObservability): string {
  return [
    `persistenceBackend = ${observability.persistenceBackend}`,
    `mongoConnected = ${observability.mongoConnected}`,
    `migrationMode = ${observability.migrationMode}`,
    `writesAttempted = ${observability.writesAttempted}`,
    `writesSucceeded = ${observability.writesSucceeded}`,
    `writesFailed = ${observability.writesFailed}`,
    `duplicateWritesPrevented = ${observability.duplicateWritesPrevented}`,
    `staleWritesIgnored = ${observability.staleWritesIgnored}`,
    `destino = ${observability.target}`,
  ].join("\n");
}
