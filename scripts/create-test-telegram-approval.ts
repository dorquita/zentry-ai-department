import * as dotenv from "dotenv";
dotenv.config();
import { readCurrentApprovalRequests, upsertApprovalRequest, markApprovalRequestSent } from "../src/core/approval-requests";
import { isTelegramApprovalsEnabled, sendTelegramApprovalRequest } from "../src/core/telegram-gateway";

/**
 * Fase O13.2b (prueba en vivo): crea una ApprovalRequest 100% sintetica
 * y sin efecto real -- relatedId inventado (no coincide con ningun
 * change pack/staging execution/production plan real, asi que aunque se
 * apruebe nunca desbloqueara nada de verdad), relatedType "change_pack"
 * (evita el rechazo por "requiere CLI" que aplica a action/work_order),
 * riskLevel "low_medium" (evita el flujo de doble confirmacion critica).
 * Solo para probar el circuito approve/reject por Telegram end-to-end.
 */
async function main(): Promise<void> {
  const current = readCurrentApprovalRequests();
  const relatedId = `test-o132b-${Date.now()}`;

  const { request, isNew } = upsertApprovalRequest(
    {
      relatedType: "change_pack",
      relatedId,
      title: "[PRUEBA] Telegram Approval Receiver — sin efecto real",
      summary:
        "Solicitud de prueba (Fase O13.2b) para verificar el circuito approve/reject por Telegram. No corresponde a ningun change pack real; aprobar o rechazar esto no publica, no ejecuta ni modifica nada en WordPress/produccion.",
      riskLevel: "low_medium",
      requestedAction: "Ninguna -- solo prueba del receptor de Telegram.",
      options: ["approve", "reject"],
      channel: "telegram",
    },
    current
  );

  console.log(`approvalRequestId: ${request.approvalRequestId}`);
  console.log(`relatedId (sintetico, no real): ${request.relatedId}`);
  console.log(`isNew: ${isNew}`);

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
    stagingUrl: "https://staging.zentrylockers.com/?page_id=2111",
    pageType: "update_existing_page",
    productionUrl: "https://zentrylockers.com/taquillas-para-hoteles/",
  });
  markApprovalRequestSent(request.approvalRequestId, "telegram");
  console.log("Enviado por Telegram y marcado como sentAt.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
