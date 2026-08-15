import { DEPARTMENT_CHANGE_CONTRACT_VERSION, DepartmentChangeRequest } from "../src/department/apply/change-types";
import { DepartmentChangeStatus } from "../src/department/apply/state-machine";
import { ChangeTransitionPort } from "../src/department/apply/staging-executor";
import { checkTransition } from "../src/department/apply/state-machine";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";

/**
 * Fixtures compartidas por las suites del apply del departamento. NO es
 * una suite: no exporta `run...Tests()`, asi que el runner no la ejecuta.
 */

export const RUN_ID = "dept-2026-08-15T120000Z";
export const NOW = new Date("2026-08-15T12:00:00.000Z");
export const STAGING_URL = "https://staging.zentrylockers.com/taquillas-melamina/";

export const OWNED_PAGES = [{ wordpressPageId: 2091, stagingUrl: STAGING_URL }];

export const SPEC: WebEngineerOutput = {
  implementationSummary: "Actualizar title y meta description de la pagina publicada de melamina en staging.",
  targetPages: [STAGING_URL],
  targetComponents: [],
  proposedChanges: [
    {
      description:
        "Reescribir metas de la familia melamina en page_id=2091.\nTITLE: Taquillas de melamina para vestuarios | Zentry\nMETA: Taquillas de melamina resistentes para vestuarios y colegios.",
      rationale: "239 impresiones con CTR 0%.",
      targetPageOrComponent: STAGING_URL,
    },
  ],
  filesOrSystemsAffected: ["WordPress staging"],
  acceptanceCriteria: ["La pagina sigue publicada en staging"],
  validationPlan: ["Releer la pagina"],
  rollbackPlan: ["Restaurar title/meta previos"],
  dependencies: [],
  risks: [],
  approvalRequired: true,
  unknowns: [],
};

export const NEW_TITLE = "Taquillas de melamina para vestuarios | Zentry";
export const NEW_META = "Taquillas de melamina resistentes para vestuarios y colegios.";

export const PROMOTION: DepartmentPromotionResult = {
  departmentRunId: RUN_ID,
  departmentQaStatus: "PASS",
  qaReviewStatus: "pass",
  globalBlockReason: null,
  promoted: [
    {
      rank: 1,
      title: "Reescribir metas de la familia melamina",
      rationale: "239 impresiones con CTR 0%.",
      impact: "medium",
      confidence: "high",
      effort: "low",
      dependsOn: [],
      evidenceRefs: ["dept-seo-1"],
      decision: "promoted",
      blockedBy: [],
      qaWarnings: [],
    },
  ],
  blocked: [],
  unattributedBlockingSignals: [],
  qaSummary: { criticalFindings: 0, warningFindings: 0, safetyConcerns: 0, contradictions: 0, unsupportedClaims: 0, requiredCorrections: 0 },
};

export function change(overrides: Partial<DepartmentChangeRequest> = {}): DepartmentChangeRequest {
  return {
    contractVersion: DEPARTMENT_CHANGE_CONTRACT_VERSION,
    changeId: `${RUN_ID}#change-1-v1`,
    departmentRunId: RUN_ID,
    recommendationId: `${RUN_ID}#rec-1`,
    recommendationRank: 1,
    version: 1,
    supersedesChangeId: null,
    title: "Reescribir metas de la familia melamina",
    why: "239 impresiones con CTR 0%.",
    sourceAgents: ["seo-specialist"],
    impact: "medium",
    confidence: "high",
    effort: "low",
    qaStatus: "PASS",
    capabilityId: "staging_published_meta_update",
    capabilityReason: "Cambio reversible de title/meta sobre pagina publicada de staging.",
    status: "proposed",
    staging: null,
    telegram: null,
    humanDecision: null,
    production: null,
    inheritedFeedback: [],
    auditTrail: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

export interface MemoryPort extends ChangeTransitionPort {
  /** Todas las instantaneas escritas, en orden -- el equivalente en memoria del log append-only. */
  snapshots: DepartmentChangeRequest[];
  /** Transiciones RECHAZADAS por la maquina de estados (deberian ser 0 en un flujo sano). */
  refused: { from: DepartmentChangeStatus; to: DepartmentChangeStatus; reason: string }[];
}

/**
 * Puerto en memoria con las MISMAS garantias que el real: comprueba cada
 * transicion contra la maquina de estados antes de "persistir". Si un
 * executor intentara un salto imposible, el test lo ve.
 */
export function memoryPort(now: Date = NOW): MemoryPort {
  const snapshots: DepartmentChangeRequest[] = [];
  const refused: { from: DepartmentChangeStatus; to: DepartmentChangeStatus; reason: string }[] = [];
  return {
    snapshots,
    refused,
    transition(current, nextStatus, updates, audit) {
      const check = checkTransition(current.status, nextStatus);
      if (!check.allowed) {
        refused.push({ from: current.status, to: nextStatus, reason: check.reason });
        return { ok: false, change: current, reason: check.reason };
      }
      const updated: DepartmentChangeRequest = {
        ...current,
        ...updates,
        status: nextStatus,
        auditTrail: [...current.auditTrail, { at: now.toISOString(), event: audit.event, detail: audit.detail }],
        updatedAt: now.toISOString(),
      };
      snapshots.push(updated);
      return { ok: true, change: updated, reason: check.reason };
    },
    note(current, updates, audit) {
      const updated: DepartmentChangeRequest = {
        ...current,
        ...updates,
        status: current.status,
        auditTrail: [...current.auditTrail, { at: now.toISOString(), event: audit.event, detail: audit.detail }],
        updatedAt: now.toISOString(),
      };
      snapshots.push(updated);
      return updated;
    },
  };
}

export interface FakeStagingPage {
  id: number;
  status: string;
  title: string;
  contentHtml: string;
  excerpt: string;
  link: string;
  slug: string;
}

export function stagingPage(overrides: Partial<FakeStagingPage> = {}): FakeStagingPage {
  return {
    id: 2091,
    status: "publish",
    title: "Titulo antiguo",
    contentHtml: "<p>Contenido de la pagina</p>",
    excerpt: "Meta antigua",
    link: STAGING_URL,
    slug: "taquillas-melamina",
    ...overrides,
  };
}
