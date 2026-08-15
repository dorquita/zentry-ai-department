import {
  DepartmentApplyAuditEntry,
  DepartmentApplyItem,
  DepartmentApplySnapshot,
  StagingDraftMetaUpdateTarget,
} from "./types";

/**
 * EXECUTOR del apply del departamento -- la unica pieza que escribe de
 * verdad, y solo a traves de las funciones deterministas inyectadas.
 *
 * Claude NO llega hasta aqui: recibe un elemento de apply que ya tiene
 * (a) capacidad soportada, (b) aprobacion humana explicita y vigente, y
 * (c) parametros ya resueltos por el registro de capacidades. Este modulo
 * no interpreta lenguaje natural, no decide que aplicar y no puede
 * ampliar su propio alcance.
 *
 * Secuencia INVARIABLE, sin atajos posibles:
 *
 *   1. Comprobar precondiciones (aprobacion + capacidad + interruptores).
 *   2. SNAPSHOT del estado previo REAL (leido del sistema, no de un cache).
 *   3. Escribir.
 *   4. VALIDAR releyendo el estado real.
 *   5. Si la validacion falla -> ROLLBACK al snapshot.
 *   6. Si el rollback falla -> `blocked` (critico, requiere una persona).
 *
 * Dependencias INYECTADAS a proposito: asi este modulo es testeable sin
 * red y no importa ningun adaptador externo. El cableado real
 * (src/adapters/wordpress.ts, que bloquea produccion de forma
 * incondicional y rechaza escribir sobre paginas que no esten en `draft`)
 * lo hace scripts/run-department-apply.ts.
 */

export interface StagingPageState {
  id: number;
  status: string;
  title: string;
  contentHtml: string;
  excerpt: string;
}

export interface UpdateStagingDraftInput {
  pageId: number;
  title: string;
  contentHtml: string;
  excerpt: string;
}

export interface ApplyExecutorDeps {
  getPage: (pageId: number) => Promise<StagingPageState>;
  updateDraft: (input: UpdateStagingDraftInput) => Promise<void>;
  now?: () => Date;
}

/** Estado de los interruptores del entorno, ya resuelto por quien llama (nunca leido aqui). */
export interface ApplyEnvironmentGuards {
  /** `DEPARTMENT_APPLY_ENABLED=true` -- interruptor propio de esta fase. */
  departmentApplyEnabled: boolean;
  /** `WORDPRESS_DRAFTS_ENABLED=true`. */
  wordpressDraftsEnabled: boolean;
  /** `WORDPRESS_BACKEND` -- solo "rest" puede escribir. */
  wordpressBackend: string;
  /** `WORDPRESS_ENV` -- solo "staging". "production" esta bloqueado de forma incondicional. */
  wordpressEnv: string;
}

export interface GuardCheckResult {
  allowed: boolean;
  reason: string;
}

/**
 * Los cuatro interruptores tienen que estar bien A LA VEZ. Se comprueban
 * aqui ANTES de tocar nada, ademas de los guards que el propio adaptador
 * de WordPress vuelve a comprobar por su cuenta (defensa en profundidad:
 * esta funcion no sustituye a `assertWordpressWriteAllowed()`, se suma).
 */
export function checkApplyEnvironmentGuards(guards: ApplyEnvironmentGuards): GuardCheckResult {
  if (guards.wordpressEnv !== "staging") {
    return {
      allowed: false,
      reason: `WORDPRESS_ENV="${guards.wordpressEnv}". El apply del departamento SOLO puede escribir en staging; produccion esta bloqueada de forma incondicional y este sistema no tiene ninguna via para saltarselo.`,
    };
  }
  if (!guards.departmentApplyEnabled) {
    return { allowed: false, reason: "DEPARTMENT_APPLY_ENABLED no es true: no se intenta ninguna escritura real en esta pasada." };
  }
  if (!guards.wordpressDraftsEnabled) {
    return { allowed: false, reason: "WORDPRESS_DRAFTS_ENABLED no es true: el adaptador de WordPress tiene prohibido escribir." };
  }
  if (guards.wordpressBackend !== "rest") {
    return { allowed: false, reason: `WORDPRESS_BACKEND="${guards.wordpressBackend}": solo el backend "rest" puede realizar escrituras reales.` };
  }
  return { allowed: true, reason: "Los cuatro interruptores permiten intentar escrituras reales en staging." };
}

function entry(at: Date, event: string, detail: string): DepartmentApplyAuditEntry {
  return { at: at.toISOString(), event, detail };
}

/** Comparacion tolerante al formateo de WordPress (etiquetas, espacios) pero NO al contenido. */
export function normalizeForValidation(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function withUpdate(item: DepartmentApplyItem, at: Date, changes: Partial<DepartmentApplyItem>, audit: DepartmentApplyAuditEntry[]): DepartmentApplyItem {
  return { ...item, ...changes, auditTrail: [...item.auditTrail, ...audit], updatedAt: at.toISOString() };
}

/**
 * Ejecuta UN elemento de apply. Nunca lanza: cualquier fallo se traduce a
 * un estado explicito del contrato con su rastro de auditoria.
 */
export async function executeApplyItem(
  item: DepartmentApplyItem,
  deps: ApplyExecutorDeps,
  guards: ApplyEnvironmentGuards
): Promise<DepartmentApplyItem> {
  const clock = deps.now ?? (() => new Date());

  if (item.applyStatus !== "approved") {
    return withUpdate(item, clock(), {}, [
      entry(clock(), "apply_skipped", `El elemento no esta en estado "approved" (esta en "${item.applyStatus}"): no se ejecuta nada. Solo una aprobacion humana explicita lleva un elemento a "approved".`),
    ]);
  }

  if (item.humanApproval.status !== "approved") {
    return withUpdate(item, clock(), { applyStatus: "blocked" }, [
      entry(clock(), "apply_blocked", `Incoherencia detectada antes de escribir: applyStatus="approved" pero humanApproval="${item.humanApproval.status}". Fail-closed: no se escribe nada.`),
    ]);
  }

  if (!item.applyCapability.supported || !item.applyCapability.target) {
    return withUpdate(item, clock(), { applyStatus: "requires_manual_implementation" }, [
      entry(clock(), "apply_skipped", `Sin executor determinista para este elemento: ${item.applyCapability.reason}`),
    ]);
  }

  const guardCheck = checkApplyEnvironmentGuards(guards);
  if (!guardCheck.allowed) {
    return withUpdate(item, clock(), {}, [entry(clock(), "apply_not_attempted", guardCheck.reason)]);
  }

  const target: StagingDraftMetaUpdateTarget = item.applyCapability.target;

  // --- 1. Snapshot del estado previo REAL ---
  let before: StagingPageState;
  try {
    before = await deps.getPage(target.wordpressPageId);
  } catch (err) {
    return withUpdate(item, clock(), { applyStatus: "blocked" }, [
      entry(clock(), "snapshot_failed", `No se pudo leer el estado previo de la pagina ${target.wordpressPageId}: ${err instanceof Error ? err.message : String(err)}. Sin snapshot no se escribe NADA.`),
    ]);
  }

  if (before.status !== "draft") {
    return withUpdate(item, clock(), { applyStatus: "blocked" }, [
      entry(clock(), "apply_blocked", `La pagina ${target.wordpressPageId} tiene status "${before.status}" (no "draft"). Este apply solo actualiza borradores de staging: no se toca una pagina publicada.`),
    ]);
  }

  const snapshot: DepartmentApplySnapshot = {
    takenAt: clock().toISOString(),
    wordpressPageId: before.id,
    previousStatus: before.status,
    previousTitle: before.title,
    previousMetaDescription: before.excerpt,
  };

  const desiredTitle = target.newTitle ?? before.title;
  const desiredMeta = target.newMetaDescription ?? before.excerpt;

  let working = withUpdate(item, clock(), { applyStatus: "applying", snapshot }, [
    entry(clock(), "snapshot_taken", `Estado previo guardado (pagina ${before.id}, status "${before.status}"). Rollback posible a title/meta anteriores.`),
  ]);

  // --- 2. Escribir ---
  try {
    await deps.updateDraft({ pageId: target.wordpressPageId, title: desiredTitle, contentHtml: before.contentHtml, excerpt: desiredMeta });
    working = withUpdate(working, clock(), {}, [
      entry(clock(), "applied", `Borrador ${target.wordpressPageId} actualizado en staging (title/meta). El contenido del cuerpo NO se ha modificado.`),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = withUpdate(working, clock(), { applyStatus: "validation_failed", validationStatus: "failed" }, [
      entry(clock(), "apply_failed", `Fallo al escribir en staging: ${message}. Se intenta rollback al snapshot por si la escritura quedo a medias.`),
    ]);
    return rollback(failed, snapshot, before, deps, clock);
  }

  // --- 3. Validar releyendo el estado real ---
  let after: StagingPageState;
  try {
    after = await deps.getPage(target.wordpressPageId);
  } catch (err) {
    const failed = withUpdate(working, clock(), { applyStatus: "validation_failed", validationStatus: "failed" }, [
      entry(clock(), "validation_failed", `No se pudo releer la pagina para validar el cambio: ${err instanceof Error ? err.message : String(err)}. Se revierte por precaucion.`),
    ]);
    return rollback(failed, snapshot, before, deps, clock);
  }

  const problems: string[] = [];
  if (after.status !== "draft") problems.push(`la pagina quedo en status "${after.status}" en vez de "draft"`);
  if (target.newTitle !== null && normalizeForValidation(after.title) !== normalizeForValidation(target.newTitle)) {
    problems.push("el title releido no coincide con el title propuesto");
  }
  if (target.newMetaDescription !== null && normalizeForValidation(after.excerpt) !== normalizeForValidation(target.newMetaDescription)) {
    problems.push("la meta description releida no coincide con la propuesta");
  }

  if (problems.length > 0) {
    const failed = withUpdate(working, clock(), { applyStatus: "validation_failed", validationStatus: "failed" }, [
      entry(clock(), "validation_failed", `La validacion posterior fallo: ${problems.join("; ")}. Se revierte al estado previo del snapshot.`),
    ]);
    return rollback(failed, snapshot, before, deps, clock);
  }

  return withUpdate(working, clock(), { applyStatus: "applied", validationStatus: "passed", rollbackStatus: "not_needed" }, [
    entry(clock(), "validated", `Validacion correcta: la pagina ${target.wordpressPageId} sigue en "draft" y su title/meta coinciden con lo aprobado.`),
  ]);
}

async function rollback(
  item: DepartmentApplyItem,
  snapshot: DepartmentApplySnapshot,
  before: StagingPageState,
  deps: ApplyExecutorDeps,
  clock: () => Date
): Promise<DepartmentApplyItem> {
  try {
    await deps.updateDraft({
      pageId: snapshot.wordpressPageId,
      title: snapshot.previousTitle,
      contentHtml: before.contentHtml,
      excerpt: snapshot.previousMetaDescription,
    });
  } catch (err) {
    return withUpdate(item, clock(), { applyStatus: "blocked", rollbackStatus: "rollback_failed" }, [
      entry(clock(), "rollback_failed", `CRITICO: el rollback fallo (${err instanceof Error ? err.message : String(err)}). La pagina ${snapshot.wordpressPageId} puede haber quedado en un estado intermedio. Requiere intervencion humana inmediata -- este sistema no volvera a tocarla.`),
    ]);
  }

  // El rollback tambien se verifica: "revertido" solo se afirma cuando se
  // ha releido el estado real y coincide con el snapshot.
  try {
    const restored = await deps.getPage(snapshot.wordpressPageId);
    const mismatch =
      normalizeForValidation(restored.title) !== normalizeForValidation(snapshot.previousTitle) ||
      normalizeForValidation(restored.excerpt) !== normalizeForValidation(snapshot.previousMetaDescription);
    if (mismatch) {
      return withUpdate(item, clock(), { applyStatus: "blocked", rollbackStatus: "rollback_failed" }, [
        entry(clock(), "rollback_failed", `CRITICO: tras el rollback, el estado releido de la pagina ${snapshot.wordpressPageId} NO coincide con el snapshot. Requiere intervencion humana.`),
      ]);
    }
  } catch (err) {
    return withUpdate(item, clock(), { applyStatus: "blocked", rollbackStatus: "rollback_failed" }, [
      entry(clock(), "rollback_failed", `CRITICO: no se pudo verificar el rollback de la pagina ${snapshot.wordpressPageId} (${err instanceof Error ? err.message : String(err)}). Requiere intervencion humana.`),
    ]);
  }

  return withUpdate(item, clock(), { applyStatus: "rolled_back", rollbackStatus: "rolled_back" }, [
    entry(clock(), "rolled_back", `Rollback verificado: la pagina ${snapshot.wordpressPageId} vuelve a tener el title/meta previos al intento de apply.`),
  ]);
}
