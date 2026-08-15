/**
 * Parser TOOL puro (sin I/O, sin dependencias nuevas) del informe
 * Markdown que ya escribe src/agents/analytics-watcher.ts en
 * reports/analytics/analytics-<fecha>.md (ver buildReportMarkdown() ahi).
 *
 * Por que parsear el Markdown y no leer directamente Ga4Snapshot/GtmSnapshot
 * en JSON: los eventos que analytics-watcher escribe en el event bus
 * (data/department-events.jsonl, ver emitEvent() en
 * src/core/department-events.ts) SOLO incluyen `ga4Connected`/`gtmConnected`
 * (booleanos) y `reportPath` en el evento `agent_finished` -- el
 * Ga4Snapshot/GtmSnapshot completo (trafico por canal, landing pages,
 * eventos, fuentes/medios, tags/triggers de GTM) nunca se serializa en el
 * propio evento, solo se escribe en el Markdown del informe. Este modulo
 * reconstruye esos datos reales parseando ese Markdown ya persistido --
 * nunca llama a los adaptadores GA4/GTM (src/adapters/ga4.ts,
 * src/adapters/gtm.ts) directamente, ver
 * src/employees/analytics-specialist/context.ts.
 *
 * Fail-soft a proposito (a diferencia del validador de salida de Claude,
 * que es fail-closed): si una seccion no aparece en el Markdown (p.ej.
 * porque GA4 no estaba conectado ese dia), la funcion correspondiente
 * devuelve `null`/arrays vacios en vez de lanzar -- un informe con GTM
 * pero sin GA4 (o viceversa) es un caso real y valido (ver
 * AnalyticsWatcherRunResult, GA4 y GTM fallan de forma independiente).
 */

export interface Ga4ChannelRow {
  channel: string;
  sessions: number;
  activeUsers: number;
  conversions: number;
}

export interface Ga4LandingPageRow {
  landingPage: string;
  sessions: number;
  conversions: number;
  bounceRatePercent: number;
}

export interface Ga4KeyEventRow {
  name: string;
  fired: boolean;
  occurrences: number;
  conversions: number;
}

export interface Ga4SourceMediumRow {
  source: string;
  medium: string;
  sessions: number;
  conversions: number;
}

export interface Ga4ReportData {
  dateRange: { startDate: string; endDate: string } | null;
  channelTraffic: Ga4ChannelRow[];
  topLandingPages: Ga4LandingPageRow[];
  keyEvents: Ga4KeyEventRow[];
  sourceMedium: Ga4SourceMediumRow[];
}

export interface GtmTagRow {
  name: string;
  type: string;
  paused: boolean;
}

export interface GtmTriggerRow {
  name: string;
  type: string;
}

export interface GtmReportData {
  containerName: string | null;
  containerPublicId: string | null;
  workspaceName: string | null;
  liveVersionName: string | null;
  tagCount: number | null;
  triggerCount: number | null;
  variableCount: number | null;
  tags: GtmTagRow[];
  triggers: GtmTriggerRow[];
}

interface MdSection {
  header: string;
  lines: string[];
}

/** Trocea un Markdown en secciones delimitadas por cualquier cabecera (#, ##, ###...). */
function splitMarkdownSections(markdown: string): MdSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MdSection[] = [];
  let current: MdSection | null = null;
  for (const line of lines) {
    const headerMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { header: headerMatch[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function findSection(sections: MdSection[], headerPrefix: string): MdSection | undefined {
  return sections.find((s) => s.header.startsWith(headerPrefix));
}

const SEPARATOR_ROW_PATTERN = /^\|[\s:|-]+\|$/;

/** Parsea una tabla Markdown en filas de celdas (incluida la fila de cabecera, que el llamante debe saltar). Devuelve [] si no hay ninguna tabla (p.ej. "Sin trafico en el periodo."). */
function parseMarkdownTableRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (SEPARATOR_ROW_PATTERN.test(line)) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}

/** Salta la fila de cabecera de una tabla ya trocedada (parseMarkdownTableRows incluye la cabecera como primera fila). */
function dataRows(rows: string[][]): string[][] {
  return rows.length > 0 ? rows.slice(1) : [];
}

function toNumber(cell: string | undefined): number {
  const n = Number((cell ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function stripBackticks(cell: string | undefined): string {
  return (cell ?? "").replace(/`/g, "").trim();
}

/** Parsea la seccion "## GA4 -- Trafico por canal (YYYY-MM-DD a YYYY-MM-DD)" -- ver buildReportMarkdown() en src/agents/analytics-watcher.ts. */
function parseChannelTrafficSection(sections: MdSection[]): { dateRange: Ga4ReportData["dateRange"]; channelTraffic: Ga4ChannelRow[] } {
  const section = findSection(sections, "GA4 — Trafico por canal") ?? findSection(sections, "GA4 - Trafico por canal");
  if (!section) return { dateRange: null, channelTraffic: [] };

  const dateMatch = section.header.match(/\((\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2})\)/);
  const dateRange = dateMatch ? { startDate: dateMatch[1], endDate: dateMatch[2] } : null;

  const rows = dataRows(parseMarkdownTableRows(section.lines));
  const channelTraffic: Ga4ChannelRow[] = rows.map((r) => ({
    channel: (r[0] ?? "").trim(),
    sessions: toNumber(r[1]),
    activeUsers: toNumber(r[2]),
    conversions: toNumber(r[3]),
  }));
  return { dateRange, channelTraffic };
}

function parseLandingPagesSection(sections: MdSection[]): Ga4LandingPageRow[] {
  const section = findSection(sections, "GA4 — Landing pages principales") ?? findSection(sections, "GA4 - Landing pages principales");
  if (!section) return [];
  const rows = dataRows(parseMarkdownTableRows(section.lines));
  return rows.map((r) => ({
    landingPage: (r[0] ?? "").trim(),
    sessions: toNumber(r[1]),
    conversions: toNumber(r[2]),
    bounceRatePercent: Number((r[3] ?? "0%").replace("%", "").trim()) || 0,
  }));
}

function parseKeyEventsSection(sections: MdSection[]): Ga4KeyEventRow[] {
  const section = findSection(sections, "GA4 — Eventos clave") ?? findSection(sections, "GA4 - Eventos clave");
  if (!section) return [];
  const rows = dataRows(parseMarkdownTableRows(section.lines));
  return rows.map((r) => ({
    name: stripBackticks(r[0]),
    fired: (r[1] ?? "").trim().toLowerCase() === "si",
    occurrences: toNumber(r[2]),
    conversions: toNumber(r[3]),
  }));
}

function parseSourceMediumSection(sections: MdSection[]): Ga4SourceMediumRow[] {
  const section = findSection(sections, "GA4 — Fuentes / medios principales") ?? findSection(sections, "GA4 - Fuentes / medios principales");
  if (!section) return [];
  const rows = dataRows(parseMarkdownTableRows(section.lines));
  return rows.map((r) => ({
    source: (r[0] ?? "").trim(),
    medium: (r[1] ?? "").trim(),
    sessions: toNumber(r[2]),
    conversions: toNumber(r[3]),
  }));
}

/** `undefined` si el informe indica explicitamente que GA4 no estaba conectado -- distinto de "seccion vacia porque no hubo trafico" (que si es un Ga4ReportData valido con arrays vacios). */
export function parseGa4ReportSection(markdown: string): Ga4ReportData | null {
  const sections = splitMarkdownSections(markdown);
  const hasGa4Section = sections.some((s) => s.header.startsWith("GA4"));
  if (!hasGa4Section) return null;

  const { dateRange, channelTraffic } = parseChannelTrafficSection(sections);
  return {
    dateRange,
    channelTraffic,
    topLandingPages: parseLandingPagesSection(sections),
    keyEvents: parseKeyEventsSection(sections),
    sourceMedium: parseSourceMediumSection(sections),
  };
}

const GTM_CONTAINER_LINE = /^-\s+\*\*Contenedor:\*\*\s+(.+?)\s+\(([^,)]+),/;
const GTM_WORKSPACE_LINE = /^-\s+\*\*Workspace:\*\*\s+(.+?)\s+\(id/;
const GTM_LIVE_VERSION_LINE = /^-\s+\*\*Version live:\*\*\s+(.+)$/;
const GTM_COUNTS_LINE = /^-\s+\*\*Tags:\*\*\s+(\d+)\s+—\s+\*\*Triggers:\*\*\s+(\d+)\s+—\s+\*\*Variables:\*\*\s+(\d+)$/;

export function parseGtmReportSection(markdown: string): GtmReportData | null {
  const sections = splitMarkdownSections(markdown);
  const containerSection = findSection(sections, "GTM — Estado del contenedor") ?? findSection(sections, "GTM - Estado del contenedor");
  if (!containerSection) return null;

  let containerName: string | null = null;
  let containerPublicId: string | null = null;
  let workspaceName: string | null = null;
  let liveVersionName: string | null = null;
  let tagCount: number | null = null;
  let triggerCount: number | null = null;
  let variableCount: number | null = null;

  for (const line of containerSection.lines) {
    const containerMatch = line.match(GTM_CONTAINER_LINE);
    if (containerMatch) {
      containerName = containerMatch[1].trim();
      containerPublicId = containerMatch[2].trim();
      continue;
    }
    const workspaceMatch = line.match(GTM_WORKSPACE_LINE);
    if (workspaceMatch) {
      workspaceName = workspaceMatch[1].trim();
      continue;
    }
    const liveVersionMatch = line.match(GTM_LIVE_VERSION_LINE);
    if (liveVersionMatch) {
      const raw = liveVersionMatch[1].trim();
      liveVersionName = raw.startsWith("(no encontrada") ? null : raw;
      continue;
    }
    const countsMatch = line.match(GTM_COUNTS_LINE);
    if (countsMatch) {
      tagCount = Number(countsMatch[1]);
      triggerCount = Number(countsMatch[2]);
      variableCount = Number(countsMatch[3]);
    }
  }

  const tagsSection = findSection(sections, "Tags (hasta");
  const tags: GtmTagRow[] = tagsSection
    ? dataRows(parseMarkdownTableRows(tagsSection.lines)).map((r) => ({
        name: (r[0] ?? "").trim(),
        type: (r[1] ?? "").trim(),
        paused: (r[2] ?? "").trim().toLowerCase() === "si",
      }))
    : [];

  const triggersSection = findSection(sections, "Triggers (hasta");
  const triggers: GtmTriggerRow[] = triggersSection
    ? dataRows(parseMarkdownTableRows(triggersSection.lines)).map((r) => ({
        name: (r[0] ?? "").trim(),
        type: (r[1] ?? "").trim(),
      }))
    : [];

  return { containerName, containerPublicId, workspaceName, liveVersionName, tagCount, triggerCount, variableCount, tags, triggers };
}
