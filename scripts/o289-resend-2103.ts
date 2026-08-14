import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressPage } from "../src/adapters/wordpress";
import { findApprovalRequestById } from "../src/core/approval-requests";
import { sendTelegramApprovalRequest } from "../src/core/telegram-gateway";
import { findStagingReviewPage, readCurrentStagingReviewPages } from "../src/core/staging-review-pages";

/**
 * Fase O28.9 -- reenvia el mensaje de revision de 2103 (mismo
 * approvalRequestId ya existente, sigue pendiente y con datos
 * correctos -- no se crea una solicitud duplicada, solo se vuelve a
 * mandar el mensaje para que quede visible al final del chat, sin
 * confundirse con el mensaje antiguo de 2096 ya cancelado). Vuelve a
 * confirmar en vivo status=publish y el permalink real ANTES de
 * mandarlo, por si algo hubiera cambiado desde O28.7.
 *
 * Uso: npx ts-node scripts/o289-resend-2103.ts
 */

const APPROVAL_REQUEST_ID = "15088183-ea58-403c-85b3-3481ec58ab85";
const WORDPRESS_PAGE_ID = 2103;

async function main(): Promise<void> {
  const request = findApprovalRequestById(APPROVAL_REQUEST_ID);
  if (!request) {
    console.log("No se encontro la solicitud original, abortando.");
    return;
  }
  if (request.status !== "pending") {
    console.log(`La solicitud ya no esta pendiente (status: "${request.status}") -- no se reenvia.`);
    return;
  }

  const page = await getWordpressPage(WORDPRESS_PAGE_ID);
  if (page.status !== "publish") {
    console.log(`Pagina ${WORDPRESS_PAGE_ID} tiene status "${page.status}" (no "publish") -- no se reenvia con un enlace que no es publico.`);
    return;
  }
  console.log(`Confirmado en vivo: status=publish, link=${page.link}`);

  const reviewRecord = findStagingReviewPage(WORDPRESS_PAGE_ID, readCurrentStagingReviewPages());

  await sendTelegramApprovalRequest({
    approvalRequestId: request.approvalRequestId,
    relatedType: request.relatedType,
    title: request.title,
    summary: request.summary,
    riskLevel: request.riskLevel,
    requestedAction: request.requestedAction,
    options: request.options,
    stagingUrl: page.link,
    pageType: reviewRecord?.pageType ?? "new_page_candidate",
    onApproveText: "Se marcara como visually_approved. No se publicara en produccion.",
    onRejectText: "Te pedire el motivo y volvera a revision.",
  });
  console.log("Reenviado por Telegram con el enlace publico confirmado.");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
