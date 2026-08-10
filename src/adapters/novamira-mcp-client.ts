import { assertNovamiraAbilityAllowed, NovamiraGuardContext } from "../core/novamira-guard";

/**
 * Novamira MCP Client — SKELETON, Fase O14. Unico punto de entrada
 * previsto para invocar una ability de Novamira desde este codebase.
 * Ningun otro modulo debe llamar a un cliente MCP directamente: todo
 * pasa primero por `assertNovamiraAbilityAllowed()` aqui dentro, para
 * que sea imposible saltarse el guard por accidente en un futuro
 * adaptador/agente.
 *
 * Hoy no existe ningun cliente MCP real conectado desde Node (mismo
 * estado que src/adapters/wordpress-mcp.ts, Fase O10.5: sin SDK MCP, sin
 * dependencia nueva, sin variable de entorno real) -- esta funcion
 * siempre lanza tras pasar el guard. El dia que se conecte un cliente
 * real, la implementacion entra AQUI, nunca en otro sitio, para que el
 * guard sea estructuralmente imposible de evitar.
 */
export interface NovamiraAbilityCall {
  abilityName: string;
  parameters: Record<string, unknown>;
  guardContext?: NovamiraGuardContext;
}

export async function callNovamiraAbility(call: NovamiraAbilityCall): Promise<never> {
  assertNovamiraAbilityAllowed(call.abilityName, call.guardContext);
  throw new Error(
    `callNovamiraAbility("${call.abilityName}") paso el guard de seguridad (Fase O14) pero no hay ningun cliente MCP real conectado desde Node todavia -- ver src/adapters/wordpress-mcp.ts (Fase O10.5). Esta funcion es un stub de arquitectura; implementar el cliente real (SDK MCP, transporte HTTP/stdio) es una decision futura pendiente, no tomada en esta fase.`
  );
}
