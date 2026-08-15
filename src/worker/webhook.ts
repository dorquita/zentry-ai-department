import { Approval, ApprovalStore } from "../approvals/store";
import { DepartmentChangeStatus } from "../department/apply/state-machine";
import {
  authorizeTelegramActor,
  checkApprovalPreconditions,
  checkRejectionAllowed,
  validateRejectionReason,
} from "../department/apply/telegram-decisions";
import {
  buildRejectionReasonPrompt,
  buildRejectionRecordedMessage,
  buildViewChangesMessage,
  parseDepartmentCallbackData,
} from "../department/apply/telegram-message";
import { GithubDispatchPort } from "./github-dispatch";
import { TelegramPort } from "./telegram-client";

/**
 * LOGICA DEL WEBHOOK DE TELEGRAM -- modulo PURO.
 *
 * No abre conexiones, no lee variables de entorno, no mira el reloj del
 * sistema y no conoce HTTP. Recibe el update YA parseado, un
 * `ApprovalStore` y los puertos de Telegram/GitHub/reloj inyectados, y
 * devuelve un `WebhookResult` que describe EXACTAMENTE lo que hizo. Todo
 * el fichero se puede testear sin red y sin base de datos, que es
 * justamente lo que hace verificables las reglas de abajo.
 *
 * ORDEN DE LAS COMPROBACIONES, que no es negociable:
 *
 *  1. IDEMPOTENCIA PRIMERO. `markUpdateProcessed` antes que nada. Telegram
 *     reenvia el mismo update si el webhook tarda o falla, y un reenvio de
 *     un APROBAR no puede producir un segundo encolado.
 *  2. AUTORIZACION DESPUES, y en silencio. Un chat o un usuario no
 *     autorizado NO recibe respuesta: contestarle confirmaria que el bot
 *     existe y que ese endpoint hace algo. Se registra en el log y punto.
 *  3. Cada cambio de estado va por una transicion CONDICIONAL del store.
 *     Ninguna decision se toma leyendo el estado y escribiendolo despues.
 *
 * LO QUE ESTE MODULO NUNCA HACE:
 *
 *  - Publicar en produccion. El Worker no conoce WordPress, no tiene sus
 *    credenciales y no sabe que hay que escribir. Como mucho ENCOLA
 *    (`production_queued`) y dispara el workflow de GitHub Actions.
 *  - Comprobar el anti-TOCTOU de la version de staging. Eso exige releer
 *    WordPress, y quien lo hace es el workflow de produccion antes de
 *    escribir nada (`checkApprovedVersionStillCurrent`). Aqui se registra
 *    la decision humana; alli se comprueba que sigue siendo aplicable.
 */

// --- Forma de un update de Telegram (solo lo que se usa) --------------------

export interface TelegramUser {
  id?: number | string;
  username?: string;
}

export interface TelegramChat {
  id?: number | string;
}

export interface TelegramMessage {
  message_id?: number;
  chat?: TelegramChat;
  from?: TelegramUser;
  text?: string;
  /** Mensaje al que este responde. Es lo que correlaciona un motivo con SU rechazo. */
  reply_to_message?: { message_id?: number };
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// --- Log estructurado -------------------------------------------------------

/**
 * Una linea de log = un objeto JSON con estos campos y NADA mas.
 * Prohibido: tokens, secretos, cuerpos completos de update y textos de
 * usuario. El motivo de un rechazo es contenido humano y se guarda en
 * D1, no se replica en los logs.
 */
export interface WorkerLogEvent {
  event: string;
  approvalId: string | null;
  departmentRunId: string | null;
  recommendationId: string | null;
  statusBefore: DepartmentChangeStatus | null;
  statusAfter: DepartmentChangeStatus | null;
  telegramUpdateId: number | null;
  githubRunId: string | null;
  timestamp: string;
  /** Motivo legible de lo ocurrido. Nunca contiene secretos ni texto del usuario. */
  detail: string;
}

export type WorkerLogger = (entry: WorkerLogEvent) => void;

// --- Puertos y resultado ----------------------------------------------------

export interface WebhookConfig {
  /** Unico chat autorizado. Vacio = fail-closed, no se acepta ninguna decision. */
  allowedChatId: string;
  /** Unico usuario autorizado. Vacio = la autorizacion se apoya solo en el chat. */
  allowedUserId: string;
}

export interface WebhookDeps {
  store: ApprovalStore;
  telegram: TelegramPort;
  githubDispatch: GithubDispatchPort;
  /** Reloj inyectado: sin esto, la caducidad de una aprobacion no seria testeable. */
  now: () => Date;
  config: WebhookConfig;
  log: WorkerLogger;
}

export type WebhookOutcome =
  /** Update ya visto. No se hizo NADA. */
  | "replay"
  /** Chat o usuario no autorizado. No se hizo nada y no se respondio al chat. */
  | "unauthorized"
  /** Update entendido pero sin accion aplicable (callback desconocido, texto sin rechazo abierto...). */
  | "ignored"
  /** Se respondio con el detalle de los cambios. */
  | "viewed"
  /** Se abrio la peticion del motivo del rechazo. */
  | "rejection_prompted"
  /** Rechazo cerrado con motivo guardado. */
  | "rejection_recorded"
  /** Aprobado Y encolado Y disparado el workflow. */
  | "queued_for_production"
  /** Se encolo pero el dispatch fallo: el cambio queda `blocked` y NO se ha publicado nada. */
  | "dispatch_failed"
  /** Otro actor llego antes (doble pulsacion, callback viejo). Sin efectos. */
  | "conflict"
  /** Las precondiciones no permiten decidir (caducado, ya resuelto, no encontrado). */
  | "precondition_failed";

export interface WebhookResult {
  outcome: WebhookOutcome;
  approvalId: string | null;
  /** `true` SOLO si se llamo de verdad al dispatch de GitHub. Es lo que verifica "un unico dispatch". */
  dispatched: boolean;
  /** Motivo legible de la decision tomada. Siempre no vacio. */
  detail: string;
}

// --- Utilidades puras -------------------------------------------------------

function idToString(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/** Identidad del decisor TAL COMO la reporta Telegram. Nunca se inventa ni se completa. */
export function describeActor(user: TelegramUser | undefined): string {
  const id = idToString(user?.id);
  const username = String(user?.username ?? "").trim();
  if (id.length === 0) return "telegram:(sin autor reportado)";
  return username.length > 0 ? `telegram:${id} (@${username})` : `telegram:${id}`;
}

interface Actor {
  chatId: string;
  userId: string;
  user: TelegramUser | undefined;
}

function extractActor(update: TelegramUpdate): Actor {
  const source = update.callback_query ? update.callback_query.message : update.message;
  const from = update.callback_query ? update.callback_query.from : update.message?.from;
  return { chatId: idToString(source?.chat?.id), userId: idToString(from?.id), user: from };
}

// --- Handler ----------------------------------------------------------------

export async function handleTelegramUpdate(update: TelegramUpdate, deps: WebhookDeps): Promise<WebhookResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const updateId = typeof update?.update_id === "number" && Number.isFinite(update.update_id) ? update.update_id : null;

  const log = (entry: Partial<WorkerLogEvent> & { event: string; detail: string }): void => {
    deps.log({
      approvalId: null,
      departmentRunId: null,
      recommendationId: null,
      statusBefore: null,
      statusAfter: null,
      githubRunId: null,
      telegramUpdateId: updateId,
      timestamp: nowIso,
      ...entry,
    });
  };

  // Un update sin `update_id` no se puede deduplicar. Fail-closed: si no
  // se puede garantizar que no es un reenvio, no se actua.
  if (updateId === null) {
    log({ event: "webhook_update_without_id", detail: "El update no trae un update_id numerico: sin idempotencia posible, no se actua." });
    return { outcome: "ignored", approvalId: null, dispatched: false, detail: "Update sin update_id: no se puede deduplicar, no se actua." };
  }

  // 1. IDEMPOTENCIA ANTES QUE NADA.
  const processed = await deps.store.markUpdateProcessed(updateId, nowIso);
  if (!processed.isNew) {
    log({ event: "webhook_replay_ignored", detail: "Este update_id ya se habia procesado. Reenvio de Telegram: no se repite ninguna accion." });
    return { outcome: "replay", approvalId: null, dispatched: false, detail: "Update ya procesado: reenvio ignorado sin efectos." };
  }

  // 2. AUTORIZACION, y en silencio si falla.
  const actor = extractActor(update);
  const authorization = authorizeTelegramActor({
    chatId: actor.chatId,
    authorizedChatId: deps.config.allowedChatId,
    fromUserId: actor.userId,
    authorizedUserId: deps.config.allowedUserId,
  });
  if (!authorization.authorized) {
    // NO se responde al chat: contestar confirmaria que el bot existe.
    log({ event: "webhook_unauthorized", detail: authorization.reason });
    return { outcome: "unauthorized", approvalId: null, dispatched: false, detail: authorization.reason };
  }

  const context: HandlerContext = { deps, actor, nowIso, now, updateId, log };

  if (update.callback_query) return handleCallback(update.callback_query, context);
  if (update.message && typeof update.message.text === "string") return handleTextMessage(update.message, context);

  log({ event: "webhook_update_ignored", detail: "El update no es ni un callback de boton ni un mensaje de texto: no hay nada que hacer." });
  return { outcome: "ignored", approvalId: null, dispatched: false, detail: "Tipo de update sin accion asociada." };
}

interface HandlerContext {
  deps: WebhookDeps;
  actor: Actor;
  nowIso: string;
  now: Date;
  updateId: number;
  log: (entry: Partial<WorkerLogEvent> & { event: string; detail: string }) => void;
}

/**
 * Envia un mensaje sin dejar que un fallo de Telegram altere el estado ya
 * decidido. Si el bot no puede contestar, el registro en D1 SIGUE siendo
 * la verdad: se anota el fallo en el log y se sigue.
 */
async function notify(ctx: HandlerContext, text: string, replyToMessageId?: number | null): Promise<number | null> {
  const result = await ctx.deps.telegram.sendMessage({ chatId: ctx.actor.chatId, text, replyToMessageId: replyToMessageId ?? null });
  if (!result.ok) {
    ctx.log({ event: "telegram_send_failed", detail: result.detail });
  }
  return result.messageId;
}

/** Apaga el reloj del boton. Un fallo aqui es cosmetico: no cambia ninguna decision. */
async function acknowledge(ctx: HandlerContext, callbackQueryId: string, text?: string): Promise<void> {
  const result = await ctx.deps.telegram.answerCallbackQuery({ callbackQueryId, text });
  if (!result.ok) {
    ctx.log({ event: "telegram_answer_callback_failed", detail: result.detail });
  }
}

function traceOf(approval: Approval | null | undefined): Pick<WorkerLogEvent, "approvalId" | "departmentRunId" | "recommendationId"> {
  return {
    approvalId: approval?.changeId ?? null,
    departmentRunId: approval?.departmentRunId ?? null,
    recommendationId: approval?.recommendationId ?? null,
  };
}

async function handleCallback(callback: TelegramCallbackQuery, ctx: HandlerContext): Promise<WebhookResult> {
  const parsed = parseDepartmentCallbackData(String(callback.data ?? ""));
  if (!parsed) {
    // Callback desconocido: puede ser de otro flujo del proyecto
    // (`appr:`) o de un mensaje muy antiguo. Se acusa recibo para que el
    // boton no se quede girando, y no se toca nada.
    await acknowledge(ctx, callback.id, "No reconozco ese boton.");
    ctx.log({ event: "callback_unknown", detail: "callback_data que no pertenece al flujo del departamento. No se hace nada." });
    return { outcome: "ignored", approvalId: null, dispatched: false, detail: "callback_data desconocido: sin accion." };
  }

  const approvalId = parsed.approvalRequestId;
  if (parsed.action === "view") return handleView(callback, approvalId, ctx);
  if (parsed.action === "reject") return handleReject(callback, approvalId, ctx);
  return handleApprove(callback, approvalId, ctx);
}

/** "VER CAMBIOS": solo lee y responde. Nunca cambia el estado. */
async function handleView(callback: TelegramCallbackQuery, approvalId: string, ctx: HandlerContext): Promise<WebhookResult> {
  const approval = await ctx.deps.store.get(approvalId);
  await acknowledge(ctx, callback.id);

  if (!approval) {
    await notify(ctx, "No encuentro ningun cambio del departamento asociado a ese boton. Puede ser un mensaje antiguo de una version que ya no existe.");
    ctx.log({ event: "view_not_found", approvalId, detail: "No hay ninguna aprobacion con ese id." });
    return { outcome: "precondition_failed", approvalId, dispatched: false, detail: "La aprobacion no existe." };
  }

  await notify(ctx, buildViewChangesMessage(approval));
  ctx.log({ ...traceOf(approval), event: "view_changes_sent", statusBefore: approval.status, statusAfter: approval.status, detail: "Enviado el detalle real del apply en staging. Produccion no se ha tocado." });
  return { outcome: "viewed", approvalId, dispatched: false, detail: "Detalle de los cambios enviado." };
}

/**
 * "RECHAZAR" no cierra el rechazo: abre `awaiting_rejection_reason`. El
 * rechazo no es feedback hasta que hay un motivo escrito.
 */
async function handleReject(callback: TelegramCallbackQuery, approvalId: string, ctx: HandlerContext): Promise<WebhookResult> {
  const approval = await ctx.deps.store.get(approvalId);
  const allowed = checkRejectionAllowed(approval ?? undefined);
  await acknowledge(ctx, callback.id);

  if (!allowed.allowed) {
    await notify(ctx, allowed.reply);
    ctx.log({ ...traceOf(approval), event: "reject_not_allowed", statusBefore: approval?.status ?? null, detail: allowed.reason });
    return { outcome: "precondition_failed", approvalId, dispatched: false, detail: allowed.reason };
  }

  const moved = await ctx.deps.store.transition({
    approvalId,
    expectedFrom: ["awaiting_approval"],
    to: "awaiting_rejection_reason",
    audit: { event: "telegram_reject_pressed", detail: "Rechazo abierto desde Telegram. Falta el motivo para cerrarlo." },
    at: ctx.nowIso,
  });

  if (!moved.ok) {
    // Alguien decidio entre el `get` y el `UPDATE`. Sin efectos.
    const reply =
      moved.reason === "not_found"
        ? "No encuentro ningun cambio del departamento asociado a ese boton."
        : `Ese cambio ya no esta esperando decision (estado actual: ${moved.currentStatus ?? "desconocido"}). No hago nada.`;
    await notify(ctx, reply);
    ctx.log({ ...traceOf(moved.approval), event: "reject_conflict", statusBefore: moved.currentStatus, detail: `Transicion a awaiting_rejection_reason perdida: ${moved.reason}.` });
    return { outcome: moved.reason === "not_found" ? "precondition_failed" : "conflict", approvalId, dispatched: false, detail: `No se pudo abrir el rechazo: ${moved.reason}.` };
  }

  // Se envia PRIMERO para conocer el `message_id` del mensaje que hace la
  // pregunta: ese id es lo que despues permite correlacionar la respuesta
  // por `reply_to_message_id` aunque haya varios rechazos abiertos.
  const promptMessageId = await notify(ctx, buildRejectionReasonPrompt(moved.approval));
  await ctx.deps.store.openRejectionPrompt({
    approvalId,
    chatId: ctx.actor.chatId,
    userId: ctx.actor.userId,
    promptMessageId,
    createdAt: ctx.nowIso,
  });

  ctx.log({
    ...traceOf(moved.approval),
    event: "rejection_prompt_opened",
    statusBefore: "awaiting_approval",
    statusAfter: "awaiting_rejection_reason",
    detail: "Pedido el motivo del rechazo. Produccion no se ha tocado.",
  });
  return { outcome: "rejection_prompted", approvalId, dispatched: false, detail: "Rechazo abierto: esperando motivo." };
}

/**
 * "APROBAR". Los cinco pasos, en este orden, y cada cambio de estado por
 * una transicion condicional:
 *
 *   1. precondiciones (caducidad, doble decision, estado)
 *   2. awaiting_approval -> approved     (registra la decision HUMANA)
 *   3. approved -> production_queued     (ESTA es la que garantiza UN solo dispatch)
 *   4. dispatch del workflow, SOLO si (3) la gano este actor
 *   5. acuse por Telegram
 */
async function handleApprove(callback: TelegramCallbackQuery, approvalId: string, ctx: HandlerContext): Promise<WebhookResult> {
  const approval = await ctx.deps.store.get(approvalId);
  const preconditions = checkApprovalPreconditions(approval ?? undefined, ctx.now);
  await acknowledge(ctx, callback.id);

  if (!preconditions.proceed) {
    // Caducada: ademas de contestar, se marca como tal para que ese
    // boton no vuelva a poder usarse nunca.
    if (preconditions.nextStatus) {
      const stale = await ctx.deps.store.transition({
        approvalId,
        expectedFrom: ["awaiting_approval"],
        to: preconditions.nextStatus,
        audit: { event: "telegram_approval_stale", detail: preconditions.reason },
        at: ctx.nowIso,
      });
      ctx.log({
        ...traceOf(stale.ok ? stale.approval : approval),
        event: "approve_precondition_failed",
        statusBefore: approval?.status ?? null,
        statusAfter: stale.ok ? preconditions.nextStatus : null,
        detail: preconditions.reason,
      });
    } else {
      ctx.log({ ...traceOf(approval), event: "approve_precondition_failed", statusBefore: approval?.status ?? null, detail: preconditions.reason });
    }
    await notify(ctx, preconditions.reply);
    return { outcome: "precondition_failed", approvalId, dispatched: false, detail: preconditions.reason };
  }

  // 2. Decision humana registrada en la MISMA operacion atomica que el estado.
  const approved = await ctx.deps.store.transition({
    approvalId,
    expectedFrom: ["awaiting_approval"],
    to: "approved",
    patch: {
      humanDecision: {
        decision: "approved",
        decidedBy: describeActor(ctx.actor.user),
        decidedAt: ctx.nowIso,
        rejectionReason: "",
        channel: "telegram",
      },
    },
    audit: { event: "telegram_approved", detail: "Aprobacion humana registrada desde Telegram." },
    at: ctx.nowIso,
  });

  if (!approved.ok) {
    const reply =
      approved.reason === "not_found"
        ? "No encuentro ningun cambio del departamento asociado a ese boton."
        : `Ese cambio ya tenia decision (estado actual: ${approved.currentStatus ?? "desconocido"}). No se aprueba dos veces ni se vuelve a publicar.`;
    await notify(ctx, reply);
    ctx.log({ ...traceOf(approved.approval), event: "approve_conflict", statusBefore: approved.currentStatus, detail: `Transicion a approved perdida: ${approved.reason}. Sin dispatch.` });
    return { outcome: approved.reason === "not_found" ? "precondition_failed" : "conflict", approvalId, dispatched: false, detail: `No se pudo aprobar: ${approved.reason}.` };
  }

  // 3. LA transicion que hace segura la arquitectura: solo un actor puede
  //    pasar de `approved` a `production_queued`, asi que solo uno dispara.
  const queued = await ctx.deps.store.transition({
    approvalId,
    expectedFrom: ["approved"],
    to: "production_queued",
    audit: { event: "production_queued", detail: "Encolado para el workflow de produccion de GitHub Actions." },
    at: ctx.nowIso,
  });

  if (!queued.ok) {
    await notify(ctx, `Ese cambio ya estaba encolado o resuelto (estado actual: ${queued.currentStatus ?? "desconocido"}). No se encola dos veces.`);
    ctx.log({ ...traceOf(queued.approval ?? approved.approval), event: "queue_conflict", statusBefore: queued.currentStatus, detail: `Transicion a production_queued perdida: ${queued.reason}. Sin dispatch.` });
    return { outcome: "conflict", approvalId, dispatched: false, detail: `Ya encolado o resuelto: ${queued.reason}. Sin dispatch.` };
  }

  // 4. Solo quien gano (3) dispara. Un unico encolado = un unico dispatch.
  const dispatch = await ctx.deps.githubDispatch.dispatch({ approvalId });

  if (!dispatch.ok) {
    // NUNCA dejar `production_queued` sin dispatch en silencio: ese
    // estado significa "hay un workflow en camino" y seria mentira. Se
    // deja el cambio BLOQUEADO con el motivo y se dice claramente que no
    // se ha publicado nada.
    const blocked = await ctx.deps.store.transition({
      approvalId,
      expectedFrom: ["production_queued"],
      to: "blocked",
      audit: { event: "production_dispatch_failed", detail: dispatch.detail },
      at: ctx.nowIso,
    });
    ctx.log({
      ...traceOf(blocked.ok ? blocked.approval : queued.approval),
      event: "production_dispatch_failed",
      statusBefore: "production_queued",
      statusAfter: blocked.ok ? "blocked" : null,
      detail: dispatch.detail,
    });
    await notify(
      ctx,
      [
        "🚫 NO se ha publicado nada.",
        "",
        "Tu aprobacion quedo registrada, pero no he podido lanzar el proceso de publicacion, asi que el cambio queda BLOQUEADO.",
        "",
        dispatch.detail,
        "",
        "Produccion sigue exactamente como estaba.",
      ].join("\n")
    );
    return { outcome: "dispatch_failed", approvalId, dispatched: true, detail: `Dispatch fallido: ${dispatch.detail}` };
  }

  // 5. Acuse. El Worker NO ha publicado nada: solo ha encolado.
  ctx.log({
    ...traceOf(queued.approval),
    event: "production_dispatch_sent",
    statusBefore: "approved",
    statusAfter: "production_queued",
    githubRunId: dispatch.githubRunId,
    detail: dispatch.detail,
  });
  await notify(
    ctx,
    [
      "✅ Aprobacion registrada.",
      "",
      "El cambio queda ENCOLADO para publicarse en produccion. Lo publica el proceso de despliegue, con snapshot previo y rollback automatico si la validacion falla.",
      "",
      "Te aviso cuando termine.",
    ].join("\n")
  );
  return { outcome: "queued_for_production", approvalId, dispatched: true, detail: "Encolado y workflow de produccion disparado." };
}

/**
 * MENSAJE DE TEXTO -> motivo de un rechazo abierto.
 *
 * La correlacion tiene dos vias, y el orden importa:
 *
 *   1. `reply_to_message_id`: si la persona RESPONDIO a un mensaje
 *      concreto del bot, esa es la aprobacion, sin ambiguedad. Es la
 *      unica via fiable cuando hay dos rechazos abiertos a la vez.
 *   2. Si el mensaje no responde a nada, se usa el unico rechazo abierto
 *      de ese chat+usuario.
 *
 * Y una regla fail-closed: si el mensaje SI responde a algo, pero ese algo
 * no es una pregunta de rechazo conocida, NO se cae a la via 2. La
 * persona apunto explicitamente a otro mensaje, y adivinar podria guardar
 * el motivo en la aprobacion equivocada -- que es exactamente el fallo
 * que no puede ocurrir.
 */
async function handleTextMessage(message: TelegramMessage, ctx: HandlerContext): Promise<WebhookResult> {
  const text = String(message.text ?? "");
  const replyToMessageId = message.reply_to_message?.message_id;

  let prompt = null as Awaited<ReturnType<ApprovalStore["findOpenRejectionPrompt"]>>;
  if (typeof replyToMessageId === "number") {
    prompt = await ctx.deps.store.findRejectionPromptByMessageId(ctx.actor.chatId, replyToMessageId);
    if (!prompt) {
      ctx.log({ event: "rejection_reason_reply_unmatched", detail: "El mensaje responde a algo que no es una pregunta de rechazo abierta. No se adivina a que aprobacion pertenece." });
      return { outcome: "ignored", approvalId: null, dispatched: false, detail: "Respuesta a un mensaje que no es una pregunta de rechazo: se ignora." };
    }
  } else {
    prompt = await ctx.deps.store.findOpenRejectionPrompt(ctx.actor.chatId, ctx.actor.userId);
  }

  if (!prompt) {
    // Ningun rechazo abierto: un mensaje suelto no es una decision.
    ctx.log({ event: "text_without_open_rejection", detail: "Mensaje de texto sin ningun rechazo abierto para ese chat y usuario. Se ignora." });
    return { outcome: "ignored", approvalId: null, dispatched: false, detail: "No hay ningun rechazo abierto: el mensaje no es una decision." };
  }

  const validation = validateRejectionReason(text);
  if (!validation.accepted) {
    // El rechazo SIGUE abierto: no se cierra sin motivo.
    await notify(ctx, validation.reason, prompt.promptMessageId);
    ctx.log({ event: "rejection_reason_invalid", approvalId: prompt.approvalId, detail: validation.reason });
    return { outcome: "ignored", approvalId: prompt.approvalId, dispatched: false, detail: validation.reason };
  }

  const reason = text.trim();
  const rejected = await ctx.deps.store.transition({
    approvalId: prompt.approvalId,
    expectedFrom: ["awaiting_rejection_reason"],
    to: "rejected",
    patch: {
      humanDecision: {
        decision: "rejected",
        decidedBy: describeActor(ctx.actor.user),
        decidedAt: ctx.nowIso,
        // El motivo se guarda TAL CUAL lo escribio la persona: no se
        // resume, no se reinterpreta y no se clasifica.
        rejectionReason: reason,
        channel: "telegram",
      },
    },
    audit: { event: "telegram_rejected", detail: "Rechazo cerrado con motivo humano." },
    at: ctx.nowIso,
  });

  if (!rejected.ok) {
    await notify(ctx, `Ese cambio ya no esta esperando un motivo (estado actual: ${rejected.currentStatus ?? "desconocido"}). No he guardado nada.`);
    ctx.log({ ...traceOf(rejected.approval), event: "rejection_conflict", statusBefore: rejected.currentStatus, detail: `Transicion a rejected perdida: ${rejected.reason}.` });
    return { outcome: rejected.reason === "not_found" ? "precondition_failed" : "conflict", approvalId: prompt.approvalId, dispatched: false, detail: `No se pudo cerrar el rechazo: ${rejected.reason}.` };
  }

  await ctx.deps.store.closeRejectionPrompt(prompt.approvalId);
  await notify(ctx, buildRejectionRecordedMessage(rejected.approval, reason));

  ctx.log({
    ...traceOf(rejected.approval),
    event: "rejection_recorded",
    statusBefore: "awaiting_rejection_reason",
    statusAfter: "rejected",
    // El motivo NO se loguea: es contenido humano y ya vive en D1.
    detail: "Rechazo cerrado con motivo. El motivo queda guardado como feedback. Produccion no se ha tocado.",
  });
  return { outcome: "rejection_recorded", approvalId: prompt.approvalId, dispatched: false, detail: "Rechazo cerrado y motivo guardado." };
}
