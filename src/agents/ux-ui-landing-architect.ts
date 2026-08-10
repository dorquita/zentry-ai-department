import * as fs from "fs";
import * as path from "path";
import { readCurrentChangePacks } from "../core/change-packs";
import { extractPreviewFields } from "./wordpress-draft-agent";
import { selectVisualTemplate, getVisualTemplateDefinition } from "../core/visual-templates";
import { fillPattern, detectTerm, smartLocksBlockApplies, SECTOR_TERMS, MATERIAL_TERMS } from "./visual-template-builder";
import { readCurrentLandingBlueprints, upsertLandingBlueprint } from "../core/landing-blueprints";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { ChangePack, LandingBenefitItem, LandingBlueprint, LandingCardItem, LandingComparisonTable, LandingFaqItem, LandingSection } from "../core/types";
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

// Fase O27.4b -- base de conocimiento REAL sobre los 3 materiales del
// catalogo (metalica/fenolica/melamina, ver O21/O22). Son propiedades
// tecnicas generales del sector (no cifras/garantias/plazos propios de
// Zentry que no tengamos confirmados), asi que es informacion segura de
// afirmar sin inventar nada especifico de la empresa. Postmortem de Pau:
// el catch-all anterior ("cuentanos tu caso concreto...") no aportaba
// ninguna informacion real sobre el producto -- esto es lo que lo
// sustituye para las secciones mas comunes (que es / ventajas /
// limitaciones / usos / comparativa).
interface MaterialInfo {
  label: string;
  queEs: string;
  ventajas: string;
  limitaciones: string;
  usos: string;
  vsOtros: string;
}

const MATERIAL_INFO: Record<string, MaterialInfo> = {
  melamina: {
    label: "melamina",
    queEs:
      "Las taquillas de melamina estan fabricadas en tablero aglomerado revestido con resina melaminica: un acabado con aspecto calido, similar a la madera, pero mas resistente al uso diario y mas facil de limpiar que la madera maciza.",
    ventajas: "buen acabado estetico tipo madera, amplia gama de colores, relacion calidad-precio ajustada y peso moderado que facilita el transporte e instalacion.",
    limitaciones: "menor resistencia a la humedad continua que la fenolica -- no es la opcion mas indicada para vestuarios de piscina o zonas con vapor constante.",
    usos: "oficinas, colegios, vestuarios de gimnasio de uso moderado y cualquier zona comun seca donde el aspecto visual importa tanto como la funcionalidad.",
    vsOtros:
      "frente a la fenolica, la melamina tiene mejor acabado estetico y menor coste pero resiste peor la humedad continua; frente a la metalica, es mas silenciosa y con mejor aspecto, aunque algo menos robusta ante impactos fuertes.",
  },
  fenolica: {
    label: "fenolica",
    queEs:
      "Las taquillas fenolicas estan fabricadas en tablero compacto fenolico, un material de alta densidad disenado para soportar humedad, agua e impactos sin deteriorarse.",
    ventajas: "maxima resistencia a la humedad y al vapor de agua, muy duradera frente a golpes y uso intensivo, y practicamente inalterable con el paso del tiempo.",
    limitaciones: "coste superior al de la melamina, y su acabado es mas tecnico/industrial que calido.",
    usos: "vestuarios de piscinas, duchas, gimnasios, polideportivos y cualquier zona con humedad constante.",
    vsOtros:
      "frente a la melamina, la fenolica gana claramente en resistencia a la humedad aunque cuesta algo mas; frente a la metalica, no se oxida y resulta mas silenciosa al abrir y cerrar.",
  },
  metalica: {
    label: "metalica",
    queEs: "Las taquillas metalicas estan fabricadas en chapa de acero pintada: la opcion mas robusta y tradicional para uso intensivo.",
    ventajas: "maxima resistencia a impactos y a un uso muy intensivo, buena relacion de precio en grandes volumenes y mejor comportamiento frente al fuego que las opciones en tablero.",
    limitaciones: "acabado mas industrial que estetico, y en entornos muy humedos requieren un tratamiento anticorrosion adecuado.",
    usos: "gimnasios, instalaciones deportivas, colegios de alto trafico y entornos industriales o de fabrica.",
    vsOtros:
      "frente a la melamina y la fenolica, la metalica es la mas resistente a impactos fuertes y al uso mas exigente, aunque su aspecto es mas industrial y puede ser algo mas ruidosa al cerrarse.",
  },
};
MATERIAL_INFO.fenolico = MATERIAL_INFO.fenolica;
MATERIAL_INFO.metalico = MATERIAL_INFO.metalica;

function resolveMaterialInfo(material: string | undefined): MaterialInfo | undefined {
  if (!material) return undefined;
  return MATERIAL_INFO[material.toLowerCase()];
}

// Copy generico de RESPALDO por tipo de seccion detectado en el H2 --
// nunca inventa cifras/plazos, siempre remite a "solicitar presupuesto"
// cuando hace falta un dato concreto que no tenemos. Se usa SOLO cuando
// el change pack no aporta ya un parrafo real para esa seccion (evita
// dejar secciones vacias, la causa raiz del postmortem original).
//
// Fase O27.4b (segundo postmortem visual de Pau): las secciones que SI
// coincidian con una categoria de abajo ya estaban bien, pero varias
// caian en el catch-all final y salian con relleno generico ("Sobre X:
// cuentanos tu caso concreto...") sin ninguna informacion real del
// producto. Se anaden categorias con contenido REAL especifico del
// material (que es / ventajas / limitaciones / usos / comparativa) y se
// mejora el catch-all para que use esa misma informacion cuando el
// material es conocido, en vez de relleno generico.
function buildSectionBody(heading: string, changePack: ChangePack, sector: string | undefined, material: string | undefined): string {
  const h = heading.toLowerCase();
  const keyword = changePack.keyword;
  const info = resolveMaterialInfo(material);

  if (/que es|definicion/.test(h)) {
    if (info) return info.queEs;
    return `${keyword.charAt(0).toUpperCase()}${keyword.slice(1)} son taquillas modulares fabricadas a medida por Zentry, disponibles en metalica, fenolica o melamina segun el uso y el entorno donde se instalen.`;
  }
  if (/ventaja/.test(h)) {
    if (info) return `Las principales ventajas de la ${info.label} son: ${info.ventajas}`;
    return `Entre las principales ventajas de ${keyword} destacan la fabricacion a medida, la posibilidad de elegir el material mas adecuado para tu uso y un trato directo con quien fabrica tu pedido, sin intermediarios.`;
  }
  if (/limitacion|desventaja|inconvenient/.test(h)) {
    if (info) return `Como cualquier material, la ${info.label} tambien tiene limitaciones a valorar: ${info.limitaciones}`;
    return `Cada material tiene sus limitaciones (resistencia a la humedad, coste, acabado): te ayudamos a elegir el mas adecuado segun donde vayan a instalarse tus ${keyword}.`;
  }
  if (/uso habitual|para que sirve|cuando conviene|donde se usa|casos de uso/.test(h)) {
    if (info) return `Es habitual encontrar taquillas de ${info.label} en: ${info.usos}`;
    return `${keyword.charAt(0).toUpperCase()}${keyword.slice(1)} se usan habitualmente en colegios, oficinas, gimnasios, vestuarios e instalaciones deportivas -- el material mas adecuado depende de la humedad y la intensidad de uso de cada espacio.`;
  }
  if (/vs|comparat|diferencia|alternativa/.test(h)) {
    if (info) return `Comparando materiales: ${info.vsOtros}`;
    return `Los 3 materiales disponibles cubren necesidades distintas: la melamina destaca por su acabado y precio, la fenolica por su resistencia a la humedad, y la metalica por su robustez ante un uso muy intensivo. Cuentanos donde vas a instalarlas y te recomendamos el material mas adecuado.`;
  }
  if (/tipos y materiales|materiales disponibles/.test(h)) {
    const all = ["melamina", "fenolica", "metalica"].map((m) => MATERIAL_INFO[m]);
    const summary = all.map((m) => `${m.label} (${m.ventajas.split(",")[0]})`).join("; ");
    return info
      ? `Estas taquillas estan fabricadas en ${info.label}. Tambien disponemos de otros materiales segun tu caso: ${summary}.`
      : `Fabricamos taquillas en 3 materiales principales: ${summary}. Te ayudamos a elegir el mas adecuado para tu espacio y uso concreto.`;
  }
  if (/modelo|medida|configuracion/.test(h)) {
    return `Disponemos de ${keyword} en distintas configuraciones (numero de puertas, altura, anchura) para adaptarnos al espacio disponible${sector ? ` en ${sector}` : ""}. Cuentanos las medidas de tu espacio y el numero de usuarios, y te proponemos la combinacion mas adecuada.`;
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
    if (info) return `Para elegir bien entre materiales: ${info.vsOtros} Cuentanos tu caso (numero de usuarios, presupuesto, si el espacio es humedo) y te recomendamos la combinacion mas adecuada.`;
    return `Cuentanos tu caso (numero de usuarios, presupuesto, si ya tienes taquillas o partes de cero) y te recomendamos la combinacion mas adecuada, sin compromiso.`;
  }
  // Catch-all final: si el material es conocido, se apoya en informacion
  // REAL de ese material (nunca relleno generico); si no hay material
  // detectado, incorpora siempre el propio titular en la frase para que
  // dos secciones distintas nunca produzcan el mismo parrafo exacto.
  if (info) {
    return `Sobre ${heading.replace(/[¿?]/g, "").trim().toLowerCase()}: la ${info.label} se caracteriza por ${info.ventajas.split(",")[0]}. ${info.usos.charAt(0).toUpperCase()}${info.usos.slice(1)}`;
  }
  const headingTopic = heading.replace(/[¿?]/g, "").trim();
  return `Sobre ${headingTopic.charAt(0).toLowerCase()}${headingTopic.slice(1)}: cuentanos tu caso concreto${sector ? ` en ${sector}` : ""} y te ayudamos a encontrar la mejor solucion en ${keyword}.`;
}

// Fase O27.4b -- antes, un H2 tipo "Preguntas frecuentes sobre X"
// generaba una unica seccion con UN parrafo generico ("Sobre preguntas
// frecuentes...: cuentanos tu caso concreto...") -- ni era un FAQ real ni
// aportaba informacion. Se detecta este heading en buildBlueprintInput y,
// en vez de una seccion mas, se generan 3 preguntas/respuestas REALES
// (bloque FAQ autentico, con su propio <h2>"Preguntas frecuentes"> ya
// generado por buildWordpressContentHtml) -- nunca inventa plazos/precios
// concretos, remite a "presupuesto" cuando hace falta un dato exacto.
function buildMaterialAwareFaqs(keyword: string, material: string | undefined, sector: string | undefined): LandingFaqItem[] {
  const info = resolveMaterialInfo(material);
  const faqs: LandingFaqItem[] = [
    {
      question: `¿Cuanto tardais en fabricar e instalar ${keyword}?`,
      answer: "El plazo depende del volumen y del grado de personalizacion del pedido -- te lo confirmamos exactamente al preparar tu presupuesto.",
    },
    {
      question: "¿Puedo combinar distintos materiales o medidas en el mismo pedido?",
      answer: `Si, cada pedido de ${keyword} se configura a medida: puedes combinar materiales, medidas y acabados segun las zonas de tu instalacion${sector ? ` (${sector})` : ""}.`,
    },
  ];
  if (info) {
    faqs.push({
      question: `¿Es resistente a la humedad la ${info.label}?`,
      answer: info.limitaciones.toLowerCase().includes("humedad")
        ? `Es un punto a tener en cuenta: ${info.limitaciones} Si tu espacio es humedo, te recomendamos valorar la fenolica.`
        : `Si -- ${info.ventajas.split(",")[0]}, lo que la hace adecuada para zonas con humedad.`,
    });
  } else {
    faqs.push({
      question: "¿Las taquillas incluyen cerradura?",
      answer: "Puedes elegir cerradura mecanica estandar o anadir cerradura electronica Tukandado para apertura sin llave fisica.",
    });
  }
  return faqs;
}

function buildBenefitBlocks(sector: string | undefined, keyword: string): LandingBenefitItem[] {
  return [
    { title: "Fabricante directo", description: "Sin intermediarios: precios mas competitivos y trato directo con quien fabrica tu pedido." },
    { title: sector ? `Adaptado a ${sector}` : "Adaptado a tu espacio", description: `Materiales y configuraciones de ${keyword} pensados para tu caso concreto.` },
    { title: "Presupuesto sin compromiso", description: "Cuentanos que necesitas y te preparamos una propuesta a medida, sin compromiso." },
  ];
}

function buildCards(material: string | undefined): LandingCardItem[] {
  const info = resolveMaterialInfo(material);
  if (info) {
    return [{ title: info.label.charAt(0).toUpperCase() + info.label.slice(1), description: info.ventajas.charAt(0).toUpperCase() + info.ventajas.slice(1) }];
  }
  if (material) {
    return [{ title: material.charAt(0).toUpperCase() + material.slice(1), description: `Opcion en ${material}, con las caracteristicas mas adecuadas para tu proyecto.` }];
  }
  return [
    { title: "Metalica", description: "La opcion mas robusta y duradera para un uso intensivo." },
    { title: "Fenolica", description: "Resistente a la humedad, indicada para vestuarios y zonas humedas." },
    { title: "Melamina", description: "Alternativa mas economica con acabado tipo madera." },
  ];
}

// Fase O27.4c -- Pau reviso una captura real: sin tabla comparativa, sin
// elementos de producto reales, comparativa de materiales reducida a un
// parrafo de texto plano. Se construye una tabla REAL (3 materiales x 4
// criterios) usando la misma base de conocimiento de MATERIAL_INFO --
// siempre relevante en este catalogo (Zentry solo vende taquillas en
// estos 3 materiales), asi que se incluye en TODAS las paginas, no solo
// cuando se detecta un material concreto en el keyword.
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildComparisonTable(): LandingComparisonTable {
  const m = MATERIAL_INFO.melamina;
  const f = MATERIAL_INFO.fenolica;
  const met = MATERIAL_INFO.metalica;
  return {
    title: "Comparativa de materiales",
    headers: ["Criterio", "Melamina", "Fenolica", "Metalica"],
    rows: [
      ["Resistencia a la humedad", "Media", "Alta", "Media (requiere tratamiento anticorrosion)"],
      ["Resistencia a impactos", "Media", "Alta", "Muy alta"],
      ["Acabado", "Calido, tipo madera", "Tecnico", "Industrial"],
      ["Uso recomendado", capitalize(m.usos.split(",")[0]), capitalize(f.usos.split(",")[0]), capitalize(met.usos.split(",")[0])],
    ],
  };
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

  // Fase O27.4b -- un heading tipo "Preguntas frecuentes sobre X" nunca
  // se convierte en una seccion mas (salia como UN parrafo generico, ni
  // era un FAQ real): se extrae aqui y se sustituye por 2-3 preguntas y
  // respuestas REALES (ver buildMaterialAwareFaqs), que ademas generan su
  // propio bloque "Preguntas frecuentes" real en el HTML final.
  // Fase O27.4d -- benchmark UX/UI (ver docs/ux-benchmark-taquillas.md):
  // "como trabajamos"/"proceso" se saca de `sections` (texto plano) igual
  // que ya se hizo con el FAQ en O27.4b -- ahora alimenta el componente
  // visual zentryProcessSteps (numerado, con tratamiento propio) en vez
  // de otro parrafo mas.
  const faqHeadingPattern = /preguntas frecuentes|\bfaq\b/i;
  const processHeadingPattern = /proceso|como trabajamos|como funciona/i;
  const nonFaqHeadings = fields.h2s.filter((heading) => !faqHeadingPattern.test(heading) && !processHeadingPattern.test(heading));
  const hasFaqHeading = fields.h2s.length !== fields.h2s.filter((heading) => !faqHeadingPattern.test(heading)).length;

  const sections: LandingSection[] = nonFaqHeadings.map((heading) => ({
    heading,
    body: buildSectionBody(heading, changePack, sector, material),
    searchIntent: classifySearchIntent(heading),
  }));

  const generatedFaqs = hasFaqHeading ? buildMaterialAwareFaqs(changePack.keyword, material, sector) : [];

  const processSteps = [
    `Nos cuentas que ${changePack.keyword} necesitas (cantidad, medidas, material).`,
    "Te preparamos un presupuesto a medida, sin compromiso.",
    "Confirmado el pedido, fabricamos y coordinamos la entrega contigo.",
  ];
  const useCases = (resolveMaterialInfo(material)?.usos ?? "oficinas, colegios, gimnasios, vestuarios e instalaciones deportivas")
    .split(",")
    .map((u) => capitalize(u.trim()))
    .slice(0, 4);

  return {
    changePackId: changePack.changePackId,
    templateType: templateId,
    hero: {
      headline: fillPattern(template.hero.headlinePattern, changePack, sector, material),
      subheadline: fillPattern(template.hero.subheadlinePattern, changePack, sector, material),
    },
    // Fase O27.4c -- no hay pipeline de fotos/render reales conectado a
    // este agente todavia (ver src/agents/visual-asset-planner.ts para el
    // flujo de peticion de assets, que es async y depende de aprobacion
    // separada) -- en vez de dejar el hero sin imagen (uno de los
    // problemas senalados por Pau), se marca un placeholder HONESTO,
    // nunca una foto inventada.
    heroImageCaption: `Imagen de producto — pendiente de sesion fotografica (${changePack.keyword})`,
    benefitsHeading: fillPattern(template.benefitsBlock.title, changePack, sector, material),
    comparisonTable: buildComparisonTable(),
    useCases,
    processSteps,
    ctaPrimary: { label: template.hero.ctaLabel, target: ctaTarget, isRealLink: realLinks.length > 0 },
    ctaSecondary: includeSecondaryCta
      ? { label: "Ver cerraduras inteligentes", target: "#cerraduras-inteligentes", isRealLink: false }
      : undefined,
    benefitBlocks: buildBenefitBlocks(sector, changePack.keyword),
    cards: buildCards(material),
    sections,
    faq: [...fields.faqs.map(rewriteFaqIfPlaceholder), ...generatedFaqs],
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
