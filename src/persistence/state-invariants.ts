/**
 * Fase O56 — el guard NUEVO, basado en invariantes de MongoDB.
 *
 * EN QUE SE DIFERENCIA DEL GUARD ANTIGUO Y POR QUE HACIA FALTA OTRO:
 *
 * El guard legacy (`src/core/state-persistence.ts`) mide el CRECIMIENTO
 * FISICO de los ficheros: si un `.jsonl` tiene menos lineas o un fichero
 * pesa menos bytes, falla. Eso funciono mientras el estado ERA el
 * fichero, pero tiene dos defectos que ya se han manifestado:
 *
 *   1. Cuenta lineas, no entidades. Diez snapshots de la misma accion
 *      cuentan diez, y el guard queda satisfecho aunque no haya avanzado
 *      nada real.
 *   2. Mete `reports/` en el mismo saco. Un informe diario que se
 *      regenera mas corto es un `bytes_lost`, y hoy eso tira TODO el
 *      estado nuevo y legitimo de la pasada.
 *
 * Este guard comprueba lo que de verdad importa: que ninguna ENTIDAD
 * autoritativa desaparezca, que ninguna DECISION HUMANA desaparezca, que
 * el historico no encoja y que la pasada quede cerrada. Es indiferente al
 * tamaño de cualquier fichero.
 */
import { ENTITY_REGISTRY, migratableDescriptors } from "./entity-registry";
import { DepartmentStateRepository } from "./repositories";

export interface MongoStateSnapshot {
  capturedAt: string;
  /** Numero de entidades vivas por `kind`. */
  entitiesByKind: Record<string, number>;
  /** Numero de eventos historicos por `kind`. */
  eventsByKind: Record<string, number>;
  humanDecisions: number;
  runs: number;
  /** Claves de todas las decisiones humanas: permite decir CUAL falta, no solo cuantas. */
  decisionKeys: string[];
}

export type InvariantKind =
  | "entities_lost"
  | "events_lost"
  | "decisions_lost"
  | "decision_disappeared"
  | "runs_lost"
  | "run_not_finished"
  | "run_missing"
  | "decision_without_run";

export interface InvariantViolation {
  kind: InvariantKind;
  subject: string;
  detail: string;
}

/**
 * Fotografia del estado autoritativo. Solo recuentos y claves: ni un solo
 * dato de negocio, y desde luego ninguna credencial.
 */
export async function captureMongoStateSnapshot(
  repository: DepartmentStateRepository,
  capturedAt: string
): Promise<MongoStateSnapshot> {
  const entitiesByKind: Record<string, number> = {};
  const eventsByKind: Record<string, number> = {};

  for (const descriptor of migratableDescriptors()) {
    if (descriptor.stateClass === "A") {
      entitiesByKind[descriptor.kind] = await repository.entities.countByKind(descriptor.kind);
    } else {
      eventsByKind[descriptor.kind] = await repository.events.countByKind(descriptor.kind);
    }
  }

  const decisions = await repository.decisions.listAll();

  return {
    capturedAt,
    entitiesByKind,
    eventsByKind,
    humanDecisions: decisions.length,
    runs: await repository.runs.count(),
    decisionKeys: decisions.map((d) => d.decisionKey).sort(),
  };
}

/**
 * Compara dos fotografias y devuelve SOLO las regresiones.
 *
 * Crecer no es una regresion: una pasada sana añade entidades, eventos y
 * a veces decisiones. Lo unico prohibido es PERDER. Y con las decisiones
 * humanas se es mas estricto todavia: no basta con que el numero no baje,
 * es que ninguna clave concreta puede desaparecer — una decision borrada
 * y otra nueva mantendrian el recuento y serian una perdida real.
 */
export function detectInvariantViolations(
  before: MongoStateSnapshot,
  after: MongoStateSnapshot
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const kind of Object.keys(before.entitiesByKind)) {
    const previous = before.entitiesByKind[kind] ?? 0;
    const current = after.entitiesByKind[kind] ?? 0;
    if (current < previous) {
      violations.push({
        kind: "entities_lost",
        subject: kind,
        detail: `${previous} entidades antes, ${current} despues. El estado autoritativo no puede encoger.`,
      });
    }
  }

  for (const kind of Object.keys(before.eventsByKind)) {
    const previous = before.eventsByKind[kind] ?? 0;
    const current = after.eventsByKind[kind] ?? 0;
    if (current < previous) {
      violations.push({
        kind: "events_lost",
        subject: kind,
        detail: `${previous} eventos antes, ${current} despues. El historico es append-only.`,
      });
    }
  }

  if (after.humanDecisions < before.humanDecisions) {
    violations.push({
      kind: "decisions_lost",
      subject: "human_decisions",
      detail: `${before.humanDecisions} decisiones antes, ${after.humanDecisions} despues.`,
    });
  }

  const currentKeys = new Set(after.decisionKeys);
  for (const key of before.decisionKeys) {
    if (!currentKeys.has(key)) {
      violations.push({
        kind: "decision_disappeared",
        subject: key,
        detail:
          "una decision humana registrada ha dejado de estar. Es el unico dato del sistema que no se " +
          "puede reconstruir de ninguna forma.",
      });
    }
  }

  if (after.runs < before.runs) {
    violations.push({
      kind: "runs_lost",
      subject: "department_runs",
      detail: `${before.runs} pasadas antes, ${after.runs} despues.`,
    });
  }

  return violations;
}

/**
 * Invariantes de una pasada CONCRETA: que existe y que ha quedado
 * cerrada. Una pasada que se queda en "running" para siempre es la firma
 * de un job cancelado despues de escribir.
 */
export async function verifyRunInvariants(
  repository: DepartmentStateRepository,
  departmentRunId: string,
  options: { requireFinished: boolean }
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];

  const run = await repository.runs.getRun(departmentRunId);
  if (!run) {
    violations.push({
      kind: "run_missing",
      subject: departmentRunId,
      detail: "la pasada no existe en MongoDB. Si el orquestador la abrio, no llego a persistir.",
    });
    return violations;
  }

  if (options.requireFinished && run.status === "running") {
    violations.push({
      kind: "run_not_finished",
      subject: departmentRunId,
      detail:
        "la pasada sigue marcada como en curso. O el job murio despues de escribir, o nadie la cerro.",
    });
  }

  // Relacion valida: toda decision de esta pasada apunta a una pasada que existe.
  for (const decision of await repository.decisions.listForRun(departmentRunId)) {
    if (!decision.departmentRunId || decision.departmentRunId.trim().length === 0) {
      violations.push({
        kind: "decision_without_run",
        subject: decision.decisionKey,
        detail: "decision humana sin pasada de origen: no se puede auditar de donde salio.",
      });
    }
  }

  return violations;
}

/** Informe legible del guard. Sin datos sensibles. */
export function renderInvariantReport(
  before: MongoStateSnapshot | null,
  after: MongoStateSnapshot,
  violations: InvariantViolation[]
): string {
  const lines: string[] = [];
  lines.push("## Verificacion del estado autoritativo (MongoDB)");
  lines.push("");
  if (before) {
    lines.push(`- **Foto previa:** ${before.capturedAt}`);
  } else {
    lines.push("- **Foto previa:** no habia (primera pasada con MongoDB)");
  }
  lines.push(`- **Foto posterior:** ${after.capturedAt}`);
  lines.push(`- **Pasadas registradas:** ${after.runs}`);
  lines.push(`- **Decisiones humanas:** ${after.humanDecisions}`);
  lines.push(
    `- **Entidades autoritativas:** ${Object.values(after.entitiesByKind).reduce((a, b) => a + b, 0)}`
  );
  lines.push(
    `- **Eventos historicos:** ${Object.values(after.eventsByKind).reduce((a, b) => a + b, 0)}`
  );
  lines.push("");

  if (violations.length === 0) {
    lines.push(
      "**Sin regresiones de estado autoritativo.** Ninguna entidad, evento ni decision humana ha desaparecido."
    );
    return lines.join("\n");
  }

  lines.push(`**${violations.length} VIOLACION(ES) DE INVARIANTE:**`);
  lines.push("");
  for (const violation of violations) {
    lines.push(`- \`${violation.subject}\` (${violation.kind}): ${violation.detail}`);
  }
  return lines.join("\n");
}

/** Los `kind` que el guard vigila. Util para documentar y para los tests. */
export function guardedKinds(): string[] {
  return ENTITY_REGISTRY.filter((d) => d.stateClass === "A" || d.stateClass === "B").map(
    (d) => d.kind
  );
}
