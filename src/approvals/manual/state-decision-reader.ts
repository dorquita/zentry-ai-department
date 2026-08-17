/**
 * Fase O57 — LECTOR AUTORITATIVO de decisiones humanas.
 *
 * Este modulo es el que cierra de verdad el bucle de feedback humano.
 * El lector antiguo (`decision-store.ts`) lee un `.jsonl` y ademas se
 * limita a los RECHAZOS CON MOTIVO. Eso deja fuera dos cosas que si son
 * decisiones humanas:
 *
 *   - las APROBACIONES: "esto ya se aprobo" evita que la pasada
 *     siguiente vuelva a proponer lo mismo como si fuera nuevo;
 *   - los APLAZAMIENTOS: "ahora no" tambien es una respuesta.
 *
 * De las 7 decisiones reales que hay hoy en el historico, 6 son
 * aprobaciones y 1 es un rechazo. El lector antiguo devolvia UNA sola
 * entrada -- el rechazo. Las otras 6 estaban guardadas y nadie las leia.
 * Medido, no estimado: `loadPreviousHumanFeedback()` = 1 entrada,
 * `readPreviousHumanFeedbackFrom()` = 7.
 *
 * SIN DOBLE AUTORIDAD. No hay `try MongoDB / catch fichero`. En modo
 * `mongo` se lee de MongoDB y, si MongoDB no responde, esto LANZA y la
 * pasada se para. Un fallback silencioso a fichero seria exactamente el
 * bug que esta fase elimina: el sistema seguiria corriendo, pero sobre
 * un estado de procedencia desconocida y sin que nadie se entere.
 */
import { HumanFeedbackEntry } from "../store";
import {
  PreviousHumanAction,
  PreviousHumanFeedback,
  selectPreviousHumanFeedbackByRecommendation,
} from "../human-feedback-context";
import { loadPreviousHumanFeedback } from "./decision-store";
import { DepartmentStateRepository, HumanDecisionDocument } from "../../persistence/repositories";
import {
  PersistenceMode,
  openPersistenceSession,
  resolvePersistenceMode,
} from "../../persistence/runtime";

/** Entrada de feedback enriquecida con lo que solo MongoDB conoce. */
export type StateHumanFeedbackEntry = HumanFeedbackEntry & Partial<PreviousHumanFeedback>;

function normalizeAction(action: string): PreviousHumanAction {
  if (action === "approve" || action === "reject" || action === "defer") return action;
  // Una accion desconocida se trata como rechazo: es la lectura
  // conservadora. Nunca se convierte en "aprobado" algo que no lo dice.
  return "reject";
}

/**
 * Convierte los documentos de MongoDB al formato que ya consumen los
 * constructores de prompt.
 *
 * Funcion PURA: sin I/O, sin reloj, sin red. Toda la logica que importa
 * (que entra, en que orden, con que version) es testeable sin cluster.
 *
 * `version` sale del orden cronologico DENTRO de cada recomendacion
 * (1 = la primera decision sobre ella), que es lo que una persona
 * entiende por "la version anterior".
 */
export function toStateHumanFeedback(decisions: HumanDecisionDocument[]): StateHumanFeedbackEntry[] {
  const chronological = [...decisions].sort((a, b) =>
    a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : a.decisionKey < b.decisionKey ? -1 : 1
  );

  const byRecommendation = new Map<string, StateHumanFeedbackEntry[]>();
  for (const decision of chronological) {
    const existing = byRecommendation.get(decision.recommendationId) ?? [];
    existing.push({
      approvalId: decision.changeId ?? decision.recommendationId,
      recommendationId: decision.recommendationId,
      recommendationTitle: decision.recommendationTitle,
      version: existing.length + 1,
      rejectionReason: decision.rejectionReason ?? "",
      rejectedAt: decision.decidedAt,
      action: normalizeAction(decision.action),
      ...(decision.subjectKey ? { subjectKey: decision.subjectKey } : {}),
      ...(decision.departmentRunId ? { departmentRunId: decision.departmentRunId } : {}),
      ...(decision.decidedBy ? { decidedBy: decision.decidedBy } : {}),
      ...(decision.target ? { target: decision.target } : {}),
    });
    byRecommendation.set(decision.recommendationId, existing);
  }
  return [...byRecommendation.values()].flat();
}

/**
 * Feedback humano a partir de un repositorio YA ABIERTO.
 *
 * Una sola consulta a `human_decisions` (indexada), no un replay de los
 * 16.000 eventos del historico: el estado actual de las decisiones vive
 * en su propia coleccion y eso es justo lo que hay que leer. Cero N+1 —
 * no se consulta nada por recomendacion.
 */
export async function readPreviousHumanFeedbackFrom(
  repository: DepartmentStateRepository
): Promise<PreviousHumanFeedback[]> {
  const decisions = await repository.decisions.listAll();
  return selectPreviousHumanFeedbackByRecommendation(toStateHumanFeedback(decisions));
}

export interface StateFeedbackOptions {
  env?: NodeJS.ProcessEnv;
  /** Fuerza el modo, para tests. Por defecto sale del entorno. */
  mode?: PersistenceMode;
  /**
   * Repositorio ya abierto. Cuando se pasa, NO se abre ni se cierra
   * ninguna sesion: lo gestiona quien llama. Es la costura que permite
   * ejercitar este lector contra el doble en memoria.
   */
  repository?: DepartmentStateRepository;
}

/**
 * Feedback humano anterior, leido de donde mande el modo de persistencia.
 *
 *   modo `mongo`            -> MongoDB, con las tres acciones. Fail-closed.
 *   modo `shadow`/`legacy`  -> el lector de fichero de siempre, intacto.
 *
 * Que el camino legacy no cambie es deliberado: mientras MongoDB no sea
 * la fuente de verdad, cambiar lo que leen los prompts seria cambiar el
 * comportamiento del sistema sin haber demostrado nada todavia.
 *
 * Consulta el ESTADO ACTUAL de las decisiones (una lectura de
 * `human_decisions`), no reproduce 16.000 eventos. Son 7 documentos hoy
 * y crecen con el numero de decisiones humanas, no con el historico.
 */
export async function loadPreviousHumanFeedbackFromState(
  options: StateFeedbackOptions = {}
): Promise<PreviousHumanFeedback[]> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? resolvePersistenceMode(env);

  if (mode !== "mongo") return loadPreviousHumanFeedback();

  if (options.repository) return readPreviousHumanFeedbackFrom(options.repository);

  // En modo `mongo` esto lanza si no hay configuracion o no conecta.
  const session = await openPersistenceSession({ env, mode });
  if (!session.repository) {
    throw new Error(
      "MongoDB es la fuente de verdad y no hay repositorio para leer las decisiones humanas. " +
        "No se continua con el fichero: un prompt construido sin las decisiones anteriores " +
        "propondria de nuevo lo que una persona ya decidio."
    );
  }
  try {
    return await readPreviousHumanFeedbackFrom(session.repository);
  } finally {
    await session.repository.close();
  }
}
