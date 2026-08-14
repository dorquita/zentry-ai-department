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
 * Este modulo no ejecuta ni invoca ningun subagente -- es unicamente la
 * capa de decision/verificacion, pensada para usarse desde tests (ver
 * test/subagent-tool-guard.test.ts) y desde cualquier runner que quiera
 * verificar la config antes de lanzar un subagente.
 */

const ALLOWLIST_PATH = path.join(__dirname, "..", "..", "config", "subagent-tool-allowlist.json");
const AGENTS_DIR = path.join(__dirname, "..", "..", ".claude", "agents");

interface SubagentAllowlistEntry {
  definitionFile: string;
  description: string;
  allowedTools: string[];
  externalWriteToolsGranted: string[];
  maxRiskCategory: string;
  notes?: string;
}

interface ToolCategory {
  label: string;
  examples: string[];
  isExternalWrite: boolean;
  note?: string;
}

interface SubagentAllowlistFile {
  version: string;
  toolCategories: Record<string, ToolCategory>;
  defaultForUnlistedAgent: string;
  defaultForUnlistedTool: string;
  agents: Record<string, SubagentAllowlistEntry>;
}

/**
 * Sin cache, relee el JSON en cada llamada -- mismo patron que
 * novamira-guard.ts/autonomy-policy.ts, para que un cambio en el
 * fichero de politica se refleje de inmediato.
 */
export function loadSubagentToolAllowlist(): SubagentAllowlistFile {
  const raw = fs.readFileSync(ALLOWLIST_PATH, "utf-8");
  return JSON.parse(raw) as SubagentAllowlistFile;
}

export function getKnownExternalWriteTools(): string[] {
  const allowlist = loadSubagentToolAllowlist();
  return Object.values(allowlist.toolCategories)
    .filter((category) => category.isExternalWrite)
    .flatMap((category) => category.examples);
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
export function isSubagentToolAllowed(agentName: string, toolName: string): SubagentToolGuardResult {
  const allowlist = loadSubagentToolAllowlist();
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
export function assertSubagentToolAllowed(agentName: string, toolName: string): void {
  const result = isSubagentToolAllowed(agentName, toolName);
  if (!result.allowed) {
    throw new Error(`Subagent Tool Guard: ${result.reason}`);
  }
}

/**
 * Un subagente esta "limpio" de escritura externa si ninguna de sus
 * `allowedTools` aparece en el catalogo de herramientas de escritura
 * externa (`toolCategories.external_write.examples`) Y su propio
 * `externalWriteToolsGranted` (override explicito, pensado para que
 * quede visible en el propio JSON si algun dia se concede una) esta
 * vacio. Fail-closed tambien aqui: un agente inexistente en el
 * allowlist cuenta como "sin herramientas" (no como "sin restriccion").
 */
export function hasNoExternalWriteTools(agentName: string): boolean {
  const allowlist = loadSubagentToolAllowlist();
  const entry = allowlist.agents[agentName];
  if (!entry) return true;

  const knownWriteTools = new Set(getKnownExternalWriteTools());
  const grantedKnownWrite = entry.allowedTools.some((tool) => knownWriteTools.has(tool));
  return !grantedKnownWrite && entry.externalWriteToolsGranted.length === 0;
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
export function parseAgentFrontmatterTools(agentName: string): string[] | undefined {
  const allowlist = loadSubagentToolAllowlist();
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

export function listDefinedAgentFiles(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs.readdirSync(AGENTS_DIR).filter((file) => file.endsWith(".md"));
}
