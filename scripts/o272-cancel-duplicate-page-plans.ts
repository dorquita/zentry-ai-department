import { setDeploymentPlanStatus } from "../src/core/production-deployment-plans";
import { setApprovalRequestStatus, findAnyRequestByRelatedId, readCurrentApprovalRequests } from "../src/core/approval-requests";

/**
 * Fase O27.2 -- limpieza retroactiva de 4 planes de deploy duplicados por
 * PAGINA REAL (no por canonicalKey -- ese caso ya lo cubre el fix de
 * O27, este es un caso nuevo: 4 paginas recibieron un SEGUNDO change pack
 * -content_update- el mismo dia que ya tenian un plan de deploy
 * -seo_on_page_update- sin resolver desde el batch de O27.1). El fix de
 * codigo (dedup tambien por pagina) ya esta aplicado en
 * production-deployment-planner.ts -- esto solo limpia los 4 que se
 * crearon ANTES del fix, en la misma pasada donde se detecto el bug.
 *
 * Se cancela el plan MAS RECIENTE de cada par (el duplicado nuevo),
 * dejando el original de O27.1 (el que Pau ya vio en el primer email)
 * como la unica decision activa por pagina.
 *
 * Uso: npx ts-node scripts/o272-cancel-duplicate-page-plans.ts
 */

const DUPLICATE_PLAN_IDS = [
  "prod-deploy-4d5d1ffa-6cf5-4334-ae9f-68611e493023", // taquillas-melamina/, duplica prod-deploy-aed5cbe3
  "prod-deploy-fde8bb5d-6570-4777-ac19-e4786130ecfc", // taquillas-para-colegios/, duplica prod-deploy-f2cf576f
  "prod-deploy-423e12fb-0bba-436c-8f84-9b63364fd4bd", // taquillas-para-empresas/, duplica prod-deploy-b9b6c9c6
  "prod-deploy-f0ca8c6c-9975-4b7b-8b58-5896e5f12d79", // taquillas-fenolicas/, duplica prod-deploy-79755187
];

const REASON =
  "O27.2: duplicado -- ya existia un plan de deploy sin resolver para la misma pagina real (de O27.1). Bug corregido en production-deployment-planner.ts (dedup ahora tambien por pagina, no solo por canonicalKey).";

function main(): void {
  const currentRequests = readCurrentApprovalRequests();
  for (const planId of DUPLICATE_PLAN_IDS) {
    const updatedPlan = setDeploymentPlanStatus(planId, "cancelled", {});
    console.log(`plan ${planId} -> ${updatedPlan?.status ?? "NO ENCONTRADO"}`);

    const request = findAnyRequestByRelatedId(planId, currentRequests);
    if (request && request.status === "pending") {
      const updatedRequest = setApprovalRequestStatus(request.approvalRequestId, "cancelled", {
        reason: REASON,
        answeredBy: "o272-cleanup",
      });
      console.log(`  approvalRequest ${request.approvalRequestId} -> ${updatedRequest?.status}`);
    } else if (request) {
      console.log(`  approvalRequest ${request.approvalRequestId} ya estaba en status "${request.status}", sin cambios.`);
    } else {
      console.log("  sin approvalRequest asociada.");
    }
  }
}

main();
