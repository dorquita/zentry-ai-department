import { ApprovalRequest, BacklogAction, BrandTarget, Priority, WorkOrder } from "./types";
import { categorizeActionType } from "./work-orders";
import { OpportunityState, OPPORTUNITY_STATE_LABELS } from "./opportunity-state";

/**
 * Executive Report Builder — capa de curacion sobre el Action Backlog
 * pensada para un lector NO tecnico (el responsable del departamento),
 * no para depuracion. Funciones puras: no leen ni escriben nada en disco
 * (eso lo hace growth-director.ts). No cambia ni decide autonomia — solo
 * agrupa, deduplica y redacta lo que YA decidieron autonomy-policy.ts y
 * notification-policy.ts.
 *
 * Principios:
 * - Agrupar por pagina E intencion, fusionando singular/plural/variantes
 *   y fusionando tambien acciones sin pagina que compartan el mismo tema
 *   con una accion que SI tiene pagina (nunca dos "conclusiones" para el
 *   mismo tema por venir de acciones con/sin pagina o de marcas distintas).
 * - Nunca mostrar mas de un puñado de acciones (preferible 3-4 claras a
 *   88 internas).
 * - Nunca afirmar que se ejecuto algo que solo se preparo o recomendo.
 * - Nunca mostrar UUID, rutas de servidor, comandos npm ni variables de
 *   entorno.
 * - Ser honesto sobre el origen de cada dato: solo se habla de "demanda
 *   real" cuando hay evidencia real de Search Console; una oportunidad
 *   basada solo en competidores es SIEMPRE una estimacion pendiente de
 *   validar, nunca un dato confirmado.
 * - Atribuir una posicion de Search Console SIEMPRE a Zentry (es la unica
 *   propiedad conectada, zentrylockers.com) — nunca a "Zentry y
 *   Tukandado", aunque la oportunidad tambien pueda beneficiar a
 *   Tukandado (eso se dice aparte, como nota secundaria).
 * - Separar siempre trabajo nuevo de hoy de oportunidades que ya venian
 *   de dias anteriores, y dejarlo explicito incluso cuando lo nuevo de
 *   hoy es cero.
 * - Si el departamento recomienda una accion prioritaria, esa
 *   recomendacion ES una decision pendiente del responsable (aprobar,
 *   aplazar o rechazar) — nunca "no hay decisiones pendientes" cuando SI
 *   hay acciones prioritarias esperando publicarse.
 */

// --- Normalizacion de keywords (agrupar singular/plural/variantes) ---

const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(DIACRITICS_RE, "");
}

// Palabras de relleno que no aportan a la identidad del tema (para poder
// tratar "taquillas de melamina" y "taquillas melamina" como el mismo
// tema). Deliberadamente pequeño y conservador.
const SPANISH_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "para", "en", "con", "por", "sin",
  "y", "o", "a", "al", "un", "una", "unos", "unas", "que", "se",
]);

/**
 * Heuristica de singularizacion en espanol, deliberadamente simple (no
 * pretende ser un lematizador completo): quita la "s" final, o "es" si la
 * raiz resultante termina en consonante (hoteles->hotel, colegios->colegio,
 * taquillas->taquilla). Palabras muy cortas se dejan intactas para no
 * mutilar terminos de 3-4 letras.
 */
function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("es")) {
    const stem = token.slice(0, -2);
    if (/[bcdfghjklmnpqrstvwxyz]$/.test(stem)) return stem;
  }
  if (token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenize(keyword: string): string[] {
  const cleaned = stripDiacritics(keyword.trim().toLowerCase()).replace(/[^a-z0-9\s]/g, " ");
  return cleaned.split(/\s+/).filter(Boolean);
}

/**
 * Clave canonica para agrupar keywords equivalentes: minusculas, sin
 * acentos, sin palabras de relleno, singularizadas y ordenadas
 * alfabeticamente (para que el orden de las palabras no importe).
 * "taquillas de melamina" y "taquillas melamina" producen la misma clave.
 */
export function normalizeKeywordForGrouping(keyword: string): string {
  const tokens = tokenize(keyword).filter((t) => !SPANISH_STOPWORDS.has(t));
  const singularized = tokens.map(singularizeToken);
  return [...new Set(singularized)].sort().join(" ");
}

// Palabras que, al final de una keyword, delatan un fragmento incompleto
// de autocompletado ("cerradura para", "comprar taquillas para"). Incluye
// articulos porque un articulo colgando al final SIEMPRE es una frase
// incompleta ("taquillas para el").
const DANGLING_TRAILING_WORDS = new Set([
  "para", "con", "de", "del", "en", "por", "sin", "y", "o", "a", "al", "la", "el", "los", "las",
]);

// Solo preposiciones/conjunciones (SIN articulos) para el chequeo al
// PRINCIPIO de la keyword ("para vestuarios" es un fragmento; "la mejor
// taquilla" es una frase valida en espanol, un articulo inicial es normal).
const DANGLING_LEADING_WORDS = new Set(["para", "con", "de", "del", "en", "por", "sin", "y", "o", "a", "al"]);

/**
 * true si la keyword parece un fragmento incompleto/de baja calidad (no
 * una busqueda real terminada) y por tanto no deberia presentarse como
 * oportunidad sin revision manual. Heuristica deliberadamente
 * conservadora: solo detecta el caso claro de preposicion/conjuncion
 * colgando al principio o al final ("cerradura para", "para vestuarios").
 * No detecta todos los casos posibles (p.ej. dos sustantivos sueltos como
 * "oficinas taquillas") — esos quedan para revision humana, documentado
 * como limitacion conocida.
 */
export function isLowQualityKeywordFragment(keyword: string): boolean {
  const tokens = tokenize(keyword);
  if (tokens.length === 0) return true;
  if (tokens.length < 2) return true;
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  return DANGLING_LEADING_WORDS.has(first) || DANGLING_TRAILING_WORDS.has(last);
}

// Keyword generica + sufijo geografico de una sola palabra ("... en
// palencia") con muy poca demanda medida: nicho geografico sin validar,
// no una prioridad estrategica hasta confirmar que el mercado es real.
const GEO_SUFFIX_RE = /\ben\s+[a-z]+$/i;
const MIN_VALIDATED_GEO_IMPRESSIONS = 15;

function evidenceNumber(action: BacklogAction, key: string): number | undefined {
  const value = action.evidence?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * true si la keyword tiene forma de oportunidad de nicho geografico
 * ("taquillas fenolicas en Palencia") sin demanda real suficiente para
 * justificar tratarla como prioridad estrategica. No se excluye si hay
 * evidencia de que el mercado si tiene demanda (>= 15 impresiones reales).
 */
export function isUnvalidatedGeoFragment(action: BacklogAction): boolean {
  if (!GEO_SUFFIX_RE.test(stripDiacritics(action.keyword.trim().toLowerCase()))) return false;
  const impressions = evidenceNumber(action, "totalImpressions");
  return impressions === undefined || impressions < MIN_VALIDATED_GEO_IMPRESSIONS;
}

// --- Atribucion de marca ---

const BRAND_LABELS: Record<BrandTarget, string> = {
  zentry: "Zentry",
  tukandado: "Tukandado",
  both: "Zentry y Tukandado",
  none: "el departamento",
};

interface BrandAttribution {
  primaryLabel: string;
  secondaryNote?: string;
}

/**
 * Decide a quien se atribuye una oportunidad. Regla no negociable: si hay
 * evidencia real de Search Console (currentPosition), la propiedad medida
 * es SIEMPRE zentrylockers.com, asi que el sujeto de "aparece en Google"
 * es SIEMPRE "Zentry", nunca un compuesto "Zentry y Tukandado" (eso seria
 * gramatical Y factualmente incorrecto: Tukandado no tiene una propiedad
 * de Search Console propia conectada). Si la oportunidad tambien es
 * relevante para Tukandado, se anade como nota secundaria aparte.
 */
function computeBrandAttribution(actions: BacklogAction[], hasRealSeoEvidence: boolean): BrandAttribution {
  if (hasRealSeoEvidence) {
    const alsoTukandado = actions.some((a) => a.targetBrand === "tukandado" || a.targetBrand === "both");
    return {
      primaryLabel: "Zentry",
      secondaryNote: alsoTukandado ? "Esta oportunidad tambien podria beneficiar a Tukandado." : undefined,
    };
  }
  const targets = new Set(actions.map((a) => a.targetBrand));
  const primary: BrandTarget = targets.has("both") || (targets.has("zentry") && targets.has("tukandado"))
    ? "both"
    : targets.has("zentry")
      ? "zentry"
      : targets.has("tukandado")
        ? "tukandado"
        : "none";
  return { primaryLabel: BRAND_LABELS[primary] };
}

// --- Agrupacion por pagina e intencion (o por tema, si no hay pagina) ---

export interface PageCluster {
  page?: string;
  representativeKeyword: string;
  actions: BacklogAction[];
  priority: Priority;
  currentPosition?: number;
  totalImpressions?: number;
  isNewToday: boolean;
  brandPrimaryLabel: string;
  brandSecondaryNote?: string;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

function clusterFromActions(groupActions: BacklogAction[], dateLabel: string): PageCluster {
  const sorted = [...groupActions].sort((a, b) => {
    const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (rankDiff !== 0) return rankDiff;
    return (evidenceNumber(b, "totalImpressions") ?? 0) - (evidenceNumber(a, "totalImpressions") ?? 0);
  });
  // Preferir como representante (para el titulo/pagina mostrados) una
  // accion CON pagina, si alguna la tiene: es la que define "donde" esta
  // realmente la oportunidad.
  const representative = sorted.find((a) => a.page) ?? sorted[0];
  const priority = sorted.reduce<Priority>(
    (max, a) => (PRIORITY_RANK[a.priority] > PRIORITY_RANK[max] ? a.priority : max),
    "low"
  );
  const seoWithPosition = sorted.find(
    (a) => a.actionType.startsWith("seo:") && evidenceNumber(a, "currentPosition") !== undefined
  );
  const isNewToday = sorted.every((a) => a.createdAt.slice(0, 10) === dateLabel && a.seenCount === 1);
  const brand = computeBrandAttribution(sorted, Boolean(seoWithPosition));

  return {
    page: representative.page,
    representativeKeyword: representative.keyword,
    actions: sorted,
    priority,
    currentPosition: seoWithPosition ? evidenceNumber(seoWithPosition, "currentPosition") : undefined,
    totalImpressions: seoWithPosition ? evidenceNumber(seoWithPosition, "totalImpressions") : undefined,
    isNewToday,
    brandPrimaryLabel: brand.primaryLabel,
    brandSecondaryNote: brand.secondaryNote,
  };
}

function clusterComparator(a: PageCluster, b: PageCluster): number {
  const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (rankDiff !== 0) return rankDiff;
  return (b.totalImpressions ?? 0) - (a.totalImpressions ?? 0);
}

/**
 * Agrupa acciones del backlog por pagina Y por intencion, en dos fases:
 *
 * 1. Todas las acciones CON pagina se agrupan por esa pagina exacta (sin
 *    la marca como criterio de particion — la marca es un atributo
 *    derivado, nunca una razon para duplicar la misma pagina).
 * 2. Las acciones SIN pagina se fusionan dentro del cluster de pagina que
 *    ya cubra el mismo tema (mismo keyword normalizado), si existe — asi
 *    "cerraduras inteligentes para centros deportivos" con pagina y sin
 *    pagina (y con marcas distintas) terminan en un UNICO cluster en vez
 *    de dos. Si no hay ninguna pagina con ese tema, las acciones sin
 *    pagina se agrupan entre si por tema normalizado.
 *
 * Fusiona ademas variantes singular/plural/con-o-sin-preposicion de la
 * misma keyword. Ordenado de mas a menos relevante (prioridad y, dentro
 * de la misma prioridad, impresiones reales de Search Console si las hay).
 */
export function buildPageClusters(actions: BacklogAction[], dateLabel: string): PageCluster[] {
  const withPage = actions.filter((a) => a.page);
  const withoutPage = actions.filter((a) => !a.page);

  const pageGroups = new Map<string, BacklogAction[]>();
  for (const action of withPage) {
    const key = action.page as string;
    const list = pageGroups.get(key) ?? [];
    list.push(action);
    pageGroups.set(key, list);
  }

  const topicToPage = new Map<string, string>();
  for (const [page, groupActions] of pageGroups.entries()) {
    for (const action of groupActions) {
      const topic = normalizeKeywordForGrouping(action.keyword);
      if (!topicToPage.has(topic)) topicToPage.set(topic, page);
    }
  }

  const topicOnlyGroups = new Map<string, BacklogAction[]>();
  for (const action of withoutPage) {
    const topic = normalizeKeywordForGrouping(action.keyword);
    const matchingPage = topicToPage.get(topic);
    if (matchingPage) {
      pageGroups.get(matchingPage)!.push(action);
      continue;
    }
    const list = topicOnlyGroups.get(topic) ?? [];
    list.push(action);
    topicOnlyGroups.set(topic, list);
  }

  const allGroups = [...pageGroups.values(), ...topicOnlyGroups.values()];
  return allGroups.map((groupActions) => clusterFromActions(groupActions, dateLabel)).sort(clusterComparator);
}

// --- Sanitizado: nunca dejar pasar nombres de variables de entorno ---

// Cualquier token en MAYUSCULAS_CON_GUION_BAJO (2+ segmentos) es, en la
// practica, siempre un nombre de variable de entorno en este proyecto
// (TELEGRAM_BOT_TOKEN, GOOGLE_ADS_DEVELOPER_TOKEN...) y nunca una palabra
// de espanol natural. Se usa como red de seguridad ademas de la
// redaccion cuidada de cada seccion.
const ENV_VAR_TOKEN_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

function stripEnvVarTokens(text: string): string {
  return text.replace(ENV_VAR_TOKEN_RE, "");
}

function sanitizeWarningText(text: string): string {
  return stripEnvVarTokens(text)
    .replace(/\(\s*,*\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// --- Redaccion de contenido ---

function capitalizeFirst(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function priorityLabel(priority: Priority): string {
  return priority === "high" ? "Alta" : priority === "medium" ? "Media" : "Baja";
}

function estimateEffortLabel(cluster: PageCluster): string {
  const efforts = cluster.actions.map((a) => a.effort).filter((e): e is string => Boolean(e));
  if (efforts.includes("high")) return "Alto";
  if (efforts.length > 0 && efforts.every((e) => e === "low")) return "Bajo";
  if (efforts.includes("medium")) return "Medio";
  if (!cluster.page) return "Alto";
  return "Medio";
}

function buildRecommendationSentence(cluster: PageCluster): string {
  const categories = new Set(cluster.actions.map((a) => categorizeActionType(a.actionType)));
  const fragments: string[] = [];

  fragments.push(
    cluster.page
      ? "optimizar el title, la meta description y el contenido de la pagina existente"
      : "crear una nueva pagina dedicada a este tema"
  );
  if (categories.has("cro")) {
    fragments.push("revisar la llamada a la accion y el formulario de contacto de la pagina");
  }
  if (categories.has("competitor_gap") && !cluster.page) {
    fragments.push("priorizarlo porque la competencia ya lo cubre y la web todavia no");
  }
  if (categories.has("sem")) {
    fragments.push("revisar la campana de anuncios relacionada, sin activarla");
  }
  if (categories.has("analytics")) {
    fragments.push("validar que la medicion de esta pagina funciona correctamente");
  }

  return capitalizeFirst(fragments.join("; ")) + ".";
}

function detectedSentence(cluster: PageCluster): string {
  if (cluster.currentPosition !== undefined) {
    const base = `${cluster.brandPrimaryLabel} aparece actualmente alrededor de la posicion ${Math.round(cluster.currentPosition)} en Google para esta busqueda (dato real de Search Console)`;
    const withImpressions =
      cluster.totalImpressions !== undefined && cluster.totalImpressions > 0
        ? `${base}, con demanda de busqueda real (aproximadamente ${Math.round(cluster.totalImpressions)} impresiones en el ultimo mes).`
        : `${base}.`;
    return cluster.brandSecondaryNote ? `${withImpressions} ${cluster.brandSecondaryNote}` : withImpressions;
  }
  if (cluster.actions.some((a) => a.actionType.startsWith("competitor:"))) {
    return `La competencia ya cubre este tema y ${cluster.brandPrimaryLabel} todavia no tiene contenido especifico. La demanda real esta pendiente de validar (estimacion basada en el analisis de paginas de competidores, no en datos de Google).`;
  }
  return `Se ha detectado una oportunidad de mejora relacionada con este tema para ${cluster.brandPrimaryLabel}. La demanda real esta pendiente de validar (analisis interno, no un dato de trafico confirmado).`;
}

function whyItMattersSentence(cluster: PageCluster): string {
  const hasRealEvidence = cluster.currentPosition !== undefined;
  if (cluster.priority === "high") {
    return hasRealEvidence
      ? "Es una de las oportunidades con mas potencial: hay volumen de busqueda real (dato de Search Console) y margen claro de mejora."
      : "Es una de las oportunidades mejor valoradas hoy, aunque la demanda todavia esta pendiente de validar con datos propios.";
  }
  if (cluster.priority === "medium") {
    return hasRealEvidence
      ? "Tiene un potencial razonable de mejora, con datos reales de busqueda, aunque no es la maxima prioridad ahora mismo."
      : "Tiene un potencial razonable, pendiente de validar con datos propios; no es la maxima prioridad ahora mismo.";
  }
  return "Es una mejora menor: util, pero no urgente.";
}

function stageNote(cluster: PageCluster, workOrders: WorkOrder[]): string {
  if (cluster.isNewToday) return "Detectado por primera vez hoy.";
  const actionIds = new Set(cluster.actions.map((a) => a.actionId));
  const preparedStatuses = new Set(["auto_prepared", "ready_for_review", "approved_to_prepare"]);
  const hasPreparedWorkOrder = workOrders.some((w) => actionIds.has(w.actionId) && preparedStatuses.has(w.status));
  return hasPreparedWorkOrder
    ? "Ya preparado en dias anteriores; sigue pendiente de revision."
    : "Sigue siendo una oportunidad pendiente de dias anteriores.";
}

export interface Finding {
  title: string;
  detected: string;
  whyItMatters: string;
  recommendation: string;
  stage: string;
  priority: Priority;
}

// --- Fase O12.3: desambiguacion conservadora de texto duplicado ---
//
// Causa raiz: buildPageClusters() agrupa correctamente por PAGINA real
// (nunca fusiona dos paginas distintas), pero el TEXTO final de un
// Finding/RecommendedAction se genera solo a partir de
// cluster.representativeKeyword -- si dos paginas REALMENTE distintas
// tienen acciones con el mismo texto de keyword literal (p.ej. dos
// acciones con keyword="taquillas melamina", una en
// /taquillas-melamina/ y otra en /taquillas-melamina-fenolico/), ambos
// clusters son correctos y distintos, pero generan el mismo texto
// renderizado -- validateExecutiveReportCoherence lo detecta (con
// razon: un lector no podria distinguirlos) y el informe cae al
// fallback. La solucion NO es fusionar (son paginas reales distintas)
// ni descartar uno (se perderia una recomendacion legitima): es anadir
// un fragmento que identifique la pagina SOLO cuando hace falta.
//
// Deliberadamente conservador: si no hay colision de texto, el
// resultado es identico a antes (cero cambios visibles en el caso
// comun). Si dos o mas acciones de agentes distintos ya comparten la
// MISMA pagina, ya se fusionan en un unico cluster (una sola
// recomendacion con multiples sourceAgents) antes de llegar aqui -- eso
// no es un caso de colision, es el comportamiento normal.

function pageDisambiguationLabel(cluster: PageCluster): string {
  if (!cluster.page) return "pagina nueva";
  try {
    const url = new URL(cluster.page);
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments.length > 0 ? segments[segments.length - 1] : url.hostname;
    return slug.replace(/-/g, " ");
  } catch {
    return cluster.page;
  }
}

/**
 * Agrupa clusters por representativeKeyword normalizado (case-insensitive)
 * y devuelve el subconjunto que colisiona: mismo texto base pero
 * apuntando a paginas REALMENTE distintas (o una con pagina y otra sin).
 * Los clusters que ya comparten pagina nunca llegan aqui duplicados
 * (buildPageClusters ya los fusiono en un unico cluster).
 */
function findCollidingClusters(clusters: PageCluster[]): Set<PageCluster> {
  const byLabel = new Map<string, PageCluster[]>();
  for (const cluster of clusters) {
    const label = cluster.representativeKeyword.trim().toLowerCase();
    const list = byLabel.get(label) ?? [];
    list.push(cluster);
    byLabel.set(label, list);
  }

  const colliding = new Set<PageCluster>();
  for (const list of byLabel.values()) {
    if (list.length <= 1) continue;
    const distinctPages = new Set(list.map((c) => c.page ?? "(sin pagina)"));
    if (distinctPages.size > 1) {
      for (const c of list) colliding.add(c);
    }
  }
  return colliding;
}

function buildFindingFromCluster(cluster: PageCluster, workOrders: WorkOrder[], disambiguate: boolean): Finding {
  const title = disambiguate
    ? `${capitalizeFirst(cluster.representativeKeyword)} (${pageDisambiguationLabel(cluster)})`
    : capitalizeFirst(cluster.representativeKeyword);
  return {
    title,
    detected: detectedSentence(cluster),
    whyItMatters: whyItMattersSentence(cluster),
    recommendation: buildRecommendationSentence(cluster),
    stage: stageNote(cluster, workOrders),
    priority: cluster.priority,
  };
}

export interface RecommendedAction {
  action: string;
  reason: string;
  expectedImpact: string;
  effort: string;
  needsApproval: string;
}

function buildRecommendedActionFromCluster(cluster: PageCluster, disambiguate: boolean): RecommendedAction {
  const label = disambiguate
    ? `${cluster.representativeKeyword}" (${pageDisambiguationLabel(cluster)})`
    : `${cluster.representativeKeyword}"`;
  const action = cluster.page
    ? `Mejorar la pagina existente sobre "${label}`
    : `Crear una nueva pagina sobre "${label}`;
  const reason =
    cluster.currentPosition !== undefined
      ? `${cluster.brandPrimaryLabel} ya aparece en Google (alrededor de la posicion ${Math.round(cluster.currentPosition)}) pero fuera de la primera pagina de resultados.${cluster.brandSecondaryNote ? ` ${cluster.brandSecondaryNote}` : ""}`
      : `Se ha detectado una oportunidad para ${cluster.brandPrimaryLabel} relacionada con este tema (demanda pendiente de validar).`;
  return {
    action,
    reason,
    expectedImpact: "Aumentar la visibilidad en Google y las solicitudes relacionadas con este tema.",
    effort: estimateEffortLabel(cluster),
    needsApproval: "Si, antes de publicar cualquier cambio en la web.",
  };
}

function cleanActionTitle(title: string): string {
  return title.replace(/^SEO: /, "").replace(/^CRO: /, "");
}

function buildPendingDecisions(
  waitingApprovalActions: BacklogAction[],
  pendingApprovalRequests: ApprovalRequest[],
  recommendedNowClusters: PageCluster[],
  maxDecisions: number
): string[] {
  const bullets: string[] = [];
  for (const action of waitingApprovalActions) {
    bullets.push(`Aprobar o descartar: ${cleanActionTitle(action.title)}.`);
  }
  for (const request of pendingApprovalRequests) {
    bullets.push(`Responder a la solicitud enviada por Telegram: ${request.title}.`);
  }
  // Toda accion recomendada "para hacer ahora" implica una decision real
  // del responsable (aprobar, aplazar o rechazar antes de publicar) —
  // nunca se presenta como si no hubiera nada que decidir.
  for (const cluster of recommendedNowClusters) {
    bullets.push(`Aprobar, aplazar o rechazar: mejorar "${cluster.representativeKeyword}" antes de publicarlo.`);
  }
  return bullets.slice(0, maxDecisions);
}

const KNOWN_CONNECTIVITY_PHRASES = ["Sin credenciales de Google Ads", "Sin credenciales de GA4", "Sin credenciales de GTM"];

function buildBlockers(
  input: ExecutiveReportInput,
  lowQualityFragmentCount: number,
  unvalidatedGeoFragmentCount: number
): string[] {
  const bullets: string[] = [];
  if (!input.semConnected) {
    bullets.push("No se han podido analizar datos reales de Google Ads porque la cuenta todavia no esta conectada.");
  }
  if (!input.analyticsGa4Connected || !input.analyticsGtmConnected) {
    bullets.push("No se han podido validar las conversiones porque la medicion de la web (GA4/GTM) todavia no esta conectada.");
  }
  if (lowQualityFragmentCount > 0) {
    bullets.push(
      `Se detectaron ${lowQualityFragmentCount} sugerencia(s) de busqueda incompletas o poco claras, descartadas del analisis hasta poder validarlas manualmente.`
    );
  }
  if (unvalidatedGeoFragmentCount > 0) {
    bullets.push(
      `Se detectaron ${unvalidatedGeoFragmentCount} oportunidad(es) de mercado geografico muy especifico y con demanda minima medida, excluidas del analisis principal hasta confirmar si son un mercado real.`
    );
  }
  for (const warning of input.warnings) {
    if (KNOWN_CONNECTIVITY_PHRASES.some((phrase) => warning.includes(phrase))) continue;
    const withoutAgentPrefix = warning.replace(/^\[[^\]]+\]\s*/, "");
    const cleaned = sanitizeWarningText(withoutAgentPrefix);
    if (cleaned) bullets.push(cleaned);
  }
  // Fase O27 -- dedup por texto exacto. Encontrado en QA real: algunos
  // agentes (ej. Production Deployment Planner) reutilizan OTRO agente
  // "en memoria" dentro de la misma pasada (ver
  // production-deployment-planner.ts, que vuelve a invocar Staging QA
  // Agent), lo que puede emitir el mismo warning_detected dos veces en un
  // mismo departmentRunId -- sin este dedup, el mismo bloqueo aparecia
  // duplicado en el informe.
  const dedupedBullets = [...new Set(bullets)];
  if (dedupedBullets.length === 0) {
    dedupedBullets.push("No se ha detectado ningun bloqueo importante hoy.");
  }
  return dedupedBullets;
}

function buildWorkDoneBullets(input: ExecutiveReportInput, clusterCount: number, newClusterCount: number): string[] {
  const bullets: string[] = ["Se analizaron las consultas de Google por las que aparece la web."];
  if (input.croReviewCount > 0) {
    bullets.push(`Se revisaron ${input.croReviewCount} pagina(s) comercial(es) para detectar mejoras de conversion.`);
  }
  bullets.push(
    `Se comparo la cobertura de contenidos con los principales competidores${
      input.competitorGapCount > 0 ? `, detectando ${input.competitorGapCount} punto(s) que la competencia cubre y la web todavia no` : ""
    }.`
  );
  if (newClusterCount === 0) {
    bullets.push(
      `No se detectaron oportunidades nuevas hoy: el departamento sigue trabajando sobre las ${clusterCount} ya identificadas en dias anteriores.`
    );
  } else {
    bullets.push(
      `Se detectaron ${newClusterCount} oportunidad(es) nueva(s) hoy, ademas de ${clusterCount - newClusterCount} que ya seguian pendientes de dias anteriores.`
    );
  }
  const missingConnections = !input.semConnected || !input.analyticsGa4Connected || !input.analyticsGtmConnected;
  bullets.push(
    `Se reviso el estado de la medicion y de las campanas publicitarias${missingConnections ? ", aunque todavia sin datos reales conectados" : ""}.`
  );
  return bullets;
}

function buildSummaryParagraph(clusters: PageCluster[], newClusterCount: number, pendingDecisionCount: number): string {
  const highCount = clusters.filter((c) => c.priority === "high").length;
  const parts: string[] = [
    "Hoy el departamento ha analizado el posicionamiento de la web en Google, ha revisado paginas comerciales importantes y ha comparado la cobertura de contenidos con la competencia.",
  ];
  if (newClusterCount === 0) {
    parts.push(
      clusters.length > 0
        ? `No se han detectado oportunidades nuevas hoy; el departamento sigue trabajando sobre las ${clusters.length} identificadas anteriormente${highCount > 0 ? `, ${highCount} de ellas prioritarias` : ""}.`
        : "No se han detectado oportunidades nuevas ni pendientes hoy."
    );
  } else {
    parts.push(
      `Se han identificado ${newClusterCount} oportunidad(es) nueva(s) hoy, y siguen abiertas ${clusters.length - newClusterCount} de dias anteriores${highCount > 0 ? ` (${highCount} en total de prioridad alta)` : ""}.`
    );
  }
  parts.push("No se ha publicado ningun cambio; las propuestas quedan preparadas para revision.");
  if (pendingDecisionCount > 0) {
    parts.push(`Hay ${pendingDecisionCount} decision(es) que necesitan tu aprobacion, aplazamiento o rechazo.`);
  }
  return parts.join(" ");
}

function buildNextStep(pendingDecisionCount: number): string {
  if (pendingDecisionCount > 0) {
    return `Revisar y aprobar, aplazar o rechazar las ${pendingDecisionCount} decision(es) pendientes antes de preparar cualquier cambio en la web.`;
  }
  // Deliberadamente sin las palabras "revisar"/"aprobar": si no hay
  // ninguna decision pendiente, el proximo paso no puede sugerir,
  // aunque sea de forma ambigua, que hay algo que mirar o aprobar.
  return "No hay ninguna accion urgente hoy. No se requiere ninguna decision del responsable en este momento.";
}

// --- Punto de entrada ---

export interface ExecutiveReportInput {
  dateLabel: string;
  actionableActions: BacklogAction[];
  workOrders: WorkOrder[];
  waitingApprovalActions: BacklogAction[];
  pendingApprovalRequests: ApprovalRequest[];
  competitorGapCount: number;
  croReviewCount: number;
  // Change Packs: solo un contador agregado (no se listan individualmente
  // aqui, para no duplicar lo que "Acciones recomendadas" ya muestra —
  // ver docs/change-packs.md para el detalle completo en el informe
  // tecnico).
  changePackCount: number;
  // WordPress Draft Agent: igual criterio que Change Packs — solo
  // contadores agregados aqui, nunca se listan drafts individuales (ver
  // docs/wordpress-draft-agent.md para el detalle en el informe tecnico).
  localPreviewCount: number;
  wordpressDraftCount: number;
  wordpressDraftsEnabled: boolean;
  // Staging Executor (Fase O12): opcionales para no romper fixtures de
  // test existentes (ver test/executive-report.test.ts) — se tratan como
  // 0 si se omiten.
  stagingExecutionsAppliedCount?: number;
  stagingExecutionsPendingApprovalCount?: number;
  semConnected: boolean;
  analyticsGa4Connected: boolean;
  analyticsGtmConnected: boolean;
  warnings: string[];
}

export interface ExecutiveReportData {
  dateLabel: string;
  summaryParagraph: string;
  workDoneBullets: string[];
  findings: Finding[];
  recommendedNow: RecommendedAction[];
  recommendedLater: RecommendedAction[];
  pendingDecisions: string[];
  blockers: string[];
  preparedForReviewCount: number;
  changePackCount: number;
  localPreviewCount: number;
  wordpressDraftCount: number;
  wordpressDraftsEnabled: boolean;
  stagingExecutionsAppliedCount: number;
  stagingExecutionsPendingApprovalCount: number;
  newOpportunityCount: number;
  nextStep: string;
  lowQualityFragmentCount: number;
  unvalidatedGeoFragmentCount: number;
}

export const MAX_FINDINGS = 4;
export const MAX_NOW = 3;
export const MAX_LATER = 3;
export const MAX_DECISIONS = 3;

/**
 * Deduplica, agrupa y prioriza el Action Backlog para producir los datos
 * del informe ejecutivo. No toca disco, no decide autonomia, no ejecuta
 * nada — solo cura lo que ya existe para que sea legible por alguien no
 * tecnico. Nunca muestra mas acciones "para hacer ahora" de las que
 * realmente hay clasificadas como prioridad alta (no rellena con
 * prioridad media solo para llegar al maximo).
 */
export function buildExecutiveReportData(input: ExecutiveReportInput): ExecutiveReportData {
  const lowQuality = input.actionableActions.filter((a) => isLowQualityKeywordFragment(a.keyword));
  const unvalidatedGeo = input.actionableActions.filter(
    (a) => !isLowQualityKeywordFragment(a.keyword) && isUnvalidatedGeoFragment(a)
  );
  const cleanActions = input.actionableActions.filter(
    (a) => !isLowQualityKeywordFragment(a.keyword) && !isUnvalidatedGeoFragment(a)
  );

  const clusters = buildPageClusters(cleanActions, input.dateLabel);
  const newClusters = clusters.filter((c) => c.isNewToday);
  const preparedForReviewCount = clusters.length;

  const highPriorityClusters = clusters.filter((c) => c.priority === "high");
  const recommendedNowClusters = highPriorityClusters.slice(0, MAX_NOW);
  const recommendedNowSet = new Set(recommendedNowClusters);
  const remainingClusters = clusters.filter((c) => !recommendedNowSet.has(c));
  const recommendedLaterClusters = remainingClusters.slice(0, MAX_LATER);

  const findingClusters = [...recommendedNowClusters, ...remainingClusters].slice(0, MAX_FINDINGS);

  // Fase O12.3: deteccion de colision de texto ANTES de generar el
  // texto final -- ver findCollidingClusters() mas arriba. El ambito de
  // cada deteccion coincide exactamente con el de
  // validateExecutiveReportCoherence() (findings por su lado,
  // recommendedNow+recommendedLater juntos por el suyo) para que nunca
  // pueda quedar una colision sin desambiguar.
  const findingCollisions = findCollidingClusters(findingClusters);
  const actionCollisions = findCollidingClusters([...recommendedNowClusters, ...recommendedLaterClusters]);

  const findings = findingClusters.map((c) => buildFindingFromCluster(c, input.workOrders, findingCollisions.has(c)));
  const recommendedNow = recommendedNowClusters.map((c) => buildRecommendedActionFromCluster(c, actionCollisions.has(c)));
  const recommendedLater = recommendedLaterClusters.map((c) => buildRecommendedActionFromCluster(c, actionCollisions.has(c)));

  const pendingDecisions = buildPendingDecisions(
    input.waitingApprovalActions,
    input.pendingApprovalRequests,
    recommendedNowClusters,
    MAX_DECISIONS
  );
  const blockers = buildBlockers(input, lowQuality.length, unvalidatedGeo.length);
  const workDoneBullets = buildWorkDoneBullets(input, clusters.length, newClusters.length);
  const summaryParagraph = buildSummaryParagraph(clusters, newClusters.length, pendingDecisions.length);
  const nextStep = buildNextStep(pendingDecisions.length);

  return {
    dateLabel: input.dateLabel,
    summaryParagraph,
    workDoneBullets,
    findings,
    recommendedNow,
    recommendedLater,
    pendingDecisions,
    blockers,
    preparedForReviewCount,
    changePackCount: input.changePackCount,
    localPreviewCount: input.localPreviewCount,
    wordpressDraftCount: input.wordpressDraftCount,
    wordpressDraftsEnabled: input.wordpressDraftsEnabled,
    stagingExecutionsAppliedCount: input.stagingExecutionsAppliedCount ?? 0,
    stagingExecutionsPendingApprovalCount: input.stagingExecutionsPendingApprovalCount ?? 0,
    newOpportunityCount: newClusters.length,
    nextStep,
    lowQualityFragmentCount: lowQuality.length,
    unvalidatedGeoFragmentCount: unvalidatedGeo.length,
  };
}

/**
 * Revision final de coherencia (equivalente a que "Growth Director relea
 * el informe antes de guardarlo"): comprueba limites, duplicados y
 * consistencia interna. Devuelve la lista de problemas encontrados (vacia
 * si todo esta bien). Si esto encuentra algo, growth-director.ts trata el
 * informe como no fiable y usa el fallback seguro en su lugar — nunca se
 * guarda ni se envia un informe ejecutivo que se sepa que es incoherente.
 */
export function validateExecutiveReportCoherence(data: ExecutiveReportData): string[] {
  const problems: string[] = [];

  if (data.findings.length > MAX_FINDINGS) problems.push(`findings excede el maximo (${data.findings.length} > ${MAX_FINDINGS})`);
  if (data.recommendedNow.length > MAX_NOW) problems.push(`recommendedNow excede el maximo (${data.recommendedNow.length} > ${MAX_NOW})`);
  if (data.recommendedLater.length > MAX_LATER) problems.push(`recommendedLater excede el maximo (${data.recommendedLater.length} > ${MAX_LATER})`);
  if (data.pendingDecisions.length > MAX_DECISIONS) problems.push(`pendingDecisions excede el maximo (${data.pendingDecisions.length} > ${MAX_DECISIONS})`);

  const findingTitles = data.findings.map((f) => f.title.toLowerCase());
  const dupFindingTitles = [...new Set(findingTitles.filter((t, i) => findingTitles.indexOf(t) !== i))];
  if (dupFindingTitles.length > 0) problems.push(`titulos de conclusiones duplicados: ${dupFindingTitles.join(", ")}`);

  const actionTitles = [...data.recommendedNow, ...data.recommendedLater].map((a) => a.action.toLowerCase());
  const dupActionTitles = [...new Set(actionTitles.filter((t, i) => actionTitles.indexOf(t) !== i))];
  if (dupActionTitles.length > 0) problems.push(`acciones recomendadas duplicadas: ${dupActionTitles.join(", ")}`);

  if (data.recommendedNow.length > 0 && data.pendingDecisions.length === 0) {
    problems.push("hay acciones recomendadas para hacer ahora pero cero decisiones pendientes: inconsistente");
  }
  if (data.pendingDecisions.length === 0 && /revisar|aprobar/i.test(data.nextStep)) {
    problems.push("no hay decisiones pendientes pero el proximo paso pide revisar/aprobar acciones");
  }
  if (data.pendingDecisions.length > 0 && !/revisar|aprobar|aplazar|rechazar/i.test(data.nextStep)) {
    problems.push("hay decisiones pendientes pero el proximo paso no lo refleja");
  }

  for (const finding of data.findings) {
    if (/zentry y tukandado aparece/i.test(finding.detected)) {
      problems.push(`atribucion de marca incorrecta en "${finding.title}" (posicion de Search Console atribuida a un compuesto de marcas)`);
    }
    if (finding.priority === "high" && !/dato real de search console|pendiente de validar/i.test(finding.detected)) {
      problems.push(`"${finding.title}" no indica el origen del dato (real vs pendiente de validar)`);
    }
  }

  return problems;
}

function renderActionBlock(a: RecommendedAction): string[] {
  return [
    `#### ${a.action}`,
    "",
    `Motivo: ${a.reason}`,
    "",
    `Impacto esperado: ${a.expectedImpact}`,
    "",
    `Esfuerzo: ${a.effort}.`,
    "",
    `Necesita aprobacion: ${a.needsApproval}`,
    "",
  ];
}

/** Convierte ExecutiveReportData en el markdown final. Funcion pura. */
export function renderExecutiveReportMarkdown(data: ExecutiveReportData, generatedAt: string): string {
  const lines: string[] = [];
  lines.push("# Informe diario de Web & Growth");
  lines.push(`Fecha: ${data.dateLabel}`);
  lines.push("");
  lines.push("## Resumen del dia");
  lines.push("");
  lines.push(data.summaryParagraph);
  lines.push("");

  lines.push("## Trabajo realizado hoy");
  lines.push("");
  for (const bullet of data.workDoneBullets) lines.push(`- ${bullet}`);
  lines.push("");

  lines.push("## Principales conclusiones");
  lines.push("");
  if (data.findings.length === 0) {
    lines.push("No hay conclusiones destacadas hoy.");
    lines.push("");
  } else {
    data.findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.title}`);
      lines.push("");
      lines.push(finding.detected);
      lines.push("");
      lines.push(finding.whyItMatters);
      lines.push("");
      lines.push(`Recomendacion: ${finding.recommendation}`);
      lines.push("");
      lines.push(`Prioridad: ${priorityLabel(finding.priority)}. ${finding.stage}`);
      lines.push("");
    });
  }

  lines.push("## Acciones recomendadas");
  lines.push("");
  lines.push("### Para hacer ahora");
  lines.push("");
  if (data.recommendedNow.length === 0) {
    lines.push("Ninguna accion urgente hoy.");
    lines.push("");
  } else {
    for (const action of data.recommendedNow) lines.push(...renderActionBlock(action));
  }
  lines.push("### Para estudiar mas adelante");
  lines.push("");
  if (data.recommendedLater.length === 0) {
    lines.push("Nada que anadir por ahora.");
    lines.push("");
  } else {
    for (const action of data.recommendedLater) lines.push(...renderActionBlock(action));
  }

  lines.push("## Decisiones pendientes del responsable");
  lines.push("");
  if (data.pendingDecisions.length === 0) {
    lines.push("No hay decisiones pendientes hoy.");
  } else {
    for (const decision of data.pendingDecisions) lines.push(`- ${decision}`);
  }
  lines.push("");

  lines.push("## Problemas o bloqueos");
  lines.push("");
  for (const blocker of data.blockers) lines.push(`- ${blocker}`);
  lines.push("");

  lines.push("## Estado de ejecucion");
  lines.push("");
  lines.push("Cambios publicados hoy: Ninguno.");
  lines.push("Campanas modificadas: Ninguna.");
  lines.push("Analitica modificada: Ninguna.");
  lines.push(`Acciones preparadas para revision: ${data.preparedForReviewCount}.`);
  lines.push(`Paquetes de cambio concretos preparados (sin ejecutar): ${data.changePackCount}.`);
  lines.push(`Previews de WordPress preparados (borradores locales, sin subir a WordPress): ${data.localPreviewCount}.`);
  lines.push(
    data.wordpressDraftsEnabled
      ? `Borradores reales creados en WordPress (sin publicar, pendientes de revision): ${data.wordpressDraftCount}.`
      : "Creacion de borradores reales en WordPress: desactivada. Solo se han preparado previews locales."
  );
  lines.push(`Cambios aplicados a staging (nunca a produccion, siempre sin publicar): ${data.stagingExecutionsAppliedCount}.`);
  lines.push(`Ejecuciones en staging pendientes de aprobacion por Telegram: ${data.stagingExecutionsPendingApprovalCount}.`);
  lines.push(`Oportunidades nuevas detectadas hoy: ${data.newOpportunityCount}.`);
  lines.push("");
  lines.push("Todo el trabajo realizado hoy ha sido de analisis y preparacion. La web y las campanas permanecen sin cambios. Ningun borrador de WordPress se ha publicado.");
  lines.push("");

  lines.push("## Proximo paso recomendado");
  lines.push("");
  lines.push(data.nextStep);
  lines.push("");
  lines.push(`_Generado automaticamente el ${generatedAt.slice(0, 10)}. Para el detalle tecnico completo, consulta el informe interno del mismo dia._`);
  lines.push("");

  return stripEnvVarTokens(lines.join("\n"));
}

/**
 * Informe minimo y seguro para cuando la generacion del informe
 * ejecutivo detallado falla, O cuando validateExecutiveReportCoherence()
 * encuentra algo incoherente. Deliberadamente breve: nunca vuelca datos
 * internos sin filtrar. El motivo real (error o lista de incoherencias)
 * se registra por separado en los logs/informe tecnico, nunca aqui.
 */
export function buildFallbackExecutiveReportMarkdown(dateLabel: string): string {
  const lines = [
    "# Informe diario de Web & Growth",
    `Fecha: ${dateLabel}`,
    "",
    "## Resumen del dia",
    "",
    "Hoy no ha sido posible generar el resumen ejecutivo detallado. El departamento ha seguido funcionando en modo de analisis y planificacion, sin ejecutar ningun cambio real.",
    "",
    "## Estado de ejecucion",
    "",
    "Cambios publicados hoy: Ninguno.",
    "Campanas modificadas: Ninguna.",
    "Analitica modificada: Ninguna.",
    "",
    "## Proximo paso recomendado",
    "",
    "Consultar el informe tecnico interno para el detalle completo de hoy, o esperar a la proxima ejecucion diaria.",
    "",
  ];
  return stripEnvVarTokens(lines.join("\n"));
}

// --- Fase O27: formato de 6 secciones (ejecucion real, no solo analisis) ---
//
// Deliberadamente una funcion NUEVA (renderExecutiveReportMarkdownV2),
// que reutiliza ExecutiveReportData tal cual (sin tocar
// buildExecutiveReportData ni validateExecutiveReportCoherence, ni el
// render V1 de arriba -- test/executive-report.test.ts sigue pasando sin
// cambios) y le anade un segundo bloque de datos (ExecutiveReportExtrasV2)
// que SI existia ya en el sistema (staging executions aplicadas hoy, QA
// persistido, cambios de estado por oportunidad) pero nunca se habia
// mostrado. growth-director.ts llama a esta funcion en vez de a la V1
// desde la Fase O27 en adelante.

export interface RealChangeToday {
  description: string;
  stagingUrl?: string;
}

export interface TaskAdvancedToday {
  title: string;
  previousState: OpportunityState;
  newState: OpportunityState;
  evidence: string;
  stagingUrl?: string;
}

export interface PendingDecisionV2 {
  title: string;
  impact: string;
  risk: string;
  reviewUrl?: string;
}

/**
 * Fase O27.3 -- borrador que YA paso QA tecnico en staging pero que
 * TODAVIA no ha sido revisado visualmente por una persona (ver
 * src/core/visual-qa.ts). Se muestra por separado de "Decisiones
 * necesarias de Pau": no es una decision con opciones aprobar/rechazar,
 * es informativo -- el unico paso siguiente posible es que alguien lo
 * mire y, si esta bien, lo apruebe visualmente (scripts/mark-visual-qa.ts).
 */
export interface VisualReviewPendingItem {
  keyword: string;
  page?: string;
  stagingUrl?: string;
  /** Fase O27.3 -- ver src/core/existing-page-audit.ts. Ausente si todavia no se ha auditado. */
  existingPageMatch?: { matchType: "update_existing_page" | "new_page_candidate"; productionUrl?: string };
}

export interface ExecutiveReportExtrasV2 {
  realChangesToday: RealChangeToday[];
  qaRunsToday: number;
  tasksClosedToday: number;
  tasksAdvancedToday: TaskAdvancedToday[];
  pendingDecisionsV2: PendingDecisionV2[];
  draftsPendingVisualReview: VisualReviewPendingItem[];
  carrilAAutoAppliedToday: number;
  topBacklogSummary: string[];
  totalOpenOpportunityCount: number;
  tomorrowIfNoResponse: string;
  tomorrowIfApproved: string;
  stagingKeepsAdvancing: string;
}

function renderPendingDecisionV2(d: PendingDecisionV2, index: number): string[] {
  return [
    `### ${index + 1}. ${d.title}`,
    "",
    "Opciones: aprobar / rechazar / aplazar.",
    `Impacto: ${d.impact}`,
    `Riesgo: ${d.risk}`,
    d.reviewUrl ? `URL de revision: ${d.reviewUrl}` : "URL de revision: (no aplica -- decision sobre backlog, no sobre una pagina concreta).",
    "",
  ];
}

/** Convierte ExecutiveReportData + ExecutiveReportExtrasV2 en el markdown final de 6 secciones. Funcion pura. */
export function renderExecutiveReportMarkdownV2(data: ExecutiveReportData, extras: ExecutiveReportExtrasV2, generatedAt: string): string {
  const lines: string[] = [];
  lines.push("# Informe diario de Web & Growth");
  lines.push(`Fecha: ${data.dateLabel}`);
  lines.push("");
  // Fase O27.1 -- el resumen de V1 (data.summaryParagraph) siempre
  // termina con "No se ha publicado ningun cambio; las propuestas quedan
  // preparadas para revision", que era correcto cuando NADA se escribia
  // nunca de verdad, pero se vuelve enganoso en cuanto el Carril A aplica
  // cambios reales en staging (violaria la regla explicita de no decir
  // "todo fue analisis" si hubo ejecucion real). Se sustituye esa frase
  // final por una version que distingue staging (si puede haber cambios
  // reales) de produccion (nunca los hay sin aprobacion).
  let summaryWithRealChanges =
    extras.realChangesToday.length > 0
      ? data.summaryParagraph.replace(
          /No se ha publicado ningun cambio; las propuestas quedan preparadas para revision\.?/,
          `Se han aplicado ${extras.realChangesToday.length} cambio(s) real(es) en staging hoy (ver seccion 1) — nunca en produccion, que sigue exactamente igual.`
        )
      : data.summaryParagraph;
  // Fase O27.3 -- V1 cuenta "decisiones pendientes" por su propio camino
  // (incluye clusters "recomendados ahora" que V2 no trata como
  // decision), y ademas ya no sabe nada del gate visual (Fase O27.3):
  // sin este ajuste, el resumen de arriba podia decir "hay 2 decisiones"
  // mientras la seccion 3 (la fuente real, ya filtrada) decia "ninguna
  // decision pendiente" -- exactamente el tipo de informe incoherente
  // que este sistema nunca debe enviar. Se quita la frase de V1 y se
  // vuelve a poner con la cifra REAL de extras.pendingDecisionsV2.
  summaryWithRealChanges = summaryWithRealChanges.replace(/\s*Hay \d+ decision\(es\) que necesitan tu aprobacion, aplazamiento o rechazo\.?/, "");
  if (extras.pendingDecisionsV2.length > 0) {
    summaryWithRealChanges += ` Hay ${extras.pendingDecisionsV2.length} decision(es) que necesitan tu aprobacion, aplazamiento o rechazo.`;
  }
  lines.push(summaryWithRealChanges);
  lines.push("");

  lines.push("## 1. Cambios reales hechos hoy");
  lines.push("");
  if (extras.realChangesToday.length === 0) {
    lines.push(
      "Ninguno. Ningun change pack aprobado tenia una ejecucion nueva que aplicar en esta pasada — ver la seccion 4 (Bloqueos reales) si el motivo es tecnico, o la 5 (Backlog resumido) si simplemente no habia nada nuevo lo bastante maduro."
    );
  } else {
    for (const change of extras.realChangesToday) {
      lines.push(`- ${change.description}${change.stagingUrl ? ` — ${change.stagingUrl}` : ""}`);
    }
  }
  lines.push("");
  lines.push(
    `QA tecnico/visual ejecutado hoy sobre borradores de staging: ${extras.qaRunsToday}. Tareas cerradas hoy (done): ${extras.tasksClosedToday}. Aplicado automaticamente por el Carril A (sin esperar aprobacion diaria): ${extras.carrilAAutoAppliedToday}.`
  );
  lines.push("");
  // Fase O27.3 -- distincion explicita pedida por Pau: "QA tecnico
  // pasado" no es "listo para producción". Esta lista es SIEMPRE
  // informativa (nunca una decision con opciones aprobar/rechazar) --
  // el unico siguiente paso posible es que una persona la revise
  // visualmente (scripts/mark-visual-qa.ts approve <id>).
  lines.push(
    `**Borradores con QA tecnico superado, pendientes de revision VISUAL humana (${extras.draftsPendingVisualReview.length}):** estos parecen bocetos hasta que alguien los mire y los apruebe visualmente -- ninguno se propone todavia para producción.`
  );
  if (extras.draftsPendingVisualReview.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const d of extras.draftsPendingVisualReview) {
      const matchLabel = !d.existingPageMatch
        ? ""
        : d.existingPageMatch.matchType === "update_existing_page"
          ? ` [ACTUALIZA pagina existente: ${d.existingPageMatch.productionUrl ?? "producción"}]`
          : " [candidata a pagina nueva -- sin equivalente en producción]";
      lines.push(`- ${d.keyword}${d.page ? ` (${d.page})` : ""}${d.stagingUrl ? ` — ${d.stagingUrl}` : ""}${matchLabel}`);
    }
  }
  lines.push("");

  lines.push("## 2. Tareas avanzadas hoy");
  lines.push("");
  if (extras.tasksAdvancedToday.length === 0) {
    lines.push("Ninguna tarea cambio de estado hoy.");
    lines.push("");
  } else {
    lines.push("| Tarea | Estado anterior | Estado nuevo | Evidencia | URL staging |");
    lines.push("|---|---|---|---|---|");
    for (const t of extras.tasksAdvancedToday) {
      lines.push(
        `| ${t.title} | ${OPPORTUNITY_STATE_LABELS[t.previousState]} | ${OPPORTUNITY_STATE_LABELS[t.newState]} | ${t.evidence} | ${t.stagingUrl ?? "-"} |`
      );
    }
    lines.push("");
  }

  lines.push("## 3. Decisiones necesarias de Pau");
  lines.push("");
  if (extras.pendingDecisionsV2.length === 0) {
    lines.push("Ninguna decision pendiente hoy.");
    lines.push("");
  } else {
    extras.pendingDecisionsV2.slice(0, MAX_DECISIONS).forEach((d, i) => lines.push(...renderPendingDecisionV2(d, i)));
  }

  lines.push("## 4. Bloqueos reales");
  lines.push("");
  const realBlockers = data.blockers.filter((b) => b !== "No se ha detectado ningun bloqueo importante hoy.");
  if (realBlockers.length === 0) {
    lines.push("Ningun bloqueo real hoy.");
  } else {
    for (const b of realBlockers) lines.push(`- ${b}`);
  }
  lines.push("");

  lines.push("## 5. Backlog resumido");
  lines.push("");
  lines.push(`Oportunidades abiertas en total: ${extras.totalOpenOpportunityCount} (no se repiten todas cada dia). Top prioridades de hoy:`);
  lines.push("");
  if (extras.topBacklogSummary.length === 0) {
    lines.push("Nada destacado pendiente.");
  } else {
    for (const item of extras.topBacklogSummary) lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## 6. Próxima ejecución");
  lines.push("");
  lines.push(`Si no respondes: ${extras.tomorrowIfNoResponse}`);
  lines.push(`Si apruebas: ${extras.tomorrowIfApproved}`);
  lines.push(`Seguira avanzando en staging sin esperar tu respuesta: ${extras.stagingKeepsAdvancing}`);
  lines.push("");

  lines.push(`_Generado automaticamente el ${generatedAt.slice(0, 10)}. Para el detalle tecnico completo, consulta el informe interno del mismo dia._`);
  lines.push("");

  return stripEnvVarTokens(lines.join("\n"));
}
