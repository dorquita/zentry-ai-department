import {
  buildStagingChangeId,
  ChangedField,
  CHANGE_FIELD_BODY,
  CHANGE_FIELD_META,
  CHANGE_FIELD_TITLE,
  ChangeSnapshot,
  DepartmentChangeRequest,
  EnvironmentApplyRecord,
} from "./change-types";
import { checkStagingApplyGuards, StagingApplyGuards } from "./guards";
import { DepartmentChangeStatus } from "./state-machine";
import { computeVersionHash, hashContent, normalizeForVersioning } from "./version";

/**
 * EXECUTOR DE STAGING -- convierte una propuesta ya aprobada por QA en un
 * cambio REAL, visible y revisable en staging.
 *
 * Decision de producto de esta fase: **NO se usan borradores**. Un draft
 * de WordPress no se puede abrir como una URL normal desde el movil, y
 * la revision tiene que poder hacerse desde el movil. Por tanto este
 * executor SOLO actua sobre paginas de staging que YA estan PUBLICADAS
 * (`status: "publish"`), usando el executor determinista existente que
 * actualiza contenido sin tocar nunca el status ni el slug. Si la pagina
 * objetivo no esta publicada, el cambio se BLOQUEA con el motivo exacto
 * -- este modulo nunca publica ni despublica nada por su cuenta.
 *
 * Staging se puede modificar sin aprobacion humana previa (es
 * deliberadamente nuestro entorno de trabajo), pero se mantiene TODO lo
 * demas:
 *
 *   1. Comprobar interruptores (defensa en profundidad sobre los del adaptador).
 *   2. SNAPSHOT del estado previo REAL, leido del sistema.
 *   3. Escribir.
 *   4. VALIDAR releyendo el estado real.
 *   5. Si la validacion falla -> ROLLBACK al snapshot, y verificarlo.
 *   6. Si el rollback falla -> `blocked` (critico, requiere una persona).
 *
 * Un cambio que acabe en `staging_validation_failed`/`staging_rolled_back`/
 * `blocked` NUNCA se envia a Telegram como aprobable para produccion.
 *
 * Dependencias INYECTADAS: este modulo no importa ningun adaptador ni
 * toca el registro directamente, asi que se testea entero sin red y sin
 * ficheros. El cableado real lo hace scripts/run-department-apply.ts.
 */

export interface StagingPageState {
  id: number;
  status: string;
  title: string;
  contentHtml: string;
  excerpt: string;
  /** URL publica REAL tal como la devuelve WordPress. Nunca se construye a mano. */
  link: string;
  /** Slug real de la pagina -- unico criterio de emparejamiento con produccion mas adelante. */
  slug: string;
}

export interface UpdatePublishedPageInput {
  pageId: number;
  title: string;
  contentHtml: string;
  excerpt: string;
}

export interface StagingExecutorDeps {
  getPage: (pageId: number) => Promise<StagingPageState>;
  /** Actualiza una pagina de staging YA publicada. Nunca cambia status ni slug. */
  updatePublishedPage: (input: UpdatePublishedPageInput) => Promise<void>;
  now?: () => Date;
}

/** Parametros ya resueltos por el registro de capacidades -- este modulo no interpreta lenguaje natural. */
export interface StagingMetaUpdateTarget {
  wordpressPageId: number;
  /** Nuevo title. `null` = no se toca. */
  newTitle: string | null;
  /** Nueva meta description (excerpt). `null` = no se toca. */
  newMetaDescription: string | null;
}

/**
 * Puerta de persistencia con la maquina de estados incorporada. En
 * produccion se cablea al registro append-only; en tests, a un array en
 * memoria. Que el executor NO pueda escribir de otra forma es lo que
 * garantiza que ningun estado imposible llegue al registro.
 */
export interface ChangeTransitionPort {
  transition: (
    change: DepartmentChangeRequest,
    nextStatus: DepartmentChangeStatus,
    updates: Partial<DepartmentChangeRequest>,
    audit: { event: string; detail: string }
  ) => { ok: boolean; change: DepartmentChangeRequest; reason: string };
  /**
   * Anota datos y auditoria SIN mover el estado (snapshot tomado, motivo
   * por el que no se intento nada...). Existe aparte para que ninguna
   * escritura "de paso" pueda cambiar un status saltandose la maquina de
   * estados.
   */
  note: (
    change: DepartmentChangeRequest,
    updates: Partial<DepartmentChangeRequest>,
    audit: { event: string; detail: string }
  ) => DepartmentChangeRequest;
}

export interface StagingApplyResult {
  change: DepartmentChangeRequest;
  /** `true` si se llego a escribir de verdad en staging (aunque despues se revirtiera). */
  externalWritePerformed: boolean;
}

function buildChangedFields(before: StagingPageState, target: StagingMetaUpdateTarget): ChangedField[] {
  const fields: ChangedField[] = [];
  fields.push({
    field: CHANGE_FIELD_TITLE,
    before: before.title,
    after: target.newTitle ?? before.title,
    changed: target.newTitle !== null && normalizeForVersioning(target.newTitle) !== normalizeForVersioning(before.title),
  });
  fields.push({
    field: CHANGE_FIELD_META,
    before: before.excerpt,
    after: target.newMetaDescription ?? before.excerpt,
    changed:
      target.newMetaDescription !== null && normalizeForVersioning(target.newMetaDescription) !== normalizeForVersioning(before.excerpt),
  });
  // El cuerpo NO se modifica en esta capacidad: se declara explicitamente
  // para que el mensaje de Telegram pueda decir "sin cambio" con datos
  // reales, en vez de callarselo.
  fields.push({ field: CHANGE_FIELD_BODY, before: "(sin cambios)", after: "(sin cambios)", changed: false });
  return fields;
}

function snapshotOf(page: StagingPageState, at: Date): ChangeSnapshot {
  return {
    takenAt: at.toISOString(),
    environment: "staging",
    wordpressPageId: page.id,
    previousStatus: page.status,
    previousTitle: page.title,
    previousMetaDescription: page.excerpt,
    previousContentHash: hashContent(page.contentHtml),
    previousVersionHash: computeVersionHash({
      status: page.status,
      title: page.title,
      metaDescription: page.excerpt,
      contentHtml: page.contentHtml,
    }),
  };
}

function baseRecord(change: DepartmentChangeRequest, pageId: number, at: Date): EnvironmentApplyRecord {
  return {
    environment: "staging",
    applyId: buildStagingChangeId(change.changeId),
    wordpressPageId: pageId,
    url: "",
    pageSlug: "",
    startedAt: at.toISOString(),
    finishedAt: null,
    snapshot: null,
    changedFields: [],
    validationStatus: "not_run",
    validationDetail: "",
    rollbackStatus: "not_needed",
    rollbackDetail: "",
    resultingVersionHash: null,
  };
}

/**
 * Aplica UN cambio en staging. Nunca lanza: cualquier fallo se traduce a
 * un estado explicito de la maquina de estados con su rastro de
 * auditoria.
 */
export async function applyChangeToStaging(
  change: DepartmentChangeRequest,
  target: StagingMetaUpdateTarget,
  deps: StagingExecutorDeps,
  guards: StagingApplyGuards,
  port: ChangeTransitionPort
): Promise<StagingApplyResult> {
  const clock = deps.now ?? (() => new Date());

  if (change.status !== "proposed") {
    return {
      change,
      externalWritePerformed: false,
    };
  }

  const guardCheck = checkStagingApplyGuards(guards);
  if (!guardCheck.allowed) {
    // No se mueve el estado: el cambio sigue "proposed" y la proxima
    // pasada, con los interruptores puestos, podra intentarlo. Se deja
    // dicho por que no se intento, nunca en silencio.
    const noted = port.note(change, {}, { event: "staging_apply_not_attempted", detail: guardCheck.reason });
    return { change: noted, externalWritePerformed: false };
  }

  const started = port.transition(
    change,
    "staging_applying",
    { staging: baseRecord(change, target.wordpressPageId, clock()) },
    {
      event: "staging_apply_started",
      detail: `Comenzando apply en STAGING sobre la pagina ${target.wordpressPageId}. Estado transitorio persistido ANTES de tocar nada, para que un corte a media escritura sea visible.`,
    }
  );
  if (!started.ok) {
    return { change, externalWritePerformed: false };
  }
  let working = started.change;

  // --- 1. Snapshot del estado previo REAL ---
  let before: StagingPageState;
  try {
    before = await deps.getPage(target.wordpressPageId);
  } catch (err) {
    const blocked = port.transition(
      working,
      "blocked",
      {},
      {
        event: "staging_snapshot_failed",
        detail: `No se pudo leer el estado previo de la pagina ${target.wordpressPageId} en staging: ${err instanceof Error ? err.message : String(err)}. Sin snapshot no se escribe NADA.`,
      }
    );
    return { change: blocked.ok ? blocked.change : working, externalWritePerformed: false };
  }

  if (before.status !== "publish") {
    const blocked = port.transition(
      working,
      "blocked",
      {},
      {
        event: "staging_apply_blocked",
        detail: `La pagina ${target.wordpressPageId} tiene status "${before.status}" (no "publish"). Este flujo NO usa borradores: staging es el entorno visual de revision y el cambio tiene que quedar en una URL normal, abrible desde el movil. Este executor no publica ni despublica nada por su cuenta -- hace falta que la pagina ya este publicada en staging.`,
      }
    );
    return { change: blocked.ok ? blocked.change : working, externalWritePerformed: false };
  }

  const at = clock();
  const snapshot = snapshotOf(before, at);
  const changedFields = buildChangedFields(before, target);
  const record: EnvironmentApplyRecord = {
    ...(working.staging ?? baseRecord(working, target.wordpressPageId, at)),
    wordpressPageId: before.id,
    url: before.link,
    pageSlug: before.slug,
    snapshot,
    changedFields,
  };
  working = port.note(working, { staging: record }, {
    event: "staging_snapshot_taken",
    detail: `Estado previo guardado (pagina ${before.id}, status "${before.status}", version ${snapshot.previousVersionHash.slice(0, 12)}). Rollback posible a title/meta anteriores.`,
  });

  const desiredTitle = target.newTitle ?? before.title;
  const desiredMeta = target.newMetaDescription ?? before.excerpt;

  // --- 2. Escribir ---
  try {
    await deps.updatePublishedPage({
      pageId: target.wordpressPageId,
      title: desiredTitle,
      contentHtml: before.contentHtml,
      excerpt: desiredMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = port.transition(
      working,
      "staging_validation_failed",
      {
        staging: { ...record, validationStatus: "failed", validationDetail: `Fallo al escribir en staging: ${message}.` },
      },
      {
        event: "staging_apply_failed",
        detail: `Fallo al escribir en staging: ${message}. Se intenta rollback al snapshot por si la escritura quedo a medias.`,
      }
    );
    working = failed.ok ? failed.change : working;
    // Se intenta el rollback igualmente: la escritura pudo quedar a medias.
    const rolled = await rollbackStaging(working, record, before, deps, port, clock);
    return { change: rolled, externalWritePerformed: true };
  }

  // --- 3. Validar releyendo el estado real ---
  let after: StagingPageState;
  try {
    after = await deps.getPage(target.wordpressPageId);
  } catch (err) {
    const failed = port.transition(
      working,
      "staging_validation_failed",
      {
        staging: {
          ...record,
          validationStatus: "failed",
          validationDetail: `No se pudo releer la pagina para validar: ${err instanceof Error ? err.message : String(err)}.`,
        },
      },
      { event: "staging_validation_failed", detail: `No se pudo releer la pagina ${target.wordpressPageId} para validar el cambio. Se revierte por precaucion.` }
    );
    working = failed.ok ? failed.change : working;
    const rolled = await rollbackStaging(working, record, before, deps, port, clock);
    return { change: rolled, externalWritePerformed: true };
  }

  const problems: string[] = [];
  if (after.status !== "publish") problems.push(`la pagina quedo en status "${after.status}" en vez de "publish"`);
  if (target.newTitle !== null && normalizeForVersioning(after.title) !== normalizeForVersioning(target.newTitle)) {
    problems.push("el title releido no coincide con el propuesto");
  }
  if (target.newMetaDescription !== null && normalizeForVersioning(after.excerpt) !== normalizeForVersioning(target.newMetaDescription)) {
    problems.push("la meta description releida no coincide con la propuesta");
  }
  if (hashContent(after.contentHtml) !== snapshot.previousContentHash) {
    problems.push("el cuerpo de la pagina cambio, y esta capacidad no debe tocarlo");
  }

  if (problems.length > 0) {
    const failed = port.transition(
      working,
      "staging_validation_failed",
      { staging: { ...record, validationStatus: "failed", validationDetail: `Validacion fallida: ${problems.join("; ")}.` } },
      { event: "staging_validation_failed", detail: `La validacion posterior al apply en staging fallo: ${problems.join("; ")}. Se revierte al estado previo del snapshot.` }
    );
    working = failed.ok ? failed.change : working;
    const rolled = await rollbackStaging(working, record, before, deps, port, clock);
    return { change: rolled, externalWritePerformed: true };
  }

  const finishedAt = clock();
  const resultingVersionHash = computeVersionHash({
    status: after.status,
    title: after.title,
    metaDescription: after.excerpt,
    contentHtml: after.contentHtml,
  });
  const applied = port.transition(
    working,
    "staging_applied",
    {
      staging: {
        ...record,
        url: after.link || before.link,
        finishedAt: finishedAt.toISOString(),
        validationStatus: "passed",
        validationDetail: "Releido de staging: la pagina sigue publicada y su title/meta coinciden con lo propuesto; el cuerpo no ha cambiado.",
        rollbackStatus: "not_needed",
        resultingVersionHash,
      },
    },
    {
      event: "staging_applied",
      detail: `Cambio aplicado y VALIDADO en staging (pagina ${after.id}, version ${resultingVersionHash.slice(0, 12)}). Produccion no se ha tocado y no se tocara sin aprobacion humana explicita de esta version.`,
    }
  );
  return { change: applied.ok ? applied.change : working, externalWritePerformed: true };
}

async function rollbackStaging(
  change: DepartmentChangeRequest,
  fallbackRecord: EnvironmentApplyRecord,
  before: StagingPageState,
  deps: StagingExecutorDeps,
  port: ChangeTransitionPort,
  clock: () => Date
): Promise<DepartmentChangeRequest> {
  // Se parte del registro YA persistido en el cambio (que incluye el
  // motivo real del fallo de validacion), no del que se construyo antes
  // de escribir: si no, el rollback borraria la evidencia de por que se
  // esta revirtiendo.
  const record = change.staging ?? fallbackRecord;
  const snapshot = record.snapshot;
  if (!snapshot) {
    const blocked = port.transition(
      change,
      "blocked",
      { staging: { ...record, rollbackStatus: "rollback_failed", rollbackDetail: "No habia snapshot con el que revertir." } },
      { event: "staging_rollback_failed", detail: "CRITICO: se intento revertir sin snapshot previo. Requiere intervencion humana." }
    );
    return blocked.ok ? blocked.change : change;
  }

  try {
    await deps.updatePublishedPage({
      pageId: snapshot.wordpressPageId,
      title: snapshot.previousTitle,
      contentHtml: before.contentHtml,
      excerpt: snapshot.previousMetaDescription,
    });
  } catch (err) {
    const blocked = port.transition(
      change,
      "blocked",
      {
        staging: {
          ...record,
          rollbackStatus: "rollback_failed",
          rollbackDetail: `El rollback fallo: ${err instanceof Error ? err.message : String(err)}.`,
        },
      },
      {
        event: "staging_rollback_failed",
        detail: `CRITICO: el rollback en staging fallo. La pagina ${snapshot.wordpressPageId} puede haber quedado en un estado intermedio. Requiere intervencion humana -- este sistema no volvera a tocarla.`,
      }
    );
    return blocked.ok ? blocked.change : change;
  }

  // "Revertido" solo se afirma tras releer el estado real y comprobar que
  // coincide con el snapshot.
  try {
    const restored = await deps.getPage(snapshot.wordpressPageId);
    const mismatch =
      normalizeForVersioning(restored.title) !== normalizeForVersioning(snapshot.previousTitle) ||
      normalizeForVersioning(restored.excerpt) !== normalizeForVersioning(snapshot.previousMetaDescription);
    if (mismatch) {
      const blocked = port.transition(
        change,
        "blocked",
        { staging: { ...record, rollbackStatus: "rollback_failed", rollbackDetail: "Tras el rollback, el estado releido NO coincide con el snapshot." } },
        {
          event: "staging_rollback_failed",
          detail: `CRITICO: tras el rollback, el estado releido de la pagina ${snapshot.wordpressPageId} no coincide con el snapshot. Requiere intervencion humana.`,
        }
      );
      return blocked.ok ? blocked.change : change;
    }
  } catch (err) {
    const blocked = port.transition(
      change,
      "blocked",
      {
        staging: {
          ...record,
          rollbackStatus: "rollback_failed",
          rollbackDetail: `No se pudo verificar el rollback: ${err instanceof Error ? err.message : String(err)}.`,
        },
      },
      { event: "staging_rollback_failed", detail: `CRITICO: no se pudo verificar el rollback de la pagina ${snapshot.wordpressPageId}. Requiere intervencion humana.` }
    );
    return blocked.ok ? blocked.change : change;
  }

  const rolled = port.transition(
    change,
    "staging_rolled_back",
    {
      staging: {
        ...record,
        finishedAt: clock().toISOString(),
        rollbackStatus: "rolled_back",
        rollbackDetail: "Rollback verificado releyendo la pagina: title/meta vuelven a ser los previos al intento de apply.",
      },
    },
    {
      event: "staging_rolled_back",
      detail: `Rollback verificado en staging (pagina ${snapshot.wordpressPageId}). Este cambio NO se envia a Telegram como aprobable: no hay nada valido que aprobar.`,
    }
  );
  return rolled.ok ? rolled.change : change;
}
