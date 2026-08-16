import { assertExecutePhpAllowed, ExecutePhpRequest, MCP_EXECUTE_ABILITY_TOOL, resolveAbilityNameFromToolCall } from "../core/execute-php-guard";
import { assertNovamiraAbilityAllowed, NovamiraGuardContext } from "../core/novamira-guard";
import { assertAbilityAllowedForProfile, NovamiraProfile } from "../core/novamira-profiles";
import { callMcpTool, extractTextContent, NovamiraSession, openNovamiraSession, resolveNovamiraCredentials } from "./novamira-mcp-transport";

/**
 * Novamira MCP Client — UNICO punto de entrada para invocar una ability
 * de Novamira desde este codebase. Ningun otro modulo debe hablar con el
 * transporte directamente: todo pasa primero por un guard aqui dentro,
 * para que saltarselo requiera modificar este fichero y no sea posible
 * por descuido en un adaptador futuro.
 *
 * DOS PUERTAS, deliberadamente separadas:
 *
 *   1. `callNovamiraAbility()` -- la puerta general. Aplica perfil +
 *      guard del allowlist. `novamira/execute-php` sigue clasificada
 *      `dangerous_forbidden`, asi que esta puerta la rechaza SIEMPRE,
 *      para cualquier perfil. Un especialista que intente ejecutar PHP
 *      falla aqui, igual que antes de existir el fallback.
 *
 *   2. `callNovamiraExecutePhp()` -- la puerta estrecha del fallback.
 *      Exige un `ExecutePhpRequest` completo (actor de apply, staging,
 *      QA, ChangePlan valido, PHP generado de forma determinista) y lo
 *      valida con `assertExecutePhpAllowed()`. No hay forma de llegar
 *      aqui con la informacion que tiene un especialista.
 *
 * NUNCA se confia en el nombre del tool MCP. Novamira no expone una tool
 * por ability: expone `mcp-adapter-execute-ability` y la ability real
 * viaja en `ability_name`. Ese parametro es lo que se clasifica.
 */

export interface NovamiraAbilityCall {
  /** Perfil del llamante. Determina el techo de riesgo antes de mirar nada mas. */
  profile: NovamiraProfile;
  abilityName: string;
  parameters: Record<string, unknown>;
  guardContext?: NovamiraGuardContext;
  /** Sesion ya abierta. Si falta, se abre una nueva con las credenciales del entorno. */
  session?: NovamiraSession;
}

/**
 * Clasifica una llamada a un tool MCP mirando SIEMPRE la ability real.
 * Expuesta aparte para poder testear que el nombre generico del tool no
 * basta para pasar.
 */
export function assertToolCallAllowed(profile: NovamiraProfile, toolName: string, parameters: Record<string, unknown>, guardContext?: NovamiraGuardContext): string {
  const resolved = resolveAbilityNameFromToolCall(toolName, parameters);
  if (!resolved.ok) throw new Error(`Novamira MCP client: ${resolved.reason}`);
  assertAbilityAllowedForProfile(profile, resolved.abilityName, guardContext);
  return resolved.abilityName;
}

export async function openSession(): Promise<NovamiraSession> {
  return openNovamiraSession(resolveNovamiraCredentials());
}

/**
 * Puerta GENERAL. Pasa por perfil + guard del allowlist. No puede
 * ejecutar PHP: `novamira/execute-php` es `dangerous_forbidden` y ningun
 * perfil incluye ese nivel de riesgo.
 */
export async function callNovamiraAbility(call: NovamiraAbilityCall): Promise<string> {
  // Doble comprobacion a proposito: por nombre directo y por la ruta del
  // tool MCP. Las dos tienen que decir que si.
  assertAbilityAllowedForProfile(call.profile, call.abilityName, call.guardContext);
  assertNovamiraAbilityAllowed(call.abilityName, call.guardContext);

  const session = call.session ?? (await openSession());
  const body = await callMcpTool(session, MCP_EXECUTE_ABILITY_TOOL, {
    ability_name: call.abilityName,
    parameters: call.parameters,
  });
  return extractTextContent(body);
}

/**
 * Puerta ESTRECHA del fallback de PHP. Es la unica funcion del sistema
 * que puede llegar a invocar `novamira/execute-php`, y solo despues de
 * que `assertExecutePhpAllowed()` haya validado el request entero.
 *
 * No construye el PHP ni decide nada: recibe un request ya completo. El
 * PHP que lleva se re-deriva del ChangePlan dentro del guard y tiene que
 * coincidir exactamente, asi que este parametro no puede usarse para
 * colar codigo.
 */
export async function callNovamiraExecutePhp(request: ExecutePhpRequest, session?: NovamiraSession): Promise<string> {
  assertExecutePhpAllowed(request);

  const active = session ?? (await openSession());
  const body = await callMcpTool(active, MCP_EXECUTE_ABILITY_TOOL, {
    ability_name: "novamira/execute-php",
    parameters: { code: request.php },
  });
  return extractTextContent(body);
}
