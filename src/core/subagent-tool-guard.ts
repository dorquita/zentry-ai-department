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

export type ToolRiskClassification = "read_only" | "local_write" | "external_read" | "external_write" | "unknown";

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
 * UNICA herramienta que un empleado Claude puede declarar sin dejar de
 * considerarse "sin capacidades". No es una excepcion de conveniencia:
 * `StructuredOutput` es la herramienta INTERNA de fin-de-turno del
 * Claude Agent SDK, y es el unico canal por el que el SDK entrega
 * `structured_output` cuando se pasa `--json-schema`.
 *
 * No concede al empleado ninguna capacidad nueva -- transporta
 * exactamente el mismo JSON que el modelo habria impreso como texto
 * libre. No lee ficheros, no ejecuta nada, no sale a la red, no escribe
 * en ningun sistema.
 *
 * Por que esta excepcion existe (causa raiz del incidente P0 del
 * runtime comun, ver docs/claude-runtime-reliability-incident.md):
 * declarar `tools: []` quitaba TODAS las herramientas de la sesion,
 * incluida esta, asi que el SDK no podia instalar el carrier,
 * `--json-schema` quedaba INERTE, `structured_output` no llegaba NUNCA
 * (0 de 8 invocaciones reales medidas) y el contrato de salida dejaba
 * de validarse en generacion: cada empleado escribia su JSON a mano,
 * sin red de seguridad, y el runtime solo podia comprobarlo a
 * posteriori.
 */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/**
 * Chequeo estricto "sin herramientas de capacidad" (antes "cero
 * herramientas"), pensado para todos los empleados Claude, cuyo diseno
 * exige las 4 condiciones a la vez:
 *   1. el agente esta presente en el allowlist,
 *   2. `allowedTools` no contiene NADA fuera de `StructuredOutput`,
 *   3. `externalWriteToolsGranted` esta vacio,
 *   4. el frontmatter `tools:` del propio `.md` esta declarado
 *      explicitamente (nunca ausente) y tampoco contiene nada fuera de
 *      `StructuredOutput`.
 *
 * Ademas, allowlist y frontmatter deben coincidir EXACTAMENTE: conceder
 * la herramienta en un sitio y no en el otro es drift, y se rechaza --
 * es justo el tipo de inconsistencia silenciosa que causo el incidente.
 *
 * Sigue siendo fail-closed en el mismo sentido de antes: cualquier
 * herramienta que no sea exactamente `StructuredOutput` (conocida o no,
 * de lectura o de escritura) hace fallar el chequeo. La superficie de
 * capacidad real del empleado sigue siendo CERO.
 */
export function checkSubagentIsToolless(agentName: string, allowlist: SubagentAllowlistFile = loadSubagentToolAllowlist()): ToollessCheckResult {
  const entry = allowlist.agents[agentName];
  if (!entry) {
    return { ok: false, reasons: [`"${agentName}" no esta presente en config/subagent-tool-allowlist.json.`] };
  }

  const reasons: string[] = [];
  const disallowedInAllowlist = entry.allowedTools.filter((tool) => tool !== STRUCTURED_OUTPUT_TOOL);
  if (disallowedInAllowlist.length !== 0) {
    reasons.push(`allowedTools concede herramientas de capacidad: [${disallowedInAllowlist.join(", ")}] (la unica permitida es ${STRUCTURED_OUTPUT_TOOL}).`);
  }
  if (entry.externalWriteToolsGranted.length !== 0) {
    reasons.push(`externalWriteToolsGranted no esta vacio: [${entry.externalWriteToolsGranted.join(", ")}].`);
  }

  const frontmatterTools = parseAgentFrontmatterTools(agentName, allowlist);
  if (frontmatterTools === undefined) {
    reasons.push(`El frontmatter de "${entry.definitionFile}" no declara "tools:" explicitamente (deberia declarar tools: [${STRUCTURED_OUTPUT_TOOL}]).`);
  } else {
    const disallowedInFrontmatter = frontmatterTools.filter((tool) => tool !== STRUCTURED_OUTPUT_TOOL);
    if (disallowedInFrontmatter.length !== 0) {
      reasons.push(`El frontmatter de "${entry.definitionFile}" declara herramientas de capacidad: [${disallowedInFrontmatter.join(", ")}] (la unica permitida es ${STRUCTURED_OUTPUT_TOOL}).`);
    }

    // Drift entre las dos capas: conceder el carrier en una y no en la
    // otra deja el contrato de salida a medias sin que nadie se entere.
    const allowlistHasCarrier = entry.allowedTools.includes(STRUCTURED_OUTPUT_TOOL);
    const frontmatterHasCarrier = frontmatterTools.includes(STRUCTURED_OUTPUT_TOOL);
    if (allowlistHasCarrier !== frontmatterHasCarrier) {
      reasons.push(
        `Drift entre allowlist y frontmatter sobre ${STRUCTURED_OUTPUT_TOOL}: allowlist=${allowlistHasCarrier ? "concedida" : "no concedida"}, frontmatter de "${entry.definitionFile}"=${frontmatterHasCarrier ? "concedida" : "no concedida"}. Deben coincidir.`
      );
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
