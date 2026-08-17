import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { InMemoryStateDatabase } from "../src/persistence/in-memory-collection";
import { DepartmentStateRepository, RecordDecisionInput } from "../src/persistence/repositories";
import {
  migrateStateToMongo,
  planFileMigration,
  renderMigrationReport,
  verifyLegacyEquivalence,
} from "../src/persistence/migration";
import { ENTITY_REGISTRY, findDescriptorByFile } from "../src/persistence/entity-registry";

/**
 * Fase O56 — tests de la migracion del historico a MongoDB.
 *
 * Lo que se fija aqui es que la migracion se pueda ejecutar SIN MIEDO:
 * que se pueda ensayar sin escribir, que repetirla no duplique nada, que
 * conserve los ids que ya tenian significado, y que se niegue a adivinar
 * cuando el historico es ambiguo en vez de inventarse un ganador.
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

/** Monta un `data/` de mentira con el contenido indicado y lo limpia siempre. */
async function withDataDir(
  files: Record<string, unknown[]>,
  fn: (dataDir: string) => Promise<void>
): Promise<void> {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "zentry-mongo-migration-"));
  try {
    for (const [name, records] of Object.entries(files)) {
      fs.writeFileSync(
        path.join(baseDir, name),
        records.map((r) => JSON.stringify(r)).join("\n") + "\n",
        "utf-8"
      );
    }
    await fn(baseDir);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function newRepository(database = new InMemoryStateDatabase()): DepartmentStateRepository {
  return new DepartmentStateRepository(database);
}

function action(actionId: string, status: string, updatedAt: string): Record<string, unknown> {
  return {
    actionId,
    status,
    title: `Accion ${actionId}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt,
  };
}

function decision(recommendationId: string, action: string, reason: string): RecordDecisionInput {
  return {
    decisionId: `dept-1#decision-${recommendationId}-2026-08-16T09:32:20.630Z`,
    departmentRunId: "dept-2026-08-15T175321Z",
    proposalNumber: 1,
    recommendationId,
    changeId: null,
    recommendationTitle: "Publicar landings de taquillas",
    action,
    rejectionReason: reason,
    overrides: {},
    target: "staging",
    decidedBy: "pau",
    decidedAt: "2026-08-16T09:32:20.630Z",
    executionStatus: null,
    executionDetail: "",
  };
}

export function runMongoStateMigrationTests(): TestCase[] {
  return [
    {
      name: "el dry-run cuenta lo que habria que migrar y NO escribe absolutamente nada",
      fn: async () => {
        await withDataDir(
          {
            "action-backlog.jsonl": [
              action("a-1", "pending", "2026-08-10T00:00:00.000Z"),
              action("a-2", "done", "2026-08-11T00:00:00.000Z"),
            ],
            "department-human-decisions.jsonl": [decision("dept-1#rec-1", "reject", "faltan fotos")],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "dry-run", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            const backlog = report.files.find((f) => f.file === "action-backlog.jsonl");
            assert.equal(backlog?.linesRead, 2);
            assert.equal(backlog?.distinctIds, 2);
            assert.equal(backlog?.inserted, 0, "un dry-run no inserta");
            assert.equal(report.decisions.distinctDecisionKeys, 1);

            assert.equal(await repository.entities.countAll(), 0, "la base sigue vacia");
            assert.equal(await repository.decisions.count(), 0);
          }
        );
      },
    },
    {
      name: "K: la migracion conserva los ids que ya tenian significado",
      fn: async () => {
        await withDataDir(
          {
            "action-backlog.jsonl": [action("seo-2026-08-01-taquillas", "pending", "2026-08-10T00:00:00.000Z")],
            "change-packs.jsonl": [
              {
                changePackId: "cp-taquillas-melamina",
                status: "ready",
                createdAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-10T00:00:00.000Z",
              },
            ],
            "department-events.jsonl": [
              {
                eventId: "evt-abc-123",
                departmentRunId: "dept-2026-08-10T090000Z",
                createdAt: "2026-08-10T09:05:00.000Z",
                summary: "seo-watcher ha terminado",
              },
            ],
            "department-human-decisions.jsonl": [decision("dept-1#rec-1", "approve", "")],
          },
          async (dataDir) => {
            const repository = newRepository();
            await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            assert.ok(
              await repository.entities.getEntity("action", "seo-2026-08-01-taquillas"),
              "el actionId original se conserva tal cual"
            );
            assert.ok(await repository.entities.getEntity("change_pack", "cp-taquillas-melamina"));
            assert.ok(await repository.events.getEvent("department_event", "evt-abc-123"));

            const decisions = await repository.decisions.listAll();
            assert.equal(decisions[0].recommendationId, "dept-1#rec-1");
          }
        );
      },
    },
    {
      name: "L: ejecutar la migracion DOS veces deja exactamente el mismo estado",
      fn: async () => {
        await withDataDir(
          {
            "action-backlog.jsonl": [
              action("a-1", "pending", "2026-08-10T00:00:00.000Z"),
              action("a-2", "done", "2026-08-11T00:00:00.000Z"),
            ],
            "department-events.jsonl": [
              { eventId: "evt-1", createdAt: "2026-08-10T09:00:00.000Z", summary: "x" },
              { eventId: "evt-2", createdAt: "2026-08-10T09:01:00.000Z", summary: "y" },
            ],
            "department-human-decisions.jsonl": [
              decision("dept-1#rec-1", "reject", "faltan fotos"),
              decision("dept-1#rec-2", "approve", ""),
            ],
          },
          async (dataDir) => {
            const database = new InMemoryStateDatabase();
            const options = {
              dataDir,
              mode: "apply" as const,
              migrationRunId: "m-1",
              now: "2026-08-17T09:00:00.000Z",
            };

            const first = await migrateStateToMongo(options, newRepository(database));
            const second = await migrateStateToMongo(
              { ...options, migrationRunId: "m-2" },
              newRepository(database)
            );

            const repository = newRepository(database);
            assert.equal(await repository.entities.countByKind("action"), 2);
            assert.equal(await repository.events.countByKind("department_event"), 2);
            assert.equal(await repository.decisions.count(), 2);

            assert.equal(first.totals.entitiesWritten, 2);
            assert.equal(
              second.totals.entitiesWritten,
              0,
              "la segunda pasada no escribe nada nuevo: todo estaba ya"
            );
            assert.ok(
              second.totals.duplicatesPrevented >= 4,
              "la segunda pasada demuestra que los duplicados se estan impidiendo"
            );
          }
        );
      },
    },
    {
      name: "de varias versiones de la misma entidad gana la MAS NUEVA",
      fn: async () => {
        await withDataDir(
          {
            "action-backlog.jsonl": [
              action("a-1", "pending", "2026-08-10T00:00:00.000Z"),
              action("a-1", "in_progress", "2026-08-11T00:00:00.000Z"),
              action("a-1", "done", "2026-08-12T00:00:00.000Z"),
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            const backlog = report.files.find((f) => f.file === "action-backlog.jsonl");
            assert.equal(backlog?.linesRead, 3, "se leen las tres lineas");
            assert.equal(backlog?.distinctIds, 1, "pero son UNA entidad, no tres");

            const stored = await repository.entities.getEntity("action", "a-1");
            assert.equal(stored?.status, "done", "la ultima linea con ese id es el estado vigente");
          },
        );
      },
    },
    {
      name: "las lineas fuera de orden no invierten el estado",
      fn: async () => {
        await withDataDir(
          {
            "action-backlog.jsonl": [
              action("a-1", "done", "2026-08-12T00:00:00.000Z"),
              action("a-1", "pending", "2026-08-10T00:00:00.000Z"),
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );
            assert.equal((await repository.entities.getEntity("action", "a-1"))?.status, "done");
          }
        );
      },
    },
    {
      name: "dos versiones con el MISMO updatedAt las desempata el orden de linea, como hoy",
      fn: async () => {
        // Caso real del historico: una `approval-request` se crea y se
        // auto-aprueba dentro del mismo milisegundo, asi que las dos
        // lineas comparten `updatedAt`. El fichero es append-only, luego
        // la linea posterior es el estado vigente — que es justo lo que ya
        // devuelven hoy los lectores del sistema.
        await withDataDir(
          {
            "approval-requests.jsonl": [
              {
                approvalRequestId: "req-1",
                status: "pending",
                answer: null,
                createdAt: "2026-08-10T12:48:10.785Z",
                updatedAt: "2026-08-10T12:48:10.785Z",
              },
              {
                approvalRequestId: "req-1",
                status: "approved",
                answer: "approved",
                createdAt: "2026-08-10T12:48:10.785Z",
                updatedAt: "2026-08-10T12:48:10.785Z",
              },
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            assert.equal(report.aborted, false, "esto NO es ambiguo: hay desempate real");
            assert.equal(report.totals.tiesResolvedByLineOrder, 1, "pero se cuenta y se reporta");

            const stored = await repository.entities.getEntity("approval_request", "req-1");
            assert.equal(stored?.status, "approved", "gana la linea posterior");
          }
        );
      },
    },
    {
      name: "un EVENTO repetido con contenido distinto si aborta: es inmutable, no hay desempate",
      fn: async () => {
        await withDataDir(
          {
            "action-audit.jsonl": [
              { auditId: "au-1", actionId: "a-1", changedAt: "2026-08-10T09:00:00.000Z", to: "done" },
              { auditId: "au-1", actionId: "a-1", changedAt: "2026-08-10T09:00:00.000Z", to: "cancelled" },
            ],
          },
          async (dataDir) => {
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              newRepository()
            );
            assert.equal(report.aborted, true);
            assert.equal(report.totals.collisions, 1);
          }
        );
      },
    },
    {
      name: "una colision ambigua ABORTA la migracion sin escribir NADA, ni lo que si estaba claro",
      fn: async () => {
        await withDataDir(
          {
            // Esta entidad es perfectamente migrable...
            "action-backlog.jsonl": [action("a-1", "done", "2026-08-12T00:00:00.000Z")],
            // ...pero este evento inmutable esta duplicado con contenido
            // distinto, y eso no tiene desempate posible.
            "department-events.jsonl": [
              { eventId: "evt-1", createdAt: "2026-08-10T09:00:00.000Z", summary: "una cosa" },
              { eventId: "evt-1", createdAt: "2026-08-10T09:00:00.000Z", summary: "otra cosa" },
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            assert.equal(report.aborted, true);
            assert.match(report.abortReason, /colision/i);
            assert.equal(
              await repository.entities.countAll(),
              0,
              "abortar significa NO escribir nada, ni siquiera la entidad que si estaba clara"
            );
            assert.match(renderMigrationReport(report), /ABORTADA/);
          }
        );
      },
    },
    {
      name: "un evento repetido con contenido distinto tambien es una colision",
      fn: async () => {
        await withDataDir(
          {
            "department-events.jsonl": [
              { eventId: "evt-1", createdAt: "2026-08-10T09:00:00.000Z", summary: "una cosa" },
              { eventId: "evt-1", createdAt: "2026-08-10T09:00:00.000Z", summary: "otra cosa" },
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );
            assert.equal(report.aborted, true);
            assert.equal(report.totals.collisions, 1);
          }
        );
      },
    },
    {
      name: "un evento repetido IDENTICO no es colision: es una repeticion inofensiva",
      fn: async () => {
        await withDataDir(
          {
            "department-events.jsonl": [
              { eventId: "evt-1", createdAt: "2026-08-10T09:00:00.000Z", summary: "igual" },
              { eventId: "evt-1", createdAt: "2026-08-10T09:00:00.000Z", summary: "igual" },
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );
            assert.equal(report.aborted, false);
            assert.equal(await repository.events.countByKind("department_event"), 1);
          }
        );
      },
    },
    {
      name: "la misma decision registrada dos veces se colapsa en una",
      fn: async () => {
        await withDataDir(
          {
            // Mismo contenido, `decisionId` distinto porque lleva el
            // instante dentro: es el bug real de `buildDecisionId`.
            "department-human-decisions.jsonl": [
              { ...decision("dept-1#rec-1", "reject", "faltan fotos"), decisionId: "d-1" },
              { ...decision("dept-1#rec-1", "reject", "faltan fotos"), decisionId: "d-2" },
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            assert.equal(report.decisions.linesRead, 2);
            assert.equal(report.decisions.distinctDecisionKeys, 1);
            assert.equal(report.decisions.duplicateKeysCollapsed, 1);
            assert.equal(await repository.decisions.count(), 1);
          }
        );
      },
    },
    {
      name: "dos rechazos de la misma recomendacion con motivos DISTINTOS son dos decisiones",
      fn: async () => {
        await withDataDir(
          {
            "department-human-decisions.jsonl": [
              decision("dept-1#rec-1", "reject", "faltan fotos"),
              decision("dept-1#rec-1", "reject", "y ademas el precio no se ve"),
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );
            const stored = await repository.decisions.listAll();
            assert.equal(stored.length, 2, "cada motivo humano distinto es una decision distinta");
          }
        );
      },
    },
    {
      name: "una linea corrupta se reporta y, en apply estricto, impide escribir",
      fn: async () => {
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "zentry-mongo-corrupt-"));
        try {
          fs.writeFileSync(
            path.join(baseDir, "action-backlog.jsonl"),
            `${JSON.stringify(action("a-1", "done", "2026-08-12T00:00:00.000Z"))}\nesto no es json\n`,
            "utf-8"
          );
          const repository = newRepository();
          const report = await migrateStateToMongo(
            { dataDir: baseDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
            repository
          );
          assert.equal(report.aborted, true);
          assert.equal(report.totals.parseErrors, 1);
          assert.equal(await repository.entities.countAll(), 0);

          const relaxed = await migrateStateToMongo(
            {
              dataDir: baseDir,
              mode: "apply",
              migrationRunId: "m-2",
              now: "2026-08-17T09:00:00.000Z",
              strictParseErrors: false,
            },
            newRepository()
          );
          assert.equal(relaxed.aborted, false, "con --allow-parse-errors se migra lo bueno");
        } finally {
          fs.rmSync(baseDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: "un registro sin identidad estable se cuenta aparte y no se inventa un id",
      fn: async () => {
        await withDataDir(
          {
            "action-backlog.jsonl": [
              action("a-1", "done", "2026-08-12T00:00:00.000Z"),
              { status: "pending", updatedAt: "2026-08-12T00:00:00.000Z" },
            ],
          },
          async (dataDir) => {
            const descriptor = findDescriptorByFile("action-backlog.jsonl");
            assert.ok(descriptor);
            const plan = await planFileMigration(descriptor!, path.join(dataDir, "action-backlog.jsonl"));
            assert.equal(plan.skippedWithoutId, 1);
            assert.equal(plan.winners.size, 1);
          }
        );
      },
    },
    {
      name: "la migracion NO toca los .jsonl originales",
      fn: async () => {
        await withDataDir(
          { "action-backlog.jsonl": [action("a-1", "done", "2026-08-12T00:00:00.000Z")] },
          async (dataDir) => {
            const file = path.join(dataDir, "action-backlog.jsonl");
            const before = fs.readFileSync(file, "utf-8");
            await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              newRepository()
            );
            assert.equal(fs.readFileSync(file, "utf-8"), before, "el historico original es intocable");
          }
        );
      },
    },
    {
      name: "solo se migran las clases A y B: lo derivado y los artifacts se quedan fuera",
      fn: async () => {
        await withDataDir(
          {
            "action-backlog.jsonl": [action("a-1", "done", "2026-08-12T00:00:00.000Z")],
            // Clase C: derivado, no se migra.
            "seo-clusters.jsonl": [
              { clusterId: "c-1", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            const report = await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            assert.ok(report.files.some((f) => f.file === "action-backlog.jsonl"));
            assert.ok(
              !report.files.some((f) => f.file === "seo-clusters.jsonl"),
              "un derivado recalculable no entra en la fuente de verdad"
            );
            assert.equal(await repository.entities.countByKind("seo_cluster"), 0);
          }
        );
      },
    },
    {
      name: "ningun fichero de clase C o D esta en el conjunto que se migra",
      fn: () => {
        const migrated = ENTITY_REGISTRY.filter((d) => d.stateClass === "A" || d.stateClass === "B");
        const notMigrated = ENTITY_REGISTRY.filter((d) => d.stateClass === "C" || d.stateClass === "D");
        assert.ok(migrated.length >= 15);
        assert.ok(notMigrated.length >= 5);
        for (const descriptor of notMigrated) {
          assert.ok(
            descriptor.rationale.trim().length > 20,
            `${descriptor.file} se excluye sin explicar por que`
          );
        }
      },
    },
    {
      name: "la verificacion de equivalencia compara SEMANTICA, no lineas ni bytes",
      fn: async () => {
        await withDataDir(
          {
            // 3 lineas, 1 sola entidad viva: comparar lineas daria un falso negativo.
            "action-backlog.jsonl": [
              action("a-1", "pending", "2026-08-10T00:00:00.000Z"),
              action("a-1", "in_progress", "2026-08-11T00:00:00.000Z"),
              action("a-1", "done", "2026-08-12T00:00:00.000Z"),
            ],
            "department-human-decisions.jsonl": [decision("dept-1#rec-1", "approve", "")],
          },
          async (dataDir) => {
            const repository = newRepository();
            await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );

            const report = await verifyLegacyEquivalence(dataDir, repository, "2026-08-17T10:00:00.000Z");
            assert.equal(report.equivalent, true);
            assert.equal(report.decisionsLegacy, 1);
            assert.equal(report.decisionsMongo, 1);
            const row = report.checked.find((c) => c.kind === "action");
            assert.equal(row?.legacyCount, 1, "3 lineas son 1 entidad");
            assert.equal(row?.mongoCount, 1);
          }
        );
      },
    },
    {
      name: "la verificacion detecta que a MongoDB le falta una decision humana",
      fn: async () => {
        await withDataDir(
          {
            "department-human-decisions.jsonl": [
              decision("dept-1#rec-1", "reject", "faltan fotos"),
              decision("dept-1#rec-2", "reject", "y el precio"),
            ],
          },
          async (dataDir) => {
            const repository = newRepository();
            // Se migra solo una a proposito.
            await repository.decisions.recordDecision(decision("dept-1#rec-1", "reject", "faltan fotos"));

            const report = await verifyLegacyEquivalence(dataDir, repository, "2026-08-17T10:00:00.000Z");
            assert.equal(report.equivalent, false);
            assert.equal(report.findings[0].kind, "human_decision");
            assert.match(report.findings[0].detail, /no se puede reconstruir/i);
          }
        );
      },
    },
    {
      name: "que MongoDB tenga MAS que el fichero no es una divergencia: es el modo shadow funcionando",
      fn: async () => {
        await withDataDir(
          { "action-backlog.jsonl": [action("a-1", "done", "2026-08-12T00:00:00.000Z")] },
          async (dataDir) => {
            const repository = newRepository();
            await migrateStateToMongo(
              { dataDir, mode: "apply", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              repository
            );
            await repository.entities.saveEntity({
              kind: "action",
              entityId: "a-nueva-de-hoy",
              recordUpdatedAt: "2026-08-17T09:00:00.000Z",
              payload: {},
            });

            const report = await verifyLegacyEquivalence(dataDir, repository, "2026-08-17T10:00:00.000Z");
            assert.equal(report.equivalent, true);
          }
        );
      },
    },
    {
      name: "un data/ vacio no rompe la migracion",
      fn: async () => {
        await withDataDir({}, async (dataDir) => {
          const report = await migrateStateToMongo(
            { dataDir, mode: "dry-run", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
            newRepository()
          );
          assert.equal(report.aborted, false);
          assert.equal(report.totals.recordsRead, 0);
        });
      },
    },
    {
      name: "el informe de migracion no contiene rutas absolutas de la maquina",
      fn: async () => {
        await withDataDir(
          { "action-backlog.jsonl": [action("a-1", "done", "2026-08-12T00:00:00.000Z")] },
          async (dataDir) => {
            const report = await migrateStateToMongo(
              { dataDir, mode: "dry-run", migrationRunId: "m-1", now: "2026-08-17T09:00:00.000Z" },
              newRepository()
            );
            const rendered = renderMigrationReport(report);
            assert.doesNotMatch(rendered, /\/tmp\//, "el informe no filtra rutas del sistema");
            assert.equal(report.dataDirName, path.basename(dataDir));
          }
        );
      },
    },
  ];
}
