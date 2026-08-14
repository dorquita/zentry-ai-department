import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Fase O49 -- estado persistido del "departamento SEM" que no cambia cada
 * dia (fase actual, clusters de keywords propuestos, escenarios de
 * presupuesto) y por eso no tiene sentido recalcularlo en cada pase
 * diario. sem-watcher.ts YA hace lectura real de Google Ads cada dia
 * (campana/ad groups/keywords/metricas, ver GoogleAdsSnapshot) -- eso
 * sigue siendo la fuente de lo DINAMICO. Este fichero es solo la base
 * ESTATICA de la investigacion real ya hecha (Fase O45.0, 2026-08-14):
 * sin esto, el email diario nunca mencionaba SEM como linea de trabajo
 * (el informe tecnico de sem-watcher existia, pero nada lo resumia en el
 * informe ejecutivo que Pau realmente lee).
 *
 * Vive en `clients/<id>/sem-department-state.json` (mismo directorio que
 * el resto de config por cliente, Fase O16) -- NO es un log append-only:
 * es un documento que se actualiza a mano/por agente cuando cambia la
 * fase o se completa una investigacion nueva, igual que
 * `clients/zentry/ads.json`.
 */

export interface SemClusterSummary {
  name: string;
  priority: "alta" | "media" | "baja" | "defensiva";
  status: "propuesto" | "campana_construida" | "activo";
  note: string;
}

export interface SemDepartmentState {
  phase: string;
  lastResearchDate: string;
  historicalSpendEur: number;
  historicalConversions: number;
  clusters: SemClusterSummary[];
  budgetScenariosEur: number[];
  nextStep: string;
  blockedOn: string[];
}

const DEFAULT_STATE: SemDepartmentState = {
  phase: "sin iniciar",
  lastResearchDate: "",
  historicalSpendEur: 0,
  historicalConversions: 0,
  clusters: [],
  budgetScenariosEur: [],
  nextStep: "Sin investigacion SEM registrada todavia para este cliente.",
  blockedOn: [],
};

function resolveFilePath(): string {
  return path.join(resolveActiveClientPaths().clientDir, "sem-department-state.json");
}

/**
 * Lectura tolerante: si el fichero no existe (cliente nuevo, o Zentry
 * antes de la Fase O45), devuelve un estado por defecto seguro en vez de
 * lanzar -- este modulo nunca debe poder tirar abajo el pase diario.
 */
export function readSemDepartmentState(): SemDepartmentState {
  try {
    const filePath = resolveFilePath();
    if (!fs.existsSync(filePath)) return DEFAULT_STATE;
    const raw = fs.readFileSync(filePath, "utf-8");
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<SemDepartmentState>) };
  } catch {
    return DEFAULT_STATE;
  }
}
