/**
 * Fase O56 — taxonomia explicita de fallos de MongoDB.
 *
 * POR QUE UNA TAXONOMIA Y NO UN `catch (e) { console.log(e) }`:
 *
 *   1. Un `duplicate key` ESPERADO (dos escritores idempotentes compiten
 *      por insertar el mismo `decisionId`) no es un fallo: es exactamente
 *      la garantia que buscamos, y el sistema debe seguir. Un `duplicate
 *      key` INESPERADO (colision sobre un indice que no estabamos
 *      intentando respetar) si es un fallo.
 *   2. Un fallo de autenticacion y uno de red exigen respuestas
 *      distintas: el primero no se reintenta jamas (se va a repetir
 *      igual), el segundo si.
 *   3. Cuando MongoDB sea la fuente de verdad, una operacion critica que
 *      no puede persistir tiene que FALLAR CERRADA. Nunca caer en
 *      silencio a un JSON viejo: eso es justo el bug que esta fase
 *      existe para eliminar.
 *
 * Ningun mensaje de esta clase contiene la URI ni credenciales: todo pasa
 * por `sanitizeMongoText()`.
 */
import { sanitizeMongoText } from "./mongo-config";

export type MongoFailureKind =
  /** Credenciales invalidas o sin permiso sobre la base/coleccion. NO se reintenta. */
  | "auth_failure"
  /** No se pudo resolver o alcanzar el servidor (DNS, SRV, socket). Reintentable. */
  | "network_failure"
  /** La operacion no respondio a tiempo. Reintentable. */
  | "timeout"
  /** Choque contra un indice unico que ESTABAMOS respetando a proposito. No es un fallo. */
  | "duplicate_key_expected"
  /** Choque contra un indice unico que no esperabamos. Es un fallo de modelo. */
  | "duplicate_key_unexpected"
  /** El cluster no confirmo la escritura con el write concern pedido. */
  | "write_concern"
  /** El documento no cumple el contrato de dominio (falta id, tipo incorrecto). */
  | "validation"
  /** El cluster existe pero no acepta operaciones (primario caido, failover). */
  | "unavailable"
  /** Falta configuracion (MONGODB_URI). Fail-closed antes de tocar la red. */
  | "not_configured"
  /** Cualquier otra cosa. Se trata como fallo duro. */
  | "unknown";

/** Los unicos fallos que tiene sentido reintentar: los que pueden pasar solos. */
const RETRYABLE: ReadonlySet<MongoFailureKind> = new Set<MongoFailureKind>([
  "network_failure",
  "timeout",
  "unavailable",
  "write_concern",
]);

export class MongoPersistenceError extends Error {
  readonly kind: MongoFailureKind;
  readonly operation: string;
  readonly retryable: boolean;

  constructor(kind: MongoFailureKind, operation: string, detail: string) {
    super(`[mongo:${kind}] ${operation}: ${sanitizeMongoText(detail)}`);
    this.name = "MongoPersistenceError";
    this.kind = kind;
    this.operation = operation;
    this.retryable = RETRYABLE.has(kind);
  }
}

/** Codigos de error del servidor de MongoDB relevantes para la taxonomia. */
const DUPLICATE_KEY_CODE = 11000;
const AUTH_CODES = new Set([13, 18, 8000]); // Unauthorized, AuthenticationFailed, Atlas auth
const NOT_PRIMARY_CODES = new Set([10107, 13435, 13436, 189, 91]);

function readCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function readName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * Clasifica un error crudo del driver.
 *
 * `expectedDuplicate` lo decide QUIEN LLAMA, no el error: solo el llamante
 * sabe si estaba haciendo una escritura idempotente (en cuyo caso el
 * choque contra el indice unico es el resultado deseado) o una insercion
 * que deberia haber sido unica de por si.
 */
export function classifyMongoError(err: unknown, expectedDuplicate = false): MongoFailureKind {
  const code = readCode(err);
  const name = readName(err);
  const text = sanitizeMongoText(err).toLowerCase();

  if (code === DUPLICATE_KEY_CODE || text.includes("e11000")) {
    return expectedDuplicate ? "duplicate_key_expected" : "duplicate_key_unexpected";
  }
  if (code !== null && AUTH_CODES.has(code)) return "auth_failure";
  if (name === "MongoServerSelectionError" && text.includes("authentication")) return "auth_failure";
  if (text.includes("authentication failed") || text.includes("not authorized")) return "auth_failure";

  if (name === "MongoWriteConcernError" || text.includes("write concern")) return "write_concern";
  if (code !== null && NOT_PRIMARY_CODES.has(code)) return "unavailable";
  if (name === "MongoServerSelectionError" || name === "MongoTopologyClosedError") return "unavailable";
  if (text.includes("no primary") || text.includes("topology was destroyed")) return "unavailable";

  if (name === "MongoNetworkTimeoutError" || text.includes("timed out") || text.includes("timeout")) {
    return "timeout";
  }
  if (name === "MongoNetworkError" || text.includes("econnrefused") || text.includes("enotfound")) {
    return "network_failure";
  }
  if (text.includes("getaddrinfo") || text.includes("querysrv")) return "network_failure";

  return "unknown";
}

/** Envuelve un error crudo del driver en la taxonomia, ya saneado. */
export function toMongoPersistenceError(
  err: unknown,
  operation: string,
  expectedDuplicate = false
): MongoPersistenceError {
  if (err instanceof MongoPersistenceError) return err;
  const kind = classifyMongoError(err, expectedDuplicate);
  return new MongoPersistenceError(kind, operation, err instanceof Error ? err.message : String(err));
}

/**
 * Pistas accionables por tipo de fallo.
 *
 * Existe porque el mensaje del servidor ("bad auth : authentication
 * failed") dice QUE ha fallado pero no POR QUE, y las causas reales son
 * pocas y concretas. Sin esto, el siguiente que se lo encuentre tiene que
 * volver a deducirlas.
 *
 * Ninguna pista menciona ningun valor: solo nombres de variables y cosas
 * que comprobar en la consola de Atlas.
 */
export function troubleshootingHints(kind: MongoFailureKind): string[] {
  switch (kind) {
    case "auth_failure":
      return [
        "El SRV se resolvio y se llego a autenticar: la RED esta bien. Lo que Atlas rechaza son las credenciales.",
        "1. El usuario de base de datos existe en ESTE cluster y proyecto de Atlas (Database Access), no en otro.",
        "2. La contrasena esta PERCENT-ENCODED dentro de la URI. Si lleva @ : / ? # [ ] % o espacios, en crudo " +
          "no vale: @ es %40, # es %23, / es %2F, : es %3A, % es %25.",
        "3. El usuario tiene rol readWrite sobre la base indicada, no solo sobre otra.",
        // Ojo al redactar: el texto se escribe SIN pares `clave=valor`, para
        // que el saneador no lo confunda con una credencial y lo redacte.
        "4. Si el usuario se creo con una base de autenticacion distinta de `admin`, la URI necesita el " +
          "parametro authSource apuntando a esa base.",
        "5. Regenerar la contrasena en Atlas y volver a pegar la URI completa suele ser mas rapido que " +
          "adivinar cual de las cuatro es.",
      ];
    case "network_failure":
      return [
        "1. La IP del runner esta permitida en Network Access de Atlas. Los runners de GitHub no tienen IP " +
          "fija: hace falta 0.0.0.0/0 o una lista de rangos de GitHub.",
        "2. El nombre del cluster en la URI es el correcto (un SRV que no resuelve da este mismo error).",
      ];
    case "unavailable":
      return [
        "1. El cluster no esta pausado en Atlas (los gratuitos se pausan solos tras dias sin uso).",
        "2. Puede ser un failover en curso: reintentar en unos minutos.",
      ];
    case "timeout":
      return ["1. Reintentar. Si se repite, revisar Network Access y el estado del cluster."];
    case "not_configured":
      return [`1. Definir ${"MONGODB_URI"} como secret del repositorio.`];
    default:
      return [];
  }
}

/** `true` si un choque contra indice unico corresponde a este error. */
export function isDuplicateKeyError(err: unknown): boolean {
  const code = readCode(err);
  return code === 11000 || sanitizeMongoText(err).toLowerCase().includes("e11000");
}
