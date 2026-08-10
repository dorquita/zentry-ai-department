import * as dotenv from "dotenv";
dotenv.config();
import { buildDepartmentRunId } from "../src/core/department-run-id";
import { runStagingExecutor } from "../src/agents/staging-executor";
import { runStagingQaAgent } from "../src/agents/staging-qa-agent";
import { runApprovalGateway } from "../src/agents/approval-gateway";
import { runProductionDeploymentPlanner } from "../src/agents/production-deployment-planner";
import { runProductionDraftExecutor } from "../src/agents/production-draft-executor";
import { runGrowthDirector } from "../src/agents/growth-director";
import { emitEvent } from "../src/core/department-events";

/**
 * Fase O27 -- QA parcial real: ejecuta SOLO los pasos que no dependen de
 * Search Console (que hoy falla con invalid_grant, credencial externa
 * caducada, sin relacion con esta fase) para probar de verdad, contra los
 * datos reales acumulados, que: (a) el Staging Executor no rompe nada con
 * el Carril A nuevo, (b) el Production Deployment Planner no rompe nada
 * con el dedup nuevo, (c) Growth Director genera el informe ejecutivo V2
 * (6 secciones) sin errores de coherencia contra el backlog real de hoy
 * (ya limpiado por scripts/o27-backlog-cleanup.ts).
 *
 * NO ejecuta SEO Watcher/SEO Director/Competitor Intelligence/Content
 * Planner/CRO Landing Reviewer/SEM Watcher/Analytics Watcher/Approval
 * Queue/Approved Action Planner/los Work Order Builders/los Change Pack
 * Builders/WordPress Draft Agent/Visual Template Builder/Visual Asset
 * Planner -- por eso emite un evento "agent_started"/"agent_finished"
 * sintetico por cada uno de esos (payload minimo, solo para que Growth
 * Director no trate su ausencia como un fallo), dejando claro en el log
 * que es un QA parcial, no una pasada diaria real completa.
 */

async function main(): Promise<void> {
  const departmentRunId = buildDepartmentRunId();
  console.log(`departmentRunId (QA parcial O27): ${departmentRunId}`);

  console.log("\n[QA] Staging Executor...");
  const stagingExecutorResult = await runStagingExecutor(departmentRunId);
  console.log(
    `  puede_escribir=${stagingExecutorResult.canAttemptRealWrites} en_cola_nuevas=${stagingExecutorResult.newPendingExecutions.length} auto_aprobadas_carril_a=${stagingExecutorResult.autoApprovedCarrilAThisPass.length} aplicadas=${stagingExecutorResult.appliedThisPass.length} fallidas=${stagingExecutorResult.failedThisPass.length} pendientes_aprobacion=${stagingExecutorResult.pendingApprovalCount}`
  );

  console.log("\n[QA] Staging QA Agent...");
  const stagingQaResult = await runStagingQaAgent(departmentRunId);
  console.log(
    `  staging_200=${stagingQaResult.siteHealth.status200} verificados=${stagingQaResult.checkedCount} pasan=${stagingQaResult.passCount} fallan=${stagingQaResult.failCount}`
  );

  console.log("\n[QA] Approval Gateway...");
  const approvalGatewayResult = await runApprovalGateway(departmentRunId);
  console.log(`  telegram_activo=${approvalGatewayResult.telegramEnabled} nuevas_solicitudes=${approvalGatewayResult.newRequests.length}`);

  console.log("\n[QA] Production Deployment Planner...");
  const productionPlannerResult = await runProductionDeploymentPlanner(departmentRunId);
  console.log(
    `  planes_nuevos=${productionPlannerResult.newPlans.length} omitidos_duplicado_canonicalKey=${productionPlannerResult.skippedDuplicateCanonicalKey} total_planes=${productionPlannerResult.totalPlanCount}`
  );

  console.log("\n[QA] Production Draft Executor...");
  const productionExecutorResult = await runProductionDraftExecutor(departmentRunId);
  console.log(`  can_attempt_real_writes=${productionExecutorResult.canAttemptRealWrites} aplicadas=${productionExecutorResult.appliedThisPass.length}`);

  // Marcadores sinteticos para los agentes NO ejecutados en este QA
  // parcial (Search Console caido hoy) -- para que Growth Director no
  // trate su ausencia de evento como una senal de fallo real.
  for (const agent of [
    "seo-watcher",
    "seo-director",
    "competitor-intelligence",
    "content-planner",
    "cro-landing-reviewer",
    "sem-watcher",
    "analytics-watcher",
    "approval-queue",
    "approved-action-planner",
    "seo-work-order-builder",
    "content-work-order-builder",
    "cro-work-order-builder",
    "seo-change-pack-builder",
    "content-change-pack-builder",
    "cro-change-pack-builder",
    "wordpress-draft-agent",
    "visual-template-builder",
    "visual-asset-planner",
  ]) {
    emitEvent({
      departmentRunId,
      agent,
      type: "agent_finished",
      summary: `${agent}: omitido en este QA parcial (Search Console con invalid_grant hoy, no relacionado con la Fase O27) -- se ejecutara en la siguiente pasada diaria real.`,
      payload: {},
    });
  }

  console.log("\n[QA] Growth Director...");
  const growthResult = await runGrowthDirector(departmentRunId);
  console.log(`  Informe ejecutivo: ${growthResult.executiveReportPath}${growthResult.executiveFallbackUsed ? " (FALLBACK -- ver logs)" : ""}`);
  console.log(`  Informe tecnico: ${growthResult.technicalReportPath}`);
  console.log(`  preparedForReviewCount=${growthResult.preparedForReviewCount} pendingDecisionCount=${growthResult.pendingDecisionCount}`);
}

main().catch((err) => {
  console.error("QA parcial O27 fallo:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
