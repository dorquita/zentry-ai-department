import * as dotenv from "dotenv";
dotenv.config();
import { markVisuallyApproved, markVisualReviewRejected } from "../src/core/visual-qa";

/**
 * Fase O27.3 -- registra la decision VISUAL de una persona sobre un
 * borrador de staging concreto. Este es el unico mecanismo que puede
 * mover una pagina a `production_candidate` -- nada en el pipeline
 * automatico llama a esto solo.
 *
 * Uso:
 *   npx ts-node scripts/mark-visual-qa.ts approve <wordpressPageId> "<notas opcionales>"
 *   npx ts-node scripts/mark-visual-qa.ts reject  <wordpressPageId> "<notas opcionales>"
 */

const [, , action, pageIdRaw, ...noteParts] = process.argv;
const notes = noteParts.join(" ") || undefined;
const pageId = Number(pageIdRaw);

if (!action || !["approve", "reject"].includes(action) || !Number.isFinite(pageId)) {
  console.error('Uso: npx ts-node scripts/mark-visual-qa.ts approve|reject <wordpressPageId> "<notas opcionales>"');
  process.exit(1);
}

const approvedBy = process.env.VISUAL_QA_APPROVER ?? "pau";

if (action === "approve") {
  const snapshot = markVisuallyApproved(pageId, approvedBy, notes);
  console.log(`Pagina ${pageId} marcada como APROBADA VISUALMENTE por "${approvedBy}".`, snapshot);
} else {
  const snapshot = markVisualReviewRejected(pageId, approvedBy, notes);
  console.log(`Pagina ${pageId} marcada como RECHAZADA en revision visual por "${approvedBy}".`, snapshot);
}
