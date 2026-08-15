import * as assert from "node:assert/strict";
import { auditContentStrategistOutputForUnsupportedClaims } from "../src/employees/content-strategist/audit";
import { ContentStrategistContext } from "../src/employees/content-strategist/context";
import { ContentStrategistOutput } from "../src/employees/content-strategist/output";

export interface TestCase {
  name: string;
  fn: () => void;
}

function baseContext(overrides: Partial<ContentStrategistContext> = {}): ContentStrategistContext {
  return {
    changePackId: "test-change-pack",
    workOrderId: "test-work-order",
    keyword: "taquillas melamina",
    page: "https://zentrylockers.com/taquillas-melamina/",
    changeType: "content_update",
    priority: "medium",
    status: "approved_to_execute",
    targetBrand: "zentry",
    brandIntent: "zentry_locker_core",
    contentTypeHint: "Mejora de title/meta",
    recommendedTitleHint: "Taquillas Melamina",
    primaryKeyword: "taquillas melamina",
    secondaryKeywords: ["taquillas colegios"],
    proposedStructureHint: ["H2: Precios y presupuesto"],
    intentHint: "Zentry principal",
    brandRationale: "",
    recommendedCtaHint: "",
    internalLinkHints: [],
    clusterNote: "",
    currentAssumptions: [],
    risks: [],
    ...overrides,
  };
}

function baseOutput(overrides: Partial<ContentStrategistOutput> = {}): ContentStrategistOutput {
  return {
    contentOpportunity: { title: "Taquillas de melamina", summary: "Oportunidad de ejemplo." },
    targetAudience: "Responsable de compras.",
    searchIntent: "commercial",
    commercialIntent: "Comparar antes de pedir presupuesto.",
    angle: "Comparativa de materiales.",
    contentType: "title_meta_improvement",
    targetBrand: "zentry",
    recommendedStructure: { h1: "Taquillas de melamina", sections: [] },
    ctaStrategy: { primaryCta: "Solicitar presupuesto sin compromiso", rationale: "Coherente con la intencion." },
    internalLinks: [],
    supportingEvidence: [],
    priority: "medium",
    risksAndUnknowns: [],
    reasoningNotes: [],
    ...overrides,
  };
}

export function runContentStrategistAuditTests(): TestCase[] {
  return [
    // --- Caso REGRESION equivalente al de landing-architect: garantia marcada "pendiente" en el input + salida afirmandola ---
    {
      name: "REGRESION: garantia marcada pendiente de confirmar en currentAssumptions + salida afirmando garantia de fabricante => warning",
      fn: () => {
        const context = baseContext({
          currentAssumptions: ["Indicar la garantia real del producto (pendiente de confirmar con el equipo)."],
        });
        const output = baseOutput({
          supportingEvidence: ["Todas nuestras taquillas de melamina cuentan con garantia de fabricante."],
        });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => /garant/i.test(w)), `deberia haber warning de garantia, warnings: ${JSON.stringify(warnings)}`);
      },
    },
    {
      name: "garantia SI respaldada (currentAssumptions la confirma sin lenguaje de pendiente) no genera warning de garantia",
      fn: () => {
        const context = baseContext({
          currentAssumptions: ["Todas las taquillas incluyen garantia de fabricante de 2 años, ya confirmada por el equipo comercial."],
        });
        const output = baseOutput({ risksAndUnknowns: ["Recordar mencionar que cuentan con garantia de fabricante en el CTA final."] });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(!warnings.some((w) => /garant/i.test(w)));
      },
    },
    // --- precio ---
    {
      name: "precio: cifra en euros que no aparece en currentAssumptions => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ angle: "Nuestras taquillas cuestan desde 129€." });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => /precio/i.test(w)));
      },
    },
    {
      name: "precio: la misma cifra ya presente en currentAssumptions (sin hedge) no genera warning",
      fn: () => {
        const context = baseContext({ currentAssumptions: ["El precio base confirmado para este modelo es de 129€ segun la ultima lista de precios."] });
        const output = baseOutput({ angle: "El precio es de 129€." });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(!warnings.some((w) => /precio/i.test(w)));
      },
    },
    // --- plazo de entrega ---
    {
      name: "plazo de entrega: cifra de dias que no aparece en el input => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ risksAndUnknowns: ["La entrega tarda 3 dias."] });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => /plazo de entrega/i.test(w)));
      },
    },
    {
      name: "plazo de entrega: currentAssumptions marca el plazo como a confirmar => la cifra de la salida sigue sin respaldo aunque coincida",
      fn: () => {
        const context = baseContext({ currentAssumptions: ["Aproximadamente 5 dias, a confirmar segun stock."] });
        const output = baseOutput({ reasoningNotes: ["La entrega tarda 5 dias."] });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => /plazo de entrega/i.test(w)), "el hedge 'a confirmar' invalida el respaldo, incluso si la cifra coincide");
      },
    },
    // --- fabricante directo ---
    {
      name: "fabricante directo: afirmado sin ningun respaldo en currentAssumptions => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ ctaStrategy: { primaryCta: "Somos fabricante directo, sin intermediarios.", rationale: "x" } });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => /fabricante directo/i.test(w)));
      },
    },
    {
      name: "fabricante directo: respaldado porque currentAssumptions ya lo afirma sin hedge => no genera warning",
      fn: () => {
        const context = baseContext({ currentAssumptions: ["Zentry fabrica y vende directamente sus productos, sin intermediarios."] });
        const output = baseOutput({ angle: "Sin intermediarios, trato directo con quien fabrica tu pedido." });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(!warnings.some((w) => /fabricante directo/i.test(w)));
      },
    },
    // --- funcionalidad de producto ---
    {
      name: "funcionalidad de producto: 'todas las taquillas incluyen app' sin respaldo => warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ recommendedStructure: { h1: "x", sections: [{ heading: "Control de acceso", level: "H2", purpose: "Todas las taquillas incluyen app de gestion remota." }] } });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => /funcionalidad de producto/i.test(w)));
      },
    },
    // --- Sanity: sin afirmaciones sensibles no genera ningun warning ---
    {
      name: "salida sin afirmaciones sensibles ni enlaces reales sin respaldo no genera ningun warning",
      fn: () => {
        const context = baseContext();
        const output = baseOutput({ angle: "Preparamos un presupuesto a medida sin compromiso, segun tu pedido." });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    // --- Verificacion de realismo de enlazado interno (especifica de content-strategist) ---
    {
      name: "internalLinks: isRealLink:true cuyo targetDescription coincide con la page real del context no genera warning",
      fn: () => {
        const context = baseContext({ page: "https://zentrylockers.com/taquillas-melamina/" });
        const output = baseOutput({
          internalLinks: [{ anchorIdea: "taquillas melamina", targetDescription: "https://zentrylockers.com/taquillas-melamina/", isRealLink: true }],
        });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "internalLinks: isRealLink:true con una URL inventada (no coincide con page ni con ninguna pista) => warning",
      fn: () => {
        const context = baseContext({ page: "https://zentrylockers.com/taquillas-melamina/", internalLinkHints: [], secondaryKeywords: [], clusterNote: "" });
        const output = baseOutput({
          internalLinks: [{ anchorIdea: "taquillas metalicas", targetDescription: "https://zentrylockers.com/taquillas-metalicas-gimnasio/", isRealLink: true }],
        });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.ok(warnings.some((w) => /Enlace interno marcado isRealLink:true/i.test(w)));
      },
    },
    {
      name: "internalLinks: isRealLink:true cuyo targetDescription coincide con una pista real (clusterNote/secondaryKeywords/internalLinkHints) no genera warning",
      fn: () => {
        const context = baseContext({ page: undefined, secondaryKeywords: ["taquillas colegios"] });
        const output = baseOutput({
          internalLinks: [{ anchorIdea: "taquillas colegios", targetDescription: "taquillas colegios", isRealLink: true }],
        });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
    {
      name: "REGRESION: internalLinks isRealLink:true con targetDescription vacio/solo espacios SIEMPRE genera warning, incluso con pistas conocidas presentes (guard contra hint.includes('') vacuamente true)",
      fn: () => {
        const context = baseContext({ page: "https://zentrylockers.com/taquillas-melamina/", secondaryKeywords: ["taquillas colegios"], clusterNote: "cluster de ejemplo" });
        const output = baseOutput({
          internalLinks: [
            { anchorIdea: "x", targetDescription: "", isRealLink: true },
            { anchorIdea: "y", targetDescription: "   ", isRealLink: true },
          ],
        });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.equal(warnings.length, 2, `deberian generarse 2 warnings (uno por cada targetDescription vacio), warnings: ${JSON.stringify(warnings)}`);
        assert.ok(warnings.every((w) => /targetDescription vacio/i.test(w)));
      },
    },
    {
      name: "internalLinks: isRealLink:false nunca genera warning de enlace, sea cual sea el targetDescription",
      fn: () => {
        const context = baseContext({ page: "https://zentrylockers.com/taquillas-melamina/" });
        const output = baseOutput({
          internalLinks: [{ anchorIdea: "taquillas metalicas", targetDescription: "https://zentrylockers.com/pagina-totalmente-inventada/", isRealLink: false }],
        });
        const warnings = auditContentStrategistOutputForUnsupportedClaims(context, output);
        assert.deepEqual(warnings, []);
      },
    },
  ];
}
