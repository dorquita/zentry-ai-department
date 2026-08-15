/**
 * TIPADO DEL ENTORNO DEL WORKER DE CLOUDFLARE.
 *
 * El Worker NO es Node: no hay `process.env`, no hay `fs`, no hay
 * `require("crypto")`. Todo lo que el codigo necesita llega como
 * propiedades del objeto `Env` que el runtime pasa a `fetch()`, y las
 * unicas APIs globales que se usan en `src/worker/**` son las que
 * tambien existen en el runtime de Workers (`fetch`, `Request`,
 * `Response`, `URL`, `JSON`, `TextEncoder`).
 *
 * Los tipos de D1 se declaran AQUI a mano, deliberadamente, en vez de
 * depender de `@cloudflare/workers-types`. Motivo: añadir esa dependencia
 * obligaria a tocar `package.json` y `tsconfig.json` (`types`/`lib`), y
 * el resto del repositorio compila contra `@types/node`. Se declara solo
 * el subconjunto de la API que `d1-store.ts` usa de verdad -- si algun
 * dia hace falta mas, se añade aqui y no se copia por ahi suelto.
 *
 * Los NOMBRES de las variables son los de `ENV_VAR_NAMES`
 * (src/approvals/api-contract.ts). Ningun VALOR vive nunca en el
 * repositorio: los secretos se cargan con `wrangler secret put`.
 */

/** Metadatos que D1 devuelve por sentencia. `changes` es lo que decide una transicion condicional. */
export interface D1Meta {
  /** Filas realmente modificadas por la sentencia. 0 = la condicion del WHERE no se cumplio. */
  changes?: number;
  /** Alias que algunas versiones del binding devuelven. Se lee como respaldo de `changes`. */
  rows_written?: number;
  rows_read?: number;
  duration?: number;
  last_row_id?: number;
  [key: string]: unknown;
}

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** Lo unico que el Worker usa del contexto de ejecucion. */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Entorno del Worker. TODO opcional a proposito: un secreto sin
 * configurar NO puede reventar el arranque con un stack trace (que
 * acabaria en los logs), tiene que producir un fallo cerrado y silencioso
 * en el punto donde se usa. Ver `requireEnv`.
 */
export interface Env {
  /** Binding de D1 (`binding = "DB"` en wrangler.toml). Cambiar el nombre rompe el Worker. */
  DB: D1Database;

  /** Bearer con el que GitHub Actions habla con la API de servicio. */
  SERVICE_TOKEN?: string;
  /** `secret_token` que Telegram firma en cada entrega del webhook. Distinto del anterior a proposito. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Token del bot, para responder mensajes. NUNCA se loguea ni se devuelve en ninguna respuesta. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Unico usuario de Telegram autorizado a decidir. */
  TELEGRAM_ALLOWED_USER_ID?: string;
  /** Unico chat autorizado. */
  TELEGRAM_ALLOWED_CHAT_ID?: string;

  /** Credencial con la que se dispara el workflow de produccion. */
  GITHUB_DISPATCH_TOKEN?: string;
  /** `owner/repo` destino del dispatch. */
  GITHUB_REPOSITORY?: string;
  /** Fichero del workflow de produccion. */
  GITHUB_PRODUCTION_WORKFLOW?: string;
  /** Rama sobre la que lanzar el workflow. */
  GITHUB_WORKFLOW_REF?: string;
}

/**
 * Lee una variable y devuelve `""` si no esta. Devolver vacio (en vez de
 * lanzar) es deliberado: quien llama tiene que tratar el vacio como
 * "fail-closed, no hago nada", y asi el nombre del secreto que falta
 * nunca viaja dentro de un mensaje de error hacia el cliente.
 */
export function readEnv(env: Env, name: keyof Env): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * `true` si TODAS las variables indicadas tienen valor. Sirve para
 * decidir "esta configurado" sin revelar CUAL falta.
 */
export function hasEnv(env: Env, names: (keyof Env)[]): boolean {
  return names.every((name) => readEnv(env, name).length > 0);
}
