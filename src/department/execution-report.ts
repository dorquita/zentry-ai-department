import { ResolvedDecision } from "../approvals/manual/decision";
import { NumberedProposal } from "../approvals/manual/proposal";
import { escapeHtml } from "./brief-email";
import { DepartmentRunCostSummary, formatCostUsd, formatDurationMs } from "./employee-runs";

/**
 * EMAIL DE EJECUCION -- el SEGUNDO email del dia.
 *
 * El flujo tiene dos correos y ninguno de los dos hace lo que hace el
 * otro:
 *
 *   1. El Daily Brief PROPONE (lista numerada) y no escribe en ningun
 *      sistema.
 *   2. Este informe cuenta lo que REALMENTE paso despues de que una
 *      persona dijera "aprueba 1, 2 y 4; rechaza 3 porque...".
 *
 * Por eso este email no es un resumen bonito: es el acta de la ejecucion.
 * Modulo PURO igual que brief-email.ts (sin I/O, sin red, sin reloj): todo
 * lo que aparece llega en el input, para poder testear el render entero.
 *
 * Reglas duras:
 *
 * - NINGUN dato inventado. Lo que no se sabe se dice "no reportado". Un
 *   before desconocido no se rellena con el after, ni una validacion que
 *   no corrio se cuenta como pasada.
 * - NUNCA se oculta un fallo. Un rollback, una validacion fallida o una
 *   aprobacion que no se pudo ejecutar salen en la seccion principal, no
 *   en una nota al pie. Un informe que solo cuenta lo que salio bien
 *   entrena a no leerlo.
 * - El motivo de un rechazo se imprime LITERAL y entrecomillado. No se
 *   resume ni se reinterpreta: es el texto que alimenta las siguientes
 *   propuestas del departamento, y reescribirlo cambia lo que el
 *   departamento aprende.
 * - El silencio se reporta como silencio: lo que quedo sin decision sigue
 *   PENDIENTE, y se dice explicitamente que no se aprobo.
 * - Las escrituras se cuentan siempre, incluido el 0. "0 escrituras en
 *   produccion" es informacion; omitir la linea es ambiguo.
 * - Nunca aparece ningun valor de configuracion ni de credencial.
 */

/** Resultado REAL de intentar ejecutar una propuesta aprobada. */
export type ExecutionOutcome =
  /** Aplicado y validado. */
  | "applied"
  /** Se escribio, pero la validacion posterior fallo. */
  | "validation_failed"
  /** Se escribio y se deshizo (por validacion fallida o por error posterior). */
  | "rolled_back"
  /** El intento de escritura fallo. */
  | "failed"
  /** No se llego a intentar (aprobada pero no accionable, credenciales ausentes, etc.). */
  | "not_executed";

export const EXECUTION_OUTCOME_LABEL: Record<ExecutionOutcome, string> = {
  applied: "APLICADO (escrito y validado)",
  validation_failed: "VALIDACION FALLIDA (se escribio, pero la comprobacion posterior no paso)",
  rolled_back: "REVERTIDO (se escribio y se deshizo)",
  failed: "FALLIDO (la escritura no se completo)",
  not_executed: "NO EJECUTADO",
};

/** Donde se escribio de verdad. `none` = no se toco ningun sistema. */
export type ExecutionEnvironment = "staging" | "production" | "none";

export interface ExecutionChange {
  field: string;
  /** Valor REAL leido antes de escribir. Vacio = no se leyo -> "no reportado". */
  before: string;
  /** Valor REAL escrito. Vacio = no se escribio -> "no reportado". */
  after: string;
}

export interface ExecutionRollback {
  /** `true` si se deshizo de verdad la escritura. */
  performed: boolean;
  /** Por que hubo que deshacerla. */
  reason: string;
  /** Como acabo el propio rollback: tambien puede fallar, y entonces hay que verlo. */
  status: "rolled_back" | "rollback_failed";
  detail: string;
}

export interface ExecutedWork {
  /** Decision humana ya validada. Trae la propuesta numerada original. */
  decision: ResolvedDecision;
  /** Que se hizo, en una linea, tal como lo reporto el executor. */
  action: string;
  /** Donde se escribio realmente (no donde se pidio escribir). */
  environment: ExecutionEnvironment;
  changes: ExecutionChange[];
  /** Resultado de la validacion posterior. Vacio = no se ejecuto ninguna. */
  validation: string;
  outcome: ExecutionOutcome;
  /** Detalle del resultado: obligatorio cuando algo no salio bien. */
  outcomeDetail: string;
  /** URL donde se puede ver el resultado. Vacio = no reportada. */
  url: string;
  /** `null` si no hubo rollback. Si lo hubo, se imprime SIEMPRE. */
  rollback: ExecutionRollback | null;
}

/** Recomendacion NUEVA surgida durante la ejecucion. No se ha ejecutado nada de esto. */
export interface ExecutionNewRecommendation {
  title: string;
  description: string;
  /** De donde sale (empleado, executor, validacion...). Vacio = no reportado. */
  origin: string;
}

export interface ExecutionRunIds {
  /** Pasada del departamento a la que pertenecian las propuestas. */
  departmentRunId: string;
  /** Id de ESTA sesion de ejecucion manual. */
  executionRunId: string;
  /** URL del run de GitHub Actions que genero el Daily Brief. Vacio = no reportada. */
  briefRunUrl: string;
  /** URL del run donde se ejecuto. Vacio = se ejecuto fuera de Actions. */
  executionRunUrl: string;
}

export interface ExecutionWriteCounts {
  staging: number;
  production: number;
}

export interface ExecutionReportInput {
  /** Momento en el que se construye el informe (lo pone quien llama: este modulo no tiene reloj). */
  generatedAt: string;
  /** Fecha del informe (YYYY-MM-DD). Si no se pasa, se deriva de `generatedAt`. */
  date?: string;
  runIds: ExecutionRunIds;
  executed: ExecutedWork[];
  /** Propuestas sobre las que NO se dijo nada (`untouched` de resolveHumanDecisions). */
  pending: NumberedProposal[];
  /** Decisiones de rechazo. El motivo se imprime literal. */
  rejected: ResolvedDecision[];
  newRecommendations: ExecutionNewRecommendation[];
  /** Escrituras reales por entorno. Se reportan siempre, tambien cuando son 0. */
  writes: ExecutionWriteCounts;
  cost: DepartmentRunCostSummary | null;
}

export interface ExecutionReportEmail {
  subject: string;
  text: string;
  html: string;
}

const SAFETY_MESSAGE =
  "Este informe describe escrituras que YA se han hecho, cada una con una decision humana explicita detras. Lo que no aparece como ejecutado no se ha ejecutado.";

const SILENCE_MESSAGE =
  "Estas propuestas siguen PENDIENTES: no se dijo nada sobre ellas y el silencio NUNCA se interpreta como aprobacion. No se ha tocado nada suyo.";

const NEW_RECOMMENDATIONS_MESSAGE =
  "Estas recomendaciones son NUEVAS y NO se han ejecutado. Necesitan una aprobacion nueva: apareceran numeradas en el proximo Daily Brief.";

/** Un dato ausente se dice, nunca se rellena. */
function reported(value: string): string {
  const flat = String(value ?? "").trim();
  return flat.length > 0 ? flat : "no reportado";
}

function environmentLabel(environment: ExecutionEnvironment): string {
  if (environment === "production") return "PRODUCCION";
  if (environment === "staging") return "STAGING";
  return "ninguno (no se escribio en ningun sistema)";
}

/**
 * Decision humana tal como se tomo. Incluye las modificaciones pedidas:
 * aprobar "con cambios" no es lo mismo que aprobar, y el acta tiene que
 * distinguirlo.
 */
function humanDecisionLine(decision: ResolvedDecision): string {
  const overrides = Object.entries(decision.overrides)
    .filter(([, value]) => typeof value === "string")
    .map(([field, value]) => `${field} := "${String(value)}"`);
  const suffix = overrides.length > 0 ? ` con modificaciones pedidas (${overrides.join("; ")})` : "";
  if (decision.action === "approve") {
    return `APROBADA por una persona para ${decision.target === "production" ? "PRODUCCION" : "STAGING"}${suffix}`;
  }
  if (decision.action === "reject") return "RECHAZADA por una persona";
  return "DEJADA PENDIENTE por una persona";
}

/** Identificacion completa: numero visible + id real, siempre juntos. */
function proposalRef(proposal: NumberedProposal): string {
  const changeId = proposal.changeId ?? "(sin registro de cambio persistente)";
  return `id: ${proposal.id} | recommendationId: ${proposal.recommendationId} | changeId: ${changeId}`;
}

function changeLines(work: ExecutedWork): string[] {
  if (work.changes.length === 0) return ["(sin cambios de campo reportados por el executor)"];
  return work.changes.map((change) => `${change.field}: antes "${reported(change.before)}" -> despues "${reported(change.after)}"`);
}

/**
 * Un rollback NO es una nota al pie. Si lo hubo, es lo mas importante de
 * ese bloque, y si el propio rollback fallo aun mas.
 */
function rollbackLines(rollback: ExecutionRollback | null): string[] {
  if (!rollback) return [];
  const header = rollback.status === "rollback_failed" ? "ROLLBACK FALLIDO -- el sistema NO ha vuelto a su estado anterior" : "ROLLBACK EJECUTADO -- el cambio se ha deshecho";
  return [header, `Motivo del rollback: ${reported(rollback.reason)}`, `Detalle: ${reported(rollback.detail)}`];
}

function writeLines(writes: ExecutionWriteCounts): string[] {
  // El 0 se imprime: "no se escribio en produccion" solo es verificable
  // si la cifra esta, y omitirla se lee como que no se sabe.
  return [
    `Escrituras en STAGING: ${writes.staging}`,
    `Escrituras en PRODUCCION: ${writes.production}`,
    writes.production === 0
      ? "No se ha escrito NADA en produccion en esta ejecucion."
      : "Se ha escrito en PRODUCCION en esta ejecucion; cada escritura tiene su decision humana en la seccion TRABAJOS REALIZADOS.",
  ];
}

function costLines(cost: DepartmentRunCostSummary | null): string[] {
  if (!cost || cost.runs.length === 0) {
    return ["Coste de Claude en esta ejecucion: no reportado (no hay registros de ejecucion utilizables). No se ha estimado ninguna cifra."];
  }
  const lines = [
    `Coste total de Claude: ${formatCostUsd(cost.totalCostUsd)}${cost.partial ? " (PARCIAL: falta el coste de algun empleado, ver detalle)" : ""}.`,
    `Duracion sumada de las invocaciones: ${formatDurationMs(cost.totalDurationMs)}. Turnos totales: ${cost.totalTurns ?? "no reportados"}.`,
  ];
  for (const run of cost.runs) {
    lines.push(
      `- ${run.employee}: ${formatCostUsd(run.costUsd)}, ${formatDurationMs(run.durationMs)}, ${run.numTurns ?? "?"} turno(s), modelo ${run.model ?? "no reportado"}, salida via ${run.outputSource}, resultado ${run.outcome}.`
    );
  }
  return lines;
}

function runIdLines(runIds: ExecutionRunIds): string[] {
  return [
    `departmentRunId (pasada que produjo las propuestas): ${reported(runIds.departmentRunId)}`,
    `executionRunId (esta ejecucion): ${reported(runIds.executionRunId)}`,
    `Run del Daily Brief: ${runIds.briefRunUrl ? runIds.briefRunUrl : "no reportado"}`,
    `Run de la ejecucion: ${runIds.executionRunUrl ? runIds.executionRunUrl : "no reportado (se ejecuto fuera de GitHub Actions)"}`,
  ];
}

export function buildExecutionReportSubject(input: ExecutionReportInput): string {
  const date = input.date ?? input.generatedAt.slice(0, 10);
  // "Ejecutada" es lo que llego a escribirse, no lo que se aprobo. Una
  // aprobacion que no se pudo ejecutar (sin executor, sin credenciales,
  // version stale) se cuenta APARTE: contarla como ejecutada en el
  // asunto -- que es lo unico que mucha gente lee -- diria que se hizo
  // algo que no se hizo.
  const attempted = input.executed.filter((w) => w.outcome !== "not_executed");
  const notExecuted = input.executed.length - attempted.length;
  const failures = attempted.filter((w) => w.outcome !== "applied").length;

  const parts = [`${attempted.length} ejecutada(s)`];
  if (notExecuted > 0) parts.push(`${notExecuted} aprobada(s) sin ejecutar`);
  parts.push(`${input.rejected.length} rechazada(s)`, `${input.pending.length} pendiente(s)`);
  if (failures > 0) parts.push(`${failures} con incidencia`);
  return `Zentry AI Department — Ejecucion — ${date} — ${parts.join(", ")}`;
}

// --- Texto plano -----------------------------------------------------------

function executedTextBlock(work: ExecutedWork): string[] {
  const proposal = work.decision.proposal;
  const lines: string[] = [];
  lines.push(`[ ${proposal.number} ]  ${proposal.title}`);
  lines.push(`    ${proposalRef(proposal)}`);
  lines.push(`    Decision humana: ${humanDecisionLine(work.decision)}`);
  lines.push(`    Accion ejecutada: ${reported(work.action)}`);
  lines.push(`    Entorno: ${environmentLabel(work.environment)}`);
  lines.push("    Cambio real:");
  for (const line of changeLines(work)) lines.push(`      - ${line}`);
  lines.push(`    Validacion: ${work.validation.trim().length > 0 ? work.validation.trim() : "no se ejecuto ninguna validacion (no reportada)"}`);
  lines.push(`    RESULTADO: ${EXECUTION_OUTCOME_LABEL[work.outcome]}`);
  if (work.outcomeDetail.trim().length > 0) lines.push(`    Detalle: ${work.outcomeDetail.trim()}`);
  lines.push(`    URL: ${work.url ? work.url : "no reportada"}`);
  for (const line of rollbackLines(work.rollback)) lines.push(`    ${line}`);
  return lines;
}

function rejectedTextBlock(decision: ResolvedDecision): string[] {
  const proposal = decision.proposal;
  return [
    `[ ${proposal.number} ]  ${proposal.title}`,
    `    ${proposalRef(proposal)}`,
    // LITERAL: se imprime tal cual, con sus comillas, su markup y su
    // ortografia. Este texto alimenta previousHumanFeedback.
    `    Motivo del rechazo (literal): "${decision.reason}"`,
    "    No se ha ejecutado nada de esta propuesta.",
  ];
}

function pendingTextBlock(proposal: NumberedProposal): string[] {
  return [`[ ${proposal.number} ]  ${proposal.title}`, `    ${proposalRef(proposal)}`, `    Estado: ${proposal.statusLabel}`];
}

export function renderExecutionReportText(input: ExecutionReportInput): string {
  const lines: string[] = [];

  lines.push("ZENTRY AI DEPARTMENT -- INFORME DE EJECUCION");
  lines.push(`Pasada: ${reported(input.runIds.departmentRunId)} | Ejecucion: ${reported(input.runIds.executionRunId)} | Generado: ${input.generatedAt}`);
  lines.push("");

  lines.push("1. TRABAJOS REALIZADOS");
  lines.push("");
  if (input.executed.length === 0) {
    lines.push("No se ha ejecutado ninguna propuesta en esta sesion. No se ha escrito en ningun sistema.");
    lines.push("");
  }
  for (const work of input.executed) {
    for (const line of executedTextBlock(work)) lines.push(line);
    lines.push("");
  }

  lines.push("2. PENDIENTES");
  lines.push("");
  if (input.pending.length === 0) {
    lines.push("Ninguna propuesta ha quedado sin decision.");
    lines.push("");
  } else {
    lines.push(SILENCE_MESSAGE);
    lines.push("");
    for (const proposal of input.pending) {
      for (const line of pendingTextBlock(proposal)) lines.push(line);
      lines.push("");
    }
  }

  lines.push("3. RECHAZADAS");
  lines.push("");
  if (input.rejected.length === 0) {
    lines.push("Ninguna propuesta rechazada en esta sesion.");
    lines.push("");
  }
  for (const decision of input.rejected) {
    for (const line of rejectedTextBlock(decision)) lines.push(line);
    lines.push("");
  }

  lines.push("4. NUEVAS RECOMENDACIONES");
  lines.push("");
  if (input.newRecommendations.length === 0) {
    lines.push("Ninguna recomendacion nueva ha salido de esta ejecucion.");
    lines.push("");
  } else {
    lines.push(NEW_RECOMMENDATIONS_MESSAGE);
    lines.push("");
    for (const recommendation of input.newRecommendations) {
      lines.push(`- ${recommendation.title}`);
      lines.push(`    ${reported(recommendation.description)}`);
      lines.push(`    Origen: ${reported(recommendation.origin)}`);
      lines.push("");
    }
  }

  lines.push("5. ESCRITURAS REALES");
  lines.push("");
  for (const line of writeLines(input.writes)) lines.push(`- ${line}`);
  lines.push("");

  lines.push("6. COSTE");
  lines.push("");
  for (const line of costLines(input.cost)) lines.push(line);
  lines.push("");

  lines.push("7. TRAZABILIDAD (RUN IDS)");
  lines.push("");
  for (const line of runIdLines(input.runIds)) lines.push(`- ${line}`);
  lines.push("");

  lines.push("8. SEGURIDAD");
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

function htmlEmpty(message: string): string {
  return `<p style="margin:0;color:#54617a;">${escapeHtml(message)}</p>`;
}

function htmlBadge(number: number, color: string): string {
  return `<span style="display:inline-block;min-width:34px;text-align:center;background:${color};color:#ffffff;font-size:18px;font-weight:700;border-radius:6px;padding:4px 10px;margin-right:10px;">${number}</span>`;
}

function htmlExecuted(work: ExecutedWork): string {
  const proposal = work.decision.proposal;
  const ok = work.outcome === "applied";
  const color = ok ? "#1b6b3a" : "#b3261e";
  const changes = changeLines(work)
    .map((change) => `<li style="margin:0 0 4px;"><code style="font-size:12px;">${escapeHtml(change)}</code></li>`)
    .join("");
  const rollback = work.rollback
    ? `<div style="border-left:4px solid #b3261e;background:#fdf3f2;padding:10px 12px;margin:10px 0 0;">${rollbackLines(work.rollback)
        .map((line, index) => `<div style="${index === 0 ? "font-weight:700;color:#b3261e;" : "color:#33415c;"}">${escapeHtml(line)}</div>`)
        .join("")}</div>`
    : "";
  const detail = work.outcomeDetail.trim().length > 0 ? `<p style="margin:6px 0;color:#33415c;"><strong>Detalle:</strong> ${escapeHtml(work.outcomeDetail.trim())}</p>` : "";
  return `
    <div style="border:1px solid #d8dce3;border-radius:6px;padding:14px 16px;margin:0 0 14px;">
      <div>${htmlBadge(proposal.number, color)}<span style="font-weight:600;font-size:15px;color:#0b1b33;">${escapeHtml(proposal.title)}</span></div>
      <p style="margin:10px 0 6px;color:#54617a;font-size:12px;"><code>${escapeHtml(proposalRef(proposal))}</code></p>
      <p style="margin:6px 0;color:#33415c;"><strong>Decision humana:</strong> ${escapeHtml(humanDecisionLine(work.decision))}</p>
      <p style="margin:6px 0;color:#33415c;"><strong>Accion ejecutada:</strong> ${escapeHtml(reported(work.action))}</p>
      <p style="margin:6px 0;color:#33415c;"><strong>Entorno:</strong> ${escapeHtml(environmentLabel(work.environment))}</p>
      <p style="margin:6px 0 4px;color:#33415c;"><strong>Cambio real:</strong></p>
      <ul style="margin:0 0 8px;padding-left:20px;">${changes}</ul>
      <p style="margin:6px 0;color:#33415c;"><strong>Validacion:</strong> ${escapeHtml(
        work.validation.trim().length > 0 ? work.validation.trim() : "no se ejecuto ninguna validacion (no reportada)"
      )}</p>
      <p style="margin:6px 0;"><strong>RESULTADO:</strong> <span style="color:${color};font-weight:700;">${escapeHtml(EXECUTION_OUTCOME_LABEL[work.outcome])}</span></p>
      ${detail}
      <p style="margin:6px 0;color:#33415c;"><strong>URL:</strong> ${escapeHtml(work.url ? work.url : "no reportada")}</p>
      ${rollback}
    </div>`;
}

function htmlRejected(decision: ResolvedDecision): string {
  const proposal = decision.proposal;
  return `
    <div style="border:1px solid #d8dce3;border-radius:6px;padding:14px 16px;margin:0 0 14px;">
      <div>${htmlBadge(proposal.number, "#8a6100")}<span style="font-weight:600;font-size:15px;color:#0b1b33;">${escapeHtml(proposal.title)}</span></div>
      <p style="margin:10px 0 6px;color:#54617a;font-size:12px;"><code>${escapeHtml(proposalRef(proposal))}</code></p>
      <p style="margin:6px 0;color:#33415c;"><strong>Motivo del rechazo (literal):</strong> &quot;${escapeHtml(decision.reason)}&quot;</p>
      <p style="margin:6px 0 0;color:#54617a;">No se ha ejecutado nada de esta propuesta.</p>
    </div>`;
}

function htmlPending(proposal: NumberedProposal): string {
  return `
    <div style="border:1px solid #d8dce3;border-radius:6px;padding:12px 14px;margin:0 0 10px;">
      <div>${htmlBadge(proposal.number, "#54617a")}<span style="font-weight:600;font-size:15px;color:#0b1b33;">${escapeHtml(proposal.title)}</span></div>
      <p style="margin:8px 0 4px;color:#54617a;font-size:12px;"><code>${escapeHtml(proposalRef(proposal))}</code></p>
      <p style="margin:4px 0 0;color:#33415c;"><strong>Estado:</strong> ${escapeHtml(proposal.statusLabel)}</p>
    </div>`;
}

export function renderExecutionReportHtml(input: ExecutionReportInput): string {
  const executed =
    input.executed.length === 0 ? htmlEmpty("No se ha ejecutado ninguna propuesta en esta sesion. No se ha escrito en ningun sistema.") : input.executed.map(htmlExecuted).join("");

  const pending =
    input.pending.length === 0
      ? htmlEmpty("Ninguna propuesta ha quedado sin decision.")
      : `<p style="margin:0 0 12px;color:#33415c;">${escapeHtml(SILENCE_MESSAGE)}</p>${input.pending.map(htmlPending).join("")}`;

  const rejected = input.rejected.length === 0 ? htmlEmpty("Ninguna propuesta rechazada en esta sesion.") : input.rejected.map(htmlRejected).join("");

  const recommendations =
    input.newRecommendations.length === 0
      ? htmlEmpty("Ninguna recomendacion nueva ha salido de esta ejecucion.")
      : `<p style="margin:0 0 12px;color:#33415c;">${escapeHtml(NEW_RECOMMENDATIONS_MESSAGE)}</p>${input.newRecommendations
          .map(
            (recommendation) => `
      <div style="border:1px solid #d8dce3;border-radius:6px;padding:12px 14px;margin:0 0 10px;">
        <div style="font-weight:600;color:#0b1b33;">${escapeHtml(recommendation.title)}</div>
        <p style="margin:6px 0;color:#33415c;">${escapeHtml(reported(recommendation.description))}</p>
        <p style="margin:0;color:#54617a;font-size:13px;">Origen: ${escapeHtml(reported(recommendation.origin))}</p>
      </div>`
          )
          .join("")}`;

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#33415c;max-width:760px;margin:0 auto;padding:24px;">
  <h1 style="font-size:20px;margin:0 0 4px;color:#0b1b33;">Zentry AI Department &mdash; Informe de ejecucion</h1>
  <p style="margin:0 0 20px;color:#54617a;font-size:13px;">Pasada <code>${escapeHtml(reported(input.runIds.departmentRunId))}</code> &nbsp;|&nbsp; ejecucion <code>${escapeHtml(
    reported(input.runIds.executionRunId)
  )}</code> &nbsp;|&nbsp; generado ${escapeHtml(input.generatedAt)}</p>

  ${htmlSection("1. TRABAJOS REALIZADOS", executed)}

  ${htmlSection("2. PENDIENTES", pending)}

  ${htmlSection("3. RECHAZADAS", rejected)}

  ${htmlSection("4. NUEVAS RECOMENDACIONES", recommendations)}

  ${htmlSection("5. ESCRITURAS REALES", htmlList(writeLines(input.writes)))}

  ${htmlSection("6. COSTE", htmlList(costLines(input.cost)))}

  ${htmlSection("7. TRAZABILIDAD (RUN IDS)", htmlList(runIdLines(input.runIds)))}

  <div style="margin-top:28px;border:1px solid #d8dce3;background:#f6f8fb;border-radius:6px;padding:14px 16px;color:#0b1b33;">
    <strong>Seguridad:</strong> ${escapeHtml(SAFETY_MESSAGE)}
  </div>
</div>`;
}

export function buildExecutionReportEmail(input: ExecutionReportInput): ExecutionReportEmail {
  return {
    subject: buildExecutionReportSubject(input),
    text: renderExecutionReportText(input),
    html: renderExecutionReportHtml(input),
  };
}
