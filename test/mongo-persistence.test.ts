import * as assert from "node:assert/strict";
import {
  DocumentFilter,
  DocumentKey,
  PersistedDocument,
  StateCollection,
  StateDatabase,
  WriteOutcome,
} from "../src/persistence/collection-port";
import { InMemoryStateDatabase } from "../src/persistence/in-memory-collection";
import { DepartmentStateRepository, RecordDecisionInput } from "../src/persistence/repositories";
import { buildDecisionKey, buildSubjectKey, normalizeSubject } from "../src/persistence/decision-identity";
import {
  MONGODB_DB_NAME_VAR,
  MONGODB_URI_VAR,
  describeCredentialShape,
  describeMongoTarget,
  loadMongoConfig,
  looksLikeMissingAuthSource,
  renderMongoTarget,
  sanitizeMongoText,
} from "../src/persistence/mongo-config";
import {
  MongoPersistenceError,
  classifyMongoError,
  troubleshootingHints,
} from "../src/persistence/mongo-errors";
import { COLLECTION_SPECS } from "../src/persistence/collections";
import { ENTITY_REGISTRY, buildEntityId } from "../src/persistence/entity-registry";
import {
  captureMongoStateSnapshot,
  detectInvariantViolations,
  verifyRunInvariants,
} from "../src/persistence/state-invariants";
import { openPersistenceSession, resolvePersistenceMode } from "../src/persistence/runtime";

/**
 * Fase O56 — tests de la persistencia en MongoDB.
 *
 * QUE FIJAN ESTOS TESTS Y POR QUE CORREN SIN CLUSTER:
 *
 * Lo que se prueba aqui son las GARANTIAS del puerto de persistencia:
 * idempotencia, no duplicacion bajo concurrencia, no reversion por una
 * escritura vieja, y supervivencia de las decisiones humanas entre
 * pasadas. Esas garantias viven en los repositorios, no en el driver, y
 * por eso se ejercitan contra el doble en memoria — que modela la
 * atomicidad por documento de MongoDB y cede el turno del event loop
 * antes de cada seccion critica, de forma que dos escritores
 * "concurrentes" se interleavan de verdad.
 *
 * Lo que NO se prueba aqui es el cluster (red, failover, write concern):
 * eso exige MongoDB real y lo cubre `npm run state:probe-mongodb`.
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

function newRepository(): DepartmentStateRepository {
  return new DepartmentStateRepository(new InMemoryStateDatabase());
}

/**
 * Simula "una pasada nueva": otro proceso, otro repositorio, pero la
 * MISMA base de datos. Es exactamente la situacion de un runner efimero
 * de GitHub Actions al dia siguiente.
 */
function newPassOverSameDatabase(database: StateDatabase): DepartmentStateRepository {
  return new DepartmentStateRepository(database);
}

/** Una decision humana de ejemplo, con motivo literal. */
function decisionInput(overrides: Partial<RecordDecisionInput> = {}): RecordDecisionInput {
  return {
    decisionId: "dept-2026-08-15T175321Z#decision-rec-7-2026-08-16T09:32:20.630Z",
    departmentRunId: "dept-2026-08-15T175321Z",
    recommendationId: "dept-2026-08-15T175321Z#rec-7",
    recommendationTitle: "Publicar las landings de taquillas en produccion",
    proposalNumber: 7,
    action: "reject",
    rejectionReason:
      "Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias.",
    overrides: {},
    target: "production",
    decidedBy: "pau",
    decidedAt: "2026-08-16T09:32:20.630Z",
    changeId: null,
    executionStatus: null,
    executionDetail: "",
    ...overrides,
  };
}

/** Doble que siempre falla, para probar el comportamiento fail-closed. */
class BrokenCollection implements StateCollection {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  private explode(): never {
    const err = new Error("connect ECONNREFUSED") as Error & { name: string };
    err.name = "MongoNetworkError";
    throw err;
  }
  async insertIfAbsent(_key: DocumentKey, _document: PersistedDocument): Promise<WriteOutcome> {
    this.explode();
  }
  async upsertIfNewer(
    _key: DocumentKey,
    _document: PersistedDocument,
    _freshnessField: string
  ): Promise<WriteOutcome> {
    this.explode();
  }
  async findOne(_key: DocumentKey): Promise<PersistedDocument | null> {
    this.explode();
  }
  async find(_filter: DocumentFilter): Promise<PersistedDocument[]> {
    this.explode();
  }
  async count(_filter?: DocumentFilter): Promise<number> {
    this.explode();
  }
}

class BrokenDatabase implements StateDatabase {
  collection(name: string): StateCollection {
    return new BrokenCollection(name);
  }
  async ensureIndexes(): Promise<void> {}
  async close(): Promise<void> {}
}

/** Ejecuta `fn` con las variables de entorno indicadas y las restaura siempre. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>): void | Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  const restore = (): void => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

async function captureError(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

export function runMongoPersistenceTests(): TestCase[] {
  return [
    // ---------------------------------------------------------------
    // A / B — la pasada existe una sola vez
    // ---------------------------------------------------------------
    {
      name: "A: crear una pasada la deja registrada con su hora de inicio",
      fn: async () => {
        const repository = newRepository();
        const outcome = await repository.runs.startRun({
          departmentRunId: "dept-2026-08-17T090000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T09:00:00.000Z",
        });
        assert.equal(outcome.result, "inserted");

        const run = await repository.runs.getRun("dept-2026-08-17T090000Z");
        assert.ok(run, "la pasada debe poder recuperarse despues de crearla");
        assert.equal(run?.status, "running");
        assert.equal(run?.startedAt, "2026-08-17T09:00:00.000Z");
      },
    },
    {
      name: "B: repetir la MISMA pasada no crea un duplicado (rerun de la Action)",
      fn: async () => {
        const repository = newRepository();
        const input = {
          departmentRunId: "dept-2026-08-17T090000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T09:00:00.000Z",
        };
        const first = await repository.runs.startRun(input);
        const second = await repository.runs.startRun({
          ...input,
          startedAt: "2026-08-17T11:00:00.000Z",
        });

        assert.equal(first.result, "inserted");
        assert.equal(second.result, "duplicate_prevented");
        assert.equal(await repository.runs.count(), 1, "una pasada relanzada sigue siendo UNA pasada");

        const run = await repository.runs.getRun("dept-2026-08-17T090000Z");
        assert.equal(
          run?.startedAt,
          "2026-08-17T09:00:00.000Z",
          "el rerun no puede reescribir la hora de inicio original"
        );
      },
    },

    // ---------------------------------------------------------------
    // C — recomendaciones y entidades
    // ---------------------------------------------------------------
    {
      name: "C: guardar una recomendacion la deja recuperable por tipo e id",
      fn: async () => {
        const repository = newRepository();
        await repository.entities.saveEntity({
          kind: "recommendation",
          entityId: "dept-2026-08-17T090000Z#rec-1",
          status: "promoted",
          departmentRunId: "dept-2026-08-17T090000Z",
          recordUpdatedAt: "2026-08-17T09:30:00.000Z",
          payload: { title: "Añadir fotografias reales a las landings", rank: 1 },
        });

        const stored = await repository.entities.getEntity(
          "recommendation",
          "dept-2026-08-17T090000Z#rec-1"
        );
        assert.equal(stored?.status, "promoted");
        assert.equal(stored?.payload.rank, 1);
      },
    },
    {
      name: "una version MAS VIEJA que llega tarde no revierte el estado",
      fn: async () => {
        const repository = newRepository();
        const key = { kind: "action", entityId: "action-42" };

        await repository.entities.saveEntity({
          ...key,
          status: "done",
          recordUpdatedAt: "2026-08-17T12:00:00.000Z",
          payload: { status: "done" },
        });
        const late = await repository.entities.saveEntity({
          ...key,
          status: "pending",
          recordUpdatedAt: "2026-08-17T08:00:00.000Z",
          payload: { status: "pending" },
        });

        assert.equal(late.result, "stale_ignored");
        const stored = await repository.entities.getEntity("action", "action-42");
        assert.equal(stored?.status, "done", "el estado nuevo NO puede revertirse con uno viejo");
      },
    },
    {
      name: "el mismo id en dos stores distintos no se pisa: la clave lleva el tipo delante",
      fn: async () => {
        const repository = newRepository();
        // `assetRequestId` existe en asset-requests Y en product-asset-requests.
        await repository.entities.saveEntity({
          kind: "asset_request",
          entityId: "asset-1",
          recordUpdatedAt: "2026-08-17T09:00:00.000Z",
          payload: { origen: "asset-requests" },
        });
        await repository.entities.saveEntity({
          kind: "product_asset_request",
          entityId: "asset-1",
          recordUpdatedAt: "2026-08-17T09:00:00.000Z",
          payload: { origen: "product-asset-requests" },
        });

        const a = await repository.entities.getEntity("asset_request", "asset-1");
        const b = await repository.entities.getEntity("product_asset_request", "asset-1");
        assert.equal(a?.payload.origen, "asset-requests");
        assert.equal(b?.payload.origen, "product-asset-requests");
      },
    },

    // ---------------------------------------------------------------
    // D / E / F / O — decisiones humanas
    // ---------------------------------------------------------------
    {
      name: "D: una aprobacion humana queda persistida con su autor y su instante",
      fn: async () => {
        const repository = newRepository();
        const outcome = await repository.decisions.recordDecision(
          decisionInput({ action: "approve", rejectionReason: "", target: "staging" })
        );
        assert.equal(outcome.result, "inserted");

        const stored = await repository.decisions.listAll();
        assert.equal(stored.length, 1);
        assert.equal(stored[0].action, "approve");
        assert.equal(stored[0].decidedBy, "pau");
        assert.equal(stored[0].decidedAt, "2026-08-16T09:32:20.630Z");
      },
    },
    {
      name: "E: una pasada NUEVA recupera la aprobacion de la pasada anterior",
      fn: async () => {
        const database = new InMemoryStateDatabase();

        // Pasada 1: se toma la decision.
        const pass1 = newPassOverSameDatabase(database);
        await pass1.runs.startRun({
          departmentRunId: "dept-2026-08-15T175321Z",
          runKind: "coordinated",
          startedAt: "2026-08-15T17:53:21.000Z",
        });
        await pass1.decisions.recordDecision(
          decisionInput({ action: "approve", rejectionReason: "", target: "staging" })
        );

        // Pasada 2: otro proceso, otro repositorio, misma base.
        const pass2 = newPassOverSameDatabase(database);
        await pass2.runs.startRun({
          departmentRunId: "dept-2026-08-16T090000Z",
          runKind: "coordinated",
          startedAt: "2026-08-16T09:00:00.000Z",
        });

        const previous = await pass2.decisions.listAll();
        assert.equal(previous.length, 1, "la decision de ayer TIENE que estar disponible hoy");
        assert.equal(previous[0].action, "approve");
        assert.equal(
          previous[0].departmentRunId,
          "dept-2026-08-15T175321Z",
          "la decision conserva la pasada en la que se tomo"
        );
      },
    },
    {
      name: "E-bis: las APROBACIONES tambien se conservan, no solo los rechazos",
      fn: async () => {
        // El lector legacy descarta todo lo que no sea `reject` con motivo,
        // asi que las aprobaciones eran write-only. En MongoDB se guardan
        // las tres acciones y se pueden consultar.
        const repository = newRepository();
        for (const action of ["approve", "reject", "defer"]) {
          await repository.decisions.recordDecision(
            decisionInput({
              action,
              recommendationId: `dept-2026-08-15T175321Z#rec-${action}`,
              rejectionReason: action === "reject" ? "no me convence todavia" : "",
            })
          );
        }
        const stored = await repository.decisions.listAll();
        assert.equal(stored.length, 3);
        assert.deepEqual(
          stored.map((d) => d.action).sort(),
          ["approve", "defer", "reject"],
          "las tres acciones humanas sobreviven"
        );
      },
    },
    {
      name: "F: un rechazo conserva el motivo humano LITERAL, sin resumir ni reescribir",
      fn: async () => {
        const repository = newRepository();
        const motivo =
          'Las paginas se ven "basicas": faltan fotografias reales del producto, y el CTA de arriba ' +
          "no dice el precio. No publicar hasta la 2a iteracion.";
        await repository.decisions.recordDecision(
          decisionInput({ action: "reject", rejectionReason: motivo })
        );

        const stored = await repository.decisions.listAll();
        assert.equal(
          stored[0].rejectionReason,
          motivo,
          "el motivo se guarda tal cual lo escribio la persona, comillas incluidas"
        );
      },
    },
    {
      name: "O: una decision tomada ENTRE dos pasadas aparece en la siguiente",
      fn: async () => {
        const database = new InMemoryStateDatabase();

        const pass1 = newPassOverSameDatabase(database);
        await pass1.runs.startRun({
          departmentRunId: "dept-2026-08-17T090000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T09:00:00.000Z",
        });
        await pass1.runs.finishRun({
          departmentRunId: "dept-2026-08-17T090000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T09:00:00.000Z",
          finishedAt: "2026-08-17T09:40:00.000Z",
          status: "succeeded",
        });

        // ENTRE pasadas: la sesion de aprobacion, en su propio job.
        const approvalSession = newPassOverSameDatabase(database);
        await approvalSession.decisions.recordDecision(
          decisionInput({
            departmentRunId: "dept-2026-08-17T090000Z",
            recommendationId: "dept-2026-08-17T090000Z#rec-3",
            action: "approve",
            rejectionReason: "",
            decidedAt: "2026-08-17T19:12:00.000Z",
          })
        );

        // Pasada siguiente.
        const pass2 = newPassOverSameDatabase(database);
        const visible = await pass2.decisions.listForRun("dept-2026-08-17T090000Z");
        assert.equal(visible.length, 1, "la aprobacion tomada entre pasadas debe verse en la siguiente");
        assert.equal(visible[0].recommendationId, "dept-2026-08-17T090000Z#rec-3");
      },
    },
    {
      name: "una decision se puede encontrar por ASUNTO aunque el recommendationId cambie de pasada",
      fn: async () => {
        // `recommendationId` lleva el departmentRunId dentro y nunca se
        // repite: sin `subjectKey` el historial de una propuesta es
        // siempre vacio entre pasadas.
        const repository = newRepository();
        const titulo = "Publicar las landings de taquillas en produccion";
        await repository.decisions.recordDecision(
          decisionInput({
            departmentRunId: "dept-2026-08-15T175321Z",
            recommendationId: "dept-2026-08-15T175321Z#rec-7",
            recommendationTitle: titulo,
          })
        );

        const porIdDeHoy = await repository.decisions.listForRecommendation(
          "dept-2026-08-16T090000Z#rec-7"
        );
        assert.equal(porIdDeHoy.length, 0, "el id de hoy no encuentra la decision de ayer: es otro id");

        const porAsunto = await repository.decisions.listForSubject(buildSubjectKey(titulo));
        assert.equal(porAsunto.length, 1, "por asunto SI se encuentra");
      },
    },
    {
      name: "el asunto se normaliza sin acentos, mayusculas ni puntuacion",
      fn: () => {
        assert.equal(
          normalizeSubject("  Añadir FOTOGRAFÍAS reales, ¡ya!  "),
          "anadir fotografias reales ya"
        );
        assert.equal(
          buildSubjectKey("Publicar landings"),
          buildSubjectKey("publicar   Landings."),
          "dos formas del mismo titulo dan la misma clave"
        );
        assert.equal(buildSubjectKey("   "), "", "un titulo vacio no genera clave: mejor no emparejar");
      },
    },

    // ---------------------------------------------------------------
    // G / H — concurrencia e idempotencia
    // ---------------------------------------------------------------
    {
      name: "G: dos escritores CONCURRENTES de la misma decision no la duplican",
      fn: async () => {
        const repository = newRepository();
        const input = decisionInput();

        const [a, b] = await Promise.all([
          repository.decisions.recordDecision(input),
          repository.decisions.recordDecision(input),
        ]);

        const results = [a.result, b.result].sort();
        assert.deepEqual(results, ["duplicate_prevented", "inserted"]);
        assert.equal(await repository.decisions.count(), 1);
      },
    },
    {
      name: "G-bis: diez escritores concurrentes de la misma pasada dejan UNA pasada",
      fn: async () => {
        const repository = newRepository();
        const input = {
          departmentRunId: "dept-2026-08-17T090000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T09:00:00.000Z",
        };
        const outcomes = await Promise.all(
          Array.from({ length: 10 }, () => repository.runs.startRun(input))
        );
        assert.equal(outcomes.filter((o) => o.result === "inserted").length, 1);
        assert.equal(outcomes.filter((o) => o.result === "duplicate_prevented").length, 9);
        assert.equal(await repository.runs.count(), 1);
      },
    },
    {
      name: "H: reintentar la MISMA decision no duplica, aunque el decisionId traiga otro timestamp",
      fn: async () => {
        // Este es el bug real: `buildDecisionId()` mete el instante con
        // milisegundos dentro del id, asi que un reintento generaba un id
        // distinto y una segunda linea de la misma decision.
        const repository = newRepository();
        const base = decisionInput();

        await repository.decisions.recordDecision(base);
        const retry = await repository.decisions.recordDecision({
          ...base,
          decisionId: "dept-2026-08-15T175321Z#decision-rec-7-2026-08-16T09:35:11.100Z",
        });

        assert.equal(retry.result, "duplicate_prevented");
        assert.equal(await repository.decisions.count(), 1, "la misma decision no puede contar dos veces");
      },
    },
    {
      name: "H-bis: la clave de decision es determinista y no depende de ningun reloj",
      fn: () => {
        const material = {
          departmentRunId: "dept-1",
          recommendationId: "dept-1#rec-1",
          action: "reject",
          rejectionReason: "faltan fotos",
          target: "staging",
          decidedBy: "pau",
        };
        assert.equal(buildDecisionKey(material), buildDecisionKey({ ...material }));
        assert.notEqual(
          buildDecisionKey(material),
          buildDecisionKey({ ...material, rejectionReason: "faltan precios" }),
          "otro motivo es OTRA decision y debe registrarse aparte"
        );
      },
    },
    {
      name: "H-ter: un motivo que contiene separadores no colisiona con otro distinto",
      fn: () => {
        const base = {
          departmentRunId: "d",
          recommendationId: "r",
          action: "reject",
          target: "staging",
          decidedBy: "pau",
        };
        assert.notEqual(
          buildDecisionKey({ ...base, rejectionReason: 'a","b' }),
          buildDecisionKey({ ...base, rejectionReason: 'a"' , decidedBy: 'pau","b' }),
          "el encoding de la clave debe ser inyectivo"
        );
      },
    },
    {
      name: "reejecutar la escritura de una entidad identica es idempotente",
      fn: async () => {
        const repository = newRepository();
        const input = {
          kind: "change_pack" as const,
          entityId: "cp-1",
          status: "ready",
          recordUpdatedAt: "2026-08-17T10:00:00.000Z",
          payload: { titulo: "Landing taquillas" },
        };
        await repository.entities.saveEntity(input);
        await repository.entities.saveEntity(input);
        assert.equal(await repository.entities.countByKind("change_pack"), 1);
      },
    },
    {
      name: "un evento historico repetido no se escribe dos veces",
      fn: async () => {
        const repository = newRepository();
        const event = {
          kind: "department_event",
          eventId: "evt-1",
          departmentRunId: "dept-2026-08-17T090000Z",
          occurredAt: "2026-08-17T09:05:00.000Z",
          payload: { summary: "SEO watcher ha terminado" },
        };
        const first = await repository.events.appendEvent(event);
        const second = await repository.events.appendEvent({ ...event, payload: { summary: "otro" } });

        assert.equal(first.result, "inserted");
        assert.equal(second.result, "duplicate_prevented");
        const stored = await repository.events.getEvent("department_event", "evt-1");
        assert.equal(
          stored?.payload.summary,
          "SEO watcher ha terminado",
          "un evento es inmutable: la segunda escritura no lo modifica"
        );
      },
    },

    // ---------------------------------------------------------------
    // I — fail-closed
    // ---------------------------------------------------------------
    {
      name: "I: con MongoDB caido, una operacion critica FALLA, no se degrada en silencio",
      fn: async () => {
        const repository = new DepartmentStateRepository(new BrokenDatabase());
        const err = await captureError(() =>
          repository.decisions.recordDecision(decisionInput())
        );
        assert.ok(err instanceof MongoPersistenceError, "el fallo debe llegar clasificado");
        assert.equal((err as MongoPersistenceError).kind, "network_failure");
        assert.equal((err as MongoPersistenceError).retryable, true);
      },
    },
    {
      name: "I-bis: en modo mongo, sin credenciales la sesion falla cerrada",
      fn: async () => {
        await withEnv({ [MONGODB_URI_VAR]: undefined, [MONGODB_DB_NAME_VAR]: undefined }, async () => {
          const err = await captureError(() => openPersistenceSession({ mode: "mongo", env: {} }));
          assert.ok(err, "en modo mongo, sin configuracion no se puede continuar");
          assert.match(String(err?.message), /fuente de verdad/i);
        });
      },
    },
    {
      name: "I-ter: en modo shadow, un fallo de MongoDB NO tumba la pasada",
      fn: async () => {
        const session = await openPersistenceSession({ mode: "shadow", env: {} });
        assert.equal(session.connected, false);
        assert.equal(session.repository, null);
        assert.ok(session.unavailableReason.length > 0, "el motivo queda registrado, no se oculta");
      },
    },
    {
      name: "el modo por defecto es legacy sin credenciales y shadow con ellas, nunca mongo",
      fn: () => {
        assert.equal(resolvePersistenceMode({}), "legacy");
        assert.equal(
          resolvePersistenceMode({ [MONGODB_URI_VAR]: "mongodb://x/y" }),
          "shadow",
          "tener credenciales NO convierte a MongoDB en fuente de verdad por accidente"
        );
        assert.throws(
          () => resolvePersistenceMode({ DEPARTMENT_PERSISTENCE_MODE: "loquesea" }),
          /valor desconocido/i
        );
      },
    },

    // ---------------------------------------------------------------
    // M / N — varias pasadas conviviendo
    // ---------------------------------------------------------------
    {
      name: "M: dos pasadas el MISMO dia no colisionan",
      fn: async () => {
        const repository = newRepository();
        await repository.runs.startRun({
          departmentRunId: "dept-2026-08-17T070000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T07:00:00.000Z",
        });
        await repository.runs.startRun({
          departmentRunId: "dept-2026-08-17T190000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T19:00:00.000Z",
        });
        assert.equal(await repository.runs.count(), 2);

        const previous = await repository.runs.findPreviousRun("dept-2026-08-17T190000Z");
        assert.equal(previous?.departmentRunId, "dept-2026-08-17T070000Z");
      },
    },
    {
      name: "N: dos pasadas concurrentes escriben entidades distintas sin corromperse",
      fn: async () => {
        const database = new InMemoryStateDatabase();
        const branchA = newPassOverSameDatabase(database);
        const branchB = newPassOverSameDatabase(database);

        await Promise.all([
          branchA.runs.startRun({
            departmentRunId: "dept-2026-08-17T070000Z",
            runKind: "coordinated",
            startedAt: "2026-08-17T07:00:00.000Z",
          }),
          branchB.runs.startRun({
            departmentRunId: "dept-2026-08-17T071000Z",
            runKind: "coordinated",
            startedAt: "2026-08-17T07:10:00.000Z",
          }),
          branchA.entities.saveEntity({
            kind: "action",
            entityId: "action-A",
            recordUpdatedAt: "2026-08-17T07:05:00.000Z",
            departmentRunId: "dept-2026-08-17T070000Z",
            payload: { rama: "A" },
          }),
          branchB.entities.saveEntity({
            kind: "action",
            entityId: "action-B",
            recordUpdatedAt: "2026-08-17T07:15:00.000Z",
            departmentRunId: "dept-2026-08-17T071000Z",
            payload: { rama: "B" },
          }),
        ]);

        assert.equal(await branchA.runs.count(), 2);
        assert.equal((await branchA.entities.getEntity("action", "action-A"))?.payload.rama, "A");
        assert.equal((await branchA.entities.getEntity("action", "action-B"))?.payload.rama, "B");
      },
    },
    {
      name: "una pasada cancelada despues de escribir queda visible como no terminada",
      fn: async () => {
        const repository = newRepository();
        await repository.runs.startRun({
          departmentRunId: "dept-2026-08-17T090000Z",
          runKind: "coordinated",
          startedAt: "2026-08-17T09:00:00.000Z",
        });
        const violations = await verifyRunInvariants(repository, "dept-2026-08-17T090000Z", {
          requireFinished: true,
        });
        assert.equal(violations.length, 1);
        assert.equal(violations[0].kind, "run_not_finished");
      },
    },
    {
      name: "una pasada que el orquestador abrio pero nunca llego a MongoDB se detecta",
      fn: async () => {
        const repository = newRepository();
        const violations = await verifyRunInvariants(repository, "dept-2026-08-17T090000Z", {
          requireFinished: false,
        });
        assert.equal(violations[0].kind, "run_missing");
      },
    },

    // ---------------------------------------------------------------
    // Guard de invariantes
    // ---------------------------------------------------------------
    {
      name: "el guard nuevo no protesta porque el estado CREZCA",
      fn: async () => {
        const repository = newRepository();
        const before = await captureMongoStateSnapshot(repository, "2026-08-17T09:00:00.000Z");
        await repository.decisions.recordDecision(decisionInput());
        await repository.entities.saveEntity({
          kind: "action",
          entityId: "a-1",
          recordUpdatedAt: "2026-08-17T10:00:00.000Z",
          payload: {},
        });
        const after = await captureMongoStateSnapshot(repository, "2026-08-17T10:00:00.000Z");

        assert.deepEqual(detectInvariantViolations(before, after), []);
      },
    },
    {
      name: "el guard nuevo detecta que una decision humana concreta ha desaparecido",
      fn: async () => {
        const repository = newRepository();
        await repository.decisions.recordDecision(decisionInput());
        const before = await captureMongoStateSnapshot(repository, "2026-08-17T09:00:00.000Z");

        // Se simula la perdida: la misma foto pero sin esa decision.
        const after = { ...before, capturedAt: "2026-08-17T10:00:00.000Z", humanDecisions: 0, decisionKeys: [] };
        const violations = detectInvariantViolations(before, after);

        assert.equal(violations.length, 2, "se reporta el recuento Y la clave concreta que falta");
        assert.deepEqual(violations.map((v) => v.kind).sort(), [
          "decision_disappeared",
          "decisions_lost",
        ]);
      },
    },
    {
      name: "el guard detecta que se han perdido entidades autoritativas",
      fn: async () => {
        const repository = newRepository();
        await repository.entities.saveEntity({
          kind: "action",
          entityId: "a-1",
          recordUpdatedAt: "2026-08-17T09:00:00.000Z",
          payload: {},
        });
        const before = await captureMongoStateSnapshot(repository, "2026-08-17T09:00:00.000Z");
        const after = {
          ...before,
          capturedAt: "2026-08-17T10:00:00.000Z",
          entitiesByKind: { ...before.entitiesByKind, action: 0 },
        };
        const violations = detectInvariantViolations(before, after);
        assert.equal(violations[0].kind, "entities_lost");
      },
    },

    // ---------------------------------------------------------------
    // Seguridad: la URI no sale de la capa de configuracion
    // ---------------------------------------------------------------
    {
      name: "SEGURIDAD: la descripcion del destino no contiene usuario, password ni host",
      fn: () => {
        const config = {
          uri: "mongodb+srv://usuario:contrasenaSecreta@cluster0.abc12.mongodb.net/zentry?retryWrites=true",
          dbName: "zentry",
        };
        const rendered = renderMongoTarget(describeMongoTarget(config));
        assert.match(rendered, /esquema=mongodb\+srv/);
        assert.match(rendered, /db=zentry/);
        assert.doesNotMatch(rendered, /contrasenaSecreta/);
        assert.doesNotMatch(rendered, /usuario/);
        assert.doesNotMatch(rendered, /cluster0/);
      },
    },
    {
      name: "SEGURIDAD: el saneador borra la URI de cualquier mensaje de error",
      fn: () => {
        const raw =
          "MongoServerSelectionError: connection to mongodb+srv://pau:hunter2@cluster0.abc.mongodb.net/db failed";
        const clean = sanitizeMongoText(raw);
        assert.doesNotMatch(clean, /hunter2/);
        assert.doesNotMatch(clean, /cluster0/);
        assert.match(clean, /REDACTED/);
      },
    },
    {
      name: "SEGURIDAD: el error clasificado que se lanza tampoco lleva la URI",
      fn: () => {
        const err = new MongoPersistenceError(
          "auth_failure",
          "connect",
          "authentication failed for mongodb://pau:hunter2@host/db"
        );
        assert.doesNotMatch(err.message, /hunter2/);
        assert.match(err.message, /\[mongo:auth_failure\]/);
      },
    },
    {
      name: "SEGURIDAD: sin MONGODB_URI se falla nombrando la VARIABLE, nunca un valor",
      fn: () => {
        assert.throws(() => loadMongoConfig({}), (err: Error) => {
          assert.match(err.message, /MONGODB_URI/);
          assert.match(err.message, /fail-closed/i);
          return true;
        });
      },
    },
    {
      name: "la configuracion rechaza una URI con esquema invalido sin enseñar su valor",
      fn: () => {
        assert.throws(
          () => loadMongoConfig({ [MONGODB_URI_VAR]: "postgres://pau:hunter2@host/db" }),
          (err: Error) => {
            assert.doesNotMatch(err.message, /hunter2/);
            assert.match(err.message, /esquema valido/i);
            return true;
          }
        );
      },
    },
    {
      name: "MONGODB_DB_NAME manda sobre la base que venga dentro de la URI",
      fn: () => {
        const config = loadMongoConfig({
          [MONGODB_URI_VAR]: "mongodb://host:27017/de_la_uri",
          [MONGODB_DB_NAME_VAR]: "explicita",
        });
        assert.equal(config.dbName, "explicita");
        assert.equal(
          loadMongoConfig({ [MONGODB_URI_VAR]: "mongodb://host:27017/de_la_uri" }).dbName,
          "de_la_uri"
        );
      },
    },

    // ---------------------------------------------------------------
    // Taxonomia de fallos
    // ---------------------------------------------------------------
    {
      name: "un duplicate key ESPERADO no es un fallo; uno inesperado si",
      fn: () => {
        const duplicate = { code: 11000, message: "E11000 duplicate key" };
        assert.equal(classifyMongoError(duplicate, true), "duplicate_key_expected");
        assert.equal(classifyMongoError(duplicate, false), "duplicate_key_unexpected");
      },
    },
    {
      name: "un fallo de autenticacion NO se reintenta; uno de red SI",
      fn: () => {
        const auth = new MongoPersistenceError("auth_failure", "connect", "authentication failed");
        const network = new MongoPersistenceError("network_failure", "connect", "ECONNREFUSED");
        assert.equal(auth.retryable, false, "reintentar credenciales malas solo gasta tiempo");
        assert.equal(network.retryable, true);
      },
    },
    {
      name: "un fallo de auth explica que la red esta bien y que hay que revisar",
      fn: () => {
        // Caso real: Atlas devolvio "bad auth : authentication failed". El
        // SRV habia resuelto, asi que la red no era el problema — y sin
        // esta pista lo primero que se toca es Network Access, que no es.
        assert.equal(
          classifyMongoError(new Error("bad auth : authentication failed")),
          "auth_failure"
        );
        const hints = troubleshootingHints("auth_failure").join(" ");
        assert.match(hints, /RED esta bien/i);
        assert.match(hints, /PERCENT-ENCODED/i, "la contrasena sin escapar es la causa mas comun");
        assert.match(hints, /authSource/);
        assert.match(hints, /readWrite/);
      },
    },
    {
      name: "base en la ruta sin authSource: la trampa clasica de Atlas se detecta",
      fn: () => {
        // Por especificacion, authSource NO es siempre `admin`: por defecto
        // es la base que venga en la RUTA de la URI. Atlas, en cambio, crea
        // los usuarios en `admin`. Las dos cosas juntas dan un
        // "bad auth : authentication failed" que no explica nada.
        const sospechosa = describeMongoTarget({
          uri: "mongodb+srv://usuario:clave@cluster0.abc.mongodb.net/zentry_ai_department",
          dbName: "zentry_ai_department",
        });
        assert.equal(sospechosa.hasPathDatabase, true);
        assert.equal(sospechosa.hasExplicitAuthSource, false);
        assert.equal(looksLikeMissingAuthSource(sospechosa), true);

        const corregida = describeMongoTarget({
          uri: "mongodb+srv://usuario:clave@cluster0.abc.mongodb.net/zentry_ai_department?authSource=admin&retryWrites=true",
          dbName: "zentry_ai_department",
        });
        assert.equal(corregida.hasExplicitAuthSource, true);
        assert.equal(looksLikeMissingAuthSource(corregida), false);

        const sinRuta = describeMongoTarget({
          uri: "mongodb+srv://usuario:clave@cluster0.abc.mongodb.net/",
          dbName: "zentry_department",
        });
        assert.equal(
          looksLikeMissingAuthSource(sinRuta),
          false,
          "sin base en la ruta el driver ya cae a admin por defecto: no hay trampa"
        );
      },
    },
    {
      name: "el placeholder <db_password> sin sustituir se detecta: es la causa mas tonta y mas comun",
      fn: () => {
        // Atlas copia la cadena con `<db_password>` literal dentro. Si no
        // se reemplaza, el driver envia ese texto como contrasena y el
        // servidor responde `bad auth` sin decir nada mas.
        const shape = describeCredentialShape(
          "mongodb+srv://zentry:<db_password>@cluster0.abc.mongodb.net/zentry?authSource=admin"
        );
        assert.equal(shape.hasPlaceholder, true);
        assert.equal(shape.hasCredentials, true);
      },
    },
    {
      name: "una contrasena con % literal sin escapar se señala: el driver decodifica de mas",
      fn: () => {
        // Si la contrasena real es "ab%73c" y no se escribio "%25", el
        // driver decodifica "%73" como "s" y autentica con "absc".
        const conEscapes = describeCredentialShape(
          "mongodb+srv://zentry:ab%73c@cluster0.abc.mongodb.net/zentry"
        );
        assert.equal(conEscapes.hasPercentEscapes, true);

        const limpia = describeCredentialShape(
          "mongodb+srv://zentry:claveSimple@cluster0.abc.mongodb.net/zentry"
        );
        assert.equal(limpia.hasPercentEscapes, false);
        assert.equal(limpia.hasPlaceholder, false);
        assert.equal(limpia.hasRawSpecialChars, false);
        assert.equal(limpia.hasEmptyPart, false);
      },
    },
    {
      name: "una contrasena vacia o con caracteres crudos se detecta",
      fn: () => {
        assert.equal(
          describeCredentialShape("mongodb+srv://zentry:@cluster0.abc.mongodb.net/z").hasEmptyPart,
          true
        );
        assert.equal(
          describeCredentialShape("mongodb+srv://zentry:cla/ve@cluster0.abc.mongodb.net/z")
            .hasRawSpecialChars,
          true,
          "una barra cruda en la contrasena rompe el parseo de la autoridad"
        );
        assert.equal(
          describeCredentialShape("mongodb+srv://zentry:cla@ve@cluster0.abc.mongodb.net/z")
            .hasRawSpecialChars,
          true,
          "un @ sin escapar como %40 hace que driver y parser discrepen sobre donde acaba la contrasena"
        );
        assert.equal(
          describeCredentialShape("mongodb://cluster0.abc.mongodb.net/z").hasCredentials,
          false,
          "una URI sin credenciales no es un caso de forma incorrecta"
        );
      },
    },
    {
      name: "SEGURIDAD: la radiografia de credenciales solo devuelve booleanos",
      fn: () => {
        const shape = describeCredentialShape(
          "mongodb+srv://zentry:hunter2Secreta@cluster0.abc.mongodb.net/zentry"
        );
        for (const value of Object.values(shape)) {
          assert.equal(typeof value, "boolean", "ni un solo campo puede llevar texto de la URI");
        }
        assert.doesNotMatch(JSON.stringify(shape), /hunter2|zentry|cluster0/);
      },
    },
    {
      name: "un fallo de red apunta a Network Access, que es otra cosa distinta",
      fn: () => {
        const hints = troubleshootingHints("network_failure").join(" ");
        assert.match(hints, /Network Access/i);
        assert.match(hints, /no tienen IP\s+fija|no tienen IP fija/i);
        assert.equal(
          troubleshootingHints("auth_failure").join(" ").includes("Network Access"),
          false,
          "no mandar a Network Access a quien tiene un problema de credenciales"
        );
      },
    },
    {
      name: "SEGURIDAD: las pistas de diagnostico no contienen ningun valor, solo que mirar",
      fn: () => {
        const kinds: Parameters<typeof troubleshootingHints>[0][] = [
          "auth_failure",
          "network_failure",
          "unavailable",
          "timeout",
          "not_configured",
        ];
        for (const kind of kinds) {
          const text = troubleshootingHints(kind).join(" ");
          assert.doesNotMatch(text, /mongodb(\+srv)?:\/\//, `las pistas de ${kind} no llevan URIs`);
          assert.equal(text, sanitizeMongoText(text), `las pistas de ${kind} ya estan saneadas`);
        }
      },
    },
    {
      name: "los codigos de error del servidor se clasifican en la taxonomia declarada",
      fn: () => {
        assert.equal(classifyMongoError({ code: 18, message: "Authentication failed" }), "auth_failure");
        assert.equal(classifyMongoError({ code: 10107, message: "not master" }), "unavailable");
        assert.equal(
          classifyMongoError({ name: "MongoWriteConcernError", message: "write concern failed" }),
          "write_concern"
        );
      },
    },

    // ---------------------------------------------------------------
    // Contrato del modelo
    // ---------------------------------------------------------------
    {
      name: "toda invariante de unicidad tiene su indice unico declarado",
      fn: () => {
        for (const spec of COLLECTION_SPECS) {
          const unique = spec.indexes.filter((i) => i.unique);
          assert.ok(
            unique.length >= 1,
            `la coleccion ${spec.name} no declara ningun indice unico: nada impediria duplicar`
          );
          for (const index of spec.indexes) {
            assert.ok(
              index.reason.trim().length > 20,
              `el indice ${index.fields.join("+")} de ${spec.name} no explica por que existe`
            );
          }
        }
      },
    },
    {
      name: "cada store de data/ esta clasificado y declara su identidad estable",
      fn: () => {
        assert.ok(ENTITY_REGISTRY.length >= 25, "el inventario debe cubrir los stores reales de data/");
        for (const descriptor of ENTITY_REGISTRY) {
          assert.ok(descriptor.idFields.length >= 1, `${descriptor.file} no declara identidad`);
          assert.ok(descriptor.freshnessField.length > 0, `${descriptor.file} no declara frescura`);
          assert.ok(descriptor.rationale.length > 20, `${descriptor.file} no explica su clasificacion`);
          assert.match(descriptor.stateClass, /^[ABCD]$/);
        }
      },
    },
    {
      name: "un registro sin identidad estable NO se migra a ciegas: se detecta",
      fn: () => {
        const descriptor = ENTITY_REGISTRY.find((d) => d.file === "action-backlog.jsonl");
        assert.ok(descriptor);
        assert.equal(buildEntityId(descriptor!, { actionId: "a-1" }), "a-1");
        assert.equal(
          buildEntityId(descriptor!, { noTieneId: true }),
          null,
          "inventarle un id crearia un duplicado en la siguiente ejecucion"
        );
      },
    },
    {
      name: "una identidad compuesta se construye de forma determinista",
      fn: () => {
        const descriptor = ENTITY_REGISTRY.find((d) => d.file === "opportunity-state-log.jsonl");
        assert.ok(descriptor);
        const record = { actionId: "a-1", date: "2026-08-17" };
        assert.equal(buildEntityId(descriptor!, record), "a-1#2026-08-17");
        assert.equal(
          buildEntityId(descriptor!, record),
          buildEntityId(descriptor!, { ...record }),
          "misma entrada, misma clave: eso es lo que la hace idempotente"
        );
      },
    },
    {
      name: "no se puede escribir con una clave vacia",
      fn: async () => {
        const repository = newRepository();
        const err = await captureError(() =>
          repository.entities.saveEntity({
            kind: "action",
            entityId: "   ",
            recordUpdatedAt: "2026-08-17T09:00:00.000Z",
            payload: {},
          })
        );
        assert.ok(err, "sin identidad estable no se escribe");
        assert.match(err!.message, /identidad estable/i);
      },
    },
    {
      name: "no se registra una decision humana incompleta",
      fn: async () => {
        const repository = newRepository();
        const err = await captureError(() =>
          repository.decisions.recordDecision(
            decisionInput({ recommendationId: "" })
          )
        );
        assert.ok(err);
        assert.match(err!.message, /recommendationId/);
      },
    },
  ];
}
