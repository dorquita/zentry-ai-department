import { loadClientConfig, resolveClientId } from "./client-config";

/**
 * Validacion de "enlace interno real" -- usada por el experimento
 * ux-ui-landing-architect-v2 (ver src/core/landing-architect-v2-context.ts)
 * para decidir si un enlace propuesto por un change pack puede usarse
 * como target de un CTA sin mas comprobacion.
 *
 * Version anterior (bug real, corregido tras revision): cualquier string
 * `https?://...` se aceptaba como "interno", incluido un dominio externo
 * cualquiera. Ahora solo se aceptan:
 *   - paths relativos reales (`/algo`) -- nunca protocol-relative
 *     (`//host/algo`, que un navegador resuelve como un host EXTERNO).
 *   - URLs absolutas cuyo host coincide EXACTAMENTE con uno de los hosts
 *     autorizados del cliente activo (produccion/staging, ver
 *     clients/<id>/client.config.json) -- nunca por subcadena/`includes`,
 *     que permitiria bypass con un host tipo "zentrylockers.com.evil.com".
 *
 * No existe un dominio propio de Tukandado en la configuracion de ningun
 * cliente (se vende bajo el mismo dominio que Zentry) -- por eso los
 * hosts autorizados salen de `productionUrl`/`stagingUrl` del cliente
 * activo, no de una lista separada por marca.
 */

function resolveAuthorizedInternalHosts(): Set<string> {
  const config = loadClientConfig(resolveClientId());
  const hosts = new Set<string>();
  hosts.add(new URL(config.productionUrl).hostname.toLowerCase());
  if (config.stagingUrl) {
    hosts.add(new URL(config.stagingUrl).hostname.toLowerCase());
  }
  return hosts;
}

/**
 * `authorizedHosts` es un parametro inyectable (por defecto se resuelve
 * del cliente activo) para que los tests puedan verificar la logica de
 * validacion sin depender de `clients/*.json` real.
 */
export function isRealInternalUrl(value: string, authorizedHosts: Set<string> = resolveAuthorizedInternalHosts()): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  // Path relativo real: empieza por "/" pero NO por "//" -- "//host/algo"
  // es una URL protocol-relative que un navegador resuelve contra un host
  // externo, no un path interno, aunque parezca uno a simple vista.
  if (/^\/(?!\/)\S*$/.test(trimmed)) return true;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const hostname = new URL(trimmed).hostname.toLowerCase();
      return authorizedHosts.has(hostname);
    } catch {
      return false;
    }
  }

  return false;
}
