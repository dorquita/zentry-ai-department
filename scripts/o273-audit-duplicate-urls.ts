import * as dotenv from "dotenv";
dotenv.config();
import { recordExistingPageAudit } from "../src/core/existing-page-audit";

/**
 * Fase O27.3 -- registra, para cada uno de los 21 borradores de staging
 * del batch de O27.2 (page_id 2091-2111), si su URL/tema YA existe en
 * producción (`update_existing_page`) o es genuinamente nuevo
 * (`new_page_candidate`).
 *
 * Los datos vienen de una auditoria manual real hecha el 2026-08-10:
 * para los 6 change packs `seo_on_page_update` (y sus 4 gemelos
 * `content_update` sobre la MISMA pagina), el propio campo `page` de la
 * ejecucion YA es la URL real de producción (por definicion -- SEO
 * on-page opera sobre una pagina existente). Para el resto (paginas
 * `content_update`/`new_content_page` SIN `page` asociado, que Content
 * Planner trato como "contenido nuevo"), se busco cada keyword contra
 * `GET /wp-json/wp/v2/pages?search=` de PRODUCCION real -- 5 de ellas
 * SI tenian una pagina de producción casi identica que Content Planner
 * no habia detectado (fenolicas-con-perfil -> 1271, industrial -> 1823,
 * oficina -> 1822, colegio -> 1960, hotel -> 131). Solo quedan
 * genuinamente nuevas: comprar-taquillas, soluciones-de-taquillas,
 * taquillas-para-vestuarios, metalicas-taquillas, universidad. El caso
 * "taquillas inteligentes" (2103) no tiene una URL identica pero SI
 * solapa tematicamente con dos paginas reales (1865 cerraduras
 * inteligentes, 1867 digitalizacion taquillas) -- se deja como
 * new_page_candidate pero marcado para revision por riesgo de
 * canibalizacion, igual que se hizo con el caso cerraduras en O27.2.
 *
 * Uso: npx ts-node scripts/o273-audit-duplicate-urls.ts
 */

interface AuditInput {
  wordpressPageId: number;
  keyword: string;
  matchType: "update_existing_page" | "new_page_candidate";
  productionPageId?: number;
  productionUrl?: string;
  confidence: "exact" | "topical_review";
  notes?: string;
}

const AUDITS: AuditInput[] = [
  { wordpressPageId: 2091, keyword: "taquillas melamina", matchType: "update_existing_page", productionPageId: 470, productionUrl: "https://zentrylockers.com/taquillas-melamina/", confidence: "exact", notes: "seo_on_page_update -- el campo page ya era la URL real." },
  { wordpressPageId: 2092, keyword: "taquillas melamina fenólico", matchType: "update_existing_page", productionPageId: 1269, productionUrl: "https://zentrylockers.com/taquillas-melamina-fenolico/", confidence: "exact", notes: "seo_on_page_update -- el campo page ya era la URL real." },
  { wordpressPageId: 2093, keyword: "taquillas colegios", matchType: "update_existing_page", productionPageId: 127, productionUrl: "https://zentrylockers.com/taquillas-para-colegios/", confidence: "exact", notes: "Caso senalado explicitamente por Pau. seo_on_page_update -- el campo page ya era la URL real." },
  { wordpressPageId: 2094, keyword: "taquilla para el personal", matchType: "update_existing_page", productionPageId: 129, productionUrl: "https://zentrylockers.com/taquillas-para-empresas/", confidence: "exact", notes: "seo_on_page_update -- el campo page ya era la URL real." },
  { wordpressPageId: 2095, keyword: "taquillas fenólicas en palencia", matchType: "update_existing_page", productionPageId: 468, productionUrl: "https://zentrylockers.com/taquillas-fenolicas/", confidence: "exact", notes: "seo_on_page_update -- el campo page ya era la URL real." },
  { wordpressPageId: 2096, keyword: "cerraduras inteligentes para taquillas", matchType: "update_existing_page", productionPageId: 1865, productionUrl: "https://zentrylockers.com/cerraduras-inteligentes-taquillas/", confidence: "exact", notes: "Decision de Pau en O27.2: diferenciar (pagina informativa), no fusionar con 2060 (catalogo comercial O22)." },
  { wordpressPageId: 2097, keyword: "taquillas melamina", matchType: "update_existing_page", productionPageId: 470, productionUrl: "https://zentrylockers.com/taquillas-melamina/", confidence: "exact", notes: "content_update gemelo de 2091, misma pagina real." },
  { wordpressPageId: 2098, keyword: "taquillas colegios", matchType: "update_existing_page", productionPageId: 127, productionUrl: "https://zentrylockers.com/taquillas-para-colegios/", confidence: "exact", notes: "content_update gemelo de 2093 -- ESTE es el borrador que Pau vio y senalo como duplicado de /taquillas-para-colegios/. Tratar como PROPUESTA DE ACTUALIZACION de la pagina 127, nunca como pagina nueva independiente." },
  { wordpressPageId: 2099, keyword: "taquilla para el personal", matchType: "update_existing_page", productionPageId: 129, productionUrl: "https://zentrylockers.com/taquillas-para-empresas/", confidence: "exact", notes: "content_update gemelo de 2094, misma pagina real." },
  { wordpressPageId: 2100, keyword: "taquillas fenólicas en palencia", matchType: "update_existing_page", productionPageId: 468, productionUrl: "https://zentrylockers.com/taquillas-fenolicas/", confidence: "exact", notes: "content_update gemelo de 2095, misma pagina real." },
  { wordpressPageId: 2101, keyword: "comprar taquillas", matchType: "new_page_candidate", confidence: "topical_review", notes: "Sin pagina de producción equivalente exacta. Solapa tematicamente con /solicitar-presupuesto/ (1862) -- no es duplicado, pero revisar que no compita por la misma intencion de busqueda." },
  { wordpressPageId: 2102, keyword: "soluciones de taquillas", matchType: "new_page_candidate", confidence: "topical_review", notes: "Sin pagina de producción equivalente exacta. Termino generico, riesgo bajo de canibalizacion." },
  { wordpressPageId: 2103, keyword: "taquillas inteligentes", matchType: "new_page_candidate", confidence: "topical_review", notes: "RIESGO DE CANIBALIZACION: solapa tematicamente con /cerraduras-inteligentes-taquillas/ (1865) y /digitalizacion-taquillas/ (1867). No crear como pagina nueva independiente sin decision explicita de Pau -- mismo patron que el caso cerraduras de O27.2." },
  { wordpressPageId: 2104, keyword: "taquillas para vestuarios", matchType: "new_page_candidate", confidence: "topical_review", notes: "Sin pagina de producción equivalente exacta (distinto de /bancos-de-vestuario/, que es mobiliario, no taquillas)." },
  { wordpressPageId: 2105, keyword: "metalicas taquillas", matchType: "new_page_candidate", confidence: "topical_review", notes: "Sin pagina de producción equivalente exacta sobre taquillas metalicas especificamente." },
  { wordpressPageId: 2106, keyword: "fenolicas con perfil", matchType: "update_existing_page", productionPageId: 1271, productionUrl: "https://zentrylockers.com/taquillas-fenolicas-perfileria/", confidence: "exact", notes: "Content Planner lo genero como content_update sin page asociado, pero SI existe una pagina de producción casi identica (taquillas-fenolicas-perfileria) que no detecto." },
  { wordpressPageId: 2107, keyword: "industrial", matchType: "update_existing_page", productionPageId: 1823, productionUrl: "https://zentrylockers.com/taquillas-para-industria/", confidence: "exact", notes: "Generado como new_content_page, pero YA existe /taquillas-para-industria/ en producción -- tratar como actualizacion, no pagina nueva." },
  { wordpressPageId: 2108, keyword: "oficina", matchType: "update_existing_page", productionPageId: 1822, productionUrl: "https://zentrylockers.com/taquillas-para-oficinas/", confidence: "exact", notes: "Generado como new_content_page, pero YA existe /taquillas-para-oficinas/ en producción -- tratar como actualizacion, no pagina nueva." },
  { wordpressPageId: 2109, keyword: "colegio", matchType: "update_existing_page", productionPageId: 1960, productionUrl: "https://zentrylockers.com/taquillas-escolares/", confidence: "exact", notes: "Generado como new_content_page, pero YA existe /taquillas-escolares/ en producción (la misma pagina rediseñada en la Fase O13.6c) -- tratar como actualizacion, no pagina nueva." },
  { wordpressPageId: 2110, keyword: "universidad", matchType: "new_page_candidate", confidence: "topical_review", notes: "Sin ninguna pagina de producción sobre universidades -- genuinamente nueva." },
  { wordpressPageId: 2111, keyword: "hotel", matchType: "update_existing_page", productionPageId: 131, productionUrl: "https://zentrylockers.com/taquillas-para-hoteles/", confidence: "exact", notes: "Generado como new_content_page, pero YA existe /taquillas-para-hoteles/ en producción -- tratar como actualizacion, no pagina nueva." },
];

function main(): void {
  let updateCount = 0;
  let newCount = 0;
  for (const audit of AUDITS) {
    recordExistingPageAudit(audit);
    if (audit.matchType === "update_existing_page") updateCount += 1;
    else newCount += 1;
    console.log(`[${audit.matchType}] page ${audit.wordpressPageId} "${audit.keyword}"${audit.productionUrl ? ` -> ${audit.productionUrl} (prod #${audit.productionPageId})` : ""}`);
  }
  console.log(`\nTotal: ${AUDITS.length}. update_existing_page: ${updateCount}. new_page_candidate: ${newCount}.`);
}

main();
