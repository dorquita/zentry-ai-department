import * as assert from "node:assert/strict";
import { APPROVAL_VALIDITY_HOURS, ApprovalSnapshotLike, DEPARTMENT_APPLY_RELATED_TYPE, resolveHumanApproval } from "../src/department/apply/approval";
import { buildApplyPlan } from "../src/department/apply/plan";
import { DepartmentPromotionResult, DepartmentRecommendation } from "../src/department/promotion";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import { NOW, OWNED_PAGES, PROMOTION, RUN_ID, SPEC, STAGING_URL } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void;
}

const CHANGE_ID = `${RUN_ID}#change-1-v1`;

function request(overrides: Partial<ApprovalSnapshotLike> = {}): ApprovalSnapshotLike {
  return {
    approvalRequestId: "req-1",
    relatedType: DEPARTMENT_APPLY_RELATED_TYPE,
    relatedId: CHANGE_ID,
    status: "approved",
    answeredBy: "telegram",
    answeredAt: "2026-08-15T11:00:00.000Z",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T11:00:00.000Z",
    ...overrides,
  };
}

function recommendation(overrides: Partial<DepartmentRecommendation> = {}): DepartmentRecommendation {
  return { ...PROMOTION.promoted[0], ...overrides };
}

function promotion(overrides: Partial<DepartmentPromotionResult> = {}): DepartmentPromotionResult {
  return { ...PROMOTION, ...overrides };
}

function plan(overrides: { promotion?: DepartmentPromotionResult; spec?: WebEngineerOutput | null; pages?: typeof OWNED_PAGES } = {}) {
  return buildApplyPlan({
    departmentRunId: RUN_ID,
    promotion: overrides.promotion ?? promotion(),
    webEngineer: overrides.spec === null ? { status: "not_available" } : { status: "executed", output: overrides.spec ?? SPEC },
    ownedStagingPages: overrides.pages ?? OWNED_PAGES,
    now: NOW,
  });
}

export function runDepartmentApplyApprovalTests(): TestCase[] {
  return [
    // --- Planificacion: staging NO necesita aprobacion previa; produccion SI ---
    {
      name: "Una recomendacion con executor soportado queda `proposed`: staging se aplica sin aprobacion previa",
      fn: () => {
        const item = plan().items[0];
        assert.equal(item.qaStatus, "PASS");
        assert.equal(item.applyCapability.supported, true);
        assert.equal(item.applyCapability.id, "staging_published_meta_update");
        assert.equal(item.applyStatus, "proposed");
        // Y la aprobacion todavia no existe: se pide DESPUES, sobre la version ya validada.
        assert.equal(item.humanApproval.status, "none");
        assert.match(item.humanApproval.reason, /DESPUES de aplicar y validar el cambio en staging/i);
      },
    },
    {
      name: "Planificar no escribe en ningun sistema externo",
      fn: () => {
        const summary = plan();
        assert.equal(summary.externalWritesPerformed, false);
        assert.equal(summary.productionWritesPerformed, false);
      },
    },
    {
      name: "Sin executor determinista -> requires_manual_staging_implementation (nunca se inventa uno)",
      fn: () => {
        const noDirectives: WebEngineerOutput = {
          ...SPEC,
          proposedChanges: [{ description: "Mejorar el copy de la pagina para que conecte mejor.", rationale: "Suena flojo.", targetPageOrComponent: STAGING_URL }],
        };
        const item = plan({ spec: noDirectives }).items[0];
        assert.equal(item.applyStatus, "requires_manual_staging_implementation");
        assert.equal(item.applyCapability.supported, false);
        assert.match(item.applyCapability.reason, /formato ejecutable/i);
      },
    },
    {
      name: "Sin especificacion de web-engineer no hay nada ejecutable",
      fn: () => {
        const item = plan({ spec: null }).items[0];
        assert.equal(item.applyStatus, "requires_manual_staging_implementation");
        assert.match(item.applyCapability.reason, /Sin especificacion/i);
      },
    },
    {
      name: "Una pagina de staging SIN URL publica no es destino valido: no seria revisable desde el movil",
      fn: () => {
        const item = plan({ pages: [{ wordpressPageId: 2091, stagingUrl: "" }] }).items[0];
        assert.equal(item.applyStatus, "requires_manual_staging_implementation");
      },
    },
    {
      name: "Una recomendacion bloqueada por QA nunca llega a plantearse: `blocked`",
      fn: () => {
        const item = plan({
          promotion: promotion({ promoted: [], blocked: [recommendation({ decision: "blocked", blockedBy: ["QA la bloqueo"] })] }),
        }).items[0];
        assert.equal(item.applyStatus, "blocked");
        assert.equal(item.applyCapability.supported, false);
        assert.equal(item.qaStatus, "BLOCKED");
      },
    },
    {
      name: "Una especificacion que cita dos paginas distintas es ambigua: fail-closed",
      fn: () => {
        const ambiguous: WebEngineerOutput = {
          ...SPEC,
          proposedChanges: [
            {
              description: "Cambiar page_id=2091 y tambien page_id=2103.\nTITLE: Uno\nMETA: Dos",
              rationale: "r",
              targetPageOrComponent: STAGING_URL,
            },
          ],
        };
        const item = plan({
          spec: ambiguous,
          pages: [...OWNED_PAGES, { wordpressPageId: 2103, stagingUrl: "https://staging.zentrylockers.com/taquillas-inteligentes/" }],
        }).items[0];
        assert.equal(item.applyStatus, "requires_manual_staging_implementation");
        assert.match(item.applyCapability.reason, /UN destino/i);
      },
    },

    // --- Puerta de aprobacion sobre el registro comun del proyecto ---
    {
      name: "Sin solicitud registrada, la aprobacion humana es `none` y nunca autoriza produccion",
      fn: () => {
        const approval = resolveHumanApproval({ relatedId: CHANGE_ID, requests: [], now: NOW });
        assert.equal(approval.status, "none");
        assert.match(approval.reason, /no es una aprobacion/i);
      },
    },
    {
      name: "pending / snoozed nunca son aprobacion",
      fn: () => {
        for (const status of ["pending", "snoozed"]) {
          assert.equal(resolveHumanApproval({ relatedId: CHANGE_ID, requests: [request({ status })], now: NOW }).status, "pending");
        }
      },
    },
    {
      name: "rejected / cancelled / expired nunca son aprobacion",
      fn: () => {
        for (const status of ["rejected", "cancelled", "expired"]) {
          assert.equal(resolveHumanApproval({ relatedId: CHANGE_ID, requests: [request({ status })], now: NOW }).status, "rejected");
        }
      },
    },
    {
      name: "Una aprobacion caducada deja de valer",
      fn: () => {
        const old = request({ answeredAt: new Date(NOW.getTime() - (APPROVAL_VALIDITY_HOURS + 1) * 3600_000).toISOString() });
        assert.equal(resolveHumanApproval({ relatedId: CHANGE_ID, requests: [old], now: NOW }).status, "rejected");
      },
    },
    {
      name: "Una aprobacion sin autor no se acepta: `unknown` (que bloquea)",
      fn: () => {
        assert.equal(resolveHumanApproval({ relatedId: CHANGE_ID, requests: [request({ answeredBy: "" })], now: NOW }).status, "unknown");
      },
    },
    {
      name: "Dos solicitudes para el mismo cambio -> `unknown`: no se elige la mejor",
      fn: () => {
        const approval = resolveHumanApproval({
          relatedId: CHANGE_ID,
          requests: [request({ approvalRequestId: "a" }), request({ approvalRequestId: "b" })],
          now: NOW,
        });
        assert.equal(approval.status, "unknown");
      },
    },
    {
      name: "Un status desconocido en el registro comun -> `unknown` (fail-closed)",
      fn: () => {
        assert.equal(resolveHumanApproval({ relatedId: CHANGE_ID, requests: [request({ status: "vete-a-saber" })], now: NOW }).status, "unknown");
      },
    },
    {
      name: "La aprobacion se busca por changeId: la de OTRA version no sirve",
      fn: () => {
        const otherVersion = request({ relatedId: `${RUN_ID}#change-1-v2` });
        assert.equal(resolveHumanApproval({ relatedId: CHANGE_ID, requests: [otherVersion], now: NOW }).status, "none");
      },
    },
    {
      name: "Una aprobacion de otro tipo de solicitud del proyecto no cuenta como aprobacion de un cambio",
      fn: () => {
        const otherType = request({ relatedType: "change_pack" });
        assert.equal(resolveHumanApproval({ relatedId: CHANGE_ID, requests: [otherType], now: NOW }).status, "none");
      },
    },
    {
      name: "Una aprobacion valida y vigente se reconoce, con autor y fecha reales",
      fn: () => {
        const approval = resolveHumanApproval({ relatedId: CHANGE_ID, requests: [request()], now: NOW });
        assert.equal(approval.status, "approved");
        assert.equal(approval.approvalRequestId, "req-1");
        assert.equal(approval.answeredBy, "telegram");
      },
    },
  ];
}
