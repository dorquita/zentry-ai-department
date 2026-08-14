import * as dotenv from "dotenv";
dotenv.config();
import { runSeoStrategyClusteringAgent } from "../src/agents/seo-strategy-clustering-agent";
import { setActionStatus, findActionById } from "../src/core/action-backlog";
import { recordStatusChange } from "../src/core/action-audit";
import { SeoCluster } from "../src/core/types";

/**
 * Fase O29.1 -- aplica la decision de Pau sobre la canibalizacion real
 * de melamina detectada en O29: NO fusionar /taquillas-melamina/ y
 * /taquillas-melamina-fenolico/, diferenciar por intencion (generico vs.
 * long-tail de combinacion de materiales). El catalogo
 * (config/seo-clusters-catalog.json) ya se actualizo con esa decision
 * antes de este script; aqui solo se re-ejecuta el agente de clustering
 * (para que los clusters reflejen la decision) y se cierran formalmente
 * los actionIds del backlog que quedaron mal enrutados (keyword generica
 * de melamina apuntando a la pagina de combinacion especifica).
 *
 * NO toca produccion, NO publica nada, NO ejecuta ningun batch de
 * Carril A, NO sube STAGING_EXECUTION_BATCH_LIMIT.
 *
 * Uso: npx ts-node scripts/o291-resolve-melamina-cannibalization.ts
 */

const CHANGED_BY = "o29.1-pau-decision";
const REASON =
  'Reasignado por decision de Pau (O29.1): "taquillas melamina"/"taquillas de melamina" es keyword generica y pertenece a /taquillas-melamina/, no a /taquillas-melamina-fenolico/ (esa URL es la long-tail especifica de combinacion melamina+fenolico). Cerrado como duplicado mal enrutado -- la version correctamente enrutada de esta oportunidad ya esta cubierta dentro del mismo cluster.';

function main(): void {
  console.log(`\n=== O29.1 -- Resolver canibalizacion de melamina ===\n`);

  const { clusters } = runSeoStrategyClusteringAgent();

  const melaminaCluster = clusters.find((c) => c.label === "Taquillas de melamina");
  // El cluster melamina-fenolico puede no existir todavia como SeoCluster
  // persistido: ahora mismo NINGUNA keyword del backlog real matchea sus
  // patrones long-tail nuevos (nadie ha buscado literalmente "melamina
  // con puertas fenolicas" todavia) -- upsertSeoCluster solo crea un
  // cluster cuando hay al menos una accion real que agrupar. Eso es
  // esperado, no un error: la decision de diferenciacion queda en el
  // catalogo (config/seo-clusters-catalog.json) y se aplicara en cuanto
  // aparezca la primera keyword real de esa long-tail.
  const melaminaFenolicoCluster = clusters.find((c) => c.label.startsWith("Taquillas melamina-fen"));

  if (!melaminaCluster) {
    console.error('No se encontro el cluster "Taquillas de melamina" -- abortando sin tocar nada.');
    process.exit(1);
  }

  console.log(`Cluster "${melaminaCluster.label}": cannibalizationRisk=${melaminaCluster.cannibalizationRisk}, status=${melaminaCluster.status}`);
  console.log(`  keywords: ${melaminaCluster.keywords.join(" | ")}`);
  console.log(`  URL objetivo: ${melaminaCluster.targetUrl}`);
  console.log(`  title recomendado: ${melaminaCluster.recommendedTitle}`);
  console.log(`  meta recomendada: ${melaminaCluster.recommendedMetaDescription}`);
  console.log(`  actionIds mal enrutados detectados: ${melaminaCluster.misroutedActionIds.length}`);

  if (melaminaFenolicoCluster) {
    console.log(`\nCluster "${melaminaFenolicoCluster.label}": cannibalizationRisk=${melaminaFenolicoCluster.cannibalizationRisk}, status=${melaminaFenolicoCluster.status}`);
    console.log(`  keywords: ${melaminaFenolicoCluster.keywords.join(" | ")}`);
    console.log(`  URL objetivo: ${melaminaFenolicoCluster.targetUrl}`);
    console.log(`  title recomendado: ${melaminaFenolicoCluster.recommendedTitle}`);
    console.log(`  meta recomendada: ${melaminaFenolicoCluster.recommendedMetaDescription}`);
  } else {
    console.log(`\nCluster melamina-fenolico: sin actionIds en el backlog actual todavia (ninguna keyword real matchea la long-tail nueva) -- decision de diferenciacion queda registrada en config/seo-clusters-catalog.json (targetUrl https://zentrylockers.com/taquillas-melamina-fenolico/, pageId 1269), lista para cuando aparezca la primera keyword real.`);
  }

  // --- Cerrar los actionIds mal enrutados del cluster de melamina ---
  const allMisrouted = [...melaminaCluster.misroutedActionIds, ...(melaminaFenolicoCluster?.misroutedActionIds ?? [])];
  const uniqueMisrouted = [...new Set(allMisrouted)];

  console.log(`\n-- Cerrando ${uniqueMisrouted.length} actionIds mal enrutados --`);
  let closedCount = 0;
  let alreadyClosedCount = 0;
  for (const actionId of uniqueMisrouted) {
    const existing = findActionById(actionId);
    if (!existing) {
      console.log(`  [omitido] ${actionId} ya no existe en el backlog.`);
      continue;
    }
    if (existing.status === "rejected") {
      alreadyClosedCount += 1;
      console.log(`  [ya cerrado] ${actionId} "${existing.keyword}" -> ${existing.page} (status ya era rejected)`);
      continue;
    }
    const previousStatus = existing.status;
    const updated = setActionStatus(actionId, "rejected", CHANGED_BY);
    if (!updated) continue;
    recordStatusChange({ actionId, previousStatus, newStatus: "rejected", reason: REASON, changedBy: CHANGED_BY });
    closedCount += 1;
    console.log(`  [cerrado] ${actionId} "${existing.keyword}" -> ${existing.page} (${previousStatus} -> rejected)`);
  }

  // --- Re-ejecutar el agente para que los clusters reflejen el cierre ---
  const refreshed = runSeoStrategyClusteringAgent();
  const refreshedMelamina = refreshed.clusters.find((c) => c.label === "Taquillas de melamina") as SeoCluster;

  console.log(`\n=== Resultado tras la reasignacion ===`);
  console.log(`Cerrados ahora: ${closedCount} | Ya estaban cerrados: ${alreadyClosedCount}`);
  console.log(`Cluster "Taquillas de melamina" -- cannibalizationRisk: ${refreshedMelamina.cannibalizationRisk}, status: ${refreshedMelamina.status}`);

  const anyHighRisk = refreshed.clusters.some((c) => c.cannibalizationRisk === "alto");
  console.log(`\nClusters con canibalizacion sin resolver (riesgo alto) restantes: ${refreshed.clusters.filter((c) => c.cannibalizationRisk === "alto").length}`);
  if (anyHighRisk) {
    console.log(`BLOQUEADO -- todavia hay canibalizacion sin resolver, NO se recomienda subir Carril A a 30.`);
  } else {
    console.log(`DESBLOQUEADO -- no quedan clusters con canibalizacion sin resolver. La decision de O29.1 esta aplicada y verificada. Subir STAGING_EXECUTION_BATCH_LIMIT a 30 es una decision de Pau a tomar aparte, pero el bloqueo de inteligencia que lo impedia ya no existe.`);
  }

  console.log(`\nOK -- no se ha tocado produccion, no se ha publicado nada, no se ha ejecutado ningun batch de Carril A, no se ha subido STAGING_EXECUTION_BATCH_LIMIT.`);
}

main();
