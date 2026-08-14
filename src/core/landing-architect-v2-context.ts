import { extractPreviewFields } from "../agents/wordpress-draft-agent";
import { selectVisualTemplate } from "./visual-templates";
import { detectTerm, SECTOR_TERMS, MATERIAL_TERMS, smartLocksBlockApplies } from "../agents/visual-template-builder";
import { BrandIntentCategory, BrandTarget, ChangePack, ChangePackStatus, Priority } from "./types";

/**
 * Context builder para el experimento `ux-ui-landing-architect-v2`
 * (ver docs/ux-ui-landing-architect-v2-experiment.md).
 *
 * Separacion CLAUDE / TOOLS explicita: esta funcion es la parte TOOL
 * (deterministica, sin LLM) -- extrae y normaliza del change pack
 * exactamente lo mismo que ya usa el agente v1 determinista
 * (src/agents/ux-ui-landing-architect.ts): headings, FAQs existentes,
 * enlaces internos reales, sector/material detectados por texto,
 * plantilla sugerida. Deliberadamente NO decide nada de estructura de
 * landing, copy, CTAs ni jerarquia visual -- eso es lo que pasa al
 * modelo (subagente Claude v2), que recibe este objeto ya resuelto
 * dentro de su prompt y nunca accede el repositorio por su cuenta.
 *
 * Reutiliza las mismas funciones de extraccion que v1 a proposito: el
 * objetivo del experimento es comparar como DOS RAZONAMIENTOS distintos
 * (plantillas+reglas vs. modelo) estructuran la MISMA informacion de
 * entrada, no comparar dos formas de leer el change pack.
 */
export interface LandingArchitectContext {
  changePackId: string;
  keyword: string;
  page?: string;
  changeType: string;
  priority: Priority;
  status: ChangePackStatus;
  targetBrand: BrandTarget;
  brandIntent: BrandIntentCategory;
  sector?: string;
  material?: string;
  isSmartLockTopic: boolean;
  suggestedSecondaryCta: boolean;
  templateHint: string;
  proposedHeadings: string[];
  existingFaqs: Array<{ question: string; answer: string }>;
  internalLinks: string[];
  currentAssumptions: string[];
}

const LOCK_TOPIC_TERMS = ["cerradura inteligente", "cerraduras inteligentes", "control de acceso", "taquilla inteligente", "taquillas inteligentes"];

function isRealInternalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^\/\S*$/.test(trimmed)) return true;
  return false;
}

function isSmartLockTopic(changePack: ChangePack): boolean {
  const haystack = `${changePack.keyword} ${changePack.page ?? ""}`.toLowerCase();
  return LOCK_TOPIC_TERMS.some((term) => haystack.includes(term));
}

export function buildLandingArchitectContext(changePack: ChangePack): LandingArchitectContext {
  const fields = extractPreviewFields(changePack);
  const templateId = selectVisualTemplate(changePack);
  const sector = detectTerm(changePack, SECTOR_TERMS);
  const material = detectTerm(changePack, MATERIAL_TERMS);

  return {
    changePackId: changePack.changePackId,
    keyword: changePack.keyword,
    page: changePack.page,
    changeType: changePack.changeType,
    priority: changePack.priority,
    status: changePack.status,
    targetBrand: changePack.targetBrand,
    brandIntent: changePack.brandIntent,
    sector,
    material,
    isSmartLockTopic: isSmartLockTopic(changePack),
    suggestedSecondaryCta: smartLocksBlockApplies(changePack),
    templateHint: templateId,
    proposedHeadings: fields.h2s,
    existingFaqs: fields.faqs,
    internalLinks: fields.internalLinks.filter(isRealInternalUrl),
    currentAssumptions: changePack.currentAssumptions,
  };
}
