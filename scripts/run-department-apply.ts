/**
 * APPLY del departamento -- ver docs/department-apply.md y
 * docs/telegram-approval-system.md.
 *
 * Flujo operativo completo de esta fase:
 *
 *   Growth -> QA -> Web Engineer
 *     -> APPLY AUTOMATICO A STAGING (sin aprobacion previa: staging es
 *        nuestro entorno de trabajo y revision, y el cambio queda en una
 *        URL normal, abrible desde el movil -- NUNCA un borrador)
 *     -> VALIDACION
 *     -> TELEGRAM (✅ APROBAR / ❌ RECHAZAR / 👁 VER CAMBIOS)
 *     -> APROBAR -> APPLY EN PRODUCCION -> VALIDACION -> rollback si falla
 *
 * Fases de este script:
 *
 *   plan       Construye el contrato de apply de la pasada (un elemento
 *              por recomendacion) resolviendo capacidad. NO escribe en
 *              ningun sistema externo.
 *   stage      Aplica en STAGING los elementos con capacidad soportada,
 *              creando su registro persistente. Escribe en staging
 *              (nunca en produccion) con snapshot, validacion y rollback.
 *   notify     Para los cambios ya aplicados y validados en staging: crea
 *              la solicitud de aprobacion en el registro comun y envia el
 *              mensaje de Telegram con los tres botones.
 *   production Publica en PRODUCCION los cambios que tengan aprobacion
 *              humana explicita y vigente de la version exacta que hay en
 *              staging. Es el unico camino a produccion, y se puede
 *              lanzar tambien desde el receiver de Telegram.
 *   sync       Proyecta el estado real del registro persistente sobre el
 *              contrato de la pasada (para que el Daily Brief diga la
 *              verdad aunque la decision se tomara horas despues).
 *
 * Claude NO participa en ninguna fase: aqui no se invoca ningun modelo.
 * La especificacion que produjo web-engineer se lee ya validada del run,
 * y este script solo ejecuta operaciones del registro de capacidades.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import {
  getWordpressPage,
  isWordpressDraftsEnabled,
  updateStagingPublishedPageContent,
} from "../src/adapters/wordpress";
import { resolveWordpressBackend, resolveWordpressEnv } from "../src/adapters/wordpress-backend";
import { readCurrentStagingReviewPages } from "../src/core/staging-review-pages";
import { readCurrentStagingExecutions } from "../src/core/staging-executions";
import { isTelegramApprovalsEnabled, sendTelegramMessage } from "../src/core/telegram-gateway";
import { validateWebEngineerOutput } from "../src/employees/web-engineer/validator";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import { OwnedStagingPage } from "../src/department/apply/capability";
import {
  buildChangeId,
  DEPARTMENT_CHANGE_CONTRACT_VERSION,
  DepartmentChangeRequest,
} from "../src/department/apply/change-types";
import { createHttpApprovalStoreFromEnv } from "../src/approvals/http-store";
import { isServerlessApprovalsEnabled, serverlessDisabledReason } from "../src/approvals/feature-flag";
import { Approval, ApprovalStore } from "../src/approvals/store";
import { flushRecordedTransitions, recordingTransitionPort } from "../src/approvals/executor-bridge";
import { checkStagingApplyGuards, StagingApplyGuards } from "../src/department/apply/guards";
import { buildApplyPlan, projectChangesIntoSummary } from "../src/department/apply/plan";
import { ResolvedChangePlan } from "../src/department/web-engineer-changeplan";
import { computeVersionHash } from "../src/department/apply/version";
import { sendChangeApprovalRequest } from "../src/department/apply/telegram-notifier";
import { applyChangeToStaging } from "../src/department/apply/staging-executor";
import { readApplySummary, updateApplySummaryItems, writeApplySummary } from "../src/department/apply/store";
import { DepartmentApplyItem, DepartmentApplySummary } from "../src/department/apply/types";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { findStageRecord, readManifest, readStageOutput, resolveDepartmentRunPaths, toRepoRelative } from "../src/department/run-store";

type Phase = "plan" | "stage" | "notify" | "sync";

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

function requireDepartmentRunId(args: Record<string, string>): string {
  const id = args.departmentRunId;
  if (!id || id === "true") throw new Error("Falta --departmentRunId <id>.");
  return id;
}

function isEnabled(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

function resolveStagingGuards(): StagingApplyGuards {
  return {
    stagingApplyEnabled: isEnabled("DEPARTMENT_STAGING_APPLY_ENABLED"),
    wordpressWritesEnabled: isWordpressDraftsEnabled(),
    wordpressBackend: resolveWordpressBackend(),
    wordpressEnv: resolveWordpressEnv(),
  };
}

/**
 * Catalogo de paginas de staging PUBLICADAS que este sistema controla.
 * Dos fuentes, ambas del propio sistema:
 *
 *  - `staging-review-pages.jsonl`: paginas publicadas explicitamente en
 *    staging para revision visual (tienen URL publica REAL registrada).
 *  - `staging-executions.jsonl`: ejecuciones aplicadas por el Staging
 *    Executor, para las que consta la URL de staging.
 *
 * Ninguna otra pagina del sitio es un destino valido de apply. La URL es
 * obligatoria: sin URL revisable, el cambio no seria aprobable desde el
 * movil y la capacidad lo rechaza.
 */
export function loadOwnedStagingPages(): OwnedStagingPage[] {
  const byPageId = new Map<number, OwnedStagingPage>();
  for (const execution of readCurrentStagingExecutions()) {
    if (execution.status !== "applied_to_staging") continue;
    if (typeof execution.wordpressPageId !== "number") continue;
    const url = execution.wordpressDraftUrl ?? "";
    if (url.trim().length === 0) continue;
    byPageId.set(execution.wordpressPageId, { wordpressPageId: execution.wordpressPageId, stagingUrl: url });
  }
  // Las paginas de revision van DESPUES a proposito: su `publicUrl` es la
  // URL real publicada (no un `?page_id=N`), asi que gana si hay ambas.
  for (const page of readCurrentStagingReviewPages()) {
    if (page.publicUrl.trim().length === 0) continue;
    byPageId.set(page.wordpressPageId, { wordpressPageId: page.wordpressPageId, stagingUrl: page.publicUrl });
  }
  return [...byPageId.values()];
}

/**
 * Planes ya resueltos por la fase `complete-web-engineer` contra el
 * inventario real de staging. Ausentes = pasada antigua o sin planes:
 * se sigue con el camino de siempre, nunca se inventa uno.
 */
function loadResolvedChangePlans(departmentRunId: string): ResolvedChangePlan[] {
  const filePath = path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "change-plans.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { resolved?: ResolvedChangePlan[] };
    return Array.isArray(raw.resolved) ? raw.resolved : [];
  } catch {
    return [];
  }
}

function loadPromotion(departmentRunId: string): DepartmentPromotionResult {
  const { promotionPath } = resolveDepartmentRunPaths(departmentRunId);
  if (!fs.existsSync(promotionPath)) {
    throw new Error(`No existe promotion.json en la pasada "${departmentRunId}": la puerta de QA no llego a resolverse. Fail-closed: no hay nada que planificar para apply.`);
  }
  return JSON.parse(fs.readFileSync(promotionPath, "utf-8")) as DepartmentPromotionResult;
}

function loadWebEngineer(departmentRunId: string): { status: string; output?: WebEngineerOutput } {
  const manifest = readManifest(departmentRunId);
  const record = findStageRecord(manifest, "web-engineer");
  const status = record?.status ?? "not_available";
  if (status !== "executed") return { status };
  const raw = readStageOutput(manifest, "web-engineer");
  if (raw === undefined) return { status: "invalid_output" };
  try {
    return { status, output: validateWebEngineerOutput(raw) };
  } catch {
    return { status: "invalid_output" };
  }
}

function summarize(summary: DepartmentApplySummary): string {
  return Object.entries(summary.counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
}

function requireSummary(departmentRunId: string): DepartmentApplySummary {
  const summary = readApplySummary(departmentRunId);
  if (!summary) {
    throw new Error(`No existe apply-summary.json en la pasada "${departmentRunId}". Ejecuta antes "--phase plan".`);
  }
  return summary;
}

/**
 * Reescribe el contrato de la pasada con el estado REAL de las
 * aprobaciones. Recibe los cambios YA leidos: el store es asincrono y
 * esta funcion se llama desde sitios que ya los tienen en la mano.
 */
function syncSummaryWith(
  departmentRunId: string,
  changes: Approval[],
  updates: { externalWritesPerformed?: boolean; applyNotAttemptedReason?: string }
): DepartmentApplySummary {
  const summary = requireSummary(departmentRunId);
  const projected = projectChangesIntoSummary(summary, changes);
  const updated = updateApplySummaryItems(projected, projected.items, {
    externalWritesPerformed: updates.externalWritesPerformed ?? projected.externalWritesPerformed,
    productionWritesPerformed: projected.productionWritesPerformed,
    applyNotAttemptedReason: updates.applyNotAttemptedReason ?? projected.applyNotAttemptedReason,
  });
  writeApplySummary(updated);
  return updated;
}

// --- FASE plan -------------------------------------------------------------

/**
 * Ancla de version: lee (SOLO lee) la pagina objetivo de cada propuesta
 * ejecutable y guarda el hash de como estaba cuando se genero el Daily
 * Brief.
 *
 * Es lo que permite decir mas tarde "esto ha cambiado desde que lo
 * viste" en vez de aplicar a ciegas. Si no hay credenciales o la lectura
 * falla, el ancla queda vacia y la sesion de aprobacion se negara a
 * ejecutar salvo que se le pase --allow-unverified: preferimos no poder
 * verificar y decirlo, a fingir que verificamos.
 */
async function captureVersionAnchors(summary: DepartmentApplySummary): Promise<DepartmentApplySummary> {
  const items = [];
  for (const item of summary.items) {
    const target = item.applyCapability.target;
    if (!target || item.applyStatus !== "proposed") {
      items.push(item);
      continue;
    }
    try {
      const page = await getWordpressPage(target.wordpressPageId);
      const hash = computeVersionHash({ status: page.status, title: page.title, metaDescription: page.excerpt, contentHtml: page.contentHtml });
      items.push({
        ...item,
        traceability: { ...item.traceability, stagingVersionHash: hash, stagingUrl: page.link || item.traceability.stagingUrl },
      });
    } catch (err) {
      items.push({
        ...item,
        auditTrail: [
          ...item.auditTrail,
          {
            at: new Date().toISOString(),
            event: "version_anchor_unavailable",
            detail: `No se pudo leer la pagina ${target.wordpressPageId} para anclar su version: ${err instanceof Error ? err.message : String(err)}. La sesion de aprobacion no podra verificar si cambia desde ahora.`,
          },
        ],
      });
    }
  }
  return { ...summary, items };
}

async function phasePlan(args: Record<string, string>): Promise<void> {
  const departmentRunId = requireDepartmentRunId(args);
  const promotion = loadPromotion(departmentRunId);
  const webEngineer = loadWebEngineer(departmentRunId);
  const ownedStagingPages = loadOwnedStagingPages();

  const resolvedChangePlans = loadResolvedChangePlans(departmentRunId);
  let summary = buildApplyPlan({ departmentRunId, promotion, webEngineer, ownedStagingPages, resolvedChangePlans });
  summary = await captureVersionAnchors(summary);
  summary = updateApplySummaryItems(summary, summary.items, {
    externalWritesPerformed: false,
    productionWritesPerformed: false,
    applyNotAttemptedReason:
      'Fase de planificacion: no se ha aplicado nada todavia. El apply real en staging es la fase "stage".',
  });

  const filePath = writeApplySummary(summary);
  console.log(`Contrato de apply escrito en ${toRepoRelative(filePath)}: ${summarize(summary) || "sin elementos"}.`);
  console.log(`Paginas de staging publicadas disponibles como destino: ${ownedStagingPages.length}.`);
  for (const item of summary.items) {
    // El estado del CAMBIO y el POR QUE son dos cosas distintas: sin la
    // segunda, ocho recomendaciones con ocho causas distintas se leian
    // como el mismo "requires_manual_staging_implementation".
    console.log(`  - [${item.applyStatus}] [${item.changePlanResolution ?? "sin diagnostico"}] #${item.recommendationRank} ${item.title}`);
    if (item.changePlanResolutionReason) console.log(`      motivo: ${item.changePlanResolutionReason}`);
  }
}

// --- FASE stage ------------------------------------------------------------

function buildChangeFromItem(item: DepartmentApplyItem, version: number, previous: string[], supersedes: string | null, now: Date): DepartmentChangeRequest {
  return {
    contractVersion: DEPARTMENT_CHANGE_CONTRACT_VERSION,
    changeId: buildChangeId(item.departmentRunId, item.recommendationRank, version),
    departmentRunId: item.departmentRunId,
    recommendationId: item.recommendationId,
    recommendationRank: item.recommendationRank,
    version,
    supersedesChangeId: supersedes,
    title: item.title,
    why: item.proposedChange,
    sourceAgents: [...item.sourceAgents],
    impact: item.impact,
    confidence: item.confidence,
    effort: item.effort,
    qaStatus: item.qaStatus,
    capabilityId: item.applyCapability.id,
    capabilityReason: item.applyCapability.reason,
    status: "proposed",
    staging: null,
    telegram: null,
    humanDecision: null,
    production: null,
    inheritedFeedback: previous,
    auditTrail: [
      {
        at: now.toISOString(),
        event: "change_created",
        detail: `Cambio v${version} creado a partir de la recomendacion #${item.recommendationRank} de la pasada ${item.departmentRunId}. ${previous.length > 0 ? `Hereda ${previous.length} motivo(s) de rechazo de versiones anteriores.` : "Sin rechazos previos."}`,
      },
    ],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function phaseStage(args: Record<string, string>): Promise<void> {
  if (!isServerlessApprovalsEnabled()) {
    throw new Error(serverlessDisabledReason('La fase "stage" de esta pasada (que persiste en el datastore serverless)'));
  }
  const departmentRunId = requireDepartmentRunId(args);
  const summary = requireSummary(departmentRunId);
  const guards = resolveStagingGuards();
  const guardCheck = checkStagingApplyGuards(guards);
  console.log(`Interruptores de staging: ${guardCheck.reason}`);

  // Se comprueba ANTES del bucle a proposito: con los interruptores
  // apagados no se crea ningun registro de cambio. En un checkout
  // efimero (un runner de CI) crear registros generaria cambios que
  // nadie podria continuar, porque desaparecen con el runner.
  if (!guardCheck.allowed) {
    syncSummaryWith(departmentRunId, [], { externalWritesPerformed: false, applyNotAttemptedReason: guardCheck.reason });
    console.log("No se ha creado ninguna aprobacion ni se ha escrito nada.");
    return;
  }

  // El estado de las aprobaciones vive en el datastore SERVERLESS, no en
  // el filesystem de este runner: por eso esta fase puede ejecutarse aqui
  // sin que la aprobacion muera cuando el runner termine.
  const store = createHttpApprovalStoreFromEnv();
  const existing = await store.listByRun(departmentRunId);
  let externalWrites = false;
  let applied = 0;
  let criticalRollbacks = 0;

  for (const item of summary.items) {
    if (item.applyStatus !== "proposed" || !item.applyCapability.supported || !item.applyCapability.target) continue;

    // Idempotencia: si esta pasada ya creo una aprobacion para esta
    // recomendacion, no se crea otra. Una segunda ejecucion de la fase no
    // puede duplicar aplicaciones ni aprobaciones.
    const already = existing.find((c) => c.recommendationId === item.recommendationId);
    if (already && already.status !== "proposed") {
      console.log(`  - ${item.recommendationId}: ya existe la aprobacion ${already.changeId} en estado "${already.status}". No se vuelve a aplicar.`);
      continue;
    }

    let change: Approval;
    if (already) {
      change = already;
    } else {
      // La version y el feedback heredado los decide el datastore, que es
      // quien conoce TODAS las versiones anteriores de esta recomendacion
      // (incluidas las de pasadas de otros dias).
      const previousVersions = await store.listByRecommendation(item.recommendationId);
      const feedback = await store.listHumanFeedback(item.recommendationId);
      const version = previousVersions.length === 0 ? 1 : Math.max(...previousVersions.map((c) => c.version)) + 1;
      const supersedes = previousVersions.length > 0 ? previousVersions[previousVersions.length - 1].changeId : null;
      const created = await store.create(
        buildChangeFromItem(
          item,
          version,
          feedback.map((f) => `v${f.version} (${f.rejectedAt}): ${f.rejectionReason}`),
          supersedes,
          new Date()
        )
      );
      change = created.approval;
    }

    const target = item.applyCapability.target;
    const { port, recorded } = recordingTransitionPort(() => new Date());
    const result = await applyChangeToStaging(
      change,
      { wordpressPageId: target.wordpressPageId, newTitle: target.newTitle, newMetaDescription: target.newMetaDescription },
      {
        getPage: async (pageId) => {
          const page = await getWordpressPage(pageId);
          return { id: page.id, status: page.status, title: page.title, contentHtml: page.contentHtml, excerpt: page.excerpt, link: page.link, slug: page.slug };
        },
        updatePublishedPage: async (input) => {
          await updateStagingPublishedPageContent({
            pageId: input.pageId,
            title: input.title,
            contentHtml: input.contentHtml,
            excerpt: input.excerpt,
          });
        },
      },
      guards,
      port
    );

    // Persistir lo que hizo el executor. Se hace SIEMPRE, tambien cuando
    // fallo: un apply que se revirtio tiene que quedar registrado como
    // tal, nunca en silencio.
    const flushed = await flushRecordedTransitions(store, change.changeId, recorded, change.status, null, new Date().toISOString());
    for (const problem of flushed.problems) console.error(`    ! ${problem}`);

    if (result.externalWritePerformed) externalWrites = true;
    if (result.change.status === "staging_applied") applied += 1;
    if (result.change.staging?.rollbackStatus === "rollback_failed") criticalRollbacks += 1;
    console.log(`  - ${result.change.changeId}: ${result.change.status} (${result.change.staging?.url ?? "sin URL"})`);
  }

  const updated = syncSummaryWith(departmentRunId, await store.listByRun(departmentRunId), {
    externalWritesPerformed: externalWrites,
    applyNotAttemptedReason: guardCheck.allowed ? "" : guardCheck.reason,
  });
  console.log(`Apply en staging terminado: ${summarize(updated)}. Cambios listos para revision: ${applied}.`);

  const critical = criticalRollbacks;
  if (critical > 0) {
    console.error(`CRITICO: ${critical} cambio(s) con rollback fallido en staging. Requiere intervencion humana inmediata.`);
    process.exitCode = 1;
  }
}

// --- FASE notify -----------------------------------------------------------

async function phaseNotify(args: Record<string, string>): Promise<void> {
  if (!isServerlessApprovalsEnabled()) {
    throw new Error(serverlessDisabledReason('La fase "notify" (solicitud de aprobacion por Telegram)'));
  }
  const departmentRunId = requireDepartmentRunId(args);
  const store = createHttpApprovalStoreFromEnv();
  const pending = (await store.listByRun(departmentRunId)).filter((c) => c.status === "staging_applied");

  if (pending.length === 0) {
    console.log("No hay ningun cambio aplicado y validado en staging pendiente de solicitar aprobacion.");
    return;
  }
  if (!isTelegramApprovalsEnabled()) {
    console.log(
      `TELEGRAM_APPROVALS_ENABLED != true: no se envia ninguna solicitud. ${pending.length} cambio(s) siguen en staging esperando a que este entorno pueda notificar.`
    );
    return;
  }

  for (const change of pending) {
    const { port, recorded } = recordingTransitionPort(() => new Date());
    const result = await sendChangeApprovalRequest(change, port, {
      // El approvalId ES el changeId: una sola identidad para la version
      // concreta que se aprueba. No hay un segundo registro que mantener
      // en sincronia -- el datastore serverless es la fuente de verdad.
      upsertApprovalRequest: () => ({ approvalRequestId: change.changeId, isNew: true }),
      markSent: () => undefined,
      send: (text, buttons) => sendTelegramMessage(text, { plainText: true, buttons }),
    });

    if (result.sent) {
      const flushed = await flushRecordedTransitions(store, change.changeId, recorded, change.status, null, new Date().toISOString());
      for (const problem of flushed.problems) console.error(`    ! ${problem}`);
    }
    console.log(`  - ${change.changeId}: ${result.sent ? `solicitud enviada (${result.reason})` : `NO enviada -- ${result.reason}`}`);
  }

  const updated = syncSummaryWith(departmentRunId, await store.listByRun(departmentRunId), {});
  console.log(`Solicitudes de aprobacion procesadas: ${summarize(updated)}.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const phase = args.phase as Phase | undefined;
  if (phase === "plan") return phasePlan(args);
  if (phase === "stage") return phaseStage(args);
  if (phase === "notify") return phaseNotify(args);
  if (phase === "sync") {
    const store = createHttpApprovalStoreFromEnv();
    const departmentRunId = requireDepartmentRunId(args);
    const updated = syncSummaryWith(departmentRunId, await store.listByRun(departmentRunId), {});
    console.log(`Contrato de apply sincronizado con el registro persistente: ${summarize(updated) || "sin elementos"}.`);
    return;
  }
  throw new Error('--phase invalido o ausente. Fases validas: "plan", "stage", "notify", "sync". La publicacion en produccion la ejecuta scripts/run-production-apply.ts, disparado por la aprobacion humana.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
