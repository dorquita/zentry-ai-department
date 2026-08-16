/**
 * INTERRUPTOR del carril de aprobaciones SERVERLESS (Telegram webhook +
 * Cloudflare Worker + D1).
 *
 * Ese carril esta implementado y probado, pero **no desplegado y no
 * activo**. El flujo vigente es manual: Daily Brief numerado por email y
 * aprobacion por prompt (ver docs/manual-approval-flow.md).
 *
 * Con el flag en `false` -- que es el valor por defecto y el unico que
 * hay hoy en produccion -- el sistema NO necesita ninguna
 * infraestructura cloud: ni Worker, ni D1, ni webhook, ni bot, ni
 * `APPROVALS_API_URL`/`APPROVALS_API_TOKEN`. La pasada diaria funciona
 * exactamente igual y el email se envia igual.
 *
 * El codigo se conserva a proposito: reactivarlo es poner el flag a
 * `true` y desplegar lo que dice `infra/cloudflare/README.md`, sin
 * rehacer la arquitectura.
 *
 * Se lee de `process.env` en cada llamada (nunca se cachea) para que
 * cambiarlo no obligue a reiniciar nada.
 */

export const SERVERLESS_APPROVALS_FLAG = "SERVERLESS_APPROVALS_ENABLED";

export function isServerlessApprovalsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env[SERVERLESS_APPROVALS_FLAG] ?? "").trim().toLowerCase() === "true";
}

/**
 * Motivo legible para cuando alguien invoca una pieza del carril
 * serverless estando apagado. Se usa tal cual en la salida de los
 * scripts: nunca se falla en silencio ni se degrada a "no hago nada".
 */
export function serverlessDisabledReason(piece: string): string {
  return (
    `${piece} pertenece al carril de aprobaciones SERVERLESS, que esta DESACTIVADO ` +
    `(${SERVERLESS_APPROVALS_FLAG} != true). El flujo vigente es manual: el Daily Brief ` +
    `llega numerado por email y las decisiones se dan por prompt en Claude Code ` +
    `(ver docs/manual-approval-flow.md). Para reactivar el carril serverless hace falta ` +
    `poner el flag a true y desplegar la infraestructura de infra/cloudflare/README.md.`
  );
}
