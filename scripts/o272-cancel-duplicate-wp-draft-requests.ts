import { setApprovalRequestStatus, findApprovalRequestById } from "../src/core/approval-requests";

/**
 * Fase O27.2 -- cancela las 6 solicitudes de aprobacion "Crear borrador
 * WordPress" (relatedType change_pack) generadas por el WordPress Draft
 * Agent en el pase del 2026-08-10T13:21Z, ANTES de que se corrigiera el
 * bug real (ver commit del fix en wordpress-draft-agent.ts): con
 * STAGING_EXECUTION_ENABLED=true Y WORDPRESS_DRAFTS_ENABLED=true a la
 * vez, este agente generaba una SEGUNDA solicitud de Telegram para el
 * mismo change pack que el Staging Executor (Carril A) ya habia aplicado
 * o iba a aplicar. Los 6 change packs de estas solicitudes YA estan
 * `applied_to_staging` via Staging Executor -- no hace falta ninguna
 * accion sobre ellos, la solicitud es pura duplicacion.
 *
 * Uso: npx ts-node scripts/o272-cancel-duplicate-wp-draft-requests.ts
 */

const IDS = [
  "064b4b5c-3b9d-4dc2-9fd9-01cbebcd463a",
  "50a9acb2-3eef-4472-84d8-87a629c8cfdf",
  "687b6cd1-7fd6-4138-ac24-a48597798b2f",
  "af3e8116-7675-4788-999d-a54007922f01",
  "d0d22e98-f9ac-43db-8eed-7cd5d8ff7223",
  "73c28bb1-6d93-4a5f-9a3d-ea069431fc7c",
];

const REASON =
  "O27.2: duplicado del Staging Executor (Carril A) -- el change pack de origen ya esta applied_to_staging por esa via oficial. Bug corregido en wordpress-draft-agent.ts (ya no se genera esta segunda solicitud mientras STAGING_EXECUTION_ENABLED=true).";

function main(): void {
  for (const id of IDS) {
    const existing = findApprovalRequestById(id);
    if (!existing) {
      console.log(`[SKIP] ${id} no encontrada.`);
      continue;
    }
    const updated = setApprovalRequestStatus(id, "cancelled", { reason: REASON, answeredBy: "o272-cleanup" });
    console.log(`${id} "${existing.title}" -> ${updated?.status} : ${Boolean(updated)}`);
  }
}

main();
