import * as dotenv from "dotenv";
dotenv.config();
import { readCurrentApprovalRequests, upsertApprovalRequest, markApprovalRequestSent } from "../src/core/approval-requests";
import { isTelegramApprovalsEnabled, sendTelegramApprovalRequest } from "../src/core/telegram-gateway";

/**
 * Fase O28.9 -- solicitud 100% sintetica para que Pau pruebe el flujo de
 * RECHAZO de verdad. relatedId inventado (no coincide con ningun
 * change pack/staging execution/pagina real), relatedType "change_pack"
 * (categoria staging_review, riskLevel low_medium -- nunca dispara el
 * flujo de doble confirmacion critica). Rechazar esto NUNCA toca
 * WordPress ni produccion: no hay ninguna pagina real asociada.
 *
 * Uso: npx ts-node scripts/o289-test-reject-flow.ts
 */
async function main(): Promise<void> {
  const current = readCurrentApprovalRequests();
  const relatedId = `test-o289-reject-${Date.now()}`;

  const { request, isNew } = upsertApprovalRequest(
    {
      relatedType: "change_pack",
      relatedId,
      title: "Prueba de rechazo Telegram",
      summary: "Prueba de rechazo Telegram -- no afecta a ninguna pagina real. Sirve para comprobar que el boton Rechazar responde al instante, pide motivo y guarda el feedback.",
      riskLevel: "low_medium",
      requestedAction: "Ninguna -- solo prueba del flujo de rechazo.",
      options: ["approve", "reject"],
      channel: "telegram",
    },
    current
  );
  console.log(`approvalRequestId: ${request.approvalRequestId} (isNew: ${isNew}, relatedId sintetico: ${relatedId})`);

  if (!isTelegramApprovalsEnabled()) {
    console.log("TELEGRAM_APPROVALS_ENABLED != true -- no se envia nada por Telegram.");
    return;
  }

  // Sin stagingUrl a proposito -- es una prueba sintetica, no hay
  // pagina real que "ver", asi que solo salen los 2 botones pedidos.
  await sendTelegramApprovalRequest({
    approvalRequestId: request.approvalRequestId,
    relatedType: request.relatedType,
    title: request.title,
    summary: request.summary,
    riskLevel: request.riskLevel,
    requestedAction: request.requestedAction,
    options: request.options,
    onApproveText: "Solo marcaria esta prueba sintetica como aprobada -- sin ningun efecto real.",
    onRejectText: "Te pedire un motivo de prueba, lo guardo como feedback, y esta solicitud sintetica queda rechazada. Nunca toca WordPress ni produccion.",
  });
  markApprovalRequestSent(request.approvalRequestId, "telegram");
  console.log("Enviado por Telegram. Pulsa ❌ Rechazar cuando quieras probarlo.");
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
