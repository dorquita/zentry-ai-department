import * as fs from "fs";
import * as path from "path";
import { readCurrentChangePacks } from "../core/change-packs";
import { extractPreviewFields } from "./wordpress-draft-agent";
import { selectVisualTemplate, getVisualTemplateDefinition } from "../core/visual-templates";
import { fillPattern, detectTerm, smartLocksBlockApplies, SECTOR_TERMS, MATERIAL_TERMS } from "./visual-template-builder";
import { readCurrentLandingBlueprints, upsertLandingBlueprint } from "../core/landing-blueprints";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ChangePack, LandingBenefitItem, LandingBlueprint, LandingCardItem, LandingFaqItem, LandingSection } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * UX/UI Landing Architect (Fase O13.6b) — READ + PROPOSE only, cero
 * llamadas a WordPress/produccion/n8n/qdrant. Convierte cada change pack
 * elegible en una `LandingBlueprint` CONCRETA (no un preview de texto):
 * hero, subtitulo, CTA principal, CTA secundario, bloques de beneficios,
 * cards, secciones por intencion de busqueda, FAQ, CTA final, enlaces
 * internos, jerarquia visual, tipo de plantilla.
 *
 * Postmortem (ver docs/postmortem-landing-quality.md): el sistema ya
 * tenia un catalogo de plantillas (src/core/visual-templates.ts, Fase
 * O12.4) y un agente que lo usaba para generar un preview MARKDOWN
 * (Visual Template Builder) -- pero ese preview nunca se conectaba al
 * HTML real que WordPress Draft Agent escribia, que seguia construyendo
 * texto plano (H1/p/H2/H3+p) directamente desde el change pack. Este
 * agente corre ANTES que WordPress Draft Agent en el pipeline y produce
 * el dato estructurado que ahora SI se usa para construir el HTML real
 * (ver buildWordpressContentHtml() en wordpress-draft-agent.ts).
 *
 * Nunca fabrica cifras/garantias/plazos concretos que no esten ya en el
 * change pack de origen -- el copy generico (beneficios, materiales,
 * FAQ de respaldo) usa siempre lenguaje que remite a "solicitar
 * presupuesto" en vez de inventar numeros.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "ux-ui-landing");
const AGENT_NAME = "ux-ui-landing-architect";
const ELIGIBLE_CHANGE_PACK_STATUSES: ChangePack["status"][] = ["ready_for_review", "approved_to_execute"];

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function isRealInternalUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/^\/\S*$/.test(trimmed)) return true;
  return false;
}

const PLACEHOLDER_PATTERNS = [/pendiente de confirmar/i, /confirmar\s+(plazo|garantia)/i, /por\s+definir/i, /lorem ipsum/i, /\btodo\b/i, /\bfixme\b/i];

function looksLikePlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(text));
}

function classifySearchIntent(heading: string): LandingSection["searchIntent"] {
  const h = heading.toLowerCase();
  if (/precio|presupuesto|coste|tarifa/.test(h)) return "transactional";
  if (/vs|comparat|diferencia|alternativa/.test(h)) return "comparison";
  if (/que es|como|guia|consejos/.test(h)) return "informational";
  return "commercial";
}

// Copy generico de RESPALDO por tipo de seccion detectado en el H2 --
// nunca inventa cifras/plazos, siempre remite a "solicitar presupuesto"
// cuando hace falta un dato concreto que no tenemos. Se usa SOLO cuando
// el change pack no aporta ya un parrafo real para esa seccion (evita
// dejar secciones vacias, la causa raiz del postmortem).
function buildSectionBody(heading: string, changePack: ChangePack, sector: string | undefined): string {
  const h = heading.toLowerCase();
  const keyword = changePack.keyword;

  if (/modelo|medida|configuracion/.test(h)) {
    return `Disponemos de ${keyword} en distintas configuraciones para adaptarnos al espacio disponible${sector ? ` en ${sector}` : ""}. Cuentanos tu caso concreto y te proponemos la combinacion de medidas mas adecuada.`;
  }
  if (/material/.test(h)) {
    return `Fabricamos en distintos materiales segun la necesidad: opciones mas robustas para uso intensivo, resistentes a la humedad para zonas humedas, y alternativas mas economicas para espacios comunes. Te ayudamos a elegir el material mas adecuado para tu caso.`;
  }
  if (/precio|presupuesto|coste/.test(h)) {
    return `Al ser fabricante directo, ofrecemos precios competitivos sin intermediarios. Cada pedido tiene necesidades distintas de cantidad, materiales y medidas, asi que preparamos un presupuesto a medida sin compromiso.`;
  }
  if (/garantia/.test(h)) {
    return `Todas nuestras ${keyword} cuentan con garantia de fabricante. Te detallamos las condiciones exactas aplicables a tu pedido junto con el presupuesto.`;
  }
  if (/entrega|plazo|envio/.test(h)) {
    return `El plazo de entrega depende del volumen del pedido y del grado de personalizacion. Al ser fabricante directo solemos ofrecer plazos ajustados -- te confirmamos el plazo exacto para tu pedido al preparar el presupuesto.`;
  }
  if (/proceso|como trabajamos|como funciona/.test(h)) {
    return buildProcessSectionBody(keyword);
  }
  // Fase O27.3 -- 2 categorias mas, frecuentes en paginas mixtas
  // Zentry+Tukandado (mueble + cerradura) que antes caian todas al
  // catch-all generico y salian con el mismo texto repetido.
  if (/mueble.*cerradura|cerradura.*mueble|solo mueble|ambos/.test(h)) {
    return `Depende de lo que necesites: solo el mueble (Zentry), solo la cerradura electronica (Tukandado), o la solucion completa integrada. Cuentanos tu caso y te orientamos hacia la opcion correcta.`;
  }
  if (/solucion zentry|mobiliario/.test(h)) {
    return `Zentry fabrica y vende directamente el mobiliario: taquillas y lockers en metalica, fenolica o melamina, a medida para tu espacio.`;
  }
  if (/solucion tukandado|cerradura/.test(h)) {
    return `Tukandado aporta la cerradura electronica -- apertura sin llave fisica, gestionable por app, tarjeta o codigo segun el modelo.`;
  }
  if (/como elegir/.test(h)) {
    return `Cuentanos tu caso (numero de usuarios, presupuesto, si ya tienes taquillas o partes de cero) y te recomendamos la combinacion mas adecuada, sin compromiso.`;
  }
  // Catch-all final: SIEMPRE incorpora el propio titular en la frase, para
  // que dos secciones distintas nunca produzcan el mismo parrafo exacto
  // aunque no encajen en ninguna categoria de arriba (bug real
  // encontrado en auditoria visual, Fase O27.3 -- antes este catch-all
  // ignoraba `heading` por completo).
  const headingTopic = heading.replace(/[¿?]/g, "").trim();
  return `Sobre ${headingTopic.charAt(0).toLowerCase()}${headingTopic.slice(1)}: cuentanos tu caso concreto${sector ? ` en ${sector}` : ""} y te ayudamos a encontrar la mejor solucion en ${keyword}.`;
}

// Bloque "como trabajamos" (Fase O13.6c) -- describe el proceso comercial
// en pasos genericos, sin comprometer plazos ni cifras concretas.
function buildProcessSectionBody(keyword: string): string {
  return `Trabajar con nosotros es sencillo: nos cuentas que ${keyword} necesitas, te preparamos un presupuesto a medida sin compromiso, y una vez confirmado, fabricamos y coordinamos la entrega contigo. Te acompañamos en todo el proceso, desde la primera consulta hasta la instalacion.`;
}

function buildBenefitBlocks(sector: string | undefined, keyword: string): LandingBenefitItem[] {
  return [
    { title: "Fabricante directo", description: "Sin intermediarios: precios mas competitivos y trato directo con quien fabrica tu pedido." },
    { title: sector ? `Adaptado a ${sector}` : "Adaptado a tu espacio", description: `Materiales y configuraciones de ${keyword} pensados para tu caso concreto.` },
    { title: "Presupuesto sin compromiso", description: "Cuentanos que necesitas y te preparamos una propuesta a medida, sin compromiso." },
  ];
}

function buildCards(material: string | undefined): LandingCardItem[] {
  if (material) {
    return [{ title: material.charAt(0).toUpperCase() + material.slice(1), description: `Opcion en ${material}, con las caracteristicas mas adecuadas para tu proyecto.` }];
  }
  return [
    { title: "Metalica", description: "La opcion mas robusta y duradera para un uso intensivo." },
    { title: "Fenolica", description: "Resistente a la humedad, indicada para vestuarios y zonas humedas." },
    { title: "Melamina", description: "Alternativa mas economica con acabado tipo madera." },
  ];
}

function rewriteFaqIfPlaceholder(faq: { question: string; answer: string }): LandingFaqItem {
  if (!looksLikePlaceholder(faq.answer) && faq.answer.trim().length > 0) {
    return { question: faq.question, answer: faq.answer };
  }
  return {
    question: faq.question,
    answer: "Te confirmamos los detalles exactos de tu caso al preparar el presupuesto -- cada pedido puede tener condiciones distintas.",
  };
}

/**
 * Construye el input completo del blueprint para UN change pack (Fase
 * O13.6c: extraido de runUxUiLandingArchitect() para poder reutilizarlo
 * tanto en la pasada diaria como en una regeneracion puntual, p.ej. tras
 * corregir un bug de contenido -- ver scripts/redesign-production-draft-1960.ts).
 * Pura respecto a I/O de red: solo lee el change pack ya cargado.
 */
export function buildBlueprintInput(changePack: ChangePack): Omit<LandingBlueprint, "blueprintId" | "createdAt" | "updatedAt"> {
  const fields = extractPreviewFields(changePack);
  const templateId = selectVisualTemplate(changePack);
  const template = getVisualTemplateDefinition(templateId);
  const sector = detectTerm(changePack, SECTOR_TERMS);
  const material = detectTerm(changePack, MATERIAL_TERMS);
  const includeSecondaryCta = smartLocksBlockApplies(changePack);

  const realLinks = fields.internalLinks.filter(isRealInternalUrl);
  const ctaTarget = realLinks[0] ?? "#solicitar-presupuesto";

  const sections: LandingSection[] = fields.h2s.map((heading) => ({
    heading,
    body: buildSectionBody(heading, changePack, sector),
    searchIntent: classifySearchIntent(heading),
  }));
  if (!sections.some((s) => /proceso|como trabajamos|como funciona/i.test(s.heading))) {
    sections.push({
      heading: "Como trabajamos",
      body: buildProcessSectionBody(changePack.keyword),
      searchIntent: "informational",
    });
  }

  return {
    changePackId: changePack.changePackId,
    templateType: templateId,
    hero: {
      headline: fillPattern(template.hero.headlinePattern, changePack, sector, material),
      subheadline: fillPattern(template.hero.subheadlinePattern, changePack, sector, material),
    },
    ctaPrimary: { label: template.hero.ctaLabel, target: ctaTarget, isRealLink: realLinks.length > 0 },
    ctaSecondary: includeSecondaryCta
      ? { label: "Ver cerraduras inteligentes", target: "#cerraduras-inteligentes", isRealLink: false }
      : undefined,
    benefitBlocks: buildBenefitBlocks(sector, changePack.keyword),
    cards: buildCards(material),
    sections,
    faq: fields.faqs.map(rewriteFaqIfPlaceholder),
    finalCta: {
      headline: "Solicita presupuesto sin compromiso",
      cta: { label: template.finalCta.label, target: ctaTarget, isRealLink: realLinks.length > 0 },
    },
    internalLinks: realLinks,
    visualHierarchyNotes: [
      "Un solo H1 (el headline del hero).",
      "CTA principal visible above the fold (dentro del bloque hero).",
      "Beneficios y materiales en columnas/cards, nunca solo parrafos sueltos.",
      ...template.kadenceGutenbergNotes,
    ],
  };
}

export interface UxUiLandingArchitectRunResult {
  departmentRunId: string;
  newBlueprints: LandingBlueprint[];
  existingBlueprints: LandingBlueprint[];
  totalBlueprintCount: number;
  reportPath: string;
}

function buildReportMarkdown(result: UxUiLandingArchitectRunResult, generatedAt: string): string {
  const lines: string[] = [];
  const executionDate = generatedAt.slice(0, 10);
  lines.push(`# UX/UI Landing Architect — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");
  lines.push(`- Blueprints nuevos esta pasada: **${result.newBlueprints.length}**`);
  lines.push(`- Blueprints ya existentes: **${result.existingBlueprints.length}**`);
  lines.push(`- Total acumulado: **${result.totalBlueprintCount}**`);
  lines.push("");
  lines.push("**No se ha llamado a WordPress, produccion, n8n ni qdrant. Solo planificacion de estructura.**");
  lines.push("");
  for (const bp of result.newBlueprints) {
    lines.push(`## \`${bp.blueprintId}\` — ${bp.hero.headline}`);
    lines.push("");
    lines.push(`- changePackId: \`${bp.changePackId}\` | plantilla: \`${bp.templateType}\``);
    lines.push(`- Subtitulo: ${bp.hero.subheadline}`);
    lines.push(`- CTA principal: "${bp.ctaPrimary.label}" -> ${bp.ctaPrimary.target}${bp.ctaPrimary.isRealLink ? "" : " (sin URL real todavia)"}`);
    if (bp.ctaSecondary) lines.push(`- CTA secundario: "${bp.ctaSecondary.label}"`);
    lines.push(`- Bloques de beneficios: ${bp.benefitBlocks.length} | Cards: ${bp.cards.length} | Secciones: ${bp.sections.length} | FAQ: ${bp.faq.length}`);
    lines.push("");
  }
  return lines.join("\n");
}

function writeReport(result: UxUiLandingArchitectRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `ux-ui-landing-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runUxUiLandingArchitect(departmentRunId?: string): Promise<UxUiLandingArchitectRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("UX/UI Landing Architect iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "UX/UI Landing Architect iniciado" });

  const eligible = readCurrentChangePacks().filter((cp) => ELIGIBLE_CHANGE_PACK_STATUSES.includes(cp.status));
  let current = readCurrentLandingBlueprints();
  const newBlueprints: LandingBlueprint[] = [];
  const existingBlueprints: LandingBlueprint[] = [];

  for (const changePack of eligible) {
    const existing = current.find((b) => b.changePackId === changePack.changePackId);
    if (existing) {
      existingBlueprints.push(existing);
      continue;
    }

    const blueprint = upsertLandingBlueprint(buildBlueprintInput(changePack), current).blueprint;

    newBlueprints.push(blueprint);
    current = readCurrentLandingBlueprints();

    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "recommendation_created",
      summary: `Nuevo blueprint de landing propuesto: ${changePack.keyword}`,
      payload: { blueprintId: blueprint.blueprintId, changePackId: changePack.changePackId, templateType: blueprint.templateType },
    });
  }

  const generatedAt = new Date().toISOString();
  const result: UxUiLandingArchitectRunResult = {
    departmentRunId: deptRunId,
    newBlueprints,
    existingBlueprints,
    totalBlueprintCount: current.length,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(`UX/UI Landing Architect finalizado. Blueprints nuevos: ${newBlueprints.length}. Total: ${current.length}.`, {
    reportPath: result.reportPath,
  });
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `UX/UI Landing Architect finalizado: ${newBlueprints.length} blueprint(s) nuevo(s), ${current.length} en total.`,
    payload: { newBlueprintCount: newBlueprints.length, totalBlueprintCount: current.length, reportPath: result.reportPath },
  });

  return result;
}
