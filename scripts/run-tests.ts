/**
 * Runner de tests minimo, sin dependencias nuevas (usa node:assert, ya
 * incluido en Node). Cada suite exporta una lista de { name, fn } — si
 * `fn()` lanza, el test falla. Pensado para pruebas puras de logica de
 * negocio (deduplicacion, redaccion de informes), no para tests de
 * integracion contra el VPS real.
 *
 * Uso: npm test
 */
import { runExecutiveReportTests } from "../test/executive-report.test";
import { runNovamiraGuardTests } from "../test/novamira-guard.test";
import { runClientConfigTests } from "../test/client-config.test";
import { runSubagentToolGuardTests } from "../test/subagent-tool-guard.test";
import { runInternalUrlGuardTests } from "../test/internal-url-guard.test";
import { runLandingArchitectComparisonTests } from "../test/landing-architect-comparison.test";
import { runLandingArchitectChangePackSelectionTests } from "../test/landing-architect-change-pack-selection.test";
import { runLandingArchitectV2OutputSchemaTests } from "../test/landing-architect-v2-output-schema.test";
import { runRunnerResultParserTests } from "../test/runner-result-parser.test";
import { runComparisonArtifactReaderTests } from "../test/comparison-artifact-reader.test";
import { runClaudeEmployeeRuntimeTests } from "../test/claude-employee-runtime.test";
import { runJsonSchemaLiteTests } from "../test/json-schema-lite.test";
import { runGrowthDirectorV2ContextTests } from "../test/growth-director-v2-context.test";
import { runGrowthDirectorV2DomainTests } from "../test/growth-director-v2-domain.test";
import { runGrowthDirectorV2OutputSchemaTests } from "../test/growth-director-v2-output-schema.test";
import { runGrowthDirectorV2RunnerResultParserTests } from "../test/growth-director-v2-runner-result-parser.test";
import { runSemSpecialistContextTests } from "../test/sem-specialist-context.test";
import { runSemSpecialistOutputTests } from "../test/sem-specialist-output.test";
import { runSemSpecialistOutputSchemaTests } from "../test/sem-specialist-output-schema.test";
import { runSemSpecialistRunnerResultParserTests } from "../test/sem-specialist-runner-result-parser.test";
import { runSemSpecialistArtifactTests } from "../test/sem-specialist-artifact.test";
import { runSeoSpecialistOutputSchemaTests } from "../test/seo-specialist-output-schema.test";
import { runSeoSpecialistDomainTests } from "../test/seo-specialist-domain.test";
import { runSeoSpecialistContextTests } from "../test/seo-specialist-context.test";
import { runAnalyticsSpecialistOutputSchemaTests } from "../test/analytics-specialist-output-schema.test";
import { runAnalyticsSpecialistReportParserTests } from "../test/analytics-specialist-report-parser.test";
import { runAnalyticsSpecialistContextTests } from "../test/analytics-specialist-context.test";
import { runAnalyticsSpecialistAuditTests } from "../test/analytics-specialist-audit.test";
import { runAnalyticsSpecialistValidatorTests } from "../test/analytics-specialist-validator.test";
import { runAnalyticsSpecialistRunnerResultTests } from "../test/analytics-specialist-runner-result.test";
import { runContentStrategistSelectionTests } from "../test/content-strategist-selection.test";
import { runContentStrategistContextTests } from "../test/content-strategist-context.test";
import { runContentStrategistOutputTests } from "../test/content-strategist-output.test";
import { runContentStrategistOutputSchemaTests } from "../test/content-strategist-output-schema.test";
import { runContentStrategistAuditTests } from "../test/content-strategist-audit.test";
import { runContentStrategistBriefTests } from "../test/content-strategist-brief.test";
import { runWebEngineerOutputSchemaTests } from "../test/web-engineer-output-schema.test";
import { runWebEngineerValidatorTests } from "../test/web-engineer-validator.test";
import { runWebEngineerContextTests } from "../test/web-engineer-context.test";
import { runWebEngineerChangePackSelectionTests } from "../test/web-engineer-change-pack-selection.test";
import { runWebEngineerRunnerResultTests } from "../test/web-engineer-runner-result.test";
import { runQaReviewerOutputTests } from "../test/qa-reviewer-output.test";
import { runQaReviewerOutputSchemaTests } from "../test/qa-reviewer-output-schema.test";
import { runQaReviewerContextTests } from "../test/qa-reviewer-context.test";
import { runQaReviewerRunnerTests } from "../test/qa-reviewer-runner.test";
import { runDepartmentPromotionTests } from "../test/department-promotion.test";
import { runDepartmentSpecialistInputsTests } from "../test/department-specialist-inputs.test";
import { runDepartmentDailyBriefTests } from "../test/department-daily-brief.test";
import { runDepartmentCoordinationSafetyTests } from "../test/department-coordination-safety.test";
import { runDepartmentApplyApprovalTests } from "../test/department-apply-approval.test";
import { runDepartmentApplyStateMachineTests } from "../test/department-apply-state-machine.test";
import { runDepartmentApplyStagingTests } from "../test/department-apply-staging.test";
import { runDepartmentApplyProductionTests } from "../test/department-apply-production.test";
import { runDepartmentApplyTelegramTests } from "../test/department-apply-telegram.test";
import { runDepartmentApplyTraceabilityTests } from "../test/department-apply-traceability.test";
import { runDepartmentBriefEmailTests } from "../test/department-brief-email.test";
import { runApprovalsHumanFeedbackTests } from "../test/approvals-human-feedback.test";
import { runApprovalsHttpStoreTests } from "../test/approvals-http-store.test";
import { runProductionApplyRunnerTests } from "../test/production-apply-runner.test";
import { runWorkerWebhookTests } from "../test/worker-webhook.test";
import { runWorkerD1StoreTests } from "../test/worker-d1-store.test";
import { runWorkerRuntimeCompatTests } from "../test/worker-runtime-compat.test";
import { runDepartmentEmployeeRunsTests } from "../test/department-employee-runs.test";

interface TestCase {
  name: string;
  /**
   * Puede ser sincrona (la mayoria) o asincrona: el executor del apply
   * del departamento es `async`, y sin `await` aqui un test que fallara
   * pasaria en silencio (la promesa rechazada no tumbaba el runner).
   */
  fn: () => void | Promise<void>;
}

async function main(): Promise<void> {
  const suites: Array<{ suiteName: string; cases: TestCase[] }> = [
    { suiteName: "executive-report", cases: runExecutiveReportTests() },
    { suiteName: "novamira-guard", cases: runNovamiraGuardTests() },
    { suiteName: "client-config", cases: runClientConfigTests() },
    { suiteName: "subagent-tool-guard", cases: runSubagentToolGuardTests() },
    { suiteName: "internal-url-guard", cases: runInternalUrlGuardTests() },
    { suiteName: "landing-architect-comparison", cases: runLandingArchitectComparisonTests() },
    { suiteName: "landing-architect-change-pack-selection", cases: runLandingArchitectChangePackSelectionTests() },
    { suiteName: "landing-architect-v2-output-schema", cases: runLandingArchitectV2OutputSchemaTests() },
    { suiteName: "runner-result-parser", cases: runRunnerResultParserTests() },
    { suiteName: "comparison-artifact-reader", cases: runComparisonArtifactReaderTests() },
    { suiteName: "claude-employee-runtime", cases: runClaudeEmployeeRuntimeTests() },
    { suiteName: "json-schema-lite", cases: runJsonSchemaLiteTests() },
    { suiteName: "growth-director-v2-context", cases: runGrowthDirectorV2ContextTests() },
    { suiteName: "growth-director-v2-domain", cases: runGrowthDirectorV2DomainTests() },
    { suiteName: "growth-director-v2-output-schema", cases: runGrowthDirectorV2OutputSchemaTests() },
    { suiteName: "growth-director-v2-runner-result-parser", cases: runGrowthDirectorV2RunnerResultParserTests() },
    { suiteName: "sem-specialist-context", cases: runSemSpecialistContextTests() },
    { suiteName: "sem-specialist-output", cases: runSemSpecialistOutputTests() },
    { suiteName: "sem-specialist-output-schema", cases: runSemSpecialistOutputSchemaTests() },
    { suiteName: "sem-specialist-runner-result-parser", cases: runSemSpecialistRunnerResultParserTests() },
    { suiteName: "sem-specialist-artifact", cases: runSemSpecialistArtifactTests() },
    { suiteName: "seo-specialist-output-schema", cases: runSeoSpecialistOutputSchemaTests() },
    { suiteName: "seo-specialist-domain", cases: runSeoSpecialistDomainTests() },
    { suiteName: "seo-specialist-context", cases: runSeoSpecialistContextTests() },
    { suiteName: "analytics-specialist-output-schema", cases: runAnalyticsSpecialistOutputSchemaTests() },
    { suiteName: "analytics-specialist-report-parser", cases: runAnalyticsSpecialistReportParserTests() },
    { suiteName: "analytics-specialist-context", cases: runAnalyticsSpecialistContextTests() },
    { suiteName: "analytics-specialist-audit", cases: runAnalyticsSpecialistAuditTests() },
    { suiteName: "analytics-specialist-validator", cases: runAnalyticsSpecialistValidatorTests() },
    { suiteName: "analytics-specialist-runner-result", cases: runAnalyticsSpecialistRunnerResultTests() },
    { suiteName: "content-strategist-selection", cases: runContentStrategistSelectionTests() },
    { suiteName: "content-strategist-context", cases: runContentStrategistContextTests() },
    { suiteName: "content-strategist-output", cases: runContentStrategistOutputTests() },
    { suiteName: "content-strategist-output-schema", cases: runContentStrategistOutputSchemaTests() },
    { suiteName: "content-strategist-audit", cases: runContentStrategistAuditTests() },
    { suiteName: "content-strategist-brief", cases: runContentStrategistBriefTests() },
    { suiteName: "web-engineer-output-schema", cases: runWebEngineerOutputSchemaTests() },
    { suiteName: "web-engineer-validator", cases: runWebEngineerValidatorTests() },
    { suiteName: "web-engineer-context", cases: runWebEngineerContextTests() },
    { suiteName: "web-engineer-change-pack-selection", cases: runWebEngineerChangePackSelectionTests() },
    { suiteName: "web-engineer-runner-result", cases: runWebEngineerRunnerResultTests() },
    { suiteName: "qa-reviewer-output", cases: runQaReviewerOutputTests() },
    { suiteName: "qa-reviewer-output-schema", cases: runQaReviewerOutputSchemaTests() },
    { suiteName: "qa-reviewer-context", cases: runQaReviewerContextTests() },
    { suiteName: "qa-reviewer-runner", cases: runQaReviewerRunnerTests() },
    { suiteName: "department-promotion", cases: runDepartmentPromotionTests() },
    { suiteName: "department-specialist-inputs", cases: runDepartmentSpecialistInputsTests() },
    { suiteName: "department-daily-brief", cases: runDepartmentDailyBriefTests() },
    { suiteName: "department-coordination-safety", cases: runDepartmentCoordinationSafetyTests() },
    { suiteName: "department-employee-runs", cases: runDepartmentEmployeeRunsTests() },
    { suiteName: "department-apply-approval", cases: runDepartmentApplyApprovalTests() },
    { suiteName: "department-apply-state-machine", cases: runDepartmentApplyStateMachineTests() },
    { suiteName: "department-apply-staging", cases: runDepartmentApplyStagingTests() },
    { suiteName: "department-apply-production", cases: runDepartmentApplyProductionTests() },
    { suiteName: "department-apply-telegram", cases: runDepartmentApplyTelegramTests() },
    { suiteName: "department-apply-traceability", cases: runDepartmentApplyTraceabilityTests() },
    { suiteName: "department-brief-email", cases: runDepartmentBriefEmailTests() },
    { suiteName: "approvals-human-feedback", cases: runApprovalsHumanFeedbackTests() },
    { suiteName: "approvals-http-store", cases: runApprovalsHttpStoreTests() },
    { suiteName: "production-apply-runner", cases: runProductionApplyRunnerTests() },
    { suiteName: "worker-webhook", cases: runWorkerWebhookTests() },
    { suiteName: "worker-d1-store", cases: runWorkerD1StoreTests() },
    { suiteName: "worker-runtime-compat", cases: runWorkerRuntimeCompatTests() },
  ];

  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    console.log(`\n${suite.suiteName}`);
    for (const testCase of suite.cases) {
      try {
        await testCase.fn();
        passed += 1;
        console.log(`  ok - ${testCase.name}`);
      } catch (err) {
        failed += 1;
        console.error(`  FAIL - ${testCase.name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
