import { GrowthDirectorV2Context } from "../employees/growth-director-v2/context";

/**
 * BACKLOG OPERATIVO FRESCO.
 *
 *     HISTORICO                    -> se conserva, intacto
 *     BACKLOG OPERATIVO DE LA PASADA -> empieza vacio
 *
 * EL PROBLEMA. El contexto de Growth arrastra, sin filtro de pasada, TODO
 * el estado acumulado: `readCurrentActions()`, `readCurrentWorkOrders()`,
 * `readCurrentChangePacks()`, `readCurrentApprovalRequests()`,
 * `readAllJobs()`. Eso entra al prompt de dos formas -- como resumenes
 * (`topOpenActions`, `topPending`) y como entradas citables del
 * `evidenceCatalog` (`actions-live`, `actions-top`, `workorders-ready`,
 * `changepacks-ready`, `approvals-pending`, `jobs-latest-run`).
 *
 * Consecuencia: cuando se quiere comprobar si el departamento SABE
 * encontrar trabajo util a partir de datos LIVE, no se comprueba eso. Se
 * comprueba si sabe reciclar su propio backlog. Las "recomendaciones
 * nuevas" pueden ser recomendaciones viejas con otro id, y una propuesta
 * antigua puede condicionar artificialmente que se genera hoy.
 *
 * QUE HACE ESTE MODULO. Vacia el backlog OPERATIVO del contexto y deja
 * dicho, dentro del propio contexto, que se ha vaciado y por que. Lo que
 * NO hace es igual de importante:
 *
 *   - NO borra nada. El historico sigue entero en MongoDB, disponible
 *     para auditoria. Esto solo cambia lo que ve el agente HOY.
 *   - NO toca las decisiones humanas. Un rechazo con motivo es una
 *     restriccion permanente, no trabajo pendiente: si se aislara, el
 *     departamento volveria a proponer justo lo que una persona ya
 *     rechazo. Ese camino (`loadPreviousHumanFeedbackFromState`) es
 *     independiente de este modulo y se deja intacto a proposito.
 *   - NO oculta la actividad de los agentes de ESTA pasada
 *     (`agentActivity`, y los `specialistInputs` que anade la capa de
 *     coordinacion): eso no es historico, es el trabajo de hoy.
 *
 * Y sobre todo: no se vacia en silencio. Un contexto que llega con los
 * contadores a cero y sin explicacion es indistinguible de un fallo de
 * lectura, y el agente razonaria sobre "no hay nada" en vez de sobre "hoy
 * no miramos esto". El aviso explicito es la diferencia.
 */

export const FRESH_BACKLOG_NOTICE =
  "BACKLOG OPERATIVO VACIADO A PROPOSITO PARA ESTA PASADA. Los resumenes de acciones, work orders, change packs y solicitudes de aprobacion vienen a cero porque se han excluido deliberadamente, NO porque no exista historico ni porque haya fallado ninguna lectura. El historico se conserva integro para auditoria. Decide que merece hacerse AHORA a partir de los datos LIVE y de las salidas de los especialistas de esta misma pasada, no reciclando trabajo pendiente de pasadas anteriores. Si tu conclusion es que no hay ningun cambio suficientemente util o seguro ahora mismo, esa es una respuesta valida y correcta: no propongas trabajo para llenar el hueco.";

/** Refs del `evidenceCatalog` que provienen del backlog historico acumulado. */
export const HISTORIC_EVIDENCE_REFS = [
  "actions-live",
  "actions-top",
  "workorders-ready",
  "changepacks-ready",
  "approvals-pending",
  "jobs-latest-run",
] as const;

/**
 * Devuelve el contexto con el backlog operativo vaciado. PURA: no lee
 * ficheros, no borra nada, no toca MongoDB.
 */
export function withFreshOperationalBacklog<T extends GrowthDirectorV2Context>(context: T): T {
  return {
    ...context,
    actionsSummary: {
      totalActions: 0,
      liveActionCount: 0,
      byStatus: {},
      byPriority: {},
      topOpenActions: [],
    },
    workOrdersSummary: { total: 0, readyForReviewCount: 0, byCategory: {}, byBrand: {} },
    changePacksSummary: { total: 0, readyForReviewCount: 0, byType: {} },
    approvalRequestsSummary: { pendingCount: 0, byRiskLevel: {}, topPending: [] },
    // `jobsSummary` NO se vacia: no es trabajo pendiente, es la senal de
    // si los watchers han corrido. Un agente que no puede ver eso pierde
    // la capacidad de decir "este dato no se ha recogido hoy".
    evidenceCatalog: context.evidenceCatalog.filter(
      (item) => !(HISTORIC_EVIDENCE_REFS as readonly string[]).includes(item.ref)
    ),
    // El aviso va el PRIMERO de los warnings: es lo que explica por que
    // el resto del contexto viene a cero.
    warnings: [FRESH_BACKLOG_NOTICE, ...context.warnings],
  };
}

/** `true` si esta pasada debe arrancar con el backlog operativo vacio. */
export function isFreshBacklogRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DEPARTMENT_FRESH_BACKLOG ?? "").trim().toLowerCase() === "true";
}

/** Resumen legible de lo que se ha excluido, para el log de la pasada. */
export function describeFreshBacklogExclusion(before: GrowthDirectorV2Context): string[] {
  return [
    "Backlog operativo VACIADO para esta pasada (el historico se conserva intacto en MongoDB).",
    `  acciones vivas excluidas:        ${before.actionsSummary.liveActionCount} de ${before.actionsSummary.totalActions}`,
    `  work orders excluidas:           ${before.workOrdersSummary.total} (${before.workOrdersSummary.readyForReviewCount} listas para revision)`,
    `  change packs excluidos:          ${before.changePacksSummary.total} (${before.changePacksSummary.readyForReviewCount} listos para revision)`,
    `  aprobaciones pendientes excluidas: ${before.approvalRequestsSummary.pendingCount}`,
    `  entradas de evidencia historicas excluidas: ${before.evidenceCatalog.filter((i) => (HISTORIC_EVIDENCE_REFS as readonly string[]).includes(i.ref)).length}`,
    "  decisiones humanas previas: CONSERVADAS (son restricciones permanentes, no trabajo pendiente).",
  ];
}
