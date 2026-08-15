/**
 * CONTRATO HTTP entre GitHub Actions y el Worker de aprobaciones.
 *
 * Solo existen DOS clientes del datastore, y este fichero es la frontera
 * entre ellos:
 *
 *   - El Worker de Cloudflare habla con D1 directamente.
 *   - GitHub Actions habla con el Worker por HTTPS. NUNCA tiene
 *     credenciales de la base de datos: solo un token de servicio con el
 *     que puede crear aprobaciones y avanzar el carril de produccion.
 *
 * Modulo RUNTIME-AGNOSTICO (solo tipos y constantes): lo importan los dos
 * lados.
 *
 * Rutas, todas bajo `/api/`:
 *
 *   POST /api/approvals                      crear (idempotente por approvalId)
 *   GET  /api/approvals/:id                  leer
 *   POST /api/approvals/:id/transition       transicion condicional
 *   GET  /api/runs/:departmentRunId/approvals listar las de una pasada
 *   GET  /api/feedback/:recommendationId     feedback humano previo
 *
 * Y, fuera de `/api/`, el unico endpoint publico:
 *
 *   POST /telegram/webhook                   webhook de Telegram
 *
 * Los dos caminos se autentican de forma DISTINTA y con secretos
 * distintos, a proposito: el webhook con el `secret_token` de Telegram,
 * la API de servicio con un bearer propio. Comprometer uno no da acceso
 * al otro.
 */

/** Cabecera del bearer de servicio que usa GitHub Actions. */
export const SERVICE_AUTH_HEADER = "authorization";

/** Cabecera con la que Telegram firma cada entrega del webhook (`secret_token` de `setWebhook`). */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

export const API_ROUTES = {
  createApproval: "/api/approvals",
  approval: (approvalId: string) => `/api/approvals/${encodeURIComponent(approvalId)}`,
  transition: (approvalId: string) => `/api/approvals/${encodeURIComponent(approvalId)}/transition`,
  runApprovals: (departmentRunId: string) => `/api/runs/${encodeURIComponent(departmentRunId)}/approvals`,
  feedback: (recommendationId: string) => `/api/feedback/${encodeURIComponent(recommendationId)}`,
  telegramWebhook: "/telegram/webhook",
  health: "/health",
} as const;

export interface ApiErrorBody {
  error: string;
  /** Motivo legible. Nunca contiene secretos ni contenido sensible. */
  detail: string;
}

/** Codigos de estado que el cliente de Actions interpreta de forma explicita. */
export const API_STATUS = {
  ok: 200,
  created: 201,
  /** Transicion condicional perdida (otro actor gano la carrera, o el estado ya no es el esperado). */
  conflict: 409,
  unauthorized: 401,
  notFound: 404,
  badRequest: 400,
} as const;

/**
 * Nombres de variables de entorno. Se declaran aqui una sola vez para
 * que el codigo, la documentacion y el IaC no se desincronicen. NUNCA
 * aparecen valores en el repositorio.
 */
export const ENV_VAR_NAMES = {
  /** GitHub Actions: URL base del Worker (p.ej. https://zentry-approvals.<sub>.workers.dev). */
  approvalsApiUrl: "APPROVALS_API_URL",
  /** GitHub Actions: bearer de servicio para hablar con el Worker. */
  approvalsApiToken: "APPROVALS_API_TOKEN",
  /** Worker: el mismo bearer, para validarlo. */
  workerServiceToken: "SERVICE_TOKEN",
  /** Worker: `secret_token` configurado en setWebhook de Telegram. */
  workerTelegramWebhookSecret: "TELEGRAM_WEBHOOK_SECRET",
  /** Worker: token del bot, para responder mensajes. */
  workerTelegramBotToken: "TELEGRAM_BOT_TOKEN",
  /** Worker: unico usuario de Telegram autorizado a decidir. */
  workerTelegramUserId: "TELEGRAM_ALLOWED_USER_ID",
  /** Worker: unico chat autorizado. */
  workerTelegramChatId: "TELEGRAM_ALLOWED_CHAT_ID",
  /** Worker: credencial con la que dispara el workflow de produccion. */
  workerGithubToken: "GITHUB_DISPATCH_TOKEN",
  /** Worker: `owner/repo` destino del dispatch. */
  workerGithubRepo: "GITHUB_REPOSITORY",
  /** Worker: nombre del workflow de produccion a disparar. */
  workerGithubWorkflow: "GITHUB_PRODUCTION_WORKFLOW",
  /** Worker: rama sobre la que lanzar el workflow. */
  workerGithubRef: "GITHUB_WORKFLOW_REF",
} as const;

// --- Cuerpos de peticion/respuesta -----------------------------------------

export interface TransitionRequestBody {
  expectedFrom: string[];
  to: string;
  audit: { event: string; detail: string };
  patch?: Record<string, unknown>;
  at?: string;
}

export interface TransitionResponseBody {
  ok: boolean;
  reason?: "conflict" | "not_found" | "illegal_transition";
  currentStatus?: string | null;
  approval?: unknown;
}

/** El unico dato que viaja en el dispatch a GitHub. Nada de especificaciones ni contenido. */
export interface ProductionDispatchInputs {
  approvalId: string;
}
