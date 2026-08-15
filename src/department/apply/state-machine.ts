/**
 * MAQUINA DE ESTADOS EXPLICITA del ciclo de vida de un cambio del
 * departamento -- desde que Growth+QA lo proponen hasta que acaba
 * publicado en produccion, rechazado o bloqueado.
 *
 * Flujo operativo (decision de producto de esta fase):
 *
 *   AI Department -> Growth -> QA -> Web Engineer
 *      -> APPLY AUTOMATICO A STAGING (nunca un draft: staging es el
 *         entorno VISUAL de revision, tiene que ser una URL normal que
 *         se pueda abrir desde el movil)
 *      -> VALIDACION
 *      -> TELEGRAM (aprobar / rechazar / ver cambios)
 *      -> APROBAR -> APPLY EN PRODUCCION -> VALIDACION -> rollback si falla
 *      -> RECHAZAR -> motivo obligatorio -> feedback persistente
 *
 * Reglas duras codificadas aqui, no en el llamador:
 *
 * 1. FAIL-CLOSED: una transicion que no este declarada explicitamente en
 *    `ALLOWED_TRANSITIONS` es un error, nunca un "bueno, pasa igual".
 * 2. Produccion NUNCA es alcanzable desde staging: el unico camino a
 *    `production_applying` sale de `approved`, y a `approved` solo se
 *    llega desde `awaiting_approval` con una decision HUMANA explicita.
 *    Ni `staging_applied` ni un QA en PASS pueden llegar a produccion.
 * 3. Los estados terminales no vuelven atras. Una version rechazada,
 *    caducada (`approval_stale`) o revertida NO se reabre: la propuesta
 *    siguiente es un cambio NUEVO, con su propia aprobacion.
 *
 * Modulo PURO: sin I/O, sin red, sin reloj. Se puede testear entero.
 */

export type DepartmentChangeStatus =
  | "proposed"
  | "staging_applying"
  | "staging_applied"
  | "staging_validation_failed"
  | "staging_rolled_back"
  | "awaiting_approval"
  | "awaiting_rejection_reason"
  | "rejected"
  | "approved"
  | "approval_stale"
  | "production_applying"
  | "production_applied"
  | "production_validation_failed"
  | "production_rolled_back"
  | "blocked"
  | "requires_manual_staging_implementation";

export const DEPARTMENT_CHANGE_STATUSES: DepartmentChangeStatus[] = [
  "proposed",
  "staging_applying",
  "staging_applied",
  "staging_validation_failed",
  "staging_rolled_back",
  "awaiting_approval",
  "awaiting_rejection_reason",
  "rejected",
  "approved",
  "approval_stale",
  "production_applying",
  "production_applied",
  "production_validation_failed",
  "production_rolled_back",
  "blocked",
  "requires_manual_staging_implementation",
];

/**
 * Transiciones permitidas. Todo lo que no aparezca aqui esta PROHIBIDO.
 *
 * Leer la tabla de arriba abajo es leer el flujo entero -- y muy
 * concretamente: `staging_applied` NO tiene ninguna arista hacia
 * `production_*`, y `approved` es el UNICO origen de `production_applying`.
 */
export const ALLOWED_TRANSITIONS: Record<DepartmentChangeStatus, DepartmentChangeStatus[]> = {
  // Recien planificado: o hay executor determinista para staging, o no lo hay.
  proposed: ["staging_applying", "requires_manual_staging_implementation", "blocked"],

  // --- Carril de STAGING (no necesita aprobacion humana previa) ---
  staging_applying: ["staging_applied", "staging_validation_failed", "blocked"],
  staging_validation_failed: ["staging_rolled_back", "blocked"],
  // Terminal: si el cambio se revirtio en staging, no es aprobable. La
  // siguiente propuesta sera otro cambio distinto.
  staging_rolled_back: [],
  // Aplicado y validado en staging -> ya se puede pedir la aprobacion.
  staging_applied: ["awaiting_approval", "blocked"],

  // --- Puerta HUMANA ---
  awaiting_approval: ["approved", "rejected", "awaiting_rejection_reason", "approval_stale", "blocked"],
  // Se pulso RECHAZAR: el rechazo NO esta cerrado hasta que hay motivo.
  awaiting_rejection_reason: ["rejected", "blocked"],
  rejected: [],
  // La version aprobada ya no es la que esta en staging -> hay que volver
  // a pedir aprobacion sobre la version nueva (cambio nuevo).
  approval_stale: [],

  // --- Carril de PRODUCCION (solo desde `approved`) ---
  approved: ["production_applying", "approval_stale", "blocked"],
  production_applying: ["production_applied", "production_validation_failed", "blocked"],
  production_validation_failed: ["production_rolled_back", "blocked"],
  production_applied: [],
  production_rolled_back: [],

  // --- Terminales de seguridad ---
  blocked: [],
  requires_manual_staging_implementation: [],
};

export function isDepartmentChangeStatus(value: unknown): value is DepartmentChangeStatus {
  return typeof value === "string" && (DEPARTMENT_CHANGE_STATUSES as string[]).includes(value);
}

/** Estados desde los que ya no sale ninguna arista. */
export function isTerminalStatus(status: DepartmentChangeStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export function canTransition(from: DepartmentChangeStatus, to: DepartmentChangeStatus): boolean {
  if (!isDepartmentChangeStatus(from) || !isDepartmentChangeStatus(to)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface TransitionCheck {
  allowed: boolean;
  /** Siempre no vacio: por que SI o por que NO se permite la transicion. */
  reason: string;
}

/**
 * Comprueba una transicion devolviendo SIEMPRE un motivo legible (no
 * lanza): quien llama decide si eso es un `blocked`, un mensaje a
 * Telegram o un aviso en el informe -- pero nunca puede seguir adelante
 * "sin querer" con `allowed: false`.
 */
export function checkTransition(from: DepartmentChangeStatus, to: DepartmentChangeStatus): TransitionCheck {
  if (!isDepartmentChangeStatus(from)) {
    return { allowed: false, reason: `Estado de origen desconocido ("${String(from)}"). Fail-closed: no se transiciona nada.` };
  }
  if (!isDepartmentChangeStatus(to)) {
    return { allowed: false, reason: `Estado de destino desconocido ("${String(to)}"). Fail-closed: no se transiciona nada.` };
  }
  if (isTerminalStatus(from)) {
    return {
      allowed: false,
      reason: `"${from}" es un estado TERMINAL: no se reabre. Una version nueva de la propuesta es un cambio nuevo, con su propia aprobacion humana.`,
    };
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      reason: `Transicion no permitida "${from}" -> "${to}". Transiciones validas desde "${from}": ${ALLOWED_TRANSITIONS[from].join(", ") || "(ninguna)"}.`,
    };
  }
  return { allowed: true, reason: `Transicion permitida "${from}" -> "${to}".` };
}

/**
 * `true` solo para el UNICO estado desde el que se puede escribir en
 * produccion. Existe como funcion propia (en vez de comparar strings por
 * ahi suelto) para que cualquier lectura del codigo de produccion se
 * encuentre con la regla escrita.
 */
export function isProductionApplyAllowedFrom(status: DepartmentChangeStatus): boolean {
  return status === "approved";
}

/** Estados en los que el cambio esta esperando algo de una persona. */
export function isAwaitingHuman(status: DepartmentChangeStatus): boolean {
  return status === "awaiting_approval" || status === "awaiting_rejection_reason";
}
