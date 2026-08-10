import * as dotenv from "dotenv";
dotenv.config();

import { runGrowthDirector } from "../src/agents/growth-director";

runGrowthDirector()
  .then((result) => {
    console.log(`\nGrowth Director — departmentRunId: ${result.departmentRunId}`);
    console.log(`Top acciones: ${result.topActions.length}`);
    console.log(`Zentry: ${result.zentryOpportunities.length} | Tukandado: ${result.tukandadoOpportunities.length} | Mixtas: ${result.mixedOpportunities.length}`);
    console.log(`Competencia: ${result.competitorGapCount} | Contenido: ${result.contentProposalCount} | CRO: ${result.croReviewCount}`);
    console.log(`SEM conectado: ${result.semConnected} | GA4: ${result.analyticsGa4Connected} | GTM: ${result.analyticsGtmConnected}`);
    console.log(
      `Backlog: nuevas=${result.newActionsToday.length} recurrentes=${result.recurringOpenActions.length} pendientes_aprobacion=${result.waitingApprovalActions.length} aprobadas_sin_ejecutar=${result.approvedNotDoneActions.length} descartadas=${result.discardedActions.length}`
    );
    console.log(`Aprobaciones pendientes (Telegram): ${result.pendingApprovalRequests.length}`);
    console.log(`Warnings: ${result.warnings.length}`);
    console.log(`\nInforme ejecutivo: ${result.executiveReportPath}${result.executiveFallbackUsed ? " (fallback seguro, ver logs)" : ""}`);
    console.log(`Informe tecnico: ${result.technicalReportPath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Growth Director Agent fallo:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
