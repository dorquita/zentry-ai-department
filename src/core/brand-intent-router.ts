import * as fs from "fs";
import { BrandIntentCategory, BrandIntentResult, BrandTarget } from "./types";
import { resolveActiveClientConfigPath } from "./client-config";

/**
 * Brand / Intent Router — clasifica una keyword (opcionalmente + su pagina)
 * en una de 5 categorias, explicando siempre el porque. Puramente en
 * memoria: no llama a ninguna API, no toca disco salvo leer su config una
 * vez. Usado por SEO Director, Content Planner, CRO Reviewer, Competitor
 * Intelligence y Growth Director para no mezclar Zentry/Tukandado sin
 * criterio (ver docs/brand-intent-strategy.md).
 *
 * Fase O16.1: la config ya no se lee de `config/brand-positioning.json`
 * fijo — se lee de `configPaths.brandPositioning` del ClientConfig
 * ACTIVO (`clients/<id>/brand-positioning.json`). Para "zentry" hoy es
 * una copia mantenida en sincronia manual con la version legacy de
 * `config/` (ver nota en `clients/zentry/brand-positioning.json`).
 */

interface BrandPositioningConfig {
  locker_terms: string[];
  lock_terms: string[];
  smart_terms: string[];
  b2b_sector_terms: string[];
  material_terms: string[];
  low_fit_terms: string[];
}

let cachedConfig: BrandPositioningConfig | undefined;

function loadConfig(): BrandPositioningConfig {
  if (!cachedConfig) {
    const raw = fs.readFileSync(resolveActiveClientConfigPath("brandPositioning"), "utf-8");
    cachedConfig = JSON.parse(raw) as BrandPositioningConfig;
  }
  return cachedConfig;
}

const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, ""); // quita acentos/diacriticos
}

function matchAny(haystack: string, terms: string[]): string[] {
  return terms.filter((t) => haystack.includes(normalize(t)));
}

/**
 * Clasifica un texto libre (normalmente "keyword" o "keyword + page") en
 * una BrandIntentCategory, con la razon explicita del porque.
 */
function classifyText(text: string): BrandIntentResult {
  const cfg = loadConfig();
  const normalized = normalize(text);

  const lockerMatches = matchAny(normalized, cfg.locker_terms);
  const lockMatches = matchAny(normalized, cfg.lock_terms);
  const smartMatches = matchAny(normalized, cfg.smart_terms);
  const matchedB2bSectors = matchAny(normalized, cfg.b2b_sector_terms);
  const matchedMaterials = matchAny(normalized, cfg.material_terms);
  const lowFitMatches = matchAny(normalized, cfg.low_fit_terms);

  const hasLockerTerm = lockerMatches.length > 0;
  const hasLockTerm = lockMatches.length > 0;
  const hasSmartTerm = smartMatches.length > 0;
  const hasLowFitTerm = lowFitMatches.length > 0;

  const signals = {
    hasLockerTerm,
    hasLockTerm,
    hasSmartTerm,
    matchedB2bSectors,
    matchedMaterials,
    hasLowFitTerm,
  };

  const b2bNote =
    matchedB2bSectors.length > 0 ? ` Senal B2B detectada: ${matchedB2bSectors.join(", ")}.` : "";
  const materialNote =
    matchedMaterials.length > 0 ? ` Material/categoria detectado: ${matchedMaterials.join(", ")}.` : "";

  const build = (category: BrandIntentCategory, brand: BrandTarget, reason: string): BrandIntentResult => ({
    category,
    brand,
    reason,
    signals,
  });

  // 1) Trafico de bajo valor (manual/gratis/segunda mano/reset de clave)
  //    SIEMPRE gana primero, aunque tambien mencione taquilla o cerradura:
  //    "manual de instrucciones cerradura" no es un lead de compra solo
  //    porque contenga la palabra "cerradura".
  if (hasLowFitTerm) {
    return build(
      "irrelevant_or_low_fit",
      "none",
      `Contiene senales de trafico de bajo valor (manual/gratis/segunda mano/reset de clave), aunque mencione taquilla o cerradura: la intencion no es de compra.${b2bNote}`
    );
  }

  // 2) Menciona mueble Y cerradura a la vez -> solucion completa (ambas marcas).
  if (hasLockerTerm && hasLockTerm) {
    return build(
      "zentry_smart_locker",
      "both",
      `Menciona mobiliario (taquilla/locker) Y cerradura en el mismo texto: es una busqueda de la solucion completa de taquilla inteligente. Zentry vende el mueble y puede incluir la cerradura de Tukandado.${materialNote}${b2bNote}`
    );
  }

  // 3) Menciona mueble + calificativo "inteligente/electronico" sin decir
  //    "cerradura" explicitamente -> tambien solucion completa.
  if (hasLockerTerm && hasSmartTerm) {
    return build(
      "zentry_smart_locker",
      "both",
      `Menciona mobiliario (taquilla/locker) con un calificativo "inteligente/electronico/digital": aunque no dice "cerradura" explicitamente, la intencion es una taquilla con apertura tecnologica — combinacion Zentry + Tukandado.${materialNote}${b2bNote}`
    );
  }

  // 4) Solo mueble -> Zentry.
  if (hasLockerTerm) {
    return build(
      "zentry_locker_core",
      "zentry",
      `Menciona mobiliario/taquillas sin mencionar cerraduras: intencion principal de compra de mueble, corresponde a Zentry.${materialNote}${b2bNote}`
    );
  }

  // 5) Solo cerradura -> Tukandado.
  if (hasLockTerm) {
    return build(
      "tukandado_lock_core",
      "tukandado",
      `Menciona cerradura/control de acceso sin mencionar taquillas ni mobiliario: intencion principal de compra de cerradura, corresponde a Tukandado. Puede derivar a Zentry si el cliente termina queriendo el mueble completo.${b2bNote}`
    );
  }

  // 6) Ni mueble ni cerradura explicitos, pero hay contexto de sector o
  //    material que sugiere relevancia cruzada -> revision manual.
  if (matchedB2bSectors.length > 0 || matchedMaterials.length > 0) {
    return build(
      "mixed_cross_sell",
      "both",
      `No menciona explicitamente taquilla ni cerradura, pero tiene senales de contexto relevante (sector o material) que sugieren posible interes cruzado.${materialNote}${b2bNote} Requiere revision manual para decidir Zentry vs Tukandado.`
    );
  }

  // 7) Sin ninguna senal relevante.
  return build(
    "irrelevant_or_low_fit",
    "none",
    "No se detecto ninguna senal de taquillas/lockers ni de cerraduras/control de acceso. No prioritaria hasta revision manual."
  );
}

export function classifyKeyword(keyword: string): BrandIntentResult {
  return classifyText(keyword);
}

export function classifyOpportunity(input: { keyword: string; page?: string }): BrandIntentResult {
  const text = input.page ? `${input.keyword} ${input.page}` : input.keyword;
  return classifyText(text);
}

export const BRAND_INTENT_CATEGORY_LABELS: Record<BrandIntentCategory, string> = {
  zentry_locker_core: "Zentry principal — mobiliario/taquillas/lockers",
  zentry_smart_locker: "Zentry + cerradura — solucion completa de taquilla inteligente",
  tukandado_lock_core: "Tukandado principal — cerradura electronica/inteligente",
  mixed_cross_sell: "Mixta — puede derivarse a una u otra marca",
  irrelevant_or_low_fit: "No prioritaria / trafico de bajo valor",
};
