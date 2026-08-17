import * as assert from "node:assert/strict";
import {
  ARTIFACT_ONLY_PATHS,
  STATE_ONLY_PATHS,
  STATE_PATHS,
  StateRegression,
  classifyStatePath,
  classifyStateRegressions,
} from "../src/core/state-persistence";

/**
 * Fase O56 — separacion conceptual STATE vs ARTIFACT.
 *
 * EL PROBLEMA QUE ESTO ARREGLA, con nombre y apellidos:
 *
 * El guard legacy mete `data/` y `reports/` en el mismo saco. Un informe
 * diario que se regenera MAS CORTO (porque hoy hay menos incidencias que
 * ayer) cuenta como `bytes_lost`, el verify falla, y la pasada entera se
 * descarta — ARRASTRANDO consigo todas las lineas de estado nuevas y
 * legitimas de `data/`. Es decir: perdiamos estado de verdad por culpa de
 * un artefacto que se regenera solo.
 *
 * La separacion es CONCEPTUAL. No se borra ni se mueve ningun fichero, y
 * `detectStateRegressions()` sigue devolviendo todas las regresiones
 * exactamente igual que antes: lo que cambia es quien DECIDE con ellas.
 */

export interface TestCase {
  name: string;
  fn: () => void;
}

function regression(path: string, kind: StateRegression["kind"] = "bytes_lost"): StateRegression {
  return { path, kind, detail: "detalle" };
}

export function runStateArtifactClassificationTests(): TestCase[] {
  return [
    {
      name: "todo lo que cuelga de data/ es ESTADO",
      fn: () => {
        assert.equal(classifyStatePath("data/action-backlog.jsonl"), "state");
        assert.equal(classifyStatePath("data/department-human-decisions.jsonl"), "state");
        assert.equal(classifyStatePath("data"), "state");
      },
    },
    {
      name: "todo lo que cuelga de reports/ es ARTIFACT regenerable",
      fn: () => {
        assert.equal(classifyStatePath("reports/daily/2026-08-17-growth.md"), "artifact");
        assert.equal(classifyStatePath("reports/department/dept-1/department-daily-brief.json"), "artifact");
        assert.equal(classifyStatePath("reports"), "artifact");
      },
    },
    {
      name: "ante la duda se protege: lo desconocido cuenta como ESTADO",
      fn: () => {
        assert.equal(classifyStatePath("clients/tukandado/data/jobs.jsonl"), "state");
        assert.equal(classifyStatePath("otra-cosa/fichero.json"), "state");
      },
    },
    {
      name: "un prefijo que solo COMPARTE inicio no cuenta como artifact",
      fn: () => {
        assert.equal(
          classifyStatePath("reports-antiguos/x.md"),
          "state",
          "`reports-antiguos` no es `reports/`"
        );
      },
    },
    {
      name: "J: que un informe de reports/ encoja NO bloquea la persistencia",
      fn: () => {
        const classified = classifyStateRegressions([
          regression("reports/daily/2026-08-17-growth.md"),
          regression("reports/department/dept-1/apply-summary.json"),
        ]);
        assert.equal(classified.state.length, 0, "ningun bloqueo: son entregables regenerables");
        assert.equal(classified.artifact.length, 2, "pero se siguen informando, no se ocultan");
      },
    },
    {
      name: "perder lineas de un .jsonl de data/ SI bloquea",
      fn: () => {
        const classified = classifyStateRegressions([
          regression("data/action-backlog.jsonl", "lines_lost"),
        ]);
        assert.equal(classified.state.length, 1);
        assert.equal(classified.artifact.length, 0);
      },
    },
    {
      name: "un informe que encoge y un jsonl que pierde lineas se separan en la misma pasada",
      fn: () => {
        const classified = classifyStateRegressions([
          regression("reports/daily/hoy.md"),
          regression("data/department-human-decisions.jsonl", "lines_lost"),
          regression("reports/department/dept-1/brief.json"),
          regression("data/change-packs.jsonl", "file_disappeared"),
        ]);
        assert.deepEqual(
          classified.state.map((r) => r.path),
          ["data/department-human-decisions.jsonl", "data/change-packs.jsonl"]
        );
        assert.equal(classified.artifact.length, 2);
      },
    },
    {
      name: "sin regresiones, las dos listas quedan vacias",
      fn: () => {
        const classified = classifyStateRegressions([]);
        assert.deepEqual(classified.state, []);
        assert.deepEqual(classified.artifact, []);
      },
    },
    {
      name: "la clasificacion cubre exactamente las rutas que el manifiesto recorre",
      fn: () => {
        const declared = [...STATE_ONLY_PATHS, ...ARTIFACT_ONLY_PATHS].sort();
        assert.deepEqual(
          declared,
          [...STATE_PATHS].sort(),
          "si se añade una ruta al manifiesto hay que decir si es estado o artefacto"
        );
      },
    },
  ];
}
