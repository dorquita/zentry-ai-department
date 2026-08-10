import * as dotenv from "dotenv";
dotenv.config();

import { findProductionDeploymentPlanById, readCurrentProductionDeploymentPlans } from "../src/core/production-deployment-plans";
import { getWordpressPage } from "../src/adapters/wordpress";
import { DeploymentPlanStatus } from "../src/core/types";

/**
 * Dry-run de produccion (Fase O13.1): muestra EXACTAMENTE que haria una
 * futura aplicacion real de un plan -- draft de origen, media, SEO,
 * endpoint REST que se usaria, tipo de operacion, rollback, y que
 * aprobacion adicional falta -- SIN llamar nunca a produccion. No existe
 * en todo este fichero ninguna llamada de red a
 * WORDPRESS_PRODUCTION_BASE_URL; solo se lee esa variable como texto
 * para poder mostrar el endpoint hipotetico.
 */

const WORDPRESS_API_PAGES_PATH = "/wp-json/wp/v2/pages";
const WORDPRESS_API_MEDIA_PATH = "/wp-json/wp/v2/media";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

function describeNextApproval(status: DeploymentPlanStatus): string {
  switch (status) {
    case "draft":
    case "plan_ready_for_review":
      return 'Falta la APROBACION DE PLAN (confirmar que el diseno -- checklist/media/SEO/rollback -- esta bien). Todavia NO se ha pedido la aprobacion de ejecucion.';
    case "plan_approved":
      return 'El plan ya tiene APROBACION DE PLAN. Falta la APROBACION DE EJECUCION (autorizar una futura escritura real) -- se creara/enviara en el proximo pase de "npm run production:plans".';
    case "execution_pending_approval":
      return 'Falta la APROBACION DE EJECUCION (autorizar una futura escritura real) -- solicitud ya enviada, esperando respuesta.';
    case "execution_approved":
      return 'Ambas aprobaciones (plan + ejecucion) ya estan dadas. AUN ASI no existe ningun ejecutor automatico en este proyecto -- la aplicacion sigue siendo 100% manual (ver docs/manual-production-publish.md).';
    case "plan_rejected":
      return 'El plan fue RECHAZADO en la etapa de diseno. No se pedira ninguna aprobacion de ejecucion salvo que se proponga un plan nuevo.';
    case "execution_rejected":
      return 'El diseno fue aprobado, pero la EJECUCION fue rechazada. No se autoriza ninguna aplicacion real de este plan.';
    case "applied_to_production_draft":
      return 'Este plan ya deberia estar aplicado (fuera de este sistema, manualmente). No deberia hacer falta ninguna aprobacion mas para este plan.';
    case "rolled_back":
      return 'Este plan fue revertido. No hace falta ninguna aprobacion adicional salvo que se proponga reintentarlo.';
    case "cancelled":
      return 'Este plan fue cancelado. No hace falta ninguna aprobacion adicional.';
    default:
      return "Estado no reconocido.";
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const plan = args.deploymentPlanId
    ? findProductionDeploymentPlanById(args.deploymentPlanId)
    : [...readCurrentProductionDeploymentPlans()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (!plan) {
    console.error(
      args.deploymentPlanId
        ? `No existe ningun plan con deploymentPlanId="${args.deploymentPlanId}".`
        : 'No hay ningun plan en data/production-deployment-plans.jsonl todavia. Ejecuta primero "npm run production:plans".'
    );
    process.exit(1);
    return;
  }

  console.log("=== DRY-RUN de produccion (Fase O13.1) -- NUNCA llama a produccion ===");
  console.log(`deploymentPlanId: ${plan.deploymentPlanId}`);
  console.log(`status actual: ${plan.status}`);
  console.log("");

  console.log("--- 1. Draft de staging que se usaria ---");
  console.log(`sourceDraftId: ${plan.sourceDraftId}`);
  console.log(`sourceDraftUrl: ${plan.sourceDraftUrl}`);

  let liveMediaIds = plan.includedMediaIds;
  try {
    const livePage = await getWordpressPage(plan.sourceDraftId);
    const mediaMatches = [...livePage.contentHtml.matchAll(/wp-image-(\d+)/g)].map((m) => Number(m[1]));
    liveMediaIds = [...new Set(mediaMatches)];
    console.log(`status actual del draft en staging: ${livePage.status}`);
    if (JSON.stringify(liveMediaIds) !== JSON.stringify(plan.includedMediaIds)) {
      console.log(
        `AVISO: la media detectada AHORA en staging (${liveMediaIds.join(", ")}) difiere de la guardada en el plan (${plan.includedMediaIds.join(", ")}) -- el draft cambio despues de crear el plan. Revisar antes de aprobar.`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`AVISO: no se pudo releer el draft de staging para verificar la media actual (${message}). Usando lo guardado en el plan.`);
  }
  console.log("");

  console.log("--- 2. Media que se usaria ---");
  if (liveMediaIds.length === 0) {
    console.log("(ninguna)");
  } else {
    for (const mediaId of liveMediaIds) {
      console.log(`- media ${mediaId} (staging) -> se re-subiria como media NUEVA a produccion, nunca se enlaza directo a staging.zentrylockers.com`);
    }
  }
  console.log("");

  console.log("--- 3. Titulo/meta que llevaria ---");
  console.log(`title: "${plan.seoMeta.title}"`);
  console.log(`metaDescription: "${plan.seoMeta.metaDescription}"`);
  console.log("");

  console.log("--- 4. Endpoint REST que se usaria (NUNCA llamado en este dry-run) ---");
  const prodBaseUrl = process.env.WORDPRESS_PRODUCTION_BASE_URL;
  if (!prodBaseUrl) {
    console.log("WORDPRESS_PRODUCTION_BASE_URL no esta configurada en .env -- no se puede calcular el endpoint todavia.");
  } else {
    const cleanBaseUrl = prodBaseUrl.replace(/\/+$/, "");
    if (plan.deploymentType === "update_existing_draft" && plan.targetPageId) {
      console.log(`POST ${cleanBaseUrl}${WORDPRESS_API_PAGES_PATH}/${plan.targetPageId}  (actualizaria la pagina ${plan.targetPageId} -- solo si sigue en status "draft")`);
    } else {
      console.log(`POST ${cleanBaseUrl}${WORDPRESS_API_PAGES_PATH}  (crearia una pagina NUEVA, status "draft")`);
    }
    for (const mediaId of liveMediaIds) {
      console.log(`POST ${cleanBaseUrl}${WORDPRESS_API_MEDIA_PATH}  (subiria una copia de la media ${mediaId} de staging)`);
    }
  }
  console.log("");

  console.log("--- 5. Crearia draft nuevo o actualizaria uno existente ---");
  if (plan.deploymentType === "update_existing_draft" && plan.targetPageId) {
    console.log(`ACTUALIZARIA la pagina de produccion existente targetPageId=${plan.targetPageId} (deploymentType: update_existing_draft)`);
  } else {
    console.log(`CREARIA una pagina NUEVA en produccion, siempre status "draft" (deploymentType: ${plan.deploymentType})`);
  }
  console.log("");

  console.log("--- 6. Rollback que habria ---");
  for (const step of plan.rollbackPlan) console.log(`- ${step}`);
  console.log("");

  console.log("--- 7. Aprobacion adicional que haria falta ---");
  console.log(describeNextApproval(plan.status));
  console.log("");

  console.log("=== CONFIRMACION ===");
  console.log("Este dry-run NO ha hecho ninguna llamada de red a produccion. No se ha creado, actualizado, subido ni borrado nada.");
  console.log("Produccion intacta.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
