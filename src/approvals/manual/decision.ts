import { NumberedProposal } from "./proposal";

/**
 * DECISION HUMANA dada por prompt, sobre el Daily Brief numerado.
 *
 * Reparto de responsabilidades, deliberado:
 *
 *   - CLAUDE interpreta el lenguaje natural ("aprueba todas menos la 7")
 *     y produce una lista de `HumanInstruction`. Eso es razonamiento.
 *   - ESTE MODULO valida esa lista contra las propuestas reales y decide
 *     que se puede ejecutar. Eso es determinismo, y por eso vive en
 *     codigo con tests en vez de en la cabeza del modelo.
 *
 * Reglas duras, todas con test:
 *
 * 1. EL SILENCIO NO ES APROBACION. Una propuesta sobre la que no se dijo
 *    nada queda `pending`. Nunca se ejecuta "porque estaba en la lista".
 * 2. Un numero que no existe es un ERROR de la instruccion entera, no un
 *    elemento que se ignora: si la persona dice "aprueba 9" y no hay 9,
 *    lo mas probable es que este mirando otro informe.
 * 3. Un numero repetido con acciones distintas es ambiguo -> error.
 * 4. Aprobar algo no accionable no lo hace accionable: se reporta y no se
 *    ejecuta.
 * 5. Un rechazo SIN motivo no se acepta: el motivo es el producto del
 *    rechazo (alimenta `previousHumanFeedback`).
 * 6. Una modificacion que la capacidad no sabe hacer NO se aplica a
 *    medias: se rechaza la ejecucion de esa propuesta y se dice por que.
 *
 * Modulo PURO: sin I/O, sin reloj.
 */

export type HumanAction = "approve" | "reject" | "defer";

/** Donde se aplica una aprobacion. Por defecto STAGING: publicar en produccion se pide aparte y explicitamente. */
export type ApprovalTarget = "staging" | "production";

/** Lo que Claude extrae del prompt, ya normalizado a numeros y acciones. */
export interface HumanInstruction {
  number: number;
  action: HumanAction;
  /** Obligatorio para `reject`. Se guarda LITERAL como feedback humano. */
  reason?: string;
  /** Modificaciones pedidas antes de aplicar ("cambia el title por X"). */
  overrides?: { title?: string; metaDescription?: string };
  /** Solo para `approve`. Ausente = staging. */
  target?: ApprovalTarget;
}

export interface ResolvedDecision {
  proposal: NumberedProposal;
  action: HumanAction;
  target: ApprovalTarget;
  reason: string;
  overrides: { title?: string; metaDescription?: string };
  /** `true` solo si esta decision debe traducirse en una escritura real. */
  executable: boolean;
  /** Por que NO es ejecutable. Vacio si lo es. */
  blockedReason: string;
}

export interface ResolveDecisionsInput {
  proposals: NumberedProposal[];
  instructions: HumanInstruction[];
}

export interface ResolveDecisionsResult {
  ok: boolean;
  /** Errores que invalidan la instruccion COMPLETA. Si hay alguno, no se ejecuta nada. */
  errors: string[];
  decisions: ResolvedDecision[];
  /** Propuestas sobre las que no se dijo nada: quedan pendientes, nunca aprobadas. */
  untouched: NumberedProposal[];
  /** Resumen legible de como se ha interpretado la instruccion, para confirmarlo con la persona ANTES de ejecutar. */
  interpretation: string[];
}

const MIN_REASON_LENGTH = 3;

function describeAction(decision: ResolvedDecision): string {
  const base = `#${decision.proposal.number} "${decision.proposal.title}" (${decision.proposal.id})`;
  if (decision.action === "reject") return `${base} -> RECHAZAR. Motivo: "${decision.reason}"`;
  if (decision.action === "defer") return `${base} -> DEJAR PENDIENTE (no se toca nada)`;
  const overrides = Object.entries(decision.overrides)
    .filter(([, value]) => typeof value === "string")
    .map(([field, value]) => `${field} := "${String(value)}"`);
  const target = decision.target === "production" ? "PRODUCCION" : "STAGING";
  const suffix = overrides.length > 0 ? ` con modificaciones (${overrides.join("; ")})` : "";
  const blocked = decision.executable ? "" : ` -- NO SE EJECUTARA: ${decision.blockedReason}`;
  return `${base} -> APROBAR y aplicar en ${target}${suffix}${blocked}`;
}

/**
 * Valida las instrucciones contra las propuestas reales. Fail-closed: si
 * devuelve `ok: false`, quien llama NO debe ejecutar absolutamente nada.
 */
export function resolveHumanDecisions(input: ResolveDecisionsInput): ResolveDecisionsResult {
  const errors: string[] = [];
  const seen = new Map<number, HumanInstruction>();

  for (const instruction of input.instructions) {
    if (!Number.isInteger(instruction.number) || instruction.number < 1) {
      errors.push(`"${String(instruction.number)}" no es un numero de propuesta valido.`);
      continue;
    }
    const previous = seen.get(instruction.number);
    if (previous) {
      if (previous.action !== instruction.action) {
        errors.push(`La propuesta #${instruction.number} aparece con dos acciones distintas ("${previous.action}" y "${instruction.action}"). Ambiguo: no se ejecuta nada.`);
      }
      continue;
    }
    seen.set(instruction.number, instruction);

    const proposal = input.proposals.find((p) => p.number === instruction.number);
    if (!proposal) {
      errors.push(
        `No existe la propuesta #${instruction.number} en esta pasada (hay ${input.proposals.length}). Puede que estes mirando un Daily Brief distinto: no se ejecuta nada.`
      );
      continue;
    }
    if (instruction.action === "reject" && (instruction.reason ?? "").trim().length < MIN_REASON_LENGTH) {
      errors.push(`El rechazo de #${instruction.number} no trae motivo. El motivo es justo lo que se guarda para las siguientes propuestas: sin el, no se registra el rechazo.`);
    }
  }

  const decisions: ResolvedDecision[] = [];
  for (const [number, instruction] of seen) {
    const proposal = input.proposals.find((p) => p.number === number);
    if (!proposal) continue;

    const overrides = instruction.overrides ?? {};
    const target: ApprovalTarget = instruction.target ?? "staging";
    let executable = instruction.action === "approve";
    let blockedReason = "";

    if (executable && !proposal.actionable) {
      executable = false;
      blockedReason = proposal.notActionableReason;
    }
    // Una modificacion que la capacidad no sabe hacer no se aplica a
    // medias ni se ignora en silencio.
    const unsupportedOverride = Object.keys(overrides).find((field) => field !== "title" && field !== "metaDescription");
    if (executable && unsupportedOverride) {
      executable = false;
      blockedReason = `La modificacion pedida sobre "${unsupportedOverride}" no la sabe hacer ninguna capacidad determinista de hoy. Requiere implementacion manual en staging.`;
    }

    const decision: ResolvedDecision = {
      proposal,
      action: instruction.action,
      target,
      reason: (instruction.reason ?? "").trim(),
      overrides: {
        ...(typeof overrides.title === "string" ? { title: overrides.title } : {}),
        ...(typeof overrides.metaDescription === "string" ? { metaDescription: overrides.metaDescription } : {}),
      },
      executable,
      blockedReason,
    };
    decisions.push(decision);
  }

  decisions.sort((a, b) => a.proposal.number - b.proposal.number);
  const decidedNumbers = new Set(decisions.map((d) => d.proposal.number));
  const untouched = input.proposals.filter((p) => !decidedNumbers.has(p.number));

  const interpretation = decisions.map(describeAction);
  if (untouched.length > 0) {
    interpretation.push(
      `Sin instruccion (quedan PENDIENTES, no se tocan): ${untouched.map((p) => `#${p.number}`).join(", ")}. El silencio nunca se interpreta como aprobacion.`
    );
  }

  return { ok: errors.length === 0, errors, decisions, untouched, interpretation };
}
