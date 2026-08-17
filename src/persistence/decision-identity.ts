/**
 * Fase O56 — identidad de una decision humana.
 *
 * DOS PROBLEMAS REALES QUE ESTE FICHERO RESUELVE.
 *
 * 1. `decisionId` NO ES IDEMPOTENTE.
 *    `buildDecisionId()` (src/approvals/manual/decision-store.ts) genera
 *    `${departmentRunId}#decision-rec-${n}-${ISO}` — con el instante
 *    exacto dentro. Reejecutar la sesion de aprobacion produce un id
 *    DISTINTO para la MISMA decision, y por tanto una segunda linea. El
 *    comentario de ese modulo afirma lo contrario; el timestamp lo
 *    desmiente.
 *    Solucion: `buildDecisionKey()`, determinista sobre el CONTENIDO de
 *    la decision (pasada, recomendacion, accion, motivo literal,
 *    overrides, destino, autor) y sin ningun reloj dentro. Es el indice
 *    unico de la coleccion. El `decisionId` original se conserva tal
 *    cual, porque es la trazabilidad con el fichero historico.
 *
 * 2. `recommendationId` NO SE REPITE ENTRE PASADAS.
 *    Es `${departmentRunId}#rec-${rank}`, asi que la recomendacion "meter
 *    fotos en las landings de taquillas" se llama distinto cada dia.
 *    Consecuencia: al buscar el historial de una recomendacion por su id
 *    SIEMPRE sale vacio, la version del `changeId` se queda clavada en
 *    v1 y el linaje "esto es la segunda version de lo que rechazaste" no
 *    existe.
 *    Solucion: `buildSubjectKey()`, derivado del TITULO normalizado, que
 *    si es estable entre pasadas. Se guarda junto a la decision como
 *    campo indexado.
 *
 * IMPORTANTE — alcance: `subjectKey` se PERSISTE e INDEXA, pero en esta
 * fase ningun lector legacy cambia de comportamiento por su causa. Es el
 * habilitador de la continuidad entre pasadas, no un cambio de la logica
 * de prompts, que queda fuera del alcance de la migracion.
 */
import { createHash } from "crypto";

/**
 * Normaliza un titulo para poder reconocerlo entre pasadas: sin acentos,
 * en minusculas, sin puntuacion y con los espacios colapsados.
 *
 * No intenta ser semantico. Si el titulo cambia de verdad, el
 * `subjectKey` cambia — y eso es correcto: es otra propuesta.
 */
export function normalizeSubject(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clave estable del ASUNTO de una decision, para emparejar la decision de
 * ayer con la propuesta equivalente de hoy. Devuelve "" si el titulo no
 * aporta nada: preferimos no emparejar a emparejar mal.
 */
export function buildSubjectKey(recommendationTitle: string): string {
  const normalized = normalizeSubject(recommendationTitle ?? "");
  if (normalized.length === 0) return "";
  return `subject:${createHash("sha256").update(normalized, "utf-8").digest("hex").slice(0, 32)}`;
}

export interface DecisionKeyInput {
  departmentRunId: string;
  recommendationId: string;
  action: string;
  rejectionReason: string;
  target: string;
  decidedBy: string;
  overrides?: { title?: string; metaDescription?: string };
}

/**
 * Identidad determinista de una decision. MISMO contenido => MISMA clave,
 * ejecutes la sesion una vez o cinco.
 *
 * NO incluye ningun timestamp a proposito: ahi estaba el bug.
 * SI incluye el motivo literal: si el humano rechaza lo mismo por una
 * razon distinta, es una decision nueva y debe quedar registrada aparte.
 */
export function buildDecisionKey(input: DecisionKeyInput): string {
  const overrides = input.overrides ?? {};
  // JSON.stringify y no un `join(separador)`: cualquier separador que se
  // elija puede aparecer dentro del motivo literal escrito por el humano,
  // y entonces dos decisiones distintas producirian la misma clave. El
  // encoding JSON es inyectivo, asi que eso no puede pasar.
  const material = JSON.stringify([
    input.departmentRunId ?? "",
    input.recommendationId ?? "",
    input.action ?? "",
    (input.rejectionReason ?? "").trim(),
    input.target ?? "",
    input.decidedBy ?? "",
    overrides.title ?? "",
    overrides.metaDescription ?? "",
  ]);

  return `dk:${createHash("sha256").update(material, "utf-8").digest("hex")}`;
}
