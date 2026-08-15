import { ContentStrategistContext } from "./context";
import { ContentStrategistOutput } from "./output";

/**
 * Auditoria de afirmaciones comerciales/tecnicas sensibles no respaldadas
 * en la salida del subagente `content-strategist`, mas una verificacion
 * de realismo de enlazado interno especifica de este empleado. NO es un
 * check semantico completo (no "entiende" el texto): es una red de
 * seguridad textual, igual de conservadora que
 * auditV2OutputForFabrication() en src/core/landing-architect-comparison.ts
 * (misma inspiracion: ver la skill zentry-brand, seccion "Afirmaciones
 * que REQUIEREN CONFIRMACION DE NEGOCIO"), pero reimplementada para este
 * dominio -- un BRIEF de contenido (angulo, CTA, estructura) nunca
 * incluye copy final de landing, asi que las categorias se aplican sobre
 * campos de brief (angle, ctaStrategy, recommendedStructure.sections,
 * supportingEvidence, risksAndUnknowns, reasoningNotes), no sobre hero/
 * benefitBlocks/faq como en el landing architect. Nunca bloquea nada
 * automaticamente: solo genera warnings para revision humana.
 */
interface UnsupportedClaimRule {
  id: string;
  label: string;
  /** Encuentra afirmaciones de esta categoria en un texto de SALIDA. */
  findClaims: (text: string) => string[];
  /** Decide si UNA clausula de respaldo del INPUT confirma una afirmacion concreta. */
  isClaimSupportedByClause: (clause: string, claim: string) => boolean;
}

const HEDGE_PATTERN = /pendiente|confirmar|indicar|por definir|segun el modelo|segun stock|segun disponibilidad/i;

function findAll(text: string, pattern: RegExp): string[] {
  return text.match(pattern) ?? [];
}

/**
 * Trocea un texto en clausulas cortas (misma logica que
 * splitIntoClauses() del landing architect, reimplementada aqui de forma
 * independiente): puntuacion de frase, o un guion/raya rodeado de
 * espacios, para no acoplar clausulas distintas de una misma oracion
 * larga con un hedge al final.
 */
function toClauses(text: string): string[] {
  return text
    .split(/[.!?\n;:]+|\s[-—–]\s/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function clauseConfirmsTopic(clause: string, topicPattern: RegExp): boolean {
  return topicPattern.test(clause) && !HEDGE_PATTERN.test(clause);
}

const CLAIM_RULES: UnsupportedClaimRule[] = [
  {
    id: "garantia",
    label: "garantia",
    findClaims: (t) => findAll(t, /garant[ií]a\s+de\s+\d+\s*(a[nñ]os?|meses)|garant[ií]a\s+de\s+fabricante|cuenta[n]?\s+con\s+garant[ií]a|tiene[n]?\s+garant[ií]a|incluye[n]?\s+garant[ií]a/gi),
    isClaimSupportedByClause: (clause) => clauseConfirmsTopic(clause, /garant[ií]a/i),
  },
  {
    id: "precio",
    label: "precio",
    findClaims: (t) => findAll(t, /\d+\s*€|desde\s+\d+\s*€?|\d+\s*%|precio\s+(fijo|cerrado)/gi),
    // Categoria "valor exacto": la cifra concreta de la afirmacion (no solo el tema "precio") debe aparecer literalmente en la clausula de respaldo.
    isClaimSupportedByClause: (clause, claim) => clause.toLowerCase().includes(claim.toLowerCase()) && !HEDGE_PATTERN.test(clause),
  },
  {
    id: "plazo_entrega",
    label: "plazo de entrega",
    findClaims: (t) => findAll(t, /\d+\s*(dias|d[ií]as|semanas|meses)\b|entrega\s+(inmediata|garantizada|en\s+\d+)/gi),
    isClaimSupportedByClause: (clause, claim) => clause.toLowerCase().includes(claim.toLowerCase()) && !HEDGE_PATTERN.test(clause),
  },
  {
    id: "fabricante_directo",
    label: "fabricante directo / sin intermediarios",
    findClaims: (t) => findAll(t, /fabricante\s+directo|sin\s+intermediarios|venta\s+directa|fabrica(mos)?\s+y\s+vende(mos)?\s+directamente/gi),
    isClaimSupportedByClause: (clause) => clauseConfirmsTopic(clause, /fabricante\s+directo|sin\s+intermediarios|venta\s+directa|fabrica(mos)?\s+y\s+vende(mos)?\s+directamente/i),
  },
  {
    id: "funcionalidad_producto",
    label: "funcionalidad de producto",
    findClaims: (t) => findAll(t, /todas?\s+(las\s+)?(taquillas|cerraduras)\s+(incluyen|tienen|cuentan\s+con)|incluye[n]?\s+(app|conectividad|wifi|bluetooth|registro\s+de\s+accesos)\b/gi),
    isClaimSupportedByClause: (clause) => clauseConfirmsTopic(clause, /\bapp\b|conectividad|wifi|bluetooth|registro\s+de\s+accesos/i),
  },
];

/**
 * Unica fuente de "hechos confirmados" para esta auditoria: los
 * `currentAssumptions` del change pack de origen (ver context.ts). A
 * diferencia de LandingArchitectContext, el contexto de
 * content-strategist no trae `existingFaqs` -- el pipeline de contenido
 * (content-change-pack-builder.ts) no genera ese campo, asi que no hay
 * un segundo canal de respaldo que mezclar aqui.
 */
function buildSupportClauses(context: ContentStrategistContext): string[] {
  return toClauses(context.currentAssumptions.join(". "));
}

function collectOutputTextFields(output: ContentStrategistOutput): string[] {
  const texts: string[] = [
    output.contentOpportunity.title,
    output.contentOpportunity.summary,
    output.targetAudience,
    output.commercialIntent,
    output.angle,
    output.recommendedStructure.h1,
    output.ctaStrategy.primaryCta,
    output.ctaStrategy.rationale,
  ];
  if (output.ctaStrategy.secondaryCta) texts.push(output.ctaStrategy.secondaryCta);
  for (const section of output.recommendedStructure.sections) texts.push(section.heading, section.purpose);
  for (const link of output.internalLinks) texts.push(link.anchorIdea, link.targetDescription);
  texts.push(...output.supportingEvidence, ...output.risksAndUnknowns, ...output.reasoningNotes);
  return texts;
}

function auditUnsupportedClaims(context: ContentStrategistContext, output: ContentStrategistOutput): string[] {
  const supportClauses = buildSupportClauses(context);
  const warnings: string[] = [];

  for (const text of collectOutputTextFields(output)) {
    for (const rule of CLAIM_RULES) {
      for (const claim of rule.findClaims(text)) {
        const supported = supportClauses.some((clause) => rule.isClaimSupportedByClause(clause, claim));
        if (supported) continue;
        warnings.push(
          `Afirmacion sensible no respaldada (${rule.label}): "${claim}" en "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}" -- el brief de entrada no lo confirma (o lo marca como pendiente de confirmar).`
        );
      }
    }
  }

  return warnings;
}

/**
 * Verificacion especifica de content-strategist (sin equivalente directo
 * en landing-architect-comparison.ts, que ya filtra `internalLinks`
 * reales ANTES de pasarselos al subagente via isRealInternalUrl): el
 * contexto de contenido solo trae PISTAS de texto de enlazado interno
 * (`internalLinkHints`/`clusterNote`/`secondaryKeywords`), nunca URLs
 * reales, salvo la propia `page` del change pack si ya existe. Cualquier
 * `internalLinks[].isRealLink: true` en la salida de Claude que no
 * coincida con esa unica URL real disponible, ni con ninguna pista
 * textual recibida, se reporta como enlace posiblemente inventado.
 */
function auditInternalLinkRealism(context: ContentStrategistContext, output: ContentStrategistOutput): string[] {
  const warnings: string[] = [];
  const knownHints = [context.clusterNote, ...context.internalLinkHints, ...context.secondaryKeywords].map((hint) => hint.toLowerCase()).filter((hint) => hint.length > 0);

  for (const link of output.internalLinks) {
    if (!link.isRealLink) continue;
    const target = link.targetDescription.trim().toLowerCase();
    // Guard fail-closed: un targetDescription vacio (o solo espacios) NUNCA
    // cuenta como respaldado, aunque haya pistas conocidas -- sin esta
    // guarda, `hint.includes("")` es SIEMPRE true para cualquier hint no
    // vacio, lo que dejaria pasar un isRealLink:true con destino vacio
    // como si estuviera verificado.
    if (target.length === 0) {
      warnings.push(`Enlace interno marcado isRealLink:true con targetDescription vacio: "${link.anchorIdea}" -- no se puede verificar contra ninguna pista real del contexto.`);
      continue;
    }
    const matchesRealPage = context.page ? target.includes(context.page.toLowerCase()) : false;
    const matchesKnownHint = knownHints.some((hint) => hint.length > 0 && (hint.includes(target) || target.includes(hint)));
    if (matchesRealPage || matchesKnownHint) continue;
    warnings.push(
      `Enlace interno marcado isRealLink:true sin respaldo en el contexto: "${link.targetDescription}" -- no coincide con la pagina real del change pack (${context.page ?? "(el change pack no tiene page todavia)"}) ni con ninguna pista de enlazado interno recibida.`
    );
  }

  return warnings;
}

export function auditContentStrategistOutputForUnsupportedClaims(context: ContentStrategistContext, output: ContentStrategistOutput): string[] {
  return [...auditUnsupportedClaims(context, output), ...auditInternalLinkRealism(context, output)];
}
