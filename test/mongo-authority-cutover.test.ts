import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { InMemoryStateDatabase } from "../src/persistence/in-memory-collection";
import { DepartmentStateRepository, RecordDecisionInput } from "../src/persistence/repositories";
import {
  loadPreviousHumanFeedbackFromState,
  readPreviousHumanFeedbackFrom,
  toStateHumanFeedback,
} from "../src/approvals/manual/state-decision-reader";
import { renderPreviousHumanFeedback } from "../src/approvals/human-feedback-context";
import { readHumanDecisions } from "../src/approvals/manual/decision-store";
import { hydrateStateFromMongo } from "../src/persistence/hydration";
import { buildSubjectKey } from "../src/persistence/decision-identity";
import {
  loadPreviousRunSummaryFromState,
  recordRunBriefSummary,
} from "../src/persistence/run-continuity";

/**
 * Fase O57 — tests del CUTOVER: MongoDB como fuente de verdad.
 *
 * Los tests de la fase anterior demostraban que el estado LLEGA a
 * MongoDB. Estos demuestran lo contrario y mas dificil: que el estado
 * con el que razona el departamento SALE de MongoDB, y que cuando
 * MongoDB no esta, el departamento se para en vez de seguir con datos
 * viejos fingiendo que todo va bien.
 *
 * La letra de cada test es la del brief de la fase (A..L).
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

function newRepository(): DepartmentStateRepository {
  return new DepartmentStateRepository(new InMemoryStateDatabase());
}

/** Carpeta temporal aislada; se limpia pase lo que pase. */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentry-authority-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

interface DecisionOverrides {
  runId?: string;
  recommendationId?: string;
  title?: string;
  action?: string;
  reason?: string;
  decidedAt?: string;
  target?: string;
}

function decision(overrides: DecisionOverrides = {}): RecordDecisionInput {
  const runId = overrides.runId ?? "dept-2026-08-15T175321Z";
  const recommendationId = overrides.recommendationId ?? `${runId}#rec-1`;
  const decidedAt = overrides.decidedAt ?? "2026-08-16T09:32:20.630Z";
  return {
    decisionId: `${runId}#decision-${recommendationId.split("#").pop()}-${decidedAt}`,
    departmentRunId: runId,
    proposalNumber: 1,
    recommendationId,
    changeId: null,
    recommendationTitle: overrides.title ?? "Publicar la landing de taquillas de melamina",
    action: overrides.action ?? "approve",
    rejectionReason: overrides.reason ?? "",
    overrides: {},
    target: overrides.target ?? "staging",
    decidedBy: "pau",
    decidedAt,
    executionStatus: null,
    executionDetail: "",
  };
}

/** Escribe un `.jsonl` con las lineas dadas. */
function writeJsonl(filePath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}

export function runMongoAuthorityCutoverTests(): TestCase[] {
  return [
    // ---------------------------------------------------------------
    // A — el feedback humano se lee de MongoDB
    // ---------------------------------------------------------------
    {
      name: "A: el feedback humano se lee de MongoDB, no del fichero",
      fn: async () => {
        const repository = newRepository();
        await repository.decisions.recordDecision(
          decision({ action: "reject", reason: "el H1 es demasiado generico" })
        );

        const feedback = await readPreviousHumanFeedbackFrom(repository);
        assert.equal(feedback.length, 1);
        assert.equal(feedback[0].rejectionReason, "el H1 es demasiado generico");
        assert.equal(feedback[0].action, "reject");
        // La prueba de que viene de MongoDB y no de disco: no se ha
        // creado ninguna carpeta `data/` ni se ha leido ningun fichero.
        assert.equal(feedback[0].departmentRunId, "dept-2026-08-15T175321Z");
      },
    },
    {
      name: "A: el lector de MongoDB recupera las tres acciones, no solo los rechazos",
      fn: async () => {
        const repository = newRepository();
        await repository.decisions.recordDecision(
          decision({ recommendationId: "r#rec-1", action: "approve" })
        );
        await repository.decisions.recordDecision(
          decision({ recommendationId: "r#rec-2", action: "reject", reason: "no cuadra con la marca" })
        );
        await repository.decisions.recordDecision(
          decision({ recommendationId: "r#rec-3", action: "defer" })
        );

        const feedback = await readPreviousHumanFeedbackFrom(repository);
        const actions = feedback.map((entry) => entry.action).sort();
        assert.deepEqual(actions, ["approve", "defer", "reject"]);
        // El lector legacy de fichero se queda SOLO con el rechazo con
        // motivo: aqui esta la diferencia que motiva esta fase.
        assert.equal(feedback.length, 3);
      },
    },

    // ---------------------------------------------------------------
    // B — una aprobacion del Run A se ve en el Run B
    // ---------------------------------------------------------------
    {
      name: "B: una aprobacion tomada en el Run A llega al prompt del Run B",
      fn: async () => {
        const repository = newRepository();

        // --- Run A: la pasada ocurre y una persona aprueba.
        await repository.runs.startRun({
          departmentRunId: "dept-A",
          startedAt: "2026-08-15T10:00:00.000Z",
          runKind: "department-coordination",
        });
        await repository.decisions.recordDecision(
          decision({
            runId: "dept-A",
            recommendationId: "dept-A#rec-1",
            title: "Publicar la landing de taquillas de melamina",
            action: "approve",
          })
        );

        // --- Run B: pasada nueva, proceso nuevo, cero ficheros de por medio.
        const feedback = await readPreviousHumanFeedbackFrom(repository);
        const promptBlock = renderPreviousHumanFeedback(feedback);

        // EVIDENCIA DEL INPUT REAL DEL AGENTE: no basta con que el
        // documento exista en MongoDB — tiene que aparecer en el texto
        // que se le pasa al empleado.
        assert.ok(
          promptBlock.includes("Publicar la landing de taquillas de melamina"),
          "el titulo aprobado tiene que estar en el bloque del prompt"
        );
        assert.ok(promptBlock.includes("aprobada"), "el prompt tiene que decir que fue aprobada");
        assert.ok(promptBlock.includes("dept-A"), "el prompt cita la pasada de origen");
        assert.ok(
          promptBlock.includes("Lo ya APROBADO no hace falta volver a proponerlo"),
          "con aprobaciones el bloque no puede decir que todo fueron rechazos"
        );
      },
    },

    // ---------------------------------------------------------------
    // C — el rechazo conserva el motivo LITERAL
    // ---------------------------------------------------------------
    {
      name: "C: el rechazo conserva el motivo humano literal, sin reescribir",
      fn: async () => {
        const literal = 'El H1 dice "taquillas baratas" y nosotros no competimos por precio.';
        const repository = newRepository();
        await repository.decisions.recordDecision(
          decision({ action: "reject", reason: literal })
        );

        const feedback = await readPreviousHumanFeedbackFrom(repository);
        assert.equal(feedback[0].rejectionReason, literal, "ni una coma distinta");

        const promptBlock = renderPreviousHumanFeedback(feedback);
        assert.ok(promptBlock.includes(literal), "el motivo viaja literal hasta el prompt");
        assert.ok(promptBlock.includes("Motivo textual:"));
      },
    },

    // ---------------------------------------------------------------
    // D — el aplazamiento tambien se recupera
    // ---------------------------------------------------------------
    {
      name: "D: un aplazamiento sin motivo tambien se recupera y se explica",
      fn: async () => {
        const repository = newRepository();
        await repository.decisions.recordDecision(
          decision({ action: "defer", reason: "", title: "Rehacer el menu de Tukandado" })
        );

        const feedback = await readPreviousHumanFeedbackFrom(repository);
        assert.equal(feedback.length, 1, "un defer sin motivo NO se descarta");
        assert.equal(feedback[0].action, "defer");

        const promptBlock = renderPreviousHumanFeedback(feedback);
        assert.ok(promptBlock.includes("aplazada"));
        assert.ok(promptBlock.includes("Sin motivo escrito"));
      },
    },

    // ---------------------------------------------------------------
    // E — continuidad logica por subjectKey
    // ---------------------------------------------------------------
    {
      name: "E: el mismo asunto decidido en otra pasada se reconoce por subjectKey",
      fn: async () => {
        const title = "Resolver el enrutado roto de /cerraduras/";
        const repository = newRepository();

        await repository.decisions.recordDecision(
          decision({ runId: "dept-A", recommendationId: "dept-A#rec-1", title, action: "reject", reason: "todavia no" })
        );
        await repository.decisions.recordDecision(
          decision({
            runId: "dept-B",
            recommendationId: "dept-B#rec-4",
            title,
            action: "approve",
            decidedAt: "2026-08-17T09:00:00.000Z",
          })
        );

        // `recommendationId` NO puede responder a esto: lleva el
        // departmentRunId dentro y nunca se repite entre pasadas.
        assert.notEqual("dept-A#rec-1", "dept-B#rec-4");

        const sameSubject = await repository.decisions.listForSubject(buildSubjectKey(title));
        assert.equal(sameSubject.length, 2, "las dos decisiones son sobre el MISMO asunto");
        assert.deepEqual(
          sameSubject.map((d) => d.departmentRunId),
          ["dept-A", "dept-B"],
          "y se recuperan en orden cronologico"
        );
      },
    },
    {
      name: "E: subjectKey normaliza acentos, mayusculas y puntuacion del mismo titulo",
      fn: () => {
        assert.equal(
          buildSubjectKey("Publicar la LANDING de taquillas de melamina."),
          buildSubjectKey("publicar la landing de taquillas de melamína"),
          "la misma frase escrita distinto es el mismo asunto"
        );
        assert.notEqual(
          buildSubjectKey("Publicar la landing de taquillas"),
          buildSubjectKey("Publicar la landing de cerraduras"),
          "asuntos distintos NO colisionan"
        );
      },
    },

    // ---------------------------------------------------------------
    // F — MongoDB caido: el lector critico falla CERRADO
    // ---------------------------------------------------------------
    {
      name: "F: sin MongoDB en modo mongo, el lector de decisiones falla cerrado",
      fn: async () => {
        // Entorno sin `MONGODB_URI`: es la simulacion no destructiva de
        // "Atlas no esta disponible" que pide el brief.
        await assert.rejects(
          () => loadPreviousHumanFeedbackFromState({ mode: "mongo", env: {} as NodeJS.ProcessEnv }),
          /fuente de verdad/i,
          "tiene que lanzar, NO devolver [] ni caerse al fichero"
        );
      },
    },
    {
      name: "F: el fallo cerrado no se cuela como lista vacia (que pareceria 'no hay feedback')",
      fn: async () => {
        let returned: unknown = "no llego a devolver";
        try {
          returned = await loadPreviousHumanFeedbackFromState({
            mode: "mongo",
            env: {} as NodeJS.ProcessEnv,
          });
        } catch {
          returned = "lanzo";
        }
        assert.equal(returned, "lanzo", "una lista vacia seria indistinguible de 'no hay decisiones'");
      },
    },

    // ---------------------------------------------------------------
    // G — el fichero contradice a MongoDB: gana MongoDB
    // ---------------------------------------------------------------
    {
      name: "G: si el JSONL contradice a MongoDB, gana MongoDB",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          // Fichero con un dato VIEJO y contradictorio: dice que se
          // rechazo, cuando en MongoDB consta aprobada.
          writeJsonl(path.join(dataDir, "department-human-decisions.jsonl"), [
            {
              decisionId: "viejo#decision-rec-1",
              departmentRunId: "dept-VIEJO",
              proposalNumber: 9,
              recommendationId: "dept-VIEJO#rec-1",
              changeId: null,
              recommendationTitle: "Dato viejo del fichero",
              action: "reject",
              rejectionReason: "esto no deberia sobrevivir a la hidratacion",
              overrides: {},
              target: "staging",
              decidedBy: "pau",
              decidedAt: "2026-01-01T00:00:00.000Z",
              executionStatus: null,
              executionDetail: "",
            },
          ]);

          const repository = newRepository();
          await repository.decisions.recordDecision(
            decision({ title: "Dato bueno de MongoDB", action: "approve" })
          );

          await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");

          const onDisk = readHumanDecisions(path.join(dataDir, "department-human-decisions.jsonl"));
          assert.equal(onDisk.length, 1);
          assert.equal(onDisk[0].recommendationTitle, "Dato bueno de MongoDB");
          assert.equal(onDisk[0].action, "approve");
          assert.ok(
            !JSON.stringify(onDisk).includes("esto no deberia sobrevivir"),
            "el dato del fichero que contradecia a MongoDB ya no manda"
          );
        });
      },
    },

    // ---------------------------------------------------------------
    // H — el JSONL no existe: MongoDB funciona igual
    // ---------------------------------------------------------------
    {
      name: "H: sin ningun JSONL, MongoDB reconstruye el estado igualmente",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          assert.equal(
            fs.existsSync(path.join(dataDir, "department-human-decisions.jsonl")),
            false,
            "se parte de una carpeta vacia a proposito"
          );

          const repository = newRepository();
          await repository.decisions.recordDecision(decision({ action: "approve" }));
          await repository.entities.saveEntity({
            kind: "action",
            entityId: "a-1",
            status: "pending",
            recordUpdatedAt: "2026-08-16T00:00:00.000Z",
            payload: { actionId: "a-1", status: "pending", updatedAt: "2026-08-16T00:00:00.000Z" },
          });

          const report = await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");
          assert.equal(report.humanDecisions, 1);

          const onDisk = readHumanDecisions(path.join(dataDir, "department-human-decisions.jsonl"));
          assert.equal(onDisk.length, 1, "el fichero lo crea la hidratacion desde cero");
          assert.equal(onDisk[0].action, "approve");

          const backlog = report.files.find((f) => f.kind === "action");
          assert.equal(backlog?.previousLines, null, "no existia antes");
          assert.equal(backlog?.documents, 1, "y ahora lo llena MongoDB");
        });
      },
    },
    {
      name: "H: la hidratacion NO toca los ficheros derivados ni los artifacts",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          const repository = newRepository();
          const report = await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");
          for (const file of report.notProjected) {
            assert.equal(
              fs.existsSync(path.join(dataDir, file)),
              false,
              `${file} es de clase C/D: MongoDB no es su fuente y no debe escribirlo`
            );
          }
          assert.ok(report.notProjected.length > 0, "hay ficheros clase C/D en el registro");
        });
      },
    },

    // ---------------------------------------------------------------
    // I — persist-state saltado: la pasada siguiente conserva el estado
    // ---------------------------------------------------------------
    {
      name: "I: con persist-state legacy saltado, la pasada siguiente conserva el estado",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          const repository = newRepository();

          // --- Pasada 1: escribe en MongoDB y toma una decision.
          await repository.runs.startRun({
            departmentRunId: "dept-1",
            startedAt: "2026-08-15T10:00:00.000Z",
            runKind: "department-coordination",
          });
          await repository.decisions.recordDecision(
            decision({ runId: "dept-1", recommendationId: "dept-1#rec-1", action: "approve" })
          );
          await repository.entities.saveEntity({
            kind: "action",
            entityId: "a-1",
            status: "in_progress",
            departmentRunId: "dept-1",
            recordUpdatedAt: "2026-08-15T11:00:00.000Z",
            payload: { actionId: "a-1", status: "in_progress", updatedAt: "2026-08-15T11:00:00.000Z" },
          });

          // --- `persist-state` NO ocurre: no se escribe NADA en disco.
          // Se modela con la carpeta vacia, que es exactamente lo que ve
          // un runner limpio cuando el commit de estado no llego.
          assert.equal(fs.readdirSync(dataDir).length, 0, "el legacy no dejo nada");

          // --- Pasada 2: runner limpio, hidrata desde MongoDB.
          await hydrateStateFromMongo(repository, dataDir, "2026-08-16T10:00:00.000Z");
          const feedback = await readPreviousHumanFeedbackFrom(repository);

          assert.equal(feedback.length, 1, "la decision de la pasada 1 sigue ahi");
          assert.equal(await repository.entities.countByKind("action"), 1);
          assert.equal(
            readHumanDecisions(path.join(dataDir, "department-human-decisions.jsonl")).length,
            1,
            "y el runner limpio la tiene tambien en disco tras hidratar"
          );
        });
      },
    },

    // ---------------------------------------------------------------
    // J — dos pasadas concurrentes dejan un estado consistente
    // ---------------------------------------------------------------
    {
      name: "J: dos pasadas concurrentes dejan el estado consistente, sin perder decisiones",
      fn: async () => {
        const repository = newRepository();

        await Promise.all([
          repository.decisions.recordDecision(
            decision({ runId: "dept-A", recommendationId: "dept-A#rec-1", action: "approve" })
          ),
          repository.decisions.recordDecision(
            decision({ runId: "dept-B", recommendationId: "dept-B#rec-1", action: "reject", reason: "no" })
          ),
          repository.runs.startRun({
            departmentRunId: "dept-A",
            startedAt: "2026-08-15T10:00:00.000Z",
            runKind: "department-coordination",
          }),
          repository.runs.startRun({
            departmentRunId: "dept-B",
            startedAt: "2026-08-15T10:00:01.000Z",
            runKind: "department-coordination",
          }),
        ]);

        assert.equal(await repository.decisions.count(), 2, "ninguna decision se pisa a la otra");
        assert.equal(await repository.runs.count(), 2);
      },
    },
    {
      name: "J: dos escrituras concurrentes de la MISMA entidad dejan la mas reciente",
      fn: async () => {
        const repository = newRepository();
        const save = (status: string, at: string) =>
          repository.entities.saveEntity({
            kind: "action",
            entityId: "a-1",
            status,
            recordUpdatedAt: at,
            payload: { actionId: "a-1", status, updatedAt: at },
          });

        await Promise.all([
          save("done", "2026-08-16T00:00:00.000Z"),
          save("pending", "2026-08-15T00:00:00.000Z"),
        ]);

        const stored = await repository.entities.getEntity("action", "a-1");
        assert.equal(stored?.status, "done", "la version vieja no puede revertir la nueva");
        assert.equal(await repository.entities.countByKind("action"), 1, "y no hay duplicado");
      },
    },

    // ---------------------------------------------------------------
    // K — relanzar no duplica
    // ---------------------------------------------------------------
    {
      name: "K: relanzar la misma pasada no duplica decisiones ni eventos",
      fn: async () => {
        const repository = newRepository();
        const input = decision({ action: "approve" });

        const first = await repository.decisions.recordDecision(input);
        const second = await repository.decisions.recordDecision(input);

        assert.equal(first.result, "inserted");
        assert.equal(second.result, "duplicate_prevented", "el rerun no escribe otra vez");
        assert.equal(await repository.decisions.count(), 1);

        const event = {
          kind: "department_event",
          eventId: "evt-1",
          occurredAt: "2026-08-16T00:00:00.000Z",
          payload: { eventId: "evt-1" },
        };
        await repository.events.appendEvent(event);
        await repository.events.appendEvent(event);
        assert.equal(await repository.events.countByKind("department_event"), 1);
      },
    },
    {
      name: "K: hidratar dos veces produce exactamente el mismo fichero",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          const repository = newRepository();
          await repository.decisions.recordDecision(
            decision({ recommendationId: "r#rec-1", action: "approve" })
          );
          await repository.decisions.recordDecision(
            decision({ recommendationId: "r#rec-2", action: "reject", reason: "no" })
          );

          const file = path.join(dataDir, "department-human-decisions.jsonl");
          await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");
          const once = fs.readFileSync(file, "utf-8");
          await hydrateStateFromMongo(repository, dataDir, "2026-08-17T13:00:00.000Z");
          const twice = fs.readFileSync(file, "utf-8");

          assert.equal(twice, once, "la proyeccion es determinista, no depende del cursor ni del reloj");
        });
      },
    },

    // ---------------------------------------------------------------
    // L — tres pasadas consecutivas mantienen la continuidad
    // ---------------------------------------------------------------
    {
      name: "L: tres pasadas consecutivas acumulan estado sin perder ni duplicar",
      fn: async () => {
        await withTempDir(async (baseDir) => {
          const repository = newRepository();
          const runIds = ["dept-1", "dept-2", "dept-3"];

          for (let index = 0; index < runIds.length; index++) {
            const runId = runIds[index];
            // Cada pasada corre en un runner LIMPIO: carpeta nueva, sin
            // nada heredado del disco de la anterior.
            const dataDir = path.join(baseDir, `runner-${index}`);
            fs.mkdirSync(dataDir, { recursive: true });

            // 1. Hidrata desde MongoDB.
            await hydrateStateFromMongo(repository, dataDir, `2026-08-1${index + 5}T09:00:00.000Z`);

            // 2. Lee el estado previo: tiene que ver TODO lo anterior.
            const feedbackBefore = await readPreviousHumanFeedbackFrom(repository);
            assert.equal(
              feedbackBefore.length,
              index,
              `la pasada ${index + 1} tiene que ver las ${index} decision(es) anteriores`
            );

            // 3. La pasada ocurre y deja su propia decision.
            await repository.runs.startRun({
              departmentRunId: runId,
              startedAt: `2026-08-1${index + 5}T09:00:00.000Z`,
              runKind: "department-coordination",
            });
            await repository.decisions.recordDecision(
              decision({
                runId,
                recommendationId: `${runId}#rec-1`,
                title: `Asunto de la pasada ${index + 1}`,
                action: "approve",
                decidedAt: `2026-08-1${index + 5}T10:00:00.000Z`,
              })
            );
            await repository.runs.finishRun({
              departmentRunId: runId,
              runKind: "department-coordination",
              startedAt: `2026-08-1${index + 5}T09:00:00.000Z`,
              finishedAt: `2026-08-1${index + 5}T11:00:00.000Z`,
              status: "succeeded",
            });
          }

          assert.equal(await repository.runs.count(), 3);
          assert.equal(await repository.decisions.count(), 3, "3 decisiones, ni una mas ni una menos");

          const finalFeedback = await readPreviousHumanFeedbackFrom(repository);
          assert.equal(finalFeedback.length, 3);
          const promptBlock = renderPreviousHumanFeedback(finalFeedback);
          for (let index = 0; index < 3; index++) {
            assert.ok(
              promptBlock.includes(`Asunto de la pasada ${index + 1}`),
              `la pasada 4 recibiria en su prompt el asunto de la pasada ${index + 1}`
            );
          }
        });
      },
    },
    {
      name: "L: el orden de las entradas es determinista entre ejecuciones",
      fn: async () => {
        const repository = newRepository();
        for (const suffix of ["c", "a", "b"]) {
          await repository.decisions.recordDecision(
            decision({ recommendationId: `r#rec-${suffix}`, action: "approve" })
          );
        }
        const first = await readPreviousHumanFeedbackFrom(repository);
        const second = await readPreviousHumanFeedbackFrom(repository);
        assert.deepEqual(
          second.map((e) => e.recommendationId),
          first.map((e) => e.recommendationId)
        );
        assert.deepEqual(
          first.map((e) => e.recommendationId),
          ["r#rec-a", "r#rec-b", "r#rec-c"],
          "orden alfabetico por recomendacion: dos ejecuciones dan el mismo prompt"
        );
      },
    },

    // ---------------------------------------------------------------
    // La proyeccion colapsa versiones, NO pierde informacion
    // ---------------------------------------------------------------
    {
      name: "la proyeccion deja una linea por entidad (clase A) y todas las lineas (clase B)",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          const repository = newRepository();

          // Clase A: tres versiones de la MISMA accion. En el historico
          // append-only son tres lineas; el estado actual es una.
          for (const [status, at] of [
            ["pending", "2026-08-10T00:00:00.000Z"],
            ["in_progress", "2026-08-11T00:00:00.000Z"],
            ["done", "2026-08-12T00:00:00.000Z"],
          ]) {
            await repository.entities.saveEntity({
              kind: "action",
              entityId: "a-1",
              status,
              recordUpdatedAt: at,
              payload: { actionId: "a-1", status, updatedAt: at },
            });
          }

          // Clase B: tres eventos DISTINTOS. Ninguno sustituye a otro.
          for (const n of [1, 2, 3]) {
            await repository.events.appendEvent({
              kind: "department_event",
              eventId: `evt-${n}`,
              occurredAt: `2026-08-1${n}T00:00:00.000Z`,
              payload: { eventId: `evt-${n}` },
            });
          }

          const report = await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");

          assert.equal(
            report.files.find((f) => f.kind === "action")?.documents,
            1,
            "las tres versiones de la misma accion colapsan en su estado actual"
          );
          assert.equal(
            report.files.find((f) => f.kind === "department_event")?.documents,
            3,
            "los eventos NO colapsan: cada uno es un hecho distinto"
          );

          // La version que sobrevive es la ultima, no una cualquiera.
          const projected = fs
            .readFileSync(path.join(dataDir, "action-backlog.jsonl"), "utf-8")
            .trim();
          assert.ok(projected.includes('"status":"done"'));
          assert.ok(!projected.includes('"status":"pending"'));
        });
      },
    },

    // ---------------------------------------------------------------
    // La proyeccion nunca vacia un fichero que tenia contenido
    // ---------------------------------------------------------------
    {
      name: "si MongoDB no tiene un tipo pero el fichero si, NO se sobrescribe con vacio",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          const filePath = path.join(dataDir, "action-backlog.jsonl");
          writeJsonl(filePath, [
            { actionId: "a-1", status: "pending", updatedAt: "2026-08-10T00:00:00.000Z" },
            { actionId: "a-2", status: "done", updatedAt: "2026-08-11T00:00:00.000Z" },
          ]);

          // MongoDB vacio: simula un tipo que no se llego a migrar.
          const repository = newRepository();
          const report = await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");

          assert.ok(
            report.skipped.some((entry) => entry.startsWith("action-backlog.jsonl")),
            "se avisa del tipo que falta en MongoDB"
          );
          const after = fs.readFileSync(filePath, "utf-8");
          assert.ok(after.includes("a-1") && after.includes("a-2"), "el fichero conserva sus lineas");
        });
      },
    },
    {
      name: "si MongoDB no tiene decisiones humanas pero el fichero si, la hidratacion FALLA",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          writeJsonl(path.join(dataDir, "department-human-decisions.jsonl"), [
            { decisionId: "d-1", action: "approve", recommendationId: "r-1", decidedAt: "2026-08-16T00:00:00.000Z" },
          ]);
          const repository = newRepository();
          await assert.rejects(
            () => hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z"),
            /decision humana|decisiones humanas/i,
            "no se vacia el unico dato que no se puede reconstruir"
          );
          assert.equal(
            readHumanDecisions(path.join(dataDir, "department-human-decisions.jsonl")).length,
            1,
            "y el fichero sigue intacto"
          );
        });
      },
    },
    {
      name: "un fichero que NO existia y que MongoDB tampoco tiene no genera aviso",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          const repository = newRepository();
          const report = await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");
          assert.deepEqual(report.skipped, [], "no hay nada que proteger si no habia nada");
        });
      },
    },

    // ---------------------------------------------------------------
    // La prueba sin legacy: borrar y reconstruir desde MongoDB
    // ---------------------------------------------------------------
    {
      name: "purgeFirst borra los ficheros de MongoDB y los reconstruye desde cero",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          // Fichero previo con contenido que NO esta en MongoDB. Si
          // sobreviviera, la pasada estaria leyendo estado de origen
          // desconocido y la prueba no demostraria nada.
          writeJsonl(path.join(dataDir, "action-backlog.jsonl"), [
            { actionId: "fantasma", status: "pending", updatedAt: "2026-01-01T00:00:00.000Z" },
          ]);

          const repository = newRepository();
          await repository.entities.saveEntity({
            kind: "action",
            entityId: "a-real",
            status: "pending",
            recordUpdatedAt: "2026-08-16T00:00:00.000Z",
            payload: { actionId: "a-real", status: "pending", updatedAt: "2026-08-16T00:00:00.000Z" },
          });
          await repository.decisions.recordDecision(decision({ action: "approve" }));

          const report = await hydrateStateFromMongo(
            repository,
            dataDir,
            "2026-08-17T12:00:00.000Z",
            { purgeFirst: true }
          );

          assert.ok(report.purged.includes("action-backlog.jsonl"), "el fichero previo se borro");
          const projected = fs.readFileSync(path.join(dataDir, "action-backlog.jsonl"), "utf-8");
          assert.ok(projected.includes("a-real"), "lo que queda viene de MongoDB");
          assert.ok(!projected.includes("fantasma"), "el contenido previo no sobrevive");
          assert.equal(
            readHumanDecisions(path.join(dataDir, "department-human-decisions.jsonl")).length,
            1,
            "las decisiones humanas se reconstruyen igualmente"
          );
        });
      },
    },
    {
      name: "purgeFirst NO toca los ficheros de clase C: MongoDB no es su fuente",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          // `seo-clusters.jsonl` es clase C. Borrarlo si seria perder datos.
          const derived = path.join(dataDir, "seo-clusters.jsonl");
          writeJsonl(derived, [{ clusterId: "c-1" }]);

          const repository = newRepository();
          const report = await hydrateStateFromMongo(
            repository,
            dataDir,
            "2026-08-17T12:00:00.000Z",
            { purgeFirst: true }
          );

          assert.ok(fs.existsSync(derived), "el derivado sigue ahi");
          assert.ok(fs.readFileSync(derived, "utf-8").includes("c-1"), "y con su contenido intacto");
          assert.ok(!report.purged.includes("seo-clusters.jsonl"));
        });
      },
    },
    {
      name: "sin purgeFirst no se borra nada (el comportamiento por defecto no destruye)",
      fn: async () => {
        await withTempDir(async (dataDir) => {
          writeJsonl(path.join(dataDir, "seo-clusters.jsonl"), [{ clusterId: "c-1" }]);
          const repository = newRepository();
          const report = await hydrateStateFromMongo(repository, dataDir, "2026-08-17T12:00:00.000Z");
          assert.deepEqual(report.purged, []);
          assert.ok(fs.existsSync(path.join(dataDir, "seo-clusters.jsonl")));
        });
      },
    },

    // ---------------------------------------------------------------
    // Continuidad del brief sin `reports/` (criterio 6)
    // ---------------------------------------------------------------
    {
      name: "la pasada siguiente lee el resumen de la anterior desde MongoDB, sin reports/",
      fn: async () => {
        const repository = newRepository();
        await repository.runs.startRun({
          departmentRunId: "dept-1",
          runKind: "coordinated",
          startedAt: "2026-08-15T09:00:00.000Z",
        });
        await recordRunBriefSummary(
          {
            departmentRunId: "dept-1",
            priorityCount: 4,
            departmentQaStatus: "PASS_WITH_WARNINGS",
            executedStages: 5,
          },
          "2026-08-15T11:00:00.000Z",
          { mode: "mongo", repository }
        );

        const previous = await loadPreviousRunSummaryFromState("dept-2", { mode: "mongo", repository });
        assert.equal(previous?.departmentRunId, "dept-1");
        assert.equal(previous?.priorityCount, 4);
        assert.equal(previous?.departmentQaStatus, "PASS_WITH_WARNINGS");
        assert.equal(previous?.executedStages, 5);
      },
    },
    {
      name: "cerrar la pasada NO borra el resumen que dejo la fase del brief",
      fn: async () => {
        const repository = newRepository();
        await repository.runs.startRun({
          departmentRunId: "dept-1",
          runKind: "coordinated",
          startedAt: "2026-08-15T09:00:00.000Z",
        });
        await recordRunBriefSummary(
          { departmentRunId: "dept-1", priorityCount: 2, departmentQaStatus: "PASS", executedStages: 6 },
          "2026-08-15T11:00:00.000Z",
          { mode: "mongo", repository }
        );
        await repository.runs.finishRun({
          departmentRunId: "dept-1",
          runKind: "coordinated",
          startedAt: "2026-08-15T09:00:00.000Z",
          finishedAt: "2026-08-15T12:00:00.000Z",
          status: "succeeded",
        });

        const previous = await loadPreviousRunSummaryFromState("dept-2", { mode: "mongo", repository });
        assert.equal(previous?.priorityCount, 2, "el cierre de la pasada no puede perder el resumen");
        assert.equal((await repository.runs.getRun("dept-1"))?.status, "succeeded");
      },
    },
    {
      name: "sin pasada anterior, la continuidad devuelve null (arranque en frio, no fallo)",
      fn: async () => {
        const repository = newRepository();
        const previous = await loadPreviousRunSummaryFromState("dept-1", { mode: "mongo", repository });
        assert.equal(previous, null);
      },
    },
    {
      name: "F: la continuidad entre pasadas tambien falla cerrada sin MongoDB",
      fn: async () => {
        await assert.rejects(
          () => loadPreviousRunSummaryFromState("dept-2", { mode: "mongo", env: {} as NodeJS.ProcessEnv }),
          /fuente de verdad/i
        );
      },
    },

    // ---------------------------------------------------------------
    // Regresiones del mapeo (no relajan nada de lo anterior)
    // ---------------------------------------------------------------
    {
      name: "el mapeo numera las versiones por orden cronologico dentro de cada recomendacion",
      fn: () => {
        const entries = toStateHumanFeedback([
          {
            decisionKey: "k2",
            decisionId: "d2",
            departmentRunId: "dept-1",
            recommendationId: "dept-1#rec-1",
            subjectKey: "s",
            changeId: null,
            recommendationTitle: "T",
            proposalNumber: 1,
            action: "approve",
            rejectionReason: "",
            overrides: {},
            target: "staging",
            decidedBy: "pau",
            decidedAt: "2026-08-16T00:00:00.000Z",
            executionStatus: null,
            executionDetail: "",
            contractVersion: 1,
          },
          {
            decisionKey: "k1",
            decisionId: "d1",
            departmentRunId: "dept-1",
            recommendationId: "dept-1#rec-1",
            subjectKey: "s",
            changeId: null,
            recommendationTitle: "T",
            proposalNumber: 1,
            action: "reject",
            rejectionReason: "primero dije que no",
            overrides: {},
            target: "staging",
            decidedBy: "pau",
            decidedAt: "2026-08-15T00:00:00.000Z",
            executionStatus: null,
            executionDetail: "",
            contractVersion: 1,
          },
        ]);

        assert.equal(entries[0].version, 1);
        assert.equal(entries[0].rejectionReason, "primero dije que no", "la mas antigua es la version 1");
        assert.equal(entries[1].version, 2);
        assert.equal(entries[1].action, "approve");
      },
    },
    {
      name: "una accion desconocida se lee como rechazo, nunca como aprobacion",
      fn: () => {
        const [entry] = toStateHumanFeedback([
          {
            decisionKey: "k",
            decisionId: "d",
            departmentRunId: "dept-1",
            recommendationId: "dept-1#rec-1",
            subjectKey: "s",
            changeId: null,
            recommendationTitle: "T",
            proposalNumber: 1,
            action: "algo_que_no_existe",
            rejectionReason: "motivo",
            overrides: {},
            target: "staging",
            decidedBy: "pau",
            decidedAt: "2026-08-15T00:00:00.000Z",
            executionStatus: null,
            executionDetail: "",
            contractVersion: 1,
          },
        ]);
        assert.equal(entry.action, "reject", "en la duda, nunca 'aprobado'");
      },
    },
  ];
}
