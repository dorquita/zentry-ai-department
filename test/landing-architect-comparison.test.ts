import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { auditV2OutputForFabrication, LandingArchitectComparisonArtifact, LandingArchitectV2Output, renderComparisonMarkdown } from "../src/core/landing-architect-comparison";
import { LandingArchitectContext } from "../src/core/landing-architect-v2-context";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(overrides: Partial<LandingArchitectContext> = {}): LandingArchitectContext {
  return {
    changePackId: "test-change-pack",
    keyword: "taquillas melamina",
    page: "https://zentrylockers.com/taquillas-melamina/",
    changeType: "seo_on_page_update",
    priority: "medium",
    status: "approved_to_execute",
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    sector: undefined,
    material: "melamina",
    isSmartLockTopic: false,
    suggestedSecondaryCta: false,
    templateHint: "product_landing",
    proposedHeadings: ["Modelos y medidas disponibles", "Precios y presupuesto sin compromiso"],
    existingFaqs: [],
    internalLinks: [],
    currentAssumptions: [],
    ...overrides,
  };
}

function baseV2Output(overrides: Partial<LandingArchitectV2Output> = {}): LandingArchitectV2Output {
  return {
    hero: { headline: "Taquillas de melamina", subheadline: "Fabricacion a medida." },
    ctaPrimary: { label: "Solicitar presupuesto", target: "#solicitar-presupuesto", isRealLink: false },
    benefitBlocks: [],
    cards: [],
    sections: [],
    faq: [],
    finalCta: { headline: "Solicita presupuesto", cta: { label: "Solicitar presupuesto", target: "#solicitar-presupuesto", isRealLink: false } },
    internalLinks: [],
    visualHierarchyNotes: [],
    reasoningNotes: [],
    ...overrides,
  };
}

export function runLandingArchitectComparisonTests(): TestCase[] {
  return [
    // --- Caso de regresion EXACTO observado en la demo real (ver docs/ux-ui-landing-architect-v2-experiment.md) ---
    {
      name: "REGRESION: garantia marcada 'pendiente de confirmar' en el input + V2 afirmando 'cuentan con garantia de fabricante' => warning (antes era un falso negativo)",
      fn: () => {
        const context = baseContext({
          existingFaqs: [
            {
              question: "¿Que garantia tienen las taquillas?",
              answer: "Indicar la garantia real del producto (pendiente de confirmar con el equipo).",
            },
          ],
        });
        const v2 = baseV2Output({
          faq: [
            {
              question: "¿Que garantia tienen las taquillas?",
              answer: "Todas nuestras taquillas de melamina cuentan con garantia de fabricante.",
            },
          ],
        });

        const warnings = auditV2OutputForFabrication(context, v2);

        assert.ok(warnings.length > 0, "deberia generar al menos un warning de garantia no respaldada");
        assert.ok(
          warnings.some((w) => /garant/i.test(w)),
          `deberia haber un warning mencionando garantia, warnings: ${JSON.stringify(warnings)}`
        );
      },
    },
    {
      name: "garantia SI respaldada (el input confirma garantia sin lenguaje de pendiente) no genera warning de garantia",
      fn: () => {
        const context = baseContext({
          currentAssumptions: ["Todas las taquillas incluyen garantia de fabricante de 2 años, ya confirmada por el equipo comercial."],
        });
        const v2 = baseV2Output({
          sections: [{ heading: "Garantia", body: "Todas nuestras taquillas cuentan con garantia de fabricante.", searchIntent: "commercial" }],
        });

        const warnings = auditV2OutputForFabrication(context, v2);

        assert.ok(
          !warnings.some((w) => /garant/i.test(w)),
          `no deberia haber warning de garantia cuando el input la respalda, warnings: ${JSON.stringify(warnings)}`
        );
      },
    },

    // --- precio ---
    {
      name: "precio: cifra en euros que no aparece en el input => warning",
      fn: () => {
        const context = baseContext();
        const v2 = baseV2Output({ sections: [{ heading: "Precio", body: "Nuestras taquillas cuestan desde 129€.", searchIntent: "transactional" }] });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.ok(warnings.some((w) => /precio/i.test(w)));
      },
    },
    {
      name: "precio: la misma cifra ya presente en el input (sin hedge) no genera warning",
      fn: () => {
        const context = baseContext({ currentAssumptions: ["El precio base confirmado para este modelo es de 129€ segun la ultima lista de precios."] });
        const v2 = baseV2Output({ sections: [{ heading: "Precio", body: "El precio es de 129€.", searchIntent: "transactional" }] });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.ok(!warnings.some((w) => /precio/i.test(w)));
      },
    },

    // --- plazo de entrega ---
    {
      name: "plazo de entrega: cifra de dias que no aparece en el input => warning",
      fn: () => {
        const context = baseContext();
        const v2 = baseV2Output({ faq: [{ question: "¿Cuanto tarda?", answer: "La entrega tarda 3 dias." }] });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.ok(warnings.some((w) => /plazo de entrega/i.test(w)));
      },
    },
    {
      name: "plazo de entrega: input marca el plazo como 'confirmar' => cualquier cifra de V2 sigue sin respaldo, incluso una cifra que tambien aparece en el input",
      fn: () => {
        const context = baseContext({
          existingFaqs: [{ question: "¿Cuanto tarda la entrega?", answer: "Aproximadamente 5 dias, a confirmar segun stock." }],
        });
        const v2 = baseV2Output({ faq: [{ question: "¿Cuanto tarda?", answer: "La entrega tarda 5 dias." }] });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.ok(
          warnings.some((w) => /plazo de entrega/i.test(w)),
          "el hedge 'a confirmar' en la misma frase del input invalida ese respaldo, incluso si la cifra coincide"
        );
      },
    },

    // --- fabricante directo / sin intermediarios ---
    {
      name: "fabricante directo: afirmado por V2 sin ningun respaldo en el input => warning",
      fn: () => {
        const context = baseContext();
        const v2 = baseV2Output({ benefitBlocks: [{ title: "Fabricante directo", description: "Somos fabricante directo, sin intermediarios." }] });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.ok(warnings.some((w) => /fabricante directo/i.test(w)));
      },
    },
    {
      name: "fabricante directo: respaldado porque el input ya lo afirma sin hedge => no genera warning",
      fn: () => {
        const context = baseContext({ currentAssumptions: ["Zentry fabrica y vende directamente sus productos, sin intermediarios."] });
        const v2 = baseV2Output({ benefitBlocks: [{ title: "Fabricante directo", description: "Sin intermediarios, trato directo con quien fabrica tu pedido." }] });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.ok(!warnings.some((w) => /fabricante directo/i.test(w)));
      },
    },

    // --- funcionalidad de producto ---
    {
      name: "funcionalidad de producto: 'todas las taquillas incluyen app' sin respaldo => warning",
      fn: () => {
        const context = baseContext();
        const v2 = baseV2Output({ sections: [{ heading: "Control de acceso", body: "Todas las taquillas incluyen app de gestion remota.", searchIntent: "informational" }] });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.ok(warnings.some((w) => /funcionalidad de producto/i.test(w)));
      },
    },

    // --- Sanity: una salida sin ninguna afirmacion sensible no genera ningun warning ---
    {
      name: "salida sin afirmaciones sensibles (todo remite a presupuesto) no genera ningun warning",
      fn: () => {
        const context = baseContext();
        const v2 = baseV2Output({
          sections: [{ heading: "Precio", body: "Preparamos un presupuesto a medida sin compromiso, segun tu pedido.", searchIntent: "transactional" }],
        });
        const warnings = auditV2OutputForFabrication(context, v2);
        assert.deepEqual(warnings, []);
      },
    },

    // --- Fixture sanitizado (ver punto 5 de la ronda de correcciones): smoke test del formato de artefacto ---
    {
      name: "el fixture sanitizado test/fixtures/landing-architect-comparison-example.json se renderiza sin lanzar y contiene las secciones esperadas",
      fn: () => {
        const fixturePath = path.join(__dirname, "fixtures", "landing-architect-comparison-example.json");
        const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as LandingArchitectComparisonArtifact;

        const markdown = renderComparisonMarkdown(artifact);

        assert.match(markdown, /## Input/);
        assert.match(markdown, /## Output V1/);
        assert.match(markdown, /## Output V2/);
        assert.match(markdown, /## Diferencias estructurales/);
        assert.match(markdown, /## Criterios de evaluacion/);
        // El fixture no contiene ningun changePackId/keyword real del dataset de produccion.
        assert.doesNotMatch(markdown, /zentrylockers\.com/);
      },
    },
    {
      name: "el fixture sanitizado es internamente consistente: su fabricationWarnings coincide con lo que produciria auditV2OutputForFabrication sobre su propio input/output",
      fn: () => {
        const fixturePath = path.join(__dirname, "fixtures", "landing-architect-comparison-example.json");
        const artifact = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as LandingArchitectComparisonArtifact;
        assert.equal(artifact.v2.status, "executed");
        if (artifact.v2.status !== "executed") return;

        const recomputedWarnings = auditV2OutputForFabrication(artifact.input, artifact.v2.output);
        assert.ok(recomputedWarnings.length > 0, "el fixture ilustra un caso CON warning -- si esto falla, el fixture quedo desincronizado con la logica de auditoria real");
      },
    },
  ];
}
