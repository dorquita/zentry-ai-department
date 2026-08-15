import { DepartmentHumanApproval, DepartmentHumanApprovalStatus } from "./types";

/**
 * PUERTA DE APROBACION HUMANA del apply del departamento.
 *
 * Reutiliza el registro de aprobaciones que YA existe en el proyecto
 * (`data/approval-requests.jsonl`, `src/core/approval-requests.ts`, con
 * su canal de Telegram y su CLI `npm run approvals:update`): NO se crea
 * un segundo sistema de aprobaciones en paralelo. Este modulo solo LEE
 * instantaneas ya reducidas al estado actual y decide, de forma pura y
 * determinista, si existe una aprobacion humana valida para un
 * `applyItemId`.
 *
 * Fail-closed en todas las direcciones:
 *
 * - No hay solicitud  -> `none`    (nunca se aplica)
 * - `pending`/`snoozed` -> `pending` (nunca se aplica)
 * - `rejected`/`cancelled`/`expired` -> `rejected` (nunca se aplica)
 * - `approved` pero caducada por tiempo -> `rejected` (nunca se aplica)
 * - status desconocido / solicitud incoherente -> `unknown` (nunca se aplica, y ademas BLOQUEA)
 *
 * Nada de esto mira el veredicto de QA: QA decide si algo es proponible,
 * no si esta aprobado.
 */

/** Ventana de validez de una aprobacion, igual que la del receptor de Telegram del proyecto (72 h). */
export const APPROVAL_VALIDITY_HOURS = 72;

/** Tipo de solicitud que usa el apply del departamento en el registro comun de aprobaciones. */
export const DEPARTMENT_APPLY_RELATED_TYPE = "department_apply_item";

/** Forma MINIMA que necesita esta puerta -- no se importa el tipo completo del registro para mantener el modulo puro. */
export interface ApprovalSnapshotLike {
  approvalRequestId: string;
  relatedType: string;
  relatedId: string;
  status: string;
  answeredBy?: string;
  answeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

const NEVER_APPROVED_STATUSES = new Set(["pending", "snoozed"]);
const REJECTED_STATUSES = new Set(["rejected", "cancelled", "expired"]);

function hoursBetween(fromIso: string, now: Date): number | null {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return null;
  return (now.getTime() - from) / (1000 * 60 * 60);
}

export interface ResolveHumanApprovalInput {
  applyItemId: string;
  requests: ApprovalSnapshotLike[];
  now?: Date;
}

/**
 * Resuelve la aprobacion humana de UN elemento de apply. Nunca lanza:
 * cualquier caso raro acaba en `unknown`, que el planificador traduce a
 * `blocked`.
 */
export function resolveHumanApproval(input: ResolveHumanApprovalInput): DepartmentHumanApproval {
  const now = input.now ?? new Date();
  const matches = input.requests.filter((r) => r.relatedType === DEPARTMENT_APPLY_RELATED_TYPE && r.relatedId === input.applyItemId);

  if (matches.length === 0) {
    return {
      status: "none",
      approvalRequestId: null,
      answeredBy: null,
      answeredAt: null,
      reason: `No existe ninguna solicitud de aprobacion humana para "${input.applyItemId}" en el registro de aprobaciones del proyecto. Sin aprobacion explicita no se aplica nada -- que QA diga PASS no es una aprobacion.`,
    };
  }

  if (matches.length > 1) {
    // El registro deduplica por relatedId, asi que esto solo puede pasar
    // si alguien manipulo el fichero: fail-closed, no se elige "la mejor".
    return {
      status: "unknown",
      approvalRequestId: null,
      answeredBy: null,
      answeredAt: null,
      reason: `Hay ${matches.length} solicitudes de aprobacion distintas para el mismo elemento "${input.applyItemId}". Fail-closed: no se elige ninguna, el elemento queda bloqueado hasta que un humano lo resuelva.`,
    };
  }

  const request = matches[0];
  const base = { approvalRequestId: request.approvalRequestId, answeredBy: request.answeredBy ?? null, answeredAt: request.answeredAt ?? null };

  if (NEVER_APPROVED_STATUSES.has(request.status)) {
    return {
      ...base,
      status: "pending" as DepartmentHumanApprovalStatus,
      reason: `La solicitud de aprobacion existe pero sigue sin respuesta util (status="${request.status}"). No se aplica nada.`,
    };
  }

  if (REJECTED_STATUSES.has(request.status)) {
    return {
      ...base,
      status: "rejected" as DepartmentHumanApprovalStatus,
      reason: `La solicitud de aprobacion esta en status="${request.status}". No se aplica nada.`,
    };
  }

  if (request.status === "approved") {
    const answeredAt = request.answeredAt ?? request.updatedAt;
    const age = hoursBetween(answeredAt, now);
    if (age === null) {
      return {
        ...base,
        status: "unknown" as DepartmentHumanApprovalStatus,
        reason: `La solicitud dice "approved" pero su fecha de respuesta ("${String(answeredAt)}") no es una fecha valida. Fail-closed: no se aplica.`,
      };
    }
    if (age > APPROVAL_VALIDITY_HOURS) {
      return {
        ...base,
        status: "rejected" as DepartmentHumanApprovalStatus,
        reason: `La aprobacion existe pero ya no es vigente (respondida hace ${Math.floor(age)} h, limite ${APPROVAL_VALIDITY_HOURS} h). Hay que volver a pedirla.`,
      };
    }
    if (!request.answeredBy || request.answeredBy.trim().length === 0) {
      return {
        ...base,
        status: "unknown" as DepartmentHumanApprovalStatus,
        reason: 'La solicitud dice "approved" pero no registra QUIEN la aprobo. Fail-closed: una aprobacion sin autor no se acepta como aprobacion humana.',
      };
    }
    return {
      ...base,
      status: "approved" as DepartmentHumanApprovalStatus,
      reason: `Aprobacion humana explicita registrada (${request.answeredBy}, ${answeredAt}), vigente.`,
    };
  }

  return {
    ...base,
    status: "unknown" as DepartmentHumanApprovalStatus,
    reason: `Status de aprobacion no reconocido ("${request.status}"). Fail-closed: el elemento queda bloqueado.`,
  };
}
