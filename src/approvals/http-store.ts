import {
  API_ROUTES,
  API_STATUS,
  ENV_VAR_NAMES,
  SERVICE_AUTH_HEADER,
  TransitionRequestBody,
} from "./api-contract";
import {
  Approval,
  ApprovalPatch,
  ApprovalStore,
  HumanFeedbackEntry,
  PendingRejectionPrompt,
  ProcessedUpdateResult,
  TransitionInput,
  TransitionOutcome,
} from "./store";
import { DepartmentChangeStatus, isDepartmentChangeStatus } from "../department/apply/state-machine";

/**
 * CLIENTE HTTP del Worker de aprobaciones -- la implementacion de
 * `ApprovalStore` que usa GitHub Actions.
 *
 * Actions NUNCA tiene credenciales de la base de datos: solo la URL del
 * Worker (`APPROVALS_API_URL`) y un bearer de servicio
 * (`APPROVALS_API_TOKEN`). Todo lo que este proceso puede hacer sobre el
 * estado de una aprobacion pasa por las rutas declaradas en
 * `api-contract.ts`, y por ninguna otra.
 *
 * Reglas de este cliente, todas fail-closed:
 *
 * 1. Cualquier respuesta que no este contemplada explicitamente LANZA.
 *    No existe ningun camino por el que una respuesta rara se interprete
 *    como "bueno, seguro que fue bien": publicar en produccion por haber
 *    malinterpretado un 500 seria exactamente el fallo que este sistema
 *    no puede permitirse.
 * 2. El token NUNCA aparece en un mensaje de error, ni siquiera si el
 *    servidor lo devolviera en su cuerpo (se redacta antes de construir
 *    el mensaje). Los errores viajan a los logs de Actions, que son
 *    visibles.
 * 3. `transition` traduce el 409 a `{ok:false, reason:"conflict"}` en vez
 *    de lanzar: perder una carrera NO es un error, es el resultado normal
 *    de la primitiva atomica del store (dos webhooks, dos pulsaciones del
 *    boton). Quien llama tiene que poder distinguir "he perdido la
 *    carrera" de "la API esta rota", y por eso una cosa es un valor de
 *    retorno y la otra una excepcion.
 * 4. Se reintenta SOLO ante errores de red o 5xx (el servidor no llego a
 *    decidir nada). Un 4xx es una respuesta DELIBERADA del Worker
 *    (no autorizado, no existe, conflicto): reintentarla no la cambia y
 *    solo serviria para machacar la API.
 *
 * Los reintentos son seguros en este contrato porque las dos unicas
 * escrituras son idempotentes por diseno: `create` lo es por `changeId`,
 * y `transition` es CONDICIONAL -- si el primer intento si llego a
 * aplicarse, el reintento se encuentra el estado ya movido y responde
 * 409, que es un resultado, no una segunda aplicacion.
 *
 * `fetch` se inyecta como dependencia opcional para poder testear el
 * cliente entero sin red.
 */

// --- Tipos minimos de fetch -------------------------------------------------
//
// El proyecto compila con @types/node 20, que todavia no declara `fetch`
// global. En vez de subir la dependencia (fuera del alcance de esta
// fase) se declara aqui la superficie EXACTA que este modulo usa: asi el
// tipo describe lo que de verdad se necesita, y un fake de test es un
// objeto de tres lineas en vez de un mock de toda la Fetch API.

export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponseLike {
  status: number;
  text: () => Promise<string>;
}

export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

export interface HttpApprovalStoreOptions {
  /** URL base del Worker, sin ruta (p.ej. https://zentry-approvals.<sub>.workers.dev). */
  baseUrl: string;
  /** Bearer de servicio. Nunca se loguea ni se incluye en ningun mensaje de error. */
  token: string;
  /** Inyectable para test. Por defecto, el `fetch` global de Node 22. */
  fetchImpl?: FetchLike;
  /** Intentos TOTALES ante red/5xx (no reintentos adicionales). Por defecto 3. */
  maxAttempts?: number;
  /** Espera base del backoff, que se duplica en cada reintento. */
  retryDelayMs?: number;
  /** Inyectable para que los tests no esperen de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

/** Error de la API de aprobaciones. Nunca contiene el token: ver `redactSecrets`. */
export class ApprovalsApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApprovalsApiError";
    this.status = status;
  }
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
/** Un cuerpo de error largo no aporta nada en un log de Actions y puede arrastrar ruido. */
const MAX_DETAIL_CHARS = 300;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveGlobalFetch(): FetchLike {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== "function") {
    throw new ApprovalsApiError(
      "Este runtime no tiene `fetch` global (hace falta Node 18+; los workflows de este repositorio usan Node 22). Fail-closed: no se habla con la API de aprobaciones.",
      null
    );
  }
  return candidate as unknown as FetchLike;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    throw new ApprovalsApiError(`Falta ${ENV_VAR_NAMES.approvalsApiUrl}: sin URL del Worker no hay forma de leer ni mover ninguna aprobacion.`, null);
  }
  if (!/^https:\/\//i.test(trimmed)) {
    // El bearer de servicio viaja en cada peticion: sobre http plano
    // seria un secreto en claro por la red. No hay excepcion para
    // localhost -- este cliente solo lo usa GitHub Actions contra el
    // Worker real.
    throw new ApprovalsApiError(`${ENV_VAR_NAMES.approvalsApiUrl} tiene que ser https:// (el bearer de servicio viaja en cada peticion). Fail-closed.`, null);
  }
  return trimmed;
}

export class HttpApprovalStore implements ApprovalStore {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpApprovalStoreOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = String(options.token ?? "").trim();
    if (this.token.length === 0) {
      throw new ApprovalsApiError(`Falta ${ENV_VAR_NAMES.approvalsApiToken}: sin bearer de servicio el Worker rechazaria todo. Fail-closed.`, null);
    }
    this.fetchImpl = options.fetchImpl ?? resolveGlobalFetch();
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  // --- Lecturas -------------------------------------------------------------

  async get(approvalId: string): Promise<Approval | null> {
    const response = await this.request("GET", API_ROUTES.approval(approvalId));
    if (response.status === API_STATUS.notFound) return null;
    if (response.status !== API_STATUS.ok) throw this.unexpected("GET", API_ROUTES.approval(approvalId), response);
    return this.parseApproval(this.unwrap(response, "approval"), "GET", API_ROUTES.approval(approvalId), response);
  }

  async listByRun(departmentRunId: string): Promise<Approval[]> {
    const path = API_ROUTES.runApprovals(departmentRunId);
    const response = await this.request("GET", path);
    if (response.status === API_STATUS.notFound) return [];
    if (response.status !== API_STATUS.ok) throw this.unexpected("GET", path, response);
    const raw = this.unwrap(response, "approvals");
    if (!Array.isArray(raw)) throw this.unexpected("GET", path, response, "se esperaba una lista de aprobaciones");
    return raw.map((item) => this.parseApproval(item, "GET", path, response));
  }

  async listHumanFeedback(recommendationId: string): Promise<HumanFeedbackEntry[]> {
    const path = API_ROUTES.feedback(recommendationId);
    const response = await this.request("GET", path);
    if (response.status === API_STATUS.notFound) return [];
    if (response.status !== API_STATUS.ok) throw this.unexpected("GET", path, response);
    const raw = this.unwrap(response, "feedback");
    if (!Array.isArray(raw)) throw this.unexpected("GET", path, response, "se esperaba una lista de feedback humano");
    // El feedback humano se transporta TAL CUAL: no se reinterpreta ni se
    // resume aqui (ver la nota del contrato en store.ts).
    return raw as HumanFeedbackEntry[];
  }

  // --- Escrituras -----------------------------------------------------------

  async create(approval: Approval): Promise<{ approval: Approval; created: boolean }> {
    const path = API_ROUTES.createApproval;
    const response = await this.request("POST", path, approval);
    if (response.status !== API_STATUS.created && response.status !== API_STATUS.ok) {
      throw this.unexpected("POST", path, response);
    }
    // 201 = creada ahora; 200 = ya existia (idempotencia por changeId).
    return {
      approval: this.parseApproval(this.unwrap(response, "approval"), "POST", path, response),
      created: response.status === API_STATUS.created,
    };
  }

  async transition(input: TransitionInput): Promise<TransitionOutcome> {
    const path = API_ROUTES.transition(input.approvalId);
    const body: TransitionRequestBody = {
      expectedFrom: [...input.expectedFrom],
      to: input.to,
      audit: input.audit,
      at: input.at,
      ...(input.patch ? { patch: input.patch as unknown as Record<string, unknown> } : {}),
    };
    const response = await this.request("POST", path, body);

    if (response.status === API_STATUS.ok) {
      const parsed = this.parseJson(response, "POST", path);
      // Un 200 con `ok:false` es una respuesta legitima del Worker (la
      // carrera se resolvio en contra): se traduce igual que el 409, sin
      // lanzar.
      if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === false) {
        return this.failedOutcome(parsed as Record<string, unknown>, "POST", path, response);
      }
      return { ok: true, approval: this.parseApproval(this.unwrap(response, "approval"), "POST", path, response) };
    }

    if (response.status === API_STATUS.conflict || response.status === API_STATUS.notFound || response.status === API_STATUS.badRequest) {
      const parsed = this.parseJsonOrNull(response);
      const record = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}) as Record<string, unknown>;
      if (response.status === API_STATUS.conflict) {
        return {
          ok: false,
          reason: "conflict",
          currentStatus: this.parseStatus(record.currentStatus),
          approval: this.parseApprovalOrNull(record.approval),
        };
      }
      if (response.status === API_STATUS.notFound) {
        return { ok: false, reason: "not_found", currentStatus: null, approval: null };
      }
      // 400: solo se acepta si el Worker dice EXPLICITAMENTE que la
      // transicion no existe en la maquina de estados. Cualquier otro
      // 400 es un bug de este cliente y tiene que hacer ruido.
      if (record.reason === "illegal_transition") {
        return {
          ok: false,
          reason: "illegal_transition",
          currentStatus: this.parseStatus(record.currentStatus),
          approval: this.parseApprovalOrNull(record.approval),
        };
      }
    }

    throw this.unexpected("POST", path, response);
  }

  // --- Operaciones que este cliente NO puede hacer ---------------------------
  //
  // El contrato HTTP (api-contract.ts) expone CINCO rutas y ninguna mas.
  // Todo lo que sigue es del carril del webhook de Telegram y vive dentro
  // del Worker, que habla con D1 directamente. Devolver aqui un valor
  // "razonable" (null, isNew:true) romperia justamente las garantias de
  // idempotencia que esos metodos existen para dar, asi que se lanza.

  private unsupported(operation: string): never {
    throw new ApprovalsApiError(
      `"${operation}" no existe en el contrato HTTP de la API de servicio: es una operacion del carril del webhook de Telegram, que resuelve el Worker contra D1. GitHub Actions no puede ni debe hacerla. Fail-closed.`,
      null
    );
  }

  async listByRecommendation(_recommendationId: string): Promise<Approval[]> {
    return this.unsupported("listByRecommendation");
  }

  async annotate(
    _approvalId: string,
    _patch: ApprovalPatch,
    _audit: { event: string; detail: string },
    _at: string
  ): Promise<Approval | null> {
    // No hay ruta de anotacion sin transicion: desde Actions, cualquier
    // dato que haya que persistir viaja en el `patch` de la transicion
    // que lo produce, en la MISMA operacion atomica.
    return this.unsupported("annotate");
  }

  async markUpdateProcessed(_updateId: number, _at: string): Promise<ProcessedUpdateResult> {
    return this.unsupported("markUpdateProcessed");
  }

  async openRejectionPrompt(_prompt: PendingRejectionPrompt): Promise<void> {
    return this.unsupported("openRejectionPrompt");
  }

  async findOpenRejectionPrompt(_chatId: string, _userId: string): Promise<PendingRejectionPrompt | null> {
    return this.unsupported("findOpenRejectionPrompt");
  }

  async findRejectionPromptByMessageId(_chatId: string, _promptMessageId: number): Promise<PendingRejectionPrompt | null> {
    return this.unsupported("findRejectionPromptByMessageId");
  }

  async closeRejectionPrompt(_approvalId: string): Promise<void> {
    return this.unsupported("closeRejectionPrompt");
  }

  // --- Transporte -----------------------------------------------------------

  private async request(method: string, path: string, body?: unknown): Promise<CapturedResponse> {
    const url = `${this.baseUrl}${path}`;
    const init: HttpRequestInit = {
      method,
      headers: {
        // El token viaja SIEMPRE en la cabecera, nunca en la URL: las URLs
        // acaban en logs, en trazas y en mensajes de error.
        [SERVICE_AUTH_HEADER]: `Bearer ${this.token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };

    let lastNetworkError: string | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: HttpResponseLike;
      try {
        response = await this.fetchImpl(url, init);
      } catch (err) {
        // Error de RED: el Worker no llego a decidir nada, asi que
        // reintentar no puede duplicar ningun efecto.
        lastNetworkError = err instanceof Error ? err.message : String(err);
        if (attempt === this.maxAttempts) break;
        await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }

      const text = await this.readBody(response);
      const captured: CapturedResponse = { status: response.status, text };
      // 5xx = el servidor fallo, no decidio. 4xx = decidio, y reintentar
      // no cambiaria la respuesta.
      if (captured.status >= 500 && attempt < this.maxAttempts) {
        await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return captured;
    }

    throw new ApprovalsApiError(
      `${method} ${path}: la API de aprobaciones no respondio tras ${this.maxAttempts} intento(s) (${this.redactSecrets(lastNetworkError ?? "sin detalle")}). Fail-closed: no se asume nada sobre el estado de la aprobacion.`,
      null
    );
  }

  private async readBody(response: HttpResponseLike): Promise<string> {
    try {
      return await response.text();
    } catch {
      // Un cuerpo ilegible no impide interpretar el codigo de estado, que
      // es lo que decide el resultado.
      return "";
    }
  }

  // --- Interpretacion de respuestas ------------------------------------------

  private parseJsonOrNull(response: CapturedResponse): unknown {
    if (response.text.trim().length === 0) return null;
    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      return null;
    }
  }

  private parseJson(response: CapturedResponse, method: string, path: string): unknown {
    if (response.text.trim().length === 0) {
      throw this.unexpected(method, path, response, "cuerpo vacio donde se esperaba JSON");
    }
    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      throw this.unexpected(method, path, response, "el cuerpo no es JSON valido");
    }
  }

  /**
   * Acepta tanto `{ <key>: X }` como `X` directamente. El contrato fija
   * las RUTAS y los codigos de estado, no la envoltura de cada cuerpo:
   * ser tolerante aqui evita que una diferencia cosmetica entre el Worker
   * y este cliente bloquee una publicacion ya aprobada. La tolerancia es
   * solo de forma -- el contenido se sigue validando despues.
   */
  private unwrap(response: CapturedResponse, key: string): unknown {
    const parsed = this.parseJsonOrNull(response);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && key in (parsed as Record<string, unknown>)) {
      return (parsed as Record<string, unknown>)[key];
    }
    return parsed;
  }

  private parseStatus(value: unknown): DepartmentChangeStatus | null {
    return isDepartmentChangeStatus(value) ? value : null;
  }

  private parseApprovalOrNull(value: unknown): Approval | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.changeId !== "string" || !isDepartmentChangeStatus(record.status)) return null;
    return value as Approval;
  }

  private parseApproval(value: unknown, method: string, path: string, response: CapturedResponse): Approval {
    const approval = this.parseApprovalOrNull(value);
    if (!approval) {
      throw this.unexpected(method, path, response, "la respuesta no contiene una aprobacion valida (changeId + status conocido)");
    }
    return approval;
  }

  private failedOutcome(record: Record<string, unknown>, method: string, path: string, response: CapturedResponse): TransitionOutcome {
    const reason = record.reason;
    const currentStatus = this.parseStatus(record.currentStatus);
    const approval = this.parseApprovalOrNull(record.approval);
    if (reason === "conflict") {
      return { ok: false, reason: "conflict", currentStatus, approval };
    }
    if (reason === "illegal_transition") {
      return { ok: false, reason: "illegal_transition", currentStatus, approval };
    }
    if (reason === "not_found") {
      return { ok: false, reason: "not_found", currentStatus: null, approval: null };
    }
    throw this.unexpected(method, path, response, `motivo de fallo desconocido ("${String(reason)}")`);
  }

  // --- Errores --------------------------------------------------------------

  /**
   * Ultima linea de defensa: aunque el Worker devolviera el token dentro
   * de su cuerpo de error, nunca acabaria en un log de Actions.
   */
  private redactSecrets(text: string): string {
    const redacted = this.token.length > 0 ? text.split(this.token).join("[TOKEN REDACTADO]") : text;
    return redacted.length > MAX_DETAIL_CHARS ? `${redacted.slice(0, MAX_DETAIL_CHARS)}...` : redacted;
  }

  private unexpected(method: string, path: string, response: CapturedResponse, extra?: string): ApprovalsApiError {
    const known: Record<number, string> = {
      [API_STATUS.unauthorized]: `no autorizado: el bearer de servicio (${ENV_VAR_NAMES.approvalsApiToken}) falta, no es valido o no es el que espera el Worker`,
      [API_STATUS.notFound]: "la ruta o el recurso no existen en el Worker",
      [API_STATUS.badRequest]: "el Worker rechazo la peticion por invalida",
      [API_STATUS.conflict]: "conflicto no esperado en esta operacion",
    };
    const meaning = known[response.status] ?? (response.status >= 500 ? "la API de aprobaciones esta fallando" : "respuesta no contemplada");
    const detail = this.redactSecrets(response.text.trim());
    return new ApprovalsApiError(
      `${method} ${path} respondio ${response.status} (${meaning})${extra ? `: ${extra}` : ""}. ${detail.length > 0 ? `Detalle: ${detail}. ` : ""}Fail-closed: no se continua.`,
      response.status
    );
  }
}

interface CapturedResponse {
  status: number;
  /** Cuerpo ya leido: se necesita tanto para interpretar el exito como para explicar el fallo. */
  text: string;
}

/**
 * Construye el store leyendo los NOMBRES de variable del contrato (nunca
 * literales sueltos por el codigo) y fallando en claro si falta alguna:
 * un workflow de produccion mal configurado tiene que parar antes de
 * tocar nada, no a mitad.
 */
export function createHttpApprovalStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<HttpApprovalStoreOptions> = {}
): HttpApprovalStore {
  const baseUrl = (env[ENV_VAR_NAMES.approvalsApiUrl] ?? "").trim();
  const token = (env[ENV_VAR_NAMES.approvalsApiToken] ?? "").trim();
  if (baseUrl.length === 0) {
    throw new ApprovalsApiError(`Falta ${ENV_VAR_NAMES.approvalsApiUrl} en el entorno. Fail-closed: sin API de aprobaciones no se publica nada.`, null);
  }
  if (token.length === 0) {
    throw new ApprovalsApiError(`Falta ${ENV_VAR_NAMES.approvalsApiToken} en el entorno. Fail-closed: sin bearer de servicio no se publica nada.`, null);
  }
  return new HttpApprovalStore({ baseUrl, token, ...overrides });
}
