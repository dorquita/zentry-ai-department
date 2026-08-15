import {
  API_ROUTES,
  API_STATUS,
  ApiErrorBody,
  SERVICE_AUTH_HEADER,
  TELEGRAM_SECRET_HEADER,
  TransitionRequestBody,
} from "../approvals/api-contract";
import { Approval, ApprovalPatch, ApprovalStore } from "../approvals/store";
import { DepartmentChangeStatus, isDepartmentChangeStatus } from "../department/apply/state-machine";
import { buildApprovalButtons, buildApprovalRequestMessage } from "../department/apply/telegram-message";
import { D1ApprovalStore } from "./d1-store";
import { Env, ExecutionContext, readEnv } from "./env";
import { GithubDispatchPort, createGithubDispatcher, readGithubDispatchConfig } from "./github-dispatch";
import { TelegramPort, createTelegramClient } from "./telegram-client";
import { TelegramUpdate, WorkerLogEvent, WorkerLogger, handleTelegramUpdate } from "./webhook";

/**
 * ENTRYPOINT DEL WORKER DE APROBACIONES.
 *
 * Un solo Worker con DOS superficies que se autentican de forma distinta
 * y con secretos distintos, a proposito -- comprometer una no da acceso a
 * la otra:
 *
 *   POST /telegram/webhook   publico, firmado por Telegram con
 *                            `x-telegram-bot-api-secret-token`.
 *   /api/**                  privado, `Authorization: Bearer <SERVICE_TOKEN>`,
 *                            que es lo unico que tiene GitHub Actions.
 *                            Actions NUNCA ve credenciales de D1.
 *   GET  /health             sin auth, y por eso NO dice absolutamente
 *                            nada de la configuracion: solo `{ok:true}`.
 *                            Un health check que informa de que secretos
 *                            estan puestos es un oraculo para quien
 *                            sondea.
 *
 * Las dos comparaciones de secreto son en TIEMPO CONSTANTE. Un `===` de
 * strings corta en el primer byte distinto, y esa diferencia de tiempo es
 * medible a traves de la red: se puede reconstruir un token byte a byte.
 */

/**
 * Compara en tiempo constante respecto al CONTENIDO. Se recorre siempre
 * la longitud maxima de las dos cadenas (`charCodeAt` fuera de rango da
 * NaN, y `NaN | 0` es 0), asi que ningun byte coincidente ni distinto
 * altera el numero de iteraciones.
 *
 * La longitud si se mezcla en el acumulador: eso no filtra nada util
 * (comparar longitudes es publico) y garantiza que "abc" != "abcd".
 *
 * Un secreto esperado VACIO devuelve siempre `false`: un Worker sin ese
 * secreto configurado no autentica a nadie. Fail-closed.
 */
export function constantTimeEquals(provided: string, expected: string): boolean {
  const a = String(provided ?? "");
  const b = String(expected ?? "");
  if (b.length === 0) return false;

  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

/** Extrae el token de `Authorization: Bearer <token>`. Vacio si la cabecera no tiene esa forma. */
export function parseBearerToken(headerValue: string | null): string {
  const match = /^Bearer\s+(.+)$/i.exec(String(headerValue ?? "").trim());
  return match ? match[1].trim() : "";
}

// --- Respuestas -------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

/** Error con cuerpo acotado: `detail` es legible pero NUNCA nombra un secreto ni revela configuracion. */
function apiError(error: string, detail: string, status: number): Response {
  const body: ApiErrorBody = { error, detail };
  return json(body, status);
}

/** 401 sin cuerpo util: quien no esta autenticado no aprende nada del sistema. */
function unauthorized(): Response {
  return new Response(null, { status: API_STATUS.unauthorized });
}

// --- Runtime inyectable -----------------------------------------------------

/**
 * Todo lo que el Worker necesita del mundo exterior, en un solo objeto.
 * Existe para que `handleWorkerRequest` sea testeable ENTERO sin D1, sin
 * Telegram y sin GitHub: los tests pasan su propio runtime.
 */
export interface WorkerRuntime {
  store: ApprovalStore;
  telegram: TelegramPort;
  githubDispatch: GithubDispatchPort;
  now: () => Date;
  log: WorkerLogger;
}

/** Log estructurado: UNA linea JSON por evento, con campos fijos. Nunca tokens, nunca cuerpos completos. */
export function createConsoleLogger(): WorkerLogger {
  return (entry: WorkerLogEvent): void => {
    console.log(JSON.stringify(entry));
  };
}

export function createRuntime(env: Env): WorkerRuntime {
  return {
    store: new D1ApprovalStore(env.DB),
    telegram: createTelegramClient(readEnv(env, "TELEGRAM_BOT_TOKEN")),
    githubDispatch: createGithubDispatcher(readGithubDispatchConfig(env)),
    now: () => new Date(),
    log: createConsoleLogger(),
  };
}

// --- Routing ----------------------------------------------------------------

interface Route {
  kind: "health" | "telegramWebhook" | "createApproval" | "getApproval" | "transition" | "runApprovals" | "feedback" | "unknown";
  id?: string;
}

/** Enrutado explicito contra `API_ROUTES`. Cualquier ruta no declarada es 404: no hay comodines. */
export function resolveRoute(method: string, pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (method === "GET" && path === API_ROUTES.health) return { kind: "health" };
  if (method === "POST" && path === API_ROUTES.telegramWebhook) return { kind: "telegramWebhook" };
  if (method === "POST" && path === API_ROUTES.createApproval) return { kind: "createApproval" };

  const segments = path.split("/").filter((s) => s.length > 0);
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  if (segments[0] === "api") {
    if (segments[1] === "approvals" && segments.length === 3 && method === "GET") return { kind: "getApproval", id: decode(segments[2]) };
    if (segments[1] === "approvals" && segments.length === 4 && segments[3] === "transition" && method === "POST") {
      return { kind: "transition", id: decode(segments[2]) };
    }
    if (segments[1] === "runs" && segments.length === 4 && segments[3] === "approvals" && method === "GET") {
      return { kind: "runApprovals", id: decode(segments[2]) };
    }
    if (segments[1] === "feedback" && segments.length === 3 && method === "GET") return { kind: "feedback", id: decode(segments[2]) };
  }

  return { kind: "unknown" };
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

// --- Handler principal ------------------------------------------------------

export async function handleWorkerRequest(request: Request, env: Env, runtime: WorkerRuntime = createRuntime(env)): Promise<Response> {
  const url = new URL(request.url);
  const route = resolveRoute(request.method.toUpperCase(), url.pathname);

  switch (route.kind) {
    case "health":
      // Deliberadamente mudo sobre la configuracion: no dice que
      // secretos hay, ni si D1 responde, ni la version desplegada.
      return json({ ok: true }, API_STATUS.ok);

    case "telegramWebhook":
      return handleTelegramWebhook(request, env, runtime);

    default:
      break;
  }

  // A partir de aqui, todo es API de servicio: bearer obligatorio.
  const serviceToken = readEnv(env, "SERVICE_TOKEN");
  const provided = parseBearerToken(request.headers.get(SERVICE_AUTH_HEADER));
  if (!constantTimeEquals(provided, serviceToken)) {
    runtime.log(logEntry(runtime, "api_unauthorized", "Bearer de servicio ausente o incorrecto."));
    return unauthorized();
  }

  switch (route.kind) {
    case "createApproval":
      return handleCreateApproval(request, env, runtime);
    case "getApproval":
      return handleGetApproval(route.id ?? "", runtime);
    case "transition":
      return handleTransition(request, route.id ?? "", runtime);
    case "runApprovals":
      return handleRunApprovals(route.id ?? "", runtime);
    case "feedback":
      return handleFeedback(route.id ?? "", runtime);
    default:
      return apiError("not_found", "Esa ruta no existe en este Worker.", API_STATUS.notFound);
  }
}

function logEntry(runtime: WorkerRuntime, event: string, detail: string, extra: Partial<WorkerLogEvent> = {}): WorkerLogEvent {
  return {
    event,
    approvalId: null,
    departmentRunId: null,
    recommendationId: null,
    statusBefore: null,
    statusAfter: null,
    telegramUpdateId: null,
    githubRunId: null,
    timestamp: runtime.now().toISOString(),
    detail,
    ...extra,
  };
}

// --- Webhook de Telegram ----------------------------------------------------

async function handleTelegramWebhook(request: Request, env: Env, runtime: WorkerRuntime): Promise<Response> {
  const expected = readEnv(env, "TELEGRAM_WEBHOOK_SECRET");
  const provided = request.headers.get(TELEGRAM_SECRET_HEADER);
  if (!constantTimeEquals(String(provided ?? ""), expected)) {
    // Sin cuerpo util: un endpoint publico no confirma ni que existe un
    // bot detras ni por que ha fallado.
    runtime.log(logEntry(runtime, "webhook_bad_secret", "Cabecera de secreto del webhook ausente o incorrecta."));
    return unauthorized();
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    runtime.log(logEntry(runtime, "webhook_bad_body", "El cuerpo del webhook no es un objeto JSON valido."));
    return apiError("bad_request", "El cuerpo no es un update de Telegram valido.", API_STATUS.badRequest);
  }

  const result = await handleTelegramUpdate(parsed.body as TelegramUpdate, {
    store: runtime.store,
    telegram: runtime.telegram,
    githubDispatch: runtime.githubDispatch,
    now: runtime.now,
    config: { allowedChatId: readEnv(env, "TELEGRAM_ALLOWED_CHAT_ID"), allowedUserId: readEnv(env, "TELEGRAM_ALLOWED_USER_ID") },
    log: runtime.log,
  });

  // SIEMPRE 200 una vez autenticado y procesado, incluso si el actor no
  // estaba autorizado o no habia nada que hacer: un no-2xx haria que
  // Telegram reintentara el MISMO update indefinidamente, y ya se ha
  // registrado como procesado. El detalle va en el log, no en el cuerpo.
  return json({ ok: true, outcome: result.outcome }, API_STATUS.ok);
}

// --- API de servicio --------------------------------------------------------

/**
 * Crear una aprobacion e (solo la primera vez) MANDAR la solicitud por
 * Telegram con sus botones.
 *
 * El envio vive aqui y no en GitHub Actions porque el token del bot es un
 * secreto del Worker (`ENV_VAR_NAMES.workerTelegramBotToken`) y Actions
 * no lo tiene. Y va atado a `created === true` a proposito: un reintento
 * del workflow no puede producir un segundo mensaje con botones vivos
 * para el mismo cambio.
 */
async function handleCreateApproval(request: Request, env: Env, runtime: WorkerRuntime): Promise<Response> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return apiError("bad_request", "El cuerpo debe ser un objeto JSON con la aprobacion.", API_STATUS.badRequest);

  const approval = parsed.body as unknown as Approval;
  if (typeof approval.changeId !== "string" || approval.changeId.trim().length === 0) {
    return apiError("bad_request", "Falta `changeId`: sin identidad estable no se puede crear ni deduplicar una aprobacion.", API_STATUS.badRequest);
  }
  if (!isDepartmentChangeStatus(approval.status)) {
    return apiError("bad_request", "El `status` no es un estado declarado en la maquina de estados.", API_STATUS.badRequest);
  }

  const created = await runtime.store.create(approval);
  let stored = created.approval;

  if (created.created && stored.status === "awaiting_approval") {
    stored = await sendApprovalRequest(stored, env, runtime);
  }

  runtime.log(
    logEntry(runtime, created.created ? "approval_created" : "approval_create_replay", created.created ? "Aprobacion creada." : "Ya existia: se devuelve la persistida sin tocarla.", {
      approvalId: stored.changeId,
      departmentRunId: stored.departmentRunId,
      recommendationId: stored.recommendationId,
      statusAfter: stored.status,
    })
  );

  return json({ ok: true, created: created.created, approval: stored }, created.created ? API_STATUS.created : API_STATUS.ok);
}

/** Envia el mensaje con botones y anota lo que Telegram confirmo. Un fallo de envio NO invalida la aprobacion creada. */
async function sendApprovalRequest(approval: Approval, env: Env, runtime: WorkerRuntime): Promise<Approval> {
  const chatId = readEnv(env, "TELEGRAM_ALLOWED_CHAT_ID");
  if (chatId.length === 0) {
    runtime.log(logEntry(runtime, "approval_notify_skipped", "No hay chat autorizado configurado: no se envia ninguna solicitud.", { approvalId: approval.changeId }));
    return approval;
  }

  const sent = await runtime.telegram.sendMessage({
    chatId,
    text: buildApprovalRequestMessage(approval),
    buttons: buildApprovalButtons(approval.changeId, approval.staging?.url ?? ""),
  });

  if (!sent.ok) {
    runtime.log(logEntry(runtime, "approval_notify_failed", sent.detail, { approvalId: approval.changeId }));
    return approval;
  }

  // `sentAt` es lo que acota la ventana de validez de 72 h: se anota la
  // hora REAL del envio confirmado, nunca la de la creacion del registro.
  const at = runtime.now().toISOString();
  const patch: ApprovalPatch = {
    telegram: {
      telegramApprovalId: approval.changeId,
      telegramMessageId: sent.messageId,
      chatId,
      sentAt: at,
      stagingVersionHash: approval.telegram?.stagingVersionHash ?? approval.staging?.resultingVersionHash ?? "",
    },
  };
  const annotated = await runtime.store.annotate(approval.changeId, patch, { event: "telegram_request_sent", detail: "Solicitud de aprobacion enviada a Telegram." }, at);
  return annotated ?? approval;
}

async function handleGetApproval(approvalId: string, runtime: WorkerRuntime): Promise<Response> {
  const approval = await runtime.store.get(approvalId);
  if (!approval) return apiError("not_found", "No hay ninguna aprobacion con ese id.", API_STATUS.notFound);
  return json({ ok: true, approval }, API_STATUS.ok);
}

/**
 * Transicion condicional por HTTP -- lo que usa el workflow de produccion
 * para pasar de `production_queued` a `production_applying` y de ahi al
 * final. La condicionalidad es la misma que en Telegram: si dos runs
 * intentaran empezar el mismo apply, solo uno gana y el otro recibe 409.
 */
async function handleTransition(request: Request, approvalId: string, runtime: WorkerRuntime): Promise<Response> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return apiError("bad_request", "El cuerpo debe ser un objeto JSON.", API_STATUS.badRequest);

  const body = parsed.body as unknown as TransitionRequestBody;
  const expectedFrom = Array.isArray(body.expectedFrom) ? body.expectedFrom : [];
  if (expectedFrom.length === 0 || !expectedFrom.every(isDepartmentChangeStatus)) {
    return apiError("bad_request", "`expectedFrom` debe ser una lista no vacia de estados validos: no existen las transiciones incondicionales.", API_STATUS.badRequest);
  }
  if (!isDepartmentChangeStatus(body.to)) {
    return apiError("bad_request", "`to` no es un estado declarado en la maquina de estados.", API_STATUS.badRequest);
  }
  const audit = body.audit;
  if (!audit || typeof audit.event !== "string" || typeof audit.detail !== "string") {
    return apiError("bad_request", "Falta `audit.event`/`audit.detail`: ningun cambio de estado se escribe sin dejar rastro de por que.", API_STATUS.badRequest);
  }

  const outcome = await runtime.store.transition({
    approvalId,
    expectedFrom: expectedFrom as DepartmentChangeStatus[],
    to: body.to as DepartmentChangeStatus,
    patch: (body.patch ?? undefined) as ApprovalPatch | undefined,
    audit: { event: audit.event, detail: audit.detail },
    at: typeof body.at === "string" && body.at.length > 0 ? body.at : runtime.now().toISOString(),
  });

  if (outcome.ok) {
    runtime.log(
      logEntry(runtime, "api_transition", audit.event, {
        approvalId: outcome.approval.changeId,
        departmentRunId: outcome.approval.departmentRunId,
        recommendationId: outcome.approval.recommendationId,
        statusAfter: outcome.approval.status,
        githubRunId: outcome.approval.production?.githubRunId ?? null,
      })
    );
    return json({ ok: true, approval: outcome.approval }, API_STATUS.ok);
  }

  runtime.log(logEntry(runtime, "api_transition_rejected", `Transicion rechazada: ${outcome.reason}.`, { approvalId, statusBefore: outcome.currentStatus }));

  const status =
    outcome.reason === "not_found" ? API_STATUS.notFound : outcome.reason === "illegal_transition" ? API_STATUS.badRequest : API_STATUS.conflict;
  return json({ ok: false, reason: outcome.reason, currentStatus: outcome.currentStatus, approval: outcome.approval }, status);
}

async function handleRunApprovals(departmentRunId: string, runtime: WorkerRuntime): Promise<Response> {
  const approvals = await runtime.store.listByRun(departmentRunId);
  return json({ ok: true, approvals }, API_STATUS.ok);
}

async function handleFeedback(recommendationId: string, runtime: WorkerRuntime): Promise<Response> {
  const feedback = await runtime.store.listHumanFeedback(recommendationId);
  return json({ ok: true, feedback }, API_STATUS.ok);
}

// --- Export del Worker ------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleWorkerRequest(request, env);
    } catch (err) {
      // Nunca se devuelve el error real: un stack trace puede llevar
      // dentro una URL con token. Se registra un evento acotado y se
      // responde con un 500 mudo.
      const detail = err instanceof Error ? err.name : "error desconocido";
      console.log(JSON.stringify({ event: "worker_unhandled_error", detail, timestamp: new Date().toISOString() }));
      return apiError("internal_error", "El Worker no pudo completar la peticion.", 500);
    }
  },
};
