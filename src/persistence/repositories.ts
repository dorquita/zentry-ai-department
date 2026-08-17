/**
 * Fase O56 — los repositorios del departamento.
 *
 * Esta es la unica capa que traduce dominio ("registra esta decision
 * humana") a persistencia ("insertIfAbsent sobre human_decisions con
 * clave decisionKey"). Ni un script ni un agente llaman a MongoDB
 * directamente: llaman aqui.
 *
 * Los cuatro repositorios NO son cuatro copias del mismo codigo: cada uno
 * codifica una garantia distinta.
 *
 *   RunRepository       una pasada existe una sola vez, aunque se relance.
 *   EntityRepository    la ultima version de una entidad gana; una version
 *                       vieja que llega tarde no la pisa.
 *   EventRepository     un evento se escribe una vez y no se toca mas.
 *   DecisionRepository  una decision humana se escribe una vez, no se
 *                       modifica JAMAS y se puede recuperar por
 *                       recomendacion, por asunto o por pasada.
 *
 * Todos los contadores de escritura se acumulan en un unico `WriteStats`
 * compartido, que es lo que la pasada publica como observabilidad.
 */
import {
  DECISIONS_COLLECTION,
  ENTITIES_COLLECTION,
  EVENTS_COLLECTION,
  MIGRATIONS_COLLECTION,
  RUNS_COLLECTION,
} from "./collections";
import {
  DocumentFilter,
  PersistedDocument,
  StateCollection,
  StateDatabase,
  WriteOutcome,
  WriteStats,
  emptyWriteStats,
  recordWrite,
  recordWriteFailure,
} from "./collection-port";
import { buildDecisionKey, buildSubjectKey } from "./decision-identity";
import { toMongoPersistenceError } from "./mongo-errors";

/** Version del contrato de documentos. Sube si cambia la forma almacenada. */
export const STATE_CONTRACT_VERSION = 1;

// -------------------------------------------------------------------
// Documentos
// -------------------------------------------------------------------

export type DepartmentRunStatus = "running" | "succeeded" | "failed";

export interface DepartmentRunDocument extends PersistedDocument {
  departmentRunId: string;
  /** "coordinated" (dept-*) o "growth-v1" (growth-department-*). */
  runKind: string;
  startedAt: string;
  finishedAt: string | null;
  status: DepartmentRunStatus;
  contractVersion: number;
  updatedAt: string;
  /**
   * Fase O57 — resumen de la pasada que la SIGUIENTE necesita para su
   * seccion "que ha cambiado".
   *
   * Antes ese dato solo existia dentro de
   * `reports/department/<runId>/department-daily-brief.json`, y por eso
   * la continuidad del brief dependia de restaurar `reports/` desde la
   * rama de estado. Guardarlo aqui no es un dominio nuevo: es estado de
   * la pasada, en la coleccion de pasadas.
   */
  briefSummary?: Record<string, unknown> | null;
}

export interface DepartmentEntityDocument extends PersistedDocument {
  kind: string;
  entityId: string;
  status: string;
  departmentRunId: string | null;
  /** El registro original completo, tal cual estaba en el `.jsonl`. */
  payload: Record<string, unknown>;
  /** Frescura: decide quien gana cuando dos escritores compiten. */
  recordUpdatedAt: string;
  contractVersion: number;
}

export interface DepartmentEventDocument extends PersistedDocument {
  kind: string;
  eventId: string;
  departmentRunId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  contractVersion: number;
}

export interface HumanDecisionDocument extends PersistedDocument {
  /** Identidad determinista por contenido. Indice unico. */
  decisionKey: string;
  /** El id historico del fichero, con timestamp dentro. Se conserva para trazar. */
  decisionId: string;
  departmentRunId: string;
  recommendationId: string;
  /** Clave estable del asunto, para poder emparejar entre pasadas. */
  subjectKey: string;
  changeId: string | null;
  recommendationTitle: string;
  proposalNumber: number;
  action: string;
  /** El motivo humano, LITERAL. Nunca se resume ni se reescribe. */
  rejectionReason: string;
  overrides: Record<string, unknown>;
  target: string;
  decidedBy: string;
  decidedAt: string;
  executionStatus: string | null;
  executionDetail: string;
  contractVersion: number;
}

/** La forma minima que debe traer una decision para poder registrarse. */
export interface RecordDecisionInput {
  decisionId: string;
  departmentRunId: string;
  recommendationId: string;
  recommendationTitle: string;
  proposalNumber: number;
  action: string;
  rejectionReason: string;
  overrides?: Record<string, unknown>;
  target: string;
  decidedBy: string;
  decidedAt: string;
  changeId?: string | null;
  executionStatus?: string | null;
  executionDetail?: string;
}

// -------------------------------------------------------------------
// Repositorios
// -------------------------------------------------------------------

abstract class BaseRepository {
  protected constructor(
    protected readonly collection: StateCollection,
    protected readonly stats: WriteStats
  ) {}

  protected async write(
    operation: string,
    run: () => Promise<WriteOutcome>
  ): Promise<WriteOutcome> {
    try {
      return recordWrite(this.stats, await run());
    } catch (err) {
      recordWriteFailure(this.stats);
      throw toMongoPersistenceError(err, operation);
    }
  }

  protected async read<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw toMongoPersistenceError(err, operation);
    }
  }
}

export class RunRepository extends BaseRepository {
  constructor(collection: StateCollection, stats: WriteStats) {
    super(collection, stats);
  }

  /**
   * Abre una pasada. IDEMPOTENTE: relanzar el mismo `departmentRunId`
   * (rerun de GitHub Actions, reintento del job) devuelve
   * "duplicate_prevented" y NO crea una segunda pasada ni pisa la hora de
   * inicio original.
   */
  async startRun(input: {
    departmentRunId: string;
    runKind: string;
    startedAt: string;
  }): Promise<WriteOutcome> {
    const document: DepartmentRunDocument = {
      departmentRunId: input.departmentRunId,
      runKind: input.runKind,
      startedAt: input.startedAt,
      finishedAt: null,
      status: "running",
      contractVersion: STATE_CONTRACT_VERSION,
      updatedAt: input.startedAt,
    };
    return this.write("runs.startRun", () =>
      this.collection.insertIfAbsent({ departmentRunId: input.departmentRunId }, document)
    );
  }

  /**
   * Cierra una pasada. Usa `upsertIfNewer` sobre `updatedAt`: si dos jobs
   * intentan cerrarla, gana el mas reciente y el otro no revierte nada.
   */
  async finishRun(input: {
    departmentRunId: string;
    runKind: string;
    startedAt: string;
    finishedAt: string;
    status: DepartmentRunStatus;
    observability?: Record<string, unknown>;
    /** Si no se pasa, se conserva el que ya tuviera la pasada. */
    briefSummary?: Record<string, unknown> | null;
  }): Promise<WriteOutcome> {
    // Cerrar la pasada no puede borrar el resumen que escribio la fase
    // del brief: se lee lo que hay y solo se sustituye si llega uno nuevo.
    const existing = await this.getRun(input.departmentRunId);
    const briefSummary = input.briefSummary ?? existing?.briefSummary ?? null;
    const document: DepartmentRunDocument = {
      departmentRunId: input.departmentRunId,
      runKind: input.runKind,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      status: input.status,
      contractVersion: STATE_CONTRACT_VERSION,
      updatedAt: input.finishedAt,
      ...(input.observability ? { observability: input.observability } : {}),
      ...(briefSummary ? { briefSummary } : {}),
    };
    return this.write("runs.finishRun", () =>
      this.collection.upsertIfNewer(
        { departmentRunId: input.departmentRunId },
        document,
        "updatedAt"
      )
    );
  }

  async getRun(departmentRunId: string): Promise<DepartmentRunDocument | null> {
    const found = await this.read("runs.getRun", () => this.collection.findOne({ departmentRunId }));
    return found as DepartmentRunDocument | null;
  }

  async listRuns(): Promise<DepartmentRunDocument[]> {
    const found = await this.read("runs.listRuns", () => this.collection.find({}));
    return (found as DepartmentRunDocument[]).sort((a, b) =>
      a.departmentRunId < b.departmentRunId ? -1 : a.departmentRunId > b.departmentRunId ? 1 : 0
    );
  }

  /**
   * La pasada inmediatamente anterior a `departmentRunId`.
   *
   * Sustituye al `readdirSync` + orden lexicografico de `run-store.ts`,
   * que solo funcionaba si el checkout tenia los directorios de las
   * pasadas anteriores — justo lo que no pasa en un runner efimero.
   */
  async findPreviousRun(departmentRunId: string): Promise<DepartmentRunDocument | null> {
    const runs = await this.listRuns();
    let previous: DepartmentRunDocument | null = null;
    for (const run of runs) {
      if (run.departmentRunId >= departmentRunId) break;
      previous = run;
    }
    return previous;
  }

  /**
   * Guarda el resumen que la pasada SIGUIENTE leera como "la anterior".
   *
   * Se escribe cuando el brief ya esta calculado, con la pasada todavia
   * abierta. Conserva lo que ya hubiera en el documento (hora de inicio,
   * estado) para que anotar el resumen no parezca un cierre.
   */
  async recordBriefSummary(input: {
    departmentRunId: string;
    runKind: string;
    briefSummary: Record<string, unknown>;
    at: string;
  }): Promise<WriteOutcome> {
    const existing = await this.getRun(input.departmentRunId);
    const document: DepartmentRunDocument = {
      departmentRunId: input.departmentRunId,
      runKind: input.runKind,
      startedAt: existing?.startedAt ?? input.at,
      finishedAt: existing?.finishedAt ?? null,
      status: existing?.status ?? "running",
      contractVersion: STATE_CONTRACT_VERSION,
      updatedAt: input.at,
      ...(existing?.observability ? { observability: existing.observability } : {}),
      briefSummary: input.briefSummary,
    };
    return this.write("runs.recordBriefSummary", () =>
      this.collection.upsertIfNewer({ departmentRunId: input.departmentRunId }, document, "updatedAt")
    );
  }

  async count(): Promise<number> {
    return this.read("runs.count", () => this.collection.count({}));
  }
}

export class EntityRepository extends BaseRepository {
  constructor(collection: StateCollection, stats: WriteStats) {
    super(collection, stats);
  }

  /**
   * Guarda el estado ACTUAL de una entidad. La ultima version gana; una
   * version mas vieja que llegue despues (reintento lento, job que
   * revive) se ignora en vez de revertir el estado.
   */
  async saveEntity(input: {
    kind: string;
    entityId: string;
    status?: string;
    departmentRunId?: string | null;
    recordUpdatedAt: string;
    payload: Record<string, unknown>;
  }): Promise<WriteOutcome> {
    const document: DepartmentEntityDocument = {
      kind: input.kind,
      entityId: input.entityId,
      status: input.status ?? "",
      departmentRunId: input.departmentRunId ?? null,
      payload: input.payload,
      recordUpdatedAt: input.recordUpdatedAt,
      contractVersion: STATE_CONTRACT_VERSION,
    };
    return this.write("entities.saveEntity", () =>
      this.collection.upsertIfNewer(
        { kind: input.kind, entityId: input.entityId },
        document,
        "recordUpdatedAt"
      )
    );
  }

  async getEntity(kind: string, entityId: string): Promise<DepartmentEntityDocument | null> {
    const found = await this.read("entities.getEntity", () =>
      this.collection.findOne({ kind, entityId })
    );
    return found as DepartmentEntityDocument | null;
  }

  async listByKind(kind: string, status?: string): Promise<DepartmentEntityDocument[]> {
    const filter: DocumentFilter = status ? { kind, status } : { kind };
    const found = await this.read("entities.listByKind", () => this.collection.find(filter));
    return found as DepartmentEntityDocument[];
  }

  async countByKind(kind: string): Promise<number> {
    return this.read("entities.countByKind", () => this.collection.count({ kind }));
  }

  async countAll(): Promise<number> {
    return this.read("entities.countAll", () => this.collection.count({}));
  }
}

export class EventRepository extends BaseRepository {
  constructor(collection: StateCollection, stats: WriteStats) {
    super(collection, stats);
  }

  /** Escribe un evento historico. Reejecutarlo no lo duplica. */
  async appendEvent(input: {
    kind: string;
    eventId: string;
    departmentRunId?: string | null;
    occurredAt: string;
    payload: Record<string, unknown>;
  }): Promise<WriteOutcome> {
    const document: DepartmentEventDocument = {
      kind: input.kind,
      eventId: input.eventId,
      departmentRunId: input.departmentRunId ?? null,
      occurredAt: input.occurredAt,
      payload: input.payload,
      contractVersion: STATE_CONTRACT_VERSION,
    };
    return this.write("events.appendEvent", () =>
      this.collection.insertIfAbsent({ kind: input.kind, eventId: input.eventId }, document)
    );
  }

  async getEvent(kind: string, eventId: string): Promise<DepartmentEventDocument | null> {
    const found = await this.read("events.getEvent", () => this.collection.findOne({ kind, eventId }));
    return found as DepartmentEventDocument | null;
  }

  async listForRun(departmentRunId: string): Promise<DepartmentEventDocument[]> {
    const found = await this.read("events.listForRun", () =>
      this.collection.find({ departmentRunId })
    );
    return (found as DepartmentEventDocument[]).sort((a, b) =>
      a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0
    );
  }

  /**
   * REPARACION: rellena el `occurredAt` de un evento que se escribio sin el.
   *
   * Existe por un fallo real: dos descriptores del registro declaraban un
   * campo de fecha que no existia en los registros historicos
   * (`editedAt`/`insertedAt` en vez de `createdAt`), asi que 6 eventos se
   * migraron con `occurredAt` vacio. Lo detecto la certificacion
   * independiente contra Atlas.
   *
   * Usa `upsertIfNewer` sobre `occurredAt`: una fecha real siempre es
   * "mas nueva" que la cadena vacia, asi que rellena el hueco; y si el
   * documento ya tiene una fecha buena, la reparacion no la pisa. No
   * borra nada y repetirla no cambia nada.
   */
  async repairOccurredAt(input: {
    kind: string;
    eventId: string;
    departmentRunId?: string | null;
    occurredAt: string;
    payload: Record<string, unknown>;
  }): Promise<WriteOutcome> {
    if (!input.occurredAt || input.occurredAt.trim().length === 0) {
      throw new Error("No se repara un evento con una fecha vacia: no arreglaria nada.");
    }
    const document: DepartmentEventDocument = {
      kind: input.kind,
      eventId: input.eventId,
      departmentRunId: input.departmentRunId ?? null,
      occurredAt: input.occurredAt,
      payload: input.payload,
      contractVersion: STATE_CONTRACT_VERSION,
    };
    return this.write("events.repairOccurredAt", () =>
      this.collection.upsertIfNewer(
        { kind: input.kind, eventId: input.eventId },
        document,
        "occurredAt"
      )
    );
  }

  /**
   * Todos los eventos de un tipo, del mas antiguo al mas reciente.
   *
   * Es lo que necesita la hidratacion para reconstruir un `.jsonl` de
   * clase B: los ficheros historicos estan en orden cronologico y los
   * lectores existentes cuentan con ello.
   */
  async listByKind(kind: string): Promise<DepartmentEventDocument[]> {
    const found = await this.read("events.listByKind", () => this.collection.find({ kind }));
    return (found as DepartmentEventDocument[]).sort((a, b) =>
      a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0
    );
  }

  async countByKind(kind: string): Promise<number> {
    return this.read("events.countByKind", () => this.collection.count({ kind }));
  }

  async countAll(): Promise<number> {
    return this.read("events.countAll", () => this.collection.count({}));
  }
}

export class DecisionRepository extends BaseRepository {
  constructor(collection: StateCollection, stats: WriteStats) {
    super(collection, stats);
  }

  /**
   * Registra una decision humana.
   *
   * Se escribe UNA sola vez y no se modifica nunca (`insertIfAbsent`). La
   * clave es `decisionKey`, determinista por contenido, asi que reejecutar
   * la sesion de aprobacion NO duplica aunque el `decisionId` original
   * traiga un timestamp distinto.
   *
   * Fail-closed: sin `recommendationId` o sin `decidedAt` no se escribe
   * nada. Una decision que no se puede recuperar despues es peor que un
   * error, porque parece que se guardo.
   */
  async recordDecision(input: RecordDecisionInput): Promise<WriteOutcome> {
    if (!input.recommendationId || input.recommendationId.trim().length === 0) {
      throw new Error("No se registra una decision humana sin recommendationId.");
    }
    if (!input.decidedAt || input.decidedAt.trim().length === 0) {
      throw new Error("No se registra una decision humana sin decidedAt.");
    }
    if (!input.departmentRunId || input.departmentRunId.trim().length === 0) {
      throw new Error("No se registra una decision humana sin departmentRunId.");
    }

    const overrides = input.overrides ?? {};
    const decisionKey = buildDecisionKey({
      departmentRunId: input.departmentRunId,
      recommendationId: input.recommendationId,
      action: input.action,
      rejectionReason: input.rejectionReason ?? "",
      target: input.target,
      decidedBy: input.decidedBy,
      overrides: {
        title: typeof overrides.title === "string" ? overrides.title : undefined,
        metaDescription:
          typeof overrides.metaDescription === "string" ? overrides.metaDescription : undefined,
      },
    });

    const document: HumanDecisionDocument = {
      decisionKey,
      decisionId: input.decisionId,
      departmentRunId: input.departmentRunId,
      recommendationId: input.recommendationId,
      subjectKey: buildSubjectKey(input.recommendationTitle ?? ""),
      changeId: input.changeId ?? null,
      recommendationTitle: input.recommendationTitle ?? "",
      proposalNumber: input.proposalNumber,
      action: input.action,
      rejectionReason: input.rejectionReason ?? "",
      overrides,
      target: input.target,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      executionStatus: input.executionStatus ?? null,
      executionDetail: input.executionDetail ?? "",
      contractVersion: STATE_CONTRACT_VERSION,
    };

    return this.write("decisions.recordDecision", () =>
      this.collection.insertIfAbsent({ decisionKey }, document)
    );
  }

  async listAll(): Promise<HumanDecisionDocument[]> {
    const found = await this.read("decisions.listAll", () => this.collection.find({}));
    return sortByDecidedAt(found as HumanDecisionDocument[]);
  }

  async listForRecommendation(recommendationId: string): Promise<HumanDecisionDocument[]> {
    const found = await this.read("decisions.listForRecommendation", () =>
      this.collection.find({ recommendationId })
    );
    return sortByDecidedAt(found as HumanDecisionDocument[]);
  }

  /**
   * Decisiones sobre el MISMO asunto, aunque se tomaran en otra pasada.
   * Es la consulta que `recommendationId` no puede responder, porque lleva
   * el `departmentRunId` dentro y nunca se repite.
   */
  async listForSubject(subjectKey: string): Promise<HumanDecisionDocument[]> {
    if (subjectKey.length === 0) return [];
    const found = await this.read("decisions.listForSubject", () =>
      this.collection.find({ subjectKey })
    );
    return sortByDecidedAt(found as HumanDecisionDocument[]);
  }

  async listForRun(departmentRunId: string): Promise<HumanDecisionDocument[]> {
    const found = await this.read("decisions.listForRun", () =>
      this.collection.find({ departmentRunId })
    );
    return sortByDecidedAt(found as HumanDecisionDocument[]);
  }

  async count(): Promise<number> {
    return this.read("decisions.count", () => this.collection.count({}));
  }
}

/**
 * Bitacora de las ejecuciones de la herramienta de migracion.
 *
 * NO es estado del departamento: es la prueba de que la migracion se
 * ejecuto y de que dos ejecuciones producen el mismo resultado. Se
 * escribe con `insertIfAbsent`, asi que relanzar la misma migracion no
 * genera una segunda entrada.
 */
export class MigrationLogRepository extends BaseRepository {
  constructor(collection: StateCollection, stats: WriteStats) {
    super(collection, stats);
  }

  async record(migrationRunId: string, payload: Record<string, unknown>): Promise<WriteOutcome> {
    return this.write("migrations.record", () =>
      this.collection.insertIfAbsent({ migrationRunId }, { migrationRunId, ...payload })
    );
  }

  async get(migrationRunId: string): Promise<PersistedDocument | null> {
    return this.read("migrations.get", () => this.collection.findOne({ migrationRunId }));
  }

  async count(): Promise<number> {
    return this.read("migrations.count", () => this.collection.count({}));
  }
}

function sortByDecidedAt(records: HumanDecisionDocument[]): HumanDecisionDocument[] {
  return [...records].sort((a, b) => {
    if (a.decidedAt !== b.decidedAt) return a.decidedAt < b.decidedAt ? -1 : 1;
    return a.decisionKey < b.decisionKey ? -1 : a.decisionKey > b.decisionKey ? 1 : 0;
  });
}

// -------------------------------------------------------------------
// Fachada
// -------------------------------------------------------------------

/**
 * Punto de entrada unico a la persistencia del departamento.
 *
 * Se construye sobre un `StateDatabase`, asi que funciona igual contra
 * MongoDB real que contra el doble en memoria de los tests: la logica de
 * negocio no distingue.
 */
export class DepartmentStateRepository {
  readonly runs: RunRepository;
  readonly entities: EntityRepository;
  readonly events: EventRepository;
  readonly decisions: DecisionRepository;
  readonly migrations: MigrationLogRepository;

  private readonly stats: WriteStats = emptyWriteStats();

  constructor(private readonly database: StateDatabase) {
    this.runs = new RunRepository(database.collection(RUNS_COLLECTION), this.stats);
    this.entities = new EntityRepository(database.collection(ENTITIES_COLLECTION), this.stats);
    this.events = new EventRepository(database.collection(EVENTS_COLLECTION), this.stats);
    this.decisions = new DecisionRepository(database.collection(DECISIONS_COLLECTION), this.stats);
    this.migrations = new MigrationLogRepository(
      database.collection(MIGRATIONS_COLLECTION),
      this.stats
    );
  }

  async ensureIndexes(): Promise<void> {
    await this.database.ensureIndexes();
  }

  /** Copia de los contadores. Nunca contiene datos sensibles. */
  writeStats(): WriteStats {
    return { ...this.stats };
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}
