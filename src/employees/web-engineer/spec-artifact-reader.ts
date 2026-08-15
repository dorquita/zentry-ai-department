import { WebEngineerSpecArtifact } from "./runner-result";

/**
 * Lee (sin llamar a ningun modelo, sin volver a auditar nada) los avisos
 * de capacidad tecnica no confirmada YA calculados por
 * auditWebEngineerOutputForUnconfirmedCapabilities() y guardados tal cual
 * en el artefacto de especificacion (spec.json) -- pensado para que
 * .github/workflows/web-engineer.yml pueda mostrarlos en el GitHub Step
 * Summary de forma deterministica, sin pedirle a Claude que los resuma
 * ni reinterprete. Mismo patron que
 * src/core/comparison-artifact-reader.ts (extractFabricationWarnings),
 * sin modificar ese fichero.
 *
 * Fail-safe, no fail-closed: esto es solo para VISUALIZACION -- el
 * fail-closed real (status === "invalid_output" -> proceso termina con
 * codigo 1) ya lo aplica scripts/run-web-engineer.ts. Un artefacto con
 * forma inesperada simplemente devuelve [] en vez de lanzar.
 */
export function extractCapabilityAuditWarnings(artifact: unknown): string[] {
  if (typeof artifact !== "object" || artifact === null) return [];
  const a = artifact as Partial<WebEngineerSpecArtifact>;
  if (!a.result || typeof a.result !== "object" || (a.result as { status?: unknown }).status !== "executed") return [];

  const warnings = (a.result as { capabilityAuditWarnings?: unknown }).capabilityAuditWarnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((w): w is string => typeof w === "string");
}
