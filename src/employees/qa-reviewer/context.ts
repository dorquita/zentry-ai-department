import * as path from "path";
import { QaReviewedArtifactRef } from "./output";

/**
 * Context builder del empleado `qa-reviewer` -- ver
 * .claude/agents/qa-reviewer.md y docs/claude-employee-runtime.md.
 *
 * Separacion CLAUDE / TOOLS explicita, mismo patron que
 * src/core/landing-architect-v2-context.ts: la lectura de fichero real
 * (I/O) vive en el runner (scripts/run-qa-reviewer.ts), que YA tiene el
 * contenido parseado del artifact antes de llamar aqui. Las funciones de
 * este modulo son deterministicas y puras dado ese contenido ya cargado
 * -- nunca acceden al filesystem por si mismas, nunca deciden nada de
 * calidad de contenido (eso lo hace el modelo, que recibe el
 * `QaReviewerContext` ya resuelto dentro de su prompt y nunca accede al
 * repositorio por su cuenta).
 *
 * A diferencia de ux-ui-landing-architect-v2 (que revisa SIEMPRE la misma
 * forma de change pack), qa-reviewer revisa un artifact JSON de forma
 * arbitraria -- de cualquier empleado presente o futuro. `inferArtifactIdentity`
 * es deliberadamente best-effort: reconoce la forma real de
 * LandingArchitectComparisonArtifact (unico artifact real disponible hoy,
 * ver src/core/landing-architect-comparison.ts) y trata cualquier otra
 * forma de JSON como "generic_json_artifact" -- nunca falla por no
 * reconocer un artifact futuro, solo etiqueta su identidad de forma menos
 * especifica.
 */

export interface QaReviewerContext {
  identity: QaReviewedArtifactRef;
  /** Contenido JSON completo (ya parseado) del artifact bajo revision -- se embebe tal cual en el prompt. */
  artifact: unknown;
}

/**
 * Heuristica de deteccion, sin dependencias de ningun tipo de otro
 * empleado (evita un acoplamiento de import innecesario entre
 * src/employees/qa-reviewer y src/core/landing-architect-comparison.ts):
 * comprueba solo la FORMA superficial esperable de un
 * LandingArchitectComparisonArtifact (changePackId + v1/v2 + structuralDiff).
 */
function looksLikeLandingArchitectComparisonArtifact(obj: Record<string, unknown>): boolean {
  return typeof obj.changePackId === "string" && typeof obj.v1 === "object" && obj.v1 !== null && typeof obj.v2 === "object" && obj.v2 !== null && Array.isArray(obj.structuralDiff);
}

/**
 * Infiere la identidad (`QaReviewedArtifactRef`) de un artifact ya
 * parseado. Pura: no lee ficheros, solo inspecciona el objeto que ya se
 * le paso y la ruta (usada unicamente como etiqueta de trazabilidad, no
 * releida aqui). `artifactId` cae a un id derivado del propio artifact si
 * existe (`changePackId`), o al nombre de fichero sin extension si no.
 */
export function inferArtifactIdentity(artifactPath: string, parsedArtifact: unknown): QaReviewedArtifactRef {
  const obj = typeof parsedArtifact === "object" && parsedArtifact !== null && !Array.isArray(parsedArtifact) ? (parsedArtifact as Record<string, unknown>) : {};

  const isLandingArchitectComparison = looksLikeLandingArchitectComparisonArtifact(obj);

  const artifactType = isLandingArchitectComparison ? "landing_architect_comparison" : "generic_json_artifact";
  const sourceEmployee = isLandingArchitectComparison ? "ux-ui-landing-architect-v2" : "unknown";
  const artifactId = typeof obj.changePackId === "string" && obj.changePackId.length > 0 ? obj.changePackId : path.basename(artifactPath, path.extname(artifactPath));

  return { sourceEmployee, artifactType, artifactId, artifactPath };
}

/** Empaqueta identidad + contenido en el contexto tipado que se embebe en el prompt. Funcion pura, ver cabecera. */
export function buildQaReviewerContext(identity: QaReviewedArtifactRef, artifact: unknown): QaReviewerContext {
  return { identity, artifact };
}
