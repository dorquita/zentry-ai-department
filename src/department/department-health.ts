import { DepartmentApplyItem } from "./apply/types";
import { DEPARTMENT_STAGE_NAMES, DepartmentStageRecord, DepartmentStageStatus } from "./types";

/**
 * SALUD DEL DEPARTAMENTO -- donde van los fallos TECNICOS internos.
 *
 * La distincion que este modulo existe para sostener:
 *
 *   "el seo-specialist ha fallado"          -> INCIDENCIA TECNICA
 *   "reescribe el meta title de /taquillas" -> PROPUESTA DE NEGOCIO
 *
 * Lo primero no se aprueba: se reintenta o se arregla, segun la politica
 * tecnica que ya existe en el proyecto. Colarlo en la lista numerada
 * tendria dos efectos malos a la vez: gasta una decision humana en algo
 * que no es una decision de negocio, y desplaza la numeracion de las
 * propuestas que SI lo son.
 *
 * Modulo PURO: sin I/O, sin reloj. Todo sale del manifiesto de la pasada.
 */

export type DepartmentHealthSeverity = "failed" | "degraded" | "pending" | "ok";

export interface DepartmentHealthIncident {
  /** Componente interno afectado, con su nombre real (etapa, adaptador...). */
  component: string;
  severity: DepartmentHealthSeverity;
  /** Que ha pasado, con el motivo tal cual lo registro la etapa. */
  detail: string;
  /** Que hace el sistema con esto. Nunca "pendiente de aprobacion humana". */
  policy: string;
}

export interface DepartmentHealthReport {
  /** `true` si ninguna etapa fallo tecnicamente en esta pasada. */
  healthy: boolean;
  incidents: DepartmentHealthIncident[];
  /** Estado por empleado, para la tabla del informe. */
  employees: { employee: string; status: DepartmentStageStatus | "no registrada"; reason: string }[];
}

/**
 * Politica por tipo de fallo. NO se inventa nada nuevo: describe lo que
 * el sistema ya hace hoy con cada estado de etapa.
 */
const POLICY_BY_STATUS: Record<DepartmentStageStatus, string> = {
  executed: "Sin incidencia: la etapa produjo salida valida.",
  failed:
    "Fallo tecnico real. Se reintenta en la siguiente pasada diaria; si persiste, hay que arreglarlo en el repositorio. NO es una decision de negocio y no se aprueba.",
  invalid_output:
    "La etapa corrio pero su salida no cumple su contrato. Fail-closed: su aportacion se descarta entera en vez de reinterpretarse. Se corrige en el repositorio, no aprobando nada.",
  not_available:
    "No habia insumos reales para esa etapa. No es un fallo y no bloquea la pasada; se registra para que su ausencia no se confunda con 'no hay nada que hacer' en esa area.",
  blocked:
    "La etapa no debia correr porque una etapa anterior lo impide deliberadamente. No es un fallo tecnico: se resuelve desbloqueando la etapa anterior.",
};

const SEVERITY_BY_STATUS: Record<DepartmentStageStatus, DepartmentHealthSeverity> = {
  executed: "ok",
  failed: "failed",
  invalid_output: "failed",
  not_available: "pending",
  blocked: "degraded",
};

function recordOf(stages: DepartmentStageRecord[], stage: string): DepartmentStageRecord | undefined {
  return stages.find((s) => s.stage === stage);
}

export interface BuildDepartmentHealthInput {
  /** Estado real de cada etapa de la pasada, tal como quedo en el manifiesto. */
  stageStatuses: DepartmentStageRecord[];
  /**
   * Motivo por el que el inventario real de staging vino vacio, si vino
   * vacio. Es una incidencia tecnica de primer orden: sin inventario
   * ninguna propuesta puede resolver su `pageId` y todas caen a MANUAL.
   */
  stagingInventoryUnavailableReason?: string;
}

export function buildDepartmentHealth(input: BuildDepartmentHealthInput): DepartmentHealthReport {
  const stages = input.stageStatuses ?? [];
  const incidents: DepartmentHealthIncident[] = [];

  for (const stage of DEPARTMENT_STAGE_NAMES) {
    const record = recordOf(stages, stage);
    if (!record) {
      incidents.push({
        component: stage,
        severity: "failed",
        detail: "La etapa no aparece en el manifiesto de esta pasada: no se sabe si corrio.",
        policy: POLICY_BY_STATUS.failed,
      });
      continue;
    }
    if (record.status === "executed") continue;
    incidents.push({
      component: stage,
      severity: SEVERITY_BY_STATUS[record.status],
      detail: `status=${record.status} -- ${record.reason}`,
      policy: POLICY_BY_STATUS[record.status],
    });
  }

  const inventoryReason = String(input.stagingInventoryUnavailableReason ?? "").trim();
  if (inventoryReason.length > 0) {
    incidents.push({
      component: "staging-inventory (lectura REST de solo lectura)",
      severity: "failed",
      detail: inventoryReason,
      policy:
        "Sin inventario real no se resuelve ningun pageId, asi que TODA propuesta queda MANUAL en vez de adivinar una pagina. Se reintenta en la siguiente pasada; si persiste, es un problema de credenciales o de red que se arregla fuera del flujo de aprobacion.",
    });
  }

  return {
    healthy: incidents.every((i) => i.severity !== "failed"),
    incidents,
    employees: DEPARTMENT_STAGE_NAMES.map((stage) => {
      const record = recordOf(stages, stage);
      return { employee: stage, status: record?.status ?? "no registrada", reason: record?.reason ?? "" };
    }),
  };
}

/**
 * Nombres de componentes internos, para reconocer cuando una propuesta
 * habla del departamento en vez de hablar del sitio web. La lista es
 * CERRADA a proposito: son identificadores tecnicos exactos que jamas
 * apareceran como objetivo legitimo de un cambio en WordPress.
 */
const INTERNAL_COMPONENT_NAMES: string[] = [...DEPARTMENT_STAGE_NAMES, "department run", "departmentrunid", "github actions", "workflow"];

/**
 * `true` si este elemento de apply es en realidad una incidencia interna
 * del departamento y no una propuesta de negocio.
 *
 * Deliberadamente CONSERVADOR: hacen falta las tres cosas a la vez.
 * Reconocer de menos solo deja una propuesta rara en la lista; reconocer
 * de mas ocultaria trabajo real de negocio, que es mucho peor. Por eso
 * exige que ademas no haya NINGUN objetivo web resuelto: en cuanto una
 * propuesta apunta a una pagina real, es trabajo del sitio, diga lo que
 * diga su titulo.
 */
export function isInternalTechnicalItem(item: DepartmentApplyItem): boolean {
  if (item.executableChangePlan) return false;
  if (item.applyCapability.target) return false;
  const haystack = `${item.title} ${item.target}`.toLowerCase();
  return INTERNAL_COMPONENT_NAMES.some((name) => haystack.includes(name.toLowerCase()));
}

/** Incidencias derivadas de propuestas que en realidad hablan del propio departamento. */
export function incidentsFromApplyItems(items: DepartmentApplyItem[]): DepartmentHealthIncident[] {
  return items.filter(isInternalTechnicalItem).map((item) => ({
    component: `recomendacion ${item.recommendationId}`,
    severity: "degraded" as DepartmentHealthSeverity,
    detail: `"${item.title}" habla del funcionamiento interno del departamento, no de una pagina del sitio. Se saca de la lista numerada para no gastar una decision de negocio en una incidencia tecnica.`,
    policy: POLICY_BY_STATUS.failed,
  }));
}

export function renderDepartmentHealthLines(report: DepartmentHealthReport): string[] {
  const lines: string[] = [];
  lines.push(
    report.healthy
      ? "Ninguna etapa fallo tecnicamente en esta pasada."
      : "Hay fallos tecnicos internos en esta pasada. NO se aprueban: se reintentan o se arreglan segun la politica tecnica del proyecto."
  );
  for (const row of report.employees) lines.push(`${row.employee}: ${row.status}`);
  for (const incident of report.incidents) {
    lines.push(`[${incident.severity.toUpperCase()}] ${incident.component}: ${incident.detail} -> ${incident.policy}`);
  }
  return lines;
}
