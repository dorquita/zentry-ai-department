import * as fs from "fs";
import * as path from "path";
import { readCurrentStagingExecutions } from "../core/staging-executions";
import { getWordpressPage, getWordpressMedia } from "../adapters/wordpress";
import { resolveWordpressEnv, resolveWordpressTargetUrl } from "../adapters/wordpress-backend";
import { emitEvent, readAllEvents } from "../core/department-events";
import { logger } from "../core/logger";
import { StagingExecution } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";
import { recordStagingQaResult } from "../core/staging-qa-results";

/**
 * Staging QA Agent (Fase O12) — 100% SOLO LECTURA. Nunca llama a ningun
 * endpoint de escritura de WordPress ni de ninguna otra API: solo hace
 * peticiones GET (a la home de staging y, via la REST API ya
 * autenticada de src/adapters/wordpress.ts, a cada pagina que el
 * Staging Executor haya aplicado). No modifica nada, no revierte nada
 * (eso es responsabilidad manual via
 * `npm run staging-executions:update -- --status rolled_back`, ver
 * docs/staging-rollback.md).
 *
 * Dos categorias de comprobacion:
 *
 * 1. Salud general de staging (una vez por pasada): la home de
 *    WORDPRESS_STAGING_BASE_URL carga con 200, no muestra errores PHP
 *    visibles, y conserva `noindex` (staging nunca debe indexarse).
 * 2. Por cada ejecucion `applied_to_staging` (via la REST API
 *    autenticada, porque una pagina `draft` no es visible por HTTP
 *    publico sin login): titulo presente, contenido no vacio, al menos
 *    un enlace interno, algun texto tipo CTA, y ausencia de cualquier
 *    etiqueta `<form>` (ningun change pack de este proyecto genera
 *    formularios — su presencia seria inesperada y se marca como fallo).
 *
 * "Produccion no tocada" NO se verifica haciendo una peticion a
 * produccion (evitar trafico innecesario a un sitio real) — se confirma
 * por diseno: este agente solo conoce `WORDPRESS_STAGING_BASE_URL` y la
 * REST API de staging: no existe ninguna variable ni codigo en este
 * fichero que apunte a produccion.
 */

const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "staging-qa");
const AGENT_NAME = "staging-qa-agent";

const PHP_ERROR_PATTERNS = [
  /fatal error/i,
  /parse error/i,
  /warning:\s*\S/i,
  /deprecated:\s*\S/i,
  /notice:\s*\S/i,
  /uncaught exception/i,
  /stack trace:/i,
];

const CTA_KEYWORDS = ["presupuesto", "contacto", "whatsapp", "llamar", "solicitar", "cotiza", "contactar"];

// Fase O12.9 -- umbral de peso de imagen para el Visual QA. 500KB es un
// umbral pragmatico (no una recomendacion final de performance): una
// imagen hero de una landing NUNCA deberia acercarse a 2MB (como el PNG
// original de la Fase O12.6/O12.7), pero 500KB sigue siendo generoso
// comparado con el objetivo real recomendado (~150-250KB en WebP, ver
// docs/visual-qa-image-optimization.md). Es un warning, nunca bloquea
// el borrador.
const IMAGE_WEIGHT_WARNING_BYTES = 500 * 1024;

function findLatestDepartmentRunId(): string {
  const events = readAllEvents();
  if (events.length === 0) {
    throw new Error("No hay eventos en data/department-events.jsonl. Ejecuta primero al menos un agente del departamento.");
  }
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

interface SiteHealthCheck {
  reachable: boolean;
  statusCode?: number;
  status200: boolean;
  noPhpErrorsVisible: boolean;
  noindexPresent: boolean;
  error?: string;
}

async function checkStagingSiteHealth(): Promise<SiteHealthCheck> {
  let baseUrl: string;
  try {
    baseUrl = resolveWordpressTargetUrl();
  } catch (err) {
    return {
      reachable: false,
      status200: false,
      noPhpErrorsVisible: false,
      noindexPresent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    // Cache-busting deliberado: staging esta detras de un CDN/cache de
    // Hostinger (LiteSpeed Cache + HCDN) que puede servir una respuesta
    // cacheada de hace horas. Una peticion sin parametro unico puede dar
    // un falso negativo en "noindex preservado" (o en cualquier otro
    // chequeo) si la cache guardo una version anterior a un cambio real.
    // Anadir un query param unico + Cache-Control fuerza una respuesta
    // fresca del origen en cada pasada de QA.
    const cacheBustedUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}_stagingQa=${Date.now()}`;
    const response = await fetch(cacheBustedUrl, { method: "GET", headers: { "Cache-Control": "no-cache" } });
    const bodyText = await response.text();
    const hasPhpError = PHP_ERROR_PATTERNS.some((re) => re.test(bodyText));
    const hasNoindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(bodyText);
    return {
      reachable: true,
      statusCode: response.status,
      status200: response.status === 200,
      noPhpErrorsVisible: !hasPhpError,
      noindexPresent: hasNoindex,
    };
  } catch (err) {
    return {
      reachable: false,
      status200: false,
      noPhpErrorsVisible: false,
      noindexPresent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Fase O12.9 -- Visual QA de la imagen hero (si existe). Siempre
// "warning", nunca bloquea overallPass: un peso alto o un formato no
// optimizado es una mejora pendiente, no un borrador roto.
interface VisualQaResult {
  checked: boolean;
  heroImagePresent: boolean;
  wordpressMediaId?: number;
  format?: string;
  fileSizeBytes?: number;
  altTextPresent: boolean;
  weightWarning: boolean;
  formatWarning: boolean;
  error?: string;
}

const EMPTY_VISUAL_QA: VisualQaResult = {
  checked: false,
  heroImagePresent: false,
  altTextPresent: false,
  weightWarning: false,
  formatWarning: false,
};

// Fase O13.6b -- checklist obligatoria de QA visual/SEO/CRO (postmortem:
// el QA tecnico dejaba pasar landings planas porque nunca comprobaba
// estructura visual real, solo presencia de texto/enlaces/CTA por
// palabra clave). 100% sincrono sobre el HTML ya leido -- no hace
// ninguna llamada de red adicional.
export interface LandingQaResult {
  buttonCount: number;
  visualBlockCount: number;
  hasAboveFoldCta: boolean;
  hasProperHeadingStructure: boolean;
  h1Count: number;
  h2Count: number;
  contentLength: number;
  hasSufficientContent: boolean;
  hasPlaceholders: boolean;
  hasSuspiciousClaims: boolean;
  pass: boolean;
  warnings: string[];
  failures: string[];
}

const EMPTY_LANDING_QA: LandingQaResult = {
  buttonCount: 0,
  visualBlockCount: 0,
  hasAboveFoldCta: false,
  hasProperHeadingStructure: false,
  h1Count: 0,
  h2Count: 0,
  contentLength: 0,
  hasSufficientContent: false,
  hasPlaceholders: false,
  hasSuspiciousClaims: false,
  pass: false,
  warnings: [],
  failures: ["No se pudo verificar (pagina no disponible)."],
};

const LANDING_PLACEHOLDER_PATTERNS = [
  /pendiente de confirmar/i,
  /confirmar\s+(plazo|garantia)/i,
  /por\s+definir/i,
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/i,
];
const SUSPICIOUS_CLAIM_PATTERNS = [
  /\d+%\s+de\s+descuento/i,
  /garantia\s+de\s+\d+\s+(anos|años|meses)/i,
  /entrega\s+en\s+\d+\s+(dias|días|horas)/i,
  /el\s+mejor\s+del\s+mercado/i,
  /numero\s+1\s+en/i,
];

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checklist obligatoria (Fase O13.6b): minimo 2 botones reales, minimo 3
 * bloques visuales (columnas/botones/imagenes Gutenberg), CTA above the
 * fold, estructura H1 unico + >=2 H2, contenido suficiente, sin
 * placeholders, sin claims sospechosos (heuristica, solo warning). Pura
 * -- solo inspecciona el HTML ya leido, ninguna llamada de red.
 */
export function checkLandingQuality(contentHtml: string): LandingQaResult {
  const buttonCount = (contentHtml.match(/wp-block-button__link/g) || []).length;
  const columnsBlockCount = (contentHtml.match(/<!-- wp:columns/g) || []).length;
  const buttonsBlockCount = (contentHtml.match(/<!-- wp:buttons/g) || []).length;
  const imageBlockCount = (contentHtml.match(/<!-- wp:image/g) || []).length;
  const visualBlockCount = columnsBlockCount + buttonsBlockCount + imageBlockCount;

  // El primer encabezado (h1 o h2) puede ser el propio titular del hero --
  // "above the fold" significa antes del SEGUNDO encabezado, no del
  // primero (si solo hay 0 o 1 encabezado, no hay limite: todo esta
  // "arriba del pliegue"). Fase O13.7b: antes se comparaba solo contra el
  // primer H2, lo cual se rompia en cuanto el hero paso a ser un H2.
  const headingPositions = [...contentHtml.matchAll(/<h[12][\s>]/gi)].map((m) => m.index ?? -1).filter((i) => i >= 0);
  const foldBoundaryIndex = headingPositions.length >= 2 ? headingPositions[1] : Infinity;
  const firstButtonIndex = contentHtml.search(/wp-block-button__link/i);
  const hasAboveFoldCta = firstButtonIndex >= 0 && firstButtonIndex < foldBoundaryIndex;

  // 0 H1 (contenido con blueprint, el tema ya pone el suyo) o 1 H1
  // (flujo plano antiguo sin blueprint) son ambos validos; nunca 2+.
  const h1Count = (contentHtml.match(/<h1[\s>]/gi) || []).length;
  const h2Count = (contentHtml.match(/<h2[\s>]/gi) || []).length;
  const hasProperHeadingStructure = h1Count <= 1 && h2Count >= 2;

  const plainText = stripHtmlToPlainText(contentHtml);
  const contentLength = plainText.length;
  const hasSufficientContent = contentLength >= 400;

  const hasPlaceholders = LANDING_PLACEHOLDER_PATTERNS.some((re) => re.test(plainText));
  const hasSuspiciousClaims = SUSPICIOUS_CLAIM_PATTERNS.some((re) => re.test(plainText));

  const failures: string[] = [];
  const warnings: string[] = [];

  if (buttonCount < 2) failures.push(`Solo ${buttonCount} boton(es) real(es) detectado(s) -- minimo 2.`);
  if (visualBlockCount < 3) failures.push(`Solo ${visualBlockCount} bloque(s) visual(es) detectado(s) (columnas/botones/imagenes) -- minimo 3.`);
  if (!hasAboveFoldCta) failures.push("No hay ningun CTA (boton) antes del primer H2 -- falta CTA above the fold.");
  if (!hasProperHeadingStructure) failures.push(`Estructura de encabezados incorrecta: ${h1Count} H1 (se espera 0 o 1, nunca 2+), ${h2Count} H2 (se espera 2 o mas).`);
  if (!hasSufficientContent) failures.push(`Contenido de texto insuficiente (${contentLength} caracteres, minimo 400) para la intencion de busqueda.`);
  if (hasPlaceholders) failures.push("Se detecto texto de placeholder/editorial sin resolver visible en el contenido.");
  if (hasSuspiciousClaims) warnings.push("Posible claim/cifra sin verificar (heuristica: garantias/plazos/porcentajes especificos) -- revisar a mano.");

  return {
    buttonCount,
    visualBlockCount,
    hasAboveFoldCta,
    hasProperHeadingStructure,
    h1Count,
    h2Count,
    contentLength,
    hasSufficientContent,
    hasPlaceholders,
    hasSuspiciousClaims,
    pass: failures.length === 0,
    warnings,
    failures,
  };
}

interface DraftQaResult {
  executionId: string;
  keyword: string;
  changeType: string;
  wordpressPageId?: number;
  titlePresent: boolean;
  contentNonEmpty: boolean;
  hasInternalLink: boolean;
  linkCheckSeverity: "critical" | "warning";
  hasCta: boolean;
  formTagAbsent: boolean;
  visualQa: VisualQaResult;
  landingQa: LandingQaResult;
  overallPass: boolean;
  hasWarnings: boolean;
  notes: string[];
}

function isInternalLink(href: string, stagingBaseUrl: string): boolean {
  return href.startsWith("/") || href.startsWith(stagingBaseUrl);
}

// Fase O12.9 — detecta el bloque de imagen hero insertado por
// insert-hero-image-into-draft.ts (marcador className "hero-image") y
// revisa su peso/formato/alt text real via la Media Library. 100%
// lectura (getWordpressMedia es un GET, sin gate) — si algo falla aqui
// (media borrada, red, etc.) se degrada a un aviso, nunca a un fallo
// del borrador entero.
async function checkVisualQa(contentHtml: string): Promise<VisualQaResult> {
  const heroMatch = /hero-image[\s\S]*?<img[^>]*alt="([^"]*)"[^>]*class="wp-image-(\d+)"/i.exec(contentHtml);
  if (!heroMatch) {
    return { ...EMPTY_VISUAL_QA, checked: true, heroImagePresent: false };
  }

  const [, altAttr, mediaIdRaw] = heroMatch;
  const wordpressMediaId = Number(mediaIdRaw);
  const altTextPresent = altAttr.trim().length > 0;

  try {
    const media = await getWordpressMedia(wordpressMediaId);
    const fileSizeBytes = media.fileSize;
    const weightWarning = typeof fileSizeBytes === "number" && fileSizeBytes > IMAGE_WEIGHT_WARNING_BYTES;
    const formatWarning = media.mimeType !== "image/webp";
    return {
      checked: true,
      heroImagePresent: true,
      wordpressMediaId,
      format: media.mimeType,
      fileSizeBytes,
      altTextPresent,
      weightWarning,
      formatWarning,
    };
  } catch (err) {
    return {
      checked: true,
      heroImagePresent: true,
      wordpressMediaId,
      altTextPresent,
      weightWarning: false,
      formatWarning: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Fase O12.2 — tipos de change pack cuyo contenido generado es
// deliberadamente un BRIEF/borrador editorial (title/H1/H2/copy/FAQ):
// los "enlaces internos sugeridos" de origen son instrucciones en texto
// para un humano, no URLs reales (ver buildWordpressContentHtml() en
// wordpress-draft-agent.ts, que nunca fabrica un <a href> a partir de
// una instruccion). Para estos tipos, la ausencia de un enlace real es
// un WARNING esperado, nunca un fallo critico. Cualquier changeType que
// no este en esta lista se trata como "final/publicable" -- fallback
// deliberadamente conservador (mejor un falso "fallo" por exceso de
// rigor que dejar pasar contenido final sin enlaces reales).
const BRIEF_CHANGE_TYPES = new Set(["seo_on_page_update", "new_content_page", "content_update", "cro_conversion_update"]);

function classifyLinkCheckSeverity(changeType: string): "critical" | "warning" {
  return BRIEF_CHANGE_TYPES.has(changeType) ? "warning" : "critical";
}

async function checkDraft(execution: StagingExecution, stagingBaseUrl: string): Promise<DraftQaResult> {
  const notes: string[] = [];
  const linkCheckSeverity = classifyLinkCheckSeverity(execution.changeType);

  if (typeof execution.wordpressPageId !== "number") {
    return {
      executionId: execution.executionId,
      keyword: execution.keyword,
      changeType: execution.changeType,
      titlePresent: false,
      contentNonEmpty: false,
      hasInternalLink: false,
      linkCheckSeverity,
      hasCta: false,
      formTagAbsent: true,
      visualQa: EMPTY_VISUAL_QA,
      landingQa: EMPTY_LANDING_QA,
      overallPass: false,
      hasWarnings: false,
      notes: ["Sin wordpressPageId registrado — no se puede verificar."],
    };
  }

  try {
    const page = await getWordpressPage(execution.wordpressPageId);
    const titlePresent = page.title.trim().length > 0;
    const contentNonEmpty = page.contentHtml.trim().length > 0;
    const hrefMatches = [...page.contentHtml.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    const hasInternalLink = hrefMatches.some((href) => isInternalLink(href, stagingBaseUrl));
    const lowerContent = page.contentHtml.toLowerCase();
    const hasCta = CTA_KEYWORDS.some((kw) => lowerContent.includes(kw));
    const formTagAbsent = !/<form[\s>]/i.test(page.contentHtml);
    const visualQa = await checkVisualQa(page.contentHtml);
    const landingQa = checkLandingQuality(page.contentHtml);

    let hasWarnings = false;

    if (!titlePresent) notes.push("Titulo vacio.");
    if (!contentNonEmpty) notes.push("Contenido vacio.");
    if (!hasInternalLink) {
      if (linkCheckSeverity === "warning") {
        notes.push(
          `WARNING (no bloqueante): sin enlaces internos reales detectados. Change pack tipo "${execution.changeType}" es un brief/borrador editorial — los enlaces sugeridos de origen son instrucciones para un humano, no URLs reales (quedan como comentario HTML en el contenido del borrador). No cuenta como fallo.`
        );
        hasWarnings = true;
      } else {
        notes.push(
          `FALLO: sin enlaces internos reales detectados. Change pack tipo "${execution.changeType}" deberia incluir enlaces reales.`
        );
      }
    }
    if (!hasCta) notes.push("Sin texto tipo CTA detectado (heuristica de palabras clave, puede dar falso negativo).");
    if (!formTagAbsent) notes.push("Se detecto una etiqueta <form> — inesperado, ningun change pack de este proyecto deberia generar formularios.");
    if (page.status !== "draft") notes.push(`Estado actual en WordPress: "${page.status}" (se esperaba "draft").`);

    if (visualQa.heroImagePresent) {
      if (!visualQa.altTextPresent) {
        notes.push("WARNING (no bloqueante) Visual QA: la imagen hero no tiene alt text.");
        hasWarnings = true;
      }
      if (visualQa.error) {
        notes.push(`WARNING (no bloqueante) Visual QA: no se pudo leer la media ${visualQa.wordpressMediaId}: ${visualQa.error}`);
        hasWarnings = true;
      } else {
        if (visualQa.weightWarning) {
          const kb = visualQa.fileSizeBytes ? (visualQa.fileSizeBytes / 1024).toFixed(0) : "?";
          notes.push(
            `WARNING (no bloqueante) Visual QA: la imagen hero pesa ${kb}KB (> 500KB). Se recomienda optimizar (ver npm run assets:optimize-webp).`
          );
          hasWarnings = true;
        }
        if (visualQa.formatWarning) {
          notes.push(
            `WARNING (no bloqueante) Visual QA: la imagen hero esta en formato "${visualQa.format}", no WebP. Se recomienda generar una version WebP (ver npm run assets:optimize-webp).`
          );
          hasWarnings = true;
        }
      }
    }

    for (const failure of landingQa.failures) {
      notes.push(`FALLO QA VISUAL/SEO/CRO: ${failure}`);
    }
    for (const warning of landingQa.warnings) {
      notes.push(`WARNING (no bloqueante) QA VISUAL/SEO/CRO: ${warning}`);
      hasWarnings = true;
    }

    const linkCheckBlocks = !hasInternalLink && linkCheckSeverity === "critical";
    const overallPass = titlePresent && contentNonEmpty && formTagAbsent && page.status === "draft" && !linkCheckBlocks;

    return {
      executionId: execution.executionId,
      keyword: execution.keyword,
      changeType: execution.changeType,
      wordpressPageId: execution.wordpressPageId,
      titlePresent,
      contentNonEmpty,
      hasInternalLink,
      linkCheckSeverity,
      hasCta,
      formTagAbsent,
      visualQa,
      landingQa,
      overallPass,
      hasWarnings,
      notes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      executionId: execution.executionId,
      keyword: execution.keyword,
      changeType: execution.changeType,
      wordpressPageId: execution.wordpressPageId,
      titlePresent: false,
      contentNonEmpty: false,
      hasInternalLink: false,
      linkCheckSeverity,
      hasCta: false,
      formTagAbsent: true,
      visualQa: EMPTY_VISUAL_QA,
      landingQa: EMPTY_LANDING_QA,
      overallPass: false,
      hasWarnings: false,
      notes: [`Fallo al leer la pagina via REST API: ${message}`],
    };
  }
}

export interface StagingQaAgentRunResult {
  departmentRunId: string;
  siteHealth: SiteHealthCheck;
  draftResults: DraftQaResult[];
  checkedCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  reportPath: string;
}

function buildReportMarkdown(result: StagingQaAgentRunResult, generatedAt: string): string {
  const lines: string[] = [];
  const executionDate = generatedAt.slice(0, 10);

  lines.push(`# Staging QA Agent — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push("");

  lines.push("## Salud general de staging");
  lines.push("");
  const h = result.siteHealth;
  lines.push(`- **Alcanzable:** ${h.reachable ? "si" : "no"}${h.error ? ` (${h.error})` : ""}`);
  lines.push(`- **HTTP 200:** ${h.status200 ? "si" : "no"} ${h.statusCode ? `(codigo ${h.statusCode})` : ""}`);
  lines.push(`- **Sin errores PHP visibles:** ${h.noPhpErrorsVisible ? "si" : "no"}`);
  lines.push(`- **noindex preservado:** ${h.noindexPresent ? "si" : "no — REVISAR, staging nunca deberia indexarse"}`);
  lines.push("");

  lines.push(`## Borradores verificados (${result.checkedCount})`);
  lines.push("");
  lines.push(`Pasan: **${result.passCount}** (de los cuales con warning no bloqueante: **${result.warnCount}**). Fallan: **${result.failCount}**.`);
  lines.push("");
  if (result.draftResults.length === 0) {
    lines.push("Ninguno (no hay ejecuciones `applied_to_staging` todavia).");
  } else {
    for (const d of result.draftResults) {
      const statusLabel = d.overallPass ? (d.hasWarnings ? "PASA (con warning)" : "PASA") : "FALLA";
      lines.push(`### ${statusLabel} — ${d.keyword} (\`${d.executionId}\`)`);
      lines.push("");
      lines.push(`- changeType: ${d.changeType} (criterio de enlaces: ${d.linkCheckSeverity === "warning" ? "no bloqueante" : "bloqueante"})`);
      lines.push(`- wordpressPageId: ${d.wordpressPageId ?? "-"}`);
      lines.push(`- title presente: ${d.titlePresent ? "si" : "no"} | contenido no vacio: ${d.contentNonEmpty ? "si" : "no"}`);
      lines.push(`- enlace interno: ${d.hasInternalLink ? "si" : "no"} | CTA detectado (heuristica): ${d.hasCta ? "si" : "no"} | sin <form>: ${d.formTagAbsent ? "si" : "no"}`);
      if (d.visualQa.heroImagePresent) {
        const kb = d.visualQa.fileSizeBytes ? `${(d.visualQa.fileSizeBytes / 1024).toFixed(0)}KB` : "?";
        lines.push(
          `- imagen hero: media ${d.visualQa.wordpressMediaId} | formato ${d.visualQa.format ?? "?"} | peso ${kb} | alt text: ${d.visualQa.altTextPresent ? "si" : "no"}`
        );
      } else if (d.visualQa.checked) {
        lines.push("- imagen hero: no detectada en este draft.");
      }
      lines.push(
        `- QA visual/SEO/CRO (Fase O13.6b): ${d.landingQa.pass ? "PASA" : "FALLA"} -- botones: ${d.landingQa.buttonCount} | bloques visuales: ${d.landingQa.visualBlockCount} | CTA above the fold: ${d.landingQa.hasAboveFoldCta ? "si" : "no"} | estructura H1/H2: ${d.landingQa.hasProperHeadingStructure ? "ok" : "mal"} | contenido: ${d.landingQa.contentLength} caracteres`
      );
      if (d.notes.length > 0) {
        for (const note of d.notes) lines.push(`  - ${note}`);
      }
      lines.push("");
    }
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- Este agente es 100% solo lectura: no existe ninguna llamada de escritura en todo el fichero.");
  lines.push("- No se ha revertido nada automaticamente. Un fallo aqui NO dispara un rollback — eso sigue siendo una decision humana explicita (ver docs/staging-rollback.md).");
  lines.push("- Produccion no se ha tocado: este agente solo conoce WORDPRESS_STAGING_BASE_URL y la REST API de staging; no existe ninguna referencia a produccion en su codigo.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: StagingQaAgentRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `staging-qa-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runStagingQaAgent(departmentRunId?: string): Promise<StagingQaAgentRunResult> {
  const deptRunId = departmentRunId ?? findLatestDepartmentRunId();
  logger.info("Staging QA Agent iniciado", { departmentRunId: deptRunId, wordpressEnv: resolveWordpressEnv() });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Staging QA Agent iniciado" });

  const siteHealth = await checkStagingSiteHealth();

  let stagingBaseUrl = "";
  try {
    stagingBaseUrl = resolveWordpressTargetUrl();
  } catch {
    stagingBaseUrl = "";
  }

  const appliedExecutions = readCurrentStagingExecutions().filter((e) => e.status === "applied_to_staging");
  const draftResults: DraftQaResult[] = [];
  for (const execution of appliedExecutions) {
    const draftResult = await checkDraft(execution, stagingBaseUrl);
    draftResults.push(draftResult);
    // Fase O27 -- persiste el resultado (antes solo vivia en el markdown
    // del dia). Necesario para poder derivar qa_passed/qa_failed como
    // estado real de la oportunidad (ver src/core/opportunity-state.ts),
    // en vez de tener que releer el informe de un dia concreto a mano.
    recordStagingQaResult({
      executionId: draftResult.executionId,
      keyword: draftResult.keyword,
      changeType: draftResult.changeType,
      wordpressPageId: draftResult.wordpressPageId,
      overallPass: draftResult.overallPass,
      hasWarnings: draftResult.hasWarnings,
      failures: [...draftResult.landingQa.failures, ...(draftResult.overallPass ? [] : draftResult.notes)],
      warnings: [...draftResult.landingQa.warnings],
    });
  }

  const passCount = draftResults.filter((d) => d.overallPass).length;
  const warnCount = draftResults.filter((d) => d.overallPass && d.hasWarnings).length;
  const failCount = draftResults.length - passCount;

  if (failCount > 0) {
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "warning_detected",
      priority: "high",
      summary: `Staging QA detecto ${failCount} borrador(es) con problemas`,
      payload: { failCount, checkedCount: draftResults.length },
    });
  }
  if (!siteHealth.status200 || !siteHealth.noindexPresent) {
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "warning_detected",
      priority: "high",
      summary: "Staging QA: problema de salud general en staging (HTTP o noindex)",
      payload: { statusCode: siteHealth.statusCode, noindexPresent: siteHealth.noindexPresent },
    });
  }

  const generatedAt = new Date().toISOString();
  const result: StagingQaAgentRunResult = {
    departmentRunId: deptRunId,
    siteHealth,
    draftResults,
    checkedCount: draftResults.length,
    passCount,
    warnCount,
    failCount,
    reportPath: "",
  };
  result.reportPath = writeReport(result, generatedAt);

  logger.info(
    `Staging QA Agent finalizado. Verificados: ${draftResults.length}. Pasan: ${passCount} (con warning: ${warnCount}). Fallan: ${failCount}.`,
    { reportPath: result.reportPath }
  );
  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Staging QA Agent finalizado: ${passCount}/${draftResults.length} borrador(es) pasan (${warnCount} con warning)`,
    payload: { checkedCount: draftResults.length, passCount, warnCount, failCount, reportPath: result.reportPath },
  });

  return result;
}
