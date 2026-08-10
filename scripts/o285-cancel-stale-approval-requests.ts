import * as dotenv from "dotenv";
dotenv.config();
import { setApprovalRequestStatus, readCurrentApprovalRequests } from "../src/core/approval-requests";

/**
 * Fase O28.5 -- cancela las solicitudes de aprobacion de Telegram
 * "pending" que quedaron ligadas a los 11 planes de deploy marcados
 * needs_revalidation (ver scripts/o285-revalidate-stale-plans.ts). Sin
 * este paso, ahora que 10 de esas 11 paginas SI estan visually_approved,
 * el filtro de growth-director.ts las dejaria pasar como "decision
 * necesaria de Pau" -- pidiendole aprobar un plan cuyo seoMeta/checklist
 * ya no describen la pagina real. Cancelarlas es coherente con el
 * estado del plan: no se pierde nada (quedan en el log append-only),
 * simplemente dejan de estar activas.
 *
 * Uso: npx ts-node scripts/o285-cancel-stale-approval-requests.ts
 */

const STALE_PLAN_IDS = [
  "prod-deploy-586680a1-ce7f-4cd1-b8c1-03c6c042ee4e",
  "prod-deploy-7287a503-d389-4357-990f-49498343c1a5",
  "prod-deploy-bbae0739-4234-47d5-924b-225dfb0e3452",
  "prod-deploy-8715c7d9-5574-438d-830b-2edb38f9a9a6",
  "prod-deploy-e7f369bc-3a00-43c8-a6fe-1d79d2091bd1",
  "prod-deploy-59dd8f78-a82e-4aab-8834-7126039d90ea",
  "prod-deploy-9502dbf9-faa4-49d4-ba05-609ca2ab1ed5",
  "prod-deploy-edbc1b72-96c7-4b3c-9b98-356ee4a77e70",
  "prod-deploy-8b85d024-bc40-4259-9211-8c068edcb35b",
  "prod-deploy-eb11d4ba-0205-4ecb-8261-b5484d3e452d",
  "prod-deploy-4651a9fc-7922-48c9-ac35-e7fff4345660",
];

const REASON = "O28.5: plan asociado marcado needs_revalidation (datos desactualizados) -- se cancela la solicitud, se creara una nueva cuando exista un plan valido.";

function main(): void {
  const current = readCurrentApprovalRequests();
  let cancelled = 0;
  for (const planId of STALE_PLAN_IDS) {
    const request = current.find((r) => r.relatedId === planId && r.status === "pending");
    if (!request) {
      console.log(`[SKIP] ${planId}: sin solicitud pendiente asociada.`);
      continue;
    }
    const updated = setApprovalRequestStatus(request.approvalRequestId, "cancelled", { reason: REASON, answeredBy: "o285-cleanup" });
    console.log(`[OK] ${request.approvalRequestId} (${planId}) -> ${updated?.status}`);
    cancelled += 1;
  }
  console.log(`\nCanceladas: ${cancelled}.`);
}

main();
