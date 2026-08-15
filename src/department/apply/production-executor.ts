import {
  buildProductionApplyId,
  ChangedField,
  ChangeSnapshot,
  DepartmentChangeRequest,
  EnvironmentApplyRecord,
} from "./change-types";
import { checkProductionApplyGuards, ProductionApplyGuards } from "./guards";
import { ChangeTransitionPort, StagingPageState } from "./staging-executor";
import { isProductionApplyAllowedFrom } from "./state-machine";
import { computeVersionHash, hashContent, matchesApprovedVersion, normalizeForVersioning, shortHash } from "./version";

/**
 * EXECUTOR DE PRODUCCION -- la unica pieza que puede escribir en el sitio
 * real, y la mas custodiada del sistema.
 *
 * Condiciones que se cumplen TODAS o no se escribe nada:
 *
 *   1. El cambio esta en `approved` (unico estado desde el que se puede
 *      publicar; ver state-machine.ts). Ni un QA en PASS ni un
 *      `staging_applied` llegan aqui.
 *   2. Existe una decision humana explicita registrada, con autor y fecha.
 *   3. La version que hay AHORA MISMO en staging es EXACTAMENTE la que se
 *      aprobo (anti-TOCTOU, por hash). Si staging cambio -> `approval_stale`
 *      y no se publica nada.
 *   4. Los interruptores de produccion estan puestos.
 *   5. El destino de produccion se resuelve de forma INEQUIVOCA: una sola
 *      pagina PUBLICADA cuyo slug coincide exactamente con el de staging.
 *      Cero o varias coincidencias -> `blocked`, nunca se adivina.
 *   6. Snapshot previo REAL de produccion -> escribir -> validar releyendo
 *      -> rollback si falla -> verificar el rollback.
 *
 * Nunca esconde un fallo: si el rollback falla, el cambio queda `blocked`
 * y se dice que requiere intervencion humana inmediata.
 *
 * Dependencias INYECTADAS: sin red ni ficheros aqui, testeable entero.
 */

export interface ProductionPageState {
  id: number;
  status: string;
  title: string;
  contentHtml: string;
  excerpt: string;
  slug: string;
  link: string;
}

/** Identidad minima de un candidato de produccion -- nunca contenido inventado. */
export interface ProductionPageCandidate {
  id: number;
  slug: string;
  status: string;
}

export interface ProductionExecutorDeps {
  /** Relee staging para la comprobacion anti-TOCTOU. */
  getStagingPage: (pageId: number) => Promise<StagingPageState>;
  /**
   * Busca en produccion candidatos por slug. Devuelve solo identidad y
   * estado a proposito: el filtrado EXACTO lo hace este modulo, no la
   * busqueda (una busqueda por texto libre nunca decide un destino de
   * escritura), y el contenido completo se lee despues con
   * `getProductionPage` sobre el unico candidato valido.
   */
  findProductionPagesBySlug: (slug: string) => Promise<ProductionPageCandidate[]>;
  getProductionPage: (pageId: number) => Promise<ProductionPageState>;
  /** Actualiza una pagina de produccion YA publicada. Nunca cambia status ni slug. */
  updateProductionPublishedPage: (input: { pageId: number; title: string; contentHtml: string; excerpt: string }) => Promise<void>;
  now?: () => Date;
}

export interface ProductionApplyResult {
  change: DepartmentChangeRequest;
  /** `true` si se llego a escribir de verdad en produccion (aunque despues se revirtiera). */
  externalWritePerformed: boolean;
  /** Mensaje pensado para responder por Telegram. Siempre no vacio, y nunca oculta un fallo. */
  message: string;
}

/** Valores aprobados: se toman del registro del cambio (lo que se enseño en Telegram), no de una relectura. */
export function resolveApprovedValues(change: DepartmentChangeRequest): { title: string | null; metaDescription: string | null } {
  const fields = change.staging?.changedFields ?? [];
  const title = fields.find((f) => f.field === "title");
  const meta = fields.find((f) => f.field === "meta description");
  return {
    title: title?.changed ? title.after : null,
    metaDescription: meta?.changed ? meta.after : null,
  };
}

function productionRecord(change: DepartmentChangeRequest, pageId: number, slug: string, url: string, at: Date): EnvironmentApplyRecord {
  return {
    environment: "production",
    applyId: buildProductionApplyId(change.changeId),
    wordpressPageId: pageId,
    url,
    pageSlug: slug,
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

function snapshotOf(page: ProductionPageState, at: Date): ChangeSnapshot {
  return {
    takenAt: at.toISOString(),
    environment: "production",
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

/**
 * Publica en produccion UN cambio ya aprobado. Nunca lanza: cualquier
 * fallo acaba en un estado explicito con su motivo, listo para
 * responderse por Telegram.
 */
export async function applyApprovedChangeToProduction(
  change: DepartmentChangeRequest,
  deps: ProductionExecutorDeps,
  guards: ProductionApplyGuards,
  port: ChangeTransitionPort
): Promise<ProductionApplyResult> {
  const clock = deps.now ?? (() => new Date());

  // --- 1. Solo desde `approved`, y solo con decision humana registrada ---
  if (!isProductionApplyAllowedFrom(change.status)) {
    const detail = `El cambio esta en "${change.status}". A produccion solo se llega desde "approved" (aprobacion humana explicita de la version exacta que hay en staging). No se escribe nada.`;
    return { change: port.note(change, {}, { event: "production_apply_refused", detail }), externalWritePerformed: false, message: detail };
  }
  if (!change.humanDecision || change.humanDecision.decision !== "approved" || !change.humanDecision.decidedBy.trim()) {
    const detail =
      'Incoherencia detectada antes de escribir: el estado dice "approved" pero no hay una decision humana valida registrada (con autor). Fail-closed: no se publica nada.';
    const blocked = port.transition(change, "blocked", {}, { event: "production_apply_blocked", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }

  const stagingRecord = change.staging;
  if (!stagingRecord || stagingRecord.validationStatus !== "passed" || !stagingRecord.resultingVersionHash) {
    const detail = "No hay un apply de staging validado para este cambio. Fail-closed: no se publica en produccion algo que no esta verificado en staging.";
    const blocked = port.transition(change, "blocked", {}, { event: "production_apply_blocked", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }

  // --- 2. Anti-TOCTOU: staging tiene que seguir siendo lo aprobado ---
  let stagingNow: StagingPageState;
  try {
    stagingNow = await deps.getStagingPage(stagingRecord.wordpressPageId);
  } catch (err) {
    const detail = `No se pudo releer staging para comprobar que sigue siendo la version aprobada: ${err instanceof Error ? err.message : String(err)}. Fail-closed: no se publica nada.`;
    const blocked = port.transition(change, "blocked", {}, { event: "production_apply_blocked", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }

  const currentStagingHash = computeVersionHash({
    status: stagingNow.status,
    title: stagingNow.title,
    metaDescription: stagingNow.excerpt,
    contentHtml: stagingNow.contentHtml,
  });
  const approvedHash = change.telegram?.stagingVersionHash ?? stagingRecord.resultingVersionHash;
  const versionCheck = matchesApprovedVersion(approvedHash, currentStagingHash);
  if (!versionCheck.matches) {
    const stale = port.transition(change, "approval_stale", {}, { event: "approval_stale", detail: versionCheck.reason });
    return {
      change: stale.ok ? stale.change : change,
      externalWritePerformed: false,
      message: `🚫 No publico nada: ${versionCheck.reason}`,
    };
  }

  // --- 3. Interruptores de produccion ---
  const guardCheck = checkProductionApplyGuards(guards);
  if (!guardCheck.allowed) {
    // La aprobacion NO se pierde: el cambio se queda en `approved` y se
    // dice exactamente que interruptor falta.
    const noted = port.note(change, {}, { event: "production_apply_not_attempted", detail: guardCheck.reason });
    return { change: noted, externalWritePerformed: false, message: `La aprobacion queda registrada, pero no se ha publicado nada: ${guardCheck.reason}` };
  }

  // --- 4. Destino de produccion INEQUIVOCO ---
  const slug = stagingRecord.pageSlug?.trim();
  if (!slug) {
    const detail = "El cambio no tiene registrado el slug de la pagina de staging, asi que no hay forma inequivoca de emparejarla con produccion. Fail-closed: no se escribe nada.";
    const blocked = port.transition(change, "blocked", {}, { event: "production_target_unresolved", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }

  let candidates: ProductionPageCandidate[];
  try {
    candidates = await deps.findProductionPagesBySlug(slug);
  } catch (err) {
    const detail = `Fallo buscando la pagina equivalente en produccion (slug "${slug}"): ${err instanceof Error ? err.message : String(err)}. Fail-closed: no se escribe nada.`;
    const blocked = port.transition(change, "blocked", {}, { event: "production_target_unresolved", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }

  const exact = candidates.filter((page) => page.slug === slug && page.status === "publish");
  if (exact.length !== 1) {
    const detail =
      exact.length === 0
        ? `No existe en produccion ninguna pagina PUBLICADA con el slug exacto "${slug}". Fail-closed: no se adivina el destino de una escritura en produccion.`
        : `Hay ${exact.length} paginas publicadas en produccion con el slug "${slug}" (ids: ${exact.map((p) => p.id).join(", ")}). Fail-closed: un cambio solo puede tener UN destino.`;
    const blocked = port.transition(change, "blocked", {}, { event: "production_target_unresolved", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }
  const targetPage = exact[0];

  // --- 5. Snapshot de produccion ---
  let before: ProductionPageState;
  try {
    before = await deps.getProductionPage(targetPage.id);
  } catch (err) {
    const detail = `No se pudo leer el estado previo de la pagina ${targetPage.id} en produccion: ${err instanceof Error ? err.message : String(err)}. Sin snapshot no se escribe NADA.`;
    const blocked = port.transition(change, "blocked", {}, { event: "production_snapshot_failed", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }
  if (before.status !== "publish") {
    const detail = `La pagina ${targetPage.id} de produccion tiene status "${before.status}" (no "publish"). Este apply solo corrige contenido de paginas ya publicadas: nunca publica, despublica ni borra. Fail-closed.`;
    const blocked = port.transition(change, "blocked", {}, { event: "production_apply_blocked", detail });
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed: false, message: detail };
  }

  const approved = resolveApprovedValues(change);
  const at = clock();
  const snapshot = snapshotOf(before, at);
  const changedFields: ChangedField[] = [
    {
      field: "title",
      before: before.title,
      after: approved.title ?? before.title,
      changed: approved.title !== null && normalizeForVersioning(approved.title) !== normalizeForVersioning(before.title),
    },
    {
      field: "meta description",
      before: before.excerpt,
      after: approved.metaDescription ?? before.excerpt,
      changed:
        approved.metaDescription !== null && normalizeForVersioning(approved.metaDescription) !== normalizeForVersioning(before.excerpt),
    },
    { field: "contenido (cuerpo)", before: "(sin cambios)", after: "(sin cambios)", changed: false },
  ];

  const record: EnvironmentApplyRecord = {
    ...productionRecord(change, before.id, before.slug, before.link, at),
    snapshot,
    changedFields,
  };

  const started = port.transition(change, "production_applying", { production: record }, {
    event: "production_apply_started",
    detail: `Publicando en PRODUCCION la version aprobada ${shortHash(approvedHash)} sobre la pagina ${before.id} ("${before.slug}"). Snapshot previo tomado. Aprobada por ${change.humanDecision.decidedBy} el ${change.humanDecision.decidedAt}.`,
  });
  if (!started.ok) {
    return { change, externalWritePerformed: false, message: started.reason };
  }
  let working = started.change;

  // --- 6. Escribir ---
  try {
    await deps.updateProductionPublishedPage({
      pageId: before.id,
      title: approved.title ?? before.title,
      contentHtml: before.contentHtml,
      excerpt: approved.metaDescription ?? before.excerpt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = port.transition(
      working,
      "production_validation_failed",
      { production: { ...record, validationStatus: "failed", validationDetail: `Fallo al escribir en produccion: ${message}.` } },
      { event: "production_apply_failed", detail: `Fallo al escribir en produccion: ${message}. Se intenta rollback al snapshot por si la escritura quedo a medias.` }
    );
    working = failed.ok ? failed.change : working;
    return rollbackProduction(working, record, before, deps, port, clock, true);
  }

  // --- 7. Validar releyendo produccion ---
  let after: ProductionPageState;
  try {
    after = await deps.getProductionPage(before.id);
  } catch (err) {
    const failed = port.transition(
      working,
      "production_validation_failed",
      {
        production: {
          ...record,
          validationStatus: "failed",
          validationDetail: `No se pudo releer la pagina de produccion para validar: ${err instanceof Error ? err.message : String(err)}.`,
        },
      },
      { event: "production_validation_failed", detail: `No se pudo releer la pagina ${before.id} de produccion para validar el cambio. Se revierte por precaucion.` }
    );
    working = failed.ok ? failed.change : working;
    return rollbackProduction(working, record, before, deps, port, clock, true);
  }

  const problems: string[] = [];
  if (after.status !== "publish") problems.push(`la pagina quedo en status "${after.status}" en vez de "publish"`);
  if (approved.title !== null && normalizeForVersioning(after.title) !== normalizeForVersioning(approved.title)) {
    problems.push("el title releido no coincide con el aprobado");
  }
  if (approved.metaDescription !== null && normalizeForVersioning(after.excerpt) !== normalizeForVersioning(approved.metaDescription)) {
    problems.push("la meta description releida no coincide con la aprobada");
  }
  if (hashContent(after.contentHtml) !== snapshot.previousContentHash) problems.push("el cuerpo de la pagina cambio, y este apply no debe tocarlo");
  if (after.slug !== before.slug) problems.push(`el slug cambio ("${before.slug}" -> "${after.slug}"), y este apply nunca debe tocarlo`);

  if (problems.length > 0) {
    const failed = port.transition(
      working,
      "production_validation_failed",
      { production: { ...record, validationStatus: "failed", validationDetail: `Validacion fallida: ${problems.join("; ")}.` } },
      { event: "production_validation_failed", detail: `La validacion posterior a la publicacion fallo: ${problems.join("; ")}. Se revierte produccion al estado previo del snapshot.` }
    );
    working = failed.ok ? failed.change : working;
    return rollbackProduction(working, record, before, deps, port, clock, true);
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
    "production_applied",
    {
      production: {
        ...record,
        url: after.link || before.link,
        finishedAt: finishedAt.toISOString(),
        validationStatus: "passed",
        validationDetail: "Releido de produccion: la pagina sigue publicada, su title/meta coinciden con lo aprobado y el cuerpo no ha cambiado.",
        rollbackStatus: "not_needed",
        resultingVersionHash,
      },
    },
    {
      event: "production_applied",
      detail: `Cambio PUBLICADO y validado en produccion (pagina ${after.id}, ${after.link}). Aprobado por ${change.humanDecision.decidedBy}.`,
    }
  );
  return {
    change: applied.ok ? applied.change : working,
    externalWritePerformed: true,
    message: `✅ CAMBIO PUBLICADO\n\n${change.title}\n\n${after.link || before.link}\n\nValidado releyendo produccion. Snapshot previo guardado por si hiciera falta revertir.`,
  };
}

async function rollbackProduction(
  change: DepartmentChangeRequest,
  fallbackRecord: EnvironmentApplyRecord,
  before: ProductionPageState,
  deps: ProductionExecutorDeps,
  port: ChangeTransitionPort,
  clock: () => Date,
  externalWritePerformed: boolean
): Promise<ProductionApplyResult> {
  // Se parte del registro YA persistido (que incluye el motivo real del
  // fallo), no del previo a escribir: si no, el rollback borraria la
  // evidencia de por que se esta revirtiendo.
  const record = change.production ?? fallbackRecord;
  const snapshot = record.snapshot;
  const criticalMessage = (detail: string): string => `🚨 PUBLICACION FALLIDA\n\n${change.title}\n\n${detail}\n\nREQUIERE INTERVENCION HUMANA INMEDIATA.`;

  if (!snapshot) {
    const detail = "CRITICO: se intento revertir produccion sin snapshot previo.";
    const blocked = port.transition(
      change,
      "blocked",
      { production: { ...record, rollbackStatus: "rollback_failed", rollbackDetail: detail } },
      { event: "production_rollback_failed", detail }
    );
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed, message: criticalMessage(detail) };
  }

  try {
    await deps.updateProductionPublishedPage({
      pageId: snapshot.wordpressPageId,
      title: snapshot.previousTitle,
      contentHtml: before.contentHtml,
      excerpt: snapshot.previousMetaDescription,
    });
  } catch (err) {
    const detail = `CRITICO: el rollback de produccion fallo (${err instanceof Error ? err.message : String(err)}). La pagina ${snapshot.wordpressPageId} puede haber quedado en un estado intermedio.`;
    const blocked = port.transition(
      change,
      "blocked",
      { production: { ...record, rollbackStatus: "rollback_failed", rollbackDetail: detail } },
      { event: "production_rollback_failed", detail }
    );
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed, message: criticalMessage(detail) };
  }

  try {
    const restored = await deps.getProductionPage(snapshot.wordpressPageId);
    const mismatch =
      normalizeForVersioning(restored.title) !== normalizeForVersioning(snapshot.previousTitle) ||
      normalizeForVersioning(restored.excerpt) !== normalizeForVersioning(snapshot.previousMetaDescription);
    if (mismatch) {
      const detail = `CRITICO: tras el rollback, el estado releido de la pagina ${snapshot.wordpressPageId} de produccion NO coincide con el snapshot.`;
      const blocked = port.transition(
        change,
        "blocked",
        { production: { ...record, rollbackStatus: "rollback_failed", rollbackDetail: detail } },
        { event: "production_rollback_failed", detail }
      );
      return { change: blocked.ok ? blocked.change : change, externalWritePerformed, message: criticalMessage(detail) };
    }
  } catch (err) {
    const detail = `CRITICO: no se pudo verificar el rollback de la pagina ${snapshot.wordpressPageId} de produccion (${err instanceof Error ? err.message : String(err)}).`;
    const blocked = port.transition(
      change,
      "blocked",
      { production: { ...record, rollbackStatus: "rollback_failed", rollbackDetail: detail } },
      { event: "production_rollback_failed", detail }
    );
    return { change: blocked.ok ? blocked.change : change, externalWritePerformed, message: criticalMessage(detail) };
  }

  const rolled = port.transition(
    change,
    "production_rolled_back",
    {
      production: {
        ...record,
        finishedAt: clock().toISOString(),
        rollbackStatus: "rolled_back",
        rollbackDetail: "Rollback verificado releyendo produccion: title/meta vuelven a ser los previos a la publicacion.",
      },
    },
    { event: "production_rolled_back", detail: `Rollback de produccion verificado (pagina ${snapshot.wordpressPageId}). La pagina ha vuelto a su estado anterior.` }
  );
  return {
    change: rolled.ok ? rolled.change : change,
    externalWritePerformed,
    message: `🚨 PUBLICACION FALLIDA\n\n${change.title}\n\nRollback ejecutado correctamente: la pagina de produccion ha vuelto a su estado anterior (verificado releyendola).\n\nNo se ha quedado nada a medias.`,
  };
}
