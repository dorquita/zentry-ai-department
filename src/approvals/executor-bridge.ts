import { ApprovalPatch, ApprovalStore } from "./store";
import { DepartmentChangeRequest } from "../department/apply/change-types";
import { ChangeTransitionPort } from "../department/apply/staging-executor";
import { checkTransition, DepartmentChangeStatus } from "../department/apply/state-machine";

/**
 * PUENTE entre los executors deterministas y el store de aprobaciones.
 *
 * Los executors (staging y produccion) se testean sin I/O, asi que su
 * `ChangeTransitionPort` es SINCRONO. El store es HTTP y por tanto
 * asincrono. Este modulo resuelve ese desajuste sin tocar los executors:
 * el puerto aplica las transiciones en memoria comprobandolas contra la
 * MISMA maquina de estados, y despues se persisten en el mismo orden.
 *
 * Lo comparten los DOS carriles (el apply de staging de la pasada diaria
 * y el apply de produccion disparado por la aprobacion) para que no
 * existan dos implementaciones de algo tan delicado como esto.
 */

// --- Puerto de transiciones -------------------------------------------------

export interface RecordedTransition {
  from: DepartmentChangeStatus;
  to: DepartmentChangeStatus;
  updates: Partial<DepartmentChangeRequest>;
  audit: { event: string; detail: string };
}

export interface RecordingPort {
  port: ChangeTransitionPort;
  /** Transiciones que el executor produjo, en orden. Se persisten despues por HTTP. */
  recorded: RecordedTransition[];
  /** Anotaciones sin cambio de estado. El contrato HTTP no tiene ruta para ellas: se reportan. */
  notes: { event: string; detail: string }[];
}

/**
 * Adaptador entre el executor y el store HTTP.
 *
 * `ChangeTransitionPort.transition` es SINCRONO (asi lo definen los
 * executors, que se testean sin I/O) y una llamada HTTP no lo es. En vez
 * de inventar una version asincrona del executor -- que obligaria a
 * tocarlo, cosa que no se hace -- este puerto aplica la transicion en
 * memoria comprobandola contra la MISMA maquina de estados, la anota, y
 * el runner la persiste despues por HTTP en el mismo orden.
 *
 * Lo que hace que esto sea seguro y no un "guardar despues y cruzar los
 * dedos" es el paso 4 del runner: la reclamacion
 * `production_queued -> production_applying` SI se hace por HTTP, de
 * forma condicional y atomica, ANTES de que el executor escriba una sola
 * linea en produccion. Dos runs simultaneos del mismo approvalId no
 * pueden publicar los dos: el segundo ve `conflict` y se retira.
 */
export function recordingTransitionPort(now: () => Date): RecordingPort {
  const recorded: RecordedTransition[] = [];
  const notes: { event: string; detail: string }[] = [];
  const port: ChangeTransitionPort = {
    transition(change, nextStatus, updates, audit) {
      const check = checkTransition(change.status, nextStatus);
      if (!check.allowed) {
        // El executor nunca deberia intentarlo; si lo hiciera, no se
        // inventa un estado imposible ni se persiste nada.
        return { ok: false, change, reason: check.reason };
      }
      const at = now().toISOString();
      const updated: DepartmentChangeRequest = {
        ...change,
        ...updates,
        status: nextStatus,
        auditTrail: [...change.auditTrail, { at, event: audit.event, detail: audit.detail }],
        updatedAt: at,
      };
      recorded.push({ from: change.status, to: nextStatus, updates, audit });
      return { ok: true, change: updated, reason: check.reason };
    },
    note(change, updates, audit) {
      notes.push(audit);
      const at = now().toISOString();
      return {
        ...change,
        ...updates,
        status: change.status,
        auditTrail: [...change.auditTrail, { at, event: audit.event, detail: audit.detail }],
        updatedAt: at,
      };
    },
  };
  return { port, recorded, notes };
}

/** Solo los campos que el contrato permite parchear viajan al store. La identidad y el historico no se tocan. */
export function toApprovalPatch(updates: Partial<DepartmentChangeRequest>, githubRunId: string | null): ApprovalPatch {
  const patch: ApprovalPatch = {};
  if (updates.telegram !== undefined) patch.telegram = updates.telegram;
  if (updates.humanDecision !== undefined) patch.humanDecision = updates.humanDecision;
  if (updates.staging !== undefined) patch.staging = updates.staging;
  if (updates.inheritedFeedback !== undefined) patch.inheritedFeedback = updates.inheritedFeedback;
  if (updates.production !== undefined) {
    // El id del run se graba en el propio registro de produccion: es lo
    // que permite ir de "esta pagina cambio" al run que la cambio.
    patch.production = updates.production ? { ...updates.production, githubRunId } : null;
  }
  return patch;
}

export function mergePatch(base: ApprovalPatch, next: ApprovalPatch): ApprovalPatch {
  return { ...base, ...next };
}

export interface FlushResult {
  /** Estado que el store tiene despues de persistir todo lo que produjo el executor. */
  remoteStatus: DepartmentChangeStatus;
  /** Vacio si todo se persistio. Cada problema es fail-closed: obliga a salir con error. */
  problems: string[];
}

/**
 * Persiste por HTTP las transiciones que el executor hizo en memoria.
 *
 * El estado remoto ya esta en `production_applying` (la reclamacion del
 * paso 4), asi que la primera transicion del executor -- que es
 * exactamente esa misma -- no se repite: su `patch` (que trae el snapshot
 * previo de produccion) se arrastra a la siguiente, que en este executor
 * siempre existe.
 */
export async function flushRecordedTransitions(
  store: ApprovalStore,
  approvalId: string,
  recorded: RecordedTransition[],
  startStatus: DepartmentChangeStatus,
  githubRunId: string | null,
  at: string
): Promise<FlushResult> {
  let remoteStatus = startStatus;
  let pending: ApprovalPatch = {};
  const problems: string[] = [];

  for (const step of recorded) {
    const patch = mergePatch(pending, toApprovalPatch(step.updates, githubRunId));
    if (step.to === remoteStatus) {
      // Ya reflejado remotamente (la reclamacion): se guarda su patch para
      // la siguiente transicion, en la misma operacion atomica.
      pending = patch;
      continue;
    }

    let target = step.to;
    let detail = step.audit.detail;
    const legal = checkTransition(remoteStatus, target);
    if (!legal.allowed) {
      // Solo puede pasar en una carrera rarisima (p.ej. staging cambia
      // DESPUES de la reclamacion, y el executor pide `approval_stale`
      // desde un estado que ya no lo permite). No se fuerza un estado
      // imposible ni se deja el cambio como si nada: se manda a `blocked`,
      // que es el sumidero fail-closed que pide una persona.
      detail = `${detail} [El estado remoto era "${remoteStatus}" y no admite "${target}": ${legal.reason} Se bloquea para que lo revise una persona.]`;
      target = "blocked";
    }

    const outcome = await store.transition({
      approvalId,
      expectedFrom: [remoteStatus],
      to: target,
      patch,
      audit: { event: step.audit.event, detail },
      at,
    });
    if (!outcome.ok) {
      problems.push(
        `No se pudo persistir "${remoteStatus}" -> "${target}" (${outcome.reason}, estado remoto "${outcome.currentStatus ?? "desconocido"}"). El registro de la aprobacion NO refleja lo que paso en produccion.`
      );
      return { remoteStatus, problems };
    }
    remoteStatus = target;
    pending = {};
  }

  if (Object.keys(pending).length > 0) {
    problems.push("Quedaron datos del apply de produccion sin persistir (el executor no encadeno ninguna transicion posterior a la reclamacion).");
  }
  return { remoteStatus, problems };
}

