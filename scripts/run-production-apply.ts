/**
 * PUBLICACION EN PRODUCCION de UNA aprobacion concreta -- el unico
 * proceso de todo el sistema serverless que escribe en el sitio real.
 *
 * Lo lanza `.github/workflows/department-production-apply.yml`, que a su
 * vez dispara el Worker cuando una persona pulsa APROBAR en Telegram. El
 * Worker NUNCA publica: solo encola (`approved` -> `production_queued`,
 * transicion condicional y atomica). Quien publica es este script, con
 * los executors deterministas de siempre.
 *
 * Secuencia, fail-closed en cada paso (si algo no se puede AFIRMAR, no se
 * escribe nada):
 *
 *   1. Leer la aprobacion del store HTTP. Si no existe -> error, salir 1.
 *   2. El estado tiene que ser EXACTAMENTE `production_queued`. Un estado
 *      terminal coherente (ya publicado, ya revertido, caducado,
 *      rechazado) = dispatch duplicado -> no se publica y se sale 0.
 *      Cualquier otro estado es una incoherencia -> salir 1.
 *   3. Releer STAGING y comparar su hash con el de la version que se
 *      enseño en Telegram (anti-TOCTOU). Si difiere -> `approval_stale`,
 *      aviso por Telegram y salir 0 SIN publicar.
 *   4. Transicion CONDICIONAL `production_queued` -> `production_applying`.
 *      Es la reclamacion atomica del apply: si otro run la gano, este
 *      recibe `conflict` y se retira sin escribir nada.
 *   5. Ejecutar `applyApprovedChangeToProduction` (sin reimplementar nada:
 *      snapshot -> escritura -> validacion releyendo -> rollback si falla).
 *   6. Persistir en el store HTTP las transiciones que el executor produjo,
 *      con el `githubRunId` en el registro de produccion.
 *   7. Notificar por Telegram el resultado REAL (el mensaje que devuelve
 *      el executor, sin maquillar) y salir 1 si el rollback fallo.
 *
 * Este fichero solo CABLEA: los adaptadores de WordPress son exactamente
 * los mismos que usa scripts/run-department-apply.ts, y toda la logica de
 * publicacion vive en src/department/apply/production-executor.ts.
 */
import {
  getWordpressPage,
  isWordpressDraftsEnabled,
} from "../src/adapters/wordpress";
import {
  getProductionPage,
  isProductionDraftsEnabled,
  isProductionExecutionEnabled,
  resolveProductionBackend,
  searchProductionPagesBySlug,
  updateProductionPublishedPageContent,
} from "../src/adapters/wordpress-production";
import { createHttpApprovalStoreFromEnv } from "../src/approvals/http-store";
import { Approval, ApprovalPatch, ApprovalStore } from "../src/approvals/store";
import { DepartmentChangeRequest } from "../src/department/apply/change-types";
import { checkProductionApplyGuards, ProductionApplyGuards } from "../src/department/apply/guards";
import { applyApprovedChangeToProduction, ProductionExecutorDeps } from "../src/department/apply/production-executor";
import { ChangeTransitionPort } from "../src/department/apply/staging-executor";
import { checkTransition, DepartmentChangeStatus } from "../src/department/apply/state-machine";
import { computeVersionHash, matchesApprovedVersion } from "../src/department/apply/version";
import { sendTelegramMessage } from "../src/core/telegram-gateway";

/**
 * Estados en los que un dispatch repetido es NORMAL, no un fallo: el
 * carril de produccion ya se resolvio (o se cerro) para esta aprobacion.
 * Telegram reenvia callbacks y el workflow admite dos formas de dispatch,
 * asi que esto pasa de verdad. Se sale 0 y no se toca nada.
 */
const COHERENT_TERMINAL_STATUSES: DepartmentChangeStatus[] = [
  "production_applied",
  "production_rolled_back",
  "approval_stale",
  "rejected",
];

export interface ProductionApplyRunnerResult {
  exitCode: number;
  /** Estado final conocido de la aprobacion (`null` si no existe). */
  status: DepartmentChangeStatus | null;
  /** Lo que se dijo por Telegram, o el motivo por el que no se publico. Nunca vacio. */
  message: string;
  /** `true` solo si se llego a escribir de verdad en produccion (aunque despues se revirtiera). */
  externalWritePerformed: boolean;
}

export interface ProductionApplyRunnerOptions {
  approvalId: string;
  store: ApprovalStore;
  /** Adaptadores reales de WordPress (staging para releer, produccion para escribir). */
  executorDeps: ProductionExecutorDeps;
  guards: ProductionApplyGuards;
  /** Envio a Telegram. Se inyecta para poder testear el runner sin red. */
  notify: (text: string) => Promise<void>;
  /** `GITHUB_RUN_ID`: cierra la trazabilidad decision humana -> run que publico. */
  githubRunId: string | null;
  now?: () => Date;
  log?: (line: string) => void;
  /**
   * SOLO para tests. Por defecto es el executor real: la logica de
   * publicacion no se reimplementa aqui bajo ningun concepto.
   */
  applyToProduction?: typeof applyApprovedChangeToProduction;
}

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
function toApprovalPatch(updates: Partial<DepartmentChangeRequest>, githubRunId: string | null): ApprovalPatch {
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

function mergePatch(base: ApprovalPatch, next: ApprovalPatch): ApprovalPatch {
  return { ...base, ...next };
}

interface FlushResult {
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
async function flushRecordedTransitions(
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

// --- Runner -----------------------------------------------------------------

export async function runProductionApply(options: ProductionApplyRunnerOptions): Promise<ProductionApplyRunnerResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const clock = options.now ?? (() => new Date());
  const applyToProduction = options.applyToProduction ?? applyApprovedChangeToProduction;
  const at = clock().toISOString();
  const approvalId = options.approvalId;

  // Notificar nunca puede tapar el resultado: si Telegram falla, se dice
  // y el run acaba en rojo, pero jamas se cambia lo que de verdad paso.
  let notifyFailed = false;
  const notify = async (text: string): Promise<void> => {
    try {
      await options.notify(text);
    } catch (err) {
      notifyFailed = true;
      log(`AVISO: no se pudo notificar por Telegram (${err instanceof Error ? err.message : String(err)}). El resultado real es el de mas arriba.`);
    }
  };

  // --- 1. Leer la aprobacion ---
  const approval: Approval | null = await options.store.get(approvalId);
  if (!approval) {
    const message = `No existe ninguna aprobacion con id "${approvalId}" en el registro. Fail-closed: no se publica nada.`;
    log(message);
    await notify(`🚫 No publico nada: ${message}`);
    return { exitCode: 1, status: null, message, externalWritePerformed: false };
  }

  // --- 2. Estado exacto ---
  if (approval.status !== "production_queued") {
    const duplicate = COHERENT_TERMINAL_STATUSES.includes(approval.status);
    const message = duplicate
      ? `La aprobacion "${approvalId}" ya esta en "${approval.status}": este dispatch es un duplicado. No se publica nada y no se toca el registro.`
      : `La aprobacion "${approvalId}" esta en "${approval.status}", no en "production_queued". Solo se publica lo que una persona aprobo Y quedo encolado atomicamente. Fail-closed: no se escribe nada.`;
    log(message);
    // Un duplicado no merece un Telegram (el resultado real ya se conto en
    // su momento); una incoherencia si.
    if (!duplicate) await notify(`🚫 No publico nada: ${message}`);
    return { exitCode: duplicate ? 0 : 1, status: approval.status, message, externalWritePerformed: false };
  }

  // --- 3. Anti-TOCTOU: staging tiene que seguir siendo lo aprobado ---
  const stagingRecord = approval.staging;
  if (!stagingRecord) {
    const message = `La aprobacion "${approvalId}" no tiene registro de staging: no hay forma de comprobar que lo aprobado sigue siendo lo que hay publicado. Fail-closed.`;
    log(message);
    await notify(`🚫 No publico nada: ${message}`);
    return { exitCode: 1, status: approval.status, message, externalWritePerformed: false };
  }

  let currentStagingHash: string;
  try {
    const stagingNow = await options.executorDeps.getStagingPage(stagingRecord.wordpressPageId);
    currentStagingHash = computeVersionHash({
      status: stagingNow.status,
      title: stagingNow.title,
      metaDescription: stagingNow.excerpt,
      contentHtml: stagingNow.contentHtml,
    });
  } catch (err) {
    // No se sabe si staging sigue igual -> no se publica, pero tampoco se
    // quema la aprobacion: sigue en `production_queued` y se puede
    // reintentar cuando staging responda.
    const message = `No se pudo releer staging para comprobar que sigue siendo la version aprobada: ${err instanceof Error ? err.message : String(err)}. Fail-closed: no se publica nada y la aprobacion sigue encolada.`;
    log(message);
    await notify(`🚫 No publico nada: ${message}`);
    return { exitCode: 1, status: approval.status, message, externalWritePerformed: false };
  }

  const approvedHash = approval.telegram?.stagingVersionHash ?? stagingRecord.resultingVersionHash;
  const versionCheck = matchesApprovedVersion(approvedHash, currentStagingHash);
  if (!versionCheck.matches) {
    const outcome = await options.store.transition({
      approvalId,
      expectedFrom: ["production_queued"],
      to: "approval_stale",
      audit: { event: "approval_stale", detail: versionCheck.reason },
      at,
    });
    const message = `🚫 No publico nada: ${versionCheck.reason}`;
    log(versionCheck.reason);
    if (!outcome.ok) log(`AVISO: la aprobacion no pudo marcarse como caducada (${outcome.reason}). No se ha publicado nada igualmente.`);
    await notify(message);
    // Caducar no es un fallo del sistema: es la proteccion funcionando.
    return { exitCode: notifyFailed ? 1 : 0, status: "approval_stale", message, externalWritePerformed: false };
  }
  log(versionCheck.reason);

  // --- 3.bis. Interruptores ANTES de reclamar ---
  //
  // Se comprueban aqui, y no solo dentro del executor, porque reclamar el
  // apply (`production_applying`) para despues descubrir que este entorno
  // no puede publicar dejaria la aprobacion atascada fuera de la cola.
  const guardCheck = checkProductionApplyGuards(options.guards);
  if (!guardCheck.allowed) {
    const message = `La aprobacion sigue encolada, pero este run NO puede publicar: ${guardCheck.reason}`;
    log(message);
    await notify(`🚫 No publico nada: ${message}`);
    return { exitCode: 1, status: approval.status, message, externalWritePerformed: false };
  }

  // --- 4. Reclamacion atomica ---
  const claim = await options.store.transition({
    approvalId,
    expectedFrom: ["production_queued"],
    to: "production_applying",
    patch: { productionRunId: options.githubRunId },
    audit: {
      event: "production_apply_claimed",
      detail: `El run de GitHub Actions ${options.githubRunId ?? "(sin GITHUB_RUN_ID)"} reclama la publicacion de esta aprobacion. La version de staging sigue siendo la aprobada.`,
    },
    at,
  });
  if (!claim.ok) {
    if (claim.reason === "conflict") {
      const message = `Otro proceso ya reclamo la publicacion de "${approvalId}" (estado remoto "${claim.currentStatus ?? "desconocido"}"). Este run no escribe nada: un cambio se publica UNA vez.`;
      log(message);
      return { exitCode: 0, status: claim.currentStatus, message, externalWritePerformed: false };
    }
    const message = `No se pudo reclamar la publicacion de "${approvalId}" (${claim.reason}). Fail-closed: no se escribe nada.`;
    log(message);
    await notify(`🚫 No publico nada: ${message}`);
    return { exitCode: 1, status: claim.currentStatus, message, externalWritePerformed: false };
  }

  // --- 5. Publicar (executor real, sin reimplementar nada) ---
  const recording = recordingTransitionPort(clock);
  const result = await applyToProduction(approval, options.executorDeps, options.guards, recording.port);

  // --- 6. Persistir lo que el executor produjo ---
  const flush = await flushRecordedTransitions(
    options.store,
    approvalId,
    recording.recorded,
    "production_applying",
    options.githubRunId,
    at
  );
  for (const note of recording.notes) {
    // El contrato HTTP no tiene ruta para anotar sin transicionar: estas
    // notas se quedan en el log del run, y se dicen en voz alta.
    log(`NOTA no persistida (${note.event}): ${note.detail}`);
  }
  for (const problem of flush.problems) log(`CRITICO: ${problem}`);

  // --- 7. Contar la verdad y decidir el codigo de salida ---
  log(`${approvalId}: ${flush.remoteStatus} -- ${result.message.split("\n")[0]}`);
  await notify(result.message);

  const rollbackFailed = result.change.production?.rollbackStatus === "rollback_failed";
  const blocked = flush.remoteStatus === "blocked" || result.change.status === "blocked";
  const exitCode = rollbackFailed || blocked || flush.problems.length > 0 || notifyFailed ? 1 : 0;
  if (rollbackFailed) log("CRITICO: el rollback de produccion fallo. Requiere intervencion humana inmediata.");

  return { exitCode, status: flush.remoteStatus, message: result.message, externalWritePerformed: result.externalWritePerformed };
}

// --- Cableado real ----------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
    }
  }
  return args;
}

function isEnabled(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

/** Mismos interruptores y misma lectura que scripts/run-department-apply.ts. */
export function resolveProductionGuardsFromEnv(): ProductionApplyGuards {
  let backend = "desconocido";
  try {
    backend = resolveProductionBackend();
  } catch {
    backend = "desconocido";
  }
  return {
    departmentProductionApplyEnabled: isEnabled("DEPARTMENT_PRODUCTION_APPLY_ENABLED"),
    productionExecutionEnabled: isProductionExecutionEnabled(),
    productionWritesEnabled: isProductionDraftsEnabled(),
    productionBackend: backend,
  };
}

/**
 * EXACTAMENTE los mismos adaptadores que cablea la fase `production` de
 * scripts/run-department-apply.ts, ni uno mas: staging solo se LEE
 * (`getWordpressPage`) y produccion se lee y se actualiza con el unico
 * adaptador capaz de escribir alli.
 */
export function resolveRealExecutorDeps(): ProductionExecutorDeps {
  return {
    getStagingPage: async (pageId) => {
      const page = await getWordpressPage(pageId);
      return { id: page.id, status: page.status, title: page.title, contentHtml: page.contentHtml, excerpt: page.excerpt, link: page.link, slug: page.slug };
    },
    findProductionPagesBySlug: async (slug) => {
      const results = await searchProductionPagesBySlug(slug);
      return results.map((r) => ({ id: r.id, slug: r.slug, status: r.status }));
    },
    getProductionPage: async (pageId) => {
      const page = await getProductionPage(pageId);
      return { id: page.id, status: page.status, title: page.title, contentHtml: page.contentHtml, excerpt: page.excerpt, slug: page.slug, link: page.link };
    },
    updateProductionPublishedPage: async (input) => {
      await updateProductionPublishedPageContent({
        pageId: input.pageId,
        title: input.title,
        contentHtml: input.contentHtml,
        excerpt: input.excerpt,
      });
    },
  };
}

async function main(): Promise<void> {
  // dotenv se carga aqui y no al importar el modulo: los tests importan
  // este fichero y no deben heredar ningun efecto de entorno.
  const dotenv = await import("dotenv");
  dotenv.config();

  const args = parseArgs(process.argv.slice(2));
  const approvalId = args.approvalId && args.approvalId !== "true" ? args.approvalId : null;
  if (!approvalId) throw new Error("Falta --approvalId <id>. Es el unico dato que viaja en el dispatch de produccion.");

  // Diagnostico util sin filtrar nada: solo si el interruptor de staging
  // esta puesto (staging aqui solo se LEE).
  console.log(`Escrituras de staging habilitadas (solo lectura en este run): ${isWordpressDraftsEnabled()}.`);

  const result = await runProductionApply({
    approvalId,
    store: createHttpApprovalStoreFromEnv(),
    executorDeps: resolveRealExecutorDeps(),
    guards: resolveProductionGuardsFromEnv(),
    githubRunId: (process.env.GITHUB_RUN_ID ?? "").trim() || null,
    // Texto plano: los titles/metas reales llevan comillas y `<`/`&`, y el
    // parser HTML de Telegram ya ha roto envios de este proyecto.
    notify: async (text) => {
      await sendTelegramMessage(text, { plainText: true });
    },
  });

  process.exitCode = result.exitCode;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
