import * as assert from "node:assert/strict";
import { ContentStrategistOutput, validateContentStrategistOutput } from "../src/employees/content-strategist/output";

export interface TestCase {
  name: string;
  fn: () => void;
}

function minimalValidOutput(): Record<string, unknown> {
  return {
    contentOpportunity: { title: "Taquillas de melamina para colegios", summary: "Keyword con volumen sin pagina dedicada." },
    targetAudience: "Responsable de compras de un colegio que renueva vestuarios.",
    searchIntent: "commercial",
    commercialIntent: "Busca comparar materiales antes de pedir presupuesto.",
    angle: "Comparativa de materiales orientada a centros educativos.",
    contentType: "title_meta_improvement",
    targetBrand: "zentry",
    recommendedStructure: {
      h1: "Taquillas de melamina: guia para colegios",
      sections: [{ heading: "Que es taquillas melamina", level: "H2", purpose: "Definir el producto para quien no lo conoce." }],
    },
    ctaStrategy: { primaryCta: "Solicitar presupuesto sin compromiso", rationale: "Coherente con la intencion comercial detectada." },
    internalLinks: [{ anchorIdea: "taquillas colegios", targetDescription: "pagina de categoria taquillas colegios (sin URL confirmada)", isRealLink: false }],
    supportingEvidence: ['El brief de entrada asume que "taquillas melamina" sigue siendo relevante para zentry.'],
    priority: "medium",
    risksAndUnknowns: ["Posible canibalizacion con paginas ya existentes del mismo cluster."],
    reasoningNotes: ["Se prioriza la comparativa de materiales porque es la duda mas repetida en el cluster."],
  };
}

export function runContentStrategistOutputTests(): TestCase[] {
  return [
    {
      name: "salida minima valida es aceptada",
      fn: () => {
        assert.doesNotThrow(() => validateContentStrategistOutput(minimalValidOutput()));
      },
    },
    {
      name: "ctaStrategy.secondaryCta es opcional: ausente sigue siendo valido",
      fn: () => {
        const output = minimalValidOutput();
        assert.ok(!("secondaryCta" in (output.ctaStrategy as Record<string, unknown>)));
        assert.doesNotThrow(() => validateContentStrategistOutput(output));
      },
    },
    {
      name: "ctaStrategy.secondaryCta presente y string es valido",
      fn: () => {
        const output = minimalValidOutput();
        (output.ctaStrategy as Record<string, unknown>).secondaryCta = "Pedir informacion tecnica";
        const validated = validateContentStrategistOutput(output) as ContentStrategistOutput;
        assert.equal(validated.ctaStrategy.secondaryCta, "Pedir informacion tecnica");
      },
    },
    {
      name: "FAIL-CLOSED: no es un objeto -> lanza",
      fn: () => {
        assert.throws(() => validateContentStrategistOutput("no soy un objeto"), /objeto JSON/);
        assert.throws(() => validateContentStrategistOutput(null), /objeto JSON/);
        assert.throws(() => validateContentStrategistOutput(undefined), /objeto JSON/);
      },
    },
    {
      name: "FAIL-CLOSED: falta un campo requerido (contentOpportunity) -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        delete output.contentOpportunity;
        assert.throws(() => validateContentStrategistOutput(output), /contentOpportunity/);
      },
    },
    {
      name: "FAIL-CLOSED: falta targetAudience -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        delete output.targetAudience;
        assert.throws(() => validateContentStrategistOutput(output), /targetAudience/);
      },
    },
    {
      name: "FAIL-CLOSED: searchIntent fuera del enum -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        output.searchIntent = "not_a_real_intent";
        assert.throws(() => validateContentStrategistOutput(output), /searchIntent/);
      },
    },
    {
      name: "FAIL-CLOSED: contentType fuera del enum reutilizado de src/agents/content-planner.ts -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        output.contentType = "blog_post"; // no existe en el enum ContentType real
        assert.throws(() => validateContentStrategistOutput(output), /contentType/);
      },
    },
    {
      name: "FAIL-CLOSED: targetBrand fuera del enum (p.ej. 'both', valor de BrandTarget pero no de ContentTargetBrand) -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        output.targetBrand = "both";
        assert.throws(() => validateContentStrategistOutput(output), /targetBrand/);
      },
    },
    {
      name: "FAIL-CLOSED: recommendedStructure.sections[].level fuera de H2/H3 -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        (output.recommendedStructure as Record<string, unknown>).sections = [{ heading: "x", level: "H1", purpose: "y" }];
        assert.throws(() => validateContentStrategistOutput(output), /recommendedStructure/);
      },
    },
    {
      name: "FAIL-CLOSED: internalLinks[].isRealLink como string en vez de boolean -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        (output.internalLinks as Array<Record<string, unknown>>)[0].isRealLink = "yes";
        assert.throws(() => validateContentStrategistOutput(output), /internalLinks/);
      },
    },
    {
      name: "FAIL-CLOSED: priority fuera del enum -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        output.priority = "urgent";
        assert.throws(() => validateContentStrategistOutput(output), /priority/);
      },
    },
    {
      name: "FAIL-CLOSED: supportingEvidence no es string[] -> lanza",
      fn: () => {
        const output = minimalValidOutput();
        output.supportingEvidence = "no es un array";
        assert.throws(() => validateContentStrategistOutput(output), /supportingEvidence/);
      },
    },
    {
      name: "FAIL-CLOSED: campos extra en un item de internalLinks no rompen el validador TypeScript (duck-typing permisivo, a diferencia del JSON Schema con additionalProperties:false)",
      fn: () => {
        const output = minimalValidOutput();
        (output.internalLinks as Array<Record<string, unknown>>)[0].unexpectedField = "extra";
        assert.doesNotThrow(() => validateContentStrategistOutput(output));
      },
    },
  ];
}
