import { SemEvidenceCatalogItem, SemSpecialistContext } from "./sem-specialist-context";

/**
 * Validador/auditor de dominio del empleado `sem-specialist` -- mismo
 * patron que `src/core/landing-architect-comparison.ts`
 * (`validateV2Output()` / `auditV2OutputForFabrication()`): sin librerias
 * externas, fail-closed, TOOL puro (no invoca a Claude ni decide nada,
 * solo valida/audita/formatea lo que ya devolvio el subagente).
 *
 * Recibe SIEMPRE `raw: unknown` ya validado contra
 * config/sem-specialist-output.schema.json por el runtime comun
 * (src/core/claude-employee-runtime.ts) -- nunca al reves.
 */

export type SemFindingSeverity = "info" | "low" | "medium" | "high";
export type SemExperimentPriority = "low" | "medium" | "high";

export interface SemFinding {
  title: string;
  description: string;
  evidenceRefs: string[];
  severity: SemFindingSeverity;
}

export interface SemExperiment {
  title: string;
  hypothesis: string;
  expectedImpact: string;
  evidenceRefs: string[];
  priority: SemExperimentPriority;
}

export interface SemEvidenceItem {
  id: string;
  contextField: string;
  value: string;
}

export interface SemSpecialistOutput {
  summary: string;
  campaignFindings: SemFinding[];
  searchTermOpportunities: SemFinding[];
  negativeKeywordRecommendations: SemFinding[];
  budgetObservations: SemFinding[];
  biddingObservations: SemFinding[];
  adLandingAlignment: SemFinding[];
  conversionRiskFindings: SemFinding[];
  prioritizedExperiments: SemExperiment[];
  evidence: SemEvidenceItem[];
  unknowns: string[];
}

const SEVERITIES: SemFindingSeverity[] = ["info", "low", "medium", "high"];
const PRIORITIES: SemExperimentPriority[] = ["low", "medium", "high"];

const FINDING_FIELDS = [
  "campaignFindings",
  "searchTermOpportunities",
  "negativeKeywordRecommendations",
  "budgetObservations",
  "biddingObservations",
  "adLandingAlignment",
  "conversionRiskFindings",
] as const;

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isFinding(v: unknown): v is SemFinding {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.title) && isString(o.description) && isStringArray(o.evidenceRefs) && isString(o.severity) && SEVERITIES.includes(o.severity as SemFindingSeverity);
}

function isExperiment(v: unknown): v is SemExperiment {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.title) &&
    isString(o.hypothesis) &&
    isString(o.expectedImpact) &&
    isStringArray(o.evidenceRefs) &&
    isString(o.priority) &&
    PRIORITIES.includes(o.priority as SemExperimentPriority)
  );
}

function isEvidenceItem(v: unknown): v is SemEvidenceItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.id) && isString(o.contextField) && isString(o.value);
}

/**
 * Valida (sin librerias externas) que un objeto crudo tiene la forma
 * minima de un `SemSpecialistOutput`. Fail-closed: cualquier campo
 * obligatorio ausente o del tipo equivocado lanza -- nunca se "rellena"
 * con un valor por defecto que disfrazaria una salida rota del subagente
 * como si fuera valida.
 */
export function validateSemSpecialistOutput(raw: unknown): SemSpecialistOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salida sem-specialist invalida: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  if (!isString(o.summary)) {
    throw new Error('Salida sem-specialist invalida: falta "summary" (string).');
  }

  for (const field of FINDING_FIELDS) {
    if (!Array.isArray(o[field]) || !(o[field] as unknown[]).every(isFinding)) {
      throw new Error(`Salida sem-specialist invalida: "${field}" debe ser un array de { title, description, evidenceRefs, severity }.`);
    }
  }

  if (!Array.isArray(o.prioritizedExperiments) || !o.prioritizedExperiments.every(isExperiment)) {
    throw new Error('Salida sem-specialist invalida: "prioritizedExperiments" debe ser un array de { title, hypothesis, expectedImpact, evidenceRefs, priority }.');
  }
  if (!Array.isArray(o.evidence) || !o.evidence.every(isEvidenceItem)) {
    throw new Error('Salida sem-specialist invalida: "evidence" debe ser un array de { id, contextField, value }.');
  }
  if (!isStringArray(o.unknowns)) {
    throw new Error('Salida sem-specialist invalida: "unknowns" debe ser string[].');
  }

  return o as unknown as SemSpecialistOutput;
}

// --- Auditoria de afirmaciones cuantitativas sin respaldo -----------------
//
// La mision de sem-specialist es explicita: "NO inventa CPC, conversiones,
// ROAS ni gasto". A diferencia de `auditV2OutputForFabrication()` (que
// SIEMPRE devuelve warnings para revision humana, nunca bloquea), aqui
// una afirmacion cuantitativa sin respaldo es un FALLO DURO: el runner
// (scripts/run-sem-specialist.ts) trata cualquier violacion devuelta por
// `auditSemSpecialistOutputForUnsupportedClaims()` como `status:
// "invalid_output"`, exactamente igual que un error de forma.
//
// FIX ESTRUCTURAL (evidenceCatalog determinista, ver
// sem-specialist-context.ts): en vez de una heuristica difusa (resolver
// una ruta de contexto + comparar texto parcial), la evidencia se valida
// por COINCIDENCIA EXACTA contra un catalogo pre-computado por codigo
// TOOL antes de invocar a Claude -- el subagente solo puede copiar
// entradas del catalogo tal cual (mismo id+contextField+value), nunca
// inventar ni modificar una. Esto hace estructuralmente imposible que
// una evidencia "casi real" (numero real de un campo no relacionado,
// formato ligeramente distinto) pase la auditoria por coincidencia.
//
// Dos capas de verificacion, ambas necesarias:
//   1. Cada `evidence[]` declarado debe coincidir EXACTAMENTE con una
//      entrada del `evidenceCatalog` del contexto -- una "evidencia"
//      inventada o modificada rompe la cadena de confianza aunque luego
//      se referencie desde un finding.
//   2. Cualquier cifra de CPC/conversiones/ROAS/gasto/presupuesto en el
//      texto de salida debe (a) ser un numero conocido del catalogo Y
//      (b) tener al menos una entrada de evidenceRefs verificada, de la
//      MISMA categoria determinista, que contenga ese mismo numero.

interface QuantClaimCategory {
  id: string;
  label: string;
  pattern: RegExp;
}

// Patron "gap": el nombre de la categoria (p.ej. "cpc", "presupuesto")
// seguido, dentro de una ventana corta de caracteres NO numericos, por la
// cifra que se esta afirmando -- deliberadamente laxo sobre la prosa
// intermedia ("el CPC medio es de", "el presupuesto total si se
// activaran todas las campanas es de") para no depender de una redaccion
// exacta, igual de estricto sobre EXIGIR que la cifra este realmente
// cerca de la palabra clave (ventana acotada, no "en cualquier parte del
// texto") para no disparar falsos positivos entre frases distintas.
const GAP = "[^\\d]{0,40}?";

// La cifra capturada NUNCA puede estar pegada a una letra/digito/guion
// bajo vecino -- sin este guardado, un identificador o etiqueta como
// "LAST_30_DAYS" (metricsWindow real de sem-watcher) cerca de la palabra
// "gasto" haria que "30" se leyera como una cifra de gasto inventada
// (falso positivo real, detectado durante la verificacion manual de este
// runner contra datos locales reales).
const NUM = "(?<![\\w])(\\d+(?:[.,]\\d+)?)(?![\\w])";

const QUANT_CLAIM_CATEGORIES: QuantClaimCategory[] = [
  { id: "cpc", label: "CPC", pattern: new RegExp(`cpc${GAP}${NUM}`, "gi") },
  // Dos ordenes de frase: "12 conversiones" (numero primero, habitual en
  // metricas tabulares) Y "conversiones: 12" / "el numero de conversiones
  // fue de 12" (palabra clave primero) -- solo cubrir el primer orden
  // dejaba sin auditar cualquier afirmacion fabricada con el orden
  // inverso (detectado en code review).
  { id: "conversiones", label: "conversiones", pattern: new RegExp(`${NUM}\\s*conversion(?:es)?\\b|conversion(?:es)?${GAP}${NUM}`, "gi") },
  { id: "roas", label: "ROAS", pattern: new RegExp(`roas${GAP}${NUM}`, "gi") },
  { id: "gasto", label: "gasto/coste", pattern: new RegExp(`(?:gasto|coste)${GAP}${NUM}\\s*€?`, "gi") },
  { id: "presupuesto", label: "presupuesto", pattern: new RegExp(`presupuesto${GAP}${NUM}\\s*€?`, "gi") },
];

/**
 * Numeros "conocidos" = los valores REALES presentes en el
 * evidenceCatalog determinista (nunca cualquier numero de cualquier
 * parte del contexto -- eso era el bug de la version anterior, que
 * permitia coincidencias por casualidad con campos sin relacion). Salta
 * las entradas centinela no numericas ("not_available" de CPC/ROAS).
 * Varias representaciones textuales de cada numero (coma/punto decimal,
 * con/sin decimales) para no fallar por un simple formato distinto entre
 * el catalogo y la prosa de salida.
 */
function buildKnownNumberTokensFromCatalog(catalog: SemEvidenceCatalogItem[]): Set<string> {
  const tokens = new Set<string>();
  for (const item of catalog) {
    const n = Number(item.value);
    if (!Number.isFinite(n)) continue;
    tokens.add(String(n));
    tokens.add(n.toFixed(2));
    tokens.add(n.toFixed(0));
    tokens.add(n.toFixed(2).replace(".", ","));
  }
  return tokens;
}

/**
 * Interpretaciones numericas candidatas de un texto que "parece un
 * numero" en prosa espanola/europea. SIEMPRE incluye la interpretacion
 * directa (coma como separador decimal, punto como separador decimal si
 * no hay coma) -- la interpretacion "punto como separador de miles"
 * (p.ej. "1.320" -> 1320) SOLO se anade si el texto tiene la forma EXACTA
 * de agrupacion de miles (grupos de 3 digitos tras cada punto). Sin esta
 * restriccion, un decimal genuino con punto como "0.45" se leeria como
 * 45 (bug real detectado en code review: corrompia decimales legitimos y
 * podia hacer pasar una cifra fabricada que casualmente coincidiera con
 * un entero real no relacionado en cualquier otra parte del contexto).
 */
function numericCandidates(rawMatch: string): number[] {
  const trimmed = rawMatch.trim();
  const candidates: number[] = [];
  const direct = parseFloat(trimmed.replace(",", "."));
  if (Number.isFinite(direct)) candidates.push(direct);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) {
    const thousands = parseFloat(trimmed.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(thousands)) candidates.push(thousands);
  }
  return candidates;
}

function numberIsKnown(rawMatch: string, knownTokens: Set<string>): boolean {
  const normalized = rawMatch.trim();
  if (knownTokens.has(normalized)) return true;
  for (const n of numericCandidates(normalized)) {
    if (knownTokens.has(String(n)) || knownTokens.has(n.toFixed(2)) || knownTokens.has(n.toFixed(0)) || knownTokens.has(n.toFixed(2).replace(".", ","))) {
      return true;
    }
  }
  return false;
}

/**
 * Busca, en el evidenceCatalog determinista, una entrada que coincida
 * EXACTAMENTE (id + contextField + value, los 3 campos) con una entrada
 * de `evidence[]` del output. `undefined` si no hay ninguna coincidencia
 * exacta -- el subagente solo puede copiar entradas del catalogo tal
 * cual, nunca inventar una nueva ni modificar un campo de una existente
 * (ni siquiera un espacio o un decimal distinto).
 */
function findCatalogMatch(item: SemEvidenceItem, catalog: SemEvidenceCatalogItem[]): SemEvidenceCatalogItem | undefined {
  return catalog.find((c) => c.id === item.id && c.contextField === item.contextField && c.value === item.value);
}

interface ClaimText {
  field: string;
  text: string;
  evidenceRefs: string[];
}

function collectClaimTexts(output: SemSpecialistOutput): ClaimText[] {
  const items: ClaimText[] = [{ field: "summary", text: output.summary, evidenceRefs: [] }];

  for (const field of FINDING_FIELDS) {
    for (const f of output[field]) {
      items.push({ field: `${field}: ${f.title}`, text: `${f.title}. ${f.description}`, evidenceRefs: f.evidenceRefs });
    }
  }
  for (const e of output.prioritizedExperiments) {
    items.push({ field: `prioritizedExperiments: ${e.title}`, text: `${e.title}. ${e.hypothesis} ${e.expectedImpact}`, evidenceRefs: e.evidenceRefs });
  }
  return items;
}

/**
 * Auditoria FAIL-CLOSED de afirmaciones cuantitativas sin respaldo. Un
 * array vacio significa "sin violaciones" -- cualquier entrada devuelta
 * aqui debe tratarse como un fallo DURO por quien la llama (nunca un
 * simple aviso), ver cabecera de esta seccion.
 */
export function auditSemSpecialistOutputForUnsupportedClaims(context: SemSpecialistContext, output: SemSpecialistOutput): string[] {
  const catalog = context.evidenceCatalog;
  const knownTokens = buildKnownNumberTokensFromCatalog(catalog);
  const violations: string[] = [];

  // Cada entrada de evidence[] debe coincidir EXACTAMENTE (id+contextField+value)
  // con una entrada del evidenceCatalog determinista -- nunca una
  // aproximacion, nunca un valor "parecido". Solo las entradas que SI
  // coinciden quedan disponibles para respaldar afirmaciones cuantitativas
  // mas abajo (evidenceCatalogMatchById).
  const evidenceCatalogMatchById = new Map<string, SemEvidenceCatalogItem>();
  const seenIds = new Set<string>();
  for (const item of output.evidence) {
    if (seenIds.has(item.id)) {
      violations.push(`evidence duplicada: el id "${item.id}" aparece mas de una vez en evidence[].`);
    }
    seenIds.add(item.id);
    const match = findCatalogMatch(item, catalog);
    if (!match) {
      violations.push(
        `evidence no coincide EXACTAMENTE con ninguna entrada del evidenceCatalog determinista: id="${item.id}" contextField="${item.contextField}" value="${item.value}" -- evidence[] solo puede reutilizar id/contextField/value tal cual del evidenceCatalog entregado en el contexto, nunca inventar ni modificar una entrada.`
      );
    } else {
      evidenceCatalogMatchById.set(item.id, match);
    }
  }

  for (const claim of collectClaimTexts(output)) {
    for (const category of QUANT_CLAIM_CATEGORIES) {
      const matches = [...claim.text.matchAll(category.pattern)];
      for (const match of matches) {
        // match[1] o match[2] segun la rama de la alternativa que haya
        // capturado (algunas categorias, p.ej. "conversiones", admiten
        // dos ordenes de frase -- ver QUANT_CLAIM_CATEGORIES).
        const numberRaw = match[1] ?? match[2];
        if (!numberRaw) continue;

        if (!numberIsKnown(numberRaw, knownTokens)) {
          violations.push(
            `Afirmacion cuantitativa sin respaldo (${category.label}): "${match[0].trim()}" en "${claim.field}" -- ese numero no aparece en el evidenceCatalog del snapshot suministrado. Prohibido inventar CPC/conversiones/ROAS/gasto/presupuesto (para CPC/ROAS, hoy el catalogo solo tiene la entrada "not_available" -- ninguna cifra numerica de esas 2 categorias puede tener respaldo real todavia).`
          );
          continue;
        }

        const hasVerifiedEvidenceRef = claim.evidenceRefs.some((refId) => {
          const catalogItem = evidenceCatalogMatchById.get(refId);
          if (!catalogItem) return false; // no citado en evidence[], o evidence[] no coincidia con el catalogo (ya reportado arriba)
          // La evidencia debe ser de la MISMA categoria deterministica que
          // la afirmacion (asignada una unica vez al construir el
          // catalogo, nunca adivinada aqui por substring) -- sin esto, una
          // evidencia real pero de una categoria sin relacion (p.ej.
          // totalCampaigns, categoria "other") podia "respaldar" una cifra
          // de CPC totalmente inventada solo porque el numero coincidia
          // (misattribution real, detectado en code review de la version
          // anterior de este auditor).
          if (catalogItem.category !== category.id) return false;
          return catalogItem.value.includes(numberRaw) || numericCandidates(numberRaw).some((n) => String(n) === catalogItem.value);
        });
        if (!hasVerifiedEvidenceRef) {
          violations.push(
            `Afirmacion cuantitativa (${category.label}) "${match[0].trim()}" en "${claim.field}" no tiene ninguna evidenceRefs que apunte a una entrada del evidenceCatalog de esa MISMA categoria -- toda cifra de CPC/conversiones/ROAS/gasto/presupuesto necesita una entrada exacta del catalogo, referenciada explicitamente.`
          );
        }
      }
    }
  }

  return violations;
}

// --- Resultado del runner + artefacto -------------------------------------

export type SemRunnerStatus = "no_data" | "pending_execution" | "executed" | "invalid_output";

export type SemResult =
  | { status: "no_data" }
  | { status: "pending_execution"; promptFilePath: string }
  | { status: "invalid_output"; error: string; rawOutputPath: string; violations: string[] }
  | { status: "executed"; output: SemSpecialistOutput };

/**
 * Contrato machine-readable que imprime el runner al final de cada
 * ejecucion (linea `RUNNER_RESULT_JSON=...`, ver
 * scripts/run-sem-specialist.ts). Estructura FIJA e IDENTICA en los 4
 * estados posibles de `status` -- mismo principio que
 * `RunnerResultSummary` de landing-architect-comparison.ts.
 */
export interface SemRunnerResultSummary {
  status: SemRunnerStatus;
  sourceEventId: string;
  sourceDepartmentRunId: string;
  promptFilePath: string;
  expectedOutputPath: string;
  artifactJsonPath: string;
  artifactMdPath: string;
  /** null salvo que status sea "executed" (siempre 0 en ese caso -- una violacion fuerza invalid_output) o "invalid_output" (numero real de violaciones). */
  unsupportedClaimCount: number | null;
}

export function buildSemRunnerResultSummary(
  context: SemSpecialistContext | null,
  paths: { promptFilePath: string; expectedOutputPath: string; artifactJsonPath: string; artifactMdPath: string },
  result: SemResult
): SemRunnerResultSummary {
  const noData = result.status === "no_data";
  return {
    status: result.status,
    sourceEventId: context?.sourceEventId ?? "",
    sourceDepartmentRunId: context?.sourceDepartmentRunId ?? "",
    promptFilePath: noData ? "" : paths.promptFilePath,
    expectedOutputPath: noData ? "" : paths.expectedOutputPath,
    artifactJsonPath: paths.artifactJsonPath,
    artifactMdPath: paths.artifactMdPath,
    unsupportedClaimCount: result.status === "invalid_output" ? result.violations.length : result.status === "executed" ? 0 : null,
  };
}

export interface SemSpecialistArtifact {
  generatedAt: string;
  context: SemSpecialistContext | null;
  result: SemResult;
  note: string;
}

const ARTIFACT_NOTE =
  "Artefacto de solo lectura/propuesta. sem-specialist NUNCA modifica campanas, presupuestos, keywords ni anuncios de Google Ads -- este artefacto es una propuesta para revision humana, no una accion ejecutada.";

export function buildSemSpecialistArtifact(context: SemSpecialistContext | null, result: SemResult): SemSpecialistArtifact {
  return {
    generatedAt: new Date().toISOString(),
    context,
    result,
    note: ARTIFACT_NOTE,
  };
}

function fmtFindings(heading: string, findings: SemFinding[]): string[] {
  const lines: string[] = [`## ${heading} (${findings.length})`, ""];
  if (findings.length === 0) {
    lines.push("(ninguno)");
  } else {
    for (const f of findings) {
      lines.push(`- **[${f.severity}] ${f.title}** -- ${f.description} (evidencia: ${f.evidenceRefs.join(", ") || "ninguna"})`);
    }
  }
  lines.push("");
  return lines;
}

export function renderSemSpecialistMarkdown(artifact: SemSpecialistArtifact): string {
  const lines: string[] = [];
  lines.push(`# SEM Specialist — ${artifact.generatedAt}`);
  lines.push("");

  if (!artifact.context) {
    lines.push(
      "**Estado: sin datos SEM disponibles (no_data).** No existe ningun evento `sem-watcher` de tipo `agent_finished` en `data/department-events.jsonl` todavia. Este empleado NUNCA razona sin una lectura previa real (o documentada como fallback) de sem-watcher -- no se ha generado ninguna propuesta, y no se ha invocado a Claude."
    );
    lines.push("");
    lines.push(`_${artifact.note}_`);
    lines.push("");
    return lines.join("\n");
  }

  const c = artifact.context;
  lines.push(`- **Fuente:** evento sem-watcher \`${c.sourceEventId}\` (departmentRunId \`${c.sourceDepartmentRunId}\`, generado ${c.sourceGeneratedAt})`);
  lines.push(`- **Conectado a Google Ads real en ese momento:** ${c.connectedToGoogleAdsAtSourceTime ? "si" : "no"}`);
  lines.push(`- **Campana principal:** ${c.campaignName || "(desconocida)"} (${c.campaignStatus || "?"})`);
  lines.push("");
  lines.push("**No se ha aplicado ninguna propuesta a Google Ads. sem-specialist es solo lectura/propuesta.**");
  lines.push("");

  if (artifact.result.status === "pending_execution") {
    lines.push(`**Estado: pendiente de ejecucion.** Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("- Para completar el analisis: invocar el subagente `sem-specialist` con ese prompt y volver a ejecutar este runner con `--sem-specialist-output <fichero-json-de-respuesta>`.");
    lines.push("");
  } else if (artifact.result.status === "invalid_output") {
    lines.push(`**Estado: salida invalida.** ${artifact.result.error}`);
    lines.push(`- Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
    if (artifact.result.violations.length > 0) {
      lines.push("");
      lines.push(`**Violaciones de afirmaciones cuantitativas sin respaldo (${artifact.result.violations.length}):**`);
      for (const v of artifact.result.violations) lines.push(`- ${v}`);
    }
    lines.push("");
  } else if (artifact.result.status === "executed") {
    const o = artifact.result.output;
    lines.push("## Resumen");
    lines.push("");
    lines.push(o.summary);
    lines.push("");
    lines.push(...fmtFindings("Campaign findings", o.campaignFindings));
    lines.push(...fmtFindings("Search-term / keyword opportunities", o.searchTermOpportunities));
    lines.push(...fmtFindings("Negative keyword recommendations", o.negativeKeywordRecommendations));
    lines.push(...fmtFindings("Budget observations", o.budgetObservations));
    lines.push(...fmtFindings("Bidding observations", o.biddingObservations));
    lines.push(...fmtFindings("Ad / landing alignment", o.adLandingAlignment));
    lines.push(...fmtFindings("Conversion-risk findings", o.conversionRiskFindings));

    lines.push(`## Prioritized experiments (${o.prioritizedExperiments.length})`);
    lines.push("");
    if (o.prioritizedExperiments.length === 0) {
      lines.push("(ninguno)");
    } else {
      for (const e of o.prioritizedExperiments) {
        lines.push(`- **[${e.priority}] ${e.title}** -- hipotesis: ${e.hypothesis}. Impacto esperado: ${e.expectedImpact}. (evidencia: ${e.evidenceRefs.join(", ") || "ninguna"})`);
      }
    }
    lines.push("");

    lines.push(`## Evidence (${o.evidence.length})`);
    lines.push("");
    if (o.evidence.length === 0) {
      lines.push("(ninguna)");
    } else {
      for (const ev of o.evidence) lines.push(`- \`${ev.id}\`: ${ev.contextField} = ${ev.value}`);
    }
    lines.push("");

    lines.push(`## Unknowns (${o.unknowns.length})`);
    lines.push("");
    if (o.unknowns.length === 0) {
      lines.push("(ninguno declarado)");
    } else {
      for (const u of o.unknowns) lines.push(`- ${u}`);
    }
    lines.push("");
  }

  lines.push(`_${artifact.note}_`);
  lines.push("");
  return lines.join("\n");
}
