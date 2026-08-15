import * as fs from "fs";
import * as path from "path";
import { DepartmentEvent } from "../../core/types";
import { readAllEvents } from "../../core/department-events";
import { resolveActiveClientPaths } from "../../core/client-paths";
import { Ga4ReportData, GtmReportData, parseGa4ReportSection, parseGtmReportSection } from "./report-parser";

/**
 * Context builder para el empleado `analytics-specialist` -- ver
 * .claude/agents/analytics-specialist.md.
 *
 * Fuente de datos REAL, ya existente y de solo lectura (ver
 * docs/claude-employee-runtime.md): NUNCA llama a GA4/GTM en vivo (eso lo
 * hace unicamente src/agents/analytics-watcher.ts, via
 * src/adapters/ga4.ts / src/adapters/gtm.ts, con credenciales OAuth que
 * este empleado no necesita ni debe tener). En su lugar:
 *
 *   1. Lee el bus de eventos del departamento (data/department-events.jsonl
 *      via readAllEvents(), ver src/core/department-events.ts) y
 *      selecciona el evento `agent_finished` MAS RECIENTE cuyo `agent`
 *      sea "analytics-watcher" (ver AGENT_NAME en
 *      src/agents/analytics-watcher.ts).
 *   2. Ese evento SOLO contiene `ga4Connected`/`gtmConnected` (booleanos)
 *      y `reportPath` -- el snapshot completo (trafico por canal, landing
 *      pages, eventos, GTM tags/triggers) nunca se serializa en el propio
 *      evento (ver runAnalyticsWatcher(), emitEvent de tipo
 *      "agent_finished"). Por eso este modulo lee tambien el informe
 *      Markdown ya persistido en `reportPath` (reports/analytics/*.md,
 *      commiteado al repositorio, ver buildReportMarkdown() en
 *      src/agents/analytics-watcher.ts) y lo parsea con
 *      report-parser.ts (TOOL puro, sin I/O).
 *
 * GA4 y GTM fallan de forma INDEPENDIENTE en analytics-watcher -- este
 * builder tolera que uno este presente sin el otro (ga4/gtm quedan en
 * `null` por separado, nunca se exige que ambos esten disponibles a la
 * vez).
 *
 * Si nunca se ha ejecutado analytics-watcher en este repositorio (sin
 * ningun evento "agent_finished" con agent="analytics-watcher" en el bus
 * de eventos), devuelve `{ status: "no_data" }` -- el runner NUNCA debe
 * fabricar un contexto ni invocar al subagente en ese caso (ver
 * scripts/run-analytics-specialist.ts).
 */

const ANALYTICS_WATCHER_AGENT_NAME = "analytics-watcher";

export interface AnalyticsSpecialistContextReady {
  status: "ready";
  departmentRunId: string;
  reportGeneratedAt: string;
  reportPath: string;
  ga4Connected: boolean;
  gtmConnected: boolean;
  ga4: Ga4ReportData | null;
  gtm: GtmReportData | null;
  /** Resumenes de los eventos "warning_detected" de analytics-watcher para esa misma pasada -- contexto adicional, nunca inventado. */
  watcherWarnings: string[];
}

export interface AnalyticsSpecialistContextNoData {
  status: "no_data";
  reason: string;
}

export type AnalyticsSpecialistContextResult = AnalyticsSpecialistContextReady | AnalyticsSpecialistContextNoData;

/** Selecciona el evento "agent_finished" MAS RECIENTE de analytics-watcher (por createdAt) -- pura, sin I/O, para poder testear con eventos sinteticos. */
export function selectLatestAnalyticsWatcherFinishedEvent(events: DepartmentEvent[]): DepartmentEvent | undefined {
  const finished = events.filter((e) => e.agent === ANALYTICS_WATCHER_AGENT_NAME && e.type === "agent_finished");
  if (finished.length === 0) return undefined;
  return finished.reduce((latest, current) => (current.createdAt > latest.createdAt ? current : latest));
}

/** Avisos ("warning_detected") de analytics-watcher para el MISMO departmentRunId que el evento_finished seleccionado -- nunca de otras pasadas. */
export function collectWatcherWarnings(events: DepartmentEvent[], departmentRunId: string): string[] {
  return events.filter((e) => e.agent === ANALYTICS_WATCHER_AGENT_NAME && e.type === "warning_detected" && e.departmentRunId === departmentRunId).map((e) => e.summary);
}

export interface BuildContextOptions {
  /** Inyectable para tests -- por defecto, readAllEvents() (lectura real de data/department-events.jsonl). */
  events?: DepartmentEvent[];
  /** Inyectable para tests -- por defecto, fs.readFileSync guardado con fs.existsSync. Devuelve undefined si el fichero no existe. */
  readReportFile?: (reportPath: string) => string | undefined;
}

/**
 * `payload.reportPath` en el evento "agent_finished" es la ruta ABSOLUTA
 * que resolvio `resolveActiveClientPaths()` en la maquina/checkout que
 * ejecuto analytics-watcher (p.ej. un VPS persistente en
 * "/opt/zentry-ai-department/..."). data/department-events.jsonl esta
 * commiteado al repositorio, asi que ese evento puede leerse desde
 * cualquier otro checkout (otro worktree, un runner de GitHub Actions)
 * donde esa ruta absoluta NO existe -- aunque el propio informe
 * (reports/analytics/*.md) SI este presente ahi, porque tambien esta
 * commiteado. Por eso se intenta primero la ruta LOCAL recalculada con
 * resolveActiveClientPaths() del checkout actual + el nombre de fichero
 * (deterministico: analytics-<fecha>.md, ver REPORTS_DIR/writeReport()
 * en src/agents/analytics-watcher.ts) antes de caer a la ruta absoluta
 * literal del evento (que si seguiria funcionando en la maquina original
 * que lo genero).
 */
function candidateReportPaths(reportPath: string): string[] {
  const localCandidate = path.join(resolveActiveClientPaths().reportsDir, "analytics", path.basename(reportPath));
  return localCandidate === reportPath ? [reportPath] : [localCandidate, reportPath];
}

function defaultReadReportFile(reportPath: string): string | undefined {
  for (const candidate of candidateReportPaths(reportPath)) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8");
    }
  }
  return undefined;
}

export function buildAnalyticsSpecialistContext(options: BuildContextOptions = {}): AnalyticsSpecialistContextResult {
  const events = options.events ?? readAllEvents();
  const readReportFile = options.readReportFile ?? defaultReadReportFile;

  const latest = selectLatestAnalyticsWatcherFinishedEvent(events);
  if (!latest) {
    return {
      status: "no_data",
      reason: 'No existe ningun evento "agent_finished" de analytics-watcher en data/department-events.jsonl -- analytics-watcher nunca se ha ejecutado en este repositorio (o no hay historico committeado). Ejecuta "npm run analytics:watch" primero.',
    };
  }

  const payload = latest.payload ?? {};
  const ga4Connected = payload.ga4Connected === true;
  const gtmConnected = payload.gtmConnected === true;
  const reportPath = typeof payload.reportPath === "string" ? payload.reportPath : "";

  if (!reportPath) {
    return {
      status: "no_data",
      reason: `El evento "agent_finished" mas reciente de analytics-watcher (departmentRunId=${latest.departmentRunId}) no incluye un reportPath valido -- nada que leer.`,
    };
  }

  const markdown = readReportFile(reportPath);
  if (markdown === undefined) {
    const tried = options.readReportFile ? [reportPath] : candidateReportPaths(reportPath);
    return {
      status: "no_data",
      reason: `El informe de analytics-watcher referenciado por el ultimo evento (departmentRunId=${latest.departmentRunId}) no existe en disco -- se probo: ${tried.map((p) => `"${p}"`).join(", ")}. No se fabrica ningun dato.`,
    };
  }

  const ga4 = ga4Connected ? parseGa4ReportSection(markdown) : null;
  const gtm = gtmConnected ? parseGtmReportSection(markdown) : null;

  return {
    status: "ready",
    departmentRunId: latest.departmentRunId,
    reportGeneratedAt: latest.createdAt,
    reportPath,
    ga4Connected,
    gtmConnected,
    ga4,
    gtm,
    watcherWarnings: collectWatcherWarnings(events, latest.departmentRunId),
  };
}
