import * as assert from "node:assert/strict";
import {
  assertSubagentIsToolless,
  checkSubagentIsToolless,
  classifyToolRisk,
  getKnownExternalWriteTools,
  hasNoExternalWriteTools,
  isSubagentToolAllowed,
  listDefinedAgentFiles,
  loadSubagentToolAllowlist,
  parseAgentFrontmatterTools,
  SubagentAllowlistFile,
} from "../src/core/subagent-tool-guard";

export interface TestCase {
  name: string;
  fn: () => void;
}

const AGENT = "ux-ui-landing-architect-v2";

/** Allowlist sintetica para probar casos de inconsistencia sin tocar el fichero real del repo. */
function buildFakeAllowlist(overrides: Partial<SubagentAllowlistFile["agents"][string]> = {}): SubagentAllowlistFile {
  const real = loadSubagentToolAllowlist();
  return {
    ...real,
    agents: {
      "fake-agent-with-tools": {
        definitionFile: "test/fixtures/fake-agent-with-tools.md",
        description: "Fixture de test.",
        allowedTools: [],
        externalWriteToolsGranted: [],
        maxRiskCategory: "none",
        ...overrides,
      },
    },
  };
}

export function runSubagentToolGuardTests(): TestCase[] {
  return [
    // --- Fail-closed: agente desconocido ---
    {
      name: "agente no listado en el allowlist: cualquier herramienta se deniega (fail-closed)",
      fn: () => {
        const result = isSubagentToolAllowed("un-agente-que-no-existe", "Read");
        assert.equal(result.allowed, false);
        assert.match(result.reason, /fail-closed/i);
      },
    },
    {
      name: "REGRESION: agente no listado NUNCA se trata como 'confirmado sin herramientas de escritura' -- hasNoExternalWriteTools debe devolver false, no true (bug real corregido)",
      fn: () => {
        assert.equal(hasNoExternalWriteTools("un-agente-que-no-existe"), false);
      },
    },
    {
      name: "checkSubagentIsToolless para un agente desconocido: ok:false con motivo explicito",
      fn: () => {
        const result = checkSubagentIsToolless("un-agente-que-no-existe");
        assert.equal(result.ok, false);
        assert.ok(result.reasons.length > 0);
        assert.match(result.reasons[0], /no esta presente/i);
      },
    },
    {
      name: "assertSubagentIsToolless lanza para un agente desconocido",
      fn: () => {
        assert.throws(() => assertSubagentIsToolless("un-agente-que-no-existe"), /no cumple el requisito/i);
      },
    },

    // --- Fail-closed: herramienta desconocida para un agente conocido ---
    {
      name: `herramienta no incluida en allowedTools de ${AGENT} se deniega, aunque sea de solo lectura`,
      fn: () => {
        for (const tool of ["Read", "Grep", "Glob", "Skill"]) {
          const result = isSubagentToolAllowed(AGENT, tool);
          assert.equal(result.allowed, false, `${tool} no deberia estar permitida`);
        }
      },
    },

    // --- Fail-closed general: una herramienta no categorizada nunca es "segura" implicitamente ---
    {
      name: "classifyToolRisk devuelve 'unknown' para una herramienta no listada en ninguna categoria (nunca 'read_only' por omision)",
      fn: () => {
        assert.equal(classifyToolRisk("HerramientaCompletamenteInventada"), "unknown");
      },
    },
    {
      name: "una herramienta 'unknown' (no reconocida en ninguna categoria) cuenta como riesgo en hasNoExternalWriteTools, igual que external_write",
      fn: () => {
        const fakeAllowlist = buildFakeAllowlist({ allowedTools: ["HerramientaCompletamenteInventada"] });
        assert.equal(hasNoExternalWriteTools("fake-agent-with-tools", fakeAllowlist), false);
      },
    },

    // --- Requisito central del experimento: cero herramientas de escritura externa ---
    {
      name: `${AGENT} tiene allowedTools vacio en config/subagent-tool-allowlist.json`,
      fn: () => {
        const allowlist = loadSubagentToolAllowlist();
        const entry = allowlist.agents[AGENT];
        assert.ok(entry, `${AGENT} deberia existir en el allowlist`);
        assert.deepEqual(entry.allowedTools, []);
        assert.deepEqual(entry.externalWriteToolsGranted, []);
      },
    },
    {
      name: `${AGENT} no tiene ninguna herramienta de escritura externa concedida`,
      fn: () => {
        assert.equal(hasNoExternalWriteTools(AGENT), true);
      },
    },
    {
      name: `ninguna herramienta de escritura externa conocida esta permitida para ${AGENT}`,
      fn: () => {
        const writeTools = getKnownExternalWriteTools();
        assert.ok(writeTools.length > 0, "el catalogo de herramientas de escritura externa no deberia estar vacio");
        for (const tool of writeTools) {
          const result = isSubagentToolAllowed(AGENT, tool);
          assert.equal(result.allowed, false, `${tool} NO deberia estar permitida para ${AGENT}`);
        }
      },
    },
    {
      name: "herramientas de escritura local (Write/Edit/Bash/NotebookEdit) tampoco estan permitidas",
      fn: () => {
        for (const tool of ["Write", "Edit", "Bash", "NotebookEdit"]) {
          assert.equal(isSubagentToolAllowed(AGENT, tool).allowed, false, `${tool} NO deberia estar permitida`);
        }
      },
    },

    // --- checkSubagentIsToolless / assertSubagentIsToolless: las 4 condiciones exigidas ---
    {
      name: `checkSubagentIsToolless(${AGENT}) cumple las 4 condiciones (allowlist presente, allowedTools=[], externalWriteToolsGranted=[], frontmatter tools:[])`,
      fn: () => {
        const result = checkSubagentIsToolless(AGENT);
        assert.equal(result.ok, true, `reasons: ${JSON.stringify(result.reasons)}`);
        assert.deepEqual(result.reasons, []);
      },
    },
    {
      name: `assertSubagentIsToolless(${AGENT}) no lanza`,
      fn: () => {
        assert.doesNotThrow(() => assertSubagentIsToolless(AGENT));
      },
    },
    {
      name: "checkSubagentIsToolless detecta allowedTools no vacio como inconsistencia",
      fn: () => {
        const fakeAllowlist = buildFakeAllowlist({ allowedTools: ["Bash", "Read"] });
        const result = checkSubagentIsToolless("fake-agent-with-tools", fakeAllowlist);
        assert.equal(result.ok, false);
        assert.ok(result.reasons.some((r) => /allowedTools no esta vacio/.test(r)));
      },
    },
    {
      name: "checkSubagentIsToolless detecta externalWriteToolsGranted no vacio como inconsistencia",
      fn: () => {
        const fakeAllowlist = buildFakeAllowlist({ externalWriteToolsGranted: ["Bash"] });
        const result = checkSubagentIsToolless("fake-agent-with-tools", fakeAllowlist);
        assert.equal(result.ok, false);
        assert.ok(result.reasons.some((r) => /externalWriteToolsGranted no esta vacio/.test(r)));
      },
    },
    {
      name: "checkSubagentIsToolless detecta que el frontmatter tools: del .md NO esta vacio, aunque el JSON diga allowedTools:[] (deteccion de drift entre ambos ficheros)",
      fn: () => {
        // El fixture test/fixtures/fake-agent-with-tools.md declara
        // `tools: Bash, Read` en su frontmatter -- el JSON sintetico de
        // este test SI dice allowedTools:[], simulando exactamente el
        // escenario que esta funcion existe para detectar: alguien edito
        // el .md y olvido actualizar el allowlist (o viceversa).
        const fakeAllowlist = buildFakeAllowlist({ allowedTools: [] });
        const result = checkSubagentIsToolless("fake-agent-with-tools", fakeAllowlist);
        assert.equal(result.ok, false);
        assert.ok(result.reasons.some((r) => /frontmatter/i.test(r) && /tools:/.test(r)), `reasons: ${JSON.stringify(result.reasons)}`);
      },
    },
    {
      name: "assertSubagentIsToolless lanza (con el motivo exacto) cuando el fixture inconsistente se usa",
      fn: () => {
        const fakeAllowlist = buildFakeAllowlist({ allowedTools: ["Bash", "Read"] });
        assert.throws(() => assertSubagentIsToolless("fake-agent-with-tools", fakeAllowlist), /allowedTools no esta vacio/);
      },
    },

    // --- Consistencia entre el frontmatter del .md real y el JSON real (defensa en profundidad) ---
    {
      name: `el frontmatter tools: de .claude/agents/${AGENT}.md coincide con allowedTools del JSON`,
      fn: () => {
        const frontmatterTools = parseAgentFrontmatterTools(AGENT);
        const allowlist = loadSubagentToolAllowlist();
        assert.ok(frontmatterTools !== undefined, "el frontmatter deberia declarar tools: explicitamente (nunca ausente)");
        assert.deepEqual([...frontmatterTools!].sort(), [...allowlist.agents[AGENT].allowedTools].sort());
      },
    },
    {
      name: `.claude/agents/${AGENT}.md existe y se puede listar`,
      fn: () => {
        const files = listDefinedAgentFiles();
        assert.ok(files.includes(`${AGENT}.md`), `deberia existir .claude/agents/${AGENT}.md`);
      },
    },

    {
      // NOTA (ver docs/claude-employee-runtime.md, "Desarrollo paralelo
      // mediante worktrees"): este fichero es deliberadamente
      // append-only -- cada uno de los 7 empleados Claude nuevos anade
      // su propia entrada bajo su propia clave. La version anterior de
      // este test fijaba `Object.keys(allowlist.agents).length === 1`,
      // una asuncion que era cierta solo hasta que el primer worktree
      // mergeara su propia entrada -- se sustituye por el invariante
      // real que este test pretendia proteger: TODO agente listado debe
      // seguir cumpliendo el requisito de cero herramientas.
      name: "todo agente presente en el allowlist cumple el requisito de cero herramientas (checkSubagentIsToolless)",
      fn: () => {
        const allowlist = loadSubagentToolAllowlist();
        assert.ok(Object.keys(allowlist.agents).length >= 1, "el allowlist deberia tener al menos un agente registrado");
        for (const agentName of Object.keys(allowlist.agents)) {
          const result = checkSubagentIsToolless(agentName, allowlist);
          assert.ok(result.ok, `"${agentName}" deberia cumplir el requisito de cero herramientas: ${JSON.stringify(result.reasons)}`);
        }
      },
    },
  ];
}
