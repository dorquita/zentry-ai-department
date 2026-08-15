import * as fs from "fs";
import * as path from "path";
import { readAllEvents, readEventsForRun } from "../../core/department-events";
import { readAllJobs } from "../../core/job-registry";
import { readCurrentActions } from "../../core/action-backlog";
import { readCurrentWorkOrders, categorizeActionType } from "../../core/work-orders";
import { readCurrentChangePacks } from "../../core/change-packs";
import { readCurrentApprovalRequests } from "../../core/approval-requests";
import { AutonomyRiskLevel } from "../../core/autonomy-policy";
import { DepartmentEvent, Priority } from "../../core/types";

/**
 * Context builder para el empleado Claude `growth-director-v2` (ver
 * docs/claude-employee-runtime.md, `.claude/agents/growth-director-v2.md`).
 *
 * Separacion CLAUDE / TOOLS explicita, mismo principio que
 * `src/core/landing-architect-v2-context.ts`: esta funcion es la parte
 * TOOL (deterministica, sin LLM) -- REUTILIZA las mismas funciones
 * lectoras que ya usa el agente v1 determinista
 * (`src/agents/growth-director.ts`): `readAllEvents`/`readEventsForRun`,
 * `readAllJobs`, `readCurrentActions`, `readCurrentWorkOrders`,
 * `readCurrentChangePacks`, `readCurrentApprovalRequests`. Nunca
 * re-deriva cifras de SEO/SEM/Analytics desde cero -- solo agrega
 * (conteos, agrupaciones, top-N) lo que esos registros YA tienen
 * persistido. Deliberadamente NO decide prioridades ni redacta ninguna
 * sintesis -- eso es lo que hace el subagente Claude, que recibe este
 * objeto ya resuelto dentro de su prompt y nunca accede el repositorio
 * por su cuenta (tools: [] en `.claude/agents/growth-director-v2.md`).
 */

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");
const AGENTS_DIR = path.join(PROJECT_ROOT, ".claude", "agents");

/**
 * Los otros 6 empleados Claude nuevos que se estan construyendo EN
 * PARALELO, cada uno en su propio worktree/PR (ver
 * docs/claude-employee-runtime.md, seccion "Desarrollo paralelo
 * mediante worktrees"). Este empleado NUNCA asume que ya estan
 * corriendo -- solo comprueba, de forma deterministica, si su
 * definicion de agente ya existe en ESTE checkout concreto
 * (`.claude/agents/<nombre>.md`). Si no existe, se declara como
 * dependencia ausente (ver `knownDependencies` mas abajo) en vez de
 * inventar senales que ese empleado produciria.
 */
export const SIBLING_CLAUDE_EMPLOYEES = [
  "seo-specialist",
  "content-strategist",
  "sem-specialist",
  "analytics-specialist",
  "qa-reviewer",
  "web-engineer",
] as const;

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const APPROVAL_RISK_RANK: Record<AutonomyRiskLevel, number> = { critical: 5, high: 4, medium: 3, low_medium: 2, none: 1 };

// Mismos estados "vivos" que usa growth-director v1 (src/agents/growth-director.ts,
// LIVE_ACTION_STATUSES) -- recreado aqui deliberadamente (constante
// trivial, no logica de negocio derivada) porque v1 no la exporta.
const LIVE_ACTION_STATUSES = new Set(["new", "open", "auto_approved_for_planning", "waiting_approval", "approved"]);

export interface AgentActivitySummary {
  agent: string;
  status: "completado" | "iniciado_sin_finalizar" | "sin_agent_started_finished";
  warningCount: number;
  lastSummary: string;
}

export interface DependencySignal {
  name: string;
  status: "available" | "missing";
  note: string;
}

export interface EvidenceCatalogItem {
  ref: string;
  description: string;
}

export interface OpenActionSummary {
  actionId: string;
  title: string;
  priority: Priority;
  status: string;
  keyword: string;
  page?: string;
  targetBrand: string;
  brandIntent: string;
}

export interface PendingApprovalSummary {
  title: string;
  riskLevel: string;
  relatedType: string;
}

export interface GrowthDirectorV2Context {
  departmentRunId: string | null;
  hasDepartmentRunData: boolean;
  generatedAt: string;
  agentActivity: AgentActivitySummary[];
  warnings: string[];
  actionsSummary: {
    totalActions: number;
    liveActionCount: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    topOpenActions: OpenActionSummary[];
  };
  workOrdersSummary: {
    total: number;
    readyForReviewCount: number;
    byCategory: Record<string, number>;
    byBrand: Record<string, number>;
  };
  changePacksSummary: {
    total: number;
    readyForReviewCount: number;
    byType: Record<string, number>;
  };
  approvalRequestsSummary: {
    pendingCount: number;
    byRiskLevel: Record<string, number>;
    topPending: PendingApprovalSummary[];
  };
  jobsSummary: {
    totalJobSnapshots: number;
    latestRunId: string | null;
    latestRunJobCount: number;
  };
  knownDependencies: DependencySignal[];
  evidenceCatalog: EvidenceCatalogItem[];
}

function findLatestDepartmentRunId(events: DepartmentEvent[]): string | null {
  if (events.length === 0) return null;
  return events.reduce((max, e) => (e.departmentRunId > max ? e.departmentRunId : max), events[0].departmentRunId);
}

function findAgentFinishedPayload(events: DepartmentEvent[], agent: string): Record<string, unknown> | undefined {
  const matches = events.filter((e) => e.agent === agent && e.type === "agent_finished");
  return matches.length > 0 ? matches[matches.length - 1].payload : undefined;
}

function summarizeAgentActivity(events: DepartmentEvent[]): AgentActivitySummary[] {
  const agents = [...new Set(events.map((e) => e.agent))];
  return agents.map((agent) => {
    const agentEvents = events.filter((e) => e.agent === agent);
    const started = agentEvents.some((e) => e.type === "agent_started");
    const finished = agentEvents.find((e) => e.type === "agent_finished");
    const warningCount = agentEvents.filter((e) => e.type === "warning_detected").length;
    const status: AgentActivitySummary["status"] = finished ? "completado" : started ? "iniciado_sin_finalizar" : "sin_agent_started_finished";
    const lastSummary = finished ? finished.summary : agentEvents[agentEvents.length - 1]?.summary ?? "";
    return { agent, status, warningCount, lastSummary };
  });
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function agentDefinitionExists(agentName: string): boolean {
  return fs.existsSync(path.join(AGENTS_DIR, `${agentName}.md`));
}

// Mismo patron que action-backlog.ts (buildCanonicalKey/normalize): rango
// de codigo explicito via fromCharCode en vez de un literal Unicode en el
// propio fichero fuente, para evitar cualquier ambiguedad de encoding.
const DIACRITICS_RE = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

function slugifyRef(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Construye el contexto completo. `departmentRunId` es opcional -- si no
 * se pasa, se resuelve el mas reciente disponible en
 * `data/department-events.jsonl` (o `null` si el fichero esta vacio o
 * no existe: a diferencia de `runGrowthDirector()` (v1), este contexto
 * NUNCA lanza por falta de eventos -- la mision explicita de este
 * empleado es "seguir funcionando con el contexto que realmente tenga
 * disponible" incluso cuando NINGUN otro agente ha corrido todavia).
 */
export function buildGrowthDirectorV2Context(departmentRunId?: string): GrowthDirectorV2Context {
  const allEvents = readAllEvents();
  const resolvedRunId = departmentRunId ?? findLatestDepartmentRunId(allEvents);
  const events = resolvedRunId ? readEventsForRun(resolvedRunId) : [];
  // Deliberadamente basado en eventos REALES encontrados (no solo en si
  // se resolvio un id): un --departmentRunId explicito que no coincide
  // con ningun evento real (p.ej. typo, o una pasada que todavia no
  // existe) debe seguir contando como "sin datos de departamento", no
  // como "si hay datos" solo porque se paso un string no vacio.
  const hasDepartmentRunData = events.length > 0;
  const agentActivity = summarizeAgentActivity(events);
  const warnings = events.filter((e) => e.type === "warning_detected").map((e) => `[${e.agent}] ${e.summary}`);

  const allActions = readCurrentActions();
  const liveActions = allActions.filter((a) => LIVE_ACTION_STATUSES.has(a.status));
  const byStatus = countBy(allActions, (a) => a.status);
  const byPriority = countBy(liveActions, (a) => a.priority);
  const topOpenActions: OpenActionSummary[] = [...liveActions]
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    .slice(0, 8)
    .map((a) => ({
      actionId: a.actionId,
      title: a.title,
      priority: a.priority,
      status: a.status,
      keyword: a.keyword,
      page: a.page,
      targetBrand: a.targetBrand,
      brandIntent: a.brandIntent,
    }));

  const allWorkOrders = readCurrentWorkOrders();
  const readyForReviewWorkOrders = allWorkOrders.filter((w) => w.status === "ready_for_review" || w.status === "auto_prepared");
  const workOrdersByCategory = countBy(allWorkOrders, (w) => categorizeActionType(w.actionType));
  const workOrdersByBrand = countBy(allWorkOrders, (w) => w.targetBrand);

  const allChangePacks = readCurrentChangePacks();
  const readyForReviewChangePacks = allChangePacks.filter((cp) => cp.status === "ready_for_review");
  const changePacksByType = countBy(allChangePacks, (cp) => cp.changeType);

  const allApprovalRequests = readCurrentApprovalRequests();
  const pendingApprovalRequests = allApprovalRequests.filter((r) => r.status === "pending");
  const approvalsByRiskLevel = countBy(pendingApprovalRequests, (r) => r.riskLevel);
  // Ordenado por riesgo antes de truncar a 8, mismo motivo que
  // topOpenActions (ordenado por prioridad) unas lineas mas arriba:
  // readCurrentApprovalRequests() devuelve orden de fichero (insercion),
  // no de riesgo -- sin este sort, una solicitud "critical" que aparezca
  // despues de 8 solicitudes de menor riesgo en data/approval-requests.jsonl
  // se perderia en silencio de topPending, aunque el propio campo se
  // llame "top".
  const topPendingApprovals: PendingApprovalSummary[] = [...pendingApprovalRequests]
    .sort((a, b) => APPROVAL_RISK_RANK[b.riskLevel] - APPROVAL_RISK_RANK[a.riskLevel])
    .slice(0, 8)
    .map((r) => ({ title: r.title, riskLevel: r.riskLevel, relatedType: r.relatedType }));

  const allJobs = readAllJobs();
  const latestRunId = allJobs.reduce<string | undefined>((max, j) => (!max || j.meta.runId > max ? j.meta.runId : max), undefined);
  const latestRunJobCount = latestRunId ? allJobs.filter((j) => j.meta.runId === latestRunId).length : 0;

  const semPayload = findAgentFinishedPayload(events, "sem-watcher");
  const analyticsPayload = findAgentFinishedPayload(events, "analytics-watcher");

  const knownDependencies: DependencySignal[] = [];
  for (const name of SIBLING_CLAUDE_EMPLOYEES) {
    const exists = agentDefinitionExists(name);
    knownDependencies.push({
      name,
      status: exists ? "available" : "missing",
      note: exists
        ? `.claude/agents/${name}.md existe en este checkout -- puede que ya produzca artifacts propios (no verificado aqui mas alla de la existencia de la definicion del agente).`
        : `.claude/agents/${name}.md todavia no existe en este checkout -- este empleado Claude sigue construyendose en su propio worktree/PR en paralelo. No hay senales propias suyas disponibles.`,
    });
  }
  const semConnected = semPayload?.connected === true;
  knownDependencies.push({
    name: "sem-watcher (V1 deterministico)",
    status: semConnected ? "available" : "missing",
    note: semPayload
      ? `Ultimo agent_finished de sem-watcher en este departmentRunId: connected=${String(semPayload.connected ?? false)}.`
      : "Sin evento agent_finished de sem-watcher en este departmentRunId -- no hay estado SEM reciente disponible.",
  });
  const analyticsConnected = analyticsPayload?.ga4Connected === true || analyticsPayload?.gtmConnected === true;
  knownDependencies.push({
    name: "analytics-watcher (V1 deterministico)",
    status: analyticsConnected ? "available" : "missing",
    note: analyticsPayload
      ? `Ultimo agent_finished de analytics-watcher en este departmentRunId: ga4Connected=${String(analyticsPayload.ga4Connected ?? false)}, gtmConnected=${String(analyticsPayload.gtmConnected ?? false)}.`
      : "Sin evento agent_finished de analytics-watcher en este departmentRunId -- no hay estado de Analytics reciente disponible.",
  });

  const evidenceCatalog: EvidenceCatalogItem[] = [];
  evidenceCatalog.push({
    ref: "department-run",
    description: resolvedRunId
      ? `departmentRunId mas reciente: "${resolvedRunId}" (${events.length} evento(s) registrados en data/department-events.jsonl para esta pasada).`
      : "No hay ningun departmentRunId disponible (data/department-events.jsonl vacio o inexistente) -- este contexto no tiene ninguna pasada de departamento sobre la que apoyarse.",
  });
  evidenceCatalog.push({
    ref: "agent-activity",
    description: `Actividad de agentes en esta pasada: ${agentActivity.length} agente(s) con eventos (${
      agentActivity.filter((a) => a.status === "completado").length
    } completados). Detalle completo en agentActivity[] del contexto.`,
  });
  if (warnings.length > 0) {
    evidenceCatalog.push({
      ref: "department-warnings",
      description: `${warnings.length} warning(s) emitidos por agentes del departamento en esta pasada. Ver warnings[] del contexto.`,
    });
  }
  evidenceCatalog.push({
    ref: "actions-live",
    description: `${liveActions.length} accion(es) vivas en el backlog (por prioridad: ${
      Object.entries(byPriority)
        .map(([p, c]) => `${p}=${c}`)
        .join(", ") || "ninguna"
    }). Total historico (todos los estados): ${allActions.length}. Por estado: ${
      Object.entries(byStatus)
        .map(([s, c]) => `${s}=${c}`)
        .join(", ") || "ninguno"
    }.`,
  });
  if (topOpenActions.length > 0) {
    evidenceCatalog.push({
      ref: "actions-top",
      description: `Top ${topOpenActions.length} acciones vivas por prioridad: ${topOpenActions.map((a) => `"${a.title}" (${a.priority}, ${a.status})`).join("; ")}.`,
    });
  }
  evidenceCatalog.push({
    ref: "workorders-ready",
    description: `${readyForReviewWorkOrders.length} work order(s) listas para revisar de ${allWorkOrders.length} totales. Por categoria: ${
      Object.entries(workOrdersByCategory)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "ninguna"
    }. Por marca: ${
      Object.entries(workOrdersByBrand)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "ninguna"
    }.`,
  });
  evidenceCatalog.push({
    ref: "changepacks-ready",
    description: `${readyForReviewChangePacks.length} change pack(s) listos para revisar de ${allChangePacks.length} totales. Por tipo: ${
      Object.entries(changePacksByType)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "ninguno"
    }.`,
  });
  evidenceCatalog.push({
    ref: "approvals-pending",
    description: `${pendingApprovalRequests.length} solicitud(es) de aprobacion pendientes. Por riesgo: ${
      Object.entries(approvalsByRiskLevel)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "ninguna"
    }.`,
  });
  evidenceCatalog.push({
    ref: "jobs-latest-run",
    description: latestRunId
      ? `Ultima ejecucion de SEO Watcher (runId "${latestRunId}"): ${latestRunJobCount} job(s) propuestos. Total historico en data/jobs.jsonl: ${allJobs.length}.`
      : `Sin ninguna ejecucion de SEO Watcher registrada en data/jobs.jsonl (total historico: ${allJobs.length}).`,
  });
  for (const dep of knownDependencies) {
    evidenceCatalog.push({ ref: `dependency-${slugifyRef(dep.name)}`, description: `${dep.name}: ${dep.status}. ${dep.note}` });
  }

  return {
    departmentRunId: resolvedRunId,
    hasDepartmentRunData,
    generatedAt: new Date().toISOString(),
    agentActivity,
    warnings,
    actionsSummary: {
      totalActions: allActions.length,
      liveActionCount: liveActions.length,
      byStatus,
      byPriority,
      topOpenActions,
    },
    workOrdersSummary: {
      total: allWorkOrders.length,
      readyForReviewCount: readyForReviewWorkOrders.length,
      byCategory: workOrdersByCategory,
      byBrand: workOrdersByBrand,
    },
    changePacksSummary: {
      total: allChangePacks.length,
      readyForReviewCount: readyForReviewChangePacks.length,
      byType: changePacksByType,
    },
    approvalRequestsSummary: {
      pendingCount: pendingApprovalRequests.length,
      byRiskLevel: approvalsByRiskLevel,
      topPending: topPendingApprovals,
    },
    jobsSummary: {
      totalJobSnapshots: allJobs.length,
      latestRunId: latestRunId ?? null,
      latestRunJobCount,
    },
    knownDependencies,
    evidenceCatalog,
  };
}
