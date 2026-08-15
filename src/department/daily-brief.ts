import { GrowthDirectorV2Output, GrowthEvidenceItem } from "../employees/growth-director-v2/types";
import { QaReviewerOutput } from "../employees/qa-reviewer/output";
import { WebEngineerOutput } from "../employees/web-engineer/types";
import { SeoSpecialistOutput } from "../employees/seo-specialist/domain";
import { ContentStrategistOutput } from "../employees/content-strategist/output";
import { AnalyticsSpecialistOutput } from "../employees/analytics-specialist/types";
import { DepartmentPromotionResult } from "./promotion";
import { attributeEvidenceRefToEmployees, LoadedSpecialistInputs } from "./specialist-inputs";
import { DEPARTMENT_RUN_CONTRACT_VERSION, DepartmentQaStatus, DepartmentRunManifest, DepartmentStageRecord, DepartmentStageStatus } from "./types";

/**
 * FASE 5 -- el DAILY BRIEF.
 *
 * Ensamblado DETERMINISTA (sin ninguna llamada extra a un modelo, sin
 * ninguna cifra derivada de la nada): toma lo que cada empleado
 * REALMENTE produjo en esta pasada y lo reorganiza en un informe de
 * director. No es una concatenacion de 6 JSON: reordena por prioridad,
 * resuelve la trazabilidad de cada prioridad hasta el empleado y la
 * evidencia de origen, cruza el veredicto de QA con cada recomendacion,
 * y separa explicitamente lo que falta (BLOCKED / UNKNOWN) de lo que
 * requiere una decision humana (APPROVALS NEEDED).
 *
 * Regla dura: aqui NO se inventa ninguna metrica. Todo numero de este
 * informe es un CONTEO de elementos realmente presentes en las salidas
 * de esta pasada, nunca una estimacion de negocio.
 */

export interface DailyBriefSection {
  employee: string;
  status: DepartmentStageStatus;
  headline: string;
  bullets: string[];
}

export interface DailyBriefEvidence {
  ref: string;
  description: string;
  originEmployees: string[];
}

export interface DailyBriefPriority {
  rank: number;
  action: string;
  reason: string;
  impact: string;
  confidence: string;
  effort: string;
  evidence: DailyBriefEvidence[];
  originEmployees: string[];
  qaStatus: "PASS" | "PASS_WITH_WARNINGS" | "BLOCKED";
  qaNotes: string[];
  approvalRequired: boolean;
  dependsOn: string[];
  hasEngineeringSpec: boolean;
}

export interface DailyBriefApproval {
  decision: string;
  why: string;
  qaStatus: string;
  origin: string;
}

export interface DepartmentDailyBrief {
  contractVersion: string;
  departmentRunId: string;
  generatedAt: string;
  executiveSummary: {
    discovered: string[];
    needsAttention: string[];
    changed: string[];
  };
  topPriorities: DailyBriefPriority[];
  sections: {
    seo: DailyBriefSection;
    content: DailyBriefSection;
    analytics: DailyBriefSection;
    growth: DailyBriefSection;
    qa: DailyBriefSection;
    webEngineering: DailyBriefSection;
  };
  blockedOrUnknown: string[];
  approvalsNeeded: DailyBriefApproval[];
  stageStatuses: DepartmentStageRecord[];
  departmentQaStatus: DepartmentQaStatus;
  externalWrites: "none";
  note: string;
}

export interface PreviousRunSnapshot {
  departmentRunId: string;
  priorityCount: number;
  departmentQaStatus: DepartmentQaStatus;
  executedStages: number;
}

export interface DailyBriefInput {
  manifest: DepartmentRunManifest;
  specialists: LoadedSpecialistInputs;
  growth: { status: DepartmentStageStatus; reason: string; output?: GrowthDirectorV2Output; auditWarnings: string[] };
  qa: { status: DepartmentStageStatus; reason: string; output?: QaReviewerOutput };
  webEngineer: { status: DepartmentStageStatus; reason: string; output?: WebEngineerOutput; auditWarnings: string[] };
  promotion: DepartmentPromotionResult;
  /** Pasada coordinada anterior encontrada en este checkout, si la hay. `null`/ausente = no hay con que comparar (se dice explicitamente, no se omite). */
  previousRun?: PreviousRunSnapshot | null;
  now?: Date;
}

const BRIEF_NOTE =
  "Informe de solo lectura. Esta pasada del departamento es READ / ANALYZE / PROPOSE: no se ha escrito en WordPress, staging, produccion, Google Ads, GA4/GTM, Search Console, n8n ni email, no se ha enviado ningun correo, no se ha modificado ninguna campana, y nada se ha commiteado. Todas las cifras de este informe son conteos de elementos realmente producidos en esta pasada -- ninguna es una estimacion de negocio.";

function truncate(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}

function findRecord(manifest: DepartmentRunManifest, stage: DepartmentStageRecord["stage"]): DepartmentStageRecord | undefined {
  return manifest.stages.find((s) => s.stage === stage);
}

function unavailableSection(employee: string, record: DepartmentStageRecord | undefined): DailyBriefSection {
  const status = record?.status ?? "not_available";
  return {
    employee,
    status,
    headline: `Sin aportacion utilizable en esta pasada (status=${status}).`,
    bullets: [record?.reason ?? "La etapa no llego a registrarse en el manifiesto de esta pasada.", "No se ha sustituido su ausencia por ninguna estimacion ni por datos de otra pasada."],
  };
}

function buildSeoSection(manifest: DepartmentRunManifest, output?: SeoSpecialistOutput): DailyBriefSection {
  const record = findRecord(manifest, "seo-specialist");
  if (!output) return unavailableSection("seo-specialist", record);
  const bullets: string[] = [
    `${output.findings.length} hallazgo(s), ${output.opportunities.length} oportunidad(es), ${output.technicalIssues.length} problema(s) tecnico(s), ${output.contentGaps.length} gap(s) de contenido, ${output.internalLinkRecommendations.length} recomendacion(es) de enlazado interno.`,
  ];
  output.prioritizedActions.slice(0, 3).forEach((a) => bullets.push(`Accion #${a.rank} (${a.priority}, impacto ${a.impact}, esfuerzo ${a.effort}): ${truncate(a.title, 160)}`));
  if (output.unknowns.length > 0) bullets.push(`Incognitas declaradas por el propio especialista: ${output.unknowns.length}.`);
  return { employee: "seo-specialist", status: record?.status ?? "executed", headline: truncate(output.executiveSummary), bullets };
}

function buildContentSection(manifest: DepartmentRunManifest, output?: ContentStrategistOutput): DailyBriefSection {
  const record = findRecord(manifest, "content-strategist");
  if (!output) return unavailableSection("content-strategist", record);
  const bullets: string[] = [
    `Oportunidad "${truncate(output.contentOpportunity.title, 140)}" (prioridad ${output.priority}, tipo ${output.contentType}, marca ${output.targetBrand}, intencion ${output.searchIntent}).`,
    `Estructura propuesta: H1 "${truncate(output.recommendedStructure.h1, 120)}" con ${output.recommendedStructure.sections.length} seccion(es); ${output.internalLinks.length} enlace(s) interno(s) sugerido(s).`,
    `CTA principal: ${truncate(output.ctaStrategy.primaryCta, 120)}`,
  ];
  if (output.risksAndUnknowns.length > 0) bullets.push(`Riesgos/incognitas declarados: ${output.risksAndUnknowns.length}.`);
  return { employee: "content-strategist", status: record?.status ?? "executed", headline: truncate(output.contentOpportunity.summary), bullets };
}

function buildAnalyticsSection(manifest: DepartmentRunManifest, output?: AnalyticsSpecialistOutput): DailyBriefSection {
  const record = findRecord(manifest, "analytics-specialist");
  if (!output) return unavailableSection("analytics-specialist", record);
  const bullets: string[] = [
    `Snapshot analizado: pasada de datos "${output.runSummary.departmentRunId}" (GA4 conectado: ${String(output.runSummary.ga4Connected)}, GTM conectado: ${String(output.runSummary.gtmConnected)}).`,
    `${output.trafficObservations.length} observacion(es) de trafico, ${output.conversionObservations.length} de conversion, ${output.trackingIssues.length} problema(s) de medicion, ${output.hypotheses.length} hipotesis.`,
  ];
  output.prioritizedActions.slice(0, 3).forEach((a) => bullets.push(`Accion (${a.priority}): ${truncate(a.statement, 160)}`));
  if (output.unknowns.length > 0) bullets.push(`Incognitas declaradas por el propio especialista: ${output.unknowns.length}.`);
  return { employee: "analytics-specialist", status: record?.status ?? "executed", headline: `${output.measurementFindings.length} hallazgo(s) de medicion sobre datos reales ya leidos por analytics-watcher.`, bullets };
}

function buildGrowthSection(input: DailyBriefInput): DailyBriefSection {
  const record = findRecord(input.manifest, "growth-director-v2");
  if (input.growth.status !== "executed" || !input.growth.output) {
    return {
      employee: "growth-director-v2",
      status: input.growth.status,
      headline: `Sin sintesis cross-channel en esta pasada (status=${input.growth.status}).`,
      bullets: [input.growth.reason, "Sin sintesis de Growth no se promueve ninguna recomendacion a ingenieria (fail-closed)."],
    };
  }
  const output = input.growth.output;
  const bullets: string[] = [
    `${output.recommendedPriorities.length} prioridad(es) propuesta(s), ${output.opportunities.length} oportunidad(es), ${output.bottlenecks.length} cuello(s) de botella, ${output.risks.length} riesgo(s), ${output.experiments.length} experimento(s).`,
    `Dependencias declaradas ausentes/parciales: ${output.dependencies.filter((d) => d.status !== "available").length} de ${output.dependencies.length}.`,
  ];
  if (input.growth.auditWarnings.length > 0) bullets.push(`Avisos de la auditoria de dominio de Growth (no descartados): ${input.growth.auditWarnings.length}.`);
  if (output.unknowns.length > 0) bullets.push(`Incognitas declaradas por Growth: ${output.unknowns.length}.`);
  return { employee: "growth-director-v2", status: record?.status ?? "executed", headline: truncate(output.growthSummary, 320), bullets };
}

function buildQaSection(input: DailyBriefInput): DailyBriefSection {
  const record = findRecord(input.manifest, "qa-reviewer");
  if (input.qa.status !== "executed" || !input.qa.output) {
    return {
      employee: "qa-reviewer",
      status: input.qa.status,
      headline: `Sin revision de QA en esta pasada (status=${input.qa.status}) -- estado de departamento: ${input.promotion.departmentQaStatus}.`,
      bullets: [input.qa.reason, "Fail-closed: sin QA valida no se promueve ninguna recomendacion a ingenieria."],
    };
  }
  const output = input.qa.output;
  const bullets: string[] = [
    `reviewStatus del empleado: \`${output.reviewStatus}\` -> estado de departamento: \`${input.promotion.departmentQaStatus}\`.`,
    `Hallazgos: ${output.findings.filter((f) => f.severity === "critical").length} critical, ${output.findings.filter((f) => f.severity === "warning").length} warning, ${output.findings.filter((f) => f.severity === "info").length} info.`,
    `${output.unsupportedClaims.length} afirmacion(es) sin respaldo, ${output.contradictions.length} contradiccion(es), ${output.safetyConcerns.length} problema(s) de seguridad, ${output.requiredCorrections.length} correccion(es) exigida(s).`,
    `Recomendacion de aprobacion: ${output.approvalRecommendation.recommendedStatus} (riesgo ${output.approvalRecommendation.riskLevel}).`,
  ];
  if (input.promotion.unattributedBlockingSignals.length > 0) {
    bullets.push(`${input.promotion.unattributedBlockingSignals.length} senal(es) bloqueante(s) de QA que no citan el titulo exacto de ninguna prioridad -- se reportan igualmente, ver seccion BLOCKED / UNKNOWN.`);
  }
  return { employee: "qa-reviewer", status: record?.status ?? "executed", headline: truncate(output.summary, 320), bullets };
}

function buildWebEngineeringSection(input: DailyBriefInput): DailyBriefSection {
  const record = findRecord(input.manifest, "web-engineer");
  if (input.webEngineer.status !== "executed" || !input.webEngineer.output) {
    return {
      employee: "web-engineer",
      status: input.webEngineer.status,
      headline: `Sin especificacion tecnica en esta pasada (status=${input.webEngineer.status}).`,
      bullets: [input.webEngineer.reason],
    };
  }
  const output = input.webEngineer.output;
  const bullets: string[] = [
    `${output.proposedChanges.length} cambio(s) propuesto(s) sobre ${output.targetPages.length} pagina(s) y ${output.targetComponents.length} componente(s).`,
    `${output.acceptanceCriteria.length} criterio(s) de aceptacion, ${output.validationPlan.length} paso(s) de validacion, ${output.rollbackPlan.length} paso(s) de rollback.`,
    `Dependencias: ${output.dependencies.length}. Riesgos: ${output.risks.length}. Incognitas: ${output.unknowns.length}.`,
    `approvalRequired: ${String(output.approvalRequired)} -- nada de esto se ha implementado ni se implementara sin aprobacion humana explicita.`,
  ];
  if (input.webEngineer.auditWarnings.length > 0) bullets.push(`Avisos de auditoria de capacidades no confirmadas: ${input.webEngineer.auditWarnings.length}.`);
  return { employee: "web-engineer", status: record?.status ?? "executed", headline: truncate(output.implementationSummary, 320), bullets };
}

function buildTopPriorities(input: DailyBriefInput): DailyBriefPriority[] {
  const evidenceCatalog: GrowthEvidenceItem[] = [...input.specialists.evidenceCatalog, ...(input.growth.output?.evidence ?? [])];
  const byRef = new Map(evidenceCatalog.map((e) => [e.ref, e]));
  const hasSpec = input.webEngineer.status === "executed" && !!input.webEngineer.output;

  const all = [...input.promotion.promoted, ...input.promotion.blocked].sort((a, b) => a.rank - b.rank);
  return all.map((rec) => {
    const evidence: DailyBriefEvidence[] = rec.evidenceRefs.map((ref) => {
      const item = byRef.get(ref);
      return {
        ref,
        description: item ? item.description : "(referencia citada por growth-director-v2 que no aparece en el catalogo de evidencia de esta pasada -- NO verificada)",
        originEmployees: attributeEvidenceRefToEmployees(ref),
      };
    });
    const originEmployees = [...new Set(evidence.flatMap((e) => e.originEmployees))];
    const qaStatus: DailyBriefPriority["qaStatus"] =
      rec.decision === "blocked" ? "BLOCKED" : rec.decision === "promoted_with_warnings" ? "PASS_WITH_WARNINGS" : input.promotion.departmentQaStatus === "PASS_WITH_WARNINGS" ? "PASS_WITH_WARNINGS" : "PASS";
    return {
      rank: rec.rank,
      action: rec.title,
      reason: rec.rationale,
      impact: rec.impact,
      confidence: rec.confidence,
      effort: rec.effort,
      evidence,
      originEmployees: originEmployees.length > 0 ? originEmployees : ["growth-director-v2 (sin evidenceRefs citadas)"],
      qaStatus,
      qaNotes: rec.decision === "blocked" ? rec.blockedBy : rec.qaWarnings,
      // Fase READ/ANALYZE/PROPOSE: TODA accion de este informe requiere
      // decision humana antes de tocar nada. Nunca es `false`.
      approvalRequired: true,
      dependsOn: rec.dependsOn,
      hasEngineeringSpec: hasSpec && rec.decision !== "blocked",
    };
  });
}

function buildBlockedOrUnknown(input: DailyBriefInput): string[] {
  const items: string[] = [];
  items.push("SEM: pendiente / temporalmente no disponible -- sem-specialist queda explicitamente fuera de esta fase y no ha aportado ninguna senal de Google Ads. Su ausencia no bloquea el departamento.");

  for (const specialist of input.specialists.inputs) {
    if (specialist.employee === "sem-specialist") continue;
    if (specialist.status !== "executed") items.push(`${specialist.employee}: ${specialist.status} -- ${specialist.note}`);
  }
  if (input.growth.status !== "executed") items.push(`growth-director-v2: ${input.growth.status} -- ${input.growth.reason}`);
  if (input.qa.status !== "executed") items.push(`qa-reviewer: ${input.qa.status} -- ${input.qa.reason}`);
  if (input.webEngineer.status !== "executed") items.push(`web-engineer: ${input.webEngineer.status} -- ${input.webEngineer.reason}`);

  if (input.promotion.globalBlockReason) items.push(`Promocion a ingenieria bloqueada globalmente: ${input.promotion.globalBlockReason}`);
  for (const signal of input.promotion.unattributedBlockingSignals) {
    items.push(`Senal bloqueante de QA sin recomendacion atribuible (no se ha descartado, requiere lectura humana): ${truncate(signal, 300)}`);
  }
  for (const warning of input.growth.auditWarnings) items.push(`Aviso de auditoria de Growth: ${truncate(warning, 300)}`);
  for (const warning of input.webEngineer.auditWarnings) items.push(`Aviso de auditoria de web-engineer: ${truncate(warning, 300)}`);
  for (const unknown of input.growth.output?.unknowns ?? []) items.push(`Incognita declarada por Growth: ${truncate(unknown, 300)}`);
  for (const unknown of input.webEngineer.output?.unknowns ?? []) items.push(`Incognita declarada por web-engineer: ${truncate(unknown, 300)}`);
  return items;
}

function buildApprovalsNeeded(input: DailyBriefInput, priorities: DailyBriefPriority[]): DailyBriefApproval[] {
  const approvals: DailyBriefApproval[] = [];
  for (const priority of priorities) {
    if (priority.qaStatus === "BLOCKED") {
      approvals.push({
        decision: `DESCARTAR o CORREGIR: "${priority.action}"`,
        why: `QA la ha bloqueado. Motivo(s): ${priority.qaNotes.map((n) => truncate(n, 200)).join(" | ") || "ver seccion QA"}. Decide si se corrige y se vuelve a proponer, o se descarta.`,
        qaStatus: priority.qaStatus,
        origin: priority.originEmployees.join(", "),
      });
      continue;
    }
    approvals.push({
      decision: `APROBAR o RECHAZAR: "${priority.action}"`,
      why: `${truncate(priority.reason, 240)} (impacto ${priority.impact}, confianza ${priority.confidence}, esfuerzo ${priority.effort}).${priority.qaNotes.length > 0 ? ` Avisos de QA a tener en cuenta: ${priority.qaNotes.map((n) => truncate(n, 160)).join(" | ")}` : ""}`,
      qaStatus: priority.qaStatus,
      origin: priority.originEmployees.join(", "),
    });
  }
  if (input.webEngineer.status === "executed" && input.webEngineer.output) {
    approvals.push({
      decision: "APROBAR o RECHAZAR: pasar la especificacion tecnica de web-engineer a una fase de implementacion",
      why: `Hay ${input.webEngineer.output.proposedChanges.length} cambio(s) especificado(s) con criterios de aceptacion y plan de rollback, pendientes de aprobacion humana (approvalRequired=${String(input.webEngineer.output.approvalRequired)}). Nada se ha implementado.`,
      qaStatus: input.promotion.departmentQaStatus,
      origin: "web-engineer",
    });
  }
  return approvals;
}

function buildExecutiveSummary(input: DailyBriefInput, priorities: DailyBriefPriority[]): DepartmentDailyBrief["executiveSummary"] {
  const discovered: string[] = [];
  const executedSpecialists = input.specialists.inputs.filter((i) => i.status === "executed").map((i) => i.employee);
  discovered.push(
    executedSpecialists.length > 0
      ? `${executedSpecialists.length} especialista(s) con salida real en esta pasada: ${executedSpecialists.join(", ")}.`
      : "Ningun especialista produjo salida utilizable en esta pasada -- el departamento no ha descubierto nada nuevo hoy."
  );
  if (input.growth.output) discovered.push(truncate(input.growth.output.growthSummary, 400));
  if (input.specialists.seo) discovered.push(`SEO: ${truncate(input.specialists.seo.executiveSummary, 240)}`);
  if (input.specialists.analytics) {
    discovered.push(
      `Analytics: ${input.specialists.analytics.trackingIssues.length} problema(s) de medicion y ${input.specialists.analytics.conversionObservations.length} observacion(es) de conversion sobre el snapshot "${input.specialists.analytics.runSummary.departmentRunId}".`
    );
  }
  if (input.specialists.content) discovered.push(`Contenido: oportunidad "${truncate(input.specialists.content.contentOpportunity.title, 140)}" (prioridad ${input.specialists.content.priority}).`);

  const needsAttention: string[] = [];
  const blockedCount = priorities.filter((p) => p.qaStatus === "BLOCKED").length;
  if (blockedCount > 0) needsAttention.push(`${blockedCount} prioridad(es) bloqueada(s) por QA -- no pasan a ingenieria hasta que se corrijan o se descarten.`);
  const warned = priorities.filter((p) => p.qaStatus === "PASS_WITH_WARNINGS").length;
  if (warned > 0) needsAttention.push(`${warned} prioridad(es) aprobada(s) CON avisos de QA que conviene leer antes de decidir.`);
  const missing = input.specialists.inputs.filter((i) => i.status !== "executed" && i.employee !== "sem-specialist");
  if (missing.length > 0) needsAttention.push(`${missing.length} especialista(s) sin datos en esta pasada (${missing.map((m) => `${m.employee}=${m.status}`).join(", ")}) -- las conclusiones de hoy no cubren su area.`);
  needsAttention.push("SEM sigue pendiente y fuera de esta fase: ninguna conclusion de este informe cubre Google Ads.");
  if (input.growth.auditWarnings.length > 0) needsAttention.push(`La auditoria de dominio de Growth emitio ${input.growth.auditWarnings.length} aviso(s) (evidencia no verificable o dependencias no declaradas).`);
  if (priorities.length === 0) needsAttention.push("No hay ninguna prioridad del departamento en esta pasada -- revisar el estado de las etapas antes de asumir que no hay trabajo.");

  const changed: string[] = [];
  if (input.previousRun) {
    changed.push(`Pasada coordinada anterior encontrada en este checkout: \`${input.previousRun.departmentRunId}\` (${input.previousRun.priorityCount} prioridad(es), QA ${input.previousRun.departmentQaStatus}, ${input.previousRun.executedStages} etapa(s) ejecutada(s)).`);
    changed.push(`Hoy: ${priorities.length} prioridad(es), QA ${input.promotion.departmentQaStatus}, ${input.manifest.stages.filter((s) => s.status === "executed").length} etapa(s) ejecutada(s).`);
    changed.push("La comparativa es de VOLUMEN y ESTADO entre pasadas, no de resultados de negocio: este sistema todavia no mide impacto real de ninguna accion (nada se ha aplicado).");
  } else {
    changed.push("No hay ninguna pasada coordinada anterior en este checkout con la que comparar -- no se puede afirmar que haya cambiado nada respecto a ayer. No se ha inventado ninguna comparativa.");
  }
  return { discovered, needsAttention, changed };
}

export function buildDepartmentDailyBrief(input: DailyBriefInput): DepartmentDailyBrief {
  const now = input.now ?? new Date();
  const topPriorities = buildTopPriorities(input);
  return {
    contractVersion: DEPARTMENT_RUN_CONTRACT_VERSION,
    departmentRunId: input.manifest.departmentRunId,
    generatedAt: now.toISOString(),
    executiveSummary: buildExecutiveSummary(input, topPriorities),
    topPriorities,
    sections: {
      seo: buildSeoSection(input.manifest, input.specialists.seo),
      content: buildContentSection(input.manifest, input.specialists.content),
      analytics: buildAnalyticsSection(input.manifest, input.specialists.analytics),
      growth: buildGrowthSection(input),
      qa: buildQaSection(input),
      webEngineering: buildWebEngineeringSection(input),
    },
    blockedOrUnknown: buildBlockedOrUnknown(input),
    approvalsNeeded: buildApprovalsNeeded(input, topPriorities),
    stageStatuses: input.manifest.stages,
    departmentQaStatus: input.promotion.departmentQaStatus,
    externalWrites: "none",
    note: BRIEF_NOTE,
  };
}

// --- Render ---------------------------------------------------------------

function renderSection(title: string, section: DailyBriefSection): string[] {
  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(`**${section.employee}** -- status: \`${section.status}\``);
  lines.push("");
  lines.push(section.headline);
  lines.push("");
  for (const bullet of section.bullets) lines.push(`- ${bullet}`);
  lines.push("");
  return lines;
}

export function renderDepartmentDailyBriefMarkdown(brief: DepartmentDailyBrief): string {
  const lines: string[] = [];
  lines.push("# ZENTRY AI DEPARTMENT -- DAILY BRIEF");
  lines.push("");
  lines.push(`- **Pasada coordinada (departmentRunId):** \`${brief.departmentRunId}\``);
  lines.push(`- **Generado:** ${brief.generatedAt}`);
  lines.push(`- **Estado QA del departamento:** \`${brief.departmentQaStatus}\``);
  lines.push(`- **Escrituras externas:** ${brief.externalWrites === "none" ? "ninguna" : brief.externalWrites}`);
  lines.push("");
  lines.push(`> ${brief.note}`);
  lines.push("");

  lines.push("## 1. RESUMEN EJECUTIVO");
  lines.push("");
  lines.push("**Que hemos descubierto hoy**");
  lines.push("");
  for (const item of brief.executiveSummary.discovered) lines.push(`- ${item}`);
  lines.push("");
  lines.push("**Que merece atencion**");
  lines.push("");
  for (const item of brief.executiveSummary.needsAttention) lines.push(`- ${item}`);
  lines.push("");
  lines.push("**Que ha cambiado**");
  lines.push("");
  for (const item of brief.executiveSummary.changed) lines.push(`- ${item}`);
  lines.push("");

  lines.push("## 2. TOP PRIORITIES");
  lines.push("");
  if (brief.topPriorities.length === 0) {
    lines.push("_Ninguna prioridad del departamento en esta pasada. Ver la seccion 9 (BLOCKED / UNKNOWN) para el motivo exacto -- no se ha rellenado este hueco con recomendaciones genericas._");
    lines.push("");
  }
  for (const priority of brief.topPriorities) {
    lines.push(`### ${priority.rank}. ${priority.action}`);
    lines.push("");
    lines.push(`- **Motivo:** ${priority.reason}`);
    lines.push(`- **Impacto:** ${priority.impact} | **Confianza:** ${priority.confidence} | **Esfuerzo:** ${priority.effort}`);
    lines.push(`- **Agente/origen:** ${priority.originEmployees.join(", ")}`);
    lines.push(`- **QA status:** \`${priority.qaStatus}\``);
    if (priority.qaNotes.length > 0) {
      lines.push(`- **Notas de QA:**`);
      for (const note of priority.qaNotes) lines.push(`  - ${note}`);
    }
    if (priority.dependsOn.length > 0) lines.push(`- **Depende de:** ${priority.dependsOn.join("; ")}`);
    lines.push(`- **Necesita aprobacion:** ${priority.approvalRequired ? "SI" : "no"}`);
    lines.push(`- **Especificacion tecnica disponible:** ${priority.hasEngineeringSpec ? "si (ver seccion 8)" : "no"}`);
    if (priority.evidence.length > 0) {
      lines.push(`- **Evidencia:**`);
      for (const evidence of priority.evidence) lines.push(`  - \`${evidence.ref}\` (${evidence.originEmployees.join(", ")}): ${evidence.description}`);
    } else {
      lines.push("- **Evidencia:** _ninguna citada por growth-director-v2 -- tratar la prioridad como no verificada._");
    }
    lines.push("");
  }

  lines.push(...renderSection("3. SEO", brief.sections.seo));
  lines.push(...renderSection("4. CONTENT", brief.sections.content));
  lines.push(...renderSection("5. ANALYTICS", brief.sections.analytics));
  lines.push(...renderSection("6. GROWTH DIRECTOR", brief.sections.growth));
  lines.push(...renderSection("7. QA", brief.sections.qa));
  lines.push(...renderSection("8. WEB ENGINEERING", brief.sections.webEngineering));

  lines.push("## 9. BLOCKED / UNKNOWN");
  lines.push("");
  for (const item of brief.blockedOrUnknown) lines.push(`- ${item}`);
  lines.push("");

  lines.push("## 10. APPROVALS NEEDED");
  lines.push("");
  if (brief.approvalsNeeded.length === 0) {
    lines.push("_Ninguna decision pendiente en esta pasada._");
  }
  brief.approvalsNeeded.forEach((approval, i) => {
    lines.push(`${i + 1}. **${approval.decision}**`);
    lines.push(`   - Motivo: ${approval.why}`);
    lines.push(`   - QA: \`${approval.qaStatus}\` | Origen: ${approval.origin}`);
  });
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## Estado de cada etapa de esta pasada");
  lines.push("");
  lines.push("| Etapa | Fase | Status | Motivo |");
  lines.push("| --- | --- | --- | --- |");
  for (const stage of brief.stageStatuses) {
    lines.push(`| ${stage.stage} | ${stage.phase} | \`${stage.status}\` | ${stage.reason.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Version BREVE para $GITHUB_STEP_SUMMARY -- lo esencial, sin sustituir al informe completo (que viaja como artifact). */
export function renderDepartmentStepSummary(brief: DepartmentDailyBrief): string {
  const lines: string[] = [];
  lines.push("## ZENTRY AI DEPARTMENT -- Daily Brief (resumen)");
  lines.push("");
  lines.push(`- **departmentRunId:** \`${brief.departmentRunId}\``);
  lines.push(`- **QA del departamento:** \`${brief.departmentQaStatus}\``);
  lines.push(`- **Prioridades:** ${brief.topPriorities.length} (bloqueadas por QA: ${brief.topPriorities.filter((p) => p.qaStatus === "BLOCKED").length})`);
  lines.push(`- **Decisiones pendientes de Pau:** ${brief.approvalsNeeded.length}`);
  lines.push(`- **Escrituras externas:** ninguna (WordPress/staging/produccion/Ads/GA4/GTM/Search Console/n8n/email no se han tocado; nada se ha commiteado).`);
  lines.push("");
  lines.push("| Etapa | Status |");
  lines.push("| --- | --- |");
  for (const stage of brief.stageStatuses) lines.push(`| ${stage.stage} | \`${stage.status}\` |`);
  lines.push("");
  if (brief.topPriorities.length > 0) {
    lines.push("**Top prioridades**");
    lines.push("");
    for (const priority of brief.topPriorities.slice(0, 5)) {
      lines.push(`${priority.rank}. ${priority.action} -- impacto ${priority.impact} / confianza ${priority.confidence} / esfuerzo ${priority.effort} -- QA \`${priority.qaStatus}\` -- aprobacion: ${priority.approvalRequired ? "SI" : "no"}`);
    }
    lines.push("");
  }
  lines.push("El informe completo (`department-daily-brief.md` / `.json`) viaja en el artifact de este run.");
  lines.push("");
  return lines.join("\n");
}
