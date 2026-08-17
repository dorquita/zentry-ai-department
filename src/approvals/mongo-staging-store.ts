import { DepartmentChangeRequest } from "../department/apply/change-types";
import { checkTransition, DepartmentChangeStatus } from "../department/apply/state-machine";
import { DepartmentStateRepository } from "../persistence/repositories";
import { Approval, ApprovalPatch, HumanFeedbackEntry } from "./store";

/**
 * PERSISTENCIA DEL CAMBIO DE STAGING EN MONGODB.
 *
 * EL PROBLEMA QUE RESUELVE. La fase `stage` (el apply automatico en
 * staging) empezaba asi:
 *
 *     if (!isServerlessApprovalsEnabled()) throw ...
 *
 * y despues construia su store con `createHttpApprovalStoreFromEnv()`.
 * Es decir: para aplicar un cambio en STAGING hacia falta el carril
 * serverless entero -- Worker de Cloudflare, D1, webhook de Telegram y
 * los secretos `APPROVALS_API_URL` / `APPROVALS_API_TOKEN`. Ese carril
 * esta implementado y probado, pero NO desplegado. Resultado: el apply
 * automatico en staging era inalcanzable, no por una decision de
 * seguridad, sino por una dependencia de infraestructura que no tiene
 * nada que ver con escribir en staging.
 *
 * Y es una dependencia que ya no se sostiene: desde O56/O57 el estado
 * autoritativo del departamento es MongoDB. El registro del cambio cabe
 * ahi, en la coleccion de entidades que ya existe, sin infraestructura
 * nueva.
 *
 * QUE HACE Y QUE NO HACE, explicitamente:
 *
 *   SI  Persiste el cambio de STAGING: crear, leer, transicionar y
 *       anotar, con la maquina de estados de siempre.
 *   NO  El carril de PRODUCCION. Cualquier transicion a un estado
 *       `production_*` se RECHAZA aqui, no se "soporta con cuidado".
 *   NO  El carril de Telegram (updates procesados, prompts de rechazo).
 *       Esos metodos lanzan en vez de devolver un valor inocuo: un
 *       no-op silencioso en un mecanismo de idempotencia de webhooks es
 *       peor que un fallo.
 *
 * SOBRE LA ATOMICIDAD, que es la parte delicada. El contrato de
 * `ApprovalStore.transition()` exige resolver la transicion condicional
 * en UNA operacion atomica, porque de ahi sale gratis la idempotencia
 * frente a dos APPROVE simultaneos o dos webhooks duplicados. El puerto
 * de persistencia de este repositorio expone solo `insertIfAbsent` y
 * `upsertIfNewer`, asi que aqui la transicion es read-then-write y NO
 * ofrece esa garantia.
 *
 * Por eso este store se limita al carril de staging, donde no hay
 * concurrencia que romper:
 *
 *   - la pasada diaria corre con `concurrency` en el workflow, que
 *     serializa las pasadas: hay UN escritor;
 *   - no hay webhook ni callback que pueda llegar dos veces;
 *   - y el unico estado que puede provocar una carrera de verdad
 *     (`production_queued -> production_applying`, la reclamacion que
 *     garantiza un solo dispatch) esta prohibido aqui por construccion.
 *
 * Escribirlo sin esta nota, o dejar la puerta de produccion entornada,
 * seria el tipo de atajo que funciona mil veces y falla la vez que
 * importa.
 */

const CHANGE_ENTITY_KIND = "department_change";

/** Estados del carril de produccion. Ninguno es alcanzable desde este store. */
const PRODUCTION_STATUSES: DepartmentChangeStatus[] = [
  "production_queued",
  "production_applying",
  "production_applied",
  "production_validation_failed",
  "production_rolled_back",
];

function assertNotProduction(to: DepartmentChangeStatus): void {
  if (PRODUCTION_STATUSES.includes(to)) {
    throw new Error(
      `El store de staging en MongoDB no puede mover un cambio a "${to}". El carril de produccion exige la transicion condicional ATOMICA del datastore serverless (es lo que garantiza un solo dispatch aunque el callback llegue dos veces) y una aprobacion humana explicita de la version exacta que hay en staging.`
    );
  }
}

export class MongoStagingChangeStore {
  constructor(private readonly repository: DepartmentStateRepository) {}

  private toApproval(document: { payload: Record<string, unknown> } | null): Approval | null {
    if (!document) return null;
    return document.payload as unknown as Approval;
  }

  private async save(approval: Approval): Promise<void> {
    await this.repository.entities.saveEntity({
      kind: CHANGE_ENTITY_KIND,
      entityId: approval.changeId,
      status: approval.status,
      departmentRunId: approval.departmentRunId,
      recordUpdatedAt: approval.updatedAt,
      payload: approval as unknown as Record<string, unknown>,
    });
  }

  async get(approvalId: string): Promise<Approval | null> {
    return this.toApproval(await this.repository.entities.getEntity(CHANGE_ENTITY_KIND, approvalId));
  }

  /** Todas las versiones de una recomendacion, de la mas antigua a la mas nueva. */
  async listByRecommendation(recommendationId: string): Promise<Approval[]> {
    const all = await this.repository.entities.listByKind(CHANGE_ENTITY_KIND);
    return all
      .map((doc) => doc.payload as unknown as Approval)
      .filter((approval) => approval.recommendationId === recommendationId)
      .sort((a, b) => a.version - b.version);
  }

  async listByRun(departmentRunId: string): Promise<Approval[]> {
    const all = await this.repository.entities.listByKind(CHANGE_ENTITY_KIND);
    return all
      .map((doc) => doc.payload as unknown as Approval)
      .filter((approval) => approval.departmentRunId === departmentRunId)
      .sort((a, b) => a.recommendationRank - b.recommendationRank || a.version - b.version);
  }

  /** Idempotente por `changeId`: si ya existe, se devuelve la existente SIN tocarla. */
  async create(approval: Approval): Promise<{ approval: Approval; created: boolean }> {
    const existing = await this.get(approval.changeId);
    if (existing) return { approval: existing, created: false };
    await this.save(approval);
    return { approval, created: true };
  }

  /**
   * Transicion condicional. Comprueba el estado de origen y la maquina de
   * estados antes de escribir. NO es atomica -- ver la nota de cabecera
   * sobre por que eso es aceptable en el carril de staging y solo ahi.
   */
  async transition(input: {
    approvalId: string;
    expectedFrom: DepartmentChangeStatus[];
    to: DepartmentChangeStatus;
    patch?: ApprovalPatch;
    audit: { event: string; detail: string };
    at: string;
  }): Promise<
    | { ok: true; approval: Approval }
    | { ok: false; reason: "conflict" | "not_found" | "illegal_transition"; currentStatus: DepartmentChangeStatus | null; approval: Approval | null }
  > {
    assertNotProduction(input.to);

    const current = await this.get(input.approvalId);
    if (!current) return { ok: false, reason: "not_found", currentStatus: null, approval: null };

    if (!input.expectedFrom.includes(current.status)) {
      return { ok: false, reason: "conflict", currentStatus: current.status, approval: current };
    }
    const check = checkTransition(current.status, input.to);
    if (!check.allowed) {
      return { ok: false, reason: "illegal_transition", currentStatus: current.status, approval: current };
    }

    const updated: DepartmentChangeRequest = {
      ...current,
      ...(input.patch ?? {}),
      status: input.to,
      auditTrail: [...current.auditTrail, { at: input.at, event: input.audit.event, detail: input.audit.detail }],
      updatedAt: input.at,
    };
    await this.save(updated);
    return { ok: true, approval: updated };
  }

  /** Anota datos y auditoria SIN mover el estado. */
  async annotate(
    approvalId: string,
    patch: ApprovalPatch,
    audit: { event: string; detail: string },
    at: string
  ): Promise<Approval | null> {
    const current = await this.get(approvalId);
    if (!current) return null;
    const updated: DepartmentChangeRequest = {
      ...current,
      ...patch,
      auditTrail: [...current.auditTrail, { at, event: audit.event, detail: audit.detail }],
      updatedAt: at,
    };
    await this.save(updated);
    return updated;
  }

  /**
   * Feedback humano de versiones anteriores de esta recomendacion. Se
   * deriva de los cambios ya persistidos: un rechazo con motivo es lo
   * unico que cuenta como feedback, y el motivo va LITERAL, sin
   * reinterpretar.
   */
  async listHumanFeedback(recommendationId: string): Promise<HumanFeedbackEntry[]> {
    const versions = await this.listByRecommendation(recommendationId);
    return versions
      .filter((approval) => approval.humanDecision?.decision === "rejected" && (approval.humanDecision?.rejectionReason ?? "").trim().length > 0)
      .map((approval) => ({
        approvalId: approval.changeId,
        recommendationId: approval.recommendationId,
        recommendationTitle: approval.title,
        version: approval.version,
        rejectionReason: String(approval.humanDecision?.rejectionReason ?? ""),
        rejectedAt: String(approval.humanDecision?.decidedAt ?? approval.updatedAt),
      }));
  }

  // --- Carril de Telegram: NO lo sirve este store ---------------------
  //
  // Lanzan a proposito. Devolver `isNew: true` sin registrar nada
  // convertiria el mecanismo de idempotencia de webhooks en un adorno, y
  // un replay de Telegram acabaria ejecutando dos veces lo mismo.

  async markUpdateProcessed(): Promise<never> {
    throw new Error("El store de staging en MongoDB no sirve el carril de Telegram: la idempotencia de webhooks vive en el datastore serverless.");
  }

  async openRejectionPrompt(): Promise<never> {
    throw new Error("El store de staging en MongoDB no sirve los prompts de rechazo de Telegram.");
  }

  async findOpenRejectionPrompt(): Promise<never> {
    throw new Error("El store de staging en MongoDB no sirve los prompts de rechazo de Telegram.");
  }

  async findRejectionPromptByMessageId(): Promise<never> {
    throw new Error("El store de staging en MongoDB no sirve los prompts de rechazo de Telegram.");
  }

  async closeRejectionPrompt(): Promise<never> {
    throw new Error("El store de staging en MongoDB no sirve los prompts de rechazo de Telegram.");
  }
}
