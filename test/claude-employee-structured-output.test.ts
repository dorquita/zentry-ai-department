import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { resolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { classifyClaudeEmployeeFailure } from "../src/core/claude-employee-retry";
import { JsonSchemaLite, validateAgainstSchema } from "../src/core/json-schema-lite";
import { checkSubagentIsToolless, hasNoExternalWriteTools, isSubagentToolAllowed, loadSubagentToolAllowlist, parseAgentFrontmatterTools, SIDE_EFFECT_FREE_SDK_TOOLS } from "../src/core/subagent-tool-guard";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Los SEIS empleados Claude que ejecuta la pasada coordinada del
 * departamento (.github/workflows/zentry-ai-department-daily.yml).
 * sem-specialist y ux-ui-landing-architect-v2 quedan FUERA a proposito:
 * no participan en esa pasada y no se les ha concedido nada.
 */
const COORDINATED_EMPLOYEES = ["seo-specialist", "content-strategist", "analytics-specialist", "growth-director-v2", "qa-reviewer", "web-engineer"] as const;

/** Empleados que NO participan en la pasada coordinada y deben seguir literalmente sin herramientas. */
const OUT_OF_SCOPE_AGENTS = ["sem-specialist", "ux-ui-landing-architect-v2"] as const;

/** Herramientas de capacidad que NUNCA puede tener ninguno de ellos, pase lo que pase. */
const CAPABILITY_TOOLS = ["Read", "Grep", "Glob", "Write", "Edit", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task", "Agent", "mcp__github__push_files", "mcp__github__create_or_update_file"];

function schemaOf(employee: string): JsonSchemaLite {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", `${employee}-output.schema.json`), "utf-8")) as JsonSchemaLite;
}

/**
 * Construye una instancia MINIMA valida a partir del propio schema del
 * empleado. Deliberadamente generico: este test no debe conocer el
 * dominio de ningun empleado -- si conociera los campos concretos, se
 * quedaria obsoleto en cuanto un empleado cambiara su contrato, que es
 * justo lo que NO queremos.
 */
function buildMinimalValid(schema: JsonSchemaLite, root: JsonSchemaLite = schema): unknown {
  const node = schema as Record<string, unknown>;

  if (typeof node.$ref === "string") {
    const key = node.$ref.replace("#/definitions/", "");
    const definitions = (root as Record<string, unknown>).definitions as Record<string, JsonSchemaLite>;
    return buildMinimalValid(definitions[key], root);
  }
  if (Array.isArray(node.enum)) return node.enum[0];

  switch (node.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const properties = (node.properties ?? {}) as Record<string, JsonSchemaLite>;
      for (const key of (node.required as string[] | undefined) ?? []) {
        out[key] = buildMinimalValid(properties[key], root);
      }
      return out;
    }
    // Un array VACIO satisface el contrato: ningun schema del proyecto usa
    // minItems (json-schema-lite no lo soporta). Que la salida minima sea
    // "todas las colecciones vacias" es exactamente lo que debe aceptarse.
    case "array":
      return [];
    case "string":
      return "texto";
    case "number":
      return 1;
    case "boolean":
      return true;
    default:
      return null;
  }
}

function executionFile(payload: unknown): string {
  return JSON.stringify([
    { type: "system", subtype: "init" },
    { type: "result", subtype: "success", is_error: false, result: JSON.stringify(payload) },
  ]);
}

export function runClaudeEmployeeStructuredOutputTests(): TestCase[] {
  const cases: TestCase[] = [];

  // =====================================================================
  // A -- los seis empleados de la pasada coordinada tienen StructuredOutput
  // =====================================================================
  cases.push({
    name: "A: los SEIS empleados de la pasada coordinada tienen StructuredOutput concedido (sin el, --json-schema queda inerte)",
    fn: () => {
      const allowlist = loadSubagentToolAllowlist();
      for (const employee of COORDINATED_EMPLOYEES) {
        assert.deepEqual(allowlist.agents[employee]?.allowedTools, ["StructuredOutput"], `${employee}: allowlist`);
        assert.deepEqual(parseAgentFrontmatterTools(employee), ["StructuredOutput"], `${employee}: frontmatter`);
      }
    },
  });

  cases.push({
    name: "A (alcance): los agentes que NO participan en la pasada coordinada NO reciben nada -- la concesion no se ha propagado sola",
    fn: () => {
      const allowlist = loadSubagentToolAllowlist();
      for (const agent of OUT_OF_SCOPE_AGENTS) {
        assert.deepEqual(allowlist.agents[agent]?.allowedTools, [], `${agent}: allowlist`);
        assert.deepEqual(parseAgentFrontmatterTools(agent), [], `${agent}: frontmatter`);
      }
    },
  });

  // =====================================================================
  // B / C -- capacidades bloqueadas y paridad frontmatter/allowlist
  // =====================================================================
  for (const employee of COORDINATED_EMPLOYEES) {
    cases.push({
      name: `B: ${employee} sigue con TODA herramienta de capacidad bloqueada (lectura, escritura, shell, red, MCP)`,
      fn: () => {
        for (const tool of CAPABILITY_TOOLS) {
          assert.equal(isSubagentToolAllowed(employee, tool).allowed, false, `${employee} NO puede tener ${tool}`);
        }
        assert.equal(hasNoExternalWriteTools(employee), true);
      },
    });
    cases.push({
      name: `C: ${employee} -- frontmatter y allowlist coinciden EXACTAMENTE (drift en cualquiera de los dos sentidos falla cerrado)`,
      fn: () => {
        const result = checkSubagentIsToolless(employee);
        assert.equal(result.ok, true, JSON.stringify(result.reasons));
      },
    });
  }

  cases.push({
    name: "B (invariante global): ningun agente del allowlist tiene concedida NINGUNA herramienta fuera de la lista cerrada sin efectos",
    fn: () => {
      const allowlist = loadSubagentToolAllowlist();
      for (const [agentName, entry] of Object.entries(allowlist.agents)) {
        for (const tool of entry.allowedTools) {
          assert.ok(SIDE_EFFECT_FREE_SDK_TOOLS.includes(tool), `"${agentName}" no puede tener concedida "${tool}"`);
        }
        assert.deepEqual(entry.externalWriteToolsGranted, [], agentName);
      }
      assert.deepEqual([...SIDE_EFFECT_FREE_SDK_TOOLS], ["StructuredOutput"]);
    },
  });

  cases.push({
    name: "C (un agente no puede ampliarse unilateralmente): anadir una herramienta solo en el allowlist, sin tocar el .md, se detecta y falla cerrado",
    fn: () => {
      const real = loadSubagentToolAllowlist();
      const drifted = {
        ...real,
        agents: { ...real.agents, "qa-reviewer": { ...real.agents["qa-reviewer"], allowedTools: ["StructuredOutput", "Read"] } },
      };
      const result = checkSubagentIsToolless("qa-reviewer", drifted);
      assert.equal(result.ok, false);
      assert.ok(result.reasons.some((reason) => /herramientas de capacidad/.test(reason)), JSON.stringify(result.reasons));
    },
  });

  // =====================================================================
  // D / E -- cada schema acepta lo valido y rechaza lo invalido
  // =====================================================================
  for (const employee of COORDINATED_EMPLOYEES) {
    cases.push({
      name: `D: el schema de ${employee} acepta una salida minima valida por AMBOS caminos (structured_output y fallback)`,
      fn: () => {
        const schema = schemaOf(employee);
        const valid = buildMinimalValid(schema);
        assert.deepEqual(validateAgainstSchema(schema, schema, valid), [], `${employee}: la instancia minima deberia ser valida`);

        const viaStructured = resolveClaudeEmployeeOutput({ structuredOutput: JSON.stringify(valid), executionFileContent: undefined, outputSchema: schema });
        assert.equal(viaStructured.source, "structured_output");

        const viaFallback = resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: executionFile(valid), outputSchema: schema });
        assert.equal(viaFallback.source, "execution_file_fallback");
      },
    });

    cases.push({
      name: `E: el schema de ${employee} RECHAZA una salida a la que le falta un campo obligatorio de nivel superior`,
      fn: () => {
        const schema = schemaOf(employee);
        const valid = buildMinimalValid(schema) as Record<string, unknown>;
        const required = (schema as unknown as { required: string[] }).required;
        assert.ok(required.length > 0, `${employee}: el schema deberia declarar campos obligatorios`);
        const broken = { ...valid };
        delete broken[required[0]];

        for (const params of [
          { structuredOutput: JSON.stringify(broken), executionFileContent: undefined },
          { structuredOutput: undefined, executionFileContent: executionFile(broken) },
        ]) {
          assert.throws(() => resolveClaudeEmployeeOutput({ ...params, outputSchema: schema }), /no cumple el JSON Schema versionado/, `${employee}: deberia rechazarse`);
        }
      },
    });

    cases.push({
      name: `E: el schema de ${employee} RECHAZA un campo de nivel superior no declarado (additionalProperties:false)`,
      fn: () => {
        const schema = schemaOf(employee);
        const withExtra = { ...(buildMinimalValid(schema) as Record<string, unknown>), campoQueNoExisteEnElContrato: "x" };
        assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: JSON.stringify(withExtra), executionFileContent: undefined, outputSchema: schema }), /campoQueNoExisteEnElContrato/);
      },
    });
  }

  // =====================================================================
  // F / G / H -- precedencia, fallback y no mezclar intentos
  // =====================================================================
  cases.push({
    name: "F: structured_output tiene PRECEDENCIA sobre el execution_file -- con ambos presentes gana el structured_output, el fallback ni se mira",
    fn: () => {
      const schema = schemaOf("qa-reviewer");
      const fromStructured = buildMinimalValid(schema) as Record<string, unknown>;
      const fromFallback = { ...fromStructured, __marcaDeFallback: true };

      const resolved = resolveClaudeEmployeeOutput({
        structuredOutput: JSON.stringify(fromStructured),
        // El fallback lleva un campo extra que el schema rechazaria: si el
        // resolutor lo mirase siquiera, este test fallaria.
        executionFileContent: executionFile(fromFallback),
        outputSchema: schema,
      });
      assert.equal(resolved.source, "structured_output");
      assert.equal((resolved.parsed as Record<string, unknown>).__marcaDeFallback, undefined);
    },
  });

  cases.push({
    name: "G: el fallback SIGUE funcionando cuando structured_output no llega pero hay un result recuperable -- no se ha retirado",
    fn: () => {
      const schema = schemaOf("web-engineer");
      const resolved = resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: executionFile(buildMinimalValid(schema)), outputSchema: schema });
      assert.equal(resolved.source, "execution_file_fallback");
    },
  });

  cases.push({
    name: "G: structured_output vacio o solo espacios NO cuenta como entrega -- se cae al fallback, no se acepta vacio",
    fn: () => {
      const schema = schemaOf("content-strategist");
      for (const empty of ["", "   ", "\n"]) {
        const resolved = resolveClaudeEmployeeOutput({ structuredOutput: empty, executionFileContent: executionFile(buildMinimalValid(schema)), outputSchema: schema });
        assert.equal(resolved.source, "execution_file_fallback");
      }
    },
  });

  cases.push({
    name: "H: ningun intento mezcla salidas -- sin structured_output y sin execution_file (el del intento previo ya descartado) es caso C, nunca la salida anterior",
    fn: () => {
      const schema = schemaOf("growth-director-v2");
      assert.throws(() => resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: undefined, outputSchema: schema }), /no recuperable \(caso C\)/);
    },
  });

  // =====================================================================
  // I / J -- politica de reintento, sin cambios respecto al fix de SEO
  // =====================================================================
  cases.push({
    name: "I: un fallo transitorio del modelo sigue siendo reintentable para CUALQUIERA de los seis empleados",
    fn: () => {
      for (const employee of COORDINATED_EMPLOYEES) {
        const schema = schemaOf(employee);
        const required = (schema as unknown as { required: string[] }).required;
        const broken = { ...(buildMinimalValid(schema) as Record<string, unknown>) };
        delete broken[required[0]];
        let thrown: unknown;
        try {
          resolveClaudeEmployeeOutput({ structuredOutput: undefined, executionFileContent: executionFile(broken), outputSchema: schema });
        } catch (err) {
          thrown = err;
        }
        const classification = classifyClaudeEmployeeFailure(thrown);
        assert.equal(classification.failureClass, "model_output_schema_violation", employee);
        assert.equal(classification.retryable, true, employee);
      }
    },
  });

  cases.push({
    name: "J: auth, configuracion y execution_file corrupto siguen SIN reintentarse (fail-closed), tambien tras extender el fix a cinco empleados mas",
    fn: () => {
      assert.equal(classifyClaudeEmployeeFailure(new Error("BLOCKED_BY_AUTH -- falta CLAUDE_CODE_OAUTH_TOKEN")).retryable, false);
      assert.equal(classifyClaudeEmployeeFailure(new Error('El JSON Schema usa la keyword no soportada "oneOf"')).retryable, false);
      assert.equal(classifyClaudeEmployeeFailure(new Error("execution_file invalido: no es JSON valido")).retryable, false);
    },
  });

  // =====================================================================
  // K -- el runtime comun sigue sirviendo a SEO igual que antes
  // =====================================================================
  cases.push({
    name: "K: el runtime comun sigue funcionando para seo-specialist exactamente igual -- extender el fix no le ha cambiado nada",
    fn: () => {
      const schema = schemaOf("seo-specialist");
      const valid = buildMinimalValid(schema);
      assert.equal(resolveClaudeEmployeeOutput({ structuredOutput: JSON.stringify(valid), executionFileContent: undefined, outputSchema: schema }).source, "structured_output");
      assert.equal(checkSubagentIsToolless("seo-specialist").ok, true);
      assert.deepEqual(parseAgentFrontmatterTools("seo-specialist"), ["StructuredOutput"]);
    },
  });

  // =====================================================================
  // Los workflows tienen que darle tiempo al mecanismo que arregla esto
  // =====================================================================
  cases.push({
    name: "Los SEIS steps de empleado de la pasada coordinada declaran un backstop suficiente para 2-4 turnos mas el reintento (>=20 min), y el job cabe en su propio techo",
    fn: () => {
      const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "zentry-ai-department-daily.yml"), "utf-8");
      const stepTimeouts = [...workflow.matchAll(/^ {8}timeout-minutes: (\d+)/gm)].map((match) => Number(match[1]));
      const employeeTimeouts = stepTimeouts.filter((minutes) => minutes <= 30);
      assert.ok(employeeTimeouts.length >= 6, `esperados >=6 backstops de empleado, encontrados ${JSON.stringify(stepTimeouts)}`);
      for (const minutes of employeeTimeouts) {
        assert.ok(minutes >= 20, `un backstop de ${minutes} min ya no basta con StructuredOutput concedido`);
      }
      const jobTimeout = Number(/^ {4}timeout-minutes: (\d+)/m.exec(workflow)?.[1]);
      assert.ok(jobTimeout >= 6 * 20, `el job (${jobTimeout} min) debe cubrir el peor caso de los seis empleados`);
    },
  });

  return cases;
}
