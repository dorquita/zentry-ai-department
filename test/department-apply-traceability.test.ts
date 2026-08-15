import * as assert from "node:assert/strict";
import { DEPARTMENT_APPLY_RELATED_TYPE } from "../src/department/apply/approval";
import { executeApplyItem } from "../src/department/apply/executor";
import { buildApplyPlan } from "../src/department/apply/plan";
import { buildApplyItemId, buildRecommendationId } from "../src/department/apply/types";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import { DepartmentRunManifest } from "../src/department/types";
import { buildDepartmentDailyBrief } from "../src/department/daily-brief";
import { LoadedSpecialistInputs } from "../src/department/specialist-inputs";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const NOW = new Date("2026-08-15T12:00:00.000Z");
const RUN_ID = "dept-2026-08-15T120000Z";

const SPEC: WebEngineerOutput = {
  implementationSummary: "Actualizar metas del borrador de melamina.",
  targetPages: ["https://staging.zentrylockers.com/?page_id=2091"],
  targetComponents: [],
  proposedChanges: [
    {
      description: "Reescribir metas de la familia melamina.\nTITLE: Taquillas de melamina | Zentry\nMETA: Taquillas de melamina para vestuarios.",
      rationale: "239 impresiones, CTR 0%.",
      targetPageOrComponent: "https://staging.zentrylockers.com/?page_id=2091",
    },
  ],
  filesOrSystemsAffected: ["WordPress staging"],
  acceptanceCriteria: ["Sigue en draft"],
  validationPlan: ["Releer"],
  rollbackPlan: ["Restaurar"],
  dependencies: [],
  risks: [],
  approvalRequired: true,
  unknowns: [],
};

const PROMOTION: DepartmentPromotionResult = {
  departmentRunId: RUN_ID,
  departmentQaStatus: "PASS",
  qaReviewStatus: "pass",
  globalBlockReason: null,
  promoted: [
    {
      rank: 1,
      title: "Reescribir metas de la familia melamina",
      rationale: "239 impresiones con CTR 0%.",
      impact: "medium",
      confidence: "high",
      effort: "low",
      dependsOn: [],
      evidenceRefs: ["dept-seo-1"],
      decision: "promoted",
      blockedBy: [],
      qaWarnings: [],
    },
  ],
  blocked: [],
  unattributedBlockingSignals: [],
  qaSummary: { criticalFindings: 0, warningFindings: 0, safetyConcerns: 0, contradictions: 0, unsupportedClaims: 0, requiredCorrections: 0 },
};

const OWNED_PAGES = [{ wordpressPageId: 2091, stagingUrl: "https://staging.zentrylockers.com/?page_id=2091" }];

function manifestWithSemPending(): DepartmentRunManifest {
  return {
    contractVersion: "department-run/v1",
    departmentRunId: RUN_ID,
    startedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    note: "nota",
    stages: [
      { stage: "sem-specialist", phase: "specialists", status: "not_available", reason: "SEM fuera de esta fase (pendiente).", outputPath: null, artifactPath: null, sourceRunId: null, auditWarningCount: null, recordedAt: NOW.toISOString() },
      { stage: "growth-director-v2", phase: "growth", status: "executed", reason: "ok", outputPath: null, artifactPath: null, sourceRunId: null, auditWarningCount: null, recordedAt: NOW.toISOString() },
      { stage: "qa-reviewer", phase: "qa", status: "executed", reason: "ok", outputPath: null, artifactPath: null, sourceRunId: null, auditWarningCount: null, recordedAt: NOW.toISOString() },
      { stage: "web-engineer", phase: "web-engineering", status: "executed", reason: "ok", outputPath: null, artifactPath: null, sourceRunId: null, auditWarningCount: null, recordedAt: NOW.toISOString() },
    ],
  };
}

const EMPTY_SPECIALISTS: LoadedSpecialistInputs = {
  inputs: [
    { employee: "seo-specialist", status: "executed", note: "ok", sourceRunId: null },
    { employee: "sem-specialist", status: "not_available", note: "SEM pendiente / fuera de fase.", sourceRunId: null },
  ],
  evidenceCatalog: [{ ref: "dept-seo-1", description: "239 impresiones, CTR 0% en melamina" } as LoadedSpecialistInputs["evidenceCatalog"][number]],
  executedCount: 1,
};

export function runDepartmentApplyTraceabilityTests(): TestCase[] {
  return [
    {
      name: "Trazabilidad completa: departmentRunId -> recomendacion -> QA -> aprobacion -> apply -> validacion -> rollback",
      fn: async () => {
        // 1. Plan con aprobacion humana real registrada.
        const summary = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion: PROMOTION,
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: OWNED_PAGES,
          approvalRequests: [
            {
              approvalRequestId: "req-melamina",
              relatedType: DEPARTMENT_APPLY_RELATED_TYPE,
              relatedId: buildApplyItemId(RUN_ID, 1),
              status: "approved",
              answeredBy: "telegram",
              answeredAt: "2026-08-15T11:30:00.000Z",
              createdAt: "2026-08-15T11:00:00.000Z",
              updatedAt: "2026-08-15T11:30:00.000Z",
            },
          ],
          now: NOW,
        });

        const item = summary.items[0];
        // departmentRunId -> recomendacion
        assert.equal(item.departmentRunId, RUN_ID);
        assert.equal(item.recommendationId, buildRecommendationId(RUN_ID, 1));
        assert.equal(item.recommendationRank, 1);
        // -> evidencia y agentes de origen
        assert.deepEqual(item.evidenceRefs, ["dept-seo-1"]);
        assert.ok(item.sourceAgents.length > 0, "cada elemento sabe de que empleados viene su evidencia");
        // -> QA
        assert.equal(item.qaStatus, "PASS");
        // -> aprobacion
        assert.equal(item.humanApproval.approvalRequestId, "req-melamina");
        assert.equal(item.humanApproval.status, "approved");
        assert.equal(item.applyStatus, "approved");
        // -> especificacion de web-engineer asociada
        assert.equal(item.webEngineerSpecification?.proposedChanges.length, 1);

        // 2. Apply real (fake) con validacion fallida -> rollback.
        let page = { id: 2091, status: "draft", title: "Titulo antiguo", contentHtml: "<p>c</p>", excerpt: "Meta antigua" };
        const executed = await executeApplyItem(
          item,
          {
            getPage: async () => ({ ...page }),
            updateDraft: async (input) => {
              // Simula un WordPress que acepta el rollback pero ignora el apply.
              if (input.title === "Titulo antiguo") page = { ...page, title: input.title, excerpt: input.excerpt };
            },
          },
          { departmentApplyEnabled: true, wordpressDraftsEnabled: true, wordpressBackend: "rest", wordpressEnv: "staging" }
        );

        // -> apply -> validacion -> rollback, todo en el mismo elemento.
        assert.equal(executed.applyItemId, item.applyItemId, "el rastro no cambia de identidad al ejecutarse");
        assert.equal(executed.snapshot?.previousTitle, "Titulo antiguo");
        assert.equal(executed.validationStatus, "failed");
        assert.equal(executed.rollbackStatus, "rolled_back");
        assert.equal(executed.applyStatus, "rolled_back");

        const events = executed.auditTrail.map((e) => e.event);
        for (const expected of ["planned", "snapshot_taken", "applied", "validation_failed", "rolled_back"]) {
          assert.ok(events.includes(expected), `falta el evento "${expected}" en el rastro de auditoria: ${events.join(", ")}`);
        }
      },
    },
    {
      name: "SEM pendiente no bloquea nada: la pasada planifica apply y el brief sigue completo",
      fn: () => {
        const summary = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion: PROMOTION,
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: OWNED_PAGES,
          approvalRequests: [],
          now: NOW,
        });
        assert.equal(summary.items.length, 1, "SEM ausente no reduce ni bloquea los elementos de apply");
        assert.equal(summary.items[0].applyStatus, "awaiting_approval");

        const brief = buildDepartmentDailyBrief({
          manifest: manifestWithSemPending(),
          specialists: EMPTY_SPECIALISTS,
          growth: { status: "executed", reason: "ok", auditWarnings: [] },
          qa: { status: "executed", reason: "ok" },
          webEngineer: { status: "executed", reason: "ok", auditWarnings: [] },
          promotion: PROMOTION,
          apply: summary,
          now: NOW,
        });

        assert.ok(brief.blockedOrUnknown.some((i) => i.startsWith("SEM:")), "el brief siempre declara SEM pendiente");
        assert.equal(brief.apply?.counts.awaiting_approval, 1);
        assert.equal(brief.externalWrites, "none", "planificar apply no escribe en ningun sistema");
      },
    },
    {
      name: "El brief marca escrituras externas SOLO si el contrato de apply dice que las hubo",
      fn: () => {
        const summary = buildApplyPlan({
          departmentRunId: RUN_ID,
          promotion: PROMOTION,
          webEngineer: { status: "executed", output: SPEC },
          ownedStagingPages: OWNED_PAGES,
          approvalRequests: [],
          now: NOW,
        });
        const brief = buildDepartmentDailyBrief({
          manifest: manifestWithSemPending(),
          specialists: EMPTY_SPECIALISTS,
          growth: { status: "executed", reason: "ok", auditWarnings: [] },
          qa: { status: "executed", reason: "ok" },
          webEngineer: { status: "executed", reason: "ok", auditWarnings: [] },
          promotion: PROMOTION,
          apply: { ...summary, externalWritesPerformed: true },
          now: NOW,
        });
        assert.notEqual(brief.externalWrites, "none");
        assert.match(brief.note, /STAGING/);
      },
    },
  ];
}
