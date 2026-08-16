import { SemEvidenceCatalogItem, SemEvidenceCategory, SemSpecialistContext } from "./sem-specialist-context";

/**
 * Validador/auditor de dominio del empleado `sem-specialist` -- mismo
 * patron que `src/core/landing-architect-comparison.ts`
 * (`validateV2Output()` / `auditV2OutputForFabrication()`): sin librerias
 * externas, fail-closed, TOOL puro (no invoca a Claude ni decide nada,
 * solo valida/audita/formatea lo que ya devolvio el subagente).
 *
 * Recibe SIEMPRE `raw: unknown` ya validado contra
 * config/sem-specialist-output.schema.json por el runtime comun
 * (src/core/claude-employee-runtime.ts) -- nunca al reves.
 */

export type SemFindingSeverity = "info" | "low" | "medium" | "high";
export type SemExperimentPriority = "low" | "medium" | "high";

export interface SemFinding {
  title: string;
  description: string;
  evidenceRefs: string[];
  severity: SemFindingSeverity;
}

export interface SemExperiment {
  title: string;
  hypothesis: string;
  expectedImpact: string;
  evidenceRefs: string[];
  priority: SemExperimentPriority;
}

export interface SemEvidenceItem {
  id: string;
  contextField: string;
  value: string;
}

export interface SemSpecialistOutput {
  summary: string;
  campaignFindings: SemFinding[];
  searchTermOpportunities: SemFinding[];
  negativeKeywordRecommendations: SemFinding[];
  budgetObservations: SemFinding[];
  biddingObservations: SemFinding[];
  adLandingAlignment: SemFinding[];
  conversionRiskFindings: SemFinding[];
  prioritizedExperiments: SemExperiment[];
  evidence: SemEvidenceItem[];
  unknowns: string[];
}

const SEVERITIES: SemFindingSeverity[] = ["info", "low", "medium", "high"];
const PRIORITIES: SemExperimentPriority[] = ["low", "medium", "high"];

const FINDING_FIELDS = [
  "campaignFindings",
  "searchTermOpportunities",
  "negativeKeywordRecommendations",
  "budgetObservations",
  "biddingObservations",
  "adLandingAlignment",
  "conversionRiskFindings",
] as const;

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isFinding(v: unknown): v is SemFinding {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.title) && isString(o.description) && isStringArray(o.evidenceRefs) && isString(o.severity) && SEVERITIES.includes(o.severity as SemFindingSeverity);
}

function isExperiment(v: unknown): v is SemExperiment {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.title) &&
    isString(o.hypothesis) &&
    isString(o.expectedImpact) &&
    isStringArray(o.evidenceRefs) &&
    isString(o.priority) &&
    PRIORITIES.includes(o.priority as SemExperimentPriority)
  );
}

function isEvidenceItem(v: unknown): v is SemEvidenceItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.id) && isString(o.contextField) && isString(o.value);
}

/**
 * Valida (sin librerias externas) que un objeto crudo tiene la forma
 * minima de un `SemSpecialistOutput`. Fail-closed: cualquier campo
 * obligatorio ausente o del tipo equivocado lanza -- nunca se "rellena"
 * con un valor por defecto que disfrazaria una salida rota del subagente
 * como si fuera valida.
 */
export function validateSemSpecialistOutput(raw: unknown): SemSpecialistOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salida sem-specialist invalida: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  if (!isString(o.summary)) {
    throw new Error('Salida sem-specialist invalida: falta "summary" (string).');
  }

  for (const field of FINDING_FIELDS) {
    if (!Array.isArray(o[field]) || !(o[field] as unknown[]).every(isFinding)) {
      throw new Error(`Salida sem-specialist invalida: "${field}" debe ser un array de { title, description, evidenceRefs, severity }.`);
    }
  }

  if (!Array.isArray(o.prioritizedExperiments) || !o.prioritizedExperiments.every(isExperiment)) {
    throw new Error('Salida sem-specialist invalida: "prioritizedExperiments" debe ser un array de { title, hypothesis, expectedImpact, evidenceRefs, priority }.');
  }
  if (!Array.isArray(o.evidence) || !o.evidence.every(isEvidenceItem)) {
    throw new Error('Salida sem-specialist invalida: "evidence" debe ser un array de { id, contextField, value }.');
  }
  if (!isStringArray(o.unknowns)) {
    throw new Error('Salida sem-specialist invalida: "unknowns" debe ser string[].');
  }

  return o as unknown as SemSpecialistOutput;
}

// --- Auditoria de afirmaciones cuantitativas sin respaldo -----------------
//
// La mision de sem-specialist es explicita: "NO inventa CPC, conversiones,
// ROAS ni gasto". A diferencia de `auditV2OutputForFabrication()` (que
// SIEMPRE devuelve warnings para revision humana, nunca bloquea), aqui
// una afirmacion cuantitativa sin respaldo es un FALLO DURO: el runner
// (scripts/run-sem-specialist.ts) trata cualquier violacion devuelta por
// `auditSemSpecialistOutputForUnsupportedClaims()` como `status:
// "invalid_output"`, exactamente igual que un error de forma.
//
// FIX ESTRUCTURAL (evidenceCatalog determinista, ver
// sem-specialist-context.ts): en vez de una heuristica difusa (resolver
// una ruta de contexto + comparar texto parcial), la evidencia se valida
// por COINCIDENCIA EXACTA contra un catalogo pre-computado por codigo
// TOOL antes de invocar a Claude -- el subagente solo puede copiar
// entradas del catalogo tal cual (mismo id+contextField+value), nunca
// inventar ni modificar una.
//
// Dos capas de verificacion, ambas necesarias:
//   1. Cada `evidence[]` declarado debe coincidir EXACTAMENTE con una
//      entrada del `evidenceCatalog` del contexto -- una "evidencia"
//      inventada o modificada rompe la cadena de confianza aunque luego
//      se referencie desde un finding.
//   2. Cualquier cifra de CPC/conversiones/ROAS/gasto/presupuesto en el
//      texto de salida debe coincidir con el value de una entrada real
//      del catalogo -- ver resolveClaimCandidateEntries()/
//      findMatchingCatalogEntry() para las dos reglas exactas (una para
//      "summary", otra para findings/experimentos con evidenceRefs
//      propio), diagnosticadas y corregidas a partir del run
//      31888764722 (2026-08-15):
//
//      a) "summary" (SemSpecialistOutput.summary) es un string plano sin
//         evidenceRefs propio -- estructuralmente no puede citar una
//         entrada concreta del catalogo. Exigirle una cita puntual
//         (imposible de cumplir por contrato) generaba un falso positivo
//         garantizado en cualquier resumen que mencionara una cifra real
//         (3 de las 4 violaciones de ese run: gasto=0, presupuesto=44,
//         ambas cifras reales del snapshot, ninguna inventada). Para este
//         campo unicamente, basta con que la cifra exista en algun punto
//         del evidenceCatalog -- una cifra que no exista en absoluto
//         (inventada) sigue siendo un fallo duro.
//      b) findings/experimentos (que si tienen evidenceRefs propio):
//         la cifra debe coincidir con el value de una entrada CITADA
//         explicitamente en evidenceRefs. La categoria REAL de esa
//         entrada (evidenceCatalog) es la que cuenta, NUNCA la categoria
//         que la heuristica de proximidad textual (QUANT_CLAIM_CATEGORIES)
//         haya adivinado: la 4a violacion de ese run era un falso
//         positivo exactamente por esto -- "...sin gasto real
//         registrado. Si se activaran las 7 campañas..." hacia que la
//         ventana de proximidad de "gasto" capturara el "7" de
//         "campañas" (categoria real "other", via sem-total-campaigns),
//         una cifra real y correctamente citada, solo que sobre un tema
//         distinto al que la palabra vecina sugeria.
//         EXCEPCION deliberada: para "cpc" y "roas" se exige ademas que
//         la entrada citada sea REALMENTE de esa categoria (ver
//         CATEGORIES_WITHOUT_REAL_NUMERIC_DATA) -- el catalogo nunca
//         tiene una entrada numerica de esas 2 categorias (solo el
//         centinela "not_available"), asi que sin esta excepcion una
//         cifra de CPC fabricada podria "colarse" citando una entrada
//         real pero completamente ajena (p.ej. un recuento de campanas)
//         solo porque el numero coincide por casualidad (misattribution
//         real, cubierta por un test de regresion propio).

interface QuantClaimCategory {
  id: string;
  label: string;
  pattern: RegExp;
}

// Patron "gap": el nombre de la categoria (p.ej. "cpc", "presupuesto")
// seguido, dentro de una ventana corta de caracteres NO numericos, por la
// cifra que se esta afirmando -- deliberadamente laxo sobre la prosa
// intermedia ("el CPC medio es de", "el presupuesto total si se
// activaran todas las campanas es de") para no depender de una redaccion
// exacta, igual de estricto sobre EXIGIR que la cifra este realmente
// cerca de la palabra clave (ventana acotada, no "en cualquier parte del
// texto") para no disparar falsos positivos entre frases distintas.
//
// EXCLUYE puntuacion de fin de frase (. ! ?) del hueco permitido -- sin
// esto, la ventana podia "saltar" una frontera de frase entera y asociar
// la palabra clave de UNA afirmacion con la cifra de OTRA completamente
// distinta. Caso real (run 31890170949): "...sin gasto real registrado.
// Si se activaran las 7 campañas..." capturaba el "7" de "campañas"
// como si fuera una cifra de gasto, solo porque "gasto" aparecia antes
// del punto -- la relacion textual real entre "gasto" y "7" no existe,
// estan en dos frases distintas. Con las 4 categorias reales del
// catalogo (gasto/presupuesto/conversiones/CPC/ROAS) nunca hace falta
// cruzar un punto para expresar una afirmacion cuantitativa legitima
// ("el gasto es de 0 €", "el presupuesto es de 44 € si se activaran"),
// asi que esta restriccion no genera ningun falso negativo nuevo.
const GAP = "[^\\d.!?]{0,40}?";

// La cifra capturada NUNCA puede estar pegada a una letra/digito/guion
// bajo vecino -- sin este guardado, un identificador o etiqueta como
// "LAST_30_DAYS" (metricsWindow real de sem-watcher) cerca de la palabra
// "gasto" haria que "30" se leyera como una cifra de gasto inventada
// (falso positivo real, detectado durante la verificacion manual de este
// runner contra datos locales reales).
const NUM = "(?<![\\w])(\\d+(?:[.,]\\d+)?)(?![\\w])";

/**
 * Unidades de TIEMPO que, cuando siguen INMEDIATAMENTE a la cifra
 * capturada, demuestran que esa cifra es la DURACION de la ventana de
 * metricas y no una afirmacion de gasto/presupuesto/conversiones/CPC/ROAS.
 * La ventana de proximidad de QUANT_CLAIM_CATEGORIES mira hacia ATRAS
 * (que palabra clave precede a la cifra); esto mira hacia DELANTE (que
 * unidad la sigue).
 *
 * Caso real que motiva esta regla (los 8 fallos consecutivos de
 * sem-specialist.yml del 2026-08-15, el ultimo el run 31890935474, con
 * unsupportedClaimCount=1): la frase legitima "no se han registrado
 * conversiones en los ultimos 30 dias" hacia que la ventana de
 * "conversiones" capturase el "30" de "30 dias" como si fuera un recuento
 * de conversiones inventado.
 *
 * POR QUE SOLO TIEMPO, y no cualquier sustantivo contable ("7 campanas",
 * "60 keywords"): la regla general de este auditor -- toda cifra de un
 * finding debe estar CITADA en su evidenceRefs -- solo es exigible cuando
 * esa cifra PUEDE tener una entrada en evidenceCatalog. Los recuentos de
 * campanas/keywords/ad groups SI la tienen (sem-total-campaigns,
 * sem-total-positive-keywords...), asi que exigir su cita es razonable y
 * se mantiene. La duracion de la ventana NO la tiene ni puede tenerla
 * (el catalogo no expone `metricsWindow` como cifra, justamente para no
 * abrir una entrada numerica generica que respaldaria por accidente
 * cualquier importe que coincidiera), asi que exigir su cita era una
 * condicion imposible de cumplir: la salida quedaba rechazada dijera lo
 * que dijera el especialista.
 *
 * Deliberadamente NO incluye "conversion/conversiones" ni "€"/"EUR"/
 * "euros": "12 conversiones" y "44 €" SI son afirmaciones auditables y
 * siguen exigiendo evidencia citada.
 */
const DURATION_UNIT_AFTER_NUMBER = /^\s*(?:d[ií]as?|jornadas?|semanas?|mes(?:es)?|a[ñn]os?|horas?|minutos?)\b/i;

/** Cuantos caracteres se miran tras la cifra para decidir si lleva una unidad de tiempo pegada. */
const UNIT_LOOKAHEAD_CHARS = 24;

/**
 * "conversion primaria" / "conversion principal" no es una CONVERSION
 * medida: es una ACCION DE CONVERSION configurada en la cuenta. Contar
 * cuantas hay ("las 3 conversiones primarias configuradas") es una
 * afirmacion sobre la CONFIGURACION, no sobre el rendimiento, y el
 * catalogo la respalda con `sem-primary-conversion-count` -- nunca con una
 * entrada de categoria "conversiones".
 *
 * Caso real: el run 31960785519 se rechazo por la frase "3 conversiones"
 * dentro de "Las 3 conversiones primarias configuradas...", que era un
 * recuento correcto y perfectamente verificable.
 *
 * Solo se aplica a la categoria "conversiones": una cifra de gasto o de
 * presupuesto no cambia de naturaleza por llevar esta palabra al lado.
 */
const CONVERSION_ACTION_QUALIFIER = /^\s*(?:primaria|principal|secundaria)/i;

/**
 * La palabra clave de la categoria NO puede estar pegada a un guion, un
 * guion bajo u otro caracter de palabra: si lo esta, forma parte de un
 * IDENTIFICADOR, no de una frase.
 *
 * Caso real (run 31966285132, y con toda probabilidad varios de los
 * rechazos anteriores por "CPC"): el prompt ORDENA al subagente citar la
 * entrada centinela `sem-cpc-not-available` cuando quiere decir que no
 * hay CPC. Al escribir "...(sem-cpc-not-available) y 0 clics...", el
 * patron de la categoria "cpc" enganchaba la subcadena `cpc` DENTRO del
 * id, saltaba el hueco "-not-available) y " y capturaba el "0" siguiente
 * como si fuera una cifra de CPC inventada. Es decir: seguir las
 * instrucciones al pie de la letra garantizaba el rechazo de la salida
 * entera. Lo mismo aplicaba a `sem-metrics-<i>-conversions`,
 * `sem-roas-not-available` y cualquier id que contenga una palabra clave.
 */
const KW_START = "(?<![\\w-])";
const KW_END = "(?![\\w-])";

const QUANT_CLAIM_CATEGORIES: QuantClaimCategory[] = [
  { id: "cpc", label: "CPC", pattern: new RegExp(`${KW_START}cpc${KW_END}${GAP}${NUM}`, "gi") },
  // Dos ordenes de frase: "12 conversiones" (numero primero, habitual en
  // metricas tabulares) Y "conversiones: 12" / "el numero de conversiones
  // fue de 12" (palabra clave primero) -- solo cubrir el primer orden
  // dejaba sin auditar cualquier afirmacion fabricada con el orden
  // inverso (detectado en code review).
  { id: "conversiones", label: "conversiones", pattern: new RegExp(`${NUM}\\s*${KW_START}conversion(?:es)?${KW_END}|${KW_START}conversion(?:es)?${KW_END}${GAP}${NUM}`, "gi") },
  { id: "roas", label: "ROAS", pattern: new RegExp(`${KW_START}roas${KW_END}${GAP}${NUM}`, "gi") },
  { id: "gasto", label: "gasto/coste", pattern: new RegExp(`${KW_START}(?:gasto|coste)${KW_END}${GAP}${NUM}\\s*€?`, "gi") },
  { id: "presupuesto", label: "presupuesto", pattern: new RegExp(`${KW_START}presupuesto${KW_END}${GAP}${NUM}\\s*€?`, "gi") },
];

/**
 * Interpretaciones numericas candidatas de un texto que "parece un
 * numero" en prosa espanola/europea. SIEMPRE incluye la interpretacion
 * directa (coma como separador decimal, punto como separador decimal si
 * no hay coma) -- la interpretacion "punto como separador de miles"
 * (p.ej. "1.320" -> 1320) SOLO se anade si el texto tiene la forma EXACTA
 * de agrupacion de miles (grupos de 3 digitos tras cada punto). Sin esta
 * restriccion, un decimal genuino con punto como "0.45" se leeria como
 * 45 (bug real detectado en code review: corrompia decimales legitimos y
 * podia hacer pasar una cifra fabricada que casualmente coincidiera con
 * un entero real no relacionado en cualquier otra parte del contexto).
 */
function numericCandidates(rawMatch: string): number[] {
  const trimmed = rawMatch.trim();
  const candidates: number[] = [];
  const direct = parseFloat(trimmed.replace(",", "."));
  if (Number.isFinite(direct)) candidates.push(direct);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) {
    const thousands = parseFloat(trimmed.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(thousands)) candidates.push(thousands);
  }
  return candidates;
}

/**
 * Busca, en el evidenceCatalog determinista, una entrada que coincida
 * EXACTAMENTE (id + contextField + value, los 3 campos) con una entrada
 * de `evidence[]` del output. `undefined` si no hay ninguna coincidencia
 * exacta -- el subagente solo puede copiar entradas del catalogo tal
 * cual, nunca inventar una nueva ni modificar un campo de una existente
 * (ni siquiera un espacio o un decimal distinto).
 */
function findCatalogMatch(item: SemEvidenceItem, catalog: SemEvidenceCatalogItem[]): SemEvidenceCatalogItem | undefined {
  return catalog.find((c) => c.id === item.id && c.contextField === item.contextField && c.value === item.value);
}

/**
 * Busca, dentro de un conjunto de candidatas ya resuelto (ver
 * resolveClaimCandidateEntries()), una entrada cuyo value coincida con la
 * cifra capturada en el texto -- misma logica de comparacion que antes
 * (substring directo + comparacion numerica via numericCandidates(), para
 * tolerar formato coma/punto y con/sin decimales entre el catalogo y la
 * prosa de salida).
 */
function findMatchingCatalogEntry(numberRaw: string, candidates: SemEvidenceCatalogItem[]): SemEvidenceCatalogItem | undefined {
  return candidates.find((c) => c.value.includes(numberRaw) || numericCandidates(numberRaw).some((n) => String(n) === c.value));
}

// El catalogo NUNCA tiene una entrada NUMERICA de estas 2 categorias --
// solo el centinela "not_available" (ver buildSemEvidenceCatalog()) --
// asi que, a diferencia de gasto/presupuesto/conversiones, aqui NO se
// puede confiar en "cualquier entrada citada cuyo value coincida":
// siempre se exige ademas que esa entrada sea REALMENTE de categoria
// "cpc"/"roas". Sin esta excepcion, una cifra de CPC fabricada podria
// "colarse" citando una entrada real pero completamente ajena (p.ej. un
// recuento de campanas) solo porque el numero coincide por casualidad
// (misattribution real, cubierta por un test de regresion propio).
const CATEGORIES_WITHOUT_REAL_NUMERIC_DATA = new Set<SemEvidenceCategory>(["cpc", "roas"]);

/**
 * Resuelve el conjunto de entradas del catalogo contra las que se puede
 * verificar una cifra de una categoria dada, a partir del pool de
 * partida (ver auditSemSpecialistOutputForUnsupportedClaims()):
 *  - "cpc"/"roas": se restringe SIEMPRE a entradas de esa misma categoria
 *    exacta (nunca hay ninguna numerica -- ver
 *    CATEGORIES_WITHOUT_REAL_NUMERIC_DATA).
 *  - resto de categorias (conversiones/gasto/presupuesto): se acepta
 *    cualquier entrada del pool, sea cual sea su categoria real. La
 *    categoria que QUANT_CLAIM_CATEGORIES detecto por proximidad textual
 *    es solo una senal de "aqui podria haber una afirmacion cuantitativa
 *    que auditar", nunca una exigencia sobre que campo real la respalda
 *    -- exigir la MISMA categoria fue justo lo que causo el falso
 *    positivo del run 31888764722 ("...sin gasto real registrado. Si se
 *    activaran las 7 campañas..." capturaba el "7" de "campañas" -- una
 *    cifra real y correctamente citada, solo que sobre un tema distinto
 *    al que la palabra "gasto" vecina sugeria).
 */
function resolveClaimCandidateEntries(categoryId: string, pool: SemEvidenceCatalogItem[]): SemEvidenceCatalogItem[] {
  if (CATEGORIES_WITHOUT_REAL_NUMERIC_DATA.has(categoryId as SemEvidenceCategory)) {
    return pool.filter((c) => c.category === categoryId);
  }
  return pool;
}

interface ClaimText {
  field: string;
  text: string;
  evidenceRefs: string[];
  /**
   * false para "summary" (string plano de SemSpecialistOutput, sin
   * evidenceRefs propio) -- estructuralmente no puede citar una entrada
   * concreta del catalogo. true para findings/experimentos, que si
   * tienen su propio evidenceRefs[].
   */
  canCiteEvidence: boolean;
}

function collectClaimTexts(output: SemSpecialistOutput): ClaimText[] {
  const items: ClaimText[] = [{ field: "summary", text: output.summary, evidenceRefs: [], canCiteEvidence: false }];

  for (const field of FINDING_FIELDS) {
    for (const f of output[field]) {
      items.push({ field: `${field}: ${f.title}`, text: `${f.title}. ${f.description}`, evidenceRefs: f.evidenceRefs, canCiteEvidence: true });
    }
  }
  for (const e of output.prioritizedExperiments) {
    items.push({ field: `prioritizedExperiments: ${e.title}`, text: `${e.title}. ${e.hypothesis} ${e.expectedImpact}`, evidenceRefs: e.evidenceRefs, canCiteEvidence: true });
  }
  return items;
}

/**
 * Resultado de la auditoria, separado en dos severidades DISTINTAS.
 *
 * POR QUE SE SEPARAN (diferencia estructural real frente a SEO/Analytics/
 * Content, y causa de que SEM fuera el unico especialista que perdia
 * pasadas enteras): hasta ahora CUALQUIER hallazgo de esta auditoria
 * tiraba la salida COMPLETA a `invalid_output`. Los otros tres
 * especialistas emiten `auditWarnings` y siguen contando como
 * `executed` -- en la pasada 31961151666, analytics emitio 5 avisos y
 * content 1, y ambos entregaron su analisis.
 *
 * Pero "SEM no inventa cifras" y "SEM cito mal una cifra REAL" no son el
 * mismo problema:
 *
 * - `fabricatedClaims`: la cifra NO existe en el evidenceCatalog. Es
 *   exactamente lo que la mision del empleado prohibe ("NO inventa CPC,
 *   conversiones, ROAS ni gasto"). Sigue siendo un fallo DURO: la salida
 *   entera se descarta, sin excepciones.
 * - `uncitedClaims`: la cifra SI existe en el catalogo -- es un dato real
 *   de la cuenta -- pero la afirmacion concreta no listo su `id` en su
 *   propio `evidenceRefs`. Eso es higiene de citacion, no fabricacion:
 *   tirar por eso un analisis con decenas de hallazgos correctos hacia
 *   que el departamento perdiera SEM de forma intermitente (2026-08-16:
 *   la pasada 31961151666 salio con 0 y la 31962578324 con 1, con el
 *   mismo codigo y la misma cuenta). Se reporta como AVISO, visible en
 *   el artifact y en el brief, y no descarta nada.
 */
export interface SemClaimAudit {
  fabricatedClaims: string[];
  uncitedClaims: string[];
}

/**
 * Auditoria completa. Ver SemClaimAudit para la diferencia entre las dos
 * severidades y por que existe.
 */
export function auditSemSpecialistOutput(context: SemSpecialistContext, output: SemSpecialistOutput): SemClaimAudit {
  const catalog = context.evidenceCatalog;
  const violations: string[] = [];
  const uncited: string[] = [];

  // Cada entrada de evidence[] debe coincidir EXACTAMENTE (id+contextField+value)
  // con una entrada del evidenceCatalog determinista -- nunca una
  // aproximacion, nunca un valor "parecido". Solo las entradas que SI
  // coinciden quedan disponibles para respaldar afirmaciones cuantitativas
  // mas abajo (evidenceCatalogMatchById).
  const evidenceCatalogMatchById = new Map<string, SemEvidenceCatalogItem>();
  const seenIds = new Set<string>();
  for (const item of output.evidence) {
    if (seenIds.has(item.id)) {
      violations.push(`evidence duplicada: el id "${item.id}" aparece mas de una vez en evidence[].`);
    }
    seenIds.add(item.id);
    const match = findCatalogMatch(item, catalog);
    if (!match) {
      violations.push(
        `evidence no coincide EXACTAMENTE con ninguna entrada del evidenceCatalog determinista: id="${item.id}" contextField="${item.contextField}" value="${item.value}" -- evidence[] solo puede reutilizar id/contextField/value tal cual del evidenceCatalog entregado en el contexto, nunca inventar ni modificar una entrada.`
      );
    } else {
      evidenceCatalogMatchById.set(item.id, match);
    }
  }

  for (const claim of collectClaimTexts(output)) {
    // Pool de partida antes de aplicar resolveClaimCandidateEntries():
    // para findings/experimentos, SOLO las entradas CITADAS
    // explicitamente por este claim (claim.evidenceRefs) y verificadas
    // exactamente contra el catalogo; para "summary" (que no puede
    // citar), el catalogo COMPLETO -- ver cabecera de esta seccion.
    const citedEntries = claim.canCiteEvidence
      ? claim.evidenceRefs.map((refId) => evidenceCatalogMatchById.get(refId)).filter((entry): entry is SemEvidenceCatalogItem => entry !== undefined)
      : [];
    const pool = claim.canCiteEvidence ? citedEntries : catalog;

    for (const category of QUANT_CLAIM_CATEGORIES) {
      const matches = [...claim.text.matchAll(category.pattern)];
      for (const match of matches) {
        // match[1] o match[2] segun la rama de la alternativa que haya
        // capturado (algunas categorias, p.ej. "conversiones", admiten
        // dos ordenes de frase -- ver QUANT_CLAIM_CATEGORIES).
        const numberRaw = match[1] ?? match[2];
        if (!numberRaw) continue;

        // La cifra lleva pegada una unidad de tiempo ("30 dias"): es la
        // duracion de la ventana de metricas, no una afirmacion de esta
        // categoria -- y no existe ninguna entrada de catalogo que pudiera
        // respaldarla. Ver DURATION_UNIT_AFTER_NUMBER.
        const matchEnd = (match.index ?? 0) + match[0].length;
        const tail = claim.text.slice(matchEnd, matchEnd + UNIT_LOOKAHEAD_CHARS);
        if (DURATION_UNIT_AFTER_NUMBER.test(tail)) continue;

        // "3 conversiones primarias" cuenta acciones configuradas, no
        // conversiones medidas. Ver CONVERSION_ACTION_QUALIFIER.
        if (category.id === "conversiones" && CONVERSION_ACTION_QUALIFIER.test(tail)) continue;

        const candidates = resolveClaimCandidateEntries(category.id, pool);
        if (findMatchingCatalogEntry(numberRaw, candidates)) continue;

        // La cifra no esta respaldada por lo que ESTA afirmacion cita.
        // Antes de tratarlo como fabricacion hay que mirar el catalogo
        // COMPLETO (con la misma restriccion de categoria para cpc/roas):
        // si la cifra existe ahi, es un dato REAL de la cuenta mal citado,
        // no un numero inventado. Ver SemClaimAudit.
        const existsInCatalog = findMatchingCatalogEntry(numberRaw, resolveClaimCandidateEntries(category.id, catalog));

        if (existsInCatalog) {
          uncited.push(
            `Afirmacion cuantitativa (${category.label}) "${match[0].trim()}" en "${claim.field}": la cifra es REAL (coincide con "${existsInCatalog.id}" del evidenceCatalog) pero esa entrada NO aparece en el evidenceRefs de esta afirmacion. No es fabricacion -- es una cita que falta. Anade "${existsInCatalog.id}" a evidenceRefs (y copia la entrada a evidence[]) para que la trazabilidad quede completa.`
          );
          continue;
        }

        violations.push(
          `Afirmacion cuantitativa SIN RESPALDO (${category.label}): "${match[0].trim()}" en "${claim.field}" -- ese numero no aparece en NINGUNA entrada del evidenceCatalog del snapshot suministrado. Prohibido inventar CPC/conversiones/ROAS/gasto/presupuesto (para CPC/ROAS, cuando el catalogo solo trae la entrada "not_available", ninguna cifra numerica de esas categorias puede tener respaldo).`
        );
      }
    }
  }

  return { fabricatedClaims: violations, uncitedClaims: uncited };
}

/**
 * Compatibilidad: solo las violaciones DURAS (cifras fabricadas). Las
 * citas que faltan se obtienen con `auditSemSpecialistOutput()`.
 */
export function auditSemSpecialistOutputForUnsupportedClaims(context: SemSpecialistContext, output: SemSpecialistOutput): string[] {
  return auditSemSpecialistOutput(context, output).fabricatedClaims;
}

// --- Resultado del runner + artefacto -------------------------------------

export type SemRunnerStatus = "no_data" | "pending_execution" | "executed" | "invalid_output";

export type SemResult =
  | { status: "no_data" }
  | { status: "pending_execution"; promptFilePath: string }
  | { status: "invalid_output"; error: string; rawOutputPath: string; violations: string[] }
  | { status: "executed"; output: SemSpecialistOutput; uncitedClaims: string[] };

/**
 * Contrato machine-readable que imprime el runner al final de cada
 * ejecucion (linea `RUNNER_RESULT_JSON=...`, ver
 * scripts/run-sem-specialist.ts). Estructura FIJA e IDENTICA en los 4
 * estados posibles de `status` -- mismo principio que
 * `RunnerResultSummary` de landing-architect-comparison.ts.
 */
export interface SemRunnerResultSummary {
  status: SemRunnerStatus;
  sourceEventId: string;
  sourceDepartmentRunId: string;
  promptFilePath: string;
  expectedOutputPath: string;
  artifactJsonPath: string;
  artifactMdPath: string;
  /** null salvo que status sea "executed" (siempre 0 en ese caso -- una cifra FABRICADA fuerza invalid_output) o "invalid_output" (numero real de cifras fabricadas). */
  unsupportedClaimCount: number | null;
  /**
   * Citas que faltan: cifras REALES del catalogo que su afirmacion no
   * referencio en evidenceRefs. Son AVISOS, nunca descartan la salida
   * (ver SemClaimAudit). null salvo en "executed"/"invalid_output".
   */
  uncitedClaimCount: number | null;
  /**
   * TEXTO de cada cifra fabricada (recortado). Sin esto, un rechazo solo
   * dejaba el RECUENTO en el log y en el brief, y el detalle vivia
   * unicamente dentro del artifact -- que no siempre es descargable desde
   * donde se opera el departamento. Diagnosticar un rechazo obligaba a
   * repetir la ejecucion entera (caso real: pasada 31964790892).
   */
  unsupportedClaims: string[];
}

/** Recorta cada violacion para que la linea RUNNER_RESULT_JSON siga siendo manejable en un log. */
function truncateClaim(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}

export function buildSemRunnerResultSummary(
  context: SemSpecialistContext | null,
  paths: { promptFilePath: string; expectedOutputPath: string; artifactJsonPath: string; artifactMdPath: string },
  result: SemResult
): SemRunnerResultSummary {
  const noData = result.status === "no_data";
  return {
    status: result.status,
    sourceEventId: context?.sourceEventId ?? "",
    sourceDepartmentRunId: context?.sourceDepartmentRunId ?? "",
    promptFilePath: noData ? "" : paths.promptFilePath,
    expectedOutputPath: noData ? "" : paths.expectedOutputPath,
    artifactJsonPath: paths.artifactJsonPath,
    artifactMdPath: paths.artifactMdPath,
    unsupportedClaimCount: result.status === "invalid_output" ? result.violations.length : result.status === "executed" ? 0 : null,
    uncitedClaimCount: result.status === "executed" ? result.uncitedClaims.length : result.status === "invalid_output" ? 0 : null,
    unsupportedClaims: result.status === "invalid_output" ? result.violations.map((v) => truncateClaim(v)) : [],
  };
}

export interface SemSpecialistArtifact {
  generatedAt: string;
  context: SemSpecialistContext | null;
  result: SemResult;
  note: string;
}

const ARTIFACT_NOTE =
  "Artefacto de solo lectura/propuesta. sem-specialist NUNCA modifica campanas, presupuestos, keywords ni anuncios de Google Ads -- este artefacto es una propuesta para revision humana, no una accion ejecutada.";

export function buildSemSpecialistArtifact(context: SemSpecialistContext | null, result: SemResult): SemSpecialistArtifact {
  return {
    generatedAt: new Date().toISOString(),
    context,
    result,
    note: ARTIFACT_NOTE,
  };
}

function fmtFindings(heading: string, findings: SemFinding[]): string[] {
  const lines: string[] = [`## ${heading} (${findings.length})`, ""];
  if (findings.length === 0) {
    lines.push("(ninguno)");
  } else {
    for (const f of findings) {
      lines.push(`- **[${f.severity}] ${f.title}** -- ${f.description} (evidencia: ${f.evidenceRefs.join(", ") || "ninguna"})`);
    }
  }
  lines.push("");
  return lines;
}

export function renderSemSpecialistMarkdown(artifact: SemSpecialistArtifact): string {
  const lines: string[] = [];
  lines.push(`# SEM Specialist — ${artifact.generatedAt}`);
  lines.push("");

  if (!artifact.context) {
    lines.push(
      "**Estado: sin datos SEM disponibles (no_data).** No existe ningun evento `sem-watcher` de tipo `agent_finished` en `data/department-events.jsonl` todavia. Este empleado NUNCA razona sin una lectura previa real (o documentada como fallback) de sem-watcher -- no se ha generado ninguna propuesta, y no se ha invocado a Claude."
    );
    lines.push("");
    lines.push(`_${artifact.note}_`);
    lines.push("");
    return lines.join("\n");
  }

  const c = artifact.context;
  lines.push(`- **Fuente:** evento sem-watcher \`${c.sourceEventId}\` (departmentRunId \`${c.sourceDepartmentRunId}\`, generado ${c.sourceGeneratedAt})`);
  lines.push(`- **Conectado a Google Ads real en ese momento:** ${c.connectedToGoogleAdsAtSourceTime ? "si" : "no"}`);
  lines.push(`- **Campana principal:** ${c.campaignName || "(desconocida)"} (${c.campaignStatus || "?"})`);
  lines.push("");
  lines.push("**No se ha aplicado ninguna propuesta a Google Ads. sem-specialist es solo lectura/propuesta.**");
  lines.push("");

  if (artifact.result.status === "pending_execution") {
    lines.push(`**Estado: pendiente de ejecucion.** Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("- Para completar el analisis: invocar el subagente `sem-specialist` con ese prompt y volver a ejecutar este runner con `--sem-specialist-output <fichero-json-de-respuesta>`.");
    lines.push("");
  } else if (artifact.result.status === "invalid_output") {
    lines.push(`**Estado: salida invalida.** ${artifact.result.error}`);
    lines.push(`- Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
    if (artifact.result.violations.length > 0) {
      lines.push("");
      lines.push(`**Violaciones de afirmaciones cuantitativas sin respaldo (${artifact.result.violations.length}):**`);
      for (const v of artifact.result.violations) lines.push(`- ${v}`);
    }
    lines.push("");
  } else if (artifact.result.status === "executed") {
    const o = artifact.result.output;
    if (artifact.result.uncitedClaims.length > 0) {
      // Avisos, NO un rechazo: la cifra es real, solo falta su cita. Se
      // muestran arriba del todo para que se corrijan, sin tirar el
      // analisis (ver SemClaimAudit).
      lines.push(`**Avisos de citacion (${artifact.result.uncitedClaims.length}) -- cifras REALES del snapshot que su afirmacion no cito en evidenceRefs. Ninguna es una cifra inventada:**`);
      for (const w of artifact.result.uncitedClaims) lines.push(`- ${w}`);
      lines.push("");
    }
    lines.push("## Resumen");
    lines.push("");
    lines.push(o.summary);
    lines.push("");
    lines.push(...fmtFindings("Campaign findings", o.campaignFindings));
    lines.push(...fmtFindings("Search-term / keyword opportunities", o.searchTermOpportunities));
    lines.push(...fmtFindings("Negative keyword recommendations", o.negativeKeywordRecommendations));
    lines.push(...fmtFindings("Budget observations", o.budgetObservations));
    lines.push(...fmtFindings("Bidding observations", o.biddingObservations));
    lines.push(...fmtFindings("Ad / landing alignment", o.adLandingAlignment));
    lines.push(...fmtFindings("Conversion-risk findings", o.conversionRiskFindings));

    lines.push(`## Prioritized experiments (${o.prioritizedExperiments.length})`);
    lines.push("");
    if (o.prioritizedExperiments.length === 0) {
      lines.push("(ninguno)");
    } else {
      for (const e of o.prioritizedExperiments) {
        lines.push(`- **[${e.priority}] ${e.title}** -- hipotesis: ${e.hypothesis}. Impacto esperado: ${e.expectedImpact}. (evidencia: ${e.evidenceRefs.join(", ") || "ninguna"})`);
      }
    }
    lines.push("");

    lines.push(`## Evidence (${o.evidence.length})`);
    lines.push("");
    if (o.evidence.length === 0) {
      lines.push("(ninguna)");
    } else {
      for (const ev of o.evidence) lines.push(`- \`${ev.id}\`: ${ev.contextField} = ${ev.value}`);
    }
    lines.push("");

    lines.push(`## Unknowns (${o.unknowns.length})`);
    lines.push("");
    if (o.unknowns.length === 0) {
      lines.push("(ninguno declarado)");
    } else {
      for (const u of o.unknowns) lines.push(`- ${u}`);
    }
    lines.push("");
  }

  lines.push(`_${artifact.note}_`);
  lines.push("");
  return lines.join("\n");
}
