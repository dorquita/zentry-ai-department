import { BrandIntentCategory, BrandTarget, ChangePack, ChangePackStatus, Priority } from "../../core/types";
import { ExistingPageAuditSnapshot } from "../../core/existing-page-audit";
import { StagingQaResultSnapshot } from "../../core/staging-qa-results";

/**
 * Context builder para el empleado `web-engineer` -- ver
 * .claude/agents/web-engineer.md. Modulo TOOL puro (sin I/O, sin llamada
 * a ningun modelo): recibe el ChangePack ya seleccionado y los registros
 * ya leidos (via los readers reales de src/core/existing-page-audit.ts y
 * src/core/staging-qa-results.ts, invocados por
 * scripts/run-web-engineer.ts, nunca por este fichero) y construye el
 * paquete de contexto estructurado que se inyecta en el prompt del
 * subagente. Deliberadamente NO decide nada de arquitectura tecnica,
 * ficheros afectados, plan de validacion ni plan de rollback -- eso es
 * lo que produce el modelo, que recibe este objeto ya resuelto y nunca
 * accede al repositorio ni a ningun sistema externo por su cuenta.
 *
 * Frontera anti-fabricacion deliberada (ver docs/claude-employee-runtime.md
 * y la mision de web-engineer): este proyecto NO mantiene ningun
 * inventario real de plugins/temas/rutas de API de WordPress instalados
 * (los scripts sueltos de investigacion de incidentes puntuales del
 * repositorio no cuentan como un inventario mantenido). Por eso
 * `noPluginThemeApiInventoryNotice` es un texto FIJO, nunca derivado de
 * ningun dato real -- existe para que el prompt le recuerde
 * explicitamente al modelo que cualquier afirmacion de ese tipo debe ir
 * a `unknowns`/`dependencies`, nunca redactada como un hecho.
 */
export interface WebEngineerExistingPageAuditSummary {
  matchType: ExistingPageAuditSnapshot["matchType"];
  productionPageId?: number;
  productionUrl?: string;
  confidence: ExistingPageAuditSnapshot["confidence"];
  notes?: string;
  checkedAt: string;
}

export interface WebEngineerStagingQaSummary {
  overallPass: boolean;
  hasWarnings: boolean;
  failures: string[];
  warnings: string[];
  checkedAt: string;
}

export interface WebEngineerContext {
  changePackId: string;
  keyword: string;
  page?: string;
  changeType: string;
  priority: Priority;
  status: ChangePackStatus;
  targetBrand: BrandTarget;
  brandIntent: BrandIntentCategory;
  targetWordpressPageId?: number;
  proposedChangesFromChangePack: Record<string, unknown>;
  implementationSteps: string[];
  humanReviewChecklist: string[];
  risks: string[];
  rollbackNotes: string[];
  currentAssumptions: string[];
  /** Presente SOLO si existe un registro real (ExistingPageAudit) para targetWordpressPageId -- ver src/core/existing-page-audit.ts. Ausente = no se sabe, nunca se asume ninguno de los dos casos. */
  existingPageAudit?: WebEngineerExistingPageAuditSummary;
  /** Presente SOLO si existe un registro real (StagingQaResult) mas reciente para targetWordpressPageId -- ver src/core/staging-qa-results.ts. Ausente = no se sabe el estado de QA de staging. */
  stagingQaResult?: WebEngineerStagingQaSummary;
  /** URls que SI se pueden afirmar como existentes en produccion (derivadas UNICAMENTE de existingPageAudit.matchType === "update_existing_page"). Vacio = ninguna URL confirmada para este ChangePack. */
  confirmedExistingPageUrls: string[];
  /** Texto fijo, nunca derivado de datos reales -- ver cabecera del fichero. */
  noPluginThemeApiInventoryNotice: string;
}

export const NO_PLUGIN_THEME_API_INVENTORY_NOTICE =
  "Este proyecto NO mantiene ningun inventario real y actualizado de plugins, temas ni rutas de API de WordPress instalados en zentrylockers.com. No existe ningun dato fiable al respecto en este contexto ni en ningun otro sitio al que tengas acceso. Cualquier necesidad tecnica de este tipo (formularios, tablas comparativas interactivas, integraciones) debe ir en unknowns o dependencies, marcada explicitamente como pendiente de confirmar por un humano con acceso real al sitio -- nunca redactada como si ya existiera o estuviera instalada.";

function findExistingPageAuditForChangePack(changePack: ChangePack, existingPageAudits: ExistingPageAuditSnapshot[]): ExistingPageAuditSnapshot | undefined {
  if (changePack.targetWordpressPageId === undefined) return undefined;
  return existingPageAudits.find((a) => a.wordpressPageId === changePack.targetWordpressPageId);
}

/** El registro mas reciente (por checkedAt) entre los que coinciden con targetWordpressPageId -- puede haber mas de un executionId distinto apuntando a la misma pagina. */
function findLatestStagingQaResultForChangePack(changePack: ChangePack, stagingQaResults: StagingQaResultSnapshot[]): StagingQaResultSnapshot | undefined {
  if (changePack.targetWordpressPageId === undefined) return undefined;
  const matches = stagingQaResults.filter((r) => r.wordpressPageId === changePack.targetWordpressPageId);
  if (matches.length === 0) return undefined;
  return matches.reduce((latest, current) => (current.checkedAt > latest.checkedAt ? current : latest));
}

export function buildWebEngineerContext(changePack: ChangePack, existingPageAudits: ExistingPageAuditSnapshot[], stagingQaResults: StagingQaResultSnapshot[]): WebEngineerContext {
  const auditMatch = findExistingPageAuditForChangePack(changePack, existingPageAudits);
  const qaMatch = findLatestStagingQaResultForChangePack(changePack, stagingQaResults);

  const existingPageAudit: WebEngineerExistingPageAuditSummary | undefined = auditMatch
    ? {
        matchType: auditMatch.matchType,
        productionPageId: auditMatch.productionPageId,
        productionUrl: auditMatch.productionUrl,
        confidence: auditMatch.confidence,
        notes: auditMatch.notes,
        checkedAt: auditMatch.checkedAt,
      }
    : undefined;

  const stagingQaResult: WebEngineerStagingQaSummary | undefined = qaMatch
    ? {
        overallPass: qaMatch.overallPass,
        hasWarnings: qaMatch.hasWarnings,
        failures: qaMatch.failures,
        warnings: qaMatch.warnings,
        checkedAt: qaMatch.checkedAt,
      }
    : undefined;

  const confirmedExistingPageUrls: string[] = existingPageAudit && existingPageAudit.matchType === "update_existing_page" && existingPageAudit.productionUrl ? [existingPageAudit.productionUrl] : [];

  return {
    changePackId: changePack.changePackId,
    keyword: changePack.keyword,
    page: changePack.page,
    changeType: changePack.changeType,
    priority: changePack.priority,
    status: changePack.status,
    targetBrand: changePack.targetBrand,
    brandIntent: changePack.brandIntent,
    targetWordpressPageId: changePack.targetWordpressPageId,
    proposedChangesFromChangePack: changePack.proposedChanges,
    implementationSteps: changePack.implementationSteps,
    humanReviewChecklist: changePack.humanReviewChecklist,
    risks: changePack.risks,
    rollbackNotes: changePack.rollbackNotes,
    currentAssumptions: changePack.currentAssumptions,
    existingPageAudit,
    stagingQaResult,
    confirmedExistingPageUrls,
    noPluginThemeApiInventoryNotice: NO_PLUGIN_THEME_API_INVENTORY_NOTICE,
  };
}
