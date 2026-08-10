import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { classifyKeyword, BRAND_INTENT_CATEGORY_LABELS } from "../core/brand-intent-router";
import { readAllJobs } from "../core/job-registry";
import { emitEvent } from "../core/department-events";
import { buildDepartmentRunId } from "../core/department-run-id";
import { logger } from "../core/logger";
import { BrandIntentResult, TargetKeyword } from "../core/types";
import { resolveActiveClientPaths } from "../core/client-paths";
import { resolveActiveClientConfigPath } from "../core/client-config";

/**
 * Competitor Intelligence Agent — READ + PROPOSE only.
 *
 * Lee HTML PUBLICO de un puñado de URLs por competidor, definidas a mano
 * en `configPaths.competitors` del ClientConfig ACTIVO (Fase O16.1 — para
 * "zentry" hoy es `clients/zentry/competitors.json`, una copia mantenida
 * en sincronia manual con la legacy `config/competitors.json`). Nunca
 * hace login, nunca intenta saltarse bloqueos, respeta robots.txt, usa un
 * rate limit conservador y un tope de URLs por dominio. No modifica nada
 * externo ni interno salvo escribir su propio informe y eventos.
 *
 * `seo-target-keywords.json` SIGUE leyendose de `config/` directamente
 * (pendiente, comparte fichero con SEO Watcher — ver Fase O16.1 Lote 4
 * en docs/multi-client-architecture.md).
 */

const CONFIG_DIR = path.join(__dirname, "..", "..", "config");
const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "competitor-intelligence");
const AGENT_NAME = "competitor-intelligence";

interface CompetitorConfig {
  rateLimitMs: number;
  requestTimeoutMs: number;
  maxUrlsPerDomain: number;
  userAgent: string;
  respectRobotsTxt: boolean;
  competitors: Array<{
    name: string;
    domain: string;
    role: "competitor" | "reference";
    notes?: string;
    brandTokens?: string[];
    urls: string[];
  }>;
}

interface PageAnalysis {
  competitor: string;
  role: "competitor" | "reference";
  url: string;
  status: "ok" | "skipped_robots" | "error";
  title?: string;
  metaDescription?: string;
  h1s?: string[];
  h2s?: string[];
  error?: string;
}

export interface KeywordGapCandidate {
  term: string;
  frequency: number;
  sourceCompetitors: string[];
  brandIntent: BrandIntentResult;
  suggestedForSem: boolean;
}

export interface ContentGapCandidate {
  term: string;
  kind: "sector" | "material";
  sourceCompetitors: string[];
}

export interface CompetitorIntelligenceRunResult {
  departmentRunId: string;
  generatedAt: string;
  pages: PageAnalysis[];
  keywordGaps: KeywordGapCandidate[];
  contentGaps: ContentGapCandidate[];
  warnings: string[];
  reportPath: string;
}

function loadCompetitorConfig(): CompetitorConfig {
  const raw = fs.readFileSync(resolveActiveClientConfigPath("competitors"), "utf-8");
  return JSON.parse(raw) as CompetitorConfig;
}

function loadTargetKeywords(): TargetKeyword[] {
  const raw = fs.readFileSync(path.join(CONFIG_DIR, "seo-target-keywords.json"), "utf-8");
  return (JSON.parse(raw) as { keywords: TargetKeyword[] }).keywords;
}

// --- utilidades de texto (sin caracteres de control/acentuados tecleados
// literalmente: se construyen por punto de codigo, ver memoria de sesiones
// anteriores sobre corrupcion silenciosa de bytes especiales) ---

const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "");
}

// Palabras "pegamento": no pueden abrir ni cerrar una frase candidata (ni
// ser el n-grama entero), pero SI pueden aparecer en medio — "de" y "para"
// son conectores habituales en keywords comerciales reales de este
// negocio ("taquillas de melamina", "cerraduras para taquillas"), asi que
// NO se descartan de raiz como las stopwords clasicas.
const GLUE_WORDS = new Set([
  "de", "la", "el", "en", "y", "a", "los", "las", "del", "al", "o", "que",
  "un", "una", "es", "se", "su", "sus", "como", "mas", "tu", "este", "esta",
  "estos", "estas", "todo", "todos", "muy", "sin", "sobre", "por", "con",
  "the", "and", "for", "with", "our", "your", "you", "to", "of", "in", "on",
  "nuestra", "nuestro", "nuestros", "nuestras", "desde", "hasta", "entre",
]);

function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function isUsableGram(words: string[]): boolean {
  const first = words[0];
  const last = words[words.length - 1];
  if (GLUE_WORDS.has(first) || GLUE_WORDS.has(last)) return false;
  if (words.every((w) => GLUE_WORDS.has(w))) return false;
  return true;
}

function extractNgrams(tokens: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const words = tokens.slice(i, i + n);
    if (!isUsableGram(words)) continue;
    grams.push(words.join(" "));
  }
  return grams;
}

// --- robots.txt (parser basico: User-agent: * + Disallow) ---

function parseDisallowRules(robotsTxt: string): string[] {
  const lines = robotsTxt.split(/\r?\n/);
  let inWildcardBlock = false;
  const disallows: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const sepIndex = line.indexOf(":");
    if (sepIndex === -1) continue;
    const key = line.slice(0, sepIndex).trim().toLowerCase();
    const value = line.slice(sepIndex + 1).trim();
    if (key === "user-agent") {
      inWildcardBlock = value === "*";
    } else if (inWildcardBlock && key === "disallow" && value) {
      disallows.push(value);
    }
  }
  return disallows;
}

function isDisallowed(pathname: string, disallowRules: string[]): boolean {
  return disallowRules.some((rule) => pathname.startsWith(rule));
}

async function fetchWithTimeout(url: string, timeoutMs: number, userAgent: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent, Accept: "text/html" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRobotsDisallowRules(
  origin: string,
  timeoutMs: number,
  userAgent: string
): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, timeoutMs, userAgent);
    if (!res.ok) return [];
    const text = await res.text();
    return parseDisallowRules(text);
  } catch {
    // Sin robots.txt accesible: no se bloquea nada explicitamente, pero
    // tampoco se insiste — el fetch de la pagina en si tiene su propio
    // manejo de errores.
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPageData(html: string): { title: string; metaDescription: string; h1s: string[]; h2s: string[] } {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const metaDescription = ($('meta[name="description"]').attr("content") ?? "").trim();
  const h1s = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const h2s = $("h2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 15);
  return { title, metaDescription, h1s, h2s };
}

/**
 * Descarga y analiza las paginas de todos los competidores configurados,
 * respetando robots.txt, rate limit y el tope de URLs por dominio.
 */
async function analyzeCompetitorPages(
  cfg: CompetitorConfig,
  warnings: string[]
): Promise<PageAnalysis[]> {
  const pages: PageAnalysis[] = [];

  for (const competitor of cfg.competitors) {
    let origin: string;
    try {
      origin = new URL(competitor.domain).origin;
    } catch {
      warnings.push(`Dominio invalido para "${competitor.name}": "${competitor.domain}". Se omite.`);
      continue;
    }

    const disallowRules = cfg.respectRobotsTxt
      ? await fetchRobotsDisallowRules(origin, cfg.requestTimeoutMs, cfg.userAgent)
      : [];

    const urls = competitor.urls.slice(0, cfg.maxUrlsPerDomain);

    for (const url of urls) {
      let pathname: string;
      try {
        pathname = new URL(url).pathname;
      } catch {
        warnings.push(`URL invalida para "${competitor.name}": "${url}". Se omite.`);
        continue;
      }

      if (cfg.respectRobotsTxt && isDisallowed(pathname, disallowRules)) {
        pages.push({ competitor: competitor.name, role: competitor.role, url, status: "skipped_robots" });
        warnings.push(`"${competitor.name}": ${url} esta bloqueada por robots.txt. Se omite.`);
        await sleep(cfg.rateLimitMs);
        continue;
      }

      try {
        const res = await fetchWithTimeout(url, cfg.requestTimeoutMs, cfg.userAgent);
        if (!res.ok) {
          pages.push({
            competitor: competitor.name,
            role: competitor.role,
            url,
            status: "error",
            error: `HTTP ${res.status}`,
          });
          warnings.push(`"${competitor.name}": ${url} respondio HTTP ${res.status}.`);
        } else {
          const html = await res.text();
          const data = extractPageData(html);
          pages.push({
            competitor: competitor.name,
            role: competitor.role,
            url,
            status: "ok",
            ...data,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pages.push({ competitor: competitor.name, role: competitor.role, url, status: "error", error: message });
        warnings.push(`"${competitor.name}": fallo al leer ${url} (${message}).`);
      }

      // Rate limit conservador: una peticion cada N ms, tanto si hubo
      // exito como error, para no insistir agresivamente sobre el mismo
      // dominio.
      await sleep(cfg.rateLimitMs);
    }
  }

  return pages;
}

function buildKeywordGaps(
  pages: PageAnalysis[],
  targetKeywords: TargetKeyword[],
  trackedJobKeywords: string[],
  cfg: CompetitorConfig
): KeywordGapCandidate[] {
  const trackedTexts = [
    ...targetKeywords.map((k) => normalize(k.keyword)),
    ...trackedJobKeywords.map((k) => normalize(k)),
  ];

  const isAlreadyTracked = (term: string): boolean =>
    trackedTexts.some((t) => t.includes(term) || term.includes(t));

  // El nombre de marca del propio competidor ("marma", "blok", "setroc",
  // "ojmar"...) no es una keyword objetivo real: se descarta cualquier
  // gram que lo contenga.
  const brandTokens = new Set(
    cfg.competitors.flatMap((c) => (c.brandTokens ?? []).map((t) => normalize(t)))
  );
  const containsBrandToken = (term: string): boolean =>
    term.split(" ").some((word) => brandTokens.has(word));

  // frecuencia = en cuantas paginas DISTINTAS aparece el termino, y de que
  // competidores viene.
  const frequency = new Map<string, { count: number; competitors: Set<string> }>();

  for (const page of pages) {
    if (page.status !== "ok") continue;
    const combinedText = [page.title, page.metaDescription, ...(page.h1s ?? []), ...(page.h2s ?? [])]
      .filter(Boolean)
      .join(" . ");
    const tokens = tokenize(combinedText);
    const grams = new Set([...extractNgrams(tokens, 2), ...extractNgrams(tokens, 3)]);
    for (const gram of grams) {
      const entry = frequency.get(gram) ?? { count: 0, competitors: new Set<string>() };
      entry.count += 1;
      entry.competitors.add(page.competitor);
      frequency.set(gram, entry);
    }
  }

  const candidates: KeywordGapCandidate[] = [];
  for (const [term, entry] of frequency.entries()) {
    // Solo términos con presencia real (>=2 páginas o >=2 competidores
    // distintos) para evitar ruido de una sola mención suelta.
    if (entry.count < 2) continue;
    if (isAlreadyTracked(term)) continue;
    if (containsBrandToken(term)) continue;

    const brandIntent = classifyKeyword(term);
    if (brandIntent.category === "irrelevant_or_low_fit") continue;

    candidates.push({
      term,
      frequency: entry.count,
      sourceCompetitors: [...entry.competitors],
      brandIntent,
      suggestedForSem:
        entry.competitors.size >= 2 &&
        (brandIntent.category === "zentry_smart_locker" ||
          brandIntent.category === "tukandado_lock_core" ||
          brandIntent.signals.matchedB2bSectors.length > 0),
    });
  }

  return candidates.sort((a, b) => b.frequency - a.frequency).slice(0, 25);
}

function buildContentGaps(pages: PageAnalysis[], targetKeywords: TargetKeyword[]): ContentGapCandidate[] {
  const trackedText = normalize(targetKeywords.map((k) => k.keyword).join(" | "));

  const sectorTerms = [
    "gimnasio", "gimnasios", "colegio", "colegios", "centro deportivo", "centros deportivos",
    "oficina", "oficinas", "hotel", "hoteles", "hosteleria", "industrial", "polideportivo",
    "universidad", "universidades", "hospital", "hospitales", "piscina", "piscinas",
  ];
  const materialTerms = ["melamina", "fenolica", "fenolicas", "fenolico", "metalica", "metalicas", "metalico", "madera"];

  const found = new Map<string, { kind: "sector" | "material"; competitors: Set<string> }>();

  for (const page of pages) {
    if (page.status !== "ok") continue;
    const text = normalize(
      [page.title, page.metaDescription, ...(page.h1s ?? []), ...(page.h2s ?? [])].filter(Boolean).join(" ")
    );
    for (const term of sectorTerms) {
      if (text.includes(term) && !trackedText.includes(term)) {
        const entry = found.get(term) ?? { kind: "sector" as const, competitors: new Set<string>() };
        entry.competitors.add(page.competitor);
        found.set(term, entry);
      }
    }
    for (const term of materialTerms) {
      if (text.includes(term) && !trackedText.includes(term)) {
        const entry = found.get(term) ?? { kind: "material" as const, competitors: new Set<string>() };
        entry.competitors.add(page.competitor);
        found.set(term, entry);
      }
    }
  }

  return [...found.entries()]
    .map(([term, entry]) => ({ term, kind: entry.kind, sourceCompetitors: [...entry.competitors] }))
    .sort((a, b) => b.sourceCompetitors.length - a.sourceCompetitors.length);
}

function buildReportMarkdown(result: CompetitorIntelligenceRunResult, cfg: CompetitorConfig): string {
  const executionDate = result.generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Competitor Intelligence — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${result.generatedAt}`);
  lines.push(
    `- **Competidores analizados:** ${cfg.competitors.map((c) => `${c.name} (${c.role})`).join(", ")}`
  );
  lines.push(`- **Paginas leidas:** ${result.pages.filter((p) => p.status === "ok").length} de ${result.pages.length} intentadas`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Se analizaron ${result.pages.length} URL(s) publicas de ${cfg.competitors.length} competidor(es)/referencia(s) (solo lectura, respetando robots.txt y con rate limit conservador). Se detectaron **${result.keywordGaps.length}** posible(s) keyword(s) que la competencia trabaja y Zentry/Tukandado no tiene(n) como keyword objetivo, y **${result.contentGaps.length}** posible(s) sector(es)/material(es) sin cobertura. Nada de esto se ha publicado ni aplicado: son propuestas para revisar.`
  );
  lines.push("");

  lines.push("## Paginas analizadas");
  lines.push("");
  lines.push("| Competidor | Rol | URL | Estado |");
  lines.push("|---|---|---|---|");
  for (const page of result.pages) {
    lines.push(`| ${page.competitor} | ${page.role} | ${page.url} | ${page.status}${page.error ? ` (${page.error})` : ""} |`);
  }
  lines.push("");

  lines.push("## Keywords que trabaja la competencia (no cubiertas hoy)");
  lines.push("");
  if (result.keywordGaps.length === 0) {
    lines.push("No se detectaron gaps de keywords significativos en esta ejecucion.");
  } else {
    lines.push("| Termino | Frecuencia | Competidores | Clasificacion Brand/Intent | Candidata a SEM |");
    lines.push("|---|---|---|---|---|");
    for (const gap of result.keywordGaps) {
      lines.push(
        `| ${gap.term} | ${gap.frequency} | ${gap.sourceCompetitors.join(", ")} | ${BRAND_INTENT_CATEGORY_LABELS[gap.brandIntent.category]} | ${gap.suggestedForSem ? "si" : "no"} |`
      );
    }
  }
  lines.push("");

  lines.push("## Sectores/materiales sin cobertura (posibles landings/contenidos faltantes)");
  lines.push("");
  if (result.contentGaps.length === 0) {
    lines.push("No se detectaron gaps de sector/material en esta ejecucion.");
  } else {
    lines.push("| Termino | Tipo | Competidores que lo mencionan |");
    lines.push("|---|---|---|");
    for (const gap of result.contentGaps) {
      lines.push(`| ${gap.term} | ${gap.kind} | ${gap.sourceCompetitors.join(", ")} |`);
    }
  }
  lines.push("");

  if (result.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- Solo se ha leido HTML publico de las URLs configuradas en `config/competitors.json`.");
  lines.push("- Se respeto robots.txt (si `respectRobotsTxt` esta activo) y un rate limit conservador entre peticiones.");
  lines.push("- No se ha hecho login, scraping intensivo, ni se ha intentado saltar ningun bloqueo.");
  lines.push("- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n ni qdrant.");
  lines.push("- No se ha ejecutado ningun cambio real; este agente solo propone.");
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: CompetitorIntelligenceRunResult, cfg: CompetitorConfig): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = result.generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `competitor-intelligence-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, cfg), "utf-8");
  return filePath;
}

export async function runCompetitorIntelligence(
  departmentRunId?: string
): Promise<CompetitorIntelligenceRunResult> {
  const runId = departmentRunId ?? buildDepartmentRunId();

  emitEvent({
    departmentRunId: runId,
    agent: AGENT_NAME,
    type: "agent_started",
    summary: "Competitor Intelligence Agent iniciado",
  });
  logger.info("Competitor Intelligence Agent iniciado", { departmentRunId: runId });

  const cfg = loadCompetitorConfig();
  const targetKeywords = loadTargetKeywords();
  const trackedJobKeywords = [...new Set(readAllJobs().map((j) => j.opportunity.keyword))];

  const warnings: string[] = [];
  const pages = await analyzeCompetitorPages(cfg, warnings);

  for (const w of warnings) {
    emitEvent({
      departmentRunId: runId,
      agent: AGENT_NAME,
      type: "warning_detected",
      priority: "low",
      summary: w,
    });
  }

  const keywordGaps = buildKeywordGaps(pages, targetKeywords, trackedJobKeywords, cfg);
  const contentGaps = buildContentGaps(pages, targetKeywords);

  for (const gap of keywordGaps) {
    emitEvent({
      departmentRunId: runId,
      agent: AGENT_NAME,
      type: "competitor_keyword_detected",
      priority: gap.suggestedForSem ? "high" : "medium",
      summary: `Keyword de competencia no cubierta: "${gap.term}" (${gap.sourceCompetitors.join(", ")})`,
      payload: {
        gapType: "keyword",
        term: gap.term,
        frequency: gap.frequency,
        sourceCompetitors: gap.sourceCompetitors,
        category: gap.brandIntent.category,
        brand: gap.brandIntent.brand,
        suggestedForSem: gap.suggestedForSem,
      },
    });
    emitEvent({
      departmentRunId: runId,
      agent: AGENT_NAME,
      type: "brand_intent_classified",
      priority: "low",
      summary: `"${gap.term}" clasificada como ${gap.brandIntent.category}`,
      payload: { term: gap.term, ...gap.brandIntent },
    });
  }

  for (const gap of contentGaps) {
    emitEvent({
      departmentRunId: runId,
      agent: AGENT_NAME,
      type: "competitor_keyword_detected",
      priority: "low",
      summary: `Sector/material de competencia sin cobertura: "${gap.term}" (${gap.kind})`,
      payload: {
        gapType: "content",
        term: gap.term,
        contentKind: gap.kind,
        sourceCompetitors: gap.sourceCompetitors,
      },
    });
  }

  const generatedAt = new Date().toISOString();
  const result: CompetitorIntelligenceRunResult = {
    departmentRunId: runId,
    generatedAt,
    pages,
    keywordGaps,
    contentGaps,
    warnings,
    reportPath: "",
  };
  result.reportPath = writeReport(result, cfg);

  emitEvent({
    departmentRunId: runId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Competitor Intelligence Agent finalizado: ${keywordGaps.length} gap(s) de keyword, ${contentGaps.length} gap(s) de contenido`,
    payload: { pagesRead: pages.filter((p) => p.status === "ok").length, reportPath: result.reportPath },
  });
  logger.info("Competitor Intelligence Agent finalizado", {
    departmentRunId: runId,
    keywordGaps: keywordGaps.length,
    contentGaps: contentGaps.length,
    reportPath: result.reportPath,
  });

  return result;
}
