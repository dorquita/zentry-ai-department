/**
 * WordPress backend + entorno selector — Fase O10.5 (backend) y O10.6
 * (entorno). Decide DOS cosas independientes, ninguna de las dos decide
 * nada de seguridad por si sola — son capas ADICIONALES, independientes
 * de WORDPRESS_DRAFTS_ENABLED:
 *
 * 1. Que IMPLEMENTACION usaria una escritura real (`WORDPRESS_BACKEND`):
 *    "local_preview" (por defecto — el agente nunca escribe nada real,
 *    pase lo que pase con WORDPRESS_DRAFTS_ENABLED), "rest" (API REST de
 *    WordPress, implementado en src/adapters/wordpress.ts) o "mcp" (NO
 *    implementado, ver docs/wordpress-mcp-adapter.md).
 * 2. A que SITIO apuntaria esa escritura real (`WORDPRESS_ENV`):
 *    "staging" (por defecto — el unico destino de escritura permitido
 *    hoy) o "production" (BLOQUEADO para cualquier escritura, sin
 *    excepcion — ver `assertWordpressWriteAllowed()`). Este bloqueo es
 *    incondicional: no importa si WORDPRESS_DRAFTS_ENABLED=true o que
 *    backend este activo, `WORDPRESS_ENV=production` siempre hace que
 *    cualquier intento de escritura real lance un error ANTES de tocar
 *    la red.
 *
 * Hacen falta las TRES condiciones a la vez (`WORDPRESS_DRAFTS_ENABLED=true`,
 * `WORDPRESS_BACKEND=rest`, `WORDPRESS_ENV=staging`) para que exista la
 * posibilidad de una escritura real hoy — y aun asi, sigue haciendo falta
 * el change pack `approved_to_execute` + la aprobacion de Telegram (ver
 * docs/wordpress-safety-policy.md).
 */
import { resolveActiveClientConfig } from "../core/client-config";

export type WordpressBackend = "local_preview" | "rest" | "mcp";
export type WordpressEnv = "staging" | "production";

const VALID_BACKENDS: WordpressBackend[] = ["local_preview", "rest", "mcp"];
const VALID_ENVS: WordpressEnv[] = ["staging", "production"];

export function resolveWordpressBackend(): WordpressBackend {
  const raw = (process.env.WORDPRESS_BACKEND ?? "local_preview").trim().toLowerCase();
  if ((VALID_BACKENDS as string[]).includes(raw)) {
    return raw as WordpressBackend;
  }
  throw new Error(
    `WORDPRESS_BACKEND desconocido: "${raw}". Valores validos: ${VALID_BACKENDS.join(", ")}. Revisa .env.example.`
  );
}

/**
 * Por defecto "staging" (el valor que se espera tener siempre en
 * `.env`) — pero eso NO habilita nada por si solo: sin
 * WORDPRESS_DRAFTS_ENABLED=true y WORDPRESS_BACKEND=rest, este valor
 * nunca se llega a usar para escribir nada.
 */
export function resolveWordpressEnv(): WordpressEnv {
  const raw = (process.env.WORDPRESS_ENV ?? "staging").trim().toLowerCase();
  if ((VALID_ENVS as string[]).includes(raw)) {
    return raw as WordpressEnv;
  }
  throw new Error(`WORDPRESS_ENV desconocido: "${raw}". Valores validos: ${VALID_ENVS.join(", ")}. Revisa .env.example.`);
}

/**
 * Resuelve la URL base del entorno WordPress ACTIVO. Lanza un error claro
 * si falta el dato correspondiente — nunca usa la URL del otro entorno
 * como fallback silencioso (mezclar staging y produccion por un valor
 * ausente seria exactamente el tipo de fallo que esta fase quiere
 * evitar).
 *
 * Fase O16.1: prefiere `stagingUrl`/`productionUrl` del ClientConfig
 * ACTIVO (`clients/<id>/client.config.json`); si el cliente no define
 * uno (nunca pasa hoy para "zentry"), cae a
 * `WORDPRESS_STAGING_BASE_URL`/`WORDPRESS_PRODUCTION_BASE_URL` de
 * `.env`. Esta funcion NUNCA decide si escribir esta permitido —
 * `resolveWordpressEnv()`/`assertWordpressWriteAllowed()` (sin cambios
 * en esta fase) siguen siendo la unica fuente de esa decision.
 */
export function resolveWordpressTargetUrl(): string {
  const env = resolveWordpressEnv();
  const clientConfig = resolveActiveClientConfig();
  const configuredUrl = env === "staging" ? clientConfig.stagingUrl : clientConfig.productionUrl;
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }
  const varName = env === "staging" ? "WORDPRESS_STAGING_BASE_URL" : "WORDPRESS_PRODUCTION_BASE_URL";
  const raw = process.env[varName];
  if (!raw) {
    throw new Error(`Falta ${varName} en .env (WORDPRESS_ENV activo: "${env}"). Revisa .env.example.`);
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Guardrail incondicional (Fase O10.6): cualquier funcion que este a
 * punto de escribir de verdad en WordPress (hoy solo
 * `createWordpressDraftPage` en src/adapters/wordpress.ts, y el
 * skeleton `createWordpressDraftPageViaMcp`) debe llamar a esto ANTES de
 * tocar la red. Nunca hay una via alternativa para escribir en
 * produccion en este sistema — ni con aprobacion de Telegram, ni con
 * `approved_to_execute`, ni de ninguna otra forma. Producción solo
 * admite lectura, o un futuro deploy manual con aprobacion explicita
 * fuera de este sistema (no implementado).
 */
export function assertWordpressWriteAllowed(): void {
  const env = resolveWordpressEnv();
  if (env === "production") {
    throw new Error(
      'Bloqueado: WORDPRESS_ENV="production". Ninguna escritura real esta permitida contra produccion en este sistema, bajo ninguna circunstancia. El unico destino de escritura permitido hoy es staging (WORDPRESS_ENV="staging"). Ver docs/wordpress-safety-policy.md.'
    );
  }
}
