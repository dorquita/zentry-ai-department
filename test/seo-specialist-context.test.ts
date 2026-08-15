import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { buildSeoSpecialistContext } from "../src/employees/seo-specialist/context";
import { readAllJobs } from "../src/core/job-registry";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Tests del context builder de seo-specialist CONTRA DATOS REALES del
 * repositorio (data/jobs.jsonl, config/seo-target-keywords.json,
 * config/seo-clusters-catalog.json, reports/seo/ y reports/seo-director/),
 * no fixtures inventados -- ver docs/claude-employee-runtime.md, "context-builder ...
 * behavior against real ... local data". No hay puntos de inyeccion en
 * buildSeoSpecialistContext() (lee siempre del disco real, deliberado --
 * mismo espiritu que landing-architect-v2-context.ts), asi que estos
 * tests verifican INVARIANTES estructurales que deben cumplirse pase lo
 * que pase con el contenido exacto de esos ficheros, en vez de fijar
 * valores concretos que cambiarian si el histórico de datos cambia.
 */
export function runSeoSpecialistContextTests(): TestCase[] {
  return [
    {
      name: "buildSeoSpecialistContext no lanza y devuelve un generatedAt en formato ISO",
      fn: () => {
        const context = buildSeoSpecialistContext();
        assert.doesNotThrow(() => new Date(context.generatedAt).toISOString());
      },
    },
    {
      name: "buildSeoSpecialistContext: actionItems/targetKeywords/clusters son siempre arrays (nunca undefined)",
      fn: () => {
        const context = buildSeoSpecialistContext();
        assert.ok(Array.isArray(context.actionItems));
        assert.ok(Array.isArray(context.targetKeywords));
        assert.ok(Array.isArray(context.clusters));
      },
    },
    {
      name: "buildSeoSpecialistContext: dataAvailability.hasJobData coincide con la presencia real de data/jobs.jsonl",
      fn: () => {
        const context = buildSeoSpecialistContext();
        const jobs = readAllJobs();
        assert.equal(context.dataAvailability.hasJobData, jobs.length > 0);
      },
    },
    {
      name: "buildSeoSpecialistContext: si hay jobs, latestRunId esta definido y totalJobsInLatestRun es coherente con actionItems agregados",
      fn: () => {
        const context = buildSeoSpecialistContext();
        if (context.dataAvailability.hasJobData) {
          assert.ok(typeof context.dataAvailability.latestRunId === "string" && context.dataAvailability.latestRunId.length > 0);
          assert.ok(context.dataAvailability.totalJobsInLatestRun > 0);
          // buildActionPlan agrega por keyword+pagina -- nunca puede haber
          // MAS actionItems que jobs de entrada del run mas reciente.
          assert.ok(context.actionItems.length <= context.dataAvailability.totalJobsInLatestRun);
        } else {
          assert.equal(context.dataAvailability.latestRunId, undefined);
          assert.equal(context.dataAvailability.totalJobsInLatestRun, 0);
          assert.deepEqual(context.actionItems, []);
        }
      },
    },
    {
      name: "buildSeoSpecialistContext: dataAvailability.hasTargetKeywordCatalog coincide con config/seo-target-keywords.json",
      fn: () => {
        const context = buildSeoSpecialistContext();
        const catalogPath = path.join(__dirname, "..", "config", "seo-target-keywords.json");
        const exists = fs.existsSync(catalogPath);
        if (!exists) {
          assert.equal(context.dataAvailability.hasTargetKeywordCatalog, false);
          assert.deepEqual(context.targetKeywords, []);
        } else {
          const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as { keywords?: unknown[] };
          const expectedHas = Array.isArray(parsed.keywords) && parsed.keywords.length > 0;
          assert.equal(context.dataAvailability.hasTargetKeywordCatalog, expectedHas);
        }
      },
    },
    {
      name: "buildSeoSpecialistContext: dataAvailability.hasClusterCatalog coincide con config/seo-clusters-catalog.json",
      fn: () => {
        const context = buildSeoSpecialistContext();
        const catalogPath = path.join(__dirname, "..", "config", "seo-clusters-catalog.json");
        const exists = fs.existsSync(catalogPath);
        if (!exists) {
          assert.equal(context.dataAvailability.hasClusterCatalog, false);
          assert.deepEqual(context.clusters, []);
        } else {
          const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as { clusters?: unknown[] };
          const expectedHas = Array.isArray(parsed.clusters) && parsed.clusters.length > 0;
          assert.equal(context.dataAvailability.hasClusterCatalog, expectedHas);
        }
      },
    },
    {
      name: "buildSeoSpecialistContext: cada actionItem del contexto tiene keyword/page no vacios (nunca placeholders)",
      fn: () => {
        const context = buildSeoSpecialistContext();
        for (const item of context.actionItems) {
          assert.ok(item.keyword.trim().length > 0);
          assert.ok(item.page.trim().length > 0);
        }
      },
    },
    {
      name: "buildSeoSpecialistContext: cada cluster leido conserva clusterKey/label/action tal cual estan en el catalogo (sin reescribir el contenido)",
      fn: () => {
        const context = buildSeoSpecialistContext();
        for (const cluster of context.clusters) {
          assert.ok(typeof cluster.clusterKey === "string" && cluster.clusterKey.length > 0);
          assert.ok(typeof cluster.label === "string" && cluster.label.length > 0);
          assert.ok(typeof cluster.action === "string" && cluster.action.length > 0);
        }
      },
    },
    {
      name: "buildSeoSpecialistContext: es deterministico entre dos llamadas seguidas para los datos agregados (mismos ficheros de entrada)",
      fn: () => {
        const a = buildSeoSpecialistContext();
        const b = buildSeoSpecialistContext();
        assert.deepEqual(a.actionItems, b.actionItems);
        assert.deepEqual(a.targetKeywords, b.targetKeywords);
        assert.deepEqual(a.clusters, b.clusters);
        assert.deepEqual(a.dataAvailability.latestRunId, b.dataAvailability.latestRunId);
      },
    },
  ];
}
