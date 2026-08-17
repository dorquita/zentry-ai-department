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
  buildStagingChangeId,
  DEPARTMENT_CHANGE_CONTRACT_VERSION,
  DepartmentChangeRequest,
  EnvironmentApplyRecord,
} from "../src/department/apply/change-types";
import { createHttpApprovalStoreFromEnv } from "../src/approvals/http-store";
import { isServerlessApprovalsEnabled, serverlessDisabledReason } from "../src/approvals/feature-flag";
import { MongoStagingChangeStore } from "../src/approvals/mongo-staging-store";
import { openPersistenceSession, PERSISTENCE_MODE_VAR, resolvePersistenceMode } from "../src/persistence/runtime";
import { Approval, ApprovalStore } from "../src/approvals/store";
import { flushRecordedTransitions, RecordedTransition, recordingTransitionPort } from "../src/approvals/executor-bridge";
import { checkStagingApplyGuards, StagingApplyGuards } from "../src/department/apply/guards";
import { buildApplyPlan, projectChangesIntoSummary } from "../src/department/apply/plan";
import { ResolvedChangePlan } from "../src/department/web-engineer-changeplan";
import { computeVersionHash } from "../src/department/apply/version";
import { sendChangeApprovalRequest } from "../src/department/apply/telegram-notifier";
import { applyChangeToStaging } from "../src/department/apply/staging-executor";
import {
  ChangePlanExecutionFlags,
  decideChangePlanExecution,
  mapOutcomeToChangeStatus,
  runExecutableChangePlan,
} from "../src/department/apply/changeplan-staging-runner";
import { appendExecutePhpAudit } from "../src/core/execute-php-audit";
import { buildPhpForPlan } from "../src/core/execute-php-builder";
import { callNovamiraExecutePhp, openSession } from "../src/adapters/novamira-mcp-client";
import { readStagingPage } from "../src/adapters/staging-inventory-reader";
import { PhpTargetState } from "../src/department/apply/execute-php-executor";
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
 * Interruptores del camino de ChangePlan. Son DISTINTOS de los de
 * `resolveStagingGuards()` a proposito: aquel gobierna el executor
 * legacy de title/meta por REST, y este el camino `execute-php` via
 * Novamira. Apagar uno no apaga el otro, y los dos se comprueban.
 */
function resolveChangePlanFlags(): ChangePlanExecutionFlags {
  return {
    executePhpFallbackEnabled: isEnabled("NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED"),
    novamiraStagingWritesEnabled: isEnabled("NOVAMIRA_STAGING_WRITES_ENABLED"),
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

/**
 * Veredicto del bucle QA -> correccion -> re-QA sobre el PLAN.
 *
 * Fail-closed en una direccion sola, y a proposito: si el fichero existe
 * pero no se puede leer, se devuelve NEEDS_HUMAN_REVIEW (no se aplica
 * nada). Si NO existe, el bucle simplemente no corrio en esta pasada y se
 * devuelve cadena vacia -- tratar su ausencia como bloqueo pararia todas
 * las pasadas que no lo usan.
 */
function loadPlanQaStatus(departmentRunId: string): string {
  const filePath = path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "qa-loop.json");
  if (!fs.existsSync(filePath)) return "";
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { finalStatus?: string };
    return typeof raw.finalStatus === "string" ? raw.finalStatus : "NEEDS_HUMAN_REVIEW";
  } catch {
    return "NEEDS_HUMAN_REVIEW";
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
    // El destino puede venir por DOS caminos: el ChangePlan ya resuelto
    // contra el inventario real (preferente) o la capacidad legacy que
    // interpreta prosa. Antes solo se miraba el legacy, asi que un
    // elemento con ChangePlan se quedaba sin ancla de version -- y sin
    // ancla no se puede afirmar despues "esto no ha cambiado desde que lo
    // viste".
    const targetPageId = item.executableChangePlan?.wordpressPageId ?? item.applyCapability.target?.wordpressPageId ?? null;
    if (targetPageId === null || item.applyStatus !== "proposed") {
      items.push(item);
      continue;
    }
    try {
      const page = await getWordpressPage(targetPageId);
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
            detail: `No se pudo leer la pagina ${targetPageId} para anclar su version: ${err instanceof Error ? err.message : String(err)}. La sesion de aprobacion no podra verificar si cambia desde ahora.`,
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
  const planQaStatus = loadPlanQaStatus(departmentRunId);
  if (planQaStatus) console.log(`Bucle de QA del plan: ${planQaStatus}.`);
  let summary = buildApplyPlan({ departmentRunId, promotion, webEngineer, ownedStagingPages, resolvedChangePlans, planQaStatus });
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

/**
 * Resuelve DONDE se persiste el registro del cambio de staging.
 *
 * Antes esto no se elegia: la fase `stage` exigia el carril serverless
 * (Worker de Cloudflare + D1 + `APPROVALS_API_URL`/`APPROVALS_API_TOKEN`)
 * y, como ese carril esta implementado pero NO desplegado, el apply
 * automatico en staging era inalcanzable. No por seguridad, sino por una
 * dependencia de infraestructura que no tiene nada que ver con escribir
 * en staging.
 *
 * Orden de preferencia, y el motivo de cada escalon:
 *
 *   1. Carril serverless, SI esta activo. Es el unico con transicion
 *      condicional atomica, asi que es el que hay que usar cuando existe.
 *   2. MongoDB, que desde O56/O57 ya es el estado autoritativo del
 *      departamento. Suficiente para staging: un solo escritor
 *      serializado por el `concurrency` del workflow, sin webhooks.
 *   3. Nada. Y entonces se dice, no se aplica a ciegas sin registrar.
 */
async function resolveStagingChangeStore(): Promise<{ store: ApprovalStore; kind: string } | { store: null; reason: string }> {
  if (isServerlessApprovalsEnabled()) {
    return { store: createHttpApprovalStoreFromEnv(), kind: "serverless (Worker + D1)" };
  }
  if (resolvePersistenceMode() !== "mongo") {
    return {
      store: null,
      reason:
        `El carril serverless esta apagado y ${PERSISTENCE_MODE_VAR} no es "mongo", asi que no hay ningun sitio autoritativo donde registrar el cambio. ` +
        "No se aplica nada: escribir en staging sin poder registrar que se escribio dejaria el sitio en un estado que este sistema no sabe explicar.",
    };
  }
  // En modo `mongo` esto falla cerrado si no puede conectar: nunca
  // devuelve una sesion sin repositorio, asi que el `!` de abajo no
  // esconde ningun caso.
  const session = await openPersistenceSession();
  if (!session.repository) {
    return { store: null, reason: `MongoDB es la fuente de verdad pero no hay repositorio disponible: ${session.unavailableReason || "motivo no reportado"}.` };
  }
  return {
    store: new MongoStagingChangeStore(session.repository) as unknown as ApprovalStore,
    kind: `MongoDB (${session.target})`,
  };
}

async function phaseStage(args: Record<string, string>): Promise<void> {
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

  // El registro del cambio vive en un estado AUTORITATIVO externo al
  // runner (serverless o MongoDB), nunca en su filesystem: por eso esta
  // fase puede ejecutarse aqui sin que el registro muera cuando el runner
  // termine.
  const resolved = await resolveStagingChangeStore();
  if (!resolved.store) {
    syncSummaryWith(departmentRunId, [], { externalWritesPerformed: false, applyNotAttemptedReason: resolved.reason });
    console.log(resolved.reason);
    return;
  }
  const store = resolved.store;
  console.log(`Registro del cambio: ${resolved.kind}.`);
  const existing = await store.listByRun(departmentRunId);
  let externalWrites = false;
  let applied = 0;
  let criticalRollbacks = 0;

  // Camino de ChangePlan: se resuelve UNA vez para toda la pasada, no por
  // elemento, porque los interruptores no cambian a mitad de una pasada.
  const changePlanFlags = resolveChangePlanFlags();
  // La sesion MCP se abre PEREZOSAMENTE: si ningun elemento acaba
  // teniendo un ChangePlan ejecutable, no se abre ninguna conexion con
  // Novamira. Una pasada que no escribe no debe ni conectarse.
  let novamiraSession: Awaited<ReturnType<typeof openSession>> | null = null;
  const requireNovamiraSession = async () => {
    if (!novamiraSession) novamiraSession = await openSession();
    return novamiraSession;
  };

  for (const item of summary.items) {
    if (item.applyStatus !== "proposed") continue;

    // ORDEN DELIBERADO: el ChangePlan ejecutable manda sobre la capacidad
    // legacy. El legacy interpreta la PROSA de web-engineer buscando
    // `page_id=N` y lineas `TITLE:`/`META:`; el ChangePlan viene ya
    // resuelto contra el inventario REAL, con el BEFORE leido y el ancla
    // de version. Cuando existen los dos, ejecutar el legacy seria
    // preferir la adivinanza al dato.
    const planDecision = decideChangePlanExecution({ executableChangePlan: item.executableChangePlan, flags: changePlanFlags });
    const hasLegacyCapability = item.applyCapability.supported && item.applyCapability.target !== null;

    if (!planDecision.executable && !hasLegacyCapability) {
      // Esto ya NO es silencio: antes un elemento con ChangePlan pero sin
      // capacidad legacy se descartaba sin decir nada, y la pasada
      // terminaba diciendo "requiere implementacion manual" con la
      // capacidad de ejecutarlo construida al lado.
      if (item.executableChangePlan) {
        console.log(`  - ${item.recommendationId}: tiene ChangePlan ejecutable pero NO se ejecuta. Motivo: ${planDecision.reason}`);
      }
      continue;
    }

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

    if (planDecision.executable && item.executableChangePlan) {
      // --- CAMINO CHANGEPLAN (execute-php via Novamira) ---------------
      //
      // Es EXACTAMENTE el mismo executor que ya usaba la sesion de
      // aprobacion manual y que certifico el E2E controlado: snapshot ->
      // ancla de version -> apply -> read-back por una via distinta a la
      // de escritura -> validacion de scope -> rollback verificado.
      const executable = item.executableChangePlan;
      console.log(`  - ${item.recommendationId}: ${planDecision.reason}`);

      const session = await requireNovamiraSession();
      const outcome = await runExecutableChangePlan({
        executable,
        departmentRunId: item.departmentRunId,
        recommendationId: item.recommendationId,
        changeId: change.changeId,
        qaStatus: item.qaStatus,
        flags: changePlanFlags,
        onAudit: (record) => appendExecutePhpAudit(record),
        deps: {
          getState: async (postId: number): Promise<PhpTargetState> => {
            const page = await readStagingPage(postId);
            return {
              id: page.wordpressPageId,
              status: page.status,
              title: page.title,
              contentHtml: page.contentHtml,
              excerpt: page.excerpt,
              link: page.stagingUrl,
              slug: page.slug,
              meta: page.meta,
            };
          },
          runPhp: async (php: string) =>
            callNovamiraExecutePhp(
              {
                actor: "department_daily_apply",
                abilityName: "novamira/execute-php",
                environment: "staging",
                // El PHP de rollback NO es el del plan: distinguirlos por
                // igualdad literal con el PHP del apply es lo que hace
                // que la auditoria diga la fase correcta.
                phase: php === buildPhpForPlan(executable.plan) ? "apply" : "rollback",
                qaStatus: item.qaStatus,
                departmentRunId: item.departmentRunId,
                recommendationId: item.recommendationId,
                changeId: change.changeId,
                plan: executable.plan,
                php,
                capabilitySelection: executable.capability,
                flags: changePlanFlags,
                snapshotPreviousValue: executable.beforeValue,
                snapshotPreviousExisted: true,
              },
              session
            ),
        },
      });

      const nextStatus = mapOutcomeToChangeStatus(outcome.status);
      const nowIso = new Date().toISOString();
      const stagingRecord: EnvironmentApplyRecord = {
        environment: "staging",
        applyId: buildStagingChangeId(change.changeId),
        wordpressPageId: executable.wordpressPageId,
        url: executable.stagingUrl,
        // El slug no lo devuelve el executor de PHP. Se deja vacio a
        // proposito en vez de derivarlo de la URL: es el UNICO campo con
        // el que se empareja staging con produccion, y un slug adivinado
        // ahi seria una forma de escribir en la pagina equivocada.
        pageSlug: "",
        startedAt: nowIso,
        finishedAt: nowIso,
        snapshot: null,
        changedFields: [
          {
            field: executable.operation,
            before: outcome.beforeValue ?? executable.beforeValue,
            after: outcome.afterValue ?? executable.afterValue,
            changed: outcome.status === "applied",
          },
        ],
        validationStatus: outcome.validation as EnvironmentApplyRecord["validationStatus"],
        validationDetail: outcome.detail,
        rollbackStatus: outcome.rollback as EnvironmentApplyRecord["rollbackStatus"],
        rollbackDetail: outcome.rollback === "not_needed" ? "" : outcome.detail,
        resultingVersionHash: outcome.afterHash,
        githubRunId: null,
      };

      // La transicion intermedia `staging_applying` se persiste tambien
      // cuando el resultado final ya se conoce: la maquina de estados no
      // tiene arista directa de `proposed` a `staging_applied`, y saltarsela
      // dejaria un registro que no se puede reconstruir.
      const transitions: RecordedTransition[] =
        nextStatus === "proposed"
          ? []
          : [
              {
                from: "proposed",
                to: "staging_applying",
                updates: {},
                audit: { event: "staging_applying", detail: `Apply de ChangePlan iniciado sobre el post ${executable.wordpressPageId} de staging.` },
              },
              {
                from: "staging_applying",
                to: nextStatus,
                updates: { staging: stagingRecord },
                audit: { event: outcome.status, detail: outcome.detail },
              },
            ];

      const flushed = await flushRecordedTransitions(store, change.changeId, transitions, change.status, null, nowIso);
      for (const problem of flushed.problems) console.error(`    ! ${problem}`);

      if (outcome.stagingWritePerformed) externalWrites = true;
      if (nextStatus === "staging_applied") applied += 1;
      if (outcome.rollback === "rollback_failed") criticalRollbacks += 1;
      console.log(`    -> ${outcome.status}: ${outcome.detail}`);
      console.log(`       validacion=${outcome.validation} rollback=${outcome.rollback} url=${executable.stagingUrl}`);
      continue;
    }

    // --- CAMINO LEGACY (title/meta por REST) --------------------------
    const target = item.applyCapability.target;
    if (!target) continue;
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
