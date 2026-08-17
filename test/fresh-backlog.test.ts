import * as assert from "assert";
import { GrowthDirectorV2Context } from "../src/employees/growth-director-v2/context";
import {
  describeFreshBacklogExclusion,
  FRESH_BACKLOG_NOTICE,
  HISTORIC_EVIDENCE_REFS,
  isFreshBacklogRequested,
  withFreshOperationalBacklog,
} from "../src/department/fresh-backlog";

/**
 * LO QUE ESTOS TESTS FIJAN.
 *
 * Aislar el backlog es facil de hacer mal en las DOS direcciones:
 *
 *   - de menos: dejar una via por la que el trabajo pendiente antiguo
 *     sigue entrando (los resumenes se vacian pero el `evidenceCatalog`
 *     sigue trayendo `actions-top`, por ejemplo), y entonces la "pasada
 *     fresca" no lo es;
 *   - de mas: llevarse por delante las decisiones humanas o la senal de
 *     que los watchers han corrido, y entonces el departamento vuelve a
 *     proponer lo que una persona ya rechazo, o no puede distinguir "no
 *     hay nada" de "hoy no se ha medido".
 */

function contextWithHistory(): GrowthDirectorV2Context {
  return {
    departmentRunId: "growth-department-2026-08-10T070000Z",
    hasDepartmentRunData: true,
    generatedAt: "2026-08-17T07:00:00.000Z",
    agentActivity: [{ agent: "seo-watcher", lastRunAt: "2026-08-17T06:00:00.000Z", status: "ok" }] as unknown as GrowthDirectorV2Context["agentActivity"],
    warnings: ["Aviso previo que no debe perderse."],
    actionsSummary: {
      totalActions: 412,
      liveActionCount: 87,
      byStatus: { open: 87, done: 325 },
      byPriority: { high: 12, medium: 40, low: 35 },
      topOpenActions: [{ actionId: "act-1", title: "Accion vieja" }] as unknown as GrowthDirectorV2Context["actionsSummary"]["topOpenActions"],
    },
    workOrdersSummary: { total: 51, readyForReviewCount: 9, byCategory: { seo: 30 }, byBrand: { zentry: 51 } },
    changePacksSummary: { total: 33, readyForReviewCount: 5, byType: { content: 20 } },
    approvalRequestsSummary: {
      pendingCount: 7,
      byRiskLevel: { medium: 7 },
      topPending: [{ approvalRequestId: "apr-1", summary: "Aprobacion vieja" }] as unknown as GrowthDirectorV2Context["approvalRequestsSummary"]["topPending"],
    },
    jobsSummary: { totalJobSnapshots: 120, latestRunId: "run-9", latestRunJobCount: 6 },
    knownDependencies: [],
    evidenceCatalog: [
      { ref: "actions-live", description: "87 acciones vivas" },
      { ref: "actions-top", description: "top 8 acciones abiertas" },
      { ref: "workorders-ready", description: "9 work orders listas" },
      { ref: "changepacks-ready", description: "5 change packs listos" },
      { ref: "approvals-pending", description: "7 aprobaciones pendientes" },
      { ref: "jobs-latest-run", description: "ultimo run de jobs" },
      { ref: "dept-seo-1", description: "salida real de seo-specialist de HOY" },
    ] as unknown as GrowthDirectorV2Context["evidenceCatalog"],
  };
}

export function runFreshBacklogTests(): { name: string; fn: () => void }[] {
  return [
    {
      name: "El backlog operativo queda a cero: acciones, work orders, change packs y aprobaciones pendientes",
      fn: () => {
        const fresh = withFreshOperationalBacklog(contextWithHistory());
        assert.equal(fresh.actionsSummary.totalActions, 0);
        assert.equal(fresh.actionsSummary.liveActionCount, 0);
        assert.deepStrictEqual(fresh.actionsSummary.topOpenActions, []);
        assert.equal(fresh.workOrdersSummary.total, 0);
        assert.equal(fresh.workOrdersSummary.readyForReviewCount, 0);
        assert.equal(fresh.changePacksSummary.total, 0);
        assert.equal(fresh.approvalRequestsSummary.pendingCount, 0);
        assert.deepStrictEqual(fresh.approvalRequestsSummary.topPending, []);
      },
    },
    {
      name: "LA VIA QUE SE OLVIDA: el evidenceCatalog tampoco puede seguir trayendo el backlog historico",
      fn: () => {
        // Vaciar los resumenes y dejar el catalogo intacto seria un
        // aislamiento aparente: el agente podria citar `actions-top` y
        // reciclar exactamente el mismo trabajo pendiente.
        const fresh = withFreshOperationalBacklog(contextWithHistory());
        const refs = fresh.evidenceCatalog.map((item) => item.ref);
        for (const historic of HISTORIC_EVIDENCE_REFS) {
          assert.ok(!refs.includes(historic), `la ref historica "${historic}" sigue en el catalogo`);
        }
      },
    },
    {
      name: "La evidencia de ESTA pasada se conserva: aislar el historico no es quedarse sin datos de hoy",
      fn: () => {
        const fresh = withFreshOperationalBacklog(contextWithHistory());
        assert.ok(
          fresh.evidenceCatalog.some((item) => item.ref === "dept-seo-1"),
          "la salida real de los especialistas de hoy NO es historico y no se puede excluir"
        );
      },
    },
    {
      name: "NO se vacia en silencio: el contexto dice que se ha vaciado y por que, antes que cualquier otro aviso",
      fn: () => {
        // Un contexto con los contadores a cero y sin explicacion es
        // indistinguible de un fallo de lectura, y el agente razonaria
        // sobre "no hay nada" en vez de sobre "hoy no miramos esto".
        const fresh = withFreshOperationalBacklog(contextWithHistory());
        assert.equal(fresh.warnings[0], FRESH_BACKLOG_NOTICE);
        assert.ok(fresh.warnings.includes("Aviso previo que no debe perderse."), "los avisos que ya habia no se pierden");
      },
    },
    {
      name: "El aviso autoriza explicitamente a no hacer nada: no inventar trabajo es un resultado valido",
      fn: () => {
        const texto = FRESH_BACKLOG_NOTICE.toLowerCase();
        assert.ok(texto.includes("valida"), "el aviso debe decir que no hacer nada es una respuesta valida");
        assert.ok(texto.includes("auditoria"), "el aviso debe dejar claro que el historico se conserva");
        assert.ok(texto.includes("live"), "el aviso debe redirigir a los datos LIVE de hoy");
      },
    },
    {
      name: "jobsSummary NO se vacia: no es trabajo pendiente, es la senal de si los watchers han corrido",
      fn: () => {
        const fresh = withFreshOperationalBacklog(contextWithHistory());
        assert.equal(fresh.jobsSummary.totalJobSnapshots, 120);
        assert.equal(fresh.jobsSummary.latestRunId, "run-9");
        // Sin esto, el agente no podria distinguir "no hay nada que
        // hacer" de "hoy no se ha medido nada".
      },
    },
    {
      name: "No se borra nada: el contexto historico original queda intacto (la funcion es pura)",
      fn: () => {
        const historico = contextWithHistory();
        withFreshOperationalBacklog(historico);
        assert.equal(historico.actionsSummary.liveActionCount, 87, "el contexto de entrada no se puede mutar");
        assert.equal(historico.evidenceCatalog.length, 7);
      },
    },
    {
      name: "El resumen del log dice CUANTO se ha excluido, con cifras reales",
      fn: () => {
        const lineas = describeFreshBacklogExclusion(contextWithHistory()).join("\n");
        assert.ok(lineas.includes("87"), "debe decir cuantas acciones vivas se excluyen");
        assert.ok(lineas.includes("51"), "debe decir cuantas work orders se excluyen");
        assert.ok(lineas.includes("7"), "debe decir cuantas aprobaciones pendientes se excluyen");
        assert.ok(lineas.toLowerCase().includes("conservad"), "debe decir explicitamente que las decisiones humanas se conservan");
      },
    },
    {
      name: "El modo fresco es OPT-IN explicito: sin la variable, la pasada se comporta exactamente como siempre",
      fn: () => {
        assert.equal(isFreshBacklogRequested({}), false);
        assert.equal(isFreshBacklogRequested({ DEPARTMENT_FRESH_BACKLOG: "" }), false);
        assert.equal(isFreshBacklogRequested({ DEPARTMENT_FRESH_BACKLOG: "false" }), false);
        assert.equal(isFreshBacklogRequested({ DEPARTMENT_FRESH_BACKLOG: "1" }), false, "solo el literal true activa el modo");
        assert.equal(isFreshBacklogRequested({ DEPARTMENT_FRESH_BACKLOG: "true" }), true);
        assert.equal(isFreshBacklogRequested({ DEPARTMENT_FRESH_BACKLOG: " TRUE " }), true);
      },
    },
  ];
}
