import { buildNumberedProposals, NumberedProposal } from "../approvals/manual/proposal";
import { APPLY_STATUS_LABEL, APPLY_STATUS_REPORT_ORDER, DepartmentApplyItem, DepartmentApplyStatus, DepartmentApplySummary } from "./apply/types";
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
 *
 * EXCEPCION DELIBERADA al recorte: la seccion de PROPUESTAS NUMERADAS se
 * imprime COMPLETA, sin `MAX_EMAIL_PRIORITIES`. Es la referencia con la
 * que mas tarde una persona dice "aprueba 1, 2 y 4" en Claude Code; si el
 * email cortase la lista en 8, el "9" que la persona no ve seguiria
 * existiendo en el sistema y cualquier numero podria significar otra cosa.
 * Un email largo es un problema de lectura; una lista incompleta es un
 * problema de seguridad.
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

/**
 * Bloques del email, en el orden en el que interesan a un director: lo
 * accionable primero. Las etiquetas salen de una unica fuente compartida
 * con el Daily Brief (`APPLY_STATUS_LABEL`), para que el mismo estado no
 * se llame de dos formas distintas en dos informes.
 */
const APPLY_SECTION_LABELS: { status: DepartmentApplyStatus; label: string }[] = APPLY_STATUS_REPORT_ORDER.map((status) => ({
  status,
  label: APPLY_STATUS_LABEL[status],
}));

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
    const readyForReview = counts.staging_applied + counts.awaiting_approval;
    lines.push(
      `APPLY: ${counts.staging_applied} listo(s) en staging, ${counts.awaiting_approval} esperando tu aprobacion en Telegram, ${counts.approved} aprobada(s), ${counts.production_applied} publicada(s) en produccion, ${counts.rejected} rechazada(s), ${counts.requires_manual_staging_implementation} que requieren implementacion manual en staging.`
    );
    if (readyForReview > 0) {
      // El email informa; la aprobacion se hace en Telegram, que es el
      // canal OPERATIVO de esta fase. Aqui no se aprueba nada.
      lines.push(`${readyForReview} cambio(s) estan listos para revisar en Telegram. La aprobacion se hace alli, no por email.`);
    }
    lines.push(
      input.apply.productionWritesPerformed
        ? "Se han publicado cambios en PRODUCCION en esta pasada, cada uno con aprobacion humana explicita (ver la seccion de APPLY)."
        : input.apply.externalWritesPerformed
          ? "Se han aplicado cambios reversibles en STAGING en esta pasada. Produccion no se ha tocado."
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

// --- Propuestas numeradas --------------------------------------------------

/**
 * Titulo de la seccion. Va sin numero de seccion a proposito: se coloca
 * entre el resumen ejecutivo y el resto del informe SIN renumerar las
 * secciones ya existentes (1..9), que estan referenciadas en la
 * documentacion del proyecto y en los tests del email.
 */
const NUMBERED_PROPOSALS_TITLE = "PROPUESTAS NUMERADAS -- ESTO ES LO QUE PUEDES APROBAR HOY";

/**
 * Instrucciones de respuesta. Se escriben una sola vez y se usan tal cual
 * en texto y en HTML: si las dos versiones divergieran, una de las dos
 * estaria explicando un flujo que no existe.
 */
const HOW_TO_ANSWER_LINES: string[] = [
  'Responde en Claude Code, en lenguaje natural, citando los numeros de esta lista. Por ejemplo: "aprueba 1, 2 y 4; rechaza 3 porque el copy no me gusta; deja 5 pendiente".',
  "El numero es tu referencia; el id es la del sistema. Antes de ejecutar nada se comprueba que el numero sigue apuntando al mismo id, para que un informe viejo no ejecute lo que no es.",
  "Un rechazo necesita motivo: se guarda LITERAL y es lo que alimenta las siguientes propuestas del departamento.",
  "Lo que no menciones queda PENDIENTE. El silencio NUNCA se interpreta como aprobacion: ninguna propuesta se ejecuta sola.",
  "Este email no ha ejecutado nada. Enviarlo no ha escrito en ningun sistema; solo se ejecuta lo que apruebes despues, y entonces recibiras un segundo email con los resultados reales.",
];

/** Ids de la propuesta, siempre juntos: el numero solo nunca identifica nada. */
function proposalIdLine(proposal: NumberedProposal): string {
  const changeId = proposal.changeId ?? "(todavia sin registro de cambio persistente)";
  return `id: ${proposal.id} | recommendationId: ${proposal.recommendationId} | changeId: ${changeId}`;
}

function proposalOrigin(proposal: NumberedProposal): string {
  return proposal.sourceAgents.length > 0 ? proposal.sourceAgents.join(", ") : "no reportado";
}

function proposalStaging(proposal: NumberedProposal): string {
  return proposal.stagingUrl ? proposal.stagingUrl : "(sin URL de staging para esta propuesta)";
}

/**
 * Cambios campo a campo. El `before` viene tal cual de la propuesta:
 * cuando dice que se leera antes de aplicar es que TODAVIA NO SE HA LEIDO,
 * y eso se muestra literal en vez de inventar un valor actual.
 */
function proposalChangeLines(proposal: NumberedProposal): string[] {
  if (proposal.changes.length === 0) return ["(sin before/after concreto todavia: esta propuesta no trae cambio de campos resuelto)"];
  return proposal.changes.map((change) => `${change.field}: antes "${change.before}" -> despues "${change.after}"`);
}

function proposalTextBlock(proposal: NumberedProposal): string[] {
  const lines: string[] = [];
  lines.push(`[ ${proposal.number} ]  ${proposal.title}`);
  lines.push(`    ${proposalIdLine(proposal)}`);
  lines.push(`    Origen (empleados): ${proposalOrigin(proposal)}`);
  lines.push(`    Prioridad: impacto ${proposal.impact} | confianza ${proposal.confidence} | esfuerzo ${proposal.effort}`);
  lines.push(`    Que se propone: ${shorten(proposal.description, 600)}`);
  lines.push(`    Paginas afectadas: ${proposal.targets}`);
  lines.push(`    Staging: ${proposalStaging(proposal)}`);
  lines.push("    Cambio propuesto:");
  for (const change of proposalChangeLines(proposal)) lines.push(`      - ${change}`);
  lines.push(`    Capacidad de apply: ${proposal.capability} -- ${shorten(proposal.capabilityReason, 260)}`);
  lines.push(`    QA: ${proposal.qaStatus}`);
  lines.push(`    Riesgo: ${proposal.risk}`);
  lines.push(`    Estado actual: ${proposal.statusLabel}`);
  if (proposal.actionable) {
    lines.push("    Accionable hoy: SI -- si la apruebas, se ejecuta con un executor determinista.");
  } else {
    lines.push(`    NO ACCIONABLE HOY: ${proposal.notActionableReason}`);
    lines.push("    Aprobarla no la ejecutara: quedara registrada como aprobada pendiente de trabajo manual.");
  }
  return lines;
}

/** Titulo con el numero total, identico en texto y en HTML. */
export function numberedProposalsHeading(apply: DepartmentApplySummary | null): string {
  const total = apply ? buildNumberedProposals(apply).length : 0;
  return `${NUMBERED_PROPOSALS_TITLE} (${total})`;
}

export function renderNumberedProposalsText(apply: DepartmentApplySummary | null): string[] {
  const lines: string[] = [];
  const proposals = apply ? buildNumberedProposals(apply) : [];
  lines.push(numberedProposalsHeading(apply));
  lines.push("");
  if (proposals.length === 0) {
    lines.push(
      apply
        ? "Esta pasada no ha producido ninguna propuesta numerada: no hay nada que aprobar hoy."
        : "Esta pasada no llego a construir el contrato de APPLY, asi que no hay propuestas numeradas: no hay nada que aprobar hoy."
    );
    lines.push("");
    return lines;
  }
  // Lista COMPLETA: ver la nota de cabecera del modulo sobre por que aqui
  // no se aplica MAX_EMAIL_PRIORITIES.
  for (const proposal of proposals) {
    for (const line of proposalTextBlock(proposal)) lines.push(line);
    lines.push("");
  }
  lines.push("COMO RESPONDER");
  for (const line of HOW_TO_ANSWER_LINES) lines.push(`- ${line}`);
  lines.push("");
  return lines;
}

function proposalHtmlBlock(proposal: NumberedProposal): string {
  const badgeColor = proposal.actionable ? "#1a4fbf" : "#8a6100";
  const changes = proposalChangeLines(proposal)
    .map((change) => `<li style="margin:0 0 4px;"><code style="font-size:12px;">${escapeHtml(change)}</code></li>`)
    .join("");
  const actionability = proposal.actionable
    ? '<p style="margin:8px 0 0;color:#1b6b3a;"><strong>Accionable hoy:</strong> SI &mdash; si la apruebas, se ejecuta con un executor determinista.</p>'
    : `<p style="margin:8px 0 0;color:#8a6100;"><strong>NO ACCIONABLE HOY:</strong> ${escapeHtml(
        proposal.notActionableReason
      )}<br>Aprobarla no la ejecutara: quedara registrada como aprobada pendiente de trabajo manual.</p>`;
  return `
    <div style="border:1px solid #d8dce3;border-radius:6px;padding:14px 16px;margin:0 0 14px;">
      <div>
        <span style="display:inline-block;min-width:34px;text-align:center;background:${badgeColor};color:#ffffff;font-size:18px;font-weight:700;border-radius:6px;padding:4px 10px;margin-right:10px;">${proposal.number}</span>
        <span style="font-weight:600;font-size:15px;color:#0b1b33;">${escapeHtml(proposal.title)}</span>
      </div>
      <p style="margin:10px 0 6px;color:#54617a;font-size:12px;"><code>${escapeHtml(proposalIdLine(proposal))}</code></p>
      <p style="margin:6px 0;color:#33415c;"><strong>Origen (empleados):</strong> ${escapeHtml(proposalOrigin(proposal))}</p>
      <p style="margin:6px 0;color:#33415c;">
        <strong>Impacto:</strong> ${escapeHtml(proposal.impact)} &nbsp;|&nbsp;
        <strong>Confianza:</strong> ${escapeHtml(proposal.confidence)} &nbsp;|&nbsp;
        <strong>Esfuerzo:</strong> ${escapeHtml(proposal.effort)}
      </p>
      <p style="margin:6px 0;color:#33415c;"><strong>Que se propone:</strong> ${escapeHtml(shorten(proposal.description, 600))}</p>
      <p style="margin:6px 0;color:#33415c;"><strong>Paginas afectadas:</strong> ${escapeHtml(proposal.targets)}</p>
      <p style="margin:6px 0;color:#33415c;"><strong>Staging:</strong> ${escapeHtml(proposalStaging(proposal))}</p>
      <p style="margin:6px 0 4px;color:#33415c;"><strong>Cambio propuesto:</strong></p>
      <ul style="margin:0 0 8px;padding-left:20px;">${changes}</ul>
      <p style="margin:6px 0;color:#33415c;"><strong>Capacidad de apply:</strong> ${escapeHtml(proposal.capability)} &mdash; ${escapeHtml(
        shorten(proposal.capabilityReason, 260)
      )}</p>
      <p style="margin:6px 0;color:#33415c;"><strong>QA:</strong> ${escapeHtml(proposal.qaStatus)}</p>
      <p style="margin:6px 0;color:#33415c;"><strong>Riesgo:</strong> ${escapeHtml(proposal.risk)}</p>
      <p style="margin:6px 0;color:#33415c;"><strong>Estado actual:</strong> ${escapeHtml(proposal.statusLabel)}</p>
      ${actionability}
    </div>`;
}

export function renderNumberedProposalsHtml(apply: DepartmentApplySummary | null): string {
  const proposals = apply ? buildNumberedProposals(apply) : [];
  if (proposals.length === 0) {
    return `<p style="margin:0;color:#54617a;">${escapeHtml(
      apply
        ? "Esta pasada no ha producido ninguna propuesta numerada: no hay nada que aprobar hoy."
        : "Esta pasada no llego a construir el contrato de APPLY, asi que no hay propuestas numeradas: no hay nada que aprobar hoy."
    )}</p>`;
  }
  return (
    proposals.map(proposalHtmlBlock).join("") +
    `<div style="border-left:4px solid #1a4fbf;background:#f2f6fd;padding:12px 14px;margin:0 0 12px;">
      <div style="font-weight:700;color:#0b1b33;letter-spacing:0.4px;">COMO RESPONDER</div>
      <ul style="margin:8px 0 0;padding-left:20px;">${HOW_TO_ANSWER_LINES.map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line)}</li>`).join("")}</ul>
    </div>`
  );
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

  // Va inmediatamente despues del resumen ejecutivo porque es la unica
  // seccion sobre la que se pide una RESPUESTA. El resto del email
  // informa; esta decide.
  for (const line of renderNumberedProposalsText(apply)) lines.push(line);

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
        if (item.traceability.stagingUrl) lines.push(`    Staging: ${item.traceability.stagingUrl}`);
        if (item.traceability.productionUrl) lines.push(`    Produccion: ${item.traceability.productionUrl}`);
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
              `#${item.recommendationRank} ${shorten(item.title, 160)} -- capacidad: ${item.applyCapability.supported ? String(item.applyCapability.id) : "ninguna"}; aprobacion humana: ${item.humanApproval.status}; validacion: ${item.validationStatus}; rollback: ${item.rollbackStatus}${item.traceability.stagingUrl ? `; staging: ${item.traceability.stagingUrl}` : ""}${item.traceability.productionUrl ? `; produccion: ${item.traceability.productionUrl}` : ""}`
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

  ${htmlSection(numberedProposalsHeading(apply), renderNumberedProposalsHtml(apply))}

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
