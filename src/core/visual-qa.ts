import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Aprobacion visual humana (Fase O27.3). QA tecnico (staging-qa-agent /
 * checkLandingQuality) verifica ESTRUCTURA (hay CTA, hay bloques, no hay
 * placeholders...) pero no dice si la pagina "se ve bien" -- eso solo lo
 * puede decidir una persona mirandola. Pau detecto que el sistema
 * confundia "QA tecnico superado" con "lista para producción": los
 * borradores pasaban QA estructural pero visualmente parecian bocetos.
 *
 * Este registro separa las dos cosas: hasta que alguien llama a
 * markVisuallyApproved() para una pagina de staging concreta, esa pagina
 * NUNCA se considera production_candidate, por mucho que el QA tecnico
 * haya pasado. Es la pieza que faltaba para que Production Deployment
 * Planner deje de proponer planes de deploy sobre paginas que nadie ha
 * revisado visualmente todavia (ver el gate en production-deployment-planner.ts).
 *
 * Mismo patron append-only que staging-qa-results.jsonl -- una linea =
 * una instantanea, la mas reciente por wordpressPageId gana.
 */

export type VisualReviewState = "technical_draft" | "visual_review_needed" | "visually_approved" | "production_candidate";

export interface VisualQaApprovalSnapshot {
  wordpressPageId: number;
  approved: boolean;
  approvedBy: string;
  notes?: string;
  decidedAt: string;
}

const DATA_DIR = resolveActiveClientPaths().dataDir;
const APPROVALS_FILE = path.join(DATA_DIR, "visual-qa-approvals.jsonl");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readAllVisualQaApprovalSnapshots(): VisualQaApprovalSnapshot[] {
  if (!fs.existsSync(APPROVALS_FILE)) return [];
  const raw = fs.readFileSync(APPROVALS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as VisualQaApprovalSnapshot);
}

/** La instantanea mas reciente de CADA wordpressPageId. */
export function readCurrentVisualQaApprovals(): VisualQaApprovalSnapshot[] {
  const byId = new Map<number, VisualQaApprovalSnapshot>();
  for (const snapshot of readAllVisualQaApprovalSnapshots()) {
    byId.set(snapshot.wordpressPageId, snapshot);
  }
  return [...byId.values()];
}

export function findVisualQaApproval(wordpressPageId: number, current?: VisualQaApprovalSnapshot[]): VisualQaApprovalSnapshot | undefined {
  return (current ?? readCurrentVisualQaApprovals()).find((a) => a.wordpressPageId === wordpressPageId);
}

export function isVisuallyApproved(wordpressPageId: number, current?: VisualQaApprovalSnapshot[]): boolean {
  const snapshot = findVisualQaApproval(wordpressPageId, current);
  return snapshot?.approved === true;
}

export function markVisuallyApproved(wordpressPageId: number, approvedBy: string, notes?: string): VisualQaApprovalSnapshot {
  return recordVisualQaDecision(wordpressPageId, true, approvedBy, notes);
}

export function markVisualReviewRejected(wordpressPageId: number, approvedBy: string, notes?: string): VisualQaApprovalSnapshot {
  return recordVisualQaDecision(wordpressPageId, false, approvedBy, notes);
}

function recordVisualQaDecision(wordpressPageId: number, approved: boolean, approvedBy: string, notes?: string): VisualQaApprovalSnapshot {
  ensureDataDir();
  const snapshot: VisualQaApprovalSnapshot = { wordpressPageId, approved, approvedBy, notes, decidedAt: new Date().toISOString() };
  fs.appendFileSync(APPROVALS_FILE, JSON.stringify(snapshot) + "\n", "utf-8");
  return snapshot;
}

/**
 * Deriva el estado visual de una pagina de staging concreta. Regla
 * central pedida por Pau: "QA tecnico superado" NO es lo mismo que
 * "lista para producción" -- por eso production_candidate exige AMBAS
 * cosas, nunca solo el QA tecnico.
 *
 *  - technical_draft: el QA tecnico estructural todavia no paso (o
 *    fallo). Ni siquiera esta lista para que un humano la revise.
 *  - visual_review_needed: QA tecnico paso, pero NADIE ha confirmado
 *    visualmente que la pagina esta bien -- estado por defecto de
 *    cualquier borrador nuevo, nunca se salta automaticamente.
 *  - visually_approved: una persona ya confirmo que visualmente esta
 *    bien (via markVisuallyApproved).
 *  - production_candidate: visualmente aprobada Y con QA tecnico en
 *    orden -- unico estado en el que tiene sentido pedirle a Pau que
 *    apruebe un plan de despliegue a producción. En la practica
 *    coincide con visually_approved (aprobar visualmente ya implica
 *    "puede proponerse"), pero se mantiene como estado propio por si en
 *    el futuro se separa "aprobado visualmente" de "listo para
 *    proponerse ya".
 */
export function deriveVisualReviewState(
  wordpressPageId: number | undefined,
  technicalQaPass: boolean | undefined,
  current?: VisualQaApprovalSnapshot[]
): VisualReviewState {
  if (!technicalQaPass) return "technical_draft";
  if (!wordpressPageId) return "visual_review_needed";
  const approved = isVisuallyApproved(wordpressPageId, current);
  return approved ? "production_candidate" : "visual_review_needed";
}

export const VISUAL_REVIEW_STATE_LABELS: Record<VisualReviewState, string> = {
  technical_draft: "Borrador tecnico (QA estructural pendiente o fallido)",
  visual_review_needed: "Pendiente de revision visual humana",
  visually_approved: "Aprobada visualmente",
  production_candidate: "Candidata a producción (QA tecnico + visual OK)",
};

export function getVisualQaApprovalsFilePath(): string {
  return APPROVALS_FILE;
}
