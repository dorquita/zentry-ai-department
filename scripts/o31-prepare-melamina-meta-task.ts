import * as dotenv from "dotenv";
dotenv.config();
import { readCurrentWorkOrders, upsertWorkOrder, findWorkOrderByActionId } from "../src/core/work-orders";
import { readCurrentSeoClusters } from "../src/core/seo-clusters";

/**
 * Fase O31, tarea 5 -- prepara (NO ejecuta) la mejora de title/meta de
 * /taquillas-melamina/ decidida por Pau en O29.1, como una work order
 * real que el pipeline normal (SEO Change Pack Builder -> cluster gate)
 * puede recoger. No es una keyword detectada automaticamente por
 * Search Console -- es una decision de cluster ya aprobada, por eso el
 * actionId es un identificador deterministico y explicito
 * ("o31-cluster-melamina-title-meta"), no un actionId real de
 * action-backlog.jsonl. Idempotente: si se vuelve a ejecutar, no crea
 * una segunda work order (dedup por actionId).
 *
 * Tras esto, `npm run change-packs:seo` recoge esta work order, pasa
 * por el cluster gate (cluster "Taquillas de melamina" -> ya tiene
 * borrador de staging 2097 -> allow_update_existing) y crea el change
 * pack con targetWordpressPageId=2097 y proposedChanges.metaOnlyUpdate.
 * El change pack queda en `ready_for_review` -- NO se promociona a
 * approved_to_execute ni se ejecuta aqui.
 *
 * Uso: npx ts-node scripts/o31-prepare-melamina-meta-task.ts
 */

const ACTION_ID = "o31-cluster-melamina-title-meta";
const KEYWORD = "taquillas melamina";
const TARGET_URL = "https://zentrylockers.com/taquillas-melamina/";

const RECOMMENDED_TITLE = "Taquillas de Melamina | Resistentes y Personalizables - Zentry Lockers";
const RECOMMENDED_META =
  "Taquillas de melamina para vestuarios, colegios y empresas: resistentes, personalizables y con acabados a medida. Pide presupuesto sin compromiso.";

function main(): void {
  const clusters = readCurrentSeoClusters();
  const cluster = clusters.find((c) => c.label === "Taquillas de melamina");
  if (!cluster) {
    console.error('No se encontro el cluster "Taquillas de melamina" -- ejecuta primero scripts/o29-run-seo-clustering.ts. Abortando.');
    process.exit(1);
  }
  if (cluster.cannibalizationRisk === "alto") {
    console.error(`El cluster "Taquillas de melamina" todavia tiene cannibalizationRisk=alto -- no se prepara esta tarea hasta que este resuelto. Abortando.`);
    process.exit(1);
  }
  if (cluster.relatedStagingPageIds.length === 0) {
    console.error(`El cluster "Taquillas de melamina" no tiene borrador de staging todavia -- no hay pagina a la que aplicar un cambio de title/meta. Abortando.`);
    process.exit(1);
  }

  const existing = findWorkOrderByActionId(ACTION_ID);
  const current = readCurrentWorkOrders();

  const { workOrder, isNew } = upsertWorkOrder(
    {
      actionId: ACTION_ID,
      canonicalKey: `zentry_locker_core|seo:cluster_meta_update|${KEYWORD}|${TARGET_URL}`,
      department: "web-growth",
      sourceActionTitle: "SEO on-page: title/meta de taquillas de melamina (decision O29.1, aprobada por Pau)",
      brandIntent: "zentry_locker_core",
      targetBrand: "zentry",
      actionType: "seo:cluster_meta_update",
      keyword: KEYWORD,
      page: TARGET_URL,
      priority: "medium",
      impact: "low",
      effort: "low",
      requiresHumanReview: true,
      planningOrigin: "auto_approved_for_planning",
      autonomyLevel: "AUTO_PLAN",
      riskLevel: "low_medium",
      requiresApproval: false,
      proposedChanges: {
        page: TARGET_URL,
        primaryKeyword: KEYWORD,
        proposedTitle: RECOMMENDED_TITLE,
        proposedMetaDescription: RECOMMENDED_META,
        proposedH1: "",
        suggestedH2s: [],
        copyBlock: "",
        suggestedFaqs: [],
        suggestedInternalLinks: [],
        schema: "",
        cannibalizationRisk:
          "Resuelto en O29.1 (Pau): cluster diferenciado de /taquillas-melamina-fenolico/ -- keyword generica de melamina pertenece solo a esta pagina, sin canibalizacion pendiente.",
        // Fase O31 -- leido por staging-executor.ts para aplicar SOLO
        // title/meta sobre el borrador existente, sin regenerar el resto
        // del contenido de la pagina.
        metaOnlyUpdate: true,
      },
      implementationChecklist: [
        `Actualizar el title del borrador de staging (pagina ${cluster.relatedStagingPageIds.join(", ")}) a: "${RECOMMENDED_TITLE}"`,
        `Actualizar la meta description a: "${RECOMMENDED_META}"`,
        "No modificar el resto del contenido de la pagina (body/estructura/imagenes intactos).",
        "Revisar visualmente en staging tras aplicar antes de considerar produccion.",
      ],
      risks: ["Cambiar el title/meta puede provocar una fluctuacion temporal de CTR mientras Google reindexa la pagina (si esto llegase a produccion en el futuro)."],
      sourceAgent: "o31-cluster-gate-integration",
      initialStatus: "ready_for_review",
    },
    current
  );

  if (!isNew) {
    console.log(`Work order ya existia (workOrderId=${workOrder.workOrderId}, status=${workOrder.status}) -- no se crea otra. Ejecuta "npm run change-packs:seo" para generar/actualizar su change pack.`);
    return;
  }

  console.log(`Work order creada: ${workOrder.workOrderId} (actionId=${ACTION_ID}, status=${workOrder.status}).`);
  console.log(`Cluster: "${cluster.label}" -- borrador de staging a actualizar: ${cluster.relatedStagingPageIds.join(", ")}`);
  console.log(`Siguiente paso: "npm run change-packs:seo" para que el builder (con el cluster gate de O31) genere el change pack con targetWordpressPageId=${cluster.relatedStagingPageIds[0]}.`);
  console.log(`OK -- no se ha tocado WordPress, no se ha creado ningun change pack todavia, no se ha ejecutado nada.`);
}

main();
