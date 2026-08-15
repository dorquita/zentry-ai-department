import * as assert from "node:assert/strict";
import { APPROVAL_VALIDITY_HOURS, ApprovalSnapshotLike, DEPARTMENT_APPLY_RELATED_TYPE, resolveHumanApproval } from "../src/department/apply/approval";
import { buildApplyPlan } from "../src/department/apply/plan";
import { DepartmentPromotionResult, DepartmentRecommendation } from "../src/department/promotion";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const NOW = new Date("2026-08-15T12:00:00.000Z");
const DEPARTMENT_RUN_ID = "dept-2026-08-15T120000Z";
const APPLY_ITEM_ID = `${DEPARTMENT_RUN_ID}#apply-1`;

function request(overrides: Partial<ApprovalSnapshotLike> = {}): ApprovalSnapshotLike {
  return {
    approvalRequestId: "req-1",
    relatedType: DEPARTMENT_APPLY_RELATED_TYPE,
    relatedId: APPLY_ITEM_ID,
    status: "approved",
    answeredBy: "telegram",
    answeredAt: "2026-08-15T11:00:00.000Z",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T11:00:00.000Z",
    ...overrides,
  };
}

function recommendation(overrides: Partial<DepartmentRecommendation> = {}): DepartmentRecommendation {
  return {
    rank: 1,
    title: "Reescribir metas de la familia melamina",
    rationale: "239 impresiones con CTR 0% en la pagina de melamina.",
    impact: "medium",
    confidence: "high",
    effort: "low",
    dependsOn: [],
    evidenceRefs: ["dept-seo-1"],
    decision: "promoted",
    blockedBy: [],
    qaWarnings: [],
    ...overrides,
  };
}

function promotion(overrides: Partial<DepartmentPromotionResult> = {}): DepartmentPromotionResult {
  return {
    departmentRunId: DEPARTMENT_RUN_ID,
    departmentQaStatus: "PASS",
    qaReviewStatus: "pass",
    globalBlockReason: null,
    promoted: [recommendation()],
    blocked: [],
    unattributedBlockingSignals: [],
    qaSummary: { criticalFindings: 0, warningFindings: 0, safetyConcerns: 0, contradictions: 0, unsupportedClaims: 0, requiredCorrections: 0 },
    ...overrides,
  };
}

/** Especificacion que SI cumple el formato maquina y apunta a una pagina propia conocida. */
function executableSpec(): WebEngineerOutput {
  return {
    implementationSummary: "Actualizar title y meta description del borrador de staging de melamina.",
    targetPages: ["https://staging.zentrylockers.com/?page_id=2091"],
    targetComponents: [],
    proposedChanges: [
      {
        description: "Reescribir metas de la familia melamina en page_id=2091.\nTITLE: Taquillas de melamina para vestuarios | Zentry\nMETA: Taquillas de melamina resistentes para vestuarios y colegios.",
        rationale: "CTR 0% con 239 impresiones.",
        targetPageOrComponent: "https://staging.zentrylockers.com/?page_id=2091",
      },
    ],
    filesOrSystemsAffected: ["WordPress staging"],
    acceptanceCriteria: ["El borrador sigue en draft"],
    validationPlan: ["Releer la pagina"],
    rollbackPlan: ["Restaurar title/meta previos"],
    dependencies: [],
    risks: [],
    approvalRequired: true,
    unknowns: [],
  };
}

const OWNED_PAGES = [{ wordpressPageId: 2091, stagingUrl: "https://staging.zentrylockers.com/?page_id=2091" }];

function plan(requests: ApprovalSnapshotLike[], overrides: { promotion?: DepartmentPromotionResult; spec?: WebEngineerOutput | null } = {}) {
  return buildApplyPlan({
    departmentRunId: DEPARTMENT_RUN_ID,
    promotion: overrides.promotion ?? promotion(),
    webEngineer: overrides.spec === null ? { status: "not_available" } : { status: "executed", output: overrides.spec ?? executableSpec() },
    ownedStagingPages: OWNED_PAGES,
    approvalRequests: requests,
    now: NOW,
  });
}

export function runDepartmentApplyApprovalTests(): TestCase[] {
  return [
    // --- La regla central de toda la fase ---
    {
      name: "QA PASS SIN aprobacion humana NO permite apply: el elemento queda awaiting_approval",
      fn: () => {
        const summary = plan([]);
        const item = summary.items[0];
        assert.equal(item.qaStatus, "PASS");
        assert.equal(item.applyCapability.supported, true, "el executor existe...");
        assert.equal(item.humanApproval.status, "none", "...pero nadie lo ha aprobado");
        assert.equal(item.applyStatus, "awaiting_approval");
        assert.match(item.humanApproval.reason, /no es una aprobacion/i);
      },
    },
    {
      name: "Aprobacion humana RECHAZADA -> rejected, nunca entra al executor",
      fn: () => {
        const summary = plan([request({ status: "rejected", answeredBy: "telegram" })]);
        assert.equal(summary.items[0].humanApproval.status, "rejected");
        assert.equal(summary.items[0].applyStatus, "rejected");
      },
    },
    {
      name: "Aprobacion humana explicita y vigente -> approved (unico estado que puede entrar al executor)",
      fn: () => {
        const summary = plan([request()]);
        assert.equal(summary.items[0].humanApproval.status, "approved");
        assert.equal(summary.items[0].humanApproval.answeredBy, "telegram");
        assert.equal(summary.items[0].applyStatus, "approved");
      },
    },
    {
      name: "Estado de aprobacion DESCONOCIDO -> fail-closed: unknown -> blocked",
      fn: () => {
        const summary = plan([request({ status: "quiza" })]);
        assert.equal(summary.items[0].humanApproval.status, "unknown");
        assert.equal(summary.items[0].applyStatus, "blocked");
      },
    },
    {
      name: "Varias solicitudes para el mismo elemento -> fail-closed (unknown), no se elige ninguna",
      fn: () => {
        const summary = plan([request({ approvalRequestId: "req-1" }), request({ approvalRequestId: "req-2", status: "rejected" })]);
        assert.equal(summary.items[0].humanApproval.status, "unknown");
        assert.equal(summary.items[0].applyStatus, "blocked");
      },
    },

    // --- Casos limite de la puerta pura ---
    {
      name: "pending y snoozed nunca son aprobacion",
      fn: () => {
        for (const status of ["pending", "snoozed"]) {
          const approval = resolveHumanApproval({ applyItemId: APPLY_ITEM_ID, requests: [request({ status })], now: NOW });
          assert.equal(approval.status, "pending", `status "${status}" no puede aprobar`);
        }
      },
    },
    {
      name: "expired y cancelled cuentan como rechazo, no como pendiente",
      fn: () => {
        for (const status of ["expired", "cancelled"]) {
          const approval = resolveHumanApproval({ applyItemId: APPLY_ITEM_ID, requests: [request({ status })], now: NOW });
          assert.equal(approval.status, "rejected", `status "${status}" no puede quedar en pendiente`);
        }
      },
    },
    {
      name: "Una aprobacion caducada por tiempo deja de valer (no se aplica algo aprobado hace semanas)",
      fn: () => {
        const stale = request({ answeredAt: new Date(NOW.getTime() - (APPROVAL_VALIDITY_HOURS + 1) * 3600_000).toISOString() });
        const approval = resolveHumanApproval({ applyItemId: APPLY_ITEM_ID, requests: [stale], now: NOW });
        assert.equal(approval.status, "rejected");
        assert.match(approval.reason, /ya no es vigente/);
      },
    },
    {
      name: 'Una aprobacion "approved" sin autor no se acepta (fail-closed)',
      fn: () => {
        const approval = resolveHumanApproval({ applyItemId: APPLY_ITEM_ID, requests: [request({ answeredBy: "" })], now: NOW });
        assert.equal(approval.status, "unknown");
      },
    },
    {
      name: "Una aprobacion de OTRO tipo o de OTRO elemento no cuenta para este elemento",
      fn: () => {
        const otherType = resolveHumanApproval({ applyItemId: APPLY_ITEM_ID, requests: [request({ relatedType: "staging_execution" })], now: NOW });
        assert.equal(otherType.status, "none");
        const otherId = resolveHumanApproval({ applyItemId: APPLY_ITEM_ID, requests: [request({ relatedId: `${DEPARTMENT_RUN_ID}#apply-9` })], now: NOW });
        assert.equal(otherId.status, "none");
      },
    },

    // --- Interaccion con la puerta de QA ---
    {
      name: "Una recomendacion BLOQUEADA por QA queda blocked aunque exista una aprobacion humana valida",
      fn: () => {
        const summary = plan([request()], {
          promotion: promotion({
            departmentQaStatus: "BLOCKED",
            promoted: [],
            blocked: [recommendation({ decision: "blocked", blockedBy: ["[safetyConcern] afirmacion sin respaldo"] })],
            globalBlockReason: "QA marco el conjunto como BLOCKED",
          }),
        });
        assert.equal(summary.items[0].applyStatus, "blocked");
        assert.equal(summary.items[0].qaStatus, "BLOCKED");
      },
    },
    {
      name: "Sin especificacion de web-engineer no hay executor: requires_manual_implementation (ni siquiera awaiting_approval)",
      fn: () => {
        const summary = plan([request()], { spec: null });
        assert.equal(summary.items[0].applyCapability.supported, false);
        assert.equal(summary.items[0].applyStatus, "requires_manual_implementation");
      },
    },
  ];
}
