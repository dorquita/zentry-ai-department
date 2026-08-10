import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressPage, publishStagingDraftPage } from "../src/adapters/wordpress";
import { recordStagingReviewPage } from "../src/core/staging-review-pages";
import { upsertApprovalRequest, readCurrentApprovalRequests, markApprovalRequestSent } from "../src/core/approval-requests";
import { isTelegramApprovalsEnabled, sendTelegramApprovalRequest } from "../src/core/telegram-gateway";

/**
 * Fase O28.7 -- publica la pagina 2103 (taquillas inteligentes, ya
 * corregida en O28.6) con status=publish EN STAGING UNICAMENTE, para que
 * Pau pueda revisarla desde un enlace publico real sin necesitar sesion
 * en wp-admin. Nunca toca produccion (publishStagingDraftPage vive en
 * src/adapters/wordpress.ts, que no conoce credenciales de produccion).
 * Registra internamente la marca "pagina de revision" (WordPress no
 * expone meta personalizado sin tocar el tema, fuera de alcance) y crea
 * + envia una solicitud de aprobacion de Telegram dedicada
 * (relatedType: "staging_review_page", relatedId = el propio
 * wordpressPageId, sin ambiguedad).
 *
 * Uso: npx ts-node scripts/o287-publish-2103-for-review.ts
 */

const WORDPRESS_PAGE_ID = 2103;
const KEYWORD = "taquillas inteligentes";

async function main(): Promise<void> {
  const before = await getWordpressPage(WORDPRESS_PAGE_ID);
  if (before.status !== "draft") {
    console.log(`Pagina ${WORDPRESS_PAGE_ID} tiene status "${before.status}" (no "draft") -- no se publica de nuevo.`);
    return;
  }

  const result = await publishStagingDraftPage(WORDPRESS_PAGE_ID);
  console.log(`Publicada en staging: ${result.link} (status: ${result.status})`);

  const reviewRecord = recordStagingReviewPage({
    wordpressPageId: WORDPRESS_PAGE_ID,
    keyword: KEYWORD,
    publicUrl: result.link,
    pageType: "new_page_candidate",
  });
  console.log("Registrada internamente como pagina de revision:", reviewRecord);

  const current = readCurrentApprovalRequests();
  const { request, isNew } = upsertApprovalRequest(
    {
      relatedType: "staging_review_page",
      relatedId: String(WORDPRESS_PAGE_ID),
      title: "Taquillas inteligentes",
      summary:
        "Pagina corregida con contenido especifico sobre taquillas inteligentes, PIN, RFID/tarjeta, app, gestion remota, logs, apertura remota y cuando conviene una cerradura inteligente frente a una mecanica.",
      riskLevel: "low_medium",
      requestedAction: "Revisar visualmente en staging y aprobar o rechazar.",
      options: ["approve", "reject"],
      channel: "telegram",
    },
    current
  );
  console.log(`approvalRequestId: ${request.approvalRequestId} (isNew: ${isNew})`);

  if (!isTelegramApprovalsEnabled()) {
    console.log("TELEGRAM_APPROVALS_ENABLED != true -- no se envia nada por Telegram.");
    return;
  }

  await sendTelegramApprovalRequest({
    approvalRequestId: request.approvalRequestId,
    relatedType: request.relatedType,
    title: request.title,
    summary: request.summary,
    riskLevel: request.riskLevel,
    requestedAction: request.requestedAction,
    options: request.options,
    stagingUrl: result.link,
    pageType: "new_page_candidate",
    onApproveText: "Se marcara como visually_approved. No se publicara en produccion.",
    onRejectText: "Te pedire el motivo y volvera a revision.",
  });
  markApprovalRequestSent(request.approvalRequestId, "telegram");
  console.log("Enviado por Telegram.");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
