import {
  buildAuditId,
  ExecutePhpAuditOutcome,
  ExecutePhpAuditRecord,
  EXECUTE_PHP_AUDIT_CONTRACT_VERSION,
  sha256,
} from "../../core/execute-php-audit";
import { buildPhpForPlan, buildRollbackPhpForPlan, parsePhpResult } from "../../core/execute-php-builder";
import { EXECUTE_PHP_ACTOR, ExecutePhpFlags, ExecutePhpRequest, isExecutePhpAllowed } from "../../core/execute-php-guard";
import { CapabilitySelection, ExecutePhpChangePlan, PostMetaPayload } from "../../core/execute-php-operations";
import { computeVersionHash, hashContent, normalizeForVersioning } from "./version";

/**
 * EXECUTOR del fallback `execute-php` sobre STAGING.
 *
 * Mismo esqueleto que el executor de staging que ya existe
 * (`staging-executor.ts`), porque el orden es lo que da las garantias, no
 * el mecanismo de escritura:
 *
 *   1. Leer el estado REAL y guardar el BEFORE (con hash de version).
 *   2. Comprobar que coincide con `expectedBeforeHash` -> si no, STALE y
 *      no se escribe nada.
 *   3. Pasar el guard con el PHP ya generado de forma determinista.
 *   4. Ejecutar.
 *   5. RELEER el estado real y validar: el campo del scope cambio a lo
 *      pedido, y NADA fuera del scope cambio.
 *   6. Si la validacion falla -> ROLLBACK con el snapshot, y verificarlo
 *      releyendo otra vez.
 *   7. Si el rollback falla -> critico, se dice, y este sistema no vuelve
 *      a tocar la pagina.
 *
 * Nunca se considera exito porque `execute-php` devolviera OK: el
 * resultado que cuenta es el que se lee DESPUES, del propio WordPress.
 *
 * Dependencias INYECTADAS: no importa ningun adaptador ni abre red, asi
 * que se testea entero sin WordPress y sin MCP.
 */

/** Estado real de la pagina, leido de WordPress. */
export interface PhpTargetState {
  id: number;
  status: string;
  title: string;
  contentHtml: string;
  excerpt: string;
  link: string;
  slug: string;
  /** Valor actual de las claves de meta relevantes. Ausente = la clave no existe. */
  meta: Record<string, string | undefined>;
}

export interface ExecutePhpDeps {
  /** Lee el estado real de la pagina objetivo. */
  getState: (postId: number) => Promise<PhpTargetState>;
  /** Ejecuta PHP via `novamira/execute-php` y devuelve su salida cruda. */
  runPhp: (php: string) => Promise<string>;
  now?: () => Date;
}

export interface ExecutePhpContext {
  departmentRunId: string;
  recommendationId: string;
  changeId: string;
  qaStatus: string;
  capabilitySelection: CapabilitySelection;
  flags: ExecutePhpFlags;
}

export type ExecutePhpStatus =
  | "blocked_by_guard"
  | "stale"
  | "applied"
  | "validation_failed"
  | "rolled_back"
  | "rollback_failed"
  | "failed";

export interface ExecutePhpOutcome {
  status: ExecutePhpStatus;
  /** `true` si se llego a escribir de verdad en staging (aunque luego se revirtiera). */
  stagingWritePerformed: boolean;
  /** Siempre 0 en esta fase: este executor no puede tocar produccion. */
  productionWritePerformed: false;
  detail: string;
  beforeHash: string | null;
  afterHash: string | null;
  /** Valor real leido antes del cambio, dentro del scope. */
  beforeValue: string | null;
  /** Valor real leido despues del cambio, dentro del scope. */
  afterValue: string | null;
  validation: string;
  rollback: string;
  audit: ExecutePhpAuditRecord[];
}

/** Campo del post que la operacion toca, ya resuelto. */
function scopeValueOf(state: PhpTargetState, plan: ExecutePhpChangePlan): { value: string; existed: boolean } {
  switch (plan.operation) {
    case "update_post_content":
      return { value: state.contentHtml, existed: true };
    case "update_post_title":
      return { value: state.title, existed: true };
    case "update_post_excerpt":
      return { value: state.excerpt, existed: true };
    case "update_post_meta": {
      const key = (plan.payload as PostMetaPayload).metaKey;
      const current = state.meta[key];
      return { value: current ?? "", existed: current !== undefined };
    }
    default:
      throw new Error(`Operacion "${plan.operation}" sin lectura de scope definida. Fail-closed.`);
  }
}

/**
 * Campos FUERA del scope, con su valor actual. La validacion posterior
 * comprueba que ninguno cambio: es la diferencia entre "el cambio que
 * pedi funciono" y "solo cambio lo que pedi".
 */
function outOfScopeFingerprint(state: PhpTargetState, plan: ExecutePhpChangePlan): Record<string, string> {
  const all: Record<string, string> = {
    status: state.status,
    slug: state.slug,
    post_title: normalizeForVersioning(state.title),
    post_excerpt: normalizeForVersioning(state.excerpt),
    post_content: hashContent(state.contentHtml),
  };
  for (const [key, value] of Object.entries(state.meta)) {
    all[`meta:${key}`] = value ?? "(ausente)";
  }

  const scoped = new Set<string>();
  if (plan.operation === "update_post_content") scoped.add("post_content");
  if (plan.operation === "update_post_title") scoped.add("post_title");
  if (plan.operation === "update_post_excerpt") scoped.add("post_excerpt");
  if (plan.operation === "update_post_meta") scoped.add(`meta:${(plan.payload as PostMetaPayload).metaKey}`);

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!scoped.has(key)) out[key] = value;
  }
  return out;
}

function diffFingerprints(before: Record<string, string>, after: Record<string, string>): string[] {
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) changed.push(key);
  }
  return changed;
}

/**
 * Igualdad de contenido para VERIFICAR una escritura. Solo tolera
 * diferencias de espacio en blanco (WordPress reflowea), nunca de
 * etiquetas, atributos ni mayusculas: justo lo contrario de
 * `normalizeForVersioning`, que existe para otra cosa.
 */
export function valuesMatchExactly(a: string, b: string): boolean {
  const squash = (value: string): string => String(value ?? "").replace(/\s+/g, " ").trim();
  return squash(a) === squash(b);
}

function versionHashOf(state: PhpTargetState): string {
  return computeVersionHash({ status: state.status, title: state.title, metaDescription: state.excerpt, contentHtml: state.contentHtml });
}

function auditRecord(
  context: ExecutePhpContext,
  plan: ExecutePhpChangePlan,
  php: string,
  at: string,
  outcome: ExecutePhpAuditOutcome,
  fields: { beforeHash: string | null; afterHash: string | null; validation: string; rollback: string; detail: string }
): ExecutePhpAuditRecord {
  const phpSha256 = sha256(php);
  return {
    contractVersion: EXECUTE_PHP_AUDIT_CONTRACT_VERSION,
    auditId: buildAuditId(context.changeId, at, phpSha256),
    at,
    departmentRunId: context.departmentRunId,
    recommendationId: context.recommendationId,
    changeId: context.changeId,
    actor: EXECUTE_PHP_ACTOR,
    ability: "novamira/execute-php",
    executionPath: context.capabilitySelection.executionPath,
    nativeAbilityConsidered: context.capabilitySelection.nativeAbility,
    capabilityReason: context.capabilitySelection.reason,
    environment: "staging",
    operation: plan.operation,
    target: `post:${plan.targetId}`,
    phpSha256,
    beforeHash: fields.beforeHash,
    afterHash: fields.afterHash,
    validation: fields.validation,
    rollback: fields.rollback,
    outcome,
    detail: fields.detail,
  };
}

function buildRequest(
  context: ExecutePhpContext,
  plan: ExecutePhpChangePlan,
  php: string,
  snapshot: { value: string; existed: boolean },
  phase: "apply" | "rollback"
): ExecutePhpRequest {
  return {
    actor: EXECUTE_PHP_ACTOR,
    abilityName: "novamira/execute-php",
    environment: "staging",
    phase,
    qaStatus: context.qaStatus,
    departmentRunId: context.departmentRunId,
    recommendationId: context.recommendationId,
    changeId: context.changeId,
    plan,
    php,
    capabilitySelection: context.capabilitySelection,
    flags: context.flags,
    snapshotPreviousValue: snapshot.value,
    snapshotPreviousExisted: snapshot.existed,
  };
}

/**
 * Aplica UN ChangePlan por el fallback de PHP. Nunca lanza: cualquier
 * fallo se traduce a un estado explicito con su rastro de auditoria.
 */
export async function applyChangePlanWithPhp(
  plan: ExecutePhpChangePlan,
  context: ExecutePhpContext,
  deps: ExecutePhpDeps
): Promise<ExecutePhpOutcome> {
  const clock = deps.now ?? (() => new Date());
  const audit: ExecutePhpAuditRecord[] = [];

  const base: Omit<ExecutePhpOutcome, "status" | "detail"> = {
    stagingWritePerformed: false,
    productionWritePerformed: false,
    beforeHash: null,
    afterHash: null,
    beforeValue: null,
    afterValue: null,
    validation: "not_run",
    rollback: "not_needed",
    audit,
  };

  // --- 0. Generar el PHP de forma determinista. Si el plan no permite
  //        generarlo, no hay nada que autorizar.
  let php: string;
  try {
    php = buildPhpForPlan(plan);
  } catch (err) {
    const detail = `No se pudo generar PHP determinista para el plan: ${err instanceof Error ? err.message : String(err)}`;
    audit.push(auditRecord(context, plan, "", clock().toISOString(), "blocked_by_guard", { beforeHash: null, afterHash: null, validation: "not_run", rollback: "not_needed", detail }));
    return { ...base, status: "blocked_by_guard", detail };
  }

  // --- 1. SNAPSHOT: leer el estado REAL antes de nada.
  let before: PhpTargetState;
  try {
    before = await deps.getState(plan.targetId);
  } catch (err) {
    const detail = `No se pudo leer el estado previo del post ${plan.targetId}: ${err instanceof Error ? err.message : String(err)}. Sin snapshot no se escribe NADA.`;
    audit.push(auditRecord(context, plan, php, clock().toISOString(), "failed", { beforeHash: null, afterHash: null, validation: "not_run", rollback: "not_needed", detail }));
    return { ...base, status: "failed", detail };
  }

  const beforeHash = versionHashOf(before);
  const snapshot = scopeValueOf(before, plan);
  const beforeOutOfScope = outOfScopeFingerprint(before, plan);

  // --- 2. STALE: la version real tiene que ser la que se propuso.
  if (beforeHash !== plan.expectedBeforeHash) {
    const detail = `STALE: la version real del post ${plan.targetId} es ${beforeHash.slice(0, 12)} y el plan se construyo sobre ${plan.expectedBeforeHash.slice(0, 12)}. La pagina cambio desde la propuesta -- no se ejecuta nada.`;
    audit.push(auditRecord(context, plan, php, clock().toISOString(), "blocked_by_guard", { beforeHash, afterHash: null, validation: "not_run", rollback: "not_needed", detail }));
    return { ...base, status: "stale", detail, beforeHash, beforeValue: snapshot.value };
  }

  // --- 3. GUARD. Con el PHP ya generado: el guard comprueba que es
  //        exactamente el nuestro, ademas de actor/entorno/QA/flags.
  const decision = isExecutePhpAllowed(buildRequest(context, plan, php, snapshot, "apply"));
  if (!decision.allowed) {
    const detail = `Bloqueado por el guard (${decision.failedCheck}): ${decision.reason}`;
    audit.push(auditRecord(context, plan, php, clock().toISOString(), "blocked_by_guard", { beforeHash, afterHash: null, validation: "not_run", rollback: "not_needed", detail }));
    return { ...base, status: "blocked_by_guard", detail, beforeHash, beforeValue: snapshot.value };
  }

  // --- 4. EJECUTAR.
  let rawOutput: string;
  try {
    rawOutput = await deps.runPhp(php);
  } catch (err) {
    const detail = `Fallo al ejecutar PHP en staging: ${err instanceof Error ? err.message : String(err)}. Se intenta rollback por si la escritura quedo a medias.`;
    audit.push(auditRecord(context, plan, php, clock().toISOString(), "failed", { beforeHash, afterHash: null, validation: "failed", rollback: "not_needed", detail }));
    return rollback(plan, context, deps, snapshot, beforeHash, beforeOutOfScope, audit, detail, clock);
  }

  const phpResult = parsePhpResult(rawOutput);
  // "Devolvio OK" NO es exito -- la verdad se lee de WordPress despues.
  // Pero la ausencia de resultado SI es un fallo por si sola: significa
  // que el codigo no llego a ejecutarse (parametro equivocado, ability
  // que no corre PHP, error silencioso). Decirlo evita diagnosticar como
  // "el contenido no coincide" lo que en realidad fue "no se ejecuto
  // nada".
  const phpDiagnosis =
    phpResult === null
      ? "execute-php no devolvio el marcador de resultado: el PHP NO llego a ejecutarse (revisa el nombre del parametro de la ability o sus permisos)"
      : phpResult.ok === false
        ? `execute-php devolvio un error propio: "${String(phpResult.error ?? "sin codigo")}"`
        : "";

  // --- 5. VALIDAR releyendo el estado real.
  let after: PhpTargetState;
  try {
    after = await deps.getState(plan.targetId);
  } catch (err) {
    const detail = `No se pudo releer el post ${plan.targetId} para validar: ${err instanceof Error ? err.message : String(err)}. Se revierte por precaucion.`;
    audit.push(auditRecord(context, plan, php, clock().toISOString(), "validation_failed", { beforeHash, afterHash: null, validation: "failed", rollback: "not_needed", detail }));
    return rollback(plan, context, deps, snapshot, beforeHash, beforeOutOfScope, audit, detail, clock);
  }

  const afterScope = scopeValueOf(after, plan);
  const afterHash = versionHashOf(after);
  const problems: string[] = [];

  const desired = plan.operation === "update_post_meta" ? (plan.payload as PostMetaPayload).value : plan.payload.value;
  // Comparacion EXACTA salvo espacios. A proposito NO se usa
  // `normalizeForVersioning` aqui: esa funcion quita etiquetas y pasa a
  // minusculas -- util para detectar deriva (WordPress reformatea por su
  // cuenta), pero desastrosa como verificacion posterior a la escritura,
  // porque un cambio que solo toque un `href` o el uso de mayusculas se
  // daria por "validado" sin haberse escrito.
  if (!valuesMatchExactly(afterScope.value, desired)) {
    problems.push(
      phpDiagnosis.length > 0
        ? `el valor releido del scope no coincide con lo pedido -- ${phpDiagnosis}`
        : "el valor releido del scope no coincide con lo pedido (execute-php respondio ok: por eso no se confia en su respuesta, se relee siempre)"
    );
  } else if (phpDiagnosis.length > 0) {
    // El valor coincide pero la ability se quejo: no se tapa.
    problems.push(phpDiagnosis);
  }
  const changedOutOfScope = diffFingerprints(beforeOutOfScope, outOfScopeFingerprint(after, plan));
  if (changedOutOfScope.length > 0) {
    problems.push(`cambiaron campos FUERA del scope declarado: ${changedOutOfScope.join(", ")}`);
  }
  if (after.status !== before.status) {
    problems.push(`el status paso de "${before.status}" a "${after.status}"`);
  }

  if (problems.length > 0) {
    const detail = `Validacion fallida: ${problems.join("; ")}.`;
    audit.push(
      auditRecord(context, plan, php, clock().toISOString(), "validation_failed", {
        beforeHash,
        afterHash,
        validation: "failed",
        rollback: "not_needed",
        detail,
      })
    );
    return rollback(plan, context, deps, snapshot, beforeHash, beforeOutOfScope, audit, detail, clock);
  }

  const detail = `Aplicado y VALIDADO en staging: post ${plan.targetId}, operacion "${plan.operation}". Releido de WordPress; nada fuera del scope cambio. Produccion no se ha tocado.`;
  audit.push(
    auditRecord(context, plan, php, clock().toISOString(), "applied", {
      beforeHash,
      afterHash,
      validation: "passed",
      rollback: "not_needed",
      detail,
    })
  );
  return {
    ...base,
    status: "applied",
    stagingWritePerformed: true,
    detail,
    beforeHash,
    afterHash,
    beforeValue: snapshot.value,
    afterValue: afterScope.value,
    validation: "passed",
  };
}

/**
 * ROLLBACK: reescribe el valor del snapshot con las MISMAS plantillas, y
 * despues RELEE para poder afirmar que se revirtio de verdad. Un rollback
 * que no se verifica no es un rollback.
 */
async function rollback(
  plan: ExecutePhpChangePlan,
  context: ExecutePhpContext,
  deps: ExecutePhpDeps,
  snapshot: { value: string; existed: boolean },
  beforeHash: string,
  beforeOutOfScope: Record<string, string>,
  audit: ExecutePhpAuditRecord[],
  cause: string,
  clock: () => Date
): Promise<ExecutePhpOutcome> {
  const base: Omit<ExecutePhpOutcome, "status" | "detail"> = {
    stagingWritePerformed: true,
    productionWritePerformed: false,
    beforeHash,
    afterHash: null,
    beforeValue: snapshot.value,
    afterValue: null,
    validation: "failed",
    rollback: "rollback_failed",
    audit,
  };

  let rollbackPhp: string;
  try {
    rollbackPhp = buildRollbackPhpForPlan(plan, snapshot.value, snapshot.existed);
  } catch (err) {
    const detail = `CRITICO: no se pudo generar el PHP de rollback (${err instanceof Error ? err.message : String(err)}). ${cause}`;
    audit.push(auditRecord(context, plan, "", clock().toISOString(), "rollback_failed", { beforeHash, afterHash: null, validation: "failed", rollback: "rollback_failed", detail }));
    return { ...base, status: "rollback_failed", detail };
  }

  // El rollback pasa por el MISMO guard. Que una escritura sea "de
  // vuelta" no la exime de comprobarse.
  const decision = isExecutePhpAllowed(buildRequest(context, plan, rollbackPhp, snapshot, "rollback"));
  if (!decision.allowed) {
    const detail = `CRITICO: el guard bloqueo el propio rollback (${decision.failedCheck}): ${decision.reason}. ${cause}`;
    audit.push(auditRecord(context, plan, rollbackPhp, clock().toISOString(), "rollback_failed", { beforeHash, afterHash: null, validation: "failed", rollback: "rollback_failed", detail }));
    return { ...base, status: "rollback_failed", detail };
  }

  try {
    await deps.runPhp(rollbackPhp);
  } catch (err) {
    const detail = `CRITICO: el rollback fallo (${err instanceof Error ? err.message : String(err)}). El post ${plan.targetId} puede haber quedado en un estado intermedio. Requiere intervencion humana -- este sistema no volvera a tocarlo. Causa original: ${cause}`;
    audit.push(auditRecord(context, plan, rollbackPhp, clock().toISOString(), "rollback_failed", { beforeHash, afterHash: null, validation: "failed", rollback: "rollback_failed", detail }));
    return { ...base, status: "rollback_failed", detail };
  }

  // Verificar releyendo.
  let restored: PhpTargetState;
  try {
    restored = await deps.getState(plan.targetId);
  } catch (err) {
    const detail = `CRITICO: no se pudo verificar el rollback del post ${plan.targetId} (${err instanceof Error ? err.message : String(err)}). Requiere intervencion humana. Causa original: ${cause}`;
    audit.push(auditRecord(context, plan, rollbackPhp, clock().toISOString(), "rollback_failed", { beforeHash, afterHash: null, validation: "failed", rollback: "rollback_failed", detail }));
    return { ...base, status: "rollback_failed", detail };
  }

  const restoredScope = scopeValueOf(restored, plan);
  const restoredHash = versionHashOf(restored);
  const mismatch =
    !valuesMatchExactly(restoredScope.value, snapshot.value) ||
    restoredScope.existed !== snapshot.existed ||
    diffFingerprints(beforeOutOfScope, outOfScopeFingerprint(restored, plan)).length > 0;

  if (mismatch) {
    const detail = `CRITICO: tras el rollback, el estado releido del post ${plan.targetId} NO coincide con el snapshot. Requiere intervencion humana. Causa original: ${cause}`;
    audit.push(auditRecord(context, plan, rollbackPhp, clock().toISOString(), "rollback_failed", { beforeHash, afterHash: restoredHash, validation: "failed", rollback: "rollback_failed", detail }));
    return { ...base, status: "rollback_failed", detail, afterHash: restoredHash };
  }

  const detail = `Rollback VERIFICADO releyendo el post ${plan.targetId}: vuelve exactamente al estado previo (version ${restoredHash.slice(0, 12)}). Causa original: ${cause}`;
  audit.push(
    auditRecord(context, plan, rollbackPhp, clock().toISOString(), "rolled_back", {
      beforeHash,
      afterHash: restoredHash,
      validation: "failed",
      rollback: "rolled_back",
      detail,
    })
  );
  return {
    ...base,
    status: "rolled_back",
    detail,
    afterHash: restoredHash,
    afterValue: restoredScope.value,
    rollback: "rolled_back",
  };
}
