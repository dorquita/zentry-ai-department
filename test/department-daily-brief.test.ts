import * as assert from "node:assert/strict";
import { buildDepartmentDailyBrief, DailyBriefInput, renderDepartmentDailyBriefMarkdown, renderDepartmentStepSummary } from "../src/department/daily-brief";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { LoadedSpecialistInputs } from "../src/department/specialist-inputs";
import { DEPARTMENT_RUN_CONTRACT_VERSION, DEPARTMENT_STAGE_PHASE, DepartmentRunManifest, DepartmentStageName, DepartmentStageRecord, DepartmentStageStatus } from "../src/department/types";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const DEPARTMENT_RUN_ID = "dept-2026-08-15T120000Z";

function stage(name: DepartmentStageName, status: DepartmentStageStatus, reason = "motivo"): DepartmentStageRecord {
  return {
    stage: name,
    phase: DEPARTMENT_STAGE_PHASE[name],
    status,
    reason,
    outputPath: null,
    artifactPath: null,
    sourceRunId: null,
    auditWarningCount: null,
    recordedAt: "2026-08-15T12:00:00.000Z",
  };
}

function manifest(stages: DepartmentStageRecord[]): DepartmentRunManifest {
  return { contractVersion: DEPARTMENT_RUN_CONTRACT_VERSION, departmentRunId: DEPARTMENT_RUN_ID, startedAt: "2026-08-15T12:00:00.000Z", updatedAt: "2026-08-15T12:00:00.000Z", note: "nota", stages };
}

const SPECIALISTS: LoadedSpecialistInputs = {
  inputs: [
    { employee: "seo-specialist", status: "executed", note: "salida real", sourceRunId: null },
    { employee: "content-strategist", status: "not_available", note: "content-strategist: sin insumos reales disponibles en esta pasada. NO hay ningun dato de este especialista.", sourceRunId: null },
    { employee: "analytics-specialist", status: "executed", note: "salida real", sourceRunId: "growth-department-2026-08-14T111247Z" },
    { employee: "sem-specialist", status: "not_available", note: "sem-specialist queda EXPLICITAMENTE FUERA de esta fase (pendiente).", sourceRunId: null },
  ],
  evidenceCatalog: [
    { ref: "dept-seo-action-1", description: "seo-specialist, accion priorizada #1: mejorar CTR." },
    { ref: "dept-analytics-tracking-issue-1", description: "analytics-specialist, problema de medicion: tag pausado." },
  ],
  executedCount: 2,
};

function promotion(overrides: Partial<DepartmentPromotionResult> = {}): DepartmentPromotionResult {
  return {
    departmentRunId: DEPARTMENT_RUN_ID,
    departmentQaStatus: "PASS",
    qaReviewStatus: "pass",
    globalBlockReason: null,
    promoted: [
      {
        rank: 1,
        title: "Corregir el seguimiento de conversiones",
        rationale: "Sin medicion fiable nada es evaluable.",
        impact: "high",
        confidence: "medium",
        effort: "medium",
        dependsOn: ["Acceso humano a GTM"],
        evidenceRefs: ["dept-analytics-tracking-issue-1"],
        decision: "promoted",
        blockedBy: [],
        qaWarnings: [],
      },
    ],
    blocked: [],
    unattributedBlockingSignals: [],
    qaSummary: { criticalFindings: 0, warningFindings: 0, safetyConcerns: 0, contradictions: 0, unsupportedClaims: 0, requiredCorrections: 0 },
    ...overrides,
  };
}

const WEB_OUTPUT: WebEngineerOutput = {
  implementationSummary: "Reactivar el tag de conversion y verificar en GTM.",
  targetPages: ["/contacto"],
  targetComponents: ["formulario de contacto"],
  proposedChanges: [{ description: "Reactivar tag pausado", rationale: "Viene de Corregir el seguimiento de conversiones", targetPageOrComponent: "GTM" }],
  filesOrSystemsAffected: ["GTM"],
  acceptanceCriteria: ["El evento aparece en GA4"],
  validationPlan: ["Vista previa de GTM"],
  rollbackPlan: ["Volver a pausar el tag"],
  dependencies: ["Acceso humano a GTM"],
  risks: ["Duplicar eventos"],
  approvalRequired: true,
  unknowns: ["No se ha confirmado el estado real del contenedor"],
};

function briefInput(overrides: Partial<DailyBriefInput> = {}): DailyBriefInput {
  return {
    manifest: manifest([
      stage("seo-specialist", "executed"),
      stage("content-strategist", "not_available", "Sin change packs de contenido elegibles."),
      stage("analytics-specialist", "executed"),
      stage("sem-specialist", "not_available", "Fuera de esta fase."),
      stage("growth-director-v2", "executed"),
      stage("qa-reviewer", "executed"),
      stage("web-engineer", "executed"),
    ]),
    specialists: SPECIALISTS,
    growth: {
      status: "executed",
      reason: "ok",
      auditWarnings: [],
      output: {
        growthSummary: "Sintesis del departamento.",
        currentSignals: [],
        bottlenecks: [],
        opportunities: [],
        experiments: [],
        recommendedPriorities: [],
        dependencies: [],
        risks: [],
        evidence: [],
        unknowns: [],
      },
    },
    qa: { status: "executed", reason: "ok" },
    webEngineer: { status: "executed", reason: "ok", auditWarnings: [], output: WEB_OUTPUT },
    promotion: promotion(),
    previousRun: null,
    now: new Date("2026-08-15T13:00:00.000Z"),
    ...overrides,
  };
}

export function runDepartmentDailyBriefTests(): TestCase[] {
  return [
    {
      name: "El brief recoge las prioridades con impacto/confianza/esfuerzo, su evidencia y el empleado de origen (trazabilidad completa)",
      fn: () => {
        const brief = buildDepartmentDailyBrief(briefInput());

        assert.equal(brief.departmentRunId, DEPARTMENT_RUN_ID);
        assert.equal(brief.contractVersion, DEPARTMENT_RUN_CONTRACT_VERSION);
        assert.equal(brief.topPriorities.length, 1);

        const priority = brief.topPriorities[0];
        assert.equal(priority.action, "Corregir el seguimiento de conversiones");
        assert.equal(priority.impact, "high");
        assert.equal(priority.confidence, "medium");
        assert.equal(priority.effort, "medium");
        assert.equal(priority.qaStatus, "PASS");
        assert.equal(priority.approvalRequired, true);
        assert.deepEqual(priority.originEmployees, ["analytics-specialist"]);
        assert.equal(priority.evidence[0].ref, "dept-analytics-tracking-issue-1");
        assert.ok(priority.evidence[0].description.includes("tag pausado"), "la evidencia se resuelve contra el catalogo real, no se deja como ref suelta");
        assert.equal(priority.hasEngineeringSpec, true);
      },
    },
    {
      name: "Una prioridad bloqueada por QA aparece como BLOCKED, sin especificacion tecnica, y con el motivo literal de QA",
      fn: () => {
        const brief = buildDepartmentDailyBrief(
          briefInput({
            promotion: promotion({
              departmentQaStatus: "PASS_WITH_WARNINGS",
              qaReviewStatus: "pass_with_warnings",
              promoted: [],
              blocked: [
                {
                  rank: 1,
                  title: "Corregir el seguimiento de conversiones",
                  rationale: "Sin medicion fiable nada es evaluable.",
                  impact: "high",
                  confidence: "medium",
                  effort: "medium",
                  dependsOn: [],
                  evidenceRefs: ["dept-analytics-tracking-issue-1"],
                  decision: "blocked",
                  blockedBy: ["[requiredCorrection] Falta evidencia para Corregir el seguimiento de conversiones."],
                  qaWarnings: [],
                },
              ],
            }),
          })
        );

        const priority = brief.topPriorities[0];
        assert.equal(priority.qaStatus, "BLOCKED");
        assert.equal(priority.hasEngineeringSpec, false, "una recomendacion bloqueada nunca se marca como especificada");
        assert.ok(priority.qaNotes[0].includes("requiredCorrection"));

        const approval = brief.approvalsNeeded.find((a) => a.decision.includes("DESCARTAR o CORREGIR"));
        assert.ok(approval, "una prioridad bloqueada genera una decision explicita para el humano");
      },
    },
    {
      // Contrato NUEVO: SEM ya no lleva una linea fija de "pendiente /
      // fuera de fase" (que se emitia incluso cuando el especialista
      // habia corrido). Si no aporto datos, aparece en BLOCKED / UNKNOWN
      // con su estado REAL, exactamente igual que cualquier otro
      // especialista ausente -- y su seccion propia lo dice tambien.
      name: "SEM sin datos: aparece en BLOCKED / UNKNOWN con su estado real y su seccion no se rellena con nada inventado",
      fn: () => {
        const brief = buildDepartmentDailyBrief(briefInput());
        assert.ok(brief.blockedOrUnknown.some((item) => item.startsWith("sem-specialist:")));
        assert.equal(brief.sections.sem.employee, "sem-specialist");
        assert.equal(brief.sections.sem.status, "not_available");
        assert.ok(brief.sections.sem.headline.includes("Sin aportacion utilizable"));
        assert.ok(brief.executiveSummary.needsAttention.some((item) => item.includes("sin datos en esta pasada")));
      },
    },
    {
      name: "Un especialista ausente se declara en BLOCKED / UNKNOWN y NO se rellena su seccion con datos inventados",
      fn: () => {
        const brief = buildDepartmentDailyBrief(briefInput());
        assert.equal(brief.sections.content.status, "not_available");
        assert.ok(brief.sections.content.headline.includes("Sin aportacion utilizable"));
        assert.ok(brief.blockedOrUnknown.some((item) => item.startsWith("content-strategist:")));
        assert.ok(brief.executiveSummary.needsAttention.some((item) => item.includes("sin datos en esta pasada")));
      },
    },
    {
      name: "Sin pasada anterior, el brief lo dice explicitamente en vez de inventar una comparativa",
      fn: () => {
        const brief = buildDepartmentDailyBrief(briefInput());
        assert.ok(brief.executiveSummary.changed.some((c) => c.includes("No hay ninguna pasada coordinada anterior")));

        const withPrevious = buildDepartmentDailyBrief(
          briefInput({ previousRun: { departmentRunId: "dept-2026-08-14T120000Z", priorityCount: 4, departmentQaStatus: "PASS", executedStages: 5 } })
        );
        assert.ok(withPrevious.executiveSummary.changed.some((c) => c.includes("dept-2026-08-14T120000Z")));
      },
    },
    {
      name: "Sin apply, el brief declara que no hubo ninguna escritura externa y que toda accion requiere aprobacion",
      fn: () => {
        const brief = buildDepartmentDailyBrief(briefInput());
        assert.equal(brief.externalWrites, "none");
        // Desde la fase de APPLY la nota ya no puede decir "no se ha
        // enviado ningun correo" (el Daily Brief SI se envia), pero sigue
        // teniendo que dejar claras las dos cosas que importan: que el
        // analisis no escribe en ningun sistema, y que nada se ejecuta
        // sin pasar la puerta de aprobacion.
        assert.ok(brief.note.includes("PROPUESTAS"), `nota inesperada: ${brief.note}`);
        assert.ok(brief.note.includes("puerta de aprobacion"));
        assert.ok(brief.note.includes("NO se ha escrito en ningun sistema externo"));
        assert.ok(brief.apply === null, "una pasada sin planificacion de apply lo dice con null, no con un objeto vacio");
        assert.ok(brief.topPriorities.every((p) => p.approvalRequired === true));
      },
    },
    {
      name: "Growth ausente: el brief se genera igualmente, sin prioridades y diciendo por que (fail-closed visible, no vacio silencioso)",
      fn: () => {
        const brief = buildDepartmentDailyBrief(
          briefInput({
            growth: { status: "invalid_output", reason: "Salida no valida.", auditWarnings: [] },
            promotion: promotion({ promoted: [], blocked: [], globalBlockReason: "growth-director-v2 no produjo una sintesis valida en esta pasada." }),
          })
        );

        assert.equal(brief.topPriorities.length, 0);
        assert.equal(brief.sections.growth.status, "invalid_output");
        assert.ok(brief.blockedOrUnknown.some((item) => item.includes("growth-director-v2: invalid_output")));
        assert.ok(brief.blockedOrUnknown.some((item) => item.includes("Promocion a ingenieria bloqueada globalmente")));
      },
    },
    {
      name: "El markdown contiene las 11 secciones pedidas, en orden (SEM incluida), y el resumen de Step Summary es coherente",
      fn: () => {
        const brief = buildDepartmentDailyBrief(briefInput());
        const markdown = renderDepartmentDailyBriefMarkdown(brief);

        const expectedSections = [
          "# ZENTRY AI DEPARTMENT -- DAILY BRIEF",
          "## 1. RESUMEN EJECUTIVO",
          "## 2. TOP PRIORITIES",
          "## 3. SEO",
          "## 4. CONTENT",
          "## 5. ANALYTICS",
          "## 6. SEM / GOOGLE ADS",
          "## 7. GROWTH DIRECTOR",
          "## 8. QA",
          "## 9. WEB ENGINEERING",
          "## 10. BLOCKED / UNKNOWN",
          "## 11. APPROVALS NEEDED",
        ];
        let cursor = -1;
        for (const section of expectedSections) {
          const index = markdown.indexOf(section);
          assert.ok(index > cursor, `seccion fuera de orden o ausente: ${section}`);
          cursor = index;
        }
        assert.ok(markdown.includes("dept-analytics-tracking-issue-1"), "la evidencia citada debe ser visible en el informe");

        const stepSummary = renderDepartmentStepSummary(brief);
        assert.ok(stepSummary.includes(DEPARTMENT_RUN_ID));
        assert.ok(stepSummary.includes("Escrituras externas:** ninguna"));
        assert.ok(stepSummary.includes("sem-specialist"));
      },
    },
  ];
}
