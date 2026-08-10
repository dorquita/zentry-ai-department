import { setActionStatus, findActionById } from "../src/core/action-backlog";
import { setApprovalRequestStatus, findApprovalRequestById } from "../src/core/approval-requests";

/**
 * Fase O27 — limpieza puntual y documentada del backlog, resultado de la
 * auditoria de esta fase (no un cleanup generico/automatico -- cada
 * cambio de abajo tiene una justificacion concreta, verificada contra
 * WordPress real antes de escribir aqui). Usa EXCLUSIVAMENTE las
 * funciones ya existentes (setActionStatus/setApprovalRequestStatus) --
 * nunca edita un .jsonl a mano, nunca borra una linea existente (son
 * logs append-only).
 *
 * Uso:
 *   npx ts-node scripts/o27-backlog-cleanup.ts             (dry-run: imprime que haria, no escribe nada)
 *   npx ts-node scripts/o27-backlog-cleanup.ts --confirm    (escribe de verdad)
 */

interface CleanupItem {
  kind: "action" | "approvalRequest";
  id: string;
  newStatus: string;
  reason: string;
}

const ITEMS: CleanupItem[] = [
  // --- "cerraduras inteligentes para taquillas" (pagina 1865, /cerraduras-inteligentes-taquillas/) ---
  // Verificado contra WordPress produccion (2026-08-10): la pagina 1865
  // SIGUE VIVA (creada 2026-07-03, modificada 2026-08-08) y compite por
  // las mismas keywords que la landing real de O22 (pagina 2060,
  // /cerraduras-para-taquillas/, creada 2026-08-08). La oportunidad NO
  // esta resuelta por O22 -- cambio de naturaleza: de "falta una pagina"
  // a "hay 2 paginas compitiendo por el mismo tema, hay que decidir
  // fusionar/diferenciar/redirigir". Es una decision de PRODUCCION (toca
  // paginas ya publicadas) -- pasa a waiting_approval en vez de seguir
  // generando previews en bucle como auto_approved_for_planning.
  { kind: "action", id: "19599263-9e05-4bca-8d6a-761cf54f3aad", newStatus: "waiting_approval", reason: "cerraduras-inteligentes-taquillas (1865) vs cerraduras-para-taquillas (2060, O22): decision de fusion/diferenciacion pendiente de Pau, no repetir como auto-planificable" },
  { kind: "action", id: "4bdbbe6e-743a-40df-822f-615935e57cfa", newStatus: "waiting_approval", reason: "idem — misma pagina 1865, work order de content:title_meta_improvement" },
  { kind: "action", id: "ef7a3825-b95f-4942-a4dc-46faed0d825e", newStatus: "waiting_approval", reason: "idem — misma pagina 1865, work order de content:internal_link" },
  { kind: "action", id: "1a0e540c-8785-482b-9be2-217c5d6fe818", newStatus: "waiting_approval", reason: "idem — misma pagina 1865, work order de seo:quick_win" },
  { kind: "action", id: "b764c03e-3b88-441f-aa88-117d45d97e21", newStatus: "waiting_approval", reason: "idem — misma pagina 1865, work order de cro:landing_review" },

  // --- "cerraduras inteligentes para centros deportivos" (pagina objetivo /cerraduras/, id 1751) ---
  // Verificado contra WordPress produccion (2026-08-10): la pagina 1751
  // esta en TRASH (trashed durante O22, con redireccion 301 real hacia
  // 2060 -- ver docs/o22 memoria de cierre). La oportunidad apunta a una
  // pagina que ya no existe como pagina editable -- seguir proponiendo
  // cambios sobre esa URL es trabajar sobre un objetivo obsoleto. Se
  // aplaza (snoozed) hasta decidir el objetivo real (2060 ampliada, o
  // una pagina nueva especifica para centros deportivos).
  { kind: "action", id: "bd11d934-13ec-430b-9a1e-21bd47e65358", newStatus: "snoozed", reason: "pagina objetivo /cerraduras/ (1751) esta en TRASH con 301 a 2060 desde O22 -- oportunidad obsoleta, necesita retarget antes de seguir" },
  { kind: "action", id: "1ca5c03b-b4f4-4a1c-a0fd-08f12f8be719", newStatus: "snoozed", reason: "idem — content:new_landing sobre la misma pagina obsoleta" },
  { kind: "action", id: "fb468529-c5ca-4e2b-bdcb-3e8570707fa7", newStatus: "snoozed", reason: "idem — content:title_meta_improvement sobre la misma pagina obsoleta" },
  { kind: "action", id: "6eaea17e-d61c-4dde-b06c-fc4d355d4de8", newStatus: "snoozed", reason: "idem — cro:landing_review sobre la misma pagina obsoleta" },

  // --- "Plan de deploy a produccion: taquillas escolares" duplicado en Telegram ---
  // Verificado (2026-08-10): production-deployment-plans.jsonl solo
  // tiene UN plan real para esta pagina (prod-deploy-326ef325-...),
  // status applied_to_production_draft (ya se ejecuto de verdad via la
  // aprobacion de EJECUCION 310db20b, approved el 2026-08-05). Las DOS
  // solicitudes de aprobacion de DISENO de plan (relatedType
  // production_deployment_plan) siguen en status "pending" porque nunca
  // se respondieron explicitamente -- quedaron huerfanas cuando el
  // deploy avanzo igualmente por la via de ejecucion. Se cancelan las 2
  // (nunca se tocan/cambian datos de WordPress, solo el registro de
  // aprobacion) para que Telegram deje de mostrarlas como pendientes.
  { kind: "approvalRequest", id: "3acc448b-a30a-452d-9d90-a1e66523da65", newStatus: "cancelled", reason: "duplicado huerfano — el deploy de taquillas escolares ya se aplico de verdad (ver approval 310db20b, applied_to_production_draft); esta solicitud de diseno de plan quedo obsoleta y nunca se resolvio" },
  { kind: "approvalRequest", id: "79b2732a-22b7-4613-a56b-3b6cbaa9fff5", newStatus: "cancelled", reason: "idem — segunda copia duplicada de la misma decision, mismo motivo" },
];

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  console.log(`Fase O27 — limpieza de backlog. Modo: ${confirm ? "ESCRITURA REAL" : "DRY-RUN"}.\n`);

  for (const item of ITEMS) {
    if (item.kind === "action") {
      const existing = findActionById(item.id);
      if (!existing) {
        console.log(`[SKIP] action ${item.id} no encontrada.`);
        continue;
      }
      console.log(`[action] ${item.id} "${existing.keyword}" — ${existing.status} -> ${item.newStatus}`);
      console.log(`  razon: ${item.reason}`);
      if (confirm) {
        const updated = setActionStatus(item.id, item.newStatus as never, "o27-backlog-cleanup");
        console.log(`  escrito: ${Boolean(updated)}`);
      }
    } else {
      const existing = findApprovalRequestById(item.id);
      if (!existing) {
        console.log(`[SKIP] approvalRequest ${item.id} no encontrada.`);
        continue;
      }
      console.log(`[approvalRequest] ${item.id} "${existing.title}" — ${existing.status} -> ${item.newStatus}`);
      console.log(`  razon: ${item.reason}`);
      if (confirm) {
        const updated = setApprovalRequestStatus(item.id, item.newStatus as never, {
          reason: item.reason,
          answeredBy: "o27-backlog-cleanup",
        });
        console.log(`  escrito: ${Boolean(updated)}`);
      }
    }
    console.log("");
  }

  if (!confirm) {
    console.log("Repite con --confirm para escribir de verdad. Nada de esto toca WordPress/staging/produccion -- solo el estado interno del backlog/aprobaciones.");
  }
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
