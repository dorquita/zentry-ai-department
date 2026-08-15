import { appendChangeSnapshot, transitionChange, updateChangeWithoutTransition } from "./change-registry";
import { DepartmentChangeRequest } from "./change-types";
import { DepartmentChangeStatus } from "./state-machine";
import { ChangeTransitionPort } from "./staging-executor";

/**
 * Cableado del registro persistente con la puerta de transiciones que
 * usan los executors.
 *
 * Los executors (staging y produccion) NO importan el registro: reciben
 * este puerto. Asi el mismo codigo se ejecuta contra el fichero real en
 * el VPS y contra un array en memoria en los tests, y -- mas importante
 * -- no existe ninguna via por la que un executor pueda escribir un
 * estado saltandose la maquina de estados.
 */

export interface RegistryPort extends ChangeTransitionPort {
  /** Persiste un cambio NUEVO (siempre en `proposed`). */
  create: (change: DepartmentChangeRequest) => DepartmentChangeRequest;
}

export function registryTransitionPort(options: { now?: () => Date; filePath?: string } = {}): RegistryPort {
  const clock = options.now ?? (() => new Date());
  return {
    create(change: DepartmentChangeRequest): DepartmentChangeRequest {
      return appendChangeSnapshot(change, options.filePath);
    },
    transition(
      change: DepartmentChangeRequest,
      nextStatus: DepartmentChangeStatus,
      updates: Partial<DepartmentChangeRequest>,
      audit: { event: string; detail: string }
    ) {
      return transitionChange(change, nextStatus, updates, audit, { now: clock(), filePath: options.filePath });
    },
    note(change: DepartmentChangeRequest, updates: Partial<DepartmentChangeRequest>, audit: { event: string; detail: string }) {
      return updateChangeWithoutTransition(change, updates, audit, { now: clock(), filePath: options.filePath });
    },
  };
}
