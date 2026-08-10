import {
  parseTelegramCommand,
  deriveShortId,
  resolveApprovalRequestByIdOrRelatedId,
  isApprovalExpired,
  APPROVAL_EXPIRY_HOURS,
} from "../src/agents/telegram-approval-receiver";
import { ApprovalRequest } from "../src/core/types";

/**
 * Test de solo logica (Fase O13.2b): NUNCA llama a Telegram, NUNCA lee
 * ni escribe ningun fichero de data/ real -- solo ejercita las
 * funciones puras de parsing/resolucion/expiracion contra datos
 * sinteticos en memoria. Seguro de ejecutar en cualquier momento, no
 * toca WordPress ni produccion.
 */

let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL: ${label} -- esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
  }
}

function makeRequest(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    approvalRequestId: "req-aaaa1111-0000-0000-0000-000000000000",
    relatedType: "staging_execution",
    relatedId: "staging-exec-bbbb2222-0000-0000-0000-000000000000",
    title: "Test",
    summary: "Test summary",
    riskLevel: "high",
    requestedAction: "Test action",
    options: ["approved", "rejected", "snoozed"],
    status: "pending",
    channel: "telegram",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

console.log("=== 1) parseTelegramCommand ===");
assertEqual(parseTelegramCommand("approve 310db20b-9270-4139-b155-3f9a1e34e9a6"), { type: "approve", id: "310db20b-9270-4139-b155-3f9a1e34e9a6" }, "approve <uuid>");
assertEqual(parseTelegramCommand("Approve prod-exec-453dd22a-2bc0-4b98-8695-40774bff38bc"), { type: "approve", id: "prod-exec-453dd22a-2bc0-4b98-8695-40774bff38bc" }, "Approve <prod-exec-id> (mayusculas)");
assertEqual(parseTelegramCommand("reject staging-exec-c419f90b-54b2-4b1a-8fb0-97c68b7b783c"), { type: "reject", id: "staging-exec-c419f90b-54b2-4b1a-8fb0-97c68b7b783c" }, "reject <staging-exec-id>");
assertEqual(parseTelegramCommand("APROBAR PRODUCCION 453dd22a"), { type: "confirm_production", shortId: "453dd22a" }, "APROBAR PRODUCCION <shortId>");
assertEqual(parseTelegramCommand("aprobar produccion 453dd22a"), { type: "confirm_production", shortId: "453dd22a" }, "aprobar produccion (minusculas)");
assertEqual(parseTelegramCommand("hola que tal"), null, "texto sin comando -> null");
assertEqual(parseTelegramCommand("approve"), null, "approve sin id -> null");
assertEqual(parseTelegramCommand(""), null, "texto vacio -> null");

console.log("");
console.log("=== 2) deriveShortId ===");
assertEqual(deriveShortId("prod-exec-453dd22a-2bc0-4b98-8695-40774bff38bc"), "453dd22a", "shortId de prod-exec-...");
assertEqual(deriveShortId("prod-deploy-326ef325-d985-47ff-9836-bf556d2007a3"), "326ef325", "shortId de prod-deploy-...");
assertEqual(deriveShortId("310db20b-9270-4139-b155-3f9a1e34e9a6"), "310db20b", "shortId de approvalRequestId directo");

console.log("");
console.log("=== 3) resolveApprovalRequestByIdOrRelatedId ===");
const reqA = makeRequest({ approvalRequestId: "req-A", relatedId: "staging-exec-A" });
const reqB = makeRequest({ approvalRequestId: "req-B", relatedId: "prod-exec-B" });
const current = [reqA, reqB];

assertEqual(resolveApprovalRequestByIdOrRelatedId("req-A", current), { request: reqA, ambiguous: false }, "resolver por approvalRequestId directo");
assertEqual(resolveApprovalRequestByIdOrRelatedId("staging-exec-A", current), { request: reqA, ambiguous: false }, "resolver por relatedId (staging-exec-)");
assertEqual(resolveApprovalRequestByIdOrRelatedId("prod-exec-B", current), { request: reqB, ambiguous: false }, "resolver por relatedId (prod-exec-)");
assertEqual(resolveApprovalRequestByIdOrRelatedId("no-existe", current), { ambiguous: false }, "id inexistente -> sin match");

const reqC1 = makeRequest({ approvalRequestId: "req-C1", relatedId: "shared-related-id" });
const reqC2 = makeRequest({ approvalRequestId: "req-C2", relatedId: "shared-related-id" });
assertEqual(resolveApprovalRequestByIdOrRelatedId("shared-related-id", [reqC1, reqC2]), { ambiguous: true }, "relatedId duplicado -> ambiguo");

console.log("");
console.log("=== 4) isApprovalExpired ===");
const now = Date.now();
const freshRequest = makeRequest({ createdAt: new Date(now - 1000 * 60 * 60).toISOString() }); // 1h ago
const oldRequest = makeRequest({ createdAt: new Date(now - (APPROVAL_EXPIRY_HOURS + 1) * 60 * 60 * 1000).toISOString() }); // > 72h ago
assertEqual(isApprovalExpired(freshRequest, now), false, "solicitud de hace 1h no esta expirada");
assertEqual(isApprovalExpired(oldRequest, now), true, `solicitud de hace mas de ${APPROVAL_EXPIRY_HOURS}h SI esta expirada`);

console.log("");
console.log(`=== Resultado: ${passed} PASS / ${failed} FAIL ===`);
console.log("Ninguna llamada de red se ha hecho. Ningun fichero de data/ real se ha tocado. Produccion intacta.");

if (failed > 0) {
  process.exit(1);
}
