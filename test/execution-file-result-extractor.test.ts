import * as assert from "node:assert/strict";
import { extractFinalResultMessage, recoverV2OutputFromExecutionFile } from "../src/core/execution-file-result-extractor";

export interface TestCase {
  name: string;
  fn: () => void;
}

const VALID_V2_OUTPUT = {
  hero: { headline: "Taquillas de melamina", subheadline: "Fabricacion a medida." },
  ctaPrimary: { label: "Solicitar presupuesto", target: "#solicitar-presupuesto", isRealLink: false },
  benefitBlocks: [{ title: "Fabricante directo", description: "Sin intermediarios." }],
  cards: [{ title: "Melamina", description: "Acabado calido." }],
  sections: [{ heading: "Modelos disponibles", body: "Texto de ejemplo.", searchIntent: "commercial" }],
  faq: [{ question: "¿Que garantia tiene?", answer: "Te lo confirmamos con tu presupuesto." }],
  finalCta: { headline: "Solicita presupuesto", cta: { label: "Solicitar presupuesto", target: "#solicitar-presupuesto", isRealLink: false } },
  internalLinks: [],
  visualHierarchyNotes: ["Un solo H1."],
  reasoningNotes: ["Nota de razonamiento de ejemplo."],
};

// Secuencia realista de mensajes SDK para un run sin herramientas
// (tools: [], num_turns: 1) -- system(init) -> assistant (texto) ->
// result. Basada en la forma real observada en el log del run fallido
// (docs/ux-ui-landing-architect-v2-experiment.md): subtype "success",
// is_error false, num_turns 1, permission_denials_count 0.
function realisticMessages(resultOverrides: Record<string, unknown> = {}): unknown[] {
  return [
    { type: "system", subtype: "init", message: "Claude Code initialized", model: "claude-sonnet-5" },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "(texto intermedio del turno, no es el resultado final)" }] },
      parent_tool_use_id: null,
      uuid: "assistant-uuid-1",
      session_id: "session-1",
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 63184,
      num_turns: 1,
      total_cost_usd: 0.175569,
      permission_denials_count: 0,
      result: JSON.stringify(VALID_V2_OUTPUT),
      uuid: "result-uuid-1",
      session_id: "session-1",
      ...resultOverrides,
    },
  ];
}

export function runExecutionFileResultExtractorTests(): TestCase[] {
  return [
    {
      name: "extractFinalResultMessage encuentra el mensaje final de tipo result entre mensajes intermedios (no confunde el assistant intermedio con el resultado)",
      fn: () => {
        const messages = realisticMessages();
        const result = extractFinalResultMessage(messages);
        assert.equal(result.type, "result");
        assert.equal(result.subtype, "success");
      },
    },
    {
      name: "extractFinalResultMessage usa el ULTIMO mensaje de tipo result si aparece mas de uno",
      fn: () => {
        const messages = [...realisticMessages({ result: JSON.stringify({ ...VALID_V2_OUTPUT, hero: { headline: "version vieja", subheadline: "x" } }) }), { type: "result", subtype: "success", is_error: false, result: JSON.stringify({ ...VALID_V2_OUTPUT, hero: { headline: "version final", subheadline: "x" } }) }];
        const result = extractFinalResultMessage(messages);
        assert.match(String(result.result), /version final/);
      },
    },
    {
      name: "extractFinalResultMessage (fail-closed) lanza si no hay ningun mensaje de tipo result",
      fn: () => {
        const messages = [{ type: "system", subtype: "init" }, { type: "assistant", message: {} }];
        assert.throws(() => extractFinalResultMessage(messages), /no se encontro ningun mensaje final de tipo "result"/);
      },
    },
    {
      name: "extractFinalResultMessage (fail-closed) lanza si el input no es un array",
      fn: () => {
        assert.throws(() => extractFinalResultMessage({ not: "an array" }), /se esperaba un array/);
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile: extrae y valida un resultado JSON valido (caso feliz del fallback)",
      fn: () => {
        const raw = JSON.stringify(realisticMessages());
        const recovered = recoverV2OutputFromExecutionFile(raw);
        assert.equal(recovered.output.hero.headline, "Taquillas de melamina");
        assert.equal(recovered.rawResultText, JSON.stringify(VALID_V2_OUTPUT));
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile: tolera un fence ```json ... ``` en el campo result (reutiliza extractJsonFromModelResponse)",
      fn: () => {
        const fenced = "```json\n" + JSON.stringify(VALID_V2_OUTPUT) + "\n```";
        const raw = JSON.stringify(realisticMessages({ result: fenced }));
        const recovered = recoverV2OutputFromExecutionFile(raw);
        assert.equal(recovered.output.hero.headline, "Taquillas de melamina");
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile (fail-closed): lanza si el execution_file no es JSON valido",
      fn: () => {
        assert.throws(() => recoverV2OutputFromExecutionFile("esto no es JSON"), /no es JSON valido/);
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile (fail-closed): lanza si no hay ningun mensaje result final",
      fn: () => {
        const raw = JSON.stringify([{ type: "system", subtype: "init" }]);
        assert.throws(() => recoverV2OutputFromExecutionFile(raw), /no se encontro ningun mensaje final/);
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile (fail-closed): lanza si el resultado final indica un fallo real de Claude (is_error true)",
      fn: () => {
        const raw = JSON.stringify(realisticMessages({ subtype: "success", is_error: true }));
        assert.throws(() => recoverV2OutputFromExecutionFile(raw), /Fallo real de Claude/);
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile (fail-closed): lanza si el subtype no es success (p.ej. error_max_structured_output_retries)",
      fn: () => {
        const raw = JSON.stringify(realisticMessages({ subtype: "error_max_structured_output_retries", is_error: undefined, result: undefined }));
        assert.throws(() => recoverV2OutputFromExecutionFile(raw), /Fallo real de Claude/);
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile (fail-closed): lanza si el campo result esta vacio",
      fn: () => {
        const raw = JSON.stringify(realisticMessages({ result: "   " }));
        assert.throws(() => recoverV2OutputFromExecutionFile(raw), /texto no vacio/);
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile (fail-closed): lanza si el texto de result no es JSON valido (ni con fence ni sin el)",
      fn: () => {
        const raw = JSON.stringify(realisticMessages({ result: "esto no es JSON en absoluto" }));
        assert.throws(() => recoverV2OutputFromExecutionFile(raw));
      },
    },
    {
      name: "recoverV2OutputFromExecutionFile (fail-closed): lanza si el JSON es valido pero no cumple LandingArchitectV2Output (falta hero)",
      fn: () => {
        const invalidShape = { ...VALID_V2_OUTPUT } as Record<string, unknown>;
        delete invalidShape.hero;
        const raw = JSON.stringify(realisticMessages({ result: JSON.stringify(invalidShape) }));
        assert.throws(() => recoverV2OutputFromExecutionFile(raw), /hero/);
      },
    },
  ];
}
