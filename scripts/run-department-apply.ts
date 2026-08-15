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
import {
  getWordpressPage,
  isWordpressDraftsEnabled,
  updateStagingPublishedPageContent,
} from "../src/adapters/wordpress";
import { resolveWordpressBackend, resolveWordpressEnv } from "../src/adapters/wordpress-backend";
import {
  canAttemptProductionWrites,
  getProductionPage,
  isProductionDraftsEnabled,
  isProductionExecutionEnabled,
  resolveProductionBackend,
  searchProductionPagesBySlug,
  updateProductionPublishedPageContent,
} from "../src/adapters/wordpress-production";
import { markApprovalRequestSent, readCurrentApprovalRequests, upsertApprovalRequest } from "../src/core/approval-requests";
import { readCurrentStagingReviewPages } from "../src/core/staging-review-pages";
import { readCurrentStagingExecutions } from "../src/core/staging-executions";
import { isTelegramApprovalsEnabled } from "../src/core/telegram-gateway";
import { validateWebEngineerOutput } from "../src/employees/web-engineer/validator";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import { DEPARTMENT_APPLY_RELATED_TYPE, resolveHumanApproval } from "../src/department/apply/approval";
import { OwnedStagingPage } from "../src/department/apply/capability";
import {
  buildChangeId,
  DEPARTMENT_CHANGE_CONTRACT_VERSION,
  DepartmentChangeRequest,
} from "../src/department/apply/change-types";
import {
  collectFeedbackForRecommendation,
  findChangeById,
  findChangesByRunId,
  nextVersionForRecommendation,
  readCurrentChanges,
} from "../src/department/apply/change-registry";
import { checkProductionApplyGuards, checkStagingApplyGuards, ProductionApplyGuards, StagingApplyGuards } from "../src/department/apply/guards";
import { buildApplyPlan, projectChangesIntoSummary } from "../src/department/apply/plan";
import { applyApprovedChangeToProduction } from "../src/department/apply/production-executor";
import { registryTransitionPort } from "../src/department/apply/registry-port";
import { sendChangeApprovalRequest } from "../src/department/apply/telegram-notifier";
import { applyChangeToStaging } from "../src/department/apply/staging-executor";
import { readApplySummary, updateApplySummaryItems, writeApplySummary } from "../src/department/apply/store";
import { DepartmentApplyItem, DepartmentApplySummary } from "../src/department/apply/types";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { findStageRecord, readManifest, readStageOutput, resolveDepartmentRunPaths, toRepoRelative } from "../src/department/run-store";

type Phase = "plan" | "stage" | "notify" | "production" | "sync";

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

function resolveProductionGuards(): ProductionApplyGuards {
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

/** Reescribe el contrato de la pasada con el estado REAL del registro persistente. */
function syncSummary(departmentRunId: string, updates: { externalWritesPerformed?: boolean; applyNotAttemptedReason?: string }): DepartmentApplySummary {
  const summary = requireSummary(departmentRunId);
  const projected = projectChangesIntoSummary(summary, findChangesByRunId(departmentRunId));
  const updated = updateApplySummaryItems(projected, projected.items, {
    externalWritesPerformed: updates.externalWritesPerformed ?? projected.externalWritesPerformed,
    productionWritesPerformed: projected.productionWritesPerformed,
    applyNotAttemptedReason: updates.applyNotAttemptedReason ?? projected.applyNotAttemptedReason,
  });
  writeApplySummary(updated);
  return updated;
}

// --- FASE plan -------------------------------------------------------------

function phasePlan(args: Record<string, string>): void {
  const departmentRunId = requireDepartmentRunId(args);
  const promotion = loadPromotion(departmentRunId);
  const webEngineer = loadWebEngineer(departmentRunId);
  const ownedStagingPages = loadOwnedStagingPages();

  let summary = buildApplyPlan({ departmentRunId, promotion, webEngineer, ownedStagingPages });
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
    console.log(`  - [${item.applyStatus}] #${item.recommendationRank} ${item.title}`);
  }
}

// --- FASE stage ------------------------------------------------------------

function buildChangeFromItem(item: DepartmentApplyItem, now: Date): DepartmentChangeRequest {
  const version = nextVersionForRecommendation(item.recommendationId);
  const previous = collectFeedbackForRecommendation(item.recommendationId);
  const priorVersions = readCurrentChanges().filter((c) => c.recommendationId === item.recommendationId);
  const supersedes = priorVersions.length > 0 ? priorVersions.sort((a, b) => b.version - a.version)[0].changeId : null;
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
  const departmentRunId = requireDepartmentRunId(args);
  const summary = requireSummary(departmentRunId);
  const guards = resolveStagingGuards();
  const guardCheck = checkStagingApplyGuards(guards);
  console.log(`Interruptores de staging: ${guardCheck.reason}`);

  const port = registryTransitionPort();
  const existing = findChangesByRunId(departmentRunId);
  let externalWrites = false;
  let applied = 0;

  for (const item of summary.items) {
    if (item.applyStatus !== "proposed" || !item.applyCapability.supported || !item.applyCapability.target) continue;
    // Idempotencia: si esta pasada ya creo un cambio para esta
    // recomendacion, no se crea otro (una segunda ejecucion de la fase no
    // puede duplicar aplicaciones ni aprobaciones).
    const already = existing.find((c) => c.recommendationId === item.recommendationId);
    if (already && already.status !== "proposed") {
      console.log(`  - ${item.recommendationId}: ya existe el cambio ${already.changeId} en estado "${already.status}". No se vuelve a aplicar.`);
      continue;
    }

    const change = already ?? port.create(buildChangeFromItem(item, new Date()));
    const target = item.applyCapability.target;
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
    if (result.externalWritePerformed) externalWrites = true;
    if (result.change.status === "staging_applied") applied += 1;
    console.log(`  - ${result.change.changeId}: ${result.change.status} (${result.change.staging?.url ?? "sin URL"})`);
  }

  const updated = syncSummary(departmentRunId, {
    externalWritesPerformed: externalWrites,
    applyNotAttemptedReason: guardCheck.allowed ? "" : guardCheck.reason,
  });
  console.log(`Apply en staging terminado: ${summarize(updated)}. Cambios listos para revision: ${applied}.`);

  const critical = findChangesByRunId(departmentRunId).filter((c) => c.staging?.rollbackStatus === "rollback_failed");
  if (critical.length > 0) {
    console.error(`CRITICO: ${critical.length} cambio(s) con rollback fallido en staging. Requiere intervencion humana inmediata.`);
    process.exitCode = 1;
  }
}

// --- FASE notify -----------------------------------------------------------

async function phaseNotify(args: Record<string, string>): Promise<void> {
  const departmentRunId = requireDepartmentRunId(args);
  const port = registryTransitionPort();
  const pending = findChangesByRunId(departmentRunId).filter((c) => c.status === "staging_applied");

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
    const result = await sendChangeApprovalRequest(change, port, {
      upsertApprovalRequest: (input) => {
        const { request, isNew } = upsertApprovalRequest(
          {
            relatedType: DEPARTMENT_APPLY_RELATED_TYPE as "department_apply_item",
            relatedId: input.relatedId,
            title: input.title,
            summary: input.summary,
            riskLevel: "high",
            requestedAction: input.requestedAction,
            options: ["approved", "rejected"],
            channel: "telegram",
          },
          readCurrentApprovalRequests()
        );
        return { approvalRequestId: request.approvalRequestId, isNew };
      },
      markSent: (approvalRequestId) => {
        markApprovalRequestSent(approvalRequestId, "telegram");
      },
    });
    console.log(`  - ${change.changeId}: ${result.sent ? `solicitud enviada (${result.reason})` : `NO enviada -- ${result.reason}`}`);
  }

  const updated = syncSummary(departmentRunId, {});
  console.log(`Solicitudes de aprobacion procesadas: ${summarize(updated)}.`);
}

// --- FASE production -------------------------------------------------------

async function phaseProduction(args: Record<string, string>): Promise<void> {
  const departmentRunId = args.departmentRunId && args.departmentRunId !== "true" ? args.departmentRunId : null;
  const changeId = args.changeId && args.changeId !== "true" ? args.changeId : null;

  const candidates = changeId
    ? [findChangeById(changeId)].filter((c): c is DepartmentChangeRequest => Boolean(c))
    : departmentRunId
      ? findChangesByRunId(departmentRunId).filter((c) => c.status === "approved")
      : readCurrentChanges().filter((c) => c.status === "approved");

  if (candidates.length === 0) {
    console.log("No hay ningun cambio con aprobacion humana explicita pendiente de publicar en produccion. No se escribe nada.");
    return;
  }

  const guards = resolveProductionGuards();
  const guardCheck = checkProductionApplyGuards(guards);
  console.log(`Interruptores de produccion: ${guardCheck.reason}`);

  const port = registryTransitionPort();
  const approvalRequests = readCurrentApprovalRequests();

  for (const change of candidates) {
    // Defensa en profundidad: el registro persistente de cambios Y el
    // registro comun de aprobaciones tienen que decir lo mismo. Si
    // discrepan, no se publica nada.
    const shared = resolveHumanApproval({ relatedId: change.changeId, requests: approvalRequests });
    if (shared.status !== "approved") {
      console.error(
        `  - ${change.changeId}: BLOQUEADO. El registro comun de aprobaciones dice "${shared.status}" (${shared.reason}). No se publica nada.`
      );
      port.transition(
        change,
        "blocked",
        {},
        {
          event: "production_apply_blocked",
          detail: `Discrepancia entre el registro de cambios (approved) y el registro comun de aprobaciones ("${shared.status}"): ${shared.reason} Fail-closed.`,
        }
      );
      process.exitCode = 1;
      continue;
    }

    const result = await applyApprovedChangeToProduction(
      change,
      {
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
          return {
            id: page.id,
            status: page.status,
            title: page.title,
            contentHtml: page.contentHtml,
            excerpt: page.excerpt,
            slug: page.slug,
            link: page.link,
          };
        },
        updateProductionPublishedPage: async (input) => {
          await updateProductionPublishedPageContent({
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
    console.log(`  - ${result.change.changeId}: ${result.change.status} -- ${result.message.split("\n")[0]}`);
    if (result.change.production?.rollbackStatus === "rollback_failed" || result.change.status === "blocked") {
      process.exitCode = 1;
    }
  }

  if (departmentRunId) {
    const updated = syncSummary(departmentRunId, {});
    console.log(`Produccion terminada: ${summarize(updated)}.`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const phase = args.phase as Phase | undefined;
  if (phase === "plan") return phasePlan(args);
  if (phase === "stage") return phaseStage(args);
  if (phase === "notify") return phaseNotify(args);
  if (phase === "production") return phaseProduction(args);
  if (phase === "sync") {
    const updated = syncSummary(requireDepartmentRunId(args), {});
    console.log(`Contrato de apply sincronizado con el registro persistente: ${summarize(updated) || "sin elementos"}.`);
    return;
  }
  throw new Error('--phase invalido o ausente. Fases validas: "plan", "stage", "notify", "production", "sync".');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

/** Solo para diagnostico manual: nunca se usa en el flujo automatico. */
export { canAttemptProductionWrites };
