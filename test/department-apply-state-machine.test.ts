import * as assert from "node:assert/strict";
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  checkTransition,
  DEPARTMENT_CHANGE_STATUSES,
  DepartmentChangeStatus,
  isProductionApplyAllowedFrom,
  isTerminalStatus,
} from "../src/department/apply/state-machine";

export interface TestCase {
  name: string;
  fn: () => void;
}

/** Todos los caminos posibles desde `from` hasta `to`, para poder afirmar "no existe ninguno". */
function pathExists(from: DepartmentChangeStatus, to: DepartmentChangeStatus): boolean {
  const seen = new Set<DepartmentChangeStatus>([from]);
  const queue: DepartmentChangeStatus[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as DepartmentChangeStatus;
    for (const next of ALLOWED_TRANSITIONS[current]) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export function runDepartmentApplyStateMachineTests(): TestCase[] {
  return [
    // --- La regla central: produccion nunca es alcanzable sin aprobacion ---
    {
      name: "QA PASS / staging validado NO llegan a produccion: no existe NINGUN camino desde staging_applied a produccion sin pasar por approved",
      fn: () => {
        // Se corta la unica arista que sale de la puerta humana hacia
        // `approved` y se comprueba que ya no hay forma de llegar a
        // produccion: eso demuestra que TODO camino pasa por ahi.
        const original = [...ALLOWED_TRANSITIONS.awaiting_approval];
        try {
          ALLOWED_TRANSITIONS.awaiting_approval = original.filter((s) => s !== "approved");
          for (const productionState of ["production_applying", "production_applied"] as DepartmentChangeStatus[]) {
            assert.equal(
              pathExists("staging_applied", productionState),
              false,
              `sin la arista humana awaiting_approval->approved, "${productionState}" no puede ser alcanzable desde staging_applied`
            );
            assert.equal(pathExists("proposed", productionState), false, `tampoco desde "proposed"`);
          }
        } finally {
          ALLOWED_TRANSITIONS.awaiting_approval = original;
        }
      },
    },
    {
      name: "El unico origen de production_applying es approved",
      fn: () => {
        const origins = DEPARTMENT_CHANGE_STATUSES.filter((from) => ALLOWED_TRANSITIONS[from].includes("production_applying"));
        assert.deepEqual(origins, ["approved"]);
        assert.equal(isProductionApplyAllowedFrom("approved"), true);
        for (const status of DEPARTMENT_CHANGE_STATUSES.filter((s) => s !== "approved")) {
          assert.equal(isProductionApplyAllowedFrom(status), false, `"${status}" no puede autorizar una escritura en produccion`);
        }
      },
    },
    {
      name: "Transiciones no declaradas se rechazan con motivo (fail-closed), nunca se permiten por defecto",
      fn: () => {
        const check = checkTransition("staging_applied", "production_applied");
        assert.equal(check.allowed, false);
        assert.match(check.reason, /no permitida/i);
        assert.equal(canTransition("proposed", "approved"), false);
        assert.equal(canTransition("awaiting_approval", "production_applying"), false);
      },
    },
    {
      name: "Un estado desconocido nunca es una transicion valida",
      fn: () => {
        assert.equal(canTransition("inventado" as DepartmentChangeStatus, "approved"), false);
        assert.equal(canTransition("approved", "inventado" as DepartmentChangeStatus), false);
        assert.match(checkTransition("approved", "inventado" as DepartmentChangeStatus).reason, /desconocido/i);
      },
    },
    {
      name: "Los estados terminales no se reabren: una version nueva es un cambio nuevo",
      fn: () => {
        for (const terminal of ["rejected", "approval_stale", "production_applied", "production_rolled_back", "staging_rolled_back", "blocked", "requires_manual_staging_implementation"] as DepartmentChangeStatus[]) {
          assert.equal(isTerminalStatus(terminal), true, `"${terminal}" deberia ser terminal`);
          const check = checkTransition(terminal, "awaiting_approval");
          assert.equal(check.allowed, false);
          assert.match(check.reason, /TERMINAL/i);
        }
      },
    },
    {
      name: "El carril completo del flujo feliz existe de punta a punta",
      fn: () => {
        const happyPath: DepartmentChangeStatus[] = [
          "proposed",
          "staging_applying",
          "staging_applied",
          "awaiting_approval",
          "approved",
          "production_applying",
          "production_applied",
        ];
        for (let i = 0; i < happyPath.length - 1; i++) {
          assert.equal(canTransition(happyPath[i], happyPath[i + 1]), true, `falta la arista ${happyPath[i]} -> ${happyPath[i + 1]}`);
        }
      },
    },
    {
      name: "Rechazar abre awaiting_rejection_reason: el rechazo no se cierra sin motivo",
      fn: () => {
        assert.equal(canTransition("awaiting_approval", "awaiting_rejection_reason"), true);
        assert.equal(canTransition("awaiting_rejection_reason", "rejected"), true);
        // Y desde ahi no se puede colar nada hacia produccion.
        assert.equal(pathExists("awaiting_rejection_reason", "production_applied"), false);
      },
    },
    {
      name: "Una validacion fallida solo puede acabar en rollback o bloqueo, nunca en aplicado",
      fn: () => {
        assert.deepEqual(ALLOWED_TRANSITIONS.staging_validation_failed, ["staging_rolled_back", "blocked"]);
        assert.deepEqual(ALLOWED_TRANSITIONS.production_validation_failed, ["production_rolled_back", "blocked"]);
      },
    },
    {
      name: "approval_stale es terminal: una aprobacion caducada nunca se reutiliza",
      fn: () => {
        assert.equal(isTerminalStatus("approval_stale"), true);
        assert.equal(pathExists("approval_stale", "production_applied"), false);
      },
    },
  ];
}
