import * as fs from "fs";
import * as path from "path";

/**
 * Subagent Tool Guard — capa de seguridad/allowlist para las
 * herramientas (tools) de Claude Code que puede usar cada subagente
 * definido en `.claude/agents/*.md` (ver docs/ux-ui-landing-architect-v2-experiment.md).
 *
 * Mismo diseno fail-closed que `src/core/novamira-guard.ts`: cualquier
 * subagente que no aparezca en config/subagent-tool-allowlist.json, o
 * cualquier herramienta que no este en su `allowedTools`, se trata como
 * DENEGADA por defecto -- nunca "permitida por no estar prohibida
 * explicitamente". Esto es una SEGUNDA capa, independiente del campo
 * `tools:` del frontmatter del propio agente (que ya lo restringe a
 * nivel de Claude Code): un cambio accidental en el frontmatter de un
 * `.md` no es la unica proteccion contra que un subagente gane
 * herramientas de escritura.
 *
 * Fail-closed en DOS ejes, no solo uno:
 *   1. Un agente que no esta en el allowlist NUNCA se trata como
 *      "confirmado seguro" -- `hasNoExternalWriteTools()` devuelve
 *      `false` para un agente desconocido (no `true`: la ausencia de
 *      registro no es evidencia de ausencia de riesgo, ver bug corregido
 *      tras revision -- antes devolvia `true`, dando una falsa garantia).
 *   2. Una herramienta que no esta clasificada en NINGUNA categoria de
 *      `toolCategories` (ni siquiera en `external_write`) nunca se trata
 *      implicitamente como segura -- se clasifica como "unknown" y
 *      cuenta como riesgo, exactamente igual que si fuera de escritura
 *      externa conocida. El catalogo de ejemplos de `external_write` es
 *      deliberadamente no exhaustivo (ver el propio JSON); lo que
 *      protege de verdad es que CUALQUIER herramienta no reconocida se
 *      trata como no segura, nunca al reves.
 *
 * Este modulo no ejecuta ni invoca ningun subagente -- es unicamente la
 * capa de decision/verificacion, pensada para usarse desde tests (ver
 * test/subagent-tool-guard.test.ts) y desde cualquier runner que quiera
 * verificar la config antes de lanzar un subagente.
 */

const ALLOWLIST_PATH = path.join(__dirname, "..", "..", "config", "subagent-tool-allowlist.json");
const AGENTS_DIR = path.join(__dirname, "..", "..", ".claude", "agents");

export interface SubagentAllowlistEntry {
  definitionFile: string;
  description: string;
  allowedTools: string[];
  externalWriteToolsGranted: string[];
  maxRiskCategory: string;
  notes?: string;
}

export interface ToolCategory {
  label: string;
  examples: string[];
  isExternalWrite: boolean;
  note?: string;
}

export interface SubagentAllowlistFile {
  version: string;
  toolCategories: Record<string, ToolCategory>;
  defaultForUnlistedAgent: string;
  defaultForUnlistedTool: string;
  agents: Record<string, SubagentAllowlistEntry>;
}

/**
 * Sin cache, relee el JSON en cada llamada -- mismo patron que
 * novamira-guard.ts/autonomy-policy.ts, para que un cambio en el
 * fichero de politica se refleje de inmediato. Todas las funciones de
 * este modulo aceptan un `allowlist` inyectable (por defecto, esta
 * lectura fresca) para que los tests puedan verificar casos de
 * inconsistencia sin tener que mutar el fichero real del repositorio.
 */
export function loadSubagentToolAllowlist(): SubagentAllowlistFile {
  const raw = fs.readFileSync(ALLOWLIST_PATH, "utf-8");
  return JSON.parse(raw) as SubagentAllowlistFile;
}

export function getKnownExternalWriteTools(allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): string[] {
  return Object.values(allowlist.toolCategories)
    .filter((category) => category.isExternalWrite)
    .flatMap((category) => category.examples);
}

export type ToolRiskClassification = "read_only" | "local_write" | "external_read" | "external_write" | "sdk_output" | "unknown";

/**
 * Herramientas SIN NINGUNA capacidad: no leen ficheros, no escriben nada,
 * no salen a la red y no pueden invocar a ningun sistema. Son el canal
 * por el que el Agent SDK ENTREGA la salida estructurada cuando se pasa
 * `--json-schema` -- no le dan al modelo ninguna capacidad nueva, solo
 * un formato de respuesta.
 *
 * Por que esto existe (incidente P0 de seo-specialist, ver
 * docs/claude-employee-runtime.md, seccion "Structured output"): con
 * `tools: []` literal en el frontmatter, Claude Code NO expone
 * `StructuredOutput` al agente, asi que `--json-schema` queda INERTE --
 * el modelo no tiene forma de entregar la salida estructurada y responde
 * texto libre. `claude-code-action` falla entonces con
 * "--json-schema was provided but Claude did not return structured_output",
 * y toda la validacion de contrato pasa a depender del fallback via
 * `execution_file`, o sea de que el modelo acierte el schema a mano.
 * Demostrado empiricamente con el CLI 2.1.233 (mismo que instala la
 * Action): sin agente -> `stop_reason: "tool_use"` y structured_output
 * presente; con `--agent <toolless>` -> `stop_reason: "end_turn"`, un
 * solo turno y structured_output ausente.
 *
 * Conceder EXACTAMENTE esta herramienta (y solo esta) devuelve
 * `--json-schema` a la vida sin conceder ninguna capacidad real: el
 * modelo sigue sin poder leer el repositorio, ejecutar comandos, ni
 * tocar ningun sistema externo. Cualquier otra herramienta sigue
 * denegada por el mismo modelo fail-closed de siempre.
 */
export const SIDE_EFFECT_FREE_SDK_TOOLS: readonly string[] = ["StructuredOutput"];

/** Una herramienta es "de capacidad" si NO esta en la lista cerrada de herramientas sin efectos de `SIDE_EFFECT_FREE_SDK_TOOLS`. Fail-closed: cualquier nombre desconocido cuenta como capacidad. */
export function isCapabilityTool(toolName: string): boolean {
  return !SIDE_EFFECT_FREE_SDK_TOOLS.includes(toolName);
}

/**
 * Clasifica una herramienta segun en que categoria de `toolCategories`
 * aparece su nombre. Fail-closed: si no aparece en NINGUNA categoria,
 * devuelve "unknown" -- nunca se asume "read_only"/segura por omision.
 * `hasNoExternalWriteTools()` trata "unknown" igual de mal que
 * "external_write" a proposito.
 */
export function classifyToolRisk(toolName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): ToolRiskClassification {
  for (const [categoryId, category] of Object.entries(allowlist.toolCategories)) {
    if (category.examples.includes(toolName)) {
      return categoryId as ToolRiskClassification;
    }
  }
  return "unknown";
}

export interface SubagentToolGuardResult {
  allowed: boolean;
  reason: string;
}

/**
 * Version pura (sin lanzar). Fail-closed en los dos sentidos: agente
 * desconocido -> denegado; agente conocido pero herramienta fuera de su
 * `allowedTools` -> denegado. Nunca hay un "permitido por defecto".
 */
export function isSubagentToolAllowed(agentName: string, toolName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): SubagentToolGuardResult {
  const entry = allowlist.agents[agentName];

  if (!entry) {
    return {
      allowed: false,
      reason: `Subagente "${agentName}" no esta en config/subagent-tool-allowlist.json -- tratado como "${allowlist.defaultForUnlistedAgent}" por defecto (fail-closed). Anadelo al allowlist explicitamente si de verdad necesita herramientas.`,
    };
  }

  if (!entry.allowedTools.includes(toolName)) {
    return {
      allowed: false,
      reason: `Herramienta "${toolName}" no esta en allowedTools de "${agentName}" -- denegada por defecto (fail-closed, "${allowlist.defaultForUnlistedTool}").`,
    };
  }

  return { allowed: true, reason: `Herramienta "${toolName}" concedida explicitamente a "${agentName}" en config/subagent-tool-allowlist.json.` };
}

/** Version que lanza -- para integrarla en cualquier punto que vaya a invocar un subagente de verdad. */
export function assertSubagentToolAllowed(agentName: string, toolName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): void {
  const result = isSubagentToolAllowed(agentName, toolName, allowlist);
  if (!result.allowed) {
    throw new Error(`Subagent Tool Guard: ${result.reason}`);
  }
}

/**
 * Un subagente esta "confirmado limpio" de escritura externa SOLO si:
 *   (a) esta presente en el allowlist (un agente desconocido NUNCA
 *       cuenta como confirmado -- fail-closed, ver bug corregido: antes
 *       devolvia `true` para un agente inexistente, una falsa garantia
 *       de seguridad),
 *   (b) `externalWriteToolsGranted` esta vacio, y
 *   (c) ninguna de sus `allowedTools` se clasifica como
 *       "external_write" NI como "unknown" -- una herramienta no
 *       reconocida en ninguna categoria nunca se trata implicitamente
 *       como segura.
 */
export function hasNoExternalWriteTools(agentName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): boolean {
  const entry = allowlist.agents[agentName];
  if (!entry) return false;
  if (entry.externalWriteToolsGranted.length > 0) return false;

  return entry.allowedTools.every((tool) => {
    const risk = classifyToolRisk(tool, allowlist);
    return risk !== "external_write" && risk !== "unknown";
  });
}

/**
 * Extrae la lista de `tools:` del frontmatter YAML de un `.claude/agents/*.md`
 * sin depender de un parser YAML completo (no hay ninguno en las
 * dependencias del proyecto) -- el frontmatter de un subagente de Claude
 * Code es siempre plano (clave: valor de una linea), asi que basta un
 * parseo lineal. Soporta `tools: []`, `tools: Read, Grep, Glob` y
 * ausencia total de la clave (heredaria todas las herramientas segun
 * Claude Code -- por eso los tests exigen que la clave este SIEMPRE
 * presente y explicita para cualquier agente de este experimento).
 */
export function parseAgentFrontmatterTools(agentName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): string[] | undefined {
  const entry = allowlist.agents[agentName];
  const definitionFile = entry?.definitionFile ?? `.claude/agents/${agentName}.md`;
  const absolutePath = path.join(__dirname, "..", "..", definitionFile);
  const raw = fs.readFileSync(absolutePath, "utf-8");

  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) return undefined;
  const frontmatter = frontmatterMatch[1];

  const toolsLineMatch = frontmatter.match(/^tools:\s*(.*)$/m);
  if (!toolsLineMatch) return undefined;
  const value = toolsLineMatch[1].trim();

  if (value === "[]" || value === "") return [];
  const bracketMatch = value.match(/^\[(.*)\]$/);
  const inner = bracketMatch ? bracketMatch[1] : value;
  return inner
    .split(",")
    .map((tool) => tool.trim().replace(/^["']|["']$/g, ""))
    .filter((tool) => tool.length > 0);
}

export interface ToollessCheckResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Chequeo estricto "cero herramientas DE CAPACIDAD", exigido a todo
 * empleado Claude antes de invocarlo (ver
 * docs/ux-ui-landing-architect-v2-experiment.md y
 * docs/claude-employee-runtime.md). Las 4 condiciones:
 *   1. el agente esta presente en el allowlist,
 *   2. `allowedTools` no contiene NINGUNA herramienta de capacidad --
 *      solo puede contener herramientas de `SIDE_EFFECT_FREE_SDK_TOOLS`
 *      (hoy: `StructuredOutput`, el canal de entrega de `--json-schema`,
 *      que no concede ninguna capacidad al modelo),
 *   3. `externalWriteToolsGranted` esta vacio,
 *   4. el frontmatter `tools:` del propio `.md` esta declarado
 *      explicitamente (nunca ausente) y coincide EXACTAMENTE, como
 *      conjunto, con `allowedTools` del allowlist.
 *
 * La condicion 4 es mas estricta que la version anterior de esta
 * funcion: antes solo exigia que AMBOS estuvieran vacios, asi que solo
 * detectaba drift cuando el drift consistia en anadir herramientas. Ahora
 * exige igualdad de conjuntos en los dos sentidos, asi que tambien
 * detecta el caso inverso (el allowlist concede algo que el `.md` no
 * declara, o al reves) -- que es justamente el fallo silencioso que
 * dejaba `--json-schema` inerte.
 *
 * Cualquier inconsistencia se reporta en `reasons` --
 * `assertSubagentIsToolless()` la convierte en excepcion.
 */
export function checkSubagentIsToolless(agentName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): ToollessCheckResult {
  const entry = allowlist.agents[agentName];
  if (!entry) {
    return { ok: false, reasons: [`"${agentName}" no esta presente en config/subagent-tool-allowlist.json.`] };
  }

  const reasons: string[] = [];
  const capabilityTools = entry.allowedTools.filter(isCapabilityTool);
  if (capabilityTools.length !== 0) {
    reasons.push(`allowedTools no esta vacio de herramientas de capacidad: [${capabilityTools.join(", ")}]. Solo se admiten herramientas sin efectos: [${SIDE_EFFECT_FREE_SDK_TOOLS.join(", ")}].`);
  }
  if (entry.externalWriteToolsGranted.length !== 0) {
    reasons.push(`externalWriteToolsGranted no esta vacio: [${entry.externalWriteToolsGranted.join(", ")}].`);
  }

  const frontmatterTools = parseAgentFrontmatterTools(agentName, allowlist);
  if (frontmatterTools === undefined) {
    reasons.push(`El frontmatter de "${entry.definitionFile}" no declara "tools:" explicitamente (deberia declararlo, aunque sea tools: []).`);
  } else {
    const declared = [...frontmatterTools].sort();
    const granted = [...entry.allowedTools].sort();
    if (declared.join(" ") !== granted.join(" ")) {
      reasons.push(`El frontmatter de "${entry.definitionFile}" declara tools: [${declared.join(", ")}], que NO coincide con allowedTools del allowlist: [${granted.join(", ")}].`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** Version que lanza -- cualquier inconsistencia en las 4 condiciones aborta con un motivo explicito. */
export function assertSubagentIsToolless(agentName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): void {
  const result = checkSubagentIsToolless(agentName, allowlist);
  if (!result.ok) {
    throw new Error(`Subagent Tool Guard: "${agentName}" no cumple el requisito de cero herramientas -- ${result.reasons.join(" ")}`);
  }
}

export function listDefinedAgentFiles(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR).filter((file) => file.endsWith(".md"));
}
