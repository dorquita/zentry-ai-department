import { DepartmentApplyItem, DepartmentApplyStatus, DepartmentApplySummary } from "./apply/types";
import { DepartmentDailyBrief } from "./daily-brief";
import { DepartmentRunCostSummary, formatCostUsd, formatDurationMs } from "./employee-runs";

/**
 * EMAIL del Daily Brief -- version para un DIRECTOR, no un volcado
 * tecnico.
 *
 * Modulo PURO: construye asunto, texto plano y HTML a partir de lo que la
 * pasada REALMENTE produjo. No lee ficheros, no toca SMTP, no conoce
 * ninguna credencial (el envio lo hace
 * scripts/send-department-daily-brief-email.ts usando el mailer del
 * proyecto). Asi este render se puede testear entero sin red.
 *
 * Reglas duras:
 *
 * - No se inventa NINGUNA metrica: todo numero sale del brief, del
 *   contrato de apply o de los registros de coste de esta pasada. Un dato
 *   ausente se dice ("no reportado"), nunca se rellena con 0.
 * - Se prioriza: como maximo 8 prioridades en el cuerpo, y si habia mas
 *   se dice cuantas quedaron fuera (nunca una lista de 40 tareas).
 * - Lo que necesita decision humana va PRIMERO y muy visible.
 * - Nunca aparece ningun valor de configuracion ni de credencial.
 */

/** Maximo de prioridades que entran en el cuerpo del email (el informe completo viaja en el artifact). */
export const MAX_EMAIL_PRIORITIES = 8;

export interface DailyBriefEmailInput {
  brief: DepartmentDailyBrief;
  /** Contrato de apply de la pasada. `null` = esta pasada no llego a planificar apply. */
  apply: DepartmentApplySummary | null;
  cost: DepartmentRunCostSummary | null;
  /** URL del run de GitHub Actions que genero el brief. Vacio = no se ejecuto desde Actions. */
  runUrl: string;
  /** Fecha del informe (YYYY-MM-DD). Si no se pasa, se deriva de `brief.generatedAt`. */
  date?: string;
}

export interface DailyBriefEmail {
  subject: string;
  text: string;
  html: string;
}

const SAFETY_MESSAGE =
  "Este informe contiene propuestas. Solo las acciones que hayan pasado la puerta de aprobacion correspondiente pueden ejecutarse mediante APPLY.";

const APPLY_SECTION_LABELS: { status: DepartmentApplyStatus; label: string }[] = [
  { status: "awaiting_approval", label: "READY FOR APPROVAL" },
  { status: "approved", label: "APPROVED / QUEUED FOR APPLY" },
  { status: "applied", label: "APPLIED SUCCESSFULLY" },
  { status: "validation_failed", label: "VALIDATION FAILED" },
  { status: "rolled_back", label: "ROLLED BACK" },
  { status: "rejected", label: "REJECTED" },
  { status: "blocked", label: "BLOCKED" },
  { status: "requires_manual_implementation", label: "REQUIRES MANUAL IMPLEMENTATION" },
];

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function shorten(text: string, max: number): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}...`;
}

export function buildDailyBriefSubject(date: string): string {
  return `Zentry AI Department — Daily Brief — ${date}`;
}

/**
 * Resumen ejecutivo de 5 a 8 lineas. Se construye eligiendo lo mas
 * decisivo de la pasada, no concatenando todo lo que hay.
 */
export function buildExecutiveLines(input: DailyBriefEmailInput): string[] {
  const { brief } = input;
  const lines: string[] = [];
  const blocked = brief.topPriorities.filter((p) => p.qaStatus === "BLOCKED").length;
  const executedStages = brief.stageStatuses.filter((s) => s.status === "executed").length;

  lines.push(
    `${brief.topPriorities.length} prioridad(es) del departamento hoy, ${blocked} bloqueada(s) por QA. Estado de QA del departamento: ${brief.departmentQaStatus}.`
  );
  lines.push(`${executedStages} de ${brief.stageStatuses.length} etapas del departamento se ejecutaron con salida utilizable en esta pasada.`);
  if (brief.executiveSummary.discovered.length > 0) lines.push(shorten(brief.executiveSummary.discovered[0], 260));
  if (brief.executiveSummary.discovered.length > 1) lines.push(shorten(brief.executiveSummary.discovered[1], 260));
  if (brief.executiveSummary.needsAttention.length > 0) lines.push(shorten(brief.executiveSummary.needsAttention[0], 260));

  if (input.apply) {
    const counts = input.apply.counts;
    lines.push(
      `APPLY: ${counts.awaiting_approval} esperando tu aprobacion, ${counts.approved} aprobada(s) en cola, ${counts.applied} aplicada(s), ${counts.requires_manual_implementation} que requieren implementacion manual.`
    );
    lines.push(
      input.apply.externalWritesPerformed
        ? "Se han realizado escrituras reales en staging en esta pasada (ver la seccion de APPLY)."
        : "No se ha escrito en ningun sistema externo en esta pasada."
    );
  } else {
    lines.push("No se ha escrito en ningun sistema externo en esta pasada.");
  }

  lines.push(`Decisiones pendientes de tu respuesta: ${brief.approvalsNeeded.length}.`);
  return lines.slice(0, 8);
}

function priorityApplyItem(apply: DepartmentApplySummary | null, rank: number): DepartmentApplyItem | undefined {
  return apply?.items.find((item) => item.recommendationRank === rank);
}

function applyStatusLabel(item: DepartmentApplyItem | undefined): string {
  if (!item) return "sin elemento de apply en esta pasada";
  const label = APPLY_SECTION_LABELS.find((l) => l.status === item.applyStatus)?.label ?? item.applyStatus;
  return `${label} (aprobacion humana: ${item.humanApproval.status})`;
}

function stageStatus(brief: DepartmentDailyBrief, stage: string): string {
  return brief.stageStatuses.find((s) => s.stage === stage)?.status ?? "no registrada";
}

function departmentStatusRows(brief: DepartmentDailyBrief): { employee: string; status: string }[] {
  return [
    { employee: "SEO", status: stageStatus(brief, "seo-specialist") },
    { employee: "Content", status: stageStatus(brief, "content-strategist") },
    { employee: "Analytics", status: stageStatus(brief, "analytics-specialist") },
    { employee: "SEM", status: `${stageStatus(brief, "sem-specialist")} (pendiente / fuera de fase)` },
    { employee: "Growth", status: stageStatus(brief, "growth-director-v2") },
    { employee: "QA", status: `${stageStatus(brief, "qa-reviewer")} -> ${brief.departmentQaStatus}` },
    { employee: "Web Engineer", status: stageStatus(brief, "web-engineer") },
  ];
}

function costLines(cost: DepartmentRunCostSummary | null): string[] {
  if (!cost || cost.runs.length === 0) {
    return ["Coste de Claude en esta pasada: no reportado (no hay registros de ejecucion utilizables). No se ha estimado ninguna cifra."];
  }
  const lines = [
    `Coste total de Claude en esta pasada: ${formatCostUsd(cost.totalCostUsd)}${cost.partial ? " (PARCIAL: falta el coste de algun empleado, ver detalle)" : ""}.`,
    `Duracion sumada de las invocaciones: ${formatDurationMs(cost.totalDurationMs)}. Turnos totales: ${cost.totalTurns ?? "no reportados"}.`,
  ];
  for (const run of cost.runs) {
    lines.push(
      `- ${run.employee}: ${formatCostUsd(run.costUsd)}, ${formatDurationMs(run.durationMs)}, ${run.numTurns ?? "?"} turno(s), modelo ${run.model ?? "no reportado"}, salida via ${run.outputSource}, resultado ${run.outcome}.`
    );
  }
  return lines;
}

// --- Texto plano -----------------------------------------------------------

export function renderDailyBriefEmailText(input: DailyBriefEmailInput): string {
  const { brief, apply } = input;
  const priorities = brief.topPriorities.slice(0, MAX_EMAIL_PRIORITIES);
  const omitted = brief.topPriorities.length - priorities.length;
  const lines: string[] = [];

  lines.push("ZENTRY AI DEPARTMENT -- DAILY BRIEF");
  lines.push(`Pasada: ${brief.departmentRunId} | Generado: ${brief.generatedAt}`);
  lines.push("");
  lines.push("1. RESUMEN EJECUTIVO");
  lines.push("");
  for (const line of buildExecutiveLines(input)) lines.push(`- ${line}`);
  lines.push("");

  lines.push("2. TOP PRIORITIES");
  lines.push("");
  if (priorities.length === 0) {
    lines.push("Ninguna prioridad del departamento en esta pasada. Ver la seccion BLOCKED / UNKNOWN para el motivo exacto.");
    lines.push("");
  }
  for (const priority of priorities) {
    const item = priorityApplyItem(apply, priority.rank);
    lines.push(`${priority.rank}. ${priority.action}`);
    lines.push(`   Por que importa: ${shorten(priority.reason, 320)}`);
    lines.push(`   Impacto: ${priority.impact} | Confianza: ${priority.confidence} | Esfuerzo: ${priority.effort}`);
    lines.push(
      `   Evidencia: ${priority.evidence.length === 0 ? "ninguna citada -- tratar como NO verificada" : priority.evidence.map((e) => `${e.ref} (${e.originEmployees.join(", ")}): ${shorten(e.description, 120)}`).join(" | ")}`
    );
    lines.push(`   QA status: ${priority.qaStatus}${priority.qaNotes.length > 0 ? ` -- ${priority.qaNotes.map((n) => shorten(n, 140)).join(" | ")}` : ""}`);
    lines.push(`   Accion propuesta: ${priority.hasEngineeringSpec ? "hay especificacion tecnica de web-engineer para esta prioridad" : "sin especificacion tecnica todavia"}. Estado de APPLY: ${applyStatusLabel(item)}`);
    lines.push(`   Necesita aprobacion: ${priority.approvalRequired ? "SI" : "no"}`);
    lines.push("");
  }
  if (omitted > 0) {
    lines.push(`(${omitted} prioridad(es) adicional(es) quedan fuera de este email para mantenerlo accionable. Estan completas en el informe del run.)`);
    lines.push("");
  }

  lines.push("3. APPROVALS NEEDED");
  lines.push("");
  if (brief.approvalsNeeded.length === 0) {
    lines.push("Ninguna decision pendiente en esta pasada.");
    lines.push("");
  }
  for (const approval of brief.approvalsNeeded) {
    lines.push("[APPROVAL REQUIRED]");
    lines.push(approval.decision);
    lines.push(`Motivo: ${shorten(approval.why, 400)}`);
    lines.push(`QA: ${approval.qaStatus} | Origen: ${approval.origin}`);
    lines.push("");
  }

  if (apply) {
    lines.push("4. ESTADO DE APPLY");
    lines.push("");
    for (const { status, label } of APPLY_SECTION_LABELS) {
      const items = apply.items.filter((item) => item.applyStatus === status);
      if (items.length === 0) continue;
      lines.push(`${label} (${items.length}):`);
      for (const item of items) {
        lines.push(`  - #${item.recommendationRank} ${shorten(item.title, 160)}`);
        lines.push(`    Capacidad de apply: ${item.applyCapability.supported ? String(item.applyCapability.id) : "ninguna"} -- ${shorten(item.applyCapability.reason, 260)}`);
        lines.push(`    Aprobacion humana: ${item.humanApproval.status} -- ${shorten(item.humanApproval.reason, 220)}`);
        if (item.validationStatus !== "not_run" || item.rollbackStatus !== "not_needed") {
          lines.push(`    Validacion: ${item.validationStatus} | Rollback: ${item.rollbackStatus}`);
        }
      }
      lines.push("");
    }
    if (apply.applyNotAttemptedReason) {
      lines.push(`Por que no se ha aplicado nada: ${apply.applyNotAttemptedReason}`);
      lines.push("");
    }
  }

  lines.push("5. BLOCKED / UNKNOWN");
  lines.push("");
  for (const item of brief.blockedOrUnknown.slice(0, 12)) lines.push(`- ${shorten(item, 300)}`);
  if (brief.blockedOrUnknown.length > 12) lines.push(`- (${brief.blockedOrUnknown.length - 12} entrada(s) mas en el informe completo del run.)`);
  lines.push("");

  lines.push("6. ESTADO DEL DEPARTAMENTO");
  lines.push("");
  for (const row of departmentStatusRows(brief)) lines.push(`- ${row.employee}: ${row.status}`);
  lines.push("");

  lines.push("7. COSTE DE LA PASADA");
  lines.push("");
  for (const line of costLines(input.cost)) lines.push(line);
  lines.push("");

  lines.push("8. RUN DE GITHUB");
  lines.push("");
  lines.push(input.runUrl ? input.runUrl : "(esta pasada no se ejecuto desde GitHub Actions: no hay URL de run)");
  lines.push("");

  lines.push("9. SEGURIDAD");
  lines.push("");
  lines.push(SAFETY_MESSAGE);
  lines.push("");
  return lines.join("\n");
}

// --- HTML ------------------------------------------------------------------

function htmlSection(title: string, body: string): string {
  return `<h2 style="font-size:16px;margin:28px 0 8px;padding-bottom:6px;border-bottom:1px solid #d8dce3;color:#0b1b33;">${escapeHtml(title)}</h2>${body}`;
}

function htmlList(items: string[]): string {
  if (items.length === 0) return '<p style="margin:0 0 12px;color:#54617a;">Nada que reportar en esta seccion.</p>';
  return `<ul style="margin:0 0 12px;padding-left:20px;">${items.map((i) => `<li style="margin:0 0 6px;">${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function htmlPriority(priority: DepartmentDailyBrief["topPriorities"][number], item: DepartmentApplyItem | undefined): string {
  const qaColor = priority.qaStatus === "BLOCKED" ? "#b3261e" : priority.qaStatus === "PASS_WITH_WARNINGS" ? "#8a6100" : "#1b6b3a";
  const evidence =
    priority.evidence.length === 0
      ? "<em>Ninguna evidencia citada -- tratar la prioridad como NO verificada.</em>"
      : priority.evidence.map((e) => `<code>${escapeHtml(e.ref)}</code> (${escapeHtml(e.originEmployees.join(", "))}): ${escapeHtml(shorten(e.description, 160))}`).join("<br>");
  return `
    <div style="border:1px solid #d8dce3;border-radius:6px;padding:14px 16px;margin:0 0 14px;">
      <div style="font-weight:600;font-size:15px;color:#0b1b33;">${priority.rank}. ${escapeHtml(priority.action)}</div>
      <p style="margin:8px 0;color:#33415c;">${escapeHtml(shorten(priority.reason, 400))}</p>
      <p style="margin:8px 0;color:#33415c;">
        <strong>Impacto:</strong> ${escapeHtml(priority.impact)} &nbsp;|&nbsp;
        <strong>Confianza:</strong> ${escapeHtml(priority.confidence)} &nbsp;|&nbsp;
        <strong>Esfuerzo:</strong> ${escapeHtml(priority.effort)}
      </p>
      <p style="margin:8px 0;color:#33415c;"><strong>Evidencia:</strong><br>${evidence}</p>
      <p style="margin:8px 0;"><strong>QA:</strong> <span style="color:${qaColor};font-weight:600;">${escapeHtml(priority.qaStatus)}</span>${
        priority.qaNotes.length > 0 ? ` &mdash; ${escapeHtml(priority.qaNotes.map((n) => shorten(n, 160)).join(" | "))}` : ""
      }</p>
      <p style="margin:8px 0;color:#33415c;"><strong>Accion propuesta:</strong> ${escapeHtml(
        priority.hasEngineeringSpec ? "con especificacion tecnica de web-engineer" : "sin especificacion tecnica todavia"
      )} &mdash; <strong>APPLY:</strong> ${escapeHtml(applyStatusLabel(item))}</p>
      <p style="margin:8px 0 0;"><strong>Necesita aprobacion:</strong> ${priority.approvalRequired ? '<span style="color:#b3261e;font-weight:600;">SI</span>' : "no"}</p>
    </div>`;
}

export function renderDailyBriefEmailHtml(input: DailyBriefEmailInput): string {
  const { brief, apply } = input;
  const priorities = brief.topPriorities.slice(0, MAX_EMAIL_PRIORITIES);
  const omitted = brief.topPriorities.length - priorities.length;

  const approvals =
    brief.approvalsNeeded.length === 0
      ? '<p style="margin:0;color:#54617a;">Ninguna decision pendiente en esta pasada.</p>'
      : brief.approvalsNeeded
          .map(
            (approval) => `
      <div style="border-left:4px solid #b3261e;background:#fdf3f2;padding:12px 14px;margin:0 0 12px;">
        <div style="font-weight:700;color:#b3261e;letter-spacing:0.4px;">[APPROVAL REQUIRED]</div>
        <div style="font-weight:600;margin:6px 0;color:#0b1b33;">${escapeHtml(approval.decision)}</div>
        <div style="color:#33415c;">${escapeHtml(shorten(approval.why, 400))}</div>
        <div style="color:#54617a;margin-top:6px;font-size:13px;">QA: ${escapeHtml(approval.qaStatus)} &nbsp;|&nbsp; Origen: ${escapeHtml(approval.origin)}</div>
      </div>`
          )
          .join("");

  const applyHtml = apply
    ? APPLY_SECTION_LABELS.map(({ status, label }) => {
        const items = apply.items.filter((item) => item.applyStatus === status);
        if (items.length === 0) return "";
        return `<p style="margin:12px 0 4px;font-weight:600;color:#0b1b33;">${escapeHtml(label)} (${items.length})</p>${htmlList(
          items.map(
            (item) =>
              `#${item.recommendationRank} ${shorten(item.title, 160)} -- capacidad: ${item.applyCapability.supported ? String(item.applyCapability.id) : "ninguna"}; aprobacion humana: ${item.humanApproval.status}; validacion: ${item.validationStatus}; rollback: ${item.rollbackStatus}`
          )
        )}`;
      }).join("") + (apply.applyNotAttemptedReason ? `<p style="margin:8px 0;color:#54617a;">${escapeHtml(apply.applyNotAttemptedReason)}</p>` : "")
    : '<p style="margin:0;color:#54617a;">Esta pasada no llego a construir el contrato de APPLY.</p>';

  const statusRows = departmentStatusRows(brief)
    .map(
      (row) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eceff4;font-weight:600;color:#0b1b33;">${escapeHtml(row.employee)}</td><td style="padding:6px 12px;border-bottom:1px solid #eceff4;color:#33415c;">${escapeHtml(row.status)}</td></tr>`
    )
    .join("");

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#33415c;max-width:760px;margin:0 auto;padding:24px;">
  <h1 style="font-size:20px;margin:0 0 4px;color:#0b1b33;">Zentry AI Department &mdash; Daily Brief</h1>
  <p style="margin:0 0 20px;color:#54617a;font-size:13px;">Pasada <code>${escapeHtml(brief.departmentRunId)}</code> &nbsp;|&nbsp; generado ${escapeHtml(brief.generatedAt)} &nbsp;|&nbsp; QA del departamento: <strong>${escapeHtml(brief.departmentQaStatus)}</strong></p>

  ${htmlSection("1. Resumen ejecutivo", htmlList(buildExecutiveLines(input)))}

  ${htmlSection(
    "2. Top priorities",
    priorities.length === 0
      ? '<p style="margin:0;color:#54617a;">Ninguna prioridad del departamento en esta pasada. Ver BLOCKED / UNKNOWN para el motivo exacto.</p>'
      : priorities.map((priority) => htmlPriority(priority, priorityApplyItem(apply, priority.rank))).join("") +
          (omitted > 0 ? `<p style="margin:0;color:#54617a;">${omitted} prioridad(es) adicional(es) quedan fuera de este email para mantenerlo accionable; estan completas en el informe del run.</p>` : "")
  )}

  ${htmlSection("3. Approvals needed", approvals)}

  ${htmlSection("4. Estado de APPLY", applyHtml)}

  ${htmlSection("5. Blocked / unknown", htmlList(brief.blockedOrUnknown.slice(0, 12).map((i) => shorten(i, 300))))}

  ${htmlSection("6. Estado del departamento", `<table style="border-collapse:collapse;width:100%;">${statusRows}</table>`)}

  ${htmlSection("7. Coste de la pasada", htmlList(costLines(input.cost)))}

  ${htmlSection(
    "8. Run de GitHub",
    input.runUrl
      ? `<p style="margin:0;"><a href="${escapeHtml(input.runUrl)}" style="color:#1a4fbf;">${escapeHtml(input.runUrl)}</a></p>`
      : '<p style="margin:0;color:#54617a;">Esta pasada no se ejecuto desde GitHub Actions: no hay URL de run.</p>'
  )}

  <div style="margin-top:28px;border:1px solid #d8dce3;background:#f6f8fb;border-radius:6px;padding:14px 16px;color:#0b1b33;">
    <strong>Seguridad:</strong> ${escapeHtml(SAFETY_MESSAGE)}
  </div>
</div>`;
}

export function buildDailyBriefEmail(input: DailyBriefEmailInput): DailyBriefEmail {
  const date = input.date ?? input.brief.generatedAt.slice(0, 10);
  return {
    subject: buildDailyBriefSubject(date),
    text: renderDailyBriefEmailText(input),
    html: renderDailyBriefEmailHtml(input),
  };
}
