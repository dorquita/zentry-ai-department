import { ChangePack, ImagePurpose } from "./types";

/**
 * Visual Template System (Fase O12.4) — catalogo de plantillas visuales
 * LOCALES (puro dato/logica, sin I/O, sin llamadas a WordPress ni a
 * ninguna API externa). Define la ESTRUCTURA que deberia tener un
 * borrador para dejar de ser "texto plano" y pasar a ser un layout
 * pensado para Kadence Blocks + Gutenberg — pero esta fase NUNCA
 * construye el HTML final ni lo sube a WordPress: eso sigue siendo
 * `src/adapters/wordpress.ts` (Fase O10/O12), que no ha cambiado.
 *
 * Cada plantilla es deliberadamente un CONTRATO de bloques (que bloque va
 * dónde, que tipo de imagen necesita, que nota de diseno aplica), no
 * marcado HTML — lo consume `src/agents/visual-template-builder.ts` para
 * enriquecer el preview local, y `src/agents/visual-asset-planner.ts`
 * para saber que imagenes proponer.
 */

export type VisualTemplateId =
  | "sector_landing"
  | "product_landing"
  | "seo_landing"
  | "comparison_landing"
  | "blog_article";

export const VISUAL_TEMPLATE_IDS: VisualTemplateId[] = [
  "sector_landing",
  "product_landing",
  "seo_landing",
  "comparison_landing",
  "blog_article",
];

export interface VisualImageSlot {
  imagePurpose: ImagePurpose;
  placeholderNote: string;
  dimensions: { width: number; height: number };
}

export interface VisualBlockSpec {
  title: string;
  notes: string;
}

export interface SmartLocksBlockSpec extends VisualBlockSpec {
  /** Cuando aplicar este bloque — el Visual Template Builder decide si incluirlo segun el brandIntent/keyword del change pack. */
  appliesWhen: string;
}

export interface FaqBlockSpec {
  title: string;
  minItems: number;
  maxItems: number;
  notes: string;
}

export interface VisualTemplateDefinition {
  templateId: VisualTemplateId;
  label: string;
  whenToUse: string;
  hero: {
    headlinePattern: string;
    subheadlinePattern: string;
    image: VisualImageSlot;
    ctaLabel: string;
  };
  featuredImage: VisualImageSlot;
  benefitsBlock: VisualBlockSpec & { itemCountRange: string };
  materialsOrProductsBlock: VisualBlockSpec;
  smartLocksBlock: SmartLocksBlockSpec;
  faqsBlock: FaqBlockSpec;
  finalCta: { label: string; notes: string };
  internalLinksNotes: string;
  recommendedSchema: string[];
  kadenceGutenbergNotes: string[];
}

const HERO_DIMENSIONS = { width: 1600, height: 900 };
const CARD_DIMENSIONS = { width: 800, height: 600 };
const PRODUCT_DIMENSIONS = { width: 1200, height: 1200 };

function placeholder(note: string): string {
  return `Placeholder hoy: bloque solido/icono generico de Kadence (sin imagen real). ${note} Se sustituye por una imagen real solo cuando exista una peticion de asset "generated"/"uploaded_to_wordpress" — ver docs/asset-generation-workflow.md. Nunca se genera ni se sube nada en esta fase.`;
}

export const VISUAL_TEMPLATES: Record<VisualTemplateId, VisualTemplateDefinition> = {
  sector_landing: {
    templateId: "sector_landing",
    label: "Landing de sector B2B",
    whenToUse:
      'Cuando el change pack apunta a un sector concreto (colegio, gimnasio, hotel, oficina, hospital...) detectado via b2b_sector_terms en config/brand-positioning.json — p.ej. "taquillas escolares", "taquillas para gimnasios".',
    hero: {
      headlinePattern: 'Taquillas para {sector} | Zentry',
      subheadlinePattern: "Fabricante directo — entrega rapida, presupuesto sin compromiso para {sector}.",
      image: { imagePurpose: "hero", placeholderNote: placeholder("Foto real o render de taquillas en un entorno del sector (vestuario de gimnasio, pasillo escolar, etc.)."), dimensions: HERO_DIMENSIONS },
      ctaLabel: "Solicitar presupuesto",
    },
    featuredImage: { imagePurpose: "card", placeholderNote: placeholder("Miniatura para listados/redes, mismo tema que el hero pero recortada a formato tarjeta."), dimensions: CARD_DIMENSIONS },
    benefitsBlock: {
      title: "Por que elegir Zentry para tu {sector}",
      notes: "3-4 beneficios especificos del sector (resistencia a humedad en gimnasios, seguridad en colegios, discrecion en oficinas...), nunca beneficios genericos sin adaptar.",
      itemCountRange: "3-4",
    },
    materialsOrProductsBlock: {
      title: "Modelos y materiales recomendados para {sector}",
      notes: "Resumen breve de 2-3 materiales/modelos mas adecuados para ESE sector (p.ej. metalica para gimnasios por higiene, melamina para oficinas por estetica), con enlace a la pagina de producto correspondiente — nunca el catalogo completo aqui.",
    },
    smartLocksBlock: {
      title: "¿Tambien necesitas cerradura electronica?",
      notes: 'Bloque de cross-sell hacia Tukandado: 1 parrafo + CTA secundario "Ver cerraduras inteligentes". Nunca mezclar el CTA principal (Zentry) con este secundario.',
      appliesWhen: "El brandIntent del change pack es zentry_locker_core o mixed_cross_sell (nunca si es tukandado_lock_core puro, para no repetir el mensaje).",
    },
    faqsBlock: {
      title: "Preguntas frecuentes sobre taquillas para {sector}",
      minItems: 2,
      maxItems: 4,
      notes: "Preguntas de friccion especificas del sector (normativa, plazos de instalacion en periodo lectivo/vacacional, garantia frente a uso intensivo).",
    },
    finalCta: { label: "Solicitar presupuesto sin compromiso", notes: "Repetir el CTA del hero al final, con el mismo texto — nunca introducir un tercer CTA distinto." },
    internalLinksNotes: "Enlazar a: (1) landing general de taquillas Zentry, (2) pagina de cerraduras inteligentes si aplica el bloque smart locks, (3) otras landings de sector relacionadas si existen en el cluster SEO.",
    recommendedSchema: ["Product", "FAQPage"],
    kadenceGutenbergNotes: [
      "Hero: Kadence Advanced Row con imagen de fondo + overlay oscuro para legibilidad del texto.",
      "Beneficios: Kadence Info Box en fila de 3-4 columnas, icono + titulo corto + 1 frase.",
      "Bloque smart locks: Kadence Advanced Row con fondo de color distinto al resto de la pagina para diferenciarlo visualmente como cross-sell.",
      "FAQs: bloque nativo de Gutenberg (Preguntas frecuentes) o Kadence Accordion, nunca texto plano sin acordeon.",
    ],
  },

  product_landing: {
    templateId: "product_landing",
    label: "Landing de producto/material",
    whenToUse:
      'Cuando el change pack gira en torno a un MATERIAL o modelo concreto (melamina, fenolica, metalica, madera) detectado via material_terms — p.ej. "taquillas de melamina", "taquilla madera".',
    hero: {
      headlinePattern: "Taquillas de {material} | Fabricante Zentry",
      subheadlinePattern: "Fabricacion directa en {material}: medidas, acabados y precios a medida.",
      image: { imagePurpose: "hero", placeholderNote: placeholder("Foto de producto real del material concreto, fondo neutro o de proyecto instalado."), dimensions: HERO_DIMENSIONS },
      ctaLabel: "Pedir presupuesto",
    },
    featuredImage: { imagePurpose: "product_context", placeholderNote: placeholder("Imagen de producto en contexto de uso (no solo el objeto aislado)."), dimensions: PRODUCT_DIMENSIONS },
    benefitsBlock: {
      title: "Ventajas de la {material}",
      notes: "Beneficios TECNICOS del material (resistencia a humedad, mantenimiento, acabado, durabilidad) — nunca beneficios genericos de marca que no dependan del material.",
      itemCountRange: "3-4",
    },
    materialsOrProductsBlock: {
      title: "Modelos, medidas y acabados disponibles",
      notes: "Este es el bloque PRINCIPAL de esta plantilla (a diferencia de sector_landing, donde es secundario): tabla o lista de modelos/medidas/acabados reales, con precio orientativo si se dispone de el.",
    },
    smartLocksBlock: {
      title: "Anade cerradura electronica a estas taquillas",
      notes: "Mencion breve de que el modelo es compatible con cerradura electronica Tukandado como opcion, con enlace — no un bloque extenso.",
      appliesWhen: "El brandIntent es zentry_locker_core o mixed_cross_sell.",
    },
    faqsBlock: {
      title: "Preguntas frecuentes sobre taquillas de {material}",
      minItems: 2,
      maxItems: 4,
      notes: "Preguntas sobre el material especifico (limpieza, resistencia, garantia, plazos de fabricacion a medida).",
    },
    finalCta: { label: "Pedir presupuesto sin compromiso", notes: "Mismo CTA que el hero." },
    internalLinksNotes: "Enlazar a: (1) otras paginas de material dentro del cluster SEO (evitar canibalizacion, ver risks del change pack), (2) landing general de taquillas, (3) cerraduras inteligentes si aplica.",
    recommendedSchema: ["Product"],
    kadenceGutenbergNotes: [
      "Hero: imagen de producto grande a la derecha, texto a la izquierda (layout Kadence de 2 columnas).",
      "Bloque de modelos/medidas: tabla Kadence Table o Info Box en grid, nunca una lista de texto plano si hay 3+ modelos.",
      "Imagen destacada: formato cuadrado o casi cuadrado (ver dimensions), pensado para poder reutilizarse como miniatura de catalogo.",
    ],
  },

  seo_landing: {
    templateId: "seo_landing",
    label: "Landing SEO on-page",
    whenToUse:
      'Cuando el change pack es un ajuste on-page generico (changeType "seo_on_page_update") sin un sector o material claramente dominante — el caso mas comun hoy (ver Fase O11/O12).',
    hero: {
      headlinePattern: "{keyword} | Zentry",
      subheadlinePattern: "Texto orientado a conversion segun el keyword principal, sin inventar datos no confirmados.",
      image: { imagePurpose: "hero", placeholderNote: placeholder("Imagen generica de catalogo/instalacion, coherente con la keyword pero sin comprometerse a un sector/material concreto."), dimensions: HERO_DIMENSIONS },
      ctaLabel: "Solicitar presupuesto",
    },
    featuredImage: { imagePurpose: "card", placeholderNote: placeholder("Miniatura para resultados de busqueda/redes."), dimensions: CARD_DIMENSIONS },
    benefitsBlock: {
      title: "Por que elegir Zentry",
      notes: "Beneficios generales de marca (fabricante directo, plazos, garantia) — plantilla mas generica que sector_landing/product_landing a proposito.",
      itemCountRange: "3",
    },
    materialsOrProductsBlock: {
      title: "Materiales y modelos disponibles",
      notes: "Resumen breve con enlaces salientes a las paginas de producto/material especificas — este template NUNCA repite el detalle completo, solo orienta.",
    },
    smartLocksBlock: {
      title: "¿Buscas tambien cerradura electronica?",
      notes: "Bloque corto de cross-sell, igual que en sector_landing.",
      appliesWhen: "El brandIntent es zentry_locker_core o mixed_cross_sell.",
    },
    faqsBlock: {
      title: "Preguntas frecuentes",
      minItems: 2,
      maxItems: 4,
      notes: "Directamente las suggestedFaqs del change pack de origen (Fase O6), sin reinventar contenido nuevo aqui.",
    },
    finalCta: { label: "Solicitar presupuesto sin compromiso", notes: "Mismo CTA que el hero." },
    internalLinksNotes: "Usar exactamente suggestedInternalLinks del change pack de origen (ver Fase O12.2: solo se generan <a href> reales si el change pack aporto URLs reales).",
    recommendedSchema: ["Product", "FAQPage"],
    kadenceGutenbergNotes: [
      "Layout mas simple que sector_landing/product_landing: hero + beneficios + FAQs es suficiente, no forzar bloques que no aporten.",
      "Reutilizar los mismos componentes Kadence ya usados en el resto del sitio para esta keyword (coherencia visual con paginas hermanas del cluster).",
    ],
  },

  comparison_landing: {
    templateId: "comparison_landing",
    label: "Landing comparativa",
    whenToUse:
      'Cuando la keyword o el contenido implican una decision entre 2+ opciones (p.ej. "taquillas metalicas vs melamina", "cerradura mecanica o electronica") — detectar por presencia de "vs", "o", "mejor", "diferencia" en la keyword/brief.',
    hero: {
      headlinePattern: "{opcionA} vs {opcionB}: ¿cual elegir?",
      subheadlinePattern: "Comparativa objetiva para ayudarte a decidir segun tu caso de uso.",
      image: { imagePurpose: "hero", placeholderNote: placeholder("Imagen dividida o composicion mostrando ambas opciones lado a lado."), dimensions: HERO_DIMENSIONS },
      ctaLabel: "Habla con un experto",
    },
    featuredImage: { imagePurpose: "card", placeholderNote: placeholder("Miniatura de la comparativa para listados."), dimensions: CARD_DIMENSIONS },
    benefitsBlock: {
      title: "En que te tienes que fijar antes de decidir",
      notes: "En vez de beneficios de marca, aqui van los CRITERIOS de decision (presupuesto, uso, mantenimiento, seguridad) — es el equivalente funcional del bloque beneficios en esta plantilla.",
      itemCountRange: "3-4",
    },
    materialsOrProductsBlock: {
      title: "Comparativa lado a lado",
      notes: "Este es el bloque CENTRAL de la plantilla: tabla comparativa real (precio orientativo, durabilidad, mantenimiento, casos de uso recomendados) — nunca omitir esta tabla en una comparison_landing.",
    },
    smartLocksBlock: {
      title: "Cerradura mecanica vs electronica",
      notes: "Si la comparativa NO es ya sobre cerraduras, este bloque compara brevemente el complemento de cerradura para cada opcion de taquilla.",
      appliesWhen: "El brandIntent es zentry_locker_core, tukandado_lock_core o mixed_cross_sell — practicamente siempre aplica en esta plantilla salvo comparativas 100% ajenas a cerraduras.",
    },
    faqsBlock: {
      title: "Preguntas frecuentes para decidir",
      minItems: 3,
      maxItems: 4,
      notes: 'FAQs orientadas a ayudar a decidir ("¿Cual dura mas?", "¿Cual es mas barata a largo plazo?"), no FAQs genericas de producto.',
    },
    finalCta: { label: "Habla con un experto sin compromiso", notes: "CTA de asesoramiento, deliberadamente distinto al CTA transaccional de las demas plantillas — encaja mejor con el momento de decision del usuario." },
    internalLinksNotes: "Enlazar a las 2 (o mas) paginas de producto/material que se estan comparando — es el enlace interno mas importante de esta plantilla, nunca omitirlo.",
    recommendedSchema: ["FAQPage", "Product"],
    kadenceGutenbergNotes: [
      "Tabla comparativa: Kadence Table o Advanced Table, con la columna recomendada (si la hay) resaltada visualmente.",
      "Evitar declarar un 'ganador' universal si el contenido no lo justifica — la tabla debe ayudar a decidir segun el caso de uso, no vender agresivamente una opcion.",
    ],
  },

  blog_article: {
    templateId: "blog_article",
    label: "Articulo de blog / contenido informativo",
    whenToUse:
      'Cuando el change pack es un brief editorial informativo (changeType "new_content_page"/"content_update" sin intencion transaccional clara) — el contenido es mas informativo que de venta directa.',
    hero: {
      headlinePattern: "{titulo del articulo}",
      // Fase O27.4 (bug real encontrado en revision visual de Pau): este
      // patron y el ctaLabel de abajo son los UNICOS de todo este fichero
      // que se escribieron como una NOTA para quien programa (tono,
      // criterio editorial), no como un patron de copy real con
      // {placeholders} -- el resto de plantillas (sector_landing,
      // product_landing...) SI son copy real listo para rellenar y
      // publicar. ux-ui-landing-architect.ts usa este campo tal cual
      // (fillPattern + boton), asi que la nota se colaba literal como
      // subtitulo/CTA visibles en paginas reales de staging (2097, 2100).
      // Deben ser copy real, blando/informativo en TONO pero nunca texto
      // sobre como escribir texto.
      subheadlinePattern: "Guia informativa de Zentry sobre {keyword}: todo lo que necesitas saber antes de decidir.",
      image: { imagePurpose: "hero", placeholderNote: placeholder("Imagen editorial/de contexto, no necesariamente de producto — estilo mas fotografico/lifestyle que las plantillas transaccionales."), dimensions: HERO_DIMENSIONS },
      ctaLabel: "Ver catalogo de taquillas Zentry",
    },
    featuredImage: { imagePurpose: "card", placeholderNote: placeholder("Miniatura para el listado del blog y para compartir en redes."), dimensions: CARD_DIMENSIONS },
    benefitsBlock: {
      title: "Puntos clave",
      notes: "Equivalente informativo del bloque beneficios: un resumen de 3-4 ideas clave del articulo (no beneficios de producto/marca).",
      itemCountRange: "3-4",
    },
    materialsOrProductsBlock: {
      title: "Productos relacionados (mencion contextual)",
      notes: "Mencion breve y no intrusiva de productos Zentry relacionados con el tema del articulo, con enlace — nunca el foco principal del articulo.",
    },
    smartLocksBlock: {
      title: "Relacionado: cerraduras inteligentes",
      notes: "Mencion contextual opcional si el tema del articulo se cruza con seguridad/control de acceso.",
      appliesWhen: "Solo si el tema del articulo lo justifica de forma natural (nunca forzado en articulos sin relacion).",
    },
    faqsBlock: {
      title: "Preguntas frecuentes sobre este tema",
      minItems: 2,
      maxItems: 3,
      notes: "Opcional en esta plantilla (a diferencia de las demas, donde es casi siempre recomendable) — solo si el tema genera preguntas reales.",
    },
    finalCta: { label: "Ver catalogo de taquillas Zentry", notes: "CTA suave (descubrir mas contenido/catalogo), nunca un CTA de venta directa agresivo en un articulo informativo." },
    internalLinksNotes: "Enlazar a otros articulos del mismo cluster de contenido y, de forma secundaria, a paginas de producto relacionadas — el enlace interno aqui prioriza SEO topical authority sobre conversion directa.",
    recommendedSchema: ["Article", "FAQPage"],
    kadenceGutenbergNotes: [
      "Usar la plantilla de entrada de blog estandar del tema (no forzar los mismos bloques Kadence de landing transaccional).",
      "Imagen destacada obligatoria para que el articulo se vea bien en el listado del blog y al compartir en redes sociales.",
    ],
  },
};

export function getVisualTemplateDefinition(templateId: VisualTemplateId): VisualTemplateDefinition {
  return VISUAL_TEMPLATES[templateId];
}

/**
 * Selecciona la plantilla mas adecuada para un change pack, con una
 * heuristica deliberadamente simple y explicable (nunca un modelo/IA):
 * 1. Si la keyword sugiere una comparativa -> comparison_landing.
 * 2. Si el changeType es un brief editorial sin pagina de destino
 *    transaccional -> blog_article.
 * 3. Si la keyword/pagina menciona un sector B2B conocido -> sector_landing.
 * 4. Si la keyword/pagina menciona un material conocido -> product_landing.
 * 5. Por defecto (el caso mas comun hoy) -> seo_landing.
 */
export function selectVisualTemplate(changePack: ChangePack): VisualTemplateId {
  const haystack = `${changePack.keyword} ${changePack.page ?? ""}`.toLowerCase();

  const COMPARISON_HINTS = [" vs ", " vs.", "comparativa", "cual elegir", "diferencia entre", "mejor opcion"];
  if (COMPARISON_HINTS.some((hint) => haystack.includes(hint))) {
    return "comparison_landing";
  }

  if (changePack.changeType === "new_content_page" || changePack.changeType === "content_update") {
    const B2B_SECTOR_HINTS = ["colegio", "gimnasio", "hotel", "oficina", "hospital", "universidad", "centro deportivo", "polideportivo", "piscina", "industrial"];
    const hasSector = B2B_SECTOR_HINTS.some((hint) => haystack.includes(hint));
    if (!hasSector) {
      return "blog_article";
    }
  }

  const SECTOR_HINTS = ["colegio", "gimnasio", "hotel", "oficina", "hospital", "universidad", "centro deportivo", "polideportivo", "piscina", "industrial", "empresa"];
  if (SECTOR_HINTS.some((hint) => haystack.includes(hint))) {
    return "sector_landing";
  }

  const MATERIAL_HINTS = ["melamina", "fenolic", "metalic", "madera"];
  if (MATERIAL_HINTS.some((hint) => haystack.includes(hint))) {
    return "product_landing";
  }

  return "seo_landing";
}
