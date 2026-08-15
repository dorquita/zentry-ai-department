import * as assert from "node:assert/strict";
import { buildDepartmentDailyBrief } from "../src/department/daily-brief";
import { buildApplyPlan, projectChangesIntoSummary } from "../src/department/apply/plan";
import { applyChangeToStaging } from "../src/department/apply/staging-executor";
import { applyApprovedChangeToProduction } from "../src/department/apply/production-executor";
import { sendChangeApprovalRequest } from "../src/department/apply/telegram-notifier";
import { handleDepartmentCallback } from "../src/department/apply/telegram-handler";
import { buildCallbackData } from "../src/department/apply/telegram-message";
import { buildApplyItemId, buildRecommendationId } from "../src/department/apply/types";
import { DepartmentChangeRequest } from "../src/department/apply/change-types";
import { LoadedSpecialistInputs } from "../src/department/specialist-inputs";
import { DepartmentRunManifest } from "../src/department/types";
import { change, memoryPort, NEW_META, NEW_TITLE, NOW, OWNED_PAGES, PROMOTION, RUN_ID, SPEC, stagingPage, STAGING_URL } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const GUARDS_STAGING = { stagingApplyEnabled: true, wordpressWritesEnabled: true, wordpressBackend: "rest", wordpressEnv: "staging" };
const GUARDS_PRODUCTION = {
  departmentProductionApplyEnabled: true,
  productionExecutionEnabled: true,
  productionWritesEnabled: true,
  productionBackend: "rest",
};
const APPROVAL_ID = "3f2a1b4c-1111-2222-3333-444455556666";

function manifestWithSemPending(): DepartmentRunManifest {
  const stage = (name: string, status: string, reason: string) => ({
    stage: name,
    phase: name === "sem-specialist" ? "specialists" : name === "growth-director-v2" ? "growth" : name === "qa-reviewer" ? "qa" : "web-engineering",
    status,
    reason,
    outputPath: null,
    artifactPath: null,
    sourceRunId: null,
    auditWarningCount: null,
    recordedAt: NOW.toISOString(),
  });
  return {
    contractVersion: "department-run/v1",
    departmentRunId: RUN_ID,
    startedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    note: "nota",
    stages: [
      stage("sem-specialist", "not_available", "SEM fuera de esta fase (pendiente)."),
      stage("growth-director-v2", "executed", "ok"),
      stage("qa-reviewer", "executed", "ok"),
      stage("web-engineer", "executed", "ok"),
    ],
  } as DepartmentRunManifest;
}

const EMPTY_SPECIALISTS: LoadedSpecialistInputs = {
  inputs: [
    { employee: "seo-specialist", status: "executed", note: "ok", sourceRunId: null },
    { employee: "sem-specialist", status: "not_available", note: "SEM pendiente / fuera de fase.", sourceRunId: null },
  ],
  evidenceCatalog: [{ ref: "dept-seo-1", description: "239 impresiones, CTR 0% en melamina" } as LoadedSpecialistInputs["evidenceCatalog"][number]],
  executedCount: 1,
};

function brief(apply: ReturnType<typeof buildApplyPlan>) {
  return buildDepartmentDailyBrief({
    manifest: manifestWithSemPending(),
    specialists: EMPTY_SPECIALISTS,
    growth: { status: "executed", reason: "ok", auditWarnings: [] },
    qa: { status: "executed", reason: "ok" },
    webEngineer: { status: "executed", reason: "ok", auditWarnings: [] },
    promotion: PROMOTION,
    apply,
    now: NOW,
  });
}

function plan() {
  return buildApplyPlan({
    departmentRunId: RUN_ID,
    promotion: PROMOTION,
    webEngineer: { status: "executed", output: SPEC },
    ownedStagingPages: OWNED_PAGES,
    now: NOW,
  });
}

export function runDepartmentApplyTraceabilityTests(): TestCase[] {
  return [
    {
      name: "Trazabilidad de punta a punta: runId -> recomendacion -> staging -> Telegram -> decision humana -> produccion",
      fn: async () => {
        // 1. departmentRunId -> recomendacion
        const summary = plan();
        const item = summary.items[0];
        assert.equal(item.departmentRunId, RUN_ID);
        assert.equal(item.recommendationId, buildRecommendationId(RUN_ID, 1));
        assert.equal(item.applyItemId, buildApplyItemId(RUN_ID, 1));
        assert.deepEqual(item.evidenceRefs, ["dept-seo-1"]);
        assert.ok(item.sourceAgents.length > 0);
        assert.equal(item.qaStatus, "PASS");
        assert.equal(item.applyStatus, "proposed");

        // 2. -> stagingChangeId (apply real en staging, con fakes)
        const port = memoryPort();
        const state = { page: stagingPage() };
        const staged = await applyChangeToStaging(
          change({ recommendationId: item.recommendationId, title: item.title }),
          { wordpressPageId: 2091, newTitle: NEW_TITLE, newMetaDescription: NEW_META },
          {
            getPage: async () => ({ ...state.page }),
            updatePublishedPage: async (input) => {
              state.page = { ...state.page, title: input.title, excerpt: input.excerpt };
            },
          },
          GUARDS_STAGING,
          port
        );
        assert.equal(staged.change.status, "staging_applied");
        assert.equal(staged.change.staging?.applyId, `staging::${staged.change.changeId}`);
        assert.equal(staged.change.staging?.url, STAGING_URL);
        const stagingVersion = staged.change.staging?.resultingVersionHash;
        assert.ok(stagingVersion, "la version de staging queda identificada");

        // 3. -> telegramApprovalId
        const notified = await sendChangeApprovalRequest(staged.change, port, {
          upsertApprovalRequest: (input) => {
            assert.equal(input.relatedId, staged.change.changeId, "la solicitud se ata al changeId de ESTA version");
            return { approvalRequestId: APPROVAL_ID, isNew: true };
          },
          markSent: () => undefined,
          send: async () => ({ messageId: 4242, chatId: "555" }),
          now: () => NOW,
        });
        assert.equal(notified.change.status, "awaiting_approval");
        assert.equal(notified.change.telegram?.telegramApprovalId, APPROVAL_ID);
        assert.equal(notified.change.telegram?.telegramMessageId, 4242);
        assert.equal(notified.change.telegram?.stagingVersionHash, stagingVersion);

        // 4. -> humanDecision (aprobar desde Telegram)
        const store = { current: notified.change as DepartmentChangeRequest };
        const productionCalls: DepartmentChangeRequest[] = [];
        const handled = await handleDepartmentCallback(
          { updateId: 1, chatId: "555", fromUserId: "111", data: buildCallbackData("approve", APPROVAL_ID) },
          {
            authorizedChatId: "555",
            authorizedUserId: "111",
            findChangeByApprovalId: () => store.current,
            changes: {
              transition: (current, next, updates, audit) => {
                const result = port.transition(current, next, updates, audit);
                if (result.ok) store.current = result.change;
                return result;
              },
              note: (current, updates, audit) => {
                store.current = port.note(current, updates, audit);
                return store.current;
              },
            },
            setSharedApprovalStatus: () => undefined,
            readStagingVersionHash: async () => stagingVersion ?? null,
            runProductionApply: async (c) => {
              productionCalls.push(c);
              return { change: c, message: "✅ CAMBIO PUBLICADO" };
            },
            reply: async () => undefined,
            openRejectionPrompt: () => undefined,
            findActiveRejectionPrompt: () => undefined,
            closeRejectionPrompt: () => undefined,
            recordFeedback: () => undefined,
            actorLabel: () => "telegram:111",
            now: () => NOW,
          }
        );
        assert.equal(handled?.outcome, "department_production_reported");
        assert.equal(store.current.humanDecision?.decision, "approved");
        assert.equal(store.current.humanDecision?.decidedBy, "telegram:111");
        assert.equal(productionCalls.length, 1);

        // 5. -> productionApplyId (apply real de produccion, con fakes)
        const prod = { page: { id: 900, status: "publish", title: "T prod", contentHtml: "<p>p</p>", excerpt: "M prod", slug: "taquillas-melamina", link: "https://zentrylockers.com/taquillas-melamina/" } };
        const published = await applyApprovedChangeToProduction(
          store.current,
          {
            getStagingPage: async () => ({ ...state.page }),
            findProductionPagesBySlug: async (slug) => [{ id: 900, slug, status: "publish" }],
            getProductionPage: async () => ({ ...prod.page }),
            updateProductionPublishedPage: async (input) => {
              prod.page = { ...prod.page, title: input.title, excerpt: input.excerpt };
            },
          },
          GUARDS_PRODUCTION,
          port
        );
        assert.equal(published.change.status, "production_applied");
        assert.equal(published.change.production?.applyId, `production::${store.current.changeId}`);

        // 6. La cadena completa queda legible en UN solo objeto.
        const final = published.change;
        assert.equal(final.departmentRunId, RUN_ID);
        assert.equal(final.recommendationId, item.recommendationId);
        assert.ok(final.staging?.applyId);
        assert.ok(final.telegram?.telegramApprovalId);
        assert.ok(final.humanDecision?.decidedAt);
        assert.ok(final.production?.applyId);

        // 7. Y se proyecta sobre el contrato de la pasada para el informe.
        const projected = projectChangesIntoSummary(summary, [final]);
        const projectedItem = projected.items[0];
        assert.equal(projectedItem.applyStatus, "production_applied");
        assert.equal(projectedItem.traceability.changeId, final.changeId);
        assert.equal(projectedItem.traceability.stagingUrl, STAGING_URL);
        assert.equal(projectedItem.traceability.telegramApprovalId, APPROVAL_ID);
        assert.equal(projectedItem.traceability.telegramMessageId, 4242);
        assert.equal(projectedItem.traceability.productionApplyId, `production::${final.changeId}`);
        assert.equal(projected.productionWritesPerformed, true);
      },
    },
    {
      name: "La proyeccion usa SIEMPRE la version mas nueva: una aprobacion vieja no representa a una version nueva",
      fn: () => {
        const summary = plan();
        const recommendationId = summary.items[0].recommendationId;
        const v1 = change({ changeId: "c-v1", version: 1, recommendationId, status: "rejected", humanDecision: { decision: "rejected", decidedBy: "telegram:1", decidedAt: NOW.toISOString(), rejectionReason: "H1 generico", channel: "telegram" } });
        const v2 = change({ changeId: "c-v2", version: 2, recommendationId, status: "awaiting_approval" });

        const projected = projectChangesIntoSummary(summary, [v1, v2]);
        assert.equal(projected.items[0].applyStatus, "awaiting_approval");
        assert.equal(projected.items[0].traceability.version, 2);
      },
    },
    {
      name: "El motivo del rechazo llega al Daily Brief como feedback humano legible",
      fn: () => {
        const summary = plan();
        const rejected = change({
          recommendationId: summary.items[0].recommendationId,
          status: "rejected",
          humanDecision: { decision: "rejected", decidedBy: "telegram:111", decidedAt: NOW.toISOString(), rejectionReason: "H1 demasiado generico", channel: "telegram" },
        });
        const projected = projectChangesIntoSummary(summary, [rejected]);
        const report = brief(projected);
        assert.equal(report.apply?.items[0].applyStatus, "rejected");
        assert.match(String(report.apply?.items[0].rejectionReason), /H1 demasiado generico/);
      },
    },
    {
      name: "SEM pendiente no bloquea nada: la pasada planifica apply y el brief sigue completo",
      fn: () => {
        const summary = plan();
        assert.equal(summary.items.length, 1);
        const report = brief(summary);
        assert.ok(report.blockedOrUnknown.some((i) => i.startsWith("SEM:")), "el brief siempre declara SEM pendiente");
        assert.equal(report.apply?.counts.proposed, 1);
        assert.equal(report.externalWrites, "none", "planificar apply no escribe en ningun sistema");
      },
    },
    {
      name: "El Daily Brief usa las etiquetas operativas y distingue staging de produccion",
      fn: () => {
        const summary = plan();
        const staged = change({ recommendationId: summary.items[0].recommendationId, status: "awaiting_approval" });
        const report = brief({ ...projectChangesIntoSummary(summary, [staged]), externalWritesPerformed: true });

        assert.equal(report.apply?.items[0].applyStatusLabel, "AWAITING APPROVAL");
        assert.match(report.externalWrites, /staging/i);
        assert.ok(!/produccion \(/.test(report.externalWrites), "sin publicar en produccion, no se menciona como escritura de produccion");
      },
    },
    {
      name: "El brief solo dice que hubo escrituras en produccion si el contrato lo dice",
      fn: () => {
        const summary = plan();
        const published = change({ recommendationId: summary.items[0].recommendationId, status: "production_applied", production: { environment: "production", applyId: "production::c", wordpressPageId: 900, url: "https://zentrylockers.com/x/", pageSlug: "x", startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), snapshot: null, changedFields: [], validationStatus: "passed", validationDetail: "", rollbackStatus: "not_needed", rollbackDetail: "", resultingVersionHash: "h" } });
        const report = brief({ ...projectChangesIntoSummary(summary, [published]), externalWritesPerformed: true });
        assert.match(report.externalWrites, /produccion/i);
        assert.equal(report.apply?.productionWritesPerformed, true);
      },
    },
  ];
}
