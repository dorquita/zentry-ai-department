import { HumanFeedbackEntry } from "./store";

/**
 * FEEDBACK HUMANO como contexto para las siguientes pasadas.
 *
 * Cuando Pau rechaza una propuesta y escribe el motivo, ese motivo se
 * persiste. Este modulo lo convierte en un bloque de contexto que los
 * empleados reciben en su prompt.
 *
 * Tres reglas, y las tres importan:
 *
 * 1. NO hay entrenamiento. Nada aprende de esto automaticamente. Es
 *    simplemente evidencia de una decision humana anterior, igual que
 *    cualquier otra evidencia del sistema.
 * 2. NO se reinterpreta. El motivo viaja LITERAL, entre comillas. No se
 *    resume, no se parafrasea, no se "traduce" a una regla. Si Pau
 *    escribio "el H1 es demasiado generico", eso es lo que lee el
 *    empleado -- no una version inventada como "preferir H1
 *    especificos".
 * 3. NO se convierte en una orden. Se presenta como lo que es: una
 *    decision humana sobre una version concreta, con su fecha. El
 *    empleado decide que hacer con esa informacion.
 *
 * Modulo PURO: sin I/O. Quien lee el datastore es otro.
 */

/** Maximo de motivos por recomendacion que entran en el prompt: lo reciente manda, y un prompt no es un archivo historico. */
export const MAX_FEEDBACK_ENTRIES_PER_RECOMMENDATION = 5;

export interface PreviousHumanFeedback {
  recommendationId: string;
  recommendationTitle: string;
  version: number;
  /** Literal, tal cual lo escribio la persona. Nunca reescrito. */
  rejectionReason: string;
  rejectedAt: string;
}

/**
 * Ordena por version descendente (lo mas reciente primero) y recorta.
 * Descarta entradas sin motivo real: un rechazo sin texto no aporta
 * nada y ocuparia sitio en el prompt.
 */
export function selectPreviousHumanFeedback(entries: HumanFeedbackEntry[]): PreviousHumanFeedback[] {
  return entries
    .filter((entry) => typeof entry.rejectionReason === "string" && entry.rejectionReason.trim().length > 0)
    .sort((a, b) => b.version - a.version)
    .slice(0, MAX_FEEDBACK_ENTRIES_PER_RECOMMENDATION)
    .map((entry) => ({
      recommendationId: entry.recommendationId,
      recommendationTitle: entry.recommendationTitle,
      version: entry.version,
      rejectionReason: entry.rejectionReason.trim(),
      rejectedAt: entry.rejectedAt,
    }));
}

/**
 * Igual que `selectPreviousHumanFeedback`, pero sobre el feedback de
 * VARIAS recomendaciones a la vez (lo que hace falta para el prompt de
 * una pasada del departamento, que no habla de una sola recomendacion).
 *
 * El recorte de `MAX_FEEDBACK_ENTRIES_PER_RECOMMENDATION` se aplica POR
 * RECOMENDACION, no al total: si una recomendacion se rechazo 6 veces,
 * eso no puede dejar sin voz a las otras cinco. El orden de salida es
 * determinista (recomendacion alfabetica, y dentro de cada una lo mas
 * reciente primero) para que dos ejecuciones con los mismos datos
 * produzcan exactamente el mismo prompt.
 */
export function selectPreviousHumanFeedbackByRecommendation(entries: HumanFeedbackEntry[]): PreviousHumanFeedback[] {
  const byRecommendation = new Map<string, HumanFeedbackEntry[]>();
  for (const entry of entries) {
    const existing = byRecommendation.get(entry.recommendationId) ?? [];
    existing.push(entry);
    byRecommendation.set(entry.recommendationId, existing);
  }
  return [...byRecommendation.keys()].sort().flatMap((recommendationId) => selectPreviousHumanFeedback(byRecommendation.get(recommendationId) ?? []));
}

/**
 * Bloque de texto para el prompt. Devuelve cadena vacia si no hay
 * feedback: nunca se mete en el prompt una seccion que diga "no hay
 * nada", porque eso solo gasta contexto.
 */
export function renderPreviousHumanFeedback(feedback: PreviousHumanFeedback[]): string {
  if (feedback.length === 0) return "";
  const lines: string[] = [
    "## DECISIONES HUMANAS ANTERIORES SOBRE ESTAS MISMAS PROPUESTAS",
    "",
    "Estas propuestas ya se plantearon antes y una persona las RECHAZO, indicando por que.",
    "El motivo aparece LITERAL, entre comillas, tal como se escribio: no lo reinterpretes,",
    "no lo generalices a una regla y no asumas nada que no diga el texto.",
    "Trata cada uno como evidencia de una preferencia humana ya expresada.",
    "",
  ];
  for (const entry of feedback) {
    lines.push(`- "${entry.recommendationTitle}" (version ${entry.version}, rechazada el ${entry.rejectedAt}):`);
    lines.push(`  Motivo textual: "${entry.rejectionReason}"`);
  }
  lines.push("");
  return lines.join("\n");
}
