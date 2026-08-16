import { PageResolution, resolveStagingPage, StagingInventory, StagingPageSnapshot } from "./staging-inventory";

/**
 * RESOLUCION DETERMINISTA DE LA PAGINA OBJETIVO DE UNA RECOMENDACION.
 *
 * El cuello de botella real del departamento no era el permiso de
 * escritura ni el catalogo de operaciones: era que la recomendacion
 * llegaba a `web-engineer` SIN pagina. "Reescribir metas en las paginas
 * con CTR 0%" no dice QUE paginas, y el unico camino que quedaba era
 * pedirle al modelo que adivinara -- cosa que sus propias reglas le
 * prohiben, con razon. Resultado: `requires_manual_staging_implementation`
 * en el 100% de los casos.
 *
 * Este modulo hace ANTES, y de forma determinista, el trabajo que no
 * debe hacer un modelo: extraer las referencias de pagina que la
 * recomendacion y su evidencia YA citan, y resolverlas contra el
 * inventario REAL de staging.
 *
 * Reglas duras, sin excepciones:
 *
 *   - Solo referencias EXPLICITAS: una URL absoluta o un path absoluto
 *     que aparezcan literalmente en el texto. Nunca se infiere una
 *     pagina a partir de una keyword, un tema ni un parecido semantico.
 *   - La resolucion la hace `resolveStagingPage()`, que exige igualdad
 *     exacta (id, URL de staging o slug) y EXACTAMENTE un candidato.
 *   - Cero fuzzy, cero "la que mas se parece", cero eleccion entre
 *     varios candidatos. Varias paginas distintas -> `ambiguous_target`.
 *   - Cero referencias -> `no_target_reference`. Referencias que no
 *     casan -> `unresolved_target`. Los dos son resultados CORRECTOS,
 *     no fallos que haya que rellenar.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj.
 */

/** Estado de UNA referencia textual concreta. */
export type TargetReferenceStatus = "resolved" | "not_in_inventory" | "ambiguous";

export interface TargetReferenceResolution {
  /** La referencia tal como aparecia en el texto. */
  raw: string;
  status: TargetReferenceStatus;
  wordpressPageId: number | null;
  /** `true` si la referencia era de otro entorno (produccion) y se caso por slug. */
  crossEnvironment: boolean;
  reason: string;
}

/** Estado de la recomendacion ENTERA respecto a su pagina objetivo. */
export type RecommendationTargetStatus = "resolved" | "ambiguous_target" | "unresolved_target" | "no_target_reference";

export interface RecommendationTargetResolution {
  status: RecommendationTargetStatus;
  references: TargetReferenceResolution[];
  /** Paginas DISTINTAS resueltas, en el orden en que aparecieron. */
  pages: StagingPageSnapshot[];
  /** Siempre no vacio: por que la recomendacion tiene (o no) pagina objetivo. */
  reason: string;
}

/** URL absoluta. Se corta en el primer caracter que no puede formar parte de una URL en prosa. */
const ABSOLUTE_URL = /https?:\/\/[^\s"'`<>()[\]{},;]+/gi;

/**
 * Path absoluto citado en prosa: `/slug/`, `/una-seccion/otra/`. Se
 * EXIGE barra final -- sin ella, cualquier "y/o", "24/7" o "GA4/GTM"
 * entraria como candidato. Es un filtro deliberadamente estrecho: es
 * preferible no extraer una referencia que extraer una equivocada.
 */
const ABSOLUTE_PATH = /(?:^|[\s"'`(<[])(\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*\/)/gi;

/** Puntuacion de cierre que la prosa pega al final de una URL y que no forma parte de ella. */
function trimTrailingPunctuation(reference: string): string {
  return reference.replace(/[.,;:!?)\]}'"`]+$/, "");
}

/**
 * Extrae las referencias de pagina EXPLICITAS de un conjunto de textos,
 * deduplicadas y conservando el orden de aparicion. No normaliza ni
 * interpreta: eso es trabajo de `resolveStagingPage()`.
 */
export function extractPageReferences(texts: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string) => {
    const value = trimTrailingPunctuation(String(candidate ?? "").trim());
    if (value.length === 0) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(value);
  };

  for (const text of texts) {
    if (typeof text !== "string" || text.length === 0) continue;
    for (const match of text.matchAll(ABSOLUTE_URL)) push(match[0]);
    for (const match of text.matchAll(ABSOLUTE_PATH)) push(match[1]);
  }
  return found;
}

/**
 * Resuelve las referencias de una recomendacion contra el inventario
 * REAL. Fail-closed: si las referencias apuntan a mas de una pagina
 * distinta, NO se elige una -- se declara ambiguo.
 */
export function resolveRecommendationTargets(texts: string[], inventory: StagingInventory): RecommendationTargetResolution {
  const references = extractPageReferences(texts);

  if (references.length === 0) {
    return {
      status: "no_target_reference",
      references: [],
      pages: [],
      reason:
        "La recomendacion (ni su evidencia) cita ninguna URL ni ningun path de pagina. Sin destino explicito no hay pagina que resolver: no se deduce una a partir de la keyword ni del tema.",
    };
  }

  const resolutions: TargetReferenceResolution[] = [];
  const pages: StagingPageSnapshot[] = [];
  const seenIds = new Set<number>();

  for (const raw of references) {
    const resolution: PageResolution = resolveStagingPage(raw, inventory);
    if (resolution.page) {
      resolutions.push({
        raw,
        status: "resolved",
        wordpressPageId: resolution.page.wordpressPageId,
        crossEnvironment: resolution.crossEnvironment,
        reason: resolution.reason,
      });
      if (!seenIds.has(resolution.page.wordpressPageId)) {
        seenIds.add(resolution.page.wordpressPageId);
        pages.push(resolution.page);
      }
      continue;
    }
    resolutions.push({
      raw,
      status: /Ambiguo/i.test(resolution.reason) ? "ambiguous" : "not_in_inventory",
      wordpressPageId: null,
      crossEnvironment: false,
      reason: resolution.reason,
    });
  }

  if (pages.length === 1) {
    const only = pages[0];
    const unresolvedCount = resolutions.filter((r) => r.status !== "resolved").length;
    return {
      status: "resolved",
      references: resolutions,
      pages,
      reason:
        unresolvedCount === 0
          ? `Pagina objetivo resuelta de forma inequivoca contra el inventario real: page ${only.wordpressPageId} (${only.stagingUrl}).`
          : `Pagina objetivo resuelta de forma inequivoca contra el inventario real: page ${only.wordpressPageId} (${only.stagingUrl}). Otras ${unresolvedCount} referencia(s) citada(s) no existen en staging y quedan fuera del alcance ejecutable.`,
    };
  }

  if (pages.length > 1) {
    return {
      status: "ambiguous_target",
      references: resolutions,
      pages,
      reason: `La recomendacion cita ${pages.length} paginas distintas del inventario (${pages.map((p) => p.wordpressPageId).join(", ")}). Un cambio solo puede tener UN destino: no se elige por el modelo ni por este resolver.`,
    };
  }

  return {
    status: "unresolved_target",
    references: resolutions,
    pages: [],
    reason: `Ninguna de las ${resolutions.length} referencia(s) citada(s) casa con una pagina publicada del inventario real de staging. No se adivina el destino de una escritura.`,
  };
}
