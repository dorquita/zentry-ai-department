import { LandingBlueprint, LandingBenefitItem, LandingCardItem, LandingComparisonTable, LandingFaqItem, LandingSection } from "./types";
import { LandingArchitectContext } from "./landing-architect-v2-context";

/**
 * Runner de comparacion V1 (determinista) vs V2 (subagente Claude) --
 * ver docs/ux-ui-landing-architect-v2-experiment.md. Este modulo es TOOL
 * puro: no llama a ningun modelo, no decide cual version es mejor, no
 * aplica nada. Solo sabe (a) validar que la salida de V2 tiene la forma
 * esperada, (b) auditar esa salida en busca de datos que parezcan
 * fabricados, y (c) montar un artefacto comparable con input/output
 * v1/output v2/diferencias/criterios de evaluacion -- SIN veredicto
 * automatico. Quien decide si V2 es mejor que V1 es un humano, leyendo
 * el artefacto.
 */

// El mismo contrato de salida que ya usa v1 (Omit<LandingBlueprint, ids/timestamps>),
// mas `reasoningNotes`, exclusivo de V2 -- ver .claude/agents/ux-ui-landing-architect-v2.md.
export interface LandingArchitectV2Output {
  hero: { headline: string; subheadline: string };
  heroImageCaption?: string;
  benefitsHeading?: string;
  comparisonTable?: LandingComparisonTable;
  useCases?: string[];
  processSteps?: string[];
  ctaPrimary: { label: string; target: string; isRealLink: boolean };
  ctaSecondary?: { label: string; target: string; isRealLink: boolean };
  benefitBlocks: LandingBenefitItem[];
  cards: LandingCardItem[];
  sections: LandingSection[];
  faq: LandingFaqItem[];
  finalCta: { headline: string; cta: { label: string; target: string; isRealLink: boolean } };
  internalLinks: string[];
  visualHierarchyNotes: string[];
  reasoningNotes: string[];
}

export type V1BlueprintInput = Omit<LandingBlueprint, "blueprintId" | "createdAt" | "updatedAt">;

/**
 * Valida (sin librerias externas -- ninguna dependencia nueva) que un
 * objeto crudo tiene la forma minima de un `LandingArchitectV2Output`.
 * Fail-closed: cualquier campo obligatorio ausente o del tipo
 * equivocado lanza -- nunca se "rellena" con un valor por defecto que
 * disfrazaria una salida rota del subagente como si fuera valida.
 */
export function validateV2Output(raw: unknown): LandingArchitectV2Output {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salida V2 invalida: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  const isString = (v: unknown): v is string => typeof v === "string";
  const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
  const isCta = (v: unknown): v is { label: string; target: string; isRealLink: boolean } =>
    typeof v === "object" && v !== null && isString((v as Record<string, unknown>).label) && isString((v as Record<string, unknown>).target) && typeof (v as Record<string, unknown>).isRealLink === "boolean";

  if (typeof o.hero !== "object" || o.hero === null || !isString((o.hero as Record<string, unknown>).headline) || !isString((o.hero as Record<string, unknown>).subheadline)) {
    throw new Error("Salida V2 invalida: falta hero.headline / hero.subheadline (string).");
  }
  if (!isCta(o.ctaPrimary)) {
    throw new Error("Salida V2 invalida: falta ctaPrimary { label, target, isRealLink }.");
  }
  if (!Array.isArray(o.benefitBlocks) || !o.benefitBlocks.every((b) => typeof b === "object" && b !== null && isString((b as Record<string, unknown>).title) && isString((b as Record<string, unknown>).description))) {
    throw new Error("Salida V2 invalida: benefitBlocks debe ser LandingBenefitItem[].");
  }
  if (!Array.isArray(o.cards) || !o.cards.every((c) => typeof c === "object" && c !== null && isString((c as Record<string, unknown>).title) && isString((c as Record<string, unknown>).description))) {
    throw new Error("Salida V2 invalida: cards debe ser LandingCardItem[].");
  }
  if (
    !Array.isArray(o.sections) ||
    !o.sections.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        isString((s as Record<string, unknown>).heading) &&
        isString((s as Record<string, unknown>).body) &&
        ["informational", "transactional", "comparison", "commercial"].includes((s as Record<string, unknown>).searchIntent as string)
    )
  ) {
    throw new Error("Salida V2 invalida: sections debe ser LandingSection[] con searchIntent valido.");
  }
  if (!Array.isArray(o.faq) || !o.faq.every((f) => typeof f === "object" && f !== null && isString((f as Record<string, unknown>).question) && isString((f as Record<string, unknown>).answer))) {
    throw new Error("Salida V2 invalida: faq debe ser LandingFaqItem[].");
  }
  if (typeof o.finalCta !== "object" || o.finalCta === null || !isString((o.finalCta as Record<string, unknown>).headline) || !isCta((o.finalCta as Record<string, unknown>).cta)) {
    throw new Error("Salida V2 invalida: falta finalCta { headline, cta }.");
  }
  if (!isStringArray(o.internalLinks)) {
    throw new Error("Salida V2 invalida: internalLinks debe ser string[].");
  }
  if (!isStringArray(o.visualHierarchyNotes)) {
    throw new Error("Salida V2 invalida: visualHierarchyNotes debe ser string[].");
  }
  if (!isStringArray(o.reasoningNotes)) {
    throw new Error("Salida V2 invalida: reasoningNotes debe ser string[].");
  }
  if (o.ctaSecondary !== undefined && !isCta(o.ctaSecondary)) {
    throw new Error("Salida V2 invalida: ctaSecondary, si esta presente, debe ser { label, target, isRealLink }.");
  }

  return o as unknown as LandingArchitectV2Output;
}

// Patrones de cifras/plazos/garantias concretas -- exactamente el tipo
// de dato que zentry-brand (SKILL) prohibe fabricar. No es un check
// semantico completo (no entiende contexto), es una red de seguridad
// textual: cualquier coincidencia se reporta como WARNING para revision
// humana, nunca bloquea nada automaticamente (este runner solo genera
// reportes locales, no aplica nada).
const FABRICATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\d+\s*€/g, label: "precio en euros" },
  { pattern: /desde\s+\d+/gi, label: "precio \"desde X\"" },
  { pattern: /\d+\s*(dias|d[ií]as|semanas|meses)\b/gi, label: "plazo de entrega concreto" },
  { pattern: /garant[ií]a\s+de\s+\d+\s*(a[nñ]os?|meses)/gi, label: "condicion de garantia concreta" },
  { pattern: /\d+\s*%/g, label: "porcentaje/descuento concreto" },
];

function collectTextFields(v2: LandingArchitectV2Output): string[] {
  const texts: string[] = [v2.hero.headline, v2.hero.subheadline, v2.ctaPrimary.label, v2.finalCta.headline, v2.finalCta.cta.label];
  if (v2.heroImageCaption) texts.push(v2.heroImageCaption);
  if (v2.benefitsHeading) texts.push(v2.benefitsHeading);
  if (v2.ctaSecondary) texts.push(v2.ctaSecondary.label);
  for (const b of v2.benefitBlocks) texts.push(b.title, b.description);
  for (const c of v2.cards) texts.push(c.title, c.description);
  for (const s of v2.sections) texts.push(s.heading, s.body);
  for (const f of v2.faq) texts.push(f.question, f.answer);
  if (v2.comparisonTable) {
    texts.push(v2.comparisonTable.title);
    for (const row of v2.comparisonTable.rows) texts.push(...row);
  }
  return texts;
}

/**
 * Compara cada coincidencia de FABRICATION_PATTERNS contra el texto de
 * entrada (keyword + currentAssumptions + headings + FAQs existentes) --
 * si la misma cifra ya aparecia en el input, no es fabricacion, es
 * reutilizacion legitima de un dato real. Solo se marca como warning lo
 * que aparece en la salida de V2 y NO aparece literalmente en el input.
 */
export function auditV2OutputForFabrication(context: LandingArchitectContext, v2: LandingArchitectV2Output): string[] {
  const inputHaystack = [context.keyword, ...context.currentAssumptions, ...context.proposedHeadings, ...context.existingFaqs.flatMap((f) => [f.question, f.answer])].join(" \n ").toLowerCase();

  const warnings: string[] = [];
  for (const text of collectTextFields(v2)) {
    for (const { pattern, label } of FABRICATION_PATTERNS) {
      const matches = text.match(pattern) ?? [];
      for (const match of matches) {
        if (!inputHaystack.includes(match.toLowerCase())) {
          warnings.push(`Posible dato fabricado (${label}): "${match}" en "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}" -- no aparece en el input.`);
        }
      }
    }
  }
  return warnings;
}

export type V2Result = { status: "pending_execution"; promptFilePath: string } | { status: "invalid_output"; error: string; rawOutputPath: string } | { status: "executed"; output: LandingArchitectV2Output; fabricationWarnings: string[] };

interface StructuralCounts {
  sections: number;
  faq: number;
  cards: number;
  benefitBlocks: number;
  hasComparisonTable: boolean;
  hasCtaSecondary: boolean;
  internalLinksUsed: number;
  heroHeadlineLength: number;
  heroSubheadlineLength: number;
}

function countV1(v1: V1BlueprintInput): StructuralCounts {
  return {
    sections: v1.sections.length,
    faq: v1.faq.length,
    cards: v1.cards.length,
    benefitBlocks: v1.benefitBlocks.length,
    hasComparisonTable: !!v1.comparisonTable,
    hasCtaSecondary: !!v1.ctaSecondary,
    internalLinksUsed: v1.internalLinks.length,
    heroHeadlineLength: v1.hero.headline.length,
    heroSubheadlineLength: v1.hero.subheadline.length,
  };
}

function countV2(v2: LandingArchitectV2Output): StructuralCounts {
  return {
    sections: v2.sections.length,
    faq: v2.faq.length,
    cards: v2.cards.length,
    benefitBlocks: v2.benefitBlocks.length,
    hasComparisonTable: !!v2.comparisonTable,
    hasCtaSecondary: !!v2.ctaSecondary,
    internalLinksUsed: v2.internalLinks.length,
    heroHeadlineLength: v2.hero.headline.length,
    heroSubheadlineLength: v2.hero.subheadline.length,
  };
}

export interface StructuralDiffRow {
  field: string;
  v1: string | number | boolean;
  v2: string | number | boolean;
  same: boolean;
}

export function buildStructuralDiff(v1: V1BlueprintInput, v2Output: LandingArchitectV2Output | undefined): StructuralDiffRow[] {
  const a = countV1(v1);
  if (!v2Output) {
    return Object.entries(a).map(([field, value]) => ({ field, v1: value, v2: "(V2 no ejecutado)", same: false }));
  }
  const b = countV2(v2Output);
  const fields = Object.keys(a) as Array<keyof StructuralCounts>;
  return fields.map((field) => ({ field, v1: a[field], v2: b[field], same: a[field] === b[field] }));
}

/**
 * Criterios de evaluacion FIJOS (checklist), pensados para que un
 * humano marque cumple/no cumple para cada version por separado --
 * nunca un "ganador" calculado por este codigo ni por el propio
 * subagente. Ver docs/ux-ui-landing-architect-v2-experiment.md,
 * seccion "Como leer un artefacto de comparacion".
 */
export const EVALUATION_CRITERIA: string[] = [
  "Un unico H1 (headline del hero) -- no hay headings H1 duplicados en secciones.",
  "CTA principal presente, con label claro y target valido (real o placeholder honesto marcado como tal).",
  "Cero cifras de precio/plazo/garantia/porcentaje que no vengan ya en el input (ver auditoria de fabricacion).",
  "Cada seccion aporta informacion especifica del tema (material/control de acceso), no relleno generico repetido.",
  "FAQ real (preguntas y respuestas especificas), no una unica entrada generica.",
  "Jerarquia visual: beneficios/materiales en bloques o cards, no solo parrafos sueltos.",
  "CTA final coherente con el CTA principal (mismo objetivo de conversion).",
  "Tono conforme a la skill zentry-brand (cercano, sin superlativos vacios, sin mezclar marcas sin motivo).",
  "Estructura pensada para mobile-first (bloques cortos, sin parrafos largos).",
];

export interface LandingArchitectComparisonArtifact {
  changePackId: string;
  generatedAt: string;
  input: LandingArchitectContext;
  v1: { output: V1BlueprintInput };
  v2: V2Result;
  structuralDiff: StructuralDiffRow[];
  evaluationCriteria: string[];
  note: string;
}

export function buildComparisonArtifact(context: LandingArchitectContext, v1Output: V1BlueprintInput, v2Result: V2Result): LandingArchitectComparisonArtifact {
  const v2Output = v2Result.status === "executed" ? v2Result.output : undefined;
  return {
    changePackId: context.changePackId,
    generatedAt: new Date().toISOString(),
    input: context,
    v1: { output: v1Output },
    v2: v2Result,
    structuralDiff: buildStructuralDiff(v1Output, v2Output),
    evaluationCriteria: EVALUATION_CRITERIA,
    note: "Artefacto de solo lectura/comparacion. Ninguna de las dos propuestas se ha aplicado a WordPress, staging ni produccion. La eleccion entre V1/V2 (si la hubiera) la hace un humano, nunca este runner ni el propio subagente.",
  };
}

function fmtCta(cta: { label: string; target: string; isRealLink: boolean }): string {
  return `"${cta.label}" -> ${cta.target}${cta.isRealLink ? "" : " (sin URL real)"}`;
}

export function renderComparisonMarkdown(artifact: LandingArchitectComparisonArtifact): string {
  const lines: string[] = [];
  lines.push(`# Comparacion UX/UI Landing Architect V1 vs V2 — ${artifact.changePackId}`);
  lines.push("");
  lines.push(`- **Generado:** ${artifact.generatedAt}`);
  lines.push(`- **Keyword:** ${artifact.input.keyword}`);
  lines.push(`- **Marca:** ${artifact.input.targetBrand} | **Intencion:** ${artifact.input.brandIntent}`);
  lines.push(`- **Sector/material detectado:** ${artifact.input.sector ?? "(ninguno)"} / ${artifact.input.material ?? "(ninguno)"}`);
  lines.push("");
  lines.push("**No se ha aplicado ninguna de las dos propuestas. No hay veredicto automatico de cual es mejor.**");
  lines.push("");

  lines.push("## Input (contexto estructurado entregado a ambas versiones)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(artifact.input, null, 2));
  lines.push("```");
  lines.push("");

  lines.push("## Output V1 (determinista)");
  lines.push("");
  lines.push(`- Headline: ${artifact.v1.output.hero.headline}`);
  lines.push(`- Subheadline: ${artifact.v1.output.hero.subheadline}`);
  lines.push(`- CTA principal: ${fmtCta(artifact.v1.output.ctaPrimary)}`);
  lines.push(`- Secciones: ${artifact.v1.output.sections.length} | Cards: ${artifact.v1.output.cards.length} | Beneficios: ${artifact.v1.output.benefitBlocks.length} | FAQ: ${artifact.v1.output.faq.length}`);
  lines.push("");

  lines.push("## Output V2 (subagente Claude)");
  lines.push("");
  if (artifact.v2.status === "pending_execution") {
    lines.push(`- **Estado: pendiente de ejecucion.** Prompt preparado en \`${artifact.v2.promptFilePath}\`.`);
    lines.push("- Para completar la comparacion: invocar el subagente `ux-ui-landing-architect-v2` con ese prompt y volver a ejecutar este runner con `--v2-output <fichero-json-de-respuesta>`.");
  } else if (artifact.v2.status === "invalid_output") {
    lines.push(`- **Estado: salida invalida.** ${artifact.v2.error}`);
    lines.push(`- Salida cruda guardada en \`${artifact.v2.rawOutputPath}\` para inspeccion.`);
  } else {
    lines.push(`- Headline: ${artifact.v2.output.hero.headline}`);
    lines.push(`- Subheadline: ${artifact.v2.output.hero.subheadline}`);
    lines.push(`- CTA principal: ${fmtCta(artifact.v2.output.ctaPrimary)}`);
    lines.push(`- Secciones: ${artifact.v2.output.sections.length} | Cards: ${artifact.v2.output.cards.length} | Beneficios: ${artifact.v2.output.benefitBlocks.length} | FAQ: ${artifact.v2.output.faq.length}`);
    lines.push("");
    lines.push("**reasoningNotes (justificacion del subagente, no auto-evaluacion):**");
    for (const note of artifact.v2.output.reasoningNotes) lines.push(`- ${note}`);
    lines.push("");
    if (artifact.v2.fabricationWarnings.length > 0) {
      lines.push(`**⚠️ Auditoria de fabricacion: ${artifact.v2.fabricationWarnings.length} aviso(s) para revision humana:**`);
      for (const warning of artifact.v2.fabricationWarnings) lines.push(`- ${warning}`);
    } else {
      lines.push("Auditoria de fabricacion: sin avisos (ninguna cifra/plazo/garantia/porcentaje detectado fuera del input).");
    }
  }
  lines.push("");

  lines.push("## Diferencias estructurales");
  lines.push("");
  lines.push("| Campo | V1 | V2 | Igual |");
  lines.push("|---|---|---|---|");
  for (const row of artifact.structuralDiff) {
    lines.push(`| ${row.field} | ${row.v1} | ${row.v2} | ${row.same ? "si" : "no"} |`);
  }
  lines.push("");

  lines.push("## Criterios de evaluacion (a rellenar por un humano, no por Claude)");
  lines.push("");
  lines.push("| Criterio | V1 cumple | V2 cumple | Notas |");
  lines.push("|---|---|---|---|");
  for (const criterion of artifact.evaluationCriteria) {
    lines.push(`| ${criterion} | ☐ | ☐ | |`);
  }
  lines.push("");
  lines.push(`_${artifact.note}_`);
  lines.push("");

  return lines.join("\n");
}
