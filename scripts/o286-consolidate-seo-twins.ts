import * as dotenv from "dotenv";
dotenv.config();
import { setDeploymentPlanStatus } from "../src/core/production-deployment-plans";
import { setApprovalRequestStatus, readCurrentApprovalRequests } from "../src/core/approval-requests";

/**
 * Fase O28.6 -- consolida los gemelos `seo_on_page_update` (2091-2096,
 * O27.2) que ya tienen una version `content_update` regenerada con el
 * motor visual nuevo (2097-2100). El gemelo SEO nunca aporta contenido
 * nuevo -- solo un titulo/meta description mas pulidos que la version
 * content_update (que hoy usa un titulo plano, ej. "Taquillas Melamina"
 * vs "Taquillas Melamina | Fabricante y venta directa - Zentry") -- asi
 * que nunca debe generar su PROPIO plan de deploy independiente, solo
 * una nota de que titulo migrar al plan real cuando se prepare.
 *
 * Se usa `cancelled` (no existe un status "superseded" propio en el
 * sistema hoy) con un motivo explicito que documenta el mapping --
 * mismo patron ya usado en O27.2 para los 4 duplicados por pagina real.
 *
 * 2092 y 2096 NO se tocan: no tienen ningun gemelo content_update
 * regenerado con el que fusionarse (ver informe O28.6) -- siguen solos,
 * sin cambios, a la espera de su propia revision.
 *
 * Uso: npx ts-node scripts/o286-consolidate-seo-twins.ts
 */

interface Mapping {
  seoPlanId: string;
  seoPageId: number;
  seoApprovalRequestId: string;
  visualPageId: number;
  visualTitle: string;
  currentTitle: string;
}

const MAPPINGS: Mapping[] = [
  {
    seoPlanId: "prod-deploy-aed5cbe3-3746-4ee7-b6d2-7ae57cb30295",
    seoPageId: 2091,
    seoApprovalRequestId: "b998cf4d-d0ff-4ff6-84df-bf0232d92fe9",
    visualPageId: 2097,
    visualTitle: "Taquillas Melamina | Fabricante y venta directa - Zentry",
    currentTitle: "Taquillas Melamina",
  },
  {
    seoPlanId: "prod-deploy-f2cf576f-1c05-4dfe-8d92-9e173bc74bd5",
    seoPageId: 2093,
    seoApprovalRequestId: "c040c16b-370b-4f23-ba82-50c068411828",
    visualPageId: 2098,
    visualTitle: "Taquillas Colegios | Fabricante y venta directa - Zentry",
    currentTitle: "Taquillas Colegios",
  },
  {
    seoPlanId: "prod-deploy-b9b6c9c6-77af-44e5-834a-0609fd973d60",
    seoPageId: 2094,
    seoApprovalRequestId: "faa7557d-3dcc-4e98-bd04-384cbe6884f7",
    visualPageId: 2099,
    visualTitle: "Taquilla Para El Personal | Fabricante y venta directa - Zentry",
    currentTitle: "Taquilla Para El Personal",
  },
  {
    seoPlanId: "prod-deploy-79755187-8172-41fa-9582-7bdb20fbf2fb",
    seoPageId: 2095,
    seoApprovalRequestId: "56d63f35-b336-463e-9f34-444dfc33ed63",
    visualPageId: 2100,
    visualTitle: "Taquillas Fenólicas En Palencia | Fabricante y venta directa - Zentry",
    currentTitle: "Taquillas Fenólicas En Palencia",
  },
];

function main(): void {
  const currentRequests = readCurrentApprovalRequests();
  for (const m of MAPPINGS) {
    const reason = `O28.6: superseded_by pagina ${m.visualPageId} (misma pagina real de produccion, regenerada con el motor visual nuevo). Nota para fusionar antes de proponer ${m.visualPageId} a produccion: usar el titulo SEO pulido "${m.visualTitle}" en vez del titulo actual "${m.currentTitle}".`;
    const updatedPlan = setDeploymentPlanStatus(m.seoPlanId, "cancelled", { lastError: reason });
    console.log(`Plan ${m.seoPlanId} (pagina ${m.seoPageId}) -> ${updatedPlan?.status}`);

    const request = currentRequests.find((r) => r.approvalRequestId === m.seoApprovalRequestId && r.status === "pending");
    if (request) {
      const updatedRequest = setApprovalRequestStatus(request.approvalRequestId, "cancelled", {
        reason: `O28.6: plan asociado consolidado en la pagina ${m.visualPageId} (ver reason del plan).`,
        answeredBy: "o286-consolidation",
      });
      console.log(`  Solicitud ${request.approvalRequestId} -> ${updatedRequest?.status}`);
    } else {
      console.log("  Sin solicitud pendiente asociada.");
    }
  }
  console.log("\n2092 (taquillas-melamina-fenolico) y 2096 (cerraduras-inteligentes-taquillas) NO se tocan -- sin gemelo visual con el que fusionarse.");
}

main();
