import { logger } from "../core/logger";

/**
 * n8n Asset Generation Webhook (Fase O12.4: contrato/skeleton; Fase
 * O12.5: implementacion real, gateada). Unico punto de contacto de todo
 * el proyecto con el webhook de n8n que generaria imagenes con IA y las
 * subiria a WordPress staging.
 *
 * El workflow real ya existe en la instancia de n8n del cliente
 * ("Zentry - AI Asset Generation - Staging", INACTIVO, con el nodo de
 * generacion de imagen DESHABILITADO a proposito — ver
 * docs/n8n-asset-generation.md y
 * reports/n8n-workflows/zentry-ai-asset-generation-staging.json). Aunque
 * el workflow existiera activo, esta funcion NUNCA llama por defecto:
 * hacen falta las DOS condiciones a la vez (`N8N_ASSET_GENERATION_ENABLED=true`
 * Y `N8N_ASSET_GENERATION_WEBHOOK_URL` configurada). Sin ambas, lanza un
 * error explicito y no toca la red — mismo espiritu que
 * `isWordpressDraftsEnabled()`/`WORDPRESS_DRAFTS_ENABLED` en
 * `src/adapters/wordpress.ts`.
 */

/** Cuerpo esperado del POST a N8N_ASSET_GENERATION_WEBHOOK_URL. */
export interface N8nAssetGenerationRequest {
  assetRequestId: string;
  prompt: string;
  negativePrompt: string;
  dimensions: { width: number; height: number };
  filenameSuggestion: string;
  altText: string;
  /** Fijo a "staging" en todo este proyecto — nunca "production" (ver docs/wordpress-safety-policy.md). */
  targetEnv: "staging";
  /** Dominio de staging, informativo para el workflow de n8n (no una credencial). */
  targetWordPress: string;
}

/** Forma esperada de la respuesta de n8n. */
export interface N8nAssetGenerationResponse {
  assetRequestId: string;
  status: "generated" | "uploaded_to_wordpress" | "failed";
  imageUrl?: string;
  wordpressMediaId?: number;
  wordpressMediaUrl?: string;
  altText: string;
  fileSize?: number;
  width?: number;
  height?: number;
  error?: string;
}

export function isN8nAssetGenerationEnabled(): boolean {
  return (process.env.N8N_ASSET_GENERATION_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function isN8nAssetWebhookConfigured(): boolean {
  return Boolean(process.env.N8N_ASSET_GENERATION_WEBHOOK_URL);
}

/** Para informes/CLI: nunca devuelve la URL completa, solo si esta configurada y si el interruptor esta activo. */
export function getN8nAssetWebhookStatusForReport(): { enabled: boolean; configured: boolean; canSend: boolean } {
  const enabled = isN8nAssetGenerationEnabled();
  const configured = isN8nAssetWebhookConfigured();
  return { enabled, configured, canSend: enabled && configured };
}

/**
 * Redacta la URL del webhook (y cualquier cosa con forma de token) de un
 * mensaje de error antes de que llegue a un log o a la consola — mismo
 * patron que sanitizeWordpressError()/sanitizeTelegramError().
 */
function sanitizeN8nError(raw: string, webhookUrl: string | undefined): string {
  let safe = raw;
  if (webhookUrl) {
    safe = safe.split(webhookUrl).join("[N8N_WEBHOOK_URL REDACTED]");
  }
  safe = safe.replace(
    /((?:token|secret|key|authorization|bearer)\s*[:=]?\s*)["']?[A-Za-z0-9\-_./+=]{8,}["']?/gi,
    "$1[REDACTED]"
  );
  return safe.length > 500 ? safe.slice(0, 500) + "...[truncated]" : safe;
}

/**
 * Llama de verdad al webhook de n8n — SOLO si `N8N_ASSET_GENERATION_ENABLED=true`
 * Y `N8N_ASSET_GENERATION_WEBHOOK_URL` esta configurada. Sin las dos
 * condiciones a la vez, lanza un error explicito ANTES de tocar la red
 * (no hay ninguna llamada "silenciosa" ni fallback que finja exito).
 *
 * `targetEnv` esta fijado al tipo literal `"staging"` en la firma de
 * `N8nAssetGenerationRequest` — no hay forma de invocar esta funcion con
 * `"production"` sin que TypeScript lo rechace en tiempo de compilacion.
 *
 * Nunca marca nada como `generated`/`uploaded_to_wordpress` de forma
 * optimista: solo devuelve lo que n8n respondio de verdad. Quien llama a
 * esta funcion (`src/agents/visual-asset-planner.ts` en un futuro modo
 * de ejecucion, o `scripts/send-test-asset-request.ts`) es responsable de
 * decidir que hacer con la respuesta — esta funcion no escribe en
 * `data/asset-requests.jsonl`.
 */
export async function requestAssetGeneration(request: N8nAssetGenerationRequest): Promise<N8nAssetGenerationResponse> {
  const webhookUrl = process.env.N8N_ASSET_GENERATION_WEBHOOK_URL;

  if (!isN8nAssetGenerationEnabled()) {
    throw new Error(
      "requestAssetGeneration() bloqueado: N8N_ASSET_GENERATION_ENABLED no es \"true\". No se ha llamado a n8n. Ver docs/n8n-asset-generation.md."
    );
  }
  if (!webhookUrl) {
    throw new Error(
      "requestAssetGeneration() bloqueado: falta N8N_ASSET_GENERATION_WEBHOOK_URL. No se ha llamado a n8n. Ver docs/n8n-asset-generation.md."
    );
  }

  logger.info("n8n adapter: enviando peticion de generacion de asset (solo staging)", {
    assetRequestId: request.assetRequestId,
    targetEnv: request.targetEnv,
  });

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`Fallo de red llamando al webhook de n8n: ${sanitizeN8nError(raw, webhookUrl)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(`El webhook de n8n respondio ${response.status}: ${sanitizeN8nError(bodyText, webhookUrl)}`);
  }

  const json = (await response.json()) as Partial<N8nAssetGenerationResponse>;
  if (typeof json.assetRequestId !== "string" || typeof json.status !== "string") {
    throw new Error(
      "Respuesta inesperada del webhook de n8n (sin assetRequestId/status). No se puede confirmar el resultado; tratar como fallo."
    );
  }

  logger.info("n8n adapter: respuesta recibida", { assetRequestId: json.assetRequestId, status: json.status });
  return json as N8nAssetGenerationResponse;
}
