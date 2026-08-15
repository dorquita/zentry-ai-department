import { DepartmentApplyCapability, StagingPublishedMetaUpdateTarget } from "./types";

/**
 * REGISTRO DE CAPACIDADES DE APPLY -- que puede ejecutar de verdad este
 * sistema, y que NO.
 *
 * Principio, sin excepciones: una recomendacion solo es aplicable si
 * existe YA un executor determinista, validado y REVERSIBLE para ella.
 * No se fabrican executors nuevos para recomendaciones arbitrarias, y
 * Claude nunca ejecuta codigo sobre WordPress: razona y propone; este
 * catalogo decide si eso se traduce a una operacion permitida, y el
 * executor de TypeScript ejecuta solo esa operacion.
 *
 * Unica capacidad soportada hoy: `staging_published_meta_update`
 * (title/meta description de una pagina de staging que YA esta
 * PUBLICADA y que YA pertenece a este sistema). Se apoya en
 * `updateStagingPublishedPageContent()` de src/adapters/wordpress.ts,
 * que:
 *
 *   - exige `WORDPRESS_DRAFTS_ENABLED=true`,
 *   - llama a `assertWordpressWriteAllowed()` (produccion BLOQUEADA de
 *     forma incondicional en ese adaptador),
 *   - relee la pagina y rechaza escribir si su status actual no es
 *     `publish` (nunca publica ni despublica nada),
 *   - nunca toca el slug.
 *
 * Por que PUBLICADA y no borrador: staging es el entorno VISUAL de
 * revision de este flujo. Un borrador de WordPress no se puede abrir
 * como una URL normal desde el movil, asi que un cambio en borrador no
 * es revisable y por tanto no es aprobable.
 *
 * Este modulo es PURO: no lee ficheros, no llama a WordPress. Recibe ya
 * resuelto el catalogo de paginas de staging publicadas que este sistema
 * posee.
 *
 * FORMATO MAQUINA (deliberadamente estricto). Para que una propuesta de
 * web-engineer sea ejecutable debe cumplir LAS DOS cosas:
 *
 *   1. Apuntar a EXACTAMENTE UNA pagina del catalogo, citada de forma no
 *      ambigua (`page_id=<N>` o la URL exacta de staging).
 *   2. Declarar el nuevo contenido en lineas propias:
 *
 *          TITLE: <nuevo title>
 *          META: <nueva meta description>
 *
 * Cualquier ambiguedad (ninguna pagina, varias paginas, ningun valor
 * nuevo, valores vacios) -> no soportado. Es intencionadamente dificil
 * de satisfacer por accidente: el coste de un falso positivo aqui es
 * escribir en un sitio real.
 */

/** Una pagina de staging PUBLICADA que este sistema controla. */
export interface OwnedStagingPage {
  wordpressPageId: number;
  /** URL publica de staging. Vacia = no consta, y entonces no sirve como destino revisable. */
  stagingUrl: string;
}

export interface ResolveApplyCapabilityInput {
  /** Textos donde buscar el objetivo y el contenido nuevo: descripcion + paginas objetivo de la especificacion. */
  specificationTexts: string[];
  ownedStagingPages: OwnedStagingPage[];
  /** `false` cuando no hay especificacion tecnica de web-engineer para esta recomendacion. */
  hasSpecification: boolean;
}

const TITLE_DIRECTIVE = /^[ \t]*TITLE[ \t]*:[ \t]*(.+?)[ \t]*$/im;
const META_DIRECTIVE = /^[ \t]*META[ \t]*:[ \t]*(.+?)[ \t]*$/im;
const PAGE_ID_REFERENCE = /page_id=(\d{1,9})/gi;

/** Longitudes maximas defensivas -- un title/meta absurdamente largo es senal de que se ha capturado texto que no era el valor. */
export const MAX_TITLE_LENGTH = 200;
export const MAX_META_LENGTH = 400;

function normalizeUrl(url: string): string {
  return String(url ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Encuentra las paginas del catalogo citadas de forma inequivoca en los
 * textos. Devuelve los ids DISTINTOS encontrados -- quien llama exige
 * exactamente uno.
 */
export function findReferencedStagingPages(texts: string[], ownedStagingPages: OwnedStagingPage[]): number[] {
  const ownedById = new Map(ownedStagingPages.map((p) => [p.wordpressPageId, p]));
  const ownedByUrl = new Map(ownedStagingPages.filter((p) => p.stagingUrl.trim().length > 0).map((p) => [normalizeUrl(p.stagingUrl), p]));
  const found = new Set<number>();

  for (const text of texts) {
    if (typeof text !== "string" || text.trim().length === 0) continue;

    for (const match of text.matchAll(PAGE_ID_REFERENCE)) {
      const id = Number.parseInt(match[1], 10);
      if (ownedById.has(id)) found.add(id);
    }

    // URL exacta (el texto completo del campo, no una subcadena suelta):
    // aceptar subcadenas invitaria a falsos positivos por prefijos.
    const byUrl = ownedByUrl.get(normalizeUrl(text));
    if (byUrl) found.add(byUrl.wordpressPageId);
  }

  return [...found];
}

function extractDirective(texts: string[], pattern: RegExp, maxLength: number): { value: string | null; ambiguous: boolean } {
  const values: string[] = [];
  for (const text of texts) {
    if (typeof text !== "string") continue;
    const match = text.match(pattern);
    if (match && match[1].trim().length > 0) values.push(match[1].trim());
  }
  const distinct = [...new Set(values)];
  if (distinct.length === 0) return { value: null, ambiguous: false };
  if (distinct.length > 1) return { value: null, ambiguous: true };
  const value = distinct[0];
  if (value.length > maxLength) return { value: null, ambiguous: true };
  return { value, ambiguous: false };
}

function unsupported(reason: string): DepartmentApplyCapability {
  return { id: null, supported: false, reason, target: null };
}

/**
 * Decide si existe executor para esta propuesta. Determinista y
 * conservador: ante la minima duda, `supported: false` -- que se traduce
 * en `requires_manual_staging_implementation`, nunca en un intento "a
 * ver si cuela".
 */
export function resolveApplyCapability(input: ResolveApplyCapabilityInput): DepartmentApplyCapability {
  if (!input.hasSpecification) {
    return unsupported(
      "No hay especificacion tecnica de web-engineer para esta recomendacion en esta pasada. Sin especificacion no existe nada ejecutable: requiere implementacion manual en staging."
    );
  }

  if (input.ownedStagingPages.length === 0) {
    return unsupported(
      "No hay ninguna pagina de staging PUBLICADA registrada como propia de este sistema con la que emparejar la propuesta. Requiere implementacion manual en staging."
    );
  }

  const referenced = findReferencedStagingPages(input.specificationTexts, input.ownedStagingPages);
  if (referenced.length === 0) {
    return unsupported(
      "La especificacion no cita de forma inequivoca ninguna pagina de staging publicada de este sistema (ni `page_id=<N>` ni su URL exacta). Requiere implementacion manual -- no se adivina el destino de una escritura."
    );
  }
  if (referenced.length > 1) {
    return unsupported(
      `La especificacion cita ${referenced.length} paginas de staging distintas (${referenced.join(", ")}). Fail-closed: un cambio solo puede tener UN destino. Requiere implementacion manual.`
    );
  }

  const title = extractDirective(input.specificationTexts, TITLE_DIRECTIVE, MAX_TITLE_LENGTH);
  const meta = extractDirective(input.specificationTexts, META_DIRECTIVE, MAX_META_LENGTH);

  if (title.ambiguous || meta.ambiguous) {
    return unsupported(
      "La especificacion declara valores de TITLE/META contradictorios o desproporcionadamente largos. Fail-closed: requiere implementacion manual."
    );
  }
  if (title.value === null && meta.value === null) {
    return unsupported(
      'La especificacion no declara ningun contenido nuevo en formato ejecutable (lineas "TITLE: ..." y/o "META: ..."). Es una propuesta redactada para una persona, no para un executor: requiere implementacion manual.'
    );
  }

  const page = input.ownedStagingPages.find((p) => p.wordpressPageId === referenced[0]);
  if (!page) {
    return unsupported(`Incoherencia interna resolviendo la pagina ${referenced[0]}. Fail-closed: requiere implementacion manual.`);
  }
  if (page.stagingUrl.trim().length === 0) {
    return unsupported(
      `La pagina ${page.wordpressPageId} no tiene URL publica de staging registrada, asi que el cambio no seria revisable desde el movil. Fail-closed: requiere implementacion manual.`
    );
  }

  const target: StagingPublishedMetaUpdateTarget = {
    capabilityId: "staging_published_meta_update",
    wordpressPageId: page.wordpressPageId,
    stagingUrl: page.stagingUrl,
    newTitle: title.value,
    newMetaDescription: meta.value,
  };

  return {
    id: "staging_published_meta_update",
    supported: true,
    reason: `Cambio reversible de title/meta sobre la pagina de staging PUBLICADA ${page.wordpressPageId}, que ya pertenece a este sistema y es revisable en ${page.stagingUrl}. Executor determinista existente (actualiza contenido de una pagina ya publicada en staging; nunca cambia su status ni su slug, nunca toca produccion).`,
    target,
  };
}
