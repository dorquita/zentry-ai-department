import { LandingArchitectComparisonArtifact } from "./landing-architect-comparison";

/**
 * Lee (sin llamar a ningun modelo, sin volver a auditar nada) los avisos
 * de fabricacion YA calculados por auditV2OutputForFabrication() y
 * guardados tal cual en el artefacto de comparacion (comparison.json) --
 * pensado para que .github/workflows/ux-ui-landing-architect-v2.yml
 * pueda mostrarlos en el GitHub Step Summary de forma deterministica,
 * sin pedirle a Claude que los resuma ni reinterprete (ver
 * scripts/print-fabrication-warnings-for-ci.ts para el wrapper de CLI).
 *
 * Fail-safe, no fail-closed: esto es solo para VISUALIZACION -- el
 * fail-closed real (v2Status === "invalid_output" -> proceso termina con
 * codigo 1) ya lo aplica scripts/run-landing-architect-comparison.ts. Un
 * artefacto con forma inesperada (v2.status distinto de "executed",
 * fabricationWarnings ausente o con un tipo incorrecto) simplemente
 * devuelve [] en vez de lanzar -- no queremos que un problema de
 * visualizacion tumbe un workflow que ya paso la validacion real.
 */
export function extractFabricationWarnings(artifact: unknown): string[] {
  if (typeof artifact !== "object" || artifact === null) return [];
  const a = artifact as Partial<LandingArchitectComparisonArtifact>;
  if (!a.v2 || typeof a.v2 !== "object" || (a.v2 as { status?: unknown }).status !== "executed") return [];

  const warnings = (a.v2 as { fabricationWarnings?: unknown }).fabricationWarnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((w): w is string => typeof w === "string");
}
