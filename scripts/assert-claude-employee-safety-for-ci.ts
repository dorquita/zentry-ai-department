/**
 * Preflight GENERICO del Claude Employee Runtime (ver
 * .github/actions/claude-employee-runtime/action.yml y
 * docs/claude-employee-runtime.md): antes de invocar a Claude para
 * CUALQUIER empleado, verifica deterministicamente (sin usar Claude para
 * nada) que el subagente esta declarado como "cero herramientas" tanto
 * en config/subagent-tool-allowlist.json como en el frontmatter de su
 * propio .claude/agents/<agent>.md -- reutiliza
 * assertSubagentIsToolless() de src/core/subagent-tool-guard.ts, no
 * duplica su logica.
 *
 * Falla (exit != 0) si: el agente no esta en el allowlist, su
 * allowedTools no esta vacio, su externalWriteToolsGranted no esta
 * vacio, el frontmatter tools: de su .md no esta explicitamente vacio, o
 * hay drift entre el .md y el allowlist -- ver
 * src/core/subagent-tool-guard.ts para el detalle de las 4 condiciones.
 *
 * Uso: ts-node scripts/assert-claude-employee-safety-for-ci.ts <agent-name>
 */
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";

function main(): void {
  const agentName = process.argv[2];
  if (!agentName) {
    console.error("Uso: ts-node scripts/assert-claude-employee-safety-for-ci.ts <agent-name>");
    process.exit(1);
  }

  try {
    assertSubagentIsToolless(agentName);
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`OK: "${agentName}" cumple el requisito de cero herramientas (Subagent Tool Guard) -- verificado antes de invocar a Claude.`);
}

main();
