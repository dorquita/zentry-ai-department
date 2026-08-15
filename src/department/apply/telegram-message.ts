import { DepartmentChangeRequest } from "./change-types";
// Se importa de `version-compare` y NO de `./version`: este modulo lo
// usa el Worker de Cloudflare, y `./version` arrastra `node:crypto`, que
// alli no existe. `version.ts` reexporta esta misma funcion, asi que no
// hay dos implementaciones.
import { shortHash } from "../../approvals/version-compare";

/**
 * MENSAJES DE TELEGRAM del flujo de aprobacion del departamento.
 *
 * Modulo PURO: construye textos y botones a partir de lo que el cambio
 * REALMENTE tiene registrado. No envia nada, no lee ficheros, no conoce
 * ninguna credencial -- asi se puede testear entero, y asi es imposible
 * que un mensaje "invente" una URL o un before/after que no salio de un
 * apply real.
 *
 * Criterio de redaccion (pedido explicitamente): util desde el MOVIL. Ni
 * mensajes kilometricos ni volcados de JSON. Lo imprescindible para
 * decidir, y un boton para ver el detalle si hace falta.
 */

/** `callback_data` de Telegram tiene un limite duro de 64 bytes. */
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;

export type DepartmentCallbackAction = "approve" | "reject" | "view";

/**
 * Prefijo propio (`dept:`) para no colisionar con el flujo de
 * aprobaciones existente (`appr:`), que sigue funcionando igual para el
 * resto de tipos de solicitud.
 */
export function buildCallbackData(action: DepartmentCallbackAction, approvalRequestId: string): string {
  return `dept:${action}:${approvalRequestId}`;
}

export interface ParsedDepartmentCallback {
  action: DepartmentCallbackAction;
  approvalRequestId: string;
}

export function parseDepartmentCallbackData(data: string): ParsedDepartmentCallback | null {
  const match = /^dept:(approve|reject|view):(.+)$/.exec(String(data ?? ""));
  if (!match) return null;
  return { action: match[1] as DepartmentCallbackAction, approvalRequestId: match[2] };
}

/** `true` si el callback_data cabe en el limite de Telegram. Se comprueba ANTES de enviar, nunca despues. */
export function isCallbackDataWithinLimit(data: string): boolean {
  // TextEncoder y no Buffer: `Buffer` no existe en el runtime de
  // Cloudflare Workers, que es donde tambien corre este modulo.
  return new TextEncoder().encode(data).length <= TELEGRAM_CALLBACK_DATA_MAX_BYTES;
}

export interface TelegramButtonSpec {
  text: string;
  callbackData?: string;
  url?: string;
}

/**
 * Los TRES botones del mensaje, en el orden acordado. "Ver cambios" usa
 * `callback_data` (no un boton-URL) porque tiene que responder con el
 * before/after real ademas de la URL; la URL de staging va ademas como
 * cuarto boton directo cuando existe, para poder abrirla de un toque
 * desde el movil.
 */
export function buildApprovalButtons(approvalRequestId: string, stagingUrl: string): TelegramButtonSpec[][] {
  const rows: TelegramButtonSpec[][] = [
    [
      { text: "✅ APROBAR", callbackData: buildCallbackData("approve", approvalRequestId) },
      { text: "❌ RECHAZAR", callbackData: buildCallbackData("reject", approvalRequestId) },
    ],
    [{ text: "👁 VER CAMBIOS", callbackData: buildCallbackData("view", approvalRequestId) }],
  ];
  if (stagingUrl.trim().length > 0) {
    rows.push([{ text: "🔗 Abrir en staging", url: stagingUrl }]);
  }
  return rows;
}

function shorten(text: string, max: number): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}

/** Resumen de UNA linea por campo realmente modificado. Si no cambio nada, se dice. */
export function buildChangeSummaryLines(change: DepartmentChangeRequest): string[] {
  const fields = change.staging?.changedFields ?? [];
  const changed = fields.filter((f) => f.changed);
  if (changed.length === 0) {
    return ["(el apply no modifico ningun campo -- revisar antes de aprobar)"];
  }
  return changed.map((f) => `- ${f.field}: ${shorten(f.before || "(vacio)", 70)} → ${shorten(f.after || "(vacio)", 70)}`);
}

/**
 * Mensaje principal de solicitud de aprobacion. Texto PLANO a proposito:
 * los titles/metas reales llevan comillas, `<`, `&` y demas, y el parser
 * HTML de Telegram ya ha roto envios reales de este proyecto por eso
 * (ver telegram-gateway.ts, `plainText`).
 */
export function buildApprovalRequestMessage(change: DepartmentChangeRequest): string {
  const lines: string[] = [];
  lines.push("🤖 ZENTRY AI DEPARTMENT");
  lines.push("");
  lines.push("PROPUESTA LISTA PARA REVISION");
  lines.push("");
  lines.push("Titulo:");
  lines.push(shorten(change.title, 160));
  lines.push("");
  lines.push(`Origen: ${change.sourceAgents.length > 0 ? change.sourceAgents.join(", ") : "(no atribuido)"}`);
  lines.push(`Impacto: ${change.impact} | Confianza: ${change.confidence} | Esfuerzo: ${change.effort}`);
  lines.push("");
  lines.push("Por que:");
  lines.push(shorten(change.why, 280));
  lines.push("");
  lines.push("Que se ha cambiado:");
  for (const line of buildChangeSummaryLines(change)) lines.push(line);
  lines.push("");
  lines.push(`QA: ${change.qaStatus}`);
  lines.push("");
  lines.push("Staging:");
  lines.push(change.staging?.url || "(sin URL registrada)");
  lines.push("");
  lines.push("Estado:");
  lines.push("LISTO PARA APROBACION");
  if (change.inheritedFeedback.length > 0) {
    lines.push("");
    lines.push(`(Propuesta v${change.version}. Rechazos anteriores tenidos en cuenta: ${change.inheritedFeedback.length}.)`);
  }
  lines.push("");
  lines.push("Aprobar publica ESTA version en produccion (con snapshot y rollback). Rechazar te pedira el motivo.");
  return lines.join("\n");
}

/**
 * Respuesta al boton "VER CAMBIOS". Solo datos REALES del apply: URL
 * exacta, before/after campo a campo, pagina afectada y version.
 */
export function buildViewChangesMessage(change: DepartmentChangeRequest): string {
  const staging = change.staging;
  const lines: string[] = [];
  lines.push("👁 CAMBIOS APLICADOS EN STAGING");
  lines.push("");
  lines.push("Pagina:");
  lines.push(staging?.url || "(sin URL registrada)");
  lines.push("");
  lines.push(`page_id: ${staging?.wordpressPageId ?? "(desconocido)"}`);
  lines.push("");
  lines.push("Cambios:");
  for (const field of staging?.changedFields ?? []) {
    if (field.changed) {
      lines.push(`- ${field.field}:`);
      lines.push(`   antes:  ${shorten(field.before || "(vacio)", 200)}`);
      lines.push(`   ahora:  ${shorten(field.after || "(vacio)", 200)}`);
    } else {
      lines.push(`- ${field.field}: sin cambio`);
    }
  }
  lines.push("");
  lines.push(`Validacion: ${staging?.validationStatus ?? "not_run"}${staging?.validationDetail ? ` -- ${shorten(staging.validationDetail, 180)}` : ""}`);
  lines.push(`Version aprobable: ${shortHash(change.telegram?.stagingVersionHash ?? staging?.resultingVersionHash ?? "")}`);
  lines.push("");
  lines.push("Produccion NO se ha tocado.");
  return lines.join("\n");
}

/** Texto con el que el bot pide el motivo del rechazo. Corto y directo. */
export function buildRejectionReasonPrompt(change: DepartmentChangeRequest): string {
  return [
    `❌ Rechazado: ${shorten(change.title, 120)}`,
    "",
    "Indicame el motivo del rechazo.",
    "",
    'Tu siguiente mensaje se guarda como el motivo (ej: "No me gusta el H1, quiero mantener el enfoque en cerraduras electronicas, no en control de acceso").',
    "",
    "El cambio sigue en staging para poder trabajarlo. Produccion no se ha tocado.",
  ].join("\n");
}

/** Confirmacion de que el motivo quedo guardado y el rechazo cerrado. */
export function buildRejectionRecordedMessage(change: DepartmentChangeRequest, reason: string): string {
  return [
    "Anotado. Rechazo cerrado.",
    "",
    `Cambio: ${shorten(change.title, 120)}`,
    `Motivo: ${shorten(reason, 300)}`,
    "",
    "Este motivo queda guardado y estara disponible para las siguientes propuestas de esta misma recomendacion.",
    "Produccion no se ha tocado.",
  ].join("\n");
}
