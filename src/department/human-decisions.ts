import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * DECISION HUMANA sobre las recomendaciones de una pasada ANTERIOR, y
 * que paso de verdad con cada una.
 *
 * Por que existe este contrato: el directorio de una pasada
 * (`reports/department/<departmentRunId>/`) es EFIMERO -- no se commitea
 * y el artifact caduca. Cuando Pau aprueba unas propuestas concretas y
 * rechaza otras, esa decision y su resultado real tienen que sobrevivir
 * al runner que las produjo, o el informe del dia siguiente no puede
 * decir honestamente que se hizo y que no.
 *
 * Reglas duras, iguales que en el resto del departamento:
 *
 * - Es un REGISTRO, no una orden: nada de lo que hay aqui ejecuta nada.
 *   Un elemento con `decision: "approved"` describe una aprobacion que YA
 *   ocurrio y lo que el sistema pudo (o no pudo) hacer con ella.
 * - `decision: "not_approved"` significa exactamente eso: no aprobada, no
 *   ejecutada, estado original intacto. El informe la publica en su
 *   propia seccion para que quede constancia de que se excluyo a
 *   proposito, no por un fallo.
 * - Ningun campo se rellena por defecto ni se infiere: si un dato no se
 *   conoce, el fichero tiene que decirlo con sus palabras ("sin cambios",
 *   "no ejecutada"), nunca dejarlo vacio para que el render lo adivine.
 * - Los contadores de escrituras son CONTEOS REALES de lo que se escribio
 *   en staging y en produccion por esa propuesta. Fail-closed: si no
 *   consta, es 0 y el detalle lo explica.
 *
 * Modulo casi puro: `parse*` y `select*` no tocan disco; solo el lector
 * `readLatest*` lee ficheros, y nunca escribe.
 */

export const DEPARTMENT_HUMAN_DECISION_CONTRACT_VERSION = "department-human-decision/v1";

/** Subdirectorio (dentro del `dataDir` del cliente activo) donde viven los registros de decision. */
export const HUMAN_DECISIONS_DIRNAME = "department-human-decisions";

export type HumanDecisionVerdict = "approved" | "not_approved";

/**
 * Que acabo pasando de verdad con la propuesta. No hay ningun valor que
 * signifique "mas o menos": o se aplico, o fallo, o se revirtio, o el
 * sistema no tiene executor para ella, o la aprobacion dejo de ser valida,
 * o no se ejecuto por decision humana.
 */
export type HumanDecisionOutcome =
  | "applied"
  | "failed"
  | "rolled_back"
  | "requires_manual_implementation"
  | "approval_stale"
  | "not_executed";

export const HUMAN_DECISION_OUTCOME_LABEL: Record<HumanDecisionOutcome, string> = {
  applied: "APLICADO Y VALIDADO",
  failed: "FALLIDO",
  rolled_back: "REVERTIDO (rollback verificado)",
  requires_manual_implementation: "REQUIERE IMPLEMENTACION MANUAL",
  approval_stale: "APROBACION CADUCADA (approval_stale)",
  not_executed: "NO EJECUTADO",
};

export interface DepartmentHumanDecisionItem {
  /** Identificadores REALES de la pasada aprobada -- son la trazabilidad, no una etiqueta bonita. */
  recommendationId: string;
  applyItemId: string;
  rank: number;
  /** La propuesta original, tal cual la publico el Daily Brief aprobado. */
  proposal: string;
  decision: HumanDecisionVerdict;
  /** Que se hizo REALMENTE. "Ninguna" es una respuesta valida y frecuente. */
  actionTaken: string;
  /** Paginas/recursos tocados. Lista vacia = no se toco nada, y el render lo dice. */
  affectedResources: string[];
  before: string;
  after: string;
  validation: string;
  outcome: HumanDecisionOutcome;
  /** Que falta EXACTAMENTE para poder ejecutarla, o por que acabo asi. */
  outcomeDetail: string;
  /** Identificador del snapshot previo, si se llego a crear alguno. */
  snapshotId: string | null;
  rollback: string;
  stagingWrites: number;
  productionWrites: number;
}

export interface DepartmentHumanDecisionRecord {
  contractVersion: string;
  decidedAt: string;
  decidedBy: string;
  /** Pasada cuyo Daily Brief se aprobo. La decision NO se extiende a ninguna otra. */
  sourceDepartmentRunId: string;
  sourceBriefGeneratedAt: string;
  /** Alcance textual de la aprobacion, para que nadie la lea como un "approve all". */
  scopeNote: string;
  items: DepartmentHumanDecisionItem[];
}

const VERDICTS: HumanDecisionVerdict[] = ["approved", "not_approved"];
const OUTCOMES: HumanDecisionOutcome[] = ["applied", "failed", "rolled_back", "requires_manual_implementation", "approval_stale", "not_executed"];

function requireString(raw: Record<string, unknown>, field: string, source: string): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Registro de decision humana invalido (${source}): falta el campo obligatorio "${field}" o esta vacio.`);
  }
  return value;
}

function requireCount(raw: Record<string, unknown>, field: string, source: string): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Registro de decision humana invalido (${source}): "${field}" debe ser un entero >= 0 (es un conteo real de escrituras, no una estimacion).`);
  }
  return value;
}

function parseItem(raw: unknown, index: number, source: string): DepartmentHumanDecisionItem {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Registro de decision humana invalido (${source}): el elemento ${index} no es un objeto.`);
  }
  const item = raw as Record<string, unknown>;
  const where = `${source}, elemento ${index}`;

  const decision = item.decision;
  if (typeof decision !== "string" || !VERDICTS.includes(decision as HumanDecisionVerdict)) {
    throw new Error(`Registro de decision humana invalido (${where}): "decision" debe ser uno de ${VERDICTS.join(" | ")}.`);
  }
  const outcome = item.outcome;
  if (typeof outcome !== "string" || !OUTCOMES.includes(outcome as HumanDecisionOutcome)) {
    throw new Error(`Registro de decision humana invalido (${where}): "outcome" debe ser uno de ${OUTCOMES.join(" | ")}.`);
  }
  const rank = item.rank;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
    throw new Error(`Registro de decision humana invalido (${where}): "rank" debe ser un entero >= 1.`);
  }
  const affectedResources = item.affectedResources;
  if (!Array.isArray(affectedResources) || affectedResources.some((r) => typeof r !== "string")) {
    throw new Error(`Registro de decision humana invalido (${where}): "affectedResources" debe ser un array de strings (vacio si no se toco nada).`);
  }

  const productionWrites = requireCount(item, "productionWrites", where);
  if (decision === "not_approved" && productionWrites > 0) {
    // Guarda del contrato: una propuesta NO aprobada que declare
    // escrituras en produccion es una contradiccion, y se rechaza en vez
    // de publicarse en un informe.
    throw new Error(
      `Registro de decision humana invalido (${where}): una propuesta con decision "not_approved" declara ${productionWrites} escritura(s) en produccion. Eso es una contradiccion: sin aprobacion no puede haberse escrito nada.`
    );
  }

  return {
    recommendationId: requireString(item, "recommendationId", where),
    applyItemId: requireString(item, "applyItemId", where),
    rank,
    proposal: requireString(item, "proposal", where),
    decision: decision as HumanDecisionVerdict,
    actionTaken: requireString(item, "actionTaken", where),
    affectedResources: [...(affectedResources as string[])],
    before: requireString(item, "before", where),
    after: requireString(item, "after", where),
    validation: requireString(item, "validation", where),
    outcome: outcome as HumanDecisionOutcome,
    outcomeDetail: requireString(item, "outcomeDetail", where),
    snapshotId: typeof item.snapshotId === "string" && item.snapshotId.trim().length > 0 ? item.snapshotId : null,
    rollback: requireString(item, "rollback", where),
    stagingWrites: requireCount(item, "stagingWrites", where),
    productionWrites,
  };
}

/** Valida un registro de decision humana. Fail-closed: cualquier hueco es un error, nunca un valor por defecto. */
export function parseDepartmentHumanDecisionRecord(raw: unknown, source = "registro"): DepartmentHumanDecisionRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Registro de decision humana invalido (${source}): el contenido no es un objeto.`);
  }
  const record = raw as Record<string, unknown>;

  const contractVersion = requireString(record, "contractVersion", source);
  if (contractVersion !== DEPARTMENT_HUMAN_DECISION_CONTRACT_VERSION) {
    throw new Error(
      `Registro de decision humana con contrato no soportado (${source}): "${contractVersion}". Esperado "${DEPARTMENT_HUMAN_DECISION_CONTRACT_VERSION}".`
    );
  }

  const items = record.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Registro de decision humana invalido (${source}): "items" debe ser un array con al menos un elemento.`);
  }

  return {
    contractVersion,
    decidedAt: requireString(record, "decidedAt", source),
    decidedBy: requireString(record, "decidedBy", source),
    sourceDepartmentRunId: requireString(record, "sourceDepartmentRunId", source),
    sourceBriefGeneratedAt: requireString(record, "sourceBriefGeneratedAt", source),
    scopeNote: requireString(record, "scopeNote", source),
    items: items.map((item, index) => parseItem(item, index, source)),
  };
}

/** Trabajos que el humano aprobo, ordenados por su rank en el brief aprobado. */
export function selectApprovedWork(record: DepartmentHumanDecisionRecord): DepartmentHumanDecisionItem[] {
  return record.items.filter((item) => item.decision === "approved").sort((a, b) => a.rank - b.rank);
}

/** Propuestas excluidas a proposito por el humano. */
export function selectNotApprovedWork(record: DepartmentHumanDecisionRecord): DepartmentHumanDecisionItem[] {
  return record.items.filter((item) => item.decision === "not_approved").sort((a, b) => a.rank - b.rank);
}

export interface HumanDecisionTotals {
  approved: number;
  notApproved: number;
  applied: number;
  failed: number;
  rolledBack: number;
  requiresManualImplementation: number;
  approvalStale: number;
  stagingWrites: number;
  productionWrites: number;
}

export function summarizeHumanDecision(record: DepartmentHumanDecisionRecord): HumanDecisionTotals {
  const approved = selectApprovedWork(record);
  return {
    approved: approved.length,
    notApproved: record.items.length - approved.length,
    applied: approved.filter((i) => i.outcome === "applied").length,
    failed: approved.filter((i) => i.outcome === "failed").length,
    rolledBack: approved.filter((i) => i.outcome === "rolled_back").length,
    requiresManualImplementation: approved.filter((i) => i.outcome === "requires_manual_implementation").length,
    approvalStale: approved.filter((i) => i.outcome === "approval_stale").length,
    stagingWrites: record.items.reduce((sum, i) => sum + i.stagingWrites, 0),
    productionWrites: record.items.reduce((sum, i) => sum + i.productionWrites, 0),
  };
}

export function resolveHumanDecisionsDir(): string {
  return path.join(resolveActiveClientPaths().dataDir, HUMAN_DECISIONS_DIRNAME);
}

/**
 * Devuelve el registro de decision humana MAS RECIENTE (por `decidedAt`)
 * que NO se refiera a la pasada que se esta generando ahora -- un informe
 * no reporta como "trabajo previo" una decision sobre si mismo.
 *
 * Lanza si algun fichero del directorio esta corrupto: es preferible que
 * la generacion del brief lo diga y siga sin la seccion, a publicar un
 * informe con una decision humana a medio leer.
 */
export function readLatestDepartmentHumanDecisionRecord(params: {
  currentDepartmentRunId: string;
  dir?: string;
}): DepartmentHumanDecisionRecord | null {
  const dir = params.dir ?? resolveHumanDecisionsDir();
  if (!fs.existsSync(dir)) return null;

  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => parseDepartmentHumanDecisionRecord(JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")), name))
    .filter((record) => record.sourceDepartmentRunId !== params.currentDepartmentRunId)
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));

  return candidates[0] ?? null;
}
