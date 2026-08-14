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
 * Extrae JSON de la respuesta cruda de texto del subagente. Las
 * instrucciones de `.claude/agents/ux-ui-landing-architect-v2.md` piden
 * "sin markdown fences", pero en la practica (ver ejecucion real
 * documentada en docs/ux-ui-landing-architect-v2-experiment.md) el
 * modelo puede envolver la respuesta en ```json ... ``` de todas formas
 * -- esta funcion tolera ese caso (y el caso sin fences) antes de
 * intentar `JSON.parse`, para que una diferencia de formato no tumbe
 * todo el pipeline automatico. Fail-closed igualmente: si tras quitar un
 * posible fence el contenido no es JSON valido, lanza -- nunca intenta
 * "adivinar" ni reparar el contenido.
 */
export function extractJsonFromModelResponse(raw: string): unknown {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

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

// Auditoria de afirmaciones sensibles no respaldadas -- NO es un check
// semantico completo (no "entiende" el texto), es una red de seguridad
// textual de dos pasos por categoria: (1) ¿el texto de salida de V2
// contiene una AFIRMACION de esta categoria? (2) si es asi, ¿el input
// la RESPALDA (aparece ya, sin marcarla como pendiente de confirmar)?
// Si la afirmacion no esta respaldada, se reporta como WARNING para
// revision humana -- nunca bloquea nada automaticamente (este runner
// solo genera reportes locales, no aplica nada).
//
// Bug real corregido tras revision (ver docs/ux-ui-landing-architect-v2-experiment.md):
// la version anterior solo buscaba CIFRAS concretas ("garantia de 5
// anos"), asi que una afirmacion cualitativa sin numero ("cuentan con
// garantia de fabricante") pasaba como falso negativo aunque el input
// marcara la garantia como "pendiente de confirmar". Las categorias de
// abajo cubren tanto cifras como afirmaciones cualitativas.
interface ClaimCategory {
  id: string;
  label: string;
  // Cualquier coincidencia en el texto de SALIDA de V2 se trata como una
  // afirmacion de esta categoria.
  assertionPattern: RegExp;
  // Termino que debe aparecer en una frase del INPUT (sin lenguaje de
  // "pendiente"/"confirmar" en esa misma frase) para considerar la
  // categoria respaldada.
  topicPattern: RegExp;
  // "exact_value": la coincidencia CONCRETA (p.ej. "20 dias") debe
  // aparecer literalmente en alguna frase de respaldo del input (sin
  // lenguaje de "pendiente/confirmar" en esa frase) -- protege contra
  // que V2 reutilice el TEMA (plazos/precio) pero invente un valor
  // distinto al que ya existe. "topic_presence": basta con que el TEMA
  // de la categoria este respaldado (sin hedge) en alguna frase del
  // input, sin exigir el mismo valor exacto -- para afirmaciones
  // cualitativas (garantia/fabricante directo/funcionalidad) donde no
  // hay un "valor" que comparar caracter a caracter.
  verification: "exact_value" | "topic_presence";
}

const HEDGE_TERMS_PATTERN = /pendiente|confirmar|indicar|por definir|segun el modelo|segun stock|segun disponibilidad/i;

const CLAIM_CATEGORIES: ClaimCategory[] = [
  {
    id: "garantia",
    label: "garantía",
    assertionPattern:
      /garant[ií]a\s+de\s+\d+\s*(a[nñ]os?|meses)|garant[ií]a\s+de\s+fabricante|cuenta[n]?\s+con\s+garant[ií]a|tiene[n]?\s+garant[ií]a|incluye[n]?\s+garant[ií]a/gi,
    topicPattern: /garant[ií]a/i,
    verification: "topic_presence",
  },
  {
    id: "precio",
    label: "precio",
    assertionPattern: /\d+\s*€|desde\s+\d+\s*€?|\d+\s*%|precio\s+(fijo|cerrado)/gi,
    topicPattern: /precio|presupuesto|coste|tarifa/i,
    verification: "exact_value",
  },
  {
    id: "plazo_entrega",
    label: "plazo de entrega",
    assertionPattern: /\d+\s*(dias|d[ií]as|semanas|meses)\b|entrega\s+(inmediata|garantizada|en\s+\d+)/gi,
    topicPattern: /plazo|entrega|env[ií]o/i,
    verification: "exact_value",
  },
  {
    id: "fabricante_directo",
    label: "fabricante directo / sin intermediarios",
    assertionPattern: /fabricante\s+directo|sin\s+intermediarios|venta\s+directa|fabrica(mos)?\s+y\s+vende(mos)?\s+directamente/gi,
    topicPattern: /fabricante\s+directo|sin\s+intermediarios|venta\s+directa|fabrica(mos)?\s+y\s+vende(mos)?\s+directamente/i,
    verification: "topic_presence",
  },
  {
    id: "funcionalidad_producto",
    label: "funcionalidad de producto",
    assertionPattern: /todas?\s+(las\s+)?(taquillas|cerraduras)\s+(incluyen|tienen|cuentan\s+con)|incluye[n]?\s+(app|conectividad|wifi|bluetooth|registro\s+de\s+accesos)\b/gi,
    topicPattern: /\bapp\b|conectividad|wifi|bluetooth|registro\s+de\s+accesos/i,
    verification: "topic_presence",
  },
];

/**
 * Trocea un texto en "frases" (delimitadas por puntuacion de frase O un
 * guion/raya rodeado de espacios, para no acoplar clausulas distintas de
 * una misma oracion larga tipo "Al ser fabricante directo, los plazos
 * son mas cortos -- confirmar plazo exacto segun stock."). Una frase que
 * menciona el topic de una categoria SIN lenguaje de "pendiente/
 * confirmar" cuenta como respaldo real; si el topic solo aparece junto a
 * lenguaje de "pendiente/confirmar", NO cuenta como respaldo.
 */
function splitIntoClauses(text: string): string[] {
  return text
    .split(/[.!?\n;:]+|\s[-—–]\s/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/**
 * Frases de respaldo: solo `currentAssumptions` y las RESPUESTAS de
 * `existingFaqs` (nunca las preguntas -- una pregunta como "¿Que
 * garantia tienen las taquillas?" menciona el topic pero no lo afirma
 * como hecho confirmado) ni los headings (son titulos de seccion, no
 * afirmaciones).
 */
function buildSupportClauses(context: LandingArchitectContext): string[] {
  const assertiveTexts = [...context.currentAssumptions, ...context.existingFaqs.map((f) => f.answer)];
  return splitIntoClauses(assertiveTexts.join(". "));
}

function isCategorySupported(supportClauses: string[], category: ClaimCategory): boolean {
  return supportClauses.some((clause) => category.topicPattern.test(clause) && !HEDGE_TERMS_PATTERN.test(clause));
}

/** Para categorias "exact_value": el valor concreto (no solo el tema) debe aparecer, sin hedge, en alguna frase del input. */
function isExactValueSupported(supportClauses: string[], match: string): boolean {
  const needle = match.toLowerCase();
  return supportClauses.some((clause) => clause.toLowerCase().includes(needle) && !HEDGE_TERMS_PATTERN.test(clause));
}

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
 * Para cada categoria de CLAIM_CATEGORIES, busca afirmaciones en el
 * texto de salida de V2 y las contrasta contra el respaldo real del
 * input (ver buildSupportClauses/isCategorySupported). Una afirmacion
 * de una categoria SIN respaldo en el input -- incluido el caso en que
 * el input SI menciona el tema pero lo marca como pendiente de
 * confirmar -- se reporta como warning.
 */
export function auditV2OutputForFabrication(context: LandingArchitectContext, v2: LandingArchitectV2Output): string[] {
  const supportClauses = buildSupportClauses(context);
  const topicSupport = new Map(CLAIM_CATEGORIES.map((category) => [category.id, isCategorySupported(supportClauses, category)]));

  const warnings: string[] = [];
  for (const text of collectTextFields(v2)) {
    for (const category of CLAIM_CATEGORIES) {
      const matches = text.match(category.assertionPattern) ?? [];
      for (const match of matches) {
        const supported = category.verification === "exact_value" ? isExactValueSupported(supportClauses, match) : topicSupport.get(category.id) ?? false;
        if (supported) continue;
        warnings.push(
          `Afirmacion sensible no respaldada (${category.label}): "${match}" en "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}" -- el input no lo confirma (o lo marca como pendiente de confirmar).`
        );
      }
    }
  }
  return warnings;
}

export type V2Result = { status: "pending_execution"; promptFilePath: string } | { status: "invalid_output"; error: string; rawOutputPath: string } | { status: "executed"; output: LandingArchitectV2Output; fabricationWarnings: string[] };

/**
 * Contrato machine-readable que imprime el runner al final de cada
 * ejecucion (linea `RUNNER_RESULT_JSON=...`, ver
 * scripts/run-landing-architect-comparison.ts). Estructura FIJA e
 * IDENTICA en los 3 estados posibles de `v2Status` -- quien orquesta
 * esto (hoy: una sesion interactiva de Claude Code; ver
 * docs/ux-ui-landing-architect-v2-experiment.md para el estado real,
 * no aspiracional, de la automatizacion via Routine) no tiene que
 * ramificar su logica de lectura segun el estado para saber donde
 * esta cada fichero.
 */
export interface RunnerResultSummary {
  changePackId: string;
  keyword: string;
  v2Status: V2Result["status"];
  /** Ruta del prompt preparado para V2 -- ruta deterministica, exista o no ya en disco en el momento de esta llamada concreta. */
  promptFilePath: string;
  /** Ruta donde el runner espera encontrar la respuesta de V2 si se le llama con --v2-output. */
  expectedV2OutputPath: string;
  comparisonJsonPath: string;
  comparisonMdPath: string;
  /** null salvo que v2Status sea "executed" (unico estado en el que existen fabricationWarnings que contar). */
  fabricationWarningCount: number | null;
}

export function buildRunnerResultSummary(
  changePackId: string,
  keyword: string,
  paths: { promptFilePath: string; expectedV2OutputPath: string; comparisonJsonPath: string; comparisonMdPath: string },
  v2Result: V2Result
): RunnerResultSummary {
  return {
    changePackId,
    keyword,
    v2Status: v2Result.status,
    promptFilePath: paths.promptFilePath,
    expectedV2OutputPath: paths.expectedV2OutputPath,
    comparisonJsonPath: paths.comparisonJsonPath,
    comparisonMdPath: paths.comparisonMdPath,
    fabricationWarningCount: v2Result.status === "executed" ? v2Result.fabricationWarnings.length : null,
  };
}

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
  "Cero afirmaciones de garantia/precio/plazo/fabricante-directo/funcionalidad que no vengan ya respaldadas por el input (ver auditoria de fabricacion).",
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
      lines.push("Auditoria de fabricacion: sin avisos (ninguna afirmacion sensible de garantia/precio/plazo/fabricante-directo/funcionalidad sin respaldo en el input).");
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
