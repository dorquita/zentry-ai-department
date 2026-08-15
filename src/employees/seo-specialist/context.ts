import * as fs from "fs";
import * as path from "path";
import { readAllJobs } from "../../core/job-registry";
import { buildActionPlan, ActionItem } from "../../agents/seo-director";
import { resolveActiveClientPaths } from "../../core/client-paths";
import { TargetKeyword, SeoJob } from "../../core/types";

/**
 * Context builder para el empleado `seo-specialist` (ver
 * docs/claude-employee-runtime.md). Separacion CLAUDE / TOOLS explicita:
 * esta funcion es la parte TOOL (deterministica, sin LLM, sin llamadas de
 * red) -- lee y agrega datos SEO YA PERSISTIDOS localmente (nunca llama a
 * Search Console ni a ningun adaptador externo en vivo, ver
 * docs/claude-employee-runtime.md y la nota de seguridad de este
 * empleado): data/jobs.jsonl (via readAllJobs(), ya derivado de Search
 * Console por el SEO Watcher), config/seo-target-keywords.json,
 * config/seo-clusters-catalog.json, y las rutas de los ultimos informes
 * humanos de reports/seo/ y reports/seo-director/ (solo la ruta, no el
 * contenido completo -- mantiene el contexto acotado y estructurado).
 *
 * Deliberadamente NO decide nada de estrategia SEO, priorizacion ni
 * redaccion -- eso es lo que pasa al modelo (subagente Claude
 * seo-specialist), que recibe este objeto ya resuelto dentro de su
 * prompt y nunca accede al repositorio por su cuenta.
 */

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");
const TARGET_KEYWORDS_PATH = path.join(PROJECT_ROOT, "config", "seo-target-keywords.json");
const CLUSTERS_CATALOG_PATH = path.join(PROJECT_ROOT, "config", "seo-clusters-catalog.json");

export interface SeoClusterCatalogEntry {
  clusterKey: string;
  label: string;
  matchPatterns: string[];
  excludePatterns: string[];
  searchIntent: string;
  targetUrl: string | null;
  targetPageId: number | null;
  relatedStagingPageIds: number[];
  action: string;
  reason: string;
  cannibalizationRiskOverride?: string;
  recommendedTitle?: string;
  recommendedMetaDescription?: string;
}

export interface SeoSpecialistDataAvailability {
  hasJobData: boolean;
  hasTargetKeywordCatalog: boolean;
  hasClusterCatalog: boolean;
  latestRunId?: string;
  totalJobsInLatestRun: number;
  seoDirectorReportPath?: string;
  seoWatcherReportPath?: string;
}

export interface SeoSpecialistContext {
  generatedAt: string;
  dataAvailability: SeoSpecialistDataAvailability;
  actionItems: ActionItem[];
  targetKeywords: TargetKeyword[];
  clusters: SeoClusterCatalogEntry[];
}

/**
 * Mismo criterio que seo-director.ts (findLatestRunId): el runId mas
 * reciente por orden lexicografico de string (los runId incluyen una
 * marca de tiempo ISO compacta, asi que el orden lexicografico coincide
 * con el cronologico). undefined si no hay ningun job registrado
 * todavia.
 */
function findLatestRunId(jobs: SeoJob[]): string | undefined {
  return jobs.reduce<string | undefined>((max, j) => {
    if (!max || j.meta.runId > max) return j.meta.runId;
    return max;
  }, undefined);
}

/**
 * Lectura tolerante de un catalogo JSON local opcional: si el fichero no
 * existe, o no tiene el campo esperado, devuelve un array vacio en vez de
 * lanzar -- estos catalogos son opcionales por diseno (ver
 * docs/claude-employee-runtime.md, seccion de fuentes de datos de este
 * empleado). Nunca inventa contenido: "no existe" se representa como
 * array vacio, nunca como datos de relleno.
 */
function readJsonArrayField<T>(filePath: string, field: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const value = parsed[field];
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Ultimo informe .md (por orden alfabetico de nombre de fichero, que en
 * estos informes ya incluye la fecha AAAA-MM-DD, asi que coincide con el
 * orden cronologico) de un directorio de reports/ dado. undefined si el
 * directorio no existe o no tiene ningun .md -- nunca inventa una ruta.
 */
function findLatestReportPath(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (files.length === 0) return undefined;
  return path.join(dir, files[files.length - 1]);
}

export function buildSeoSpecialistContext(): SeoSpecialistContext {
  const jobs = readAllJobs();
  const latestRunId = findLatestRunId(jobs);
  const latestRunJobs = latestRunId ? jobs.filter((j) => j.meta.runId === latestRunId) : [];
  const actionItems = latestRunJobs.length > 0 ? buildActionPlan(latestRunJobs) : [];

  const targetKeywords = readJsonArrayField<TargetKeyword>(TARGET_KEYWORDS_PATH, "keywords");
  const clusters = readJsonArrayField<SeoClusterCatalogEntry>(CLUSTERS_CATALOG_PATH, "clusters");

  const reportsDir = resolveActiveClientPaths().reportsDir;
  const seoDirectorReportPath = findLatestReportPath(path.join(reportsDir, "seo-director"));
  const seoWatcherReportPath = findLatestReportPath(path.join(reportsDir, "seo"));

  return {
    generatedAt: new Date().toISOString(),
    dataAvailability: {
      hasJobData: jobs.length > 0,
      hasTargetKeywordCatalog: targetKeywords.length > 0,
      hasClusterCatalog: clusters.length > 0,
      latestRunId,
      totalJobsInLatestRun: latestRunJobs.length,
      seoDirectorReportPath,
      seoWatcherReportPath,
    },
    actionItems,
    targetKeywords,
    clusters,
  };
}
