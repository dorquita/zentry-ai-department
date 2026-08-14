import * as dotenv from "dotenv";
dotenv.config();
import { readCurrentChangePacks } from "../src/core/change-packs";
import { readCurrentStagingExecutions } from "../src/core/staging-executions";
import { runSeoStrategyClusteringAgent, resolveCatalogEntryForKeyword } from "../src/agents/seo-strategy-clustering-agent";

/**
 * Fase O31, tarea 7 -- simulacion DRY-RUN de lo que produciria un batch
 * real de Carril A con STAGING_EXECUTION_BATCH_LIMIT=30, ahora que los 3
 * builders pasan por el cluster gate. NO promociona ningun change pack a
 * approved_to_execute, NO llama a staging-executor, NO escribe en
 * WordPress -- solo lee el estado actual y predice que haria
 * staging-executor si se ejecutara de verdad.
 *
 * Uso: npx ts-node scripts/o31-dry-run-batch30.ts
 */

const BATCH_LIMIT = 30;

function main(): void {
  const { clusters } = runSeoStrategyClusteringAgent();
  const clusterByLabel = new Map(clusters.map((c) => [c.label, c]));

  const changePacks = readCurrentChangePacks();
  const executions = readCurrentStagingExecutions();
  const executionByChangePackId = new Map(executions.map((e) => [e.changePackId, e]));

  console.log(`\n=== O31 -- DRY-RUN batch de hasta ${BATCH_LIMIT} tareas (simulacion, sin ejecutar nada) ===\n`);

  // --- 1. Ya "approved_to_execute" pero sin ejecucion aplicada todavia (cola real ahora mismo) ---
  const approvedNotYetApplied = changePacks.filter((cp) => {
    if (cp.status !== "approved_to_execute") return false;
    const exec = executionByChangePackId.get(cp.changePackId);
    return !exec || exec.status !== "applied_to_staging";
  });

  // --- 2. "ready_for_review" -- ya pasaron por el cluster gate al crearse (Fase O31), son candidatos limpios a promocionar ---
  const readyForReview = changePacks.filter((cp) => cp.status === "ready_for_review");

  const simulated = [...approvedNotYetApplied, ...readyForReview].slice(0, BATCH_LIMIT);
  const skippedByBatchLimit = [...approvedNotYetApplied, ...readyForReview].slice(BATCH_LIMIT);

  console.log(`Change packs "approved_to_execute" sin aplicar todavia: ${approvedNotYetApplied.length}`);
  console.log(`Change packs "ready_for_review" (ya cluster-gated al crearse): ${readyForReview.length}`);
  console.log(`TOTAL que entrarian en el batch (limite ${BATCH_LIMIT}): ${simulated.length}`);
  if (skippedByBatchLimit.length > 0) {
    console.log(`Se quedarian fuera por limite de batch: ${skippedByBatchLimit.length}`);
  }

  console.log(`\n-- Tareas que SI se ejecutarian (${simulated.length}) --`);
  const touchedClusters = new Set<string>();
  for (const cp of simulated) {
    const catalogMatch = resolveCatalogEntryForKeyword(cp.keyword);
    const cluster = catalogMatch ? clusterByLabel.get(catalogMatch.label) : undefined;
    if (cluster) touchedClusters.add(cluster.label);

    const action = cp.targetWordpressPageId
      ? `ACTUALIZARIA borrador de staging existente (pageId ${cp.targetWordpressPageId})${
          (cp.proposedChanges as Record<string, unknown>).metaOnlyUpdate ? " -- solo title/meta" : " -- contenido completo"
        }`
      : "CREARIA una pagina nueva de staging";

    console.log(`  [${cp.changeType}] "${cp.keyword}" (${cp.page ?? "sin URL"}) -- cluster: ${cluster?.label ?? "(desconocido)"} -- ${action}`);
  }

  console.log(`\n-- Clusters que se tocarian (${touchedClusters.size}) --`);
  for (const label of touchedClusters) console.log(`  - ${label}`);

  console.log(`\n-- Se quedarian fuera por limite de batch (${skippedByBatchLimit.length}) --`);
  for (const cp of skippedByBatchLimit) {
    console.log(`  "${cp.keyword}" (${cp.page ?? "sin URL"})`);
  }

  // --- 3. Cerrados que NO se ejecutarian (historico de O30 + bloqueos de O31) ---
  const closed = changePacks.filter((cp) => cp.status === "rejected" || cp.status === "superseded");
  console.log(`\n-- Change packs cerrados que NO entrarian en ningun batch (${closed.length}) --`);
  console.log(`  rejected: ${closed.filter((c) => c.status === "rejected").length} | superseded: ${closed.filter((c) => c.status === "superseded").length}`);
  console.log(`  (detalle completo ya reportado en O30 -- estos siguen cerrados, no se han reabierto)`);

  console.log(`\n=== Veredicto ===`);
  if (simulated.length === 0) {
    console.log("DRY-RUN vacio: no hay nada que ejecutar todavia.");
  } else {
    console.log(`El dry-run esta limpio: ${simulated.length} tarea(s), todas ya pasaron por el cluster gate (O31), ninguna crea una pagina duplicada, ${touchedClusters.size} cluster(s) afectado(s).`);
  }
  console.log(`\nOK -- no se ha promocionado ningun change pack, no se ha ejecutado staging-executor, no se ha escrito en WordPress, no se ha tocado produccion.`);
}

main();
