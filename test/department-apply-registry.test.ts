import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendChangeSnapshot,
  collectFeedbackForRecommendation,
  findChangeById,
  findChangeByTelegramApprovalId,
  findChangesByRecommendationId,
  nextVersionForRecommendation,
  readCurrentChanges,
  transitionChange,
  updateChangeWithoutTransition,
} from "../src/department/apply/change-registry";
import { DEPARTMENT_CHANGE_CONTRACT_VERSION } from "../src/department/apply/change-types";
import { change, NOW } from "./department-apply-fixtures";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * El registro se prueba contra un fichero TEMPORAL, nunca contra el
 * `data/` real del proyecto: estos tests escriben de verdad.
 */
function withTempRegistry<T>(fn: (filePath: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentry-changes-"));
  const filePath = path.join(dir, "department-changes.jsonl");
  try {
    return fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runDepartmentApplyRegistryTests(): TestCase[] {
  return [
    {
      name: "Una aprobacion sobrevive al proceso: el estado se reconstruye leyendo el fichero desde cero",
      fn: () =>
        withTempRegistry((filePath) => {
          const created = appendChangeSnapshot(change(), filePath);
          const staged = transitionChange(created, "staging_applying", {}, { event: "e", detail: "d" }, { now: NOW, filePath });
          const applied = transitionChange(staged.change, "staging_applied", {}, { event: "e", detail: "d" }, { now: NOW, filePath });
          transitionChange(
            applied.change,
            "awaiting_approval",
            { telegram: { telegramApprovalId: "req-9", telegramMessageId: 1, chatId: "555", sentAt: NOW.toISOString(), stagingVersionHash: "h" } },
            { event: "e", detail: "d" },
            { now: NOW, filePath }
          );

          // Simula "otro proceso": se relee el fichero sin ningun estado en memoria.
          const reloaded = findChangeById(created.changeId, filePath);
          assert.equal(reloaded?.status, "awaiting_approval");
          assert.equal(reloaded?.telegram?.telegramApprovalId, "req-9");
          assert.equal(findChangeByTelegramApprovalId("req-9", filePath)?.changeId, created.changeId);
        }),
    },
    {
      name: "Log append-only: cada transicion añade una linea, ninguna se reescribe",
      fn: () =>
        withTempRegistry((filePath) => {
          const created = appendChangeSnapshot(change(), filePath);
          const staged = transitionChange(created, "staging_applying", {}, { event: "e", detail: "d" }, { now: NOW, filePath });
          transitionChange(staged.change, "staging_applied", {}, { event: "e", detail: "d" }, { now: NOW, filePath });

          const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
          assert.equal(lines.length, 3);
          assert.equal(JSON.parse(lines[0]).status, "proposed", "la primera instantanea sigue intacta");
          assert.equal(readCurrentChanges(filePath).length, 1, "el estado ACTUAL es la instantanea mas reciente");
        }),
    },
    {
      name: "Una transicion prohibida NO se escribe: el registro nunca acaba en un estado imposible",
      fn: () =>
        withTempRegistry((filePath) => {
          const created = appendChangeSnapshot(change({ status: "staging_applied" }), filePath);
          const result = transitionChange(created, "production_applied", {}, { event: "e", detail: "d" }, { now: NOW, filePath });

          assert.equal(result.ok, false);
          assert.match(result.reason, /no permitida/i);
          assert.equal(fs.readFileSync(filePath, "utf-8").trim().split("\n").length, 1, "no se ha escrito ninguna linea nueva");
          assert.equal(findChangeById(created.changeId, filePath)?.status, "staging_applied");
        }),
    },
    {
      name: "Anotar datos sin transicionar nunca cambia el estado",
      fn: () =>
        withTempRegistry((filePath) => {
          const created = appendChangeSnapshot(change({ status: "awaiting_approval" }), filePath);
          const noted = updateChangeWithoutTransition(created, { inheritedFeedback: ["algo"] }, { event: "e", detail: "d" }, { now: NOW, filePath });
          assert.equal(noted.status, "awaiting_approval");
          assert.deepEqual(noted.inheritedFeedback, ["algo"]);
        }),
    },
    {
      name: "Un contractVersion desconocido hace fallar la lectura (fail-closed), no se interpreta a medias",
      fn: () =>
        withTempRegistry((filePath) => {
          fs.writeFileSync(filePath, JSON.stringify({ ...change(), contractVersion: "department-change/v99" }) + "\n", "utf-8");
          assert.throws(() => readCurrentChanges(filePath), /no soportada/i);
        }),
    },
    {
      name: "Un status desconocido en el fichero tambien hace fallar la lectura",
      fn: () =>
        withTempRegistry((filePath) => {
          fs.writeFileSync(filePath, JSON.stringify({ ...change(), status: "inventado" }) + "\n", "utf-8");
          assert.throws(() => readCurrentChanges(filePath), /status desconocido/i);
        }),
    },
    {
      name: "Versionado: tras un rechazo, la propuesta siguiente es v2 con su propio changeId",
      fn: () =>
        withTempRegistry((filePath) => {
          const v1 = appendChangeSnapshot(
            change({
              status: "rejected",
              humanDecision: { decision: "rejected", decidedBy: "telegram:1", decidedAt: NOW.toISOString(), rejectionReason: "H1 demasiado generico", channel: "telegram" },
            }),
            filePath
          );
          const nextVersion = nextVersionForRecommendation(v1.recommendationId, filePath);
          assert.equal(nextVersion, 2);

          const v2 = appendChangeSnapshot(change({ changeId: `${v1.changeId}-v2`, version: 2, supersedesChangeId: v1.changeId }), filePath);
          assert.notEqual(v2.changeId, v1.changeId, "una version nueva NUNCA reutiliza el id (ni la aprobacion) de la anterior");
          assert.equal(findChangesByRecommendationId(v1.recommendationId, filePath).length, 2);
        }),
    },
    {
      name: "El feedback humano de las versiones rechazadas queda disponible para las siguientes",
      fn: () =>
        withTempRegistry((filePath) => {
          appendChangeSnapshot(
            change({
              status: "rejected",
              humanDecision: { decision: "rejected", decidedBy: "telegram:1", decidedAt: NOW.toISOString(), rejectionReason: "H1 demasiado generico", channel: "telegram" },
            }),
            filePath
          );
          const feedback = collectFeedbackForRecommendation(change().recommendationId, filePath);
          assert.equal(feedback.length, 1);
          assert.match(feedback[0], /H1 demasiado generico/);
          assert.match(feedback[0], /^v1 /);
        }),
    },
    {
      name: "Solo los rechazos CON motivo alimentan el feedback (un rechazo sin motivo no aporta nada)",
      fn: () =>
        withTempRegistry((filePath) => {
          appendChangeSnapshot(
            change({
              status: "rejected",
              humanDecision: { decision: "rejected", decidedBy: "telegram:1", decidedAt: NOW.toISOString(), rejectionReason: "", channel: "telegram" },
            }),
            filePath
          );
          assert.deepEqual(collectFeedbackForRecommendation(change().recommendationId, filePath), []);
        }),
    },
    {
      name: "El contrato del registro esta versionado y se rechaza escribir con otra version",
      fn: () =>
        withTempRegistry((filePath) => {
          assert.equal(DEPARTMENT_CHANGE_CONTRACT_VERSION, "department-change/v1");
          assert.throws(() => appendChangeSnapshot({ ...change(), contractVersion: "otra" }, filePath), /no soportada/i);
        }),
    },
  ];
}
