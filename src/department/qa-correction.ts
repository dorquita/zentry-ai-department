import { QaReviewerOutput } from "../employees/qa-reviewer/output";

/**
 * BUCLE QA -> CORRECCION -> RE-QA.
 *
 * EL COMPORTAMIENTO QUE SUSTITUYE:
 *
 *     empleado -> QA -> FAIL -> FIN
 *
 * QA bloqueaba, el Daily Brief se lo contaba a una persona, y ahi moria
 * la pasada. La unica "recuperacion" era que la pasada del dia siguiente
 * volviera a generar la misma propuesta desde cero, sin ninguna memoria
 * de que QA la habia bloqueado ni de por que.
 *
 * EL COMPORTAMIENTO NUEVO:
 *
 *     empleado -> QA -> FAIL -> requiredCorrections[]
 *              -> responsable del cambio -> correccion
 *              -> QA otra vez -> PASS
 *
 * Este modulo es la parte PURA: normaliza lo que QA devuelve, decide que
 * hacer despues y lleva la cuenta de rondas. No invoca a nadie, no lee
 * ficheros y no conoce GitHub Actions.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN:
 *
 *   1. LIMITE DURO DE RONDAS. Por defecto 2 correcciones automaticas. Al
 *      agotarse, el resultado es `NEEDS_HUMAN_REVIEW` con el motivo -- y
 *      `NEEDS_HUMAN_REVIEW` no es un PASS disfrazado: no promueve nada,
 *      no habilita ningun apply y se reporta como lo que es.
 *
 *   2. UN FAIL NUNCA SE MAQUILLA. La unica forma de salir del bucle en
 *      verde es que una revision POSTERIOR, sobre el OUTPUT NUEVO, diga
 *      que pasa. Reutilizar el veredicto de una ronda anterior, o
 *      degradar un `fail` a `pass_with_warnings` por haberlo intentado
 *      ya dos veces, seria mentir sobre el estado del sistema.
 */

/** Maximo de rondas de correccion AUTOMATICA por artifact. */
export const MAX_AUTOMATIC_CORRECTION_ROUNDS = 2;

/**
 * Una correccion accionable. Es lo que el responsable del cambio recibe
 * para poder corregir, en vez de una frase suelta.
 *
 * `problem` es el unico campo garantizado: cuando QA solo devuelve texto
 * plano (el contrato antiguo), el texto entero se conserva ahi literal.
 * El resto llega vacio y se dice que llega vacio -- nunca se rellena a
 * base de adivinar que queria decir la frase.
 */
export interface QaCorrectionRequest {
  /** Campo del artifact que esta mal. Vacio = QA no lo concreto. */
  field: string;
  /** Que esta mal. Nunca vacio. */
  problem: string;
  /** Como se sabra que quedo resuelto. Vacio = QA no declaro criterio. */
  expectedCriterion: string;
  /** Evidencia concreta que respalda la correccion. */
  evidence: string[];
  /** Recomendacion a la que afecta, si QA la concreto. */
  targetRecommendationId: string;
  /** `false` = observacion de mejora; no impide aprobar por si sola. */
  blocking: boolean;
  /** `true` si vino como texto plano del contrato antiguo. */
  fromPlainText: boolean;
}

/** Forma estructurada opcional que qa-reviewer puede devolver ademas del texto. */
interface RawCorrectionRequest {
  field?: unknown;
  problem?: unknown;
  expectedCriterion?: unknown;
  evidence?: unknown;
  targetRecommendationId?: unknown;
  blocking?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}

/**
 * Normaliza las correcciones de una revision.
 *
 * TOLERANTE A LA ENTRADA, ESTRICTO HACIA ABAJO. qa-reviewer puede
 * devolver `correctionRequests[]` ya estructurado (contrato nuevo) o solo
 * `requiredCorrections[]` como texto (contrato de siempre, que sigue
 * siendo obligatorio en el schema). Las dos formas producen el mismo
 * tipo aqui.
 *
 * Por que tolerante: si esto exigiera la forma nueva, una revision
 * perfectamente valida que no la trajera se leeria como "sin
 * correcciones" -- es decir, un FAIL se convertiria en silencio en algo
 * indistinguible de un PASS. Preferimos una correccion pobre y marcada
 * como pobre (`fromPlainText: true`) a perderla.
 */
export function normalizeQaCorrections(output: QaReviewerOutput): QaCorrectionRequest[] {
  const structured = (output as unknown as { correctionRequests?: unknown }).correctionRequests;
  const corrections: QaCorrectionRequest[] = [];

  if (Array.isArray(structured)) {
    for (const entry of structured) {
      if (typeof entry !== "object" || entry === null) continue;
      const raw = entry as RawCorrectionRequest;
      const problem = asString(raw.problem);
      if (problem.length === 0) continue;
      corrections.push({
        field: asString(raw.field),
        problem,
        expectedCriterion: asString(raw.expectedCriterion),
        evidence: asStringArray(raw.evidence),
        targetRecommendationId: asString(raw.targetRecommendationId),
        // Fail-closed: una correccion que no declara si bloquea, bloquea.
        blocking: raw.blocking === false ? false : true,
        fromPlainText: false,
      });
    }
  }

  // El texto plano se conserva SIEMPRE que no este ya representado: es el
  // unico campo que el schema garantiza, y perderlo por tener la forma
  // nueva a medias seria perder el motivo real del bloqueo.
  const alreadyCovered = new Set(corrections.map((c) => c.problem.toLowerCase()));
  for (const text of asStringArray(output.requiredCorrections)) {
    if (alreadyCovered.has(text.toLowerCase())) continue;
    corrections.push({
      field: "",
      problem: text,
      expectedCriterion: "",
      evidence: [],
      targetRecommendationId: "",
      blocking: true,
      fromPlainText: true,
    });
  }

  return corrections;
}

/**
 * Un `fail` de QA no es la unica forma de bloquear: un finding `critical`
 * o un `safetyConcern` bloquean aunque el veredicto global diga `pass`.
 * Es exactamente el mismo criterio que ya usa la puerta de promocion, y
 * se replica aqui a proposito en vez de inventar uno nuevo.
 */
export function reviewIsBlocking(output: QaReviewerOutput): boolean {
  if (output.reviewStatus === "fail") return true;
  if (output.findings.some((finding) => finding.severity === "critical")) return true;
  if (output.safetyConcerns.length > 0) return true;
  return false;
}

export type QaLoopAction = "accept" | "request_correction" | "needs_human_review";

export interface QaLoopDecision {
  action: QaLoopAction;
  /** Ronda de correccion que hay que ejecutar. Solo en `request_correction`. */
  nextRound: number | null;
  /** Correcciones que debe recibir el responsable. Vacio salvo en `request_correction`. */
  corrections: QaCorrectionRequest[];
  /** Siempre no vacio, tambien al aceptar. */
  reason: string;
}

export interface DecideQaLoopInput {
  /** Revision recien hecha, sobre el OUTPUT DE ESTA RONDA. Nunca una anterior. */
  review: QaReviewerOutput;
  /**
   * Ronda que se acaba de revisar. 0 = la propuesta original. 1 = la
   * primera correccion. 2 = la segunda.
   */
  round: number;
  maxRounds?: number;
}

/**
 * Decide que pasa despues de una revision. Es el corazon del bucle.
 *
 * La cuenta de rondas es sobre CORRECCIONES YA HECHAS, no sobre
 * revisiones: con `maxRounds = 2`, la ronda 0 (original) y la 1 (primera
 * correccion) pueden pedir correccion; la 2 ya no, porque autorizar una
 * tercera seria la tercera correccion.
 */
export function decideQaLoop(input: DecideQaLoopInput): QaLoopDecision {
  const maxRounds = input.maxRounds ?? MAX_AUTOMATIC_CORRECTION_ROUNDS;

  if (!reviewIsBlocking(input.review)) {
    return {
      action: "accept",
      nextRound: null,
      corrections: [],
      reason:
        input.round === 0
          ? `QA acepto la propuesta original (reviewStatus=${input.review.reviewStatus}, sin findings criticos ni riesgos de seguridad).`
          : `QA acepto la correccion de la ronda ${input.round} (reviewStatus=${input.review.reviewStatus}). El veredicto es sobre el output NUEVO, no sobre el anterior.`,
    };
  }

  const corrections = normalizeQaCorrections(input.review);

  if (input.round >= maxRounds) {
    return {
      action: "needs_human_review",
      nextRound: null,
      corrections,
      reason: `QA sigue bloqueando despues de ${maxRounds} ronda(s) de correccion automatica. Se para aqui a proposito: seguir iterando seria gastar invocaciones en un problema que el bucle no sabe resolver. Motivo de QA: ${input.review.summary || "sin resumen"}. Correcciones pendientes: ${corrections.length}.`,
    };
  }

  if (corrections.length === 0) {
    // QA bloquea pero no dice que corregir. Reinvocar al responsable sin
    // decirle que arreglar es tirar una invocacion a la basura y, peor,
    // invitarle a cambiar cosas al azar hasta que pase.
    return {
      action: "needs_human_review",
      nextRound: null,
      corrections: [],
      reason: `QA bloquea (reviewStatus=${input.review.reviewStatus}) pero no ha declarado ninguna correccion accionable. Sin saber QUE corregir, una correccion automatica seria un cambio a ciegas. Motivo de QA: ${input.review.summary || "sin resumen"}.`,
    };
  }

  const blocking = corrections.filter((correction) => correction.blocking);
  return {
    action: "request_correction",
    nextRound: input.round + 1,
    corrections,
    reason: `QA bloquea con ${blocking.length} correccion(es) bloqueante(s) de ${corrections.length}. Se pide correccion al responsable (ronda ${input.round + 1} de ${maxRounds}) y despues se vuelve a revisar el output NUEVO.`,
  };
}

// --- Trazabilidad -----------------------------------------------------------

/**
 * Registro de UNA vuelta del bucle. La trazabilidad no es opcional: sin
 * `revision` y `qaAttempt` no hay forma de demostrar que la revision que
 * dio PASS se hizo sobre el output corregido y no sobre el anterior.
 */
export interface QaLoopRound {
  /** Version del artifact revisado. 0 = original. */
  revision: number;
  /** Numero de revision de QA. Siempre `revision + 1`: hay una por version. */
  qaAttempt: number;
  /** Empleado responsable del artifact revisado. */
  employee: string;
  reviewStatus: string;
  blocking: boolean;
  action: QaLoopAction;
  corrections: QaCorrectionRequest[];
  reason: string;
  /** Ruta repo-relativa del output revisado EN ESTA ronda. */
  reviewedOutputPath: string;
  /** Ruta repo-relativa de la revision de QA de ESTA ronda. */
  reviewOutputPath: string;
  at: string;
}

export interface QaLoopRecord {
  contractVersion: string;
  departmentRunId: string;
  employee: string;
  maxRounds: number;
  rounds: QaLoopRound[];
  /** Estado final del bucle. `in_progress` mientras quedan rondas por hacer. */
  finalStatus: "in_progress" | "PASS" | "NEEDS_HUMAN_REVIEW";
  finalReason: string;
}

export const QA_LOOP_CONTRACT_VERSION = "qa-correction-loop/v1";

export function emptyQaLoopRecord(departmentRunId: string, employee: string, maxRounds = MAX_AUTOMATIC_CORRECTION_ROUNDS): QaLoopRecord {
  return {
    contractVersion: QA_LOOP_CONTRACT_VERSION,
    departmentRunId,
    employee,
    maxRounds,
    rounds: [],
    finalStatus: "in_progress",
    finalReason: "El bucle de QA todavia no ha terminado.",
  };
}

/** Anade una ronda y resuelve el estado final. Puro: devuelve un registro nuevo. */
export function appendQaLoopRound(record: QaLoopRecord, round: QaLoopRound): QaLoopRecord {
  const rounds = [...record.rounds, round];
  const finalStatus: QaLoopRecord["finalStatus"] =
    round.action === "accept" ? "PASS" : round.action === "needs_human_review" ? "NEEDS_HUMAN_REVIEW" : "in_progress";
  return { ...record, rounds, finalStatus, finalReason: round.reason };
}

/** Resumen de una linea por ronda, para el log de la pasada y el informe. */
export function renderQaLoopSummary(record: QaLoopRecord): string[] {
  if (record.rounds.length === 0) return [`Bucle de QA de ${record.employee}: sin rondas registradas.`];
  const lines = record.rounds.map(
    (round) =>
      `  revision=${round.revision} qaAttempt=${round.qaAttempt} reviewStatus=${round.reviewStatus} -> ${round.action}` +
      (round.corrections.length > 0 ? ` (${round.corrections.length} correccion(es))` : "")
  );
  return [`Bucle de QA de ${record.employee}: ${record.finalStatus}. ${record.finalReason}`, ...lines];
}
