import { Priority } from "../../core/types";
import { ContentTargetBrand, ContentType } from "../../agents/content-planner";

/**
 * Contrato de salida del subagente Claude `content-strategist` -- ver
 * .claude/agents/content-strategist.md y
 * config/content-strategist-output.schema.json (debe reflejar
 * EXACTAMENTE esta interfaz, ver test/content-strategist-output-schema.test.ts).
 *
 * Reutiliza `ContentType`/`ContentTargetBrand` de
 * src/agents/content-planner.ts en vez de inventar una categorizacion
 * nueva -- mismo enum que ya usa el resto del pipeline determinista de
 * contenido (content-work-order-builder.ts via su propio actionType
 * "content:<ContentType>").
 */
export type ContentStrategistSearchIntent = "informational" | "transactional" | "comparison" | "commercial";

export interface ContentStrategistSection {
  heading: string;
  level: "H2" | "H3";
  purpose: string;
}

export interface ContentStrategistInternalLink {
  anchorIdea: string;
  /** Descripcion del destino -- una URL real SOLO si coincide con la pagina real del change pack; en cualquier otro caso, una descripcion textual (nunca una URL inventada). */
  targetDescription: string;
  isRealLink: boolean;
}

export interface ContentStrategistOutput {
  contentOpportunity: { title: string; summary: string };
  targetAudience: string;
  searchIntent: ContentStrategistSearchIntent;
  commercialIntent: string;
  angle: string;
  contentType: ContentType;
  targetBrand: ContentTargetBrand;
  recommendedStructure: { h1: string; sections: ContentStrategistSection[] };
  ctaStrategy: { primaryCta: string; secondaryCta?: string; rationale: string };
  internalLinks: ContentStrategistInternalLink[];
  supportingEvidence: string[];
  priority: Priority;
  risksAndUnknowns: string[];
  reasoningNotes: string[];
}

const SEARCH_INTENTS: ContentStrategistSearchIntent[] = ["informational", "transactional", "comparison", "commercial"];
const CONTENT_TYPES: ContentType[] = ["article", "faq", "landing_block", "title_meta_improvement", "internal_link", "new_landing"];
const TARGET_BRANDS: ContentTargetBrand[] = ["zentry", "tukandado", "mixed"];
const PRIORITIES: Priority[] = ["high", "medium", "low"];
const SECTION_LEVELS: string[] = ["H2", "H3"];

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isSection(v: unknown): v is ContentStrategistSection {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.heading) && SECTION_LEVELS.includes(o.level as string) && isString(o.purpose);
}

function isInternalLink(v: unknown): v is ContentStrategistInternalLink {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.anchorIdea) && isString(o.targetDescription) && typeof o.isRealLink === "boolean";
}

/**
 * Valida (sin librerias externas -- ninguna dependencia nueva) que un
 * objeto crudo tiene la forma minima de un `ContentStrategistOutput`.
 * Fail-closed: cualquier campo obligatorio ausente o del tipo equivocado
 * lanza -- nunca se "rellena" con un valor por defecto que disfrazaria
 * una salida rota del subagente como si fuera valida. Mismo patron que
 * validateV2Output() en src/core/landing-architect-comparison.ts.
 *
 * Recibe el `unknown` YA validado contra
 * config/content-strategist-output.schema.json por el runtime comun
 * (ver docs/claude-employee-runtime.md) -- esta funcion es la SEGUNDA
 * capa (forma exacta del tipo TypeScript), nunca al reves.
 */
export function validateContentStrategistOutput(raw: unknown): ContentStrategistOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salida content-strategist invalida: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  const contentOpportunity = o.contentOpportunity as Record<string, unknown> | undefined;
  if (typeof contentOpportunity !== "object" || contentOpportunity === null || !isString(contentOpportunity.title) || !isString(contentOpportunity.summary)) {
    throw new Error("Salida content-strategist invalida: falta contentOpportunity.title / contentOpportunity.summary (string).");
  }
  if (!isString(o.targetAudience)) {
    throw new Error("Salida content-strategist invalida: falta targetAudience (string).");
  }
  if (!SEARCH_INTENTS.includes(o.searchIntent as ContentStrategistSearchIntent)) {
    throw new Error(`Salida content-strategist invalida: searchIntent debe ser uno de [${SEARCH_INTENTS.join(", ")}].`);
  }
  if (!isString(o.commercialIntent)) {
    throw new Error("Salida content-strategist invalida: falta commercialIntent (string).");
  }
  if (!isString(o.angle)) {
    throw new Error("Salida content-strategist invalida: falta angle (string).");
  }
  if (!CONTENT_TYPES.includes(o.contentType as ContentType)) {
    throw new Error(`Salida content-strategist invalida: contentType debe ser uno de [${CONTENT_TYPES.join(", ")}].`);
  }
  if (!TARGET_BRANDS.includes(o.targetBrand as ContentTargetBrand)) {
    throw new Error(`Salida content-strategist invalida: targetBrand debe ser uno de [${TARGET_BRANDS.join(", ")}].`);
  }

  const structure = o.recommendedStructure as Record<string, unknown> | undefined;
  if (typeof structure !== "object" || structure === null || !isString(structure.h1) || !Array.isArray(structure.sections) || !structure.sections.every(isSection)) {
    throw new Error("Salida content-strategist invalida: recommendedStructure debe ser { h1: string, sections: [{heading, level: H2|H3, purpose}] }.");
  }

  const cta = o.ctaStrategy as Record<string, unknown> | undefined;
  if (typeof cta !== "object" || cta === null || !isString(cta.primaryCta) || !isString(cta.rationale)) {
    throw new Error("Salida content-strategist invalida: falta ctaStrategy { primaryCta, rationale }.");
  }
  if (cta.secondaryCta !== undefined && !isString(cta.secondaryCta)) {
    throw new Error("Salida content-strategist invalida: ctaStrategy.secondaryCta, si esta presente, debe ser string.");
  }

  if (!Array.isArray(o.internalLinks) || !o.internalLinks.every(isInternalLink)) {
    throw new Error("Salida content-strategist invalida: internalLinks debe ser [{anchorIdea, targetDescription, isRealLink}].");
  }
  if (!isStringArray(o.supportingEvidence)) {
    throw new Error("Salida content-strategist invalida: supportingEvidence debe ser string[].");
  }
  if (!PRIORITIES.includes(o.priority as Priority)) {
    throw new Error(`Salida content-strategist invalida: priority debe ser uno de [${PRIORITIES.join(", ")}].`);
  }
  if (!isStringArray(o.risksAndUnknowns)) {
    throw new Error("Salida content-strategist invalida: risksAndUnknowns debe ser string[].");
  }
  if (!isStringArray(o.reasoningNotes)) {
    throw new Error("Salida content-strategist invalida: reasoningNotes debe ser string[].");
  }

  return o as unknown as ContentStrategistOutput;
}
