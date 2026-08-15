import { DepartmentChangeRequest } from "../department/apply/change-types";
import { DepartmentChangeStatus } from "../department/apply/state-machine";

/**
 * PUERTO DE PERSISTENCIA de las aprobaciones del departamento.
 *
 * Es el contrato que sustituye al registro en fichero de la fase
 * anterior (`data/department-changes.jsonl`, atado al filesystem del
 * VPS). Tiene DOS implementaciones y ninguna mas:
 *
 *   - `D1ApprovalStore` (src/worker/**): la unica que toca la base de
 *     datos. Vive dentro del Worker de Cloudflare.
 *   - `HttpApprovalStore` (src/approvals/http-store.ts): la que usan los
 *     workflows de GitHub Actions, hablando con el Worker por HTTPS con
 *     un token de servicio. Actions NUNCA tiene credenciales de la base
 *     de datos.
 *
 * Modulo deliberadamente RUNTIME-AGNOSTICO: solo tipos e interfaces, sin
 * `fs`, sin `crypto` de Node, sin `fetch`. Asi lo puede importar tanto el
 * Worker (que no es Node) como los scripts de Actions (que si lo son).
 *
 * --- La primitiva de seguridad de todo el sistema ---
 *
 * `transition()` es CONDICIONAL: solo mueve el estado si el actual esta
 * en `expectedFrom`. La implementacion tiene que resolverlo en UNA sola
 * operacion atomica (`UPDATE ... WHERE status IN (...)` y mirar cuantas
 * filas cambiaron), nunca con un read-then-write. De ahi salen gratis:
 *
 *   - dos APPROVE simultaneos      -> uno gana, el otro ve `conflict`
 *   - dos webhooks duplicados      -> un solo encolado, un solo dispatch
 *   - approve sobre algo rechazado -> `conflict`, sin efectos
 */

/** Una aprobacion es exactamente el cambio del departamento: no se duplica el modelo de datos. */
export type Approval = DepartmentChangeRequest;

/** `changeId` ES el approvalId -- se nombra asi donde el vocabulario del dominio es "aprobacion". */
export function approvalIdOf(approval: Approval): string {
  return approval.changeId;
}

export type TransitionOutcome =
  | { ok: true; approval: Approval }
  /** El estado actual no estaba en `expectedFrom`: otro actor llego antes, o el callback es viejo. */
  | { ok: false; reason: "conflict"; currentStatus: DepartmentChangeStatus | null; approval: Approval | null }
  | { ok: false; reason: "not_found"; currentStatus: null; approval: null }
  /** La transicion no existe en la maquina de estados. Nunca deberia ocurrir: es un bug, no una carrera. */
  | { ok: false; reason: "illegal_transition"; currentStatus: DepartmentChangeStatus | null; approval: Approval | null };

export interface TransitionInput {
  approvalId: string;
  /** Estados de origen aceptables. La transicion solo ocurre si el actual es uno de ellos. */
  expectedFrom: DepartmentChangeStatus[];
  to: DepartmentChangeStatus;
  /** Campos a actualizar junto con el estado, en la MISMA operacion atomica. */
  patch?: ApprovalPatch;
  audit: { event: string; detail: string };
  /** ISO. Lo pone quien llama para que el store sea testeable sin reloj real. */
  at: string;
}

/** Campos actualizables. Deliberadamente acotado: la identidad y el historico no se tocan. */
export interface ApprovalPatch {
  telegram?: Approval["telegram"];
  humanDecision?: Approval["humanDecision"];
  staging?: Approval["staging"];
  production?: Approval["production"];
  /** Id del run de GitHub Actions que esta publicando (o publico) en produccion. */
  productionRunId?: string | null;
  inheritedFeedback?: string[];
}

/** Resultado de registrar un update de Telegram ya procesado (idempotencia de webhook). */
export interface ProcessedUpdateResult {
  /** `true` = es la PRIMERA vez que se ve este update_id. `false` = replay, no volver a actuar. */
  isNew: boolean;
}

/** Pregunta abierta "¿por que lo rechazas?", correlacionada por chat + usuario. */
export interface PendingRejectionPrompt {
  approvalId: string;
  chatId: string;
  userId: string;
  /** message_id del mensaje del bot que pidio el motivo: permite correlacionar por `reply_to_message_id`. */
  promptMessageId: number | null;
  createdAt: string;
}

export interface ApprovalStore {
  get(approvalId: string): Promise<Approval | null>;

  /** Todas las versiones de una recomendacion, de la mas antigua a la mas nueva. */
  listByRecommendation(recommendationId: string): Promise<Approval[]>;

  listByRun(departmentRunId: string): Promise<Approval[]>;

  /** Crea la aprobacion. Idempotente por `changeId`: si ya existe, devuelve la existente sin tocarla. */
  create(approval: Approval): Promise<{ approval: Approval; created: boolean }>;

  /** Transicion CONDICIONAL y ATOMICA. Ver la nota de arriba: es la primitiva de idempotencia. */
  transition(input: TransitionInput): Promise<TransitionOutcome>;

  /** Anota datos y auditoria SIN mover el estado. */
  annotate(approvalId: string, patch: ApprovalPatch, audit: { event: string; detail: string }, at: string): Promise<Approval | null>;

  /**
   * Registra un `update_id` de Telegram. Atomico: si ya estaba, devuelve
   * `isNew: false` y quien llama debe abortar sin efectos.
   */
  markUpdateProcessed(updateId: number, at: string): Promise<ProcessedUpdateResult>;

  openRejectionPrompt(prompt: PendingRejectionPrompt): Promise<void>;

  /** Prompt abierto para ese chat+usuario. `null` si no hay ninguno. */
  findOpenRejectionPrompt(chatId: string, userId: string): Promise<PendingRejectionPrompt | null>;

  /** Correlacion preferente: el prompt cuyo mensaje del bot es el que el usuario respondio. */
  findRejectionPromptByMessageId(chatId: string, promptMessageId: number): Promise<PendingRejectionPrompt | null>;

  closeRejectionPrompt(approvalId: string): Promise<void>;

  /** Feedback humano de versiones anteriores de una recomendacion, para el contexto de los agentes. */
  listHumanFeedback(recommendationId: string): Promise<HumanFeedbackEntry[]>;
}

/**
 * Feedback humano tal cual se dio, sin reinterpretar. Los agentes lo
 * reciben como EVIDENCIA de una decision humana previa -- no se entrena
 * nada con esto, no se resume y no se parafrasea.
 */
export interface HumanFeedbackEntry {
  approvalId: string;
  recommendationId: string;
  recommendationTitle: string;
  version: number;
  rejectionReason: string;
  rejectedAt: string;
}
