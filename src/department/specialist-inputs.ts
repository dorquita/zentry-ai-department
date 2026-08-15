import { EvidenceCatalogItem } from "../employees/growth-director-v2/context";
import { SeoSpecialistOutput, validateSeoSpecialistOutput } from "../employees/seo-specialist/domain";
import { ContentStrategistOutput, validateContentStrategistOutput } from "../employees/content-strategist/output";
import { AnalyticsSpecialistOutput } from "../employees/analytics-specialist/types";
import { validateAnalyticsSpecialistOutput } from "../employees/analytics-specialist/validator";
import { DepartmentRunManifest, DepartmentStageName, DepartmentStageStatus } from "./types";
import { findStageRecord, readStageOutput } from "./run-store";

/**
 * FASE 1 -> FASE 2: convierte las salidas REALES de los especialistas de
 * ESTA misma pasada coordinada en (a) un bloque de entrada explicito
 * para growth-director-v2 y (b) entradas de `evidenceCatalog` a las que
 * Growth puede (y debe) apuntar sus `evidenceRefs`.
 *
 * Dos reglas irrenunciables, ambas verificadas por tests:
 *
 * 1. **Nunca se inventa la salida de un especialista ausente.** Si una
 *    etapa no quedo en `executed`, aqui se produce una entrada
 *    explicita con su estado real (`not_available`, `invalid_output`,
 *    `failed`, `blocked`) y una `note` que dice literalmente que NO hay
 *    datos de ese especialista -- nunca un objeto vacio que Growth
 *    pudiera confundir con "sin hallazgos".
 * 2. **Fail-closed sobre la forma.** Una salida marcada `executed` cuyo
 *    contenido no pase el validador del PROPIO empleado se degrada a
 *    `invalid_output` aqui mismo, en vez de embeberse a medias en el
 *    prompt de Growth.
 */

export type SpecialistStageName = Extract<DepartmentStageName, "seo-specialist" | "content-strategist" | "analytics-specialist" | "sem-specialist">;

export interface DepartmentSpecialistInput {
  employee: SpecialistStageName;
  status: DepartmentStageStatus;
  /** Explicacion literal del estado -- se embebe en el prompt de Growth tal cual. */
  note: string;
  sourceRunId: string | null;
  /** Presente UNICAMENTE si status === "executed": la salida real y ya validada del especialista en esta pasada. */
  output?: unknown;
}

export interface LoadedSpecialistInputs {
  inputs: DepartmentSpecialistInput[];
  seo?: SeoSpecialistOutput;
  content?: ContentStrategistOutput;
  analytics?: AnalyticsSpecialistOutput;
  /** Entradas de evidencia derivadas SOLO de salidas reales (mas una entrada explicita por cada especialista ausente). */
  evidenceCatalog: EvidenceCatalogItem[];
  executedCount: number;
}

/** Prefijo de ref por especialista -- usado tambien para reconstruir la trazabilidad inversa en el daily brief (ver `attributeEvidenceRefToEmployees`). */
export const DEPARTMENT_EVIDENCE_PREFIX: Record<SpecialistStageName, string> = {
  "seo-specialist": "dept-seo",
  "content-strategist": "dept-content",
  "analytics-specialist": "dept-analytics",
  "sem-specialist": "dept-sem",
};

const MAX_EVIDENCE_ITEMS_PER_LIST = 8;

function truncate(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}

const SEM_PENDING_NOTE =
  "sem-specialist queda EXPLICITAMENTE FUERA de esta fase (pendiente / temporalmente no disponible). No hay ninguna senal de SEM/Google Ads en esta pasada: no asumas gasto, CPC, impresiones, campanas activas ni ningun otro dato de Ads, y no trates su ausencia como si SEM estuviera sano o vacio. Su ausencia NUNCA bloquea esta pasada.";

function buildUnavailableNote(employee: SpecialistStageName, status: DepartmentStageStatus, reason: string): string {
  if (employee === "sem-specialist") return SEM_PENDING_NOTE;
  const statusText: Record<DepartmentStageStatus, string> = {
    executed: "ejecutado",
    blocked: "bloqueado por una etapa anterior",
    invalid_output: "produjo una salida que NO cumple su contrato (descartada, fail-closed)",
    not_available: "sin insumos reales disponibles en esta pasada",
    failed: "fallo tecnico durante su ejecucion",
  };
  return `${employee}: ${statusText[status]}. Motivo registrado: ${reason} -- NO hay ningun dato de este especialista en esta pasada. No completes ese hueco con conocimiento general ni con supuestos: dilo explicitamente en dependencies[]/unknowns[] de tu salida.`;
}

function buildSeoEvidence(output: SeoSpecialistOutput): EvidenceCatalogItem[] {
  const items: EvidenceCatalogItem[] = [
    {
      ref: "dept-seo-summary",
      description: `seo-specialist (salida real de esta pasada): ${truncate(output.executiveSummary)} [findings=${output.findings.length}, opportunities=${output.opportunities.length}, technicalIssues=${output.technicalIssues.length}, contentGaps=${output.contentGaps.length}, prioritizedActions=${output.prioritizedActions.length}]`,
    },
  ];
  output.prioritizedActions.slice(0, MAX_EVIDENCE_ITEMS_PER_LIST).forEach((action, i) => {
    items.push({
      ref: `dept-seo-action-${i + 1}`,
      description: `seo-specialist, accion priorizada #${action.rank}: "${truncate(action.title, 160)}" (priority=${action.priority}, impact=${action.impact}, effort=${action.effort}, relatedIds=${action.relatedIds.join("/") || "ninguno"}).`,
    });
  });
  output.opportunities.slice(0, MAX_EVIDENCE_ITEMS_PER_LIST).forEach((opportunity, i) => {
    items.push({
      ref: `dept-seo-opportunity-${i + 1}`,
      description: `seo-specialist, oportunidad (${opportunity.kind}, priority=${opportunity.priority}, basis=${opportunity.basis}) sobre keyword "${opportunity.keyword}"${opportunity.page ? ` / pagina "${opportunity.page}"` : ""}: ${truncate(opportunity.recommendedAction, 180)}`,
    });
  });
  return items;
}

function buildContentEvidence(output: ContentStrategistOutput): EvidenceCatalogItem[] {
  return [
    {
      ref: "dept-content-summary",
      description: `content-strategist (salida real de esta pasada): oportunidad "${truncate(output.contentOpportunity.title, 140)}" -- ${truncate(output.contentOpportunity.summary)} (priority=${output.priority}, contentType=${output.contentType}, targetBrand=${output.targetBrand}, searchIntent=${output.searchIntent}).`,
    },
    {
      ref: "dept-content-structure",
      description: `content-strategist, estructura propuesta: H1 "${truncate(output.recommendedStructure.h1, 140)}" con ${output.recommendedStructure.sections.length} seccion(es); audiencia "${truncate(output.targetAudience, 120)}"; angulo "${truncate(output.angle, 140)}".`,
    },
    {
      ref: "dept-content-cta",
      description: `content-strategist, estrategia de CTA: primario "${truncate(output.ctaStrategy.primaryCta, 120)}"${output.ctaStrategy.secondaryCta ? `, secundario "${truncate(output.ctaStrategy.secondaryCta, 120)}"` : ""}. Motivo: ${truncate(output.ctaStrategy.rationale, 180)}`,
    },
    {
      ref: "dept-content-risks",
      description:
        output.risksAndUnknowns.length > 0
          ? `content-strategist, riesgos/incognitas declarados (${output.risksAndUnknowns.length}): ${truncate(output.risksAndUnknowns.join(" | "), 300)}`
          : "content-strategist no declaro ningun riesgo ni incognita en esta pasada.",
    },
  ];
}

function buildAnalyticsEvidence(output: AnalyticsSpecialistOutput): EvidenceCatalogItem[] {
  const items: EvidenceCatalogItem[] = [
    {
      ref: "dept-analytics-summary",
      description: `analytics-specialist (salida real de esta pasada, snapshot del departmentRunId de datos "${output.runSummary.departmentRunId}", ga4Connected=${String(output.runSummary.ga4Connected)}, gtmConnected=${String(output.runSummary.gtmConnected)}): measurementFindings=${output.measurementFindings.length}, trafficObservations=${output.trafficObservations.length}, conversionObservations=${output.conversionObservations.length}, trackingIssues=${output.trackingIssues.length}, prioritizedActions=${output.prioritizedActions.length}.`,
    },
  ];
  output.prioritizedActions.slice(0, MAX_EVIDENCE_ITEMS_PER_LIST).forEach((action, i) => {
    items.push({
      ref: `dept-analytics-action-${i + 1}`,
      description: `analytics-specialist, accion priorizada (${action.priority}, claimType=${action.claimType}): ${truncate(action.statement, 200)}`,
    });
  });
  output.trackingIssues.slice(0, MAX_EVIDENCE_ITEMS_PER_LIST).forEach((issue, i) => {
    items.push({
      ref: `dept-analytics-tracking-issue-${i + 1}`,
      description: `analytics-specialist, problema de medicion (claimType=${issue.claimType}): ${truncate(issue.statement, 200)}`,
    });
  });
  return items;
}

interface SpecialistLoadPlan {
  employee: SpecialistStageName;
  validate: (raw: unknown) => unknown;
  buildEvidence: (output: never) => EvidenceCatalogItem[];
}

const LOAD_PLAN: SpecialistLoadPlan[] = [
  { employee: "seo-specialist", validate: validateSeoSpecialistOutput, buildEvidence: buildSeoEvidence as (o: never) => EvidenceCatalogItem[] },
  { employee: "content-strategist", validate: validateContentStrategistOutput, buildEvidence: buildContentEvidence as (o: never) => EvidenceCatalogItem[] },
  { employee: "analytics-specialist", validate: validateAnalyticsSpecialistOutput, buildEvidence: buildAnalyticsEvidence as (o: never) => EvidenceCatalogItem[] },
];

/**
 * Lector de la salida de una etapa. Inyectable UNICAMENTE para que los
 * tests puedan ejercitar la degradacion (ausente / rota / valida) sin
 * montar un arbol de ficheros real -- en produccion siempre se usa el
 * lector de rutas deterministas de `run-store.ts`.
 */
export type StageOutputReader = (manifest: DepartmentRunManifest, stage: DepartmentStageName) => unknown | undefined;

/**
 * Lee, valida y resume las salidas de los especialistas registradas en
 * el manifiesto de ESTA pasada. Nunca lanza por un especialista ausente
 * o roto: lo degrada de forma explicita (ver cabecera).
 */
export function loadSpecialistInputs(manifest: DepartmentRunManifest, readOutput: StageOutputReader = readStageOutput): LoadedSpecialistInputs {
  const inputs: DepartmentSpecialistInput[] = [];
  const evidenceCatalog: EvidenceCatalogItem[] = [];
  const loaded: { seo?: SeoSpecialistOutput; content?: ContentStrategistOutput; analytics?: AnalyticsSpecialistOutput } = {};
  let executedCount = 0;

  for (const plan of LOAD_PLAN) {
    const record = findStageRecord(manifest, plan.employee);
    const status: DepartmentStageStatus = record?.status ?? "not_available";
    const reason = record?.reason ?? "La etapa no llego a registrarse en el manifiesto de esta pasada.";
    const sourceRunId = record?.sourceRunId ?? null;

    if (status !== "executed") {
      inputs.push({ employee: plan.employee, status, note: buildUnavailableNote(plan.employee, status, reason), sourceRunId });
      evidenceCatalog.push({
        ref: `${DEPARTMENT_EVIDENCE_PREFIX[plan.employee]}-unavailable`,
        description: `${plan.employee}: SIN datos en esta pasada (status=${status}). ${reason}`,
      });
      continue;
    }

    const raw = readOutput(manifest, plan.employee);
    if (raw === undefined) {
      const note = buildUnavailableNote(plan.employee, "invalid_output", "Marcado como executed en el manifiesto pero su fichero de salida no existe o no es legible.");
      inputs.push({ employee: plan.employee, status: "invalid_output", note, sourceRunId });
      evidenceCatalog.push({ ref: `${DEPARTMENT_EVIDENCE_PREFIX[plan.employee]}-unavailable`, description: `${plan.employee}: SIN datos utilizables en esta pasada (fichero de salida ausente pese a status=executed).` });
      continue;
    }

    try {
      const output = plan.validate(raw);
      inputs.push({ employee: plan.employee, status: "executed", note: `${plan.employee}: salida REAL de esta misma pasada coordinada, ya validada contra su propio contrato. Usala tal cual -- no la recalcules ni la contradigas.`, sourceRunId, output });
      evidenceCatalog.push(...plan.buildEvidence(output as never));
      executedCount += 1;
      if (plan.employee === "seo-specialist") loaded.seo = output as SeoSpecialistOutput;
      if (plan.employee === "content-strategist") loaded.content = output as ContentStrategistOutput;
      if (plan.employee === "analytics-specialist") loaded.analytics = output as AnalyticsSpecialistOutput;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      inputs.push({
        employee: plan.employee,
        status: "invalid_output",
        note: buildUnavailableNote(plan.employee, "invalid_output", `Su salida no pasa el validador de su propio dominio: ${detail}`),
        sourceRunId,
      });
      evidenceCatalog.push({
        ref: `${DEPARTMENT_EVIDENCE_PREFIX[plan.employee]}-unavailable`,
        description: `${plan.employee}: salida descartada por no cumplir su contrato (${truncate(detail, 200)}). SIN datos utilizables de este especialista en esta pasada.`,
      });
    }
  }

  // SEM: SIEMPRE presente y SIEMPRE explicito, nunca bloqueante.
  const semRecord = findStageRecord(manifest, "sem-specialist");
  inputs.push({
    employee: "sem-specialist",
    status: semRecord?.status ?? "not_available",
    note: SEM_PENDING_NOTE,
    sourceRunId: null,
  });
  evidenceCatalog.push({ ref: "dept-sem-unavailable", description: `sem-specialist: not_available / pendiente. ${semRecord?.reason ?? "Fuera del alcance de esta fase por decision explicita."}` });

  return { inputs, ...loaded, evidenceCatalog, executedCount };
}

/**
 * Trazabilidad inversa para el daily brief: de que empleado(s) procede
 * una `evidenceRef` concreta citada por Growth. Deterministico y basado
 * SOLO en los prefijos que genera este mismo modulo -- una ref que no
 * empiece por ninguno de ellos se atribuye al contexto determinista del
 * departamento (registros ya persistidos), nunca a un especialista.
 */
export function attributeEvidenceRefToEmployees(ref: string): string[] {
  const owners: string[] = [];
  for (const [employee, prefix] of Object.entries(DEPARTMENT_EVIDENCE_PREFIX) as [SpecialistStageName, string][]) {
    if (ref === prefix || ref.startsWith(`${prefix}-`)) owners.push(employee);
  }
  if (owners.length === 0) owners.push("growth-director-v2 (contexto determinista del departamento)");
  return owners;
}
