import {
  GROWTH_CHANNELS,
  GROWTH_DEPENDENCY_STATUSES,
  GROWTH_LEVELS,
  GrowthChannel,
  GrowthChannelSignal,
  GrowthDependencyItem,
  GrowthDirectorV2Output,
  GrowthEvidenceItem,
  GrowthExperimentIdea,
  GrowthLevel,
  GrowthPriority,
  GrowthRiskItem,
} from "./types";
import { GrowthDirectorV2Context } from "./context";

/**
 * Validador (fail-closed, sin librerias externas) + auditor de dominio +
 * artefacto/markdown para `growth-director-v2` -- mismo patron que
 * `src/core/landing-architect-comparison.ts` (validateV2Output /
 * auditV2OutputForFabrication / buildComparisonArtifact /
 * renderComparisonMarkdown), adaptado a la mision de este empleado
 * (sintesis cross-channel priorizada, no propuesta de landing).
 */

// --- Validacion de forma (fail-closed) --------------------------------

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function assertChannelSignal(v: unknown, label: string): asserts v is GrowthChannelSignal {
  if (typeof v !== "object" || v === null) {
    throw new Error(`Salida growth-director-v2 invalida: ${label} debe ser un objeto.`);
  }
  const o = v as Record<string, unknown>;
  if (!GROWTH_CHANNELS.includes(o.channel as GrowthChannel)) {
    throw new Error(`Salida growth-director-v2 invalida: ${label}.channel no es un canal valido (${GROWTH_CHANNELS.join(", ")}).`);
  }
  if (!isString(o.description)) {
    throw new Error(`Salida growth-director-v2 invalida: ${label}.description debe ser string.`);
  }
  if (!isStringArray(o.evidenceRefs)) {
    throw new Error(`Salida growth-director-v2 invalida: ${label}.evidenceRefs debe ser string[].`);
  }
}

function assertExperiment(v: unknown, label: string): asserts v is GrowthExperimentIdea {
  if (typeof v !== "object" || v === null) {
    throw new Error(`Salida growth-director-v2 invalida: ${label} debe ser un objeto.`);
  }
  const o = v as Record<string, unknown>;
  if (!isString(o.title)) throw new Error(`Salida growth-director-v2 invalida: ${label}.title debe ser string.`);
  if (!isString(o.hypothesis)) throw new Error(`Salida growth-director-v2 invalida: ${label}.hypothesis debe ser string.`);
  if (!GROWTH_CHANNELS.includes(o.channel as GrowthChannel)) {
    throw new Error(`Salida growth-director-v2 invalida: ${label}.channel no es un canal valido.`);
  }
  if (!isString(o.successMetric)) throw new Error(`Salida growth-director-v2 invalida: ${label}.successMetric debe ser string.`);
  if (!isStringArray(o.evidenceRefs)) throw new Error(`Salida growth-director-v2 invalida: ${label}.evidenceRefs debe ser string[].`);
}

function assertPriority(v: unknown, label: string): asserts v is GrowthPriority {
  if (typeof v !== "object" || v === null) {
    throw new Error(`Salida growth-director-v2 invalida: ${label} debe ser un objeto.`);
  }
  const o = v as Record<string, unknown>;
  if (!isString(o.title)) throw new Error(`Salida growth-director-v2 invalida: ${label}.title debe ser string.`);
  if (!isString(o.rationale)) throw new Error(`Salida growth-director-v2 invalida: ${label}.rationale debe ser string.`);
  for (const field of ["impact", "confidence", "effort"] as const) {
    if (!GROWTH_LEVELS.includes(o[field] as GrowthLevel)) {
      throw new Error(`Salida growth-director-v2 invalida: ${label}.${field} no es high/medium/low.`);
    }
  }
  if (!isStringArray(o.dependsOn)) throw new Error(`Salida growth-director-v2 invalida: ${label}.dependsOn debe ser string[].`);
  if (!isStringArray(o.evidenceRefs)) throw new Error(`Salida growth-director-v2 invalida: ${label}.evidenceRefs debe ser string[].`);
}

function assertDependency(v: unknown, label: string): asserts v is GrowthDependencyItem {
  if (typeof v !== "object" || v === null) {
    throw new Error(`Salida growth-director-v2 invalida: ${label} debe ser un objeto.`);
  }
  const o = v as Record<string, unknown>;
  if (!isString(o.name)) throw new Error(`Salida growth-director-v2 invalida: ${label}.name debe ser string.`);
  if (!GROWTH_DEPENDENCY_STATUSES.includes(o.status as never)) {
    throw new Error(`Salida growth-director-v2 invalida: ${label}.status no es available/partial/missing.`);
  }
  if (!isString(o.note)) throw new Error(`Salida growth-director-v2 invalida: ${label}.note debe ser string.`);
}

function assertRisk(v: unknown, label: string): asserts v is GrowthRiskItem {
  if (typeof v !== "object" || v === null) {
    throw new Error(`Salida growth-director-v2 invalida: ${label} debe ser un objeto.`);
  }
  const o = v as Record<string, unknown>;
  if (!isString(o.description)) throw new Error(`Salida growth-director-v2 invalida: ${label}.description debe ser string.`);
  if (!GROWTH_LEVELS.includes(o.severity as GrowthLevel)) {
    throw new Error(`Salida growth-director-v2 invalida: ${label}.severity no es high/medium/low.`);
  }
  if (!isStringArray(o.evidenceRefs)) throw new Error(`Salida growth-director-v2 invalida: ${label}.evidenceRefs debe ser string[].`);
}

function assertEvidence(v: unknown, label: string): asserts v is GrowthEvidenceItem {
  if (typeof v !== "object" || v === null) {
    throw new Error(`Salida growth-director-v2 invalida: ${label} debe ser un objeto.`);
  }
  const o = v as Record<string, unknown>;
  if (!isString(o.ref)) throw new Error(`Salida growth-director-v2 invalida: ${label}.ref debe ser string.`);
  if (!isString(o.description)) throw new Error(`Salida growth-director-v2 invalida: ${label}.description debe ser string.`);
}

/**
 * Valida (sin librerias externas -- ninguna dependencia nueva) que un
 * objeto crudo tiene la forma minima de un `GrowthDirectorV2Output`.
 * Fail-closed: cualquier campo obligatorio ausente o del tipo
 * equivocado lanza -- nunca se "rellena" con un valor por defecto que
 * disfrazaria una salida rota del subagente como si fuera valida.
 */
export function validateGrowthDirectorV2Output(raw: unknown): GrowthDirectorV2Output {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salida growth-director-v2 invalida: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  if (!isString(o.growthSummary)) {
    throw new Error("Salida growth-director-v2 invalida: falta growthSummary (string).");
  }

  if (!Array.isArray(o.currentSignals)) throw new Error("Salida growth-director-v2 invalida: currentSignals debe ser un array.");
  o.currentSignals.forEach((item, i) => assertChannelSignal(item, `currentSignals[${i}]`));

  if (!Array.isArray(o.bottlenecks)) throw new Error("Salida growth-director-v2 invalida: bottlenecks debe ser un array.");
  o.bottlenecks.forEach((item, i) => assertChannelSignal(item, `bottlenecks[${i}]`));

  if (!Array.isArray(o.opportunities)) throw new Error("Salida growth-director-v2 invalida: opportunities debe ser un array.");
  o.opportunities.forEach((item, i) => assertChannelSignal(item, `opportunities[${i}]`));

  if (!Array.isArray(o.experiments)) throw new Error("Salida growth-director-v2 invalida: experiments debe ser un array.");
  o.experiments.forEach((item, i) => assertExperiment(item, `experiments[${i}]`));

  if (!Array.isArray(o.recommendedPriorities)) throw new Error("Salida growth-director-v2 invalida: recommendedPriorities debe ser un array.");
  o.recommendedPriorities.forEach((item, i) => assertPriority(item, `recommendedPriorities[${i}]`));

  if (!Array.isArray(o.dependencies)) throw new Error("Salida growth-director-v2 invalida: dependencies debe ser un array.");
  o.dependencies.forEach((item, i) => assertDependency(item, `dependencies[${i}]`));

  if (!Array.isArray(o.risks)) throw new Error("Salida growth-director-v2 invalida: risks debe ser un array.");
  o.risks.forEach((item, i) => assertRisk(item, `risks[${i}]`));

  if (!Array.isArray(o.evidence)) throw new Error("Salida growth-director-v2 invalida: evidence debe ser un array.");
  o.evidence.forEach((item, i) => assertEvidence(item, `evidence[${i}]`));

  if (!isStringArray(o.unknowns)) throw new Error("Salida growth-director-v2 invalida: unknowns debe ser string[].");

  return o as unknown as GrowthDirectorV2Output;
}

// --- Auditoria de dominio ----------------------------------------------

// Mismo patron de normalizacion que action-backlog.ts (sin dependencias
// nuevas): colapsa a un token comparable sin acentos/espacios/guiones
// para poder cruzar "seo-specialist" (nombre tecnico de
// SIBLING_CLAUDE_EMPLOYEES) con lo que un modelo pueda escribir en
// prosa libre ("SEO Specialist", "seo specialist (aun no disponible)"...).
const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(/[^a-z0-9]/g, "");
}

function dependencyNamesMatch(outputName: string, knownName: string): boolean {
  const a = normalizeKey(outputName);
  const b = normalizeKey(knownName);
  if (a.length === 0 || b.length === 0) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * PRIORIDADES QUE ESCRIBEN: una prioridad cuya ejecucion real edita una
 * pagina debe declarar en `dependsOn` que antes pasa por el pipeline de
 * change-pack / aprobacion humana explicita.
 *
 * De donde sale esta regla: `qa-reviewer` bloqueo dos prioridades de la
 * pasada `dept-2026-08-16T201412Z` ("Ejecutar los 6 quick wins SEO en
 * posiciones 17-29" y "Auditar y reescribir meta titles/descriptions
 * ante el patron sistemico de CTR 0%") con esta correccion exigida:
 * anadir explicitamente que su ejecucion sobre paginas requiere pasar
 * por el pipeline de change-pack/aprobacion humana existente. Una
 * tercera prioridad de la MISMA pasada si lo declaraba en su
 * `dependsOn` y no fue bloqueada: la diferencia entre bloquear y no
 * bloquear estaba en una frase, asi que la frase se comprueba aqui.
 *
 * DELIBERADAMENTE CONSERVADORA en las dos direcciones:
 *
 *   - Solo se considera "prioridad que escribe" si aparece un verbo de
 *     escritura Y un objeto web sobre el que escribir. "Investigar la
 *     cobertura de keywords" o "validar el evento click_phone" no
 *     disparan nada: no escriben.
 *   - Basta con que la declaracion aparezca en `dependsOn` o en el
 *     `rationale`: no se exige ninguna formula literal, solo que la
 *     puerta este dicha.
 *
 * Como todo lo de este auditor: devuelve un AVISO para revision humana.
 * No lanza y no bloquea nada por si sola -- quien bloquea es QA.
 */
const WRITE_VERB_KEYS = [
  "ejecutar",
  "aplicar",
  "editar",
  "reescribir",
  "rescribir",
  "escribir",
  "actualizar",
  "modificar",
  "cambiar",
  "corregir",
  "optimizar",
  "publicar",
  "despublicar",
  "redirigir",
  "migrar",
  "implementar",
  "desplegar",
];

const WEB_OBJECT_KEYS = [
  "pagina",
  "paginas",
  "landing",
  "url",
  "urls",
  "slug",
  "metatitle",
  "metatitles",
  "metadescription",
  "metadescriptions",
  "metas",
  "title",
  "titles",
  "titulo",
  "titulos",
  "onpage",
  "contenido",
  "redireccion",
  "redirecciones",
  "enrutado",
  "menu",
  "producto",
  "productos",
  "articulo",
  "articulos",
];

const APPROVAL_GATE_KEYS = [
  "aprobacionhumana",
  "aprobacionexplicita",
  "aprobaciondepau",
  "changepack",
  "changepacks",
  "pipelinedeaprobacion",
  "puertadeaprobacion",
  "decisionhumana",
  "revisionhumana",
];

function mentionsAny(normalizedText: string, keys: string[]): boolean {
  return keys.some((key) => normalizedText.includes(key));
}

/** `true` si la prioridad, leida literalmente, implica escribir sobre una pagina. */
function looksLikeWritePriority(title: string, rationale: string): boolean {
  const normalized = normalizeKey(`${title} ${rationale}`);
  return mentionsAny(normalized, WRITE_VERB_KEYS) && mentionsAny(normalized, WEB_OBJECT_KEYS);
}

/** `true` si la prioridad declara, en `dependsOn` o en el `rationale`, que pasa por aprobacion humana / change pack. */
function declaresApprovalGate(dependsOn: string[], rationale: string): boolean {
  const normalized = normalizeKey([...dependsOn, rationale].join(" "));
  return mentionsAny(normalized, APPROVAL_GATE_KEYS);
}

/**
 * Auditoria de negocio (NO estructural -- eso ya lo hizo
 * `validateGrowthDirectorV2Output`). Dos ejes, ambos derivados
 * directamente de la mision del empleado (ver
 * `.claude/agents/growth-director-v2.md`):
 *
 *   1. "no priority ranking without a stated reason" -- cada entrada de
 *      `recommendedPriorities[]` debe llevar un `rationale` no vacio y
 *      al menos un `evidenceRefs` real (resoluble contra el
 *      evidenceCatalog del contexto o el propio `evidence[]` de la
 *      salida). Se aplica la misma comprobacion de evidenceRefs a
 *      currentSignals/bottlenecks/opportunities/experiments/risks.
 *   1b. "toda prioridad que escribe declara su puerta": una prioridad
 *      cuya ejecucion real edita paginas debe declarar en `dependsOn`
 *      (o, como minimo, en su `rationale`) que antes pasa por el
 *      pipeline de change-pack / aprobacion humana explicita. Es la
 *      correccion que QA exigio en `dept-2026-08-16T201412Z`, donde dos
 *      prioridades quedaron BLOCKED justamente por no decirlo -- ver
 *      `looksLikeWritePriority`/`declaresApprovalGate`.
 *   2. anti-fabricacion de huecos: cualquier dependencia que el CONTEXTO
 *      ya marco como `missing` (ver `context.knownDependencies`) debe
 *      aparecer reconocida (`status !== "available"`) en el
 *      `dependencies[]` de la SALIDA -- si no aparece, es una senal de
 *      que el modelo pudo haber ignorado el hueco (o, peor, inventado
 *      datos para rellenarlo) en vez de declararlo.
 *
 * Nunca lanza y nunca bloquea nada por si sola -- devuelve avisos para
 * revision humana, igual que `auditV2OutputForFabrication()`.
 */
export function auditGrowthDirectorV2Output(context: GrowthDirectorV2Context, output: GrowthDirectorV2Output): string[] {
  const warnings: string[] = [];
  const knownRefs = new Set<string>([...context.evidenceCatalog.map((e) => e.ref), ...output.evidence.map((e) => e.ref)]);

  const checkRefs = (label: string, refs: string[]): void => {
    for (const ref of refs) {
      if (!knownRefs.has(ref)) {
        warnings.push(`${label}: evidenceRef "${ref}" no aparece ni en el evidenceCatalog del contexto ni en evidence[] de la salida -- no se puede verificar de donde sale.`);
      }
    }
  };

  output.currentSignals.forEach((s, i) => checkRefs(`currentSignals[${i}] (${s.channel})`, s.evidenceRefs));
  output.bottlenecks.forEach((s, i) => checkRefs(`bottlenecks[${i}] (${s.channel})`, s.evidenceRefs));
  output.opportunities.forEach((s, i) => checkRefs(`opportunities[${i}] (${s.channel})`, s.evidenceRefs));
  output.experiments.forEach((e, i) => checkRefs(`experiments[${i}] ("${e.title}")`, e.evidenceRefs));
  output.risks.forEach((r, i) => checkRefs(`risks[${i}]`, r.evidenceRefs));

  output.recommendedPriorities.forEach((p, i) => {
    const label = `recommendedPriorities[${i}] ("${p.title}")`;
    if (p.rationale.trim().length === 0) {
      warnings.push(`${label}: rationale vacio -- toda prioridad debe llevar una razon explicita (impacto/confianza/esfuerzo/dependencia).`);
    }
    if (p.evidenceRefs.length === 0) {
      warnings.push(`${label}: evidenceRefs vacio -- toda prioridad debe citar al menos una senal o dependencia real del contexto.`);
    }
    checkRefs(label, p.evidenceRefs);
    if (looksLikeWritePriority(p.title, p.rationale) && !declaresApprovalGate(p.dependsOn, p.rationale)) {
      warnings.push(
        `${label}: su ejecucion real implica editar paginas y NO declara en dependsOn (ni en rationale) que antes tiene que pasar por el pipeline de change-pack / aprobacion humana explicita. QA bloquea las prioridades que no lo dicen -- ver .claude/agents/growth-director-v2.md, "Toda prioridad que EDITA algo declara su puerta de aprobacion".`
      );
    }
  });

  const missingDependencies = context.knownDependencies.filter((d) => d.status === "missing");
  for (const dep of missingDependencies) {
    const acknowledged = output.dependencies.some((d) => d.status !== "available" && dependencyNamesMatch(d.name, dep.name));
    if (!acknowledged) {
      warnings.push(
        `Dependencia ausente conocida "${dep.name}" no aparece declarada como partial/missing en dependencies[] de la salida -- revisar que no se haya rellenado ese hueco con una senal inventada.`
      );
    }
  }

  if (output.growthSummary.trim().length === 0) {
    warnings.push("growthSummary vacio.");
  }

  return warnings;
}

// --- Resultado del runner de dos pasos ----------------------------------

export type GrowthDirectorV2Result =
  | { status: "pending_execution"; promptFilePath: string }
  | { status: "invalid_output"; error: string; rawOutputPath: string }
  | { status: "executed"; output: GrowthDirectorV2Output; auditWarnings: string[] };

/**
 * Contrato machine-readable que imprime `scripts/run-growth-director-v2.ts`
 * al final de cada ejecucion (linea `RUNNER_RESULT_JSON=...`) -- misma
 * estructura FIJA e identica en los 3 estados posibles de `status`, ver
 * `RunnerResultSummary` en `src/core/landing-architect-comparison.ts`
 * para el precedente. `departmentRunId` nunca es `null` aqui (aunque
 * `GrowthDirectorV2Context.departmentRunId` si puede serlo): el runner
 * sustituye `null` por un sentinela de texto fijo antes de construir
 * este resumen, para que sea siempre un string valido como output de
 * GitHub Actions.
 */
export interface GrowthDirectorV2RunnerResultSummary {
  departmentRunId: string;
  status: GrowthDirectorV2Result["status"];
  promptFilePath: string;
  expectedOutputPath: string;
  artifactJsonPath: string;
  artifactMdPath: string;
  /** null salvo que status sea "executed" (unico estado en el que existen auditWarnings que contar). */
  auditWarningCount: number | null;
}

export function buildRunnerResultSummary(
  departmentRunId: string,
  paths: { promptFilePath: string; expectedOutputPath: string; artifactJsonPath: string; artifactMdPath: string },
  result: GrowthDirectorV2Result
): GrowthDirectorV2RunnerResultSummary {
  return {
    departmentRunId,
    status: result.status,
    promptFilePath: paths.promptFilePath,
    expectedOutputPath: paths.expectedOutputPath,
    artifactJsonPath: paths.artifactJsonPath,
    artifactMdPath: paths.artifactMdPath,
    auditWarningCount: result.status === "executed" ? result.auditWarnings.length : null,
  };
}

// --- Artefacto / markdown ------------------------------------------------

export interface GrowthDirectorV2Artifact {
  generatedAt: string;
  departmentRunId: string | null;
  input: GrowthDirectorV2Context;
  result: GrowthDirectorV2Result;
  note: string;
}

export function buildGrowthDirectorV2Artifact(context: GrowthDirectorV2Context, result: GrowthDirectorV2Result): GrowthDirectorV2Artifact {
  return {
    generatedAt: new Date().toISOString(),
    departmentRunId: context.departmentRunId,
    input: context,
    result,
    note:
      "Artefacto de solo lectura/propuesta. growth-director-v2 no ejecuta ni aplica nada -- ni a WordPress, ni a staging, ni a produccion, ni a Google Ads/GA4/GTM/Search Console/n8n, ni escribe en el propio repositorio. Prioriza y sintetiza sobre datos ya persistidos; la decision final sobre que hacer es siempre humana. No sustituye a src/agents/growth-director.ts (v1), que sigue siendo el unico que genera reports/daily/*.md.",
  };
}

export function renderGrowthDirectorV2Markdown(artifact: GrowthDirectorV2Artifact): string {
  const lines: string[] = [];
  lines.push(`# growth-director-v2 -- sintesis cross-channel`);
  lines.push("");
  lines.push(`- **Generado:** ${artifact.generatedAt}`);
  lines.push(`- **departmentRunId:** \`${artifact.departmentRunId ?? "(ninguno disponible)"}\``);
  lines.push("");
  lines.push(`_${artifact.note}_`);
  lines.push("");

  if (artifact.result.status === "pending_execution") {
    lines.push("## Estado: pendiente de ejecucion");
    lines.push("");
    lines.push(`Prompt preparado en \`${artifact.result.promptFilePath}\`.`);
    lines.push("Para completar: invocar el subagente `growth-director-v2` con ese prompt y volver a ejecutar este runner con `--growth-director-v2-output <fichero-json-de-respuesta>`.");
    lines.push("");
    return lines.join("\n");
  }

  if (artifact.result.status === "invalid_output") {
    lines.push("## Estado: salida invalida");
    lines.push("");
    lines.push(artifact.result.error);
    lines.push("");
    lines.push(`Salida cruda guardada en \`${artifact.result.rawOutputPath}\` para inspeccion.`);
    lines.push("");
    return lines.join("\n");
  }

  const output = artifact.result.output;
  const warnings = artifact.result.auditWarnings;

  lines.push("## growthSummary");
  lines.push("");
  lines.push(output.growthSummary);
  lines.push("");

  const renderChannelList = (title: string, items: GrowthChannelSignal[]): void => {
    lines.push(`## ${title} (${items.length})`);
    lines.push("");
    if (items.length === 0) {
      lines.push("Ninguna.");
    } else {
      for (const item of items) {
        lines.push(`- **[${item.channel}]** ${item.description} _(evidencia: ${item.evidenceRefs.join(", ") || "ninguna"})_`);
      }
    }
    lines.push("");
  };
  renderChannelList("Senales actuales", output.currentSignals);
  renderChannelList("Cuellos de botella", output.bottlenecks);
  renderChannelList("Oportunidades", output.opportunities);

  lines.push(`## Experimentos propuestos (${output.experiments.length})`);
  lines.push("");
  if (output.experiments.length === 0) {
    lines.push("Ninguno.");
  } else {
    for (const e of output.experiments) {
      lines.push(`- **${e.title}** [${e.channel}] -- hipotesis: ${e.hypothesis} -- metrica de exito: ${e.successMetric}`);
    }
  }
  lines.push("");

  lines.push(`## Prioridades recomendadas (${output.recommendedPriorities.length})`);
  lines.push("");
  lines.push("| # | Titulo | Impacto | Confianza | Esfuerzo | Rationale | Depende de |");
  lines.push("|---|---|---|---|---|---|---|");
  output.recommendedPriorities.forEach((p, i) => {
    lines.push(`| ${i + 1} | ${p.title} | ${p.impact} | ${p.confidence} | ${p.effort} | ${p.rationale} | ${p.dependsOn.join(", ") || "-"} |`);
  });
  lines.push("");

  lines.push(`## Dependencias (${output.dependencies.length})`);
  lines.push("");
  if (output.dependencies.length === 0) {
    lines.push("Ninguna declarada.");
  } else {
    for (const d of output.dependencies) {
      lines.push(`- **${d.name}**: ${d.status} -- ${d.note}`);
    }
  }
  lines.push("");

  lines.push(`## Riesgos (${output.risks.length})`);
  lines.push("");
  if (output.risks.length === 0) {
    lines.push("Ninguno declarado.");
  } else {
    for (const r of output.risks) {
      lines.push(`- [${r.severity}] ${r.description} _(evidencia: ${r.evidenceRefs.join(", ") || "ninguna"})_`);
    }
  }
  lines.push("");

  lines.push(`## Unknowns (${output.unknowns.length})`);
  lines.push("");
  if (output.unknowns.length === 0) {
    lines.push("Ninguno declarado.");
  } else {
    for (const u of output.unknowns) lines.push(`- ${u}`);
  }
  lines.push("");

  lines.push(`## Auditoria de dominio: ${warnings.length} aviso(s)`);
  lines.push("");
  if (warnings.length === 0) {
    lines.push("Sin avisos (todas las prioridades tienen rationale + evidenceRefs no vacios, todos los evidenceRefs son resolubles, y todas las dependencias ausentes conocidas del contexto estan reconocidas en dependencies[]).");
  } else {
    for (const w of warnings) lines.push(`- ${w}`);
  }
  lines.push("");

  return lines.join("\n");
}
