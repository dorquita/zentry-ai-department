import * as fs from "fs";
import * as path from "path";
import { resolveDepartmentRunPaths } from "../run-store";
import { countApplyItems, DEPARTMENT_APPLY_CONTRACT_VERSION, DepartmentApplyItem, DepartmentApplySummary, isDepartmentApplyStatus } from "./types";

/**
 * Persistencia del contrato de APPLY dentro del directorio de LA MISMA
 * pasada coordinada (`reports/department/<departmentRunId>/apply-summary.json`).
 *
 * Vive con el resto de la pasada a proposito: el artifact del run queda
 * autocontenido y la trazabilidad
 * `departmentRunId -> recomendacion -> QA -> aprobacion -> apply ->
 * validacion -> rollback` se lee en un unico sitio, sin cruzar ficheros
 * de otra ejecucion.
 *
 * Solo I/O local. No toca ningun sistema externo.
 */

export function resolveApplySummaryPath(departmentRunId: string): string {
  return resolveDepartmentRunPaths(departmentRunId).applySummaryPath;
}

export function writeApplySummary(summary: DepartmentApplySummary): string {
  const filePath = resolveApplySummaryPath(summary.departmentRunId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), "utf-8");
  return filePath;
}

/**
 * Lee el contrato de apply de una pasada. Fail-closed: una version de
 * contrato distinta lanza en vez de interpretarse a medias; un fichero
 * ausente devuelve `undefined` (estado normal: la pasada todavia no
 * planifico apply).
 */
export function readApplySummary(departmentRunId: string): DepartmentApplySummary | undefined {
  const filePath = resolveApplySummaryPath(departmentRunId);
  if (!fs.existsSync(filePath)) return undefined;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DepartmentApplySummary;
  if (raw.contractVersion !== DEPARTMENT_APPLY_CONTRACT_VERSION) {
    throw new Error(
      `apply-summary.json del run "${departmentRunId}": contractVersion "${String(raw.contractVersion)}" no soportada (se esperaba "${DEPARTMENT_APPLY_CONTRACT_VERSION}"). Fail-closed.`
    );
  }
  if (!Array.isArray(raw.items) || !raw.items.every((item) => isDepartmentApplyStatus(item.applyStatus))) {
    throw new Error(`apply-summary.json del run "${departmentRunId}" invalido: items[] debe tener applyStatus validos. Fail-closed.`);
  }
  if (raw.departmentRunId !== departmentRunId) {
    throw new Error(
      `apply-summary.json incoherente: contiene departmentRunId "${raw.departmentRunId}" pero se leyo del directorio de "${departmentRunId}". Fail-closed -- no se mezclan dos pasadas.`
    );
  }
  return raw;
}

/** Reescribe el resumen con los elementos ya ejecutados, recalculando los conteos (nunca se guardan conteos a mano). */
export function updateApplySummaryItems(
  summary: DepartmentApplySummary,
  items: DepartmentApplyItem[],
  updates: { externalWritesPerformed: boolean; productionWritesPerformed: boolean; applyNotAttemptedReason: string }
): DepartmentApplySummary {
  return {
    ...summary,
    items,
    counts: countApplyItems(items),
    externalWritesPerformed: updates.externalWritesPerformed,
    productionWritesPerformed: updates.productionWritesPerformed,
    applyNotAttemptedReason: updates.applyNotAttemptedReason,
  };
}
