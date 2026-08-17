/**
 * Fase O56 — configuracion de MongoDB.
 *
 * REGLA INNEGOCIABLE: la URI de conexion NUNCA sale de este modulo. No se
 * imprime, no se devuelve, no se mete en un JSON, no se escribe en un
 * report y no viaja a ningun prompt. Lo unico que este modulo expone
 * hacia fuera es una DESCRIPCION SANEADA (esquema, numero de hosts,
 * nombre de base de datos) que sirve para diagnosticar sin filtrar nada.
 *
 * El resto del repo ya tiene este patron: `src/adapters/google-ads.ts`
 * sanea antes de logear y `src/adapters/novamira-mcp-transport.ts` falla
 * cerrado nombrando la VARIABLE que falta, jamas su valor. Aqui se hace
 * lo mismo.
 */

/** Nombre de la variable de entorno con la cadena de conexion. Nunca su valor. */
export const MONGODB_URI_VAR = "MONGODB_URI";
/** Nombre de la variable opcional con el nombre de base de datos. */
export const MONGODB_DB_NAME_VAR = "MONGODB_DB_NAME";

/** Base de datos por defecto cuando ni la URI ni MONGODB_DB_NAME la fijan. */
export const DEFAULT_DB_NAME = "zentry_department";

export interface MongoConfig {
  /** La URI real. NO la logees, NO la serialices, NO la devuelvas a nadie. */
  readonly uri: string;
  readonly dbName: string;
}

/**
 * Descripcion SANEADA de a donde apunta la configuracion. Es lo unico
 * que puede aparecer en un log, en un artifact o en un report.
 *
 * Deliberadamente NO incluye hosts, usuario, password ni query string:
 * para diagnosticar "estoy apuntando a donde creo" basta con el esquema,
 * cuantos hosts hay y como se llama la base de datos.
 */
export interface SanitizedMongoTarget {
  scheme: "mongodb" | "mongodb+srv" | "desconocido";
  hostCount: number;
  dbName: string;
  /** true si la URI llevaba credenciales embebidas (sin decir cuales). */
  hasCredentials: boolean;
  /** true si la URI trae una base de datos en la ruta (`.../loquesea`). */
  hasPathDatabase: boolean;
  /** true si la URI fija `authSource` explicitamente en la query string. */
  hasExplicitAuthSource: boolean;
}

/**
 * Detecta la trampa mas comun de las cadenas de conexion de Atlas.
 *
 * Por especificacion, `authSource` NO es siempre `admin`: por defecto es
 * LA BASE QUE VENGA EN LA RUTA de la URI, y solo cae a `admin` si la ruta
 * no trae ninguna.
 *
 * Atlas, en cambio, crea los usuarios en `admin`. Asi que una URI del
 * estilo `mongodb+srv://usuario:clave@cluster/mi_base` sin `authSource`
 * hace que el driver intente autenticar contra `mi_base`, donde ese
 * usuario no existe — y el servidor responde con un escueto
 * "bad auth : authentication failed" que no dice nada de esto.
 *
 * Devuelve `true` cuando se dan las dos condiciones a la vez, que es
 * exactamente el caso sospechoso.
 */
export function looksLikeMissingAuthSource(target: SanitizedMongoTarget): boolean {
  return target.hasCredentials && target.hasPathDatabase && !target.hasExplicitAuthSource;
}

export class MongoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MongoConfigError";
  }
}

/**
 * Extrae el nombre de base de datos de la ruta de la URI, si lo lleva.
 * Devuelve "" si la URI no fija ninguna.
 *
 * Se hace a mano y no con `new URL()` porque `mongodb+srv://` con varios
 * hosts separados por coma no es una URL valida para el parser de Node.
 */
function readDbNameFromUri(uri: string): string {
  const afterScheme = uri.slice(uri.indexOf("://") + 3);
  const withoutQuery = afterScheme.split("?")[0];
  const slash = withoutQuery.indexOf("/");
  if (slash === -1) return "";
  return decodeURIComponent(withoutQuery.slice(slash + 1)).trim();
}

/**
 * Lee la configuracion EXCLUSIVAMENTE del entorno. Fail-closed: si falta
 * `MONGODB_URI` lanza nombrando la variable, nunca un valor.
 *
 * Precedencia del nombre de base de datos, de mayor a menor:
 *   1. `MONGODB_DB_NAME`
 *   2. la ruta de la propia URI
 *   3. `DEFAULT_DB_NAME`
 */
export function loadMongoConfig(env: NodeJS.ProcessEnv = process.env): MongoConfig {
  const uri = (env[MONGODB_URI_VAR] ?? "").trim();
  if (uri.length === 0) {
    throw new MongoConfigError(
      `Falta la variable de entorno ${MONGODB_URI_VAR}. No se intenta ninguna conexion (fail-closed).`
    );
  }
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new MongoConfigError(
      `${MONGODB_URI_VAR} no tiene un esquema valido: debe empezar por "mongodb://" o "mongodb+srv://". ` +
        `El valor NO se muestra a proposito.`
    );
  }

  const explicit = (env[MONGODB_DB_NAME_VAR] ?? "").trim();
  const fromUri = readDbNameFromUri(uri);
  const dbName = explicit || fromUri || DEFAULT_DB_NAME;

  if (/[\s"$*<>:|?\\/]/.test(dbName)) {
    throw new MongoConfigError(
      `El nombre de base de datos resuelto no es valido para MongoDB (${JSON.stringify(dbName)}). ` +
        `Revisa ${MONGODB_DB_NAME_VAR}.`
    );
  }

  return { uri, dbName };
}

/** `true` si hay configuracion de Mongo disponible, sin lanzar ni tocar la red. */
export function isMongoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[MONGODB_URI_VAR] ?? "").trim().length > 0;
}

/**
 * Convierte la configuracion en algo que SI se puede enseñar. Se aplica
 * a la URI real, pero solo devuelve metadatos estructurales.
 */
export function describeMongoTarget(config: MongoConfig): SanitizedMongoTarget {
  const uri = config.uri;
  const scheme: SanitizedMongoTarget["scheme"] = uri.startsWith("mongodb+srv://")
    ? "mongodb+srv"
    : uri.startsWith("mongodb://")
      ? "mongodb"
      : "desconocido";

  const afterScheme = uri.slice(uri.indexOf("://") + 3);
  const at = afterScheme.lastIndexOf("@");
  const hasCredentials = at !== -1;
  const afterAuth = hasCredentials ? afterScheme.slice(at + 1) : afterScheme;
  const authority = afterAuth.split("/")[0].split("?")[0];
  const hostCount = authority.length === 0 ? 0 : authority.split(",").filter((h) => h.trim().length > 0).length;

  const query = afterAuth.includes("?") ? afterAuth.slice(afterAuth.indexOf("?") + 1) : "";

  return {
    scheme,
    hostCount,
    dbName: config.dbName,
    hasCredentials,
    hasPathDatabase: readDbNameFromUri(uri).length > 0,
    hasExplicitAuthSource: /(^|&)authSource=/i.test(query),
  };
}

/** Una linea legible y segura para logs. Nunca contiene host, usuario ni password. */
export function renderMongoTarget(target: SanitizedMongoTarget): string {
  return (
    `esquema=${target.scheme} hosts=${target.hostCount} db=${target.dbName} ` +
    `credenciales=${target.hasCredentials ? "si (no se muestran)" : "no"}`
  );
}

/**
 * Ultima linea de defensa: elimina de cualquier texto todo lo que pueda
 * ser una cadena de conexion o una credencial antes de que llegue a un
 * log, un artifact o un report.
 *
 * Se aplica a TODO mensaje de error que salga de la capa de persistencia,
 * porque el driver de MongoDB incluye la URI completa en varios de sus
 * mensajes (fallo de resolucion SRV, de autenticacion y de topologia).
 */
export function sanitizeMongoText(raw: unknown): string {
  let text = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw);

  // Cualquier cadena de conexion completa, con o sin credenciales.
  text = text.replace(/mongodb(?:\+srv)?:\/\/\S*/gi, "mongodb://[REDACTED]");
  // Pares usuario:password sueltos que el driver a veces reproduce.
  text = text.replace(/\/\/[^\s/@]+:[^\s/@]+@/g, "//[REDACTED]@");
  // Claves tipicas en texto plano.
  text = text.replace(
    /((?:password|passwd|pwd|secret|token|authSource|apiKey)\s*[:=]\s*)["']?[^\s"',}]+["']?/gi,
    "$1[REDACTED]"
  );

  return text.length > 800 ? `${text.slice(0, 800)}...[truncado]` : text;
}
