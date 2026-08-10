import * as assert from "node:assert/strict";
import { readCurrentActions } from "../src/core/action-backlog";
import { readCurrentWorkOrders } from "../src/core/work-orders";
import { readCurrentApprovalRequests } from "../src/core/approval-requests";
import { readCurrentChangePacks } from "../src/core/change-packs";
import { readCurrentWordpressDrafts } from "../src/core/wordpress-drafts";
import { getWordpressStatusForReport } from "../src/adapters/wordpress";
import {
  buildExecutiveReportData,
  ExecutiveReportData,
  ExecutiveReportInput,
  renderExecutiveReportMarkdown,
  validateExecutiveReportCoherence,
} from "../src/core/executive-report";
import { ActionStatus } from "../src/core/types";

/**
 * Suite de validacion contra el DATASET REAL del backlog (no datos
 * sinteticos). Deliberadamente separada de test/executive-report.test.ts
 * (que es pura/sintetica y funciona en cualquier sitio): esta suite lee
 * data/action-backlog.jsonl, data/work-orders.jsonl y
 * data/approval-requests.jsonl tal como estan en el VPS, asi que solo
 * tiene sentido ejecutarla ahi (`npm run test:real-data`), despues de que
 * `npm run growth:daily` haya corrido al menos una vez. Solo lectura: no
 * modifica nada.
 */

export interface TestCase {
  name: string;
  fn: () => void;
}

const LIVE_ACTION_STATUSES: ActionStatus[] = ["new", "open", "auto_approved_for_planning", "waiting_approval", "approved"];
const DATE_LABEL = "2026-08-03";

function buildRealInput(): ExecutiveReportInput {
  const allActions = readCurrentActions();
  const actionableActions = allActions.filter((a) => LIVE_ACTION_STATUSES.includes(a.status));
  const workOrders = readCurrentWorkOrders();
  const waitingApprovalActions = allActions.filter((a) => a.status === "waiting_approval");
  const pendingApprovalRequests = readCurrentApprovalRequests().filter((r) => r.status === "pending");

  return {
    dateLabel: DATE_LABEL,
    actionableActions,
    workOrders,
    waitingApprovalActions,
    pendingApprovalRequests,
    competitorGapCount: allActions.filter((a) => a.actionType.startsWith("competitor:")).length,
    changePackCount: readCurrentChangePacks().length,
    localPreviewCount: readCurrentWordpressDrafts().filter((d) => d.status === "local_preview").length,
    wordpressDraftCount: readCurrentWordpressDrafts().filter((d) => d.status === "wp_draft_created").length,
    wordpressDraftsEnabled: getWordpressStatusForReport().enabled,
    croReviewCount: allActions.filter((a) => a.actionType.startsWith("cro:")).length,
    semConnected: false,
    analyticsGa4Connected: false,
    analyticsGtmConnected: false,
    warnings: [],
  };
}

export function runRealDataTests(): TestCase[] {
  const input = buildRealInput();

  if (input.actionableActions.length === 0) {
    return [
      {
        name: "dataset real: backlog vacio, se omiten las validaciones (ejecuta npm run growth:daily primero)",
        fn: () => {},
      },
    ];
  }

  const data: ExecutiveReportData = buildExecutiveReportData(input);
  const markdown = renderExecutiveReportMarkdown(data, `${DATE_LABEL}T12:00:00.000Z`);

  return [
    {
      name: 'dataset real: no aparece la expresion "Zentry y Tukandado aparece"',
      fn: () => {
        assert.equal(/zentry y tukandado aparece/i.test(markdown), false);
      },
    },
    {
      name: "dataset real: una posicion de Search Console de zentrylockers.com se atribuye unicamente a Zentry",
      fn: () => {
        const seoFindings = data.findings.filter((f) => /dato real de Search Console/i.test(f.detected));
        for (const f of seoFindings) {
          assert.ok(/^Zentry aparece/.test(f.detected), `"${f.title}" deberia atribuir la posicion solo a Zentry, no a un compuesto de marcas`);
        }
      },
    },
    {
      name: '"taquillas melamina" y "taquillas de melamina" no generan conclusiones separadas',
      fn: () => {
        const melaminaTitles = data.findings.map((f) => f.title.toLowerCase()).filter((t) => t.includes("melamina"));
        assert.ok(melaminaTitles.length <= 1, `deberian fusionarse en una unica conclusion, encontradas: ${melaminaTitles.join(", ")}`);
      },
    },
    {
      name: '"cerraduras inteligentes para centros deportivos" no aparece dos veces en conclusiones ni en acciones',
      fn: () => {
        const allTitles = [
          ...data.findings.map((f) => f.title.toLowerCase()),
          ...data.recommendedNow.map((a) => a.action.toLowerCase()),
          ...data.recommendedLater.map((a) => a.action.toLowerCase()),
        ];
        const matches = allTitles.filter((t) => t.includes("centros deportivos"));
        assert.equal(matches.length, new Set(matches).size, `aparece repetido: ${matches.join(" | ")}`);
      },
    },
    {
      name: "si el informe recomienda revisar o aprobar acciones, no dice que no hay decisiones pendientes",
      fn: () => {
        if (data.recommendedNow.length > 0) {
          assert.equal(markdown.includes("No hay decisiones pendientes hoy."), false);
        }
      },
    },
    {
      name: "si no requiere decision, el proximo paso tampoco pide revisar/aprobar acciones",
      fn: () => {
        if (data.pendingDecisions.length === 0) {
          assert.equal(/revisar|aprobar/i.test(data.nextStep), false);
        }
      },
    },
    {
      name: "las cifras de decisiones pendientes coinciden entre el dato y el proximo paso",
      fn: () => {
        if (data.pendingDecisions.length > 0) {
          assert.ok(data.nextStep.includes(String(data.pendingDecisions.length)));
        }
      },
    },
    {
      name: "las acciones de dias anteriores no se contabilizan como trabajo nuevo de hoy",
      fn: () => {
        const trulyNewToday = input.actionableActions.filter(
          (a) => a.createdAt.slice(0, 10) === DATE_LABEL && a.seenCount === 1
        );
        if (trulyNewToday.length === 0) {
          assert.equal(data.newOpportunityCount, 0);
          assert.ok(markdown.includes("No se detectaron oportunidades nuevas hoy"));
        }
      },
    },
    {
      name: "no se presenta como demanda validada una oportunidad obtenida solo de competidores",
      fn: () => {
        const competitorOnlyFindings = data.findings.filter((f) =>
          /estimacion basada en el analisis de paginas de competidores/i.test(f.detected)
        );
        for (const f of competitorOnlyFindings) {
          assert.equal(/volumen de busqueda real/i.test(f.whyItMatters), false);
        }
      },
    },
    {
      name: "el informe ejecutivo real respeta los maximos de 4 conclusiones, 3 acciones inmediatas y 3 posteriores",
      fn: () => {
        assert.ok(data.findings.length <= 4);
        assert.ok(data.recommendedNow.length <= 3);
        assert.ok(data.recommendedLater.length <= 3);
      },
    },
    {
      name: "el informe ejecutivo real pasa la revision de coherencia del Growth Director",
      fn: () => {
        const problems = validateExecutiveReportCoherence(data);
        assert.deepEqual(problems, []);
      },
    },
  ];
}
