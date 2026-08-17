import { buildNumberedProposals, NumberedProposal } from "../approvals/manual/proposal";
import { DepartmentApplyItem, DepartmentApplyStatus, DepartmentApplySummary } from "./apply/types";
import { DailyBriefEmail, DailyBriefEmailInput, escapeHtml } from "./brief-email";
import { DepartmentDailyBrief } from "./daily-brief";
import { DepartmentStageName, DepartmentStageRecord } from "./types";

/**
 * EMAIL HUMANO del Daily Brief -- el resumen que lee PAU, que no es
 * tecnico, desde el movil y en menos de un minuto.
 *
 * NO sustituye a `brief-email.ts`: aquel sigue siendo el informe tecnico
 * completo (secciones numeradas, ids, estados internos, coste) y se
 * conserva como detalle/artifact. Este modulo responde a otra pregunta:
 * "que ha pasado hoy en mi web y que tengo que hacer yo".
 *
 * Modulo PURO: sin fs, sin red, sin reloj. La fecha llega por parametro
 * (o se deriva del propio brief), igual que en el email tecnico.
 *
 * Reglas duras de este email:
 *
 * - NADA de jerga interna en el cuerpo: ni ids, ni rutas, ni estados
 *   crudos, ni operaciones tecnicas, ni coste, ni nombres de empleados,
 *   ni URLs de runs. El texto que viene de dentro del sistema pasa
 *   SIEMPRE por `humanPhrase()`, que tira los tokens tecnicos en vez de
 *   confiar en que nadie los haya escrito.
 * - Se dice el numero de cosas, no la lista completa: como maximo
 *   `MAX_DONE_ITEMS` cambios y `MAX_DECISION_ITEMS` decisiones.
 * - Lo unico que se pide es una decision, y se dice como se toma
 *   (Telegram). El email no aprueba nada.
 * - Un dia sin trabajo es un RESULTADO VALIDO: se dice tal cual y no se
 *   rellena con recomendaciones inventadas.
 */

export type HumanBriefMode = "normal" | "sin_trabajo" | "alerta";

export interface HumanDailyBriefEmailInput extends DailyBriefEmailInput {
  /**
   * Motivo HUMANO por el que la pasada no pudo completarse, si no pudo.
   * No vacio = modo ALERTA, sea cual sea el resto del contenido: quien
   * ejecuta la pasada sabe mejor que este render que ha reventado.
   * Se escribe en lenguaje de negocio; los detalles tecnicos NO van a
   * este email (viven en el informe tecnico).
   */
  runFailureReason?: string;
}

/** Maximo de cambios que se enumeran en "Hemos hecho". */
export const MAX_DONE_ITEMS = 3;
/** Maximo de decisiones que se enumeran en "Necesito de ti". */
export const MAX_DECISION_ITEMS = 2;
/**
 * Palabras maximas de cada frase que viene de dentro del sistema. Estos
 * topes son los que mantienen el cuerpo por debajo de
 * `HUMAN_EMAIL_MAX_WORDS` por construccion: el armazon fijo ronda las 165
 * palabras y lo variable no puede pasar de
 * 3*8 + 2*(3+10) + 3 URLs ~ 60, aunque la pasada traiga veinte propuestas
 * con titulos larguisimos.
 */
const MAX_ITEM_WORDS = 8;
const MAX_DECISION_WORDS = 10;

/** Rango de longitud objetivo del cuerpo normal: un minuto de lectura. */
export const HUMAN_EMAIL_MIN_WORDS = 150;
export const HUMAN_EMAIL_MAX_WORDS = 250;

/**
 * Literales que NUNCA pueden salir en este email. Se filtran a nivel de
 * TOKEN sobre todo el texto que procede del sistema: un titulo de
 * recomendacion es texto libre y puede traer cualquier cosa dentro.
 */
const FORBIDDEN_TOKEN_FRAGMENTS: string[] = [
  "changeplan",
  "page_id",
  "requires_manual",
  "update_post_meta",
  "execute_php",
  "recommendationid",
  "changeid",
  "departmentrunid",
  ".json",
  "json",
  "usd",
  "http://",
  "https://",
];

/**
 * Estados en los que el cambio YA esta escrito en el entorno de pruebas
 * (o mas alla). Para Pau esto es "hecho y revisable".
 */
const APPLIED_STATUSES: DepartmentApplyStatus[] = [
  "staging_applied",
  "awaiting_approval",
  "awaiting_rejection_reason",
  "approved",
  "approval_stale",
  "production_queued",
  "production_applying",
  "production_applied",
];

/** Estados que esperan literalmente una respuesta de Pau. */
const DECISION_STATUSES: DepartmentApplyStatus[] = ["awaiting_approval", "awaiting_rejection_reason", "approval_stale"];

/** Estados cerrados: ni hechos ni pendientes de decision ni en estudio. */
const CLOSED_STATUSES: DepartmentApplyStatus[] = ["rejected"];

/**
 * Etapas CRITICAS: si una de estas revienta tecnicamente, la pasada no
 * ha producido una revision utilizable y el email tiene que decirlo en
 * vez de fingir un resumen normal.
 */
const CRITICAL_STAGES: DepartmentStageName[] = ["growth-director-v2", "qa-reviewer"];

/** Como se llama, en castellano de negocio, lo que hace cada etapa. Nunca el nombre del agente. */
const STAGE_HUMAN_WORK: Record<DepartmentStageName, string> = {
  "seo-specialist": "el analisis de posicionamiento en buscadores",
  "content-strategist": "el analisis de contenidos",
  "analytics-specialist": "el analisis de los datos de trafico y conversion",
  "sem-specialist": "el analisis de campanas de pago",
  "growth-director-v2": "la priorizacion del trabajo del dia",
  "qa-reviewer": "la revision de calidad",
  "web-engineer": "la preparacion tecnica de los cambios",
};

// --- Utilidades de texto ---------------------------------------------------

/**
 * Cuenta PALABRAS de verdad: solo cuentan los tokens con alguna letra o
 * algun digito, asi que ni los guiones de las vinetas ni los separadores
 * inflan la cuenta.
 */
export function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Conectores con los que una frase recortada nunca puede terminar. */
const TRAILING_STOPWORDS = ["de", "del", "la", "el", "los", "las", "y", "o", "u", "en", "para", "con", "a", "al", "que", "por", "un", "una", "sobre", "desde"];

function isTechnicalToken(token: string): boolean {
  const lower = token.toLowerCase();
  if (lower.length === 0) return false;
  if (FORBIDDEN_TOKEN_FRAGMENTS.some((fragment) => lower.includes(fragment))) return true;
  // Identificadores: snake_case, rutas, asignaciones, ficheros con
  // extension y camelCase. Ninguna frase en castellano los necesita.
  if (token.includes("_") || token.includes("/") || token.includes("=") || token.includes("\\")) return true;
  if (/^[a-z]+[A-Z]/.test(token)) return true;
  if (/^[A-Za-z0-9.-]+\.(json|ts|md|php|html|csv|jsonl)\b/i.test(token)) return true;
  // Ids de pasada y de cambio del tipo `dept-2026-08-15T120000Z#rec-1`.
  if (/#/.test(token)) return true;
  if (/^[a-z]+-\d{4}-\d{2}-\d{2}/i.test(token)) return true;
  return false;
}

/**
 * Convierte texto del sistema en una frase legible: quita los tokens
 * tecnicos, colapsa espacios, recorta a un numero de palabras y deja una
 * frase con mayuscula inicial y punto final.
 *
 * Si despues del filtro no queda nada legible, devuelve `fallback`: es
 * preferible una frase generica honesta a un trozo de identificador.
 */
export function humanPhrase(raw: string, maxWords: number, fallback: string): string {
  const tokens = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0 && !isTechnicalToken(token))
    .map((token) => token.replace(/^[\s"'`(\[]+|[\s"'`)\].,;:]+$/g, ""))
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
  if (tokens.length === 0) return fallback;
  const cut = tokens.length > maxWords;
  const sliced = tokens.slice(0, maxWords);
  // Una frase recortada no puede acabar en preposicion o articulo
  // ("... de la..."): se sueltan los conectores finales antes de poner
  // los puntos suspensivos.
  while (cut && sliced.length > 1 && TRAILING_STOPWORDS.includes(sliced[sliced.length - 1].toLowerCase())) sliced.pop();
  const kept = sliced.join(" ");
  const sentence = kept.charAt(0).toUpperCase() + kept.slice(1);
  return cut ? `${sentence}...` : /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Quita el prefijo en mayusculas con el que el brief tecnico encabeza una
 * decision ("APROBAR o RECHAZAR: ..."), para no repetirlo detras del
 * "Aprobar o rechazar:" que ya pone este email.
 */
function stripDecisionPrefix(text: string): string {
  return String(text ?? "").replace(/^[A-Z][A-Z\s/]{2,40}:\s*/, "");
}

/** Minuscula SOLO en la primera letra: una frase encajada detras de dos puntos. */
function uncapitalize(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** Solo se enlaza lo que de verdad es una URL http(s): nunca se construye una. */
function isReviewableUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(String(url ?? "").trim());
}

// --- Lectura de la pasada --------------------------------------------------

function applyItems(apply: DepartmentApplySummary | null): DepartmentApplyItem[] {
  return apply ? apply.items : [];
}

function proposalsOf(apply: DepartmentApplySummary | null): NumberedProposal[] {
  return apply ? buildNumberedProposals(apply) : [];
}

function appliedItems(apply: DepartmentApplySummary | null): DepartmentApplyItem[] {
  return applyItems(apply).filter((item) => APPLIED_STATUSES.includes(item.applyStatus));
}

function decisionItems(apply: DepartmentApplySummary | null): DepartmentApplyItem[] {
  return applyItems(apply).filter((item) => DECISION_STATUSES.includes(item.applyStatus));
}

function studyItems(apply: DepartmentApplySummary | null): DepartmentApplyItem[] {
  return applyItems(apply).filter(
    (item) => !APPLIED_STATUSES.includes(item.applyStatus) && !DECISION_STATUSES.includes(item.applyStatus) && !CLOSED_STATUSES.includes(item.applyStatus)
  );
}

/**
 * Decisiones pendientes REALES de Pau.
 *
 * Cuando hay contrato de apply mandan sus estados: la aprobacion de esta
 * fase se pide por Telegram sobre lo que ya esta en el entorno de
 * pruebas, asi que una recomendacion que todavia no ha llegado ahi no le
 * pide nada a Pau hoy. Si NO hay contrato de apply (la pasada no llego a
 * planificar), se cae a las decisiones que declara el propio brief, para
 * no esconder una decision por un fallo de fase.
 */
function pendingDecisionCount(input: HumanDailyBriefEmailInput): number {
  return input.apply ? decisionItems(input.apply).length : input.brief.approvalsNeeded.length;
}

function stageRecord(brief: DepartmentDailyBrief, stage: DepartmentStageName): DepartmentStageRecord | undefined {
  return brief.stageStatuses.find((s) => s.stage === stage);
}

function brokenCriticalStages(brief: DepartmentDailyBrief): DepartmentStageName[] {
  return CRITICAL_STAGES.filter((stage) => {
    const record = stageRecord(brief, stage);
    return !record || record.status === "failed" || record.status === "invalid_output";
  });
}

// --- Modo del email --------------------------------------------------------

/**
 * CRITERIO EXACTO de las tres variantes, en este orden y sin empates:
 *
 * 1. ALERTA -- la pasada no ha producido una revision utilizable:
 *    a) quien ejecuta la pasada pasa `runFailureReason` no vacio, o
 *    b) ninguna etapa de la pasada quedo en `executed`, o
 *    c) alguna etapa CRITICA (`growth-director-v2`, `qa-reviewer`) falto
 *       del manifiesto o quedo en `failed` / `invalid_output`.
 *    Sin priorizacion ni veredicto de calidad no hay conclusiones de
 *    negocio, y un email normal con cero prioridades mentiria diciendo
 *    "todo correcto" cuando en realidad no se ha mirado nada.
 *    `blocked` y `not_available` NO son alerta: son estados previstos.
 *
 * 2. SIN TRABAJO -- la revision SI se completo y no hay nada que contar:
 *    cero prioridades del departamento, cero propuestas numeradas, cero
 *    cambios aplicados y cero decisiones pendientes. Es un resultado
 *    valido: el departamento ha mirado y no habia motivo para intervenir.
 *
 * 3. NORMAL -- todo lo demas.
 */
export function resolveBriefMode(input: HumanDailyBriefEmailInput): HumanBriefMode {
  const brief = input.brief;
  if (String(input.runFailureReason ?? "").trim().length > 0) return "alerta";
  if (brief.stageStatuses.filter((s) => s.status === "executed").length === 0) return "alerta";
  if (brokenCriticalStages(brief).length > 0) return "alerta";

  const nothingToReport =
    brief.topPriorities.length === 0 &&
    proposalsOf(input.apply).length === 0 &&
    appliedItems(input.apply).length === 0 &&
    pendingDecisionCount(input) === 0;
  return nothingToReport ? "sin_trabajo" : "normal";
}

// --- Asunto ----------------------------------------------------------------

/**
 * El asunto DISTINGUE la variante: un dia con veinte propuestas y un dia
 * roto no pueden llegar con el mismo titulo a la bandeja de entrada.
 */
export function buildHumanDailyBriefSubject(mode: HumanBriefMode, date: string): string {
  if (mode === "alerta") return `Zentry AI Department -- Necesita tu atencion -- ${date}`;
  if (mode === "sin_trabajo") return `Zentry AI Department -- Sin novedades -- ${date}`;
  return `Zentry AI Department -- Resumen diario -- ${date}`;
}

// --- Estructura del cuerpo -------------------------------------------------

/**
 * Una linea del cuerpo. Texto y HTML se renderizan de la MISMA
 * estructura: si se escribieran por separado, una de las dos versiones
 * acabaria contando algo distinto.
 */
interface BodyLine {
  text: string;
  /** URL revisable asociada, si la hay. Se enlaza en HTML y se imprime en texto. */
  url?: string;
}

interface BodyBlock {
  heading: string;
  lines: BodyLine[];
  /** Lineas sin vineta (parrafos de contexto). */
  paragraph?: boolean;
}

interface HumanBriefBody {
  title: string;
  statusLabel: string;
  /** Parrafo de entrada, justo debajo del estado. */
  intro: string[];
  blocks: BodyBlock[];
  /** Cierre fijo, siempre presente: que pasa con la web y como se responde. */
  footer: string[];
}

const APPROVAL_CHANNEL_LINE = "La aprobacion se hace por Telegram: te llega el aviso y respondes con un toque.";
const NO_TOUCH_LINE = "Nada se publica en la web real sin tu aprobacion. Este correo solo te informa.";
const NORMAL_INTRO = "Este es el resumen del trabajo del departamento de hoy, en tres puntos: que hemos visto en la web, que hemos hecho con ello y que necesito de ti.";

function decisionLines(input: HumanDailyBriefEmailInput): BodyLine[] {
  const items = decisionItems(input.apply).slice(0, MAX_DECISION_ITEMS);
  if (items.length > 0) {
    return items.map((item) => ({
      text: `Aprobar o rechazar: ${uncapitalize(humanPhrase(item.title, MAX_DECISION_WORDS, "Un cambio ya preparado en la web de pruebas."))}`,
      url: isReviewableUrl(item.traceability.stagingUrl ?? "") ? String(item.traceability.stagingUrl) : undefined,
    }));
  }
  if (!input.apply) {
    return input.brief.approvalsNeeded
      .slice(0, MAX_DECISION_ITEMS)
      .map((approval) => ({ text: `Aprobar o rechazar: ${uncapitalize(humanPhrase(stripDecisionPrefix(approval.decision), MAX_DECISION_WORDS, "Una propuesta del departamento."))}` }));
  }
  return [];
}

function doneLines(input: HumanDailyBriefEmailInput): BodyLine[] {
  const lines: BodyLine[] = appliedItems(input.apply)
    .slice(0, MAX_DONE_ITEMS)
    .map((item) => ({ text: humanPhrase(item.title, MAX_ITEM_WORDS, "Un cambio en una pagina de la web.") }));
  lines.push({ text: "Analisis de la web publica y de los datos de trafico y conversion." });
  lines.push({ text: "Comprobacion de que las paginas importantes siguen funcionando como toca." });
  return lines;
}

function detectedLine(input: HumanDailyBriefEmailInput): string {
  const proposals = proposalsOf(input.apply).length;
  const opportunities = proposals > 0 ? proposals : input.brief.topPriorities.length;
  if (opportunities === 0) return "Ninguna oportunidad nueva que merezca un cambio hoy.";
  return `${opportunities} ${plural(opportunities, "oportunidad importante", "oportunidades importantes")} para mejorar la web.`;
}

function resultLines(input: HumanDailyBriefEmailInput): BodyLine[] {
  const applied = appliedItems(input.apply);
  const verified = applied.filter((item) => item.validationStatus === "passed");
  const study = input.apply ? studyItems(input.apply).length : input.brief.topPriorities.length;
  const decisions = pendingDecisionCount(input);
  const lines: BodyLine[] = [];

  if (applied.length === 0) {
    lines.push({ text: "Ningun cambio aplicado todavia: lo de hoy sigue en preparacion." });
  } else if (verified.length === applied.length) {
    lines.push({
      text: `${applied.length} ${plural(applied.length, "cambio aplicado y verificado", "cambios aplicados y verificados")} en la web de pruebas, ${plural(applied.length, "listo para que lo mires", "listos para que los mires")}.`,
    });
  } else {
    lines.push({
      text: `${applied.length} ${plural(applied.length, "cambio aplicado", "cambios aplicados")} en la web de pruebas, ${verified.length} ya ${plural(verified.length, "verificado", "verificados")}.`,
    });
  }

  const reviewable = applied.find((item) => isReviewableUrl(item.traceability.stagingUrl ?? ""));
  if (reviewable) lines.push({ text: "Puedes verlo tu mismo aqui:", url: String(reviewable.traceability.stagingUrl) });

  lines.push({
    text:
      study === 0
        ? "Ninguna tarea pendiente de estudio."
        : `${study} ${plural(study, "tarea sigue", "tareas siguen")} en estudio y ${plural(study, "volvera", "volveran")} manana si ${plural(study, "mantiene", "mantienen")} sentido.`,
  });
  lines.push({
    text: decisions === 0 ? "Ninguna requiere tu decision." : `${decisions} ${plural(decisions, "requiere", "requieren")} tu decision.`,
  });
  return lines;
}

/** Cuerpo NORMAL: lo detectado, lo hecho, el resultado y lo que se te pide. */
function normalBody(input: HumanDailyBriefEmailInput): HumanBriefBody {
  const decisions = decisionLines(input);
  return {
    title: "Zentry AI Department -- Resumen diario",
    statusLabel: decisions.length > 0 ? "Necesita tu atencion" : "Todo correcto",
    intro: [NORMAL_INTRO],
    blocks: [
      {
        heading: "Hoy hemos detectado",
        lines: [{ text: detectedLine(input) }, { text: "Hemos revisado la web publica y los datos de rendimiento del ultimo dia." }],
      },
      { heading: "Hemos hecho", lines: doneLines(input) },
      { heading: "Resultado", lines: resultLines(input) },
      {
        heading: "Necesito de ti",
        lines:
          decisions.length > 0
            ? [...decisions, { text: APPROVAL_CHANNEL_LINE }]
            : [{ text: "Nada." }, { text: "Si aparece algo que necesite tu decision, te aviso el dia que pase." }],
      },
    ],
    footer: [NO_TOUCH_LINE, "Todo lo aplicado se puede deshacer si no te convence.", "El detalle tecnico completo queda guardado por si algun dia hace falta."],
  };
}

/** Cuerpo SIN TRABAJO: se ha mirado y no habia motivo para tocar nada. */
function noWorkBody(): HumanBriefBody {
  return {
    title: "Zentry AI Department -- Resumen diario",
    statusLabel: "Todo correcto",
    intro: [],
    blocks: [
      {
        heading: "Hoy hemos detectado",
        paragraph: true,
        lines: [
          {
            text: "Hoy el departamento ha revisado la web y los datos de rendimiento. No hemos detectado ningun cambio que justifique intervenir. Seguiremos monitorizando.",
          },
        ],
      },
      { heading: "Hemos hecho", lines: [{ text: "Analisis de la web publica y de los datos de trafico y conversion." }] },
      {
        heading: "Resultado",
        lines: [
          { text: "Ningun cambio aplicado: hoy no hacia falta ninguno." },
          { text: "Ninguna tarea pendiente de estudio." },
          { text: "Ninguna requiere tu decision." },
        ],
      },
      { heading: "Necesito de ti", lines: [{ text: "Nada." }] },
    ],
    footer: [NO_TOUCH_LINE],
  };
}

/**
 * Motivo HUMANO del fallo. Si quien ejecuta la pasada lo explica, manda
 * su explicacion (ya viene escrita para una persona). Si no, se deriva
 * de que parte del trabajo se quedo sin hacer, SIN nombrar agentes ni
 * estados internos.
 */
export function humanFailureReason(input: HumanDailyBriefEmailInput): string {
  const declared = String(input.runFailureReason ?? "").trim();
  if (declared.length > 0) return humanPhrase(declared, 24, "Una parte del proceso no llego a terminar.");
  const broken = brokenCriticalStages(input.brief);
  if (broken.length > 0) return `${STAGE_HUMAN_WORK[broken[0]].charAt(0).toUpperCase()}${STAGE_HUMAN_WORK[broken[0]].slice(1)} no llego a terminar, asi que hoy no hay conclusiones fiables.`;
  return "El proceso de revision no llego a terminar, asi que hoy no hay conclusiones fiables.";
}

/** Cuerpo ALERTA: no puede parecer un resumen normal ni de lejos. */
function alertBody(input: HumanDailyBriefEmailInput): HumanBriefBody {
  return {
    title: "Zentry AI Department -- Necesita tu atencion",
    statusLabel: "Necesita atencion",
    intro: [],
    blocks: [
      {
        heading: "Que ha pasado",
        paragraph: true,
        lines: [{ text: "El departamento no ha podido completar la revision de hoy." }, { text: `Motivo: ${humanFailureReason(input)}` }],
      },
      {
        heading: "Que significa esto",
        lines: [
          { text: "Hoy no hay resumen de trabajo: la revision no llego a terminar." },
          { text: "No se ha tocado nada de la web: ningun cambio se ha aplicado ni publicado." },
          { text: "El departamento lo volvera a intentar en la proxima revision diaria." },
        ],
      },
      { heading: "Necesito de ti", lines: [{ text: "Nada por ahora. Si vuelve a pasar manana te lo digo y lo miramos." }] },
    ],
    footer: ["Los detalles tecnicos de este fallo quedan guardados aparte; aqui no hacen falta."],
  };
}

export function buildHumanBriefBody(input: HumanDailyBriefEmailInput, mode: HumanBriefMode): HumanBriefBody {
  if (mode === "alerta") return alertBody(input);
  if (mode === "sin_trabajo") return noWorkBody();
  return normalBody(input);
}

// --- Render ----------------------------------------------------------------

export function renderHumanBriefText(body: HumanBriefBody, date: string): string {
  const lines: string[] = [];
  lines.push(body.title);
  lines.push(`Fecha: ${date}`);
  lines.push("");
  lines.push(`Estado: ${body.statusLabel}`);
  lines.push("");
  for (const line of body.intro) {
    lines.push(line);
    lines.push("");
  }
  for (const block of body.blocks) {
    lines.push(block.heading);
    for (const line of block.lines) {
      lines.push(block.paragraph ? line.text : `- ${line.text}`);
      if (line.url) lines.push(`  ${line.url}`);
    }
    lines.push("");
  }
  for (const line of body.footer) lines.push(line);
  lines.push("");
  return lines.join("\n");
}

function htmlLine(line: BodyLine, paragraph: boolean): string {
  const link = line.url ? ` <a href="${escapeHtml(line.url)}" style="color:#1a4fbf;">${escapeHtml(line.url)}</a>` : "";
  if (paragraph) return `<p style="margin:0 0 10px;color:#33415c;">${escapeHtml(line.text)}${link}</p>`;
  return `<li style="margin:0 0 8px;">${escapeHtml(line.text)}${link}</li>`;
}

export function renderHumanBriefHtml(body: HumanBriefBody, date: string, mode: HumanBriefMode): string {
  const accent = mode === "alerta" ? "#b3261e" : "#1b6b3a";
  const blocks = body.blocks
    .map((block) => {
      const content = block.paragraph
        ? block.lines.map((line) => htmlLine(line, true)).join("")
        : `<ul style="margin:0 0 12px;padding-left:20px;">${block.lines.map((line) => htmlLine(line, false)).join("")}</ul>`;
      return `<h2 style="font-size:15px;margin:22px 0 8px;color:#0b1b33;">${escapeHtml(block.heading)}</h2>${content}`;
    })
    .join("");
  const footer = body.footer.map((line) => `<p style="margin:0 0 6px;color:#54617a;font-size:13px;">${escapeHtml(line)}</p>`).join("");
  const intro = body.intro.map((line) => `<p style="margin:0 0 12px;color:#33415c;">${escapeHtml(line)}</p>`).join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#33415c;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:19px;margin:0 0 4px;color:#0b1b33;">${escapeHtml(body.title)}</h1>
  <p style="margin:0 0 16px;color:#54617a;font-size:13px;">${escapeHtml(date)}</p>
  <p style="margin:0 0 12px;font-size:16px;color:${accent};"><strong>Estado:</strong> ${escapeHtml(body.statusLabel)}</p>
  ${intro}
  ${blocks}
  <div style="margin-top:22px;border-top:1px solid #d8dce3;padding-top:12px;">${footer}</div>
</div>`;
}

/**
 * Email humano completo. Misma forma de salida que `buildDailyBriefEmail`
 * (`subject` / `text` / `html`), asi que el script que envia el correo no
 * cambia de forma al pasar de uno a otro.
 */
export function buildHumanDailyBriefEmail(input: HumanDailyBriefEmailInput): DailyBriefEmail {
  const date = input.date ?? input.brief.generatedAt.slice(0, 10);
  const mode = resolveBriefMode(input);
  const body = buildHumanBriefBody(input, mode);
  return {
    subject: buildHumanDailyBriefSubject(mode, date),
    text: renderHumanBriefText(body, date),
    html: renderHumanBriefHtml(body, date, mode),
  };
}
