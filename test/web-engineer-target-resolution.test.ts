import * as assert from "node:assert/strict";
import { SeoSpecialistOutput } from "../src/employees/seo-specialist/domain";
import { buildRecommendationId } from "../src/department/apply/types";
import { DepartmentPromotionResult, DepartmentRecommendation } from "../src/department/promotion";
import { indexSeoPagesById, resolveActionPages } from "../src/department/specialist-inputs";
import {
  buildTargetPageSnapshot,
  StagingInventory,
  StagingPageSnapshot,
  STAGING_INVENTORY_CONTRACT_VERSION,
  isYoastMetaReadable,
  summarizePageForPrompt,
  TARGET_SNAPSHOT_CONTENT_BUDGET,
} from "../src/department/staging-inventory";
import { INVENTORY_RETRY_DELAYS_MS, readStagingInventory } from "../src/adapters/staging-inventory-reader";
import { extractPageReferences, resolveRecommendationTargets } from "../src/department/target-resolution";
import { buildChangePlanFromDraft, WebEngineerChangePlanDraft } from "../src/department/web-engineer-changeplan";
import { buildWebEngineerDiagnostics } from "../src/department/web-engineer-diagnostics";
import { buildDepartmentWebEngineerContext } from "../src/department/web-engineer-input";

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

// --- Fixtures ------------------------------------------------------------

const RUN_ID = "dept-2026-08-16T134942Z";
const STAGING_HOST = "https://staging.zentrylockers.com";
const PRODUCTION_HOST = "https://zentrylockers.com";

const CONTENT_1269 = "<!-- wp:heading --><h2>Taquillas de melamina</h2><!-- /wp:heading -->";
const CONTENT_1867 = "<!-- wp:paragraph --><p>Digitalizacion de taquillas.</p><!-- /wp:paragraph -->";

function page(overrides: Partial<StagingPageSnapshot> & { wordpressPageId: number; slug: string }): StagingPageSnapshot {
  return {
    status: "publish",
    stagingUrl: `${STAGING_HOST}/${overrides.slug}/`,
    title: `Titulo de ${overrides.slug}`,
    excerpt: `Excerpt de ${overrides.slug}`,
    contentHtml: CONTENT_1269,
    meta: {},
    ...overrides,
  };
}

function inventory(pages: StagingPageSnapshot[], unavailableReason = ""): StagingInventory {
  return { contractVersion: STAGING_INVENTORY_CONTRACT_VERSION, capturedAt: "2026-08-16T13:49:42Z", pages, unavailableReason };
}

const PAGE_1269 = page({
  wordpressPageId: 1269,
  slug: "taquillas-melamina-fenolico",
  meta: { _yoast_wpseo_title: "Taquillas de melamina fenolica | Zentry", _yoast_wpseo_metadesc: "Meta actual de melamina." },
});
const PAGE_1867 = page({ wordpressPageId: 1867, slug: "digitalizacion-taquillas", contentHtml: CONTENT_1867 });
const INVENTORY = inventory([PAGE_1269, PAGE_1867]);

function draft(overrides: Partial<WebEngineerChangePlanDraft> = {}): WebEngineerChangePlanDraft {
  return {
    recommendationId: buildRecommendationId(RUN_ID, 1),
    targetPage: `${STAGING_HOST}/taquillas-melamina-fenolico/`,
    operation: "update_post_title",
    newValue: "Taquillas de melamina fenolica para vestuarios",
    rationale: "Responde a la recomendacion #1.",
    ...overrides,
  };
}

function recommendation(overrides: Partial<DepartmentRecommendation> & { rank: number; title: string }): DepartmentRecommendation {
  return {
    rationale: "",
    impact: "high",
    confidence: "high",
    effort: "medium",
    dependsOn: [],
    evidenceRefs: [],
    decision: "promoted",
    blockedBy: [],
    qaWarnings: [],
    ...overrides,
  };
}

function promotion(promoted: DepartmentRecommendation[], blocked: DepartmentRecommendation[] = []): DepartmentPromotionResult {
  return {
    departmentRunId: RUN_ID,
    departmentQaStatus: "PASS_WITH_WARNINGS",
    qaReviewStatus: "pass_with_warnings",
    globalBlockReason: null,
    promoted,
    blocked,
    unattributedBlockingSignals: [],
    qaSummary: null,
  };
}

function contextFor(promoted: DepartmentRecommendation[], inv: StagingInventory = INVENTORY, blocked: DepartmentRecommendation[] = []) {
  return buildDepartmentWebEngineerContext({
    departmentRunId: RUN_ID,
    promotion: promotion(promoted, blocked),
    growthSummary: "",
    evidenceCatalog: [],
    specialistInputs: [],
    stagingInventory: inv.pages.map(summarizePageForPrompt),
    stagingInventoryUnavailableReason: inv.unavailableReason,
    fullStagingInventory: inv,
  });
}

/**
 * Credenciales FALSAS solo para poder ejercitar el lector de inventario
 * sin red: `readStagingInventory()` corta antes de cualquier fetch si no
 * estan puestas. El `fetchImpl` inyectado nunca sale a internet.
 */
async function withFakeWordpressEnv<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["WP_API_URL", "WP_API_USERNAME", "WP_API_PASSWORD"] as const;
  const previous = keys.map((key) => [key, process.env[key]] as const);
  process.env.WP_API_URL = "https://staging.zentrylockers.com";
  process.env.WP_API_USERNAME = "usuario-de-test";
  process.env.WP_API_PASSWORD = "password-de-test";
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// --- Tests ---------------------------------------------------------------

export function runWebEngineerTargetResolutionTests(): TestCase[] {
  return [
    // 1. EXTRACCION DE REFERENCIAS ------------------------------------------
    {
      name: "Solo se extraen referencias EXPLICITAS: URLs absolutas y paths con barra final; ni 'y/o' ni 'GA4/GTM' ni '24/7' cuentan como pagina",
      fn: () => {
        const refs = extractPageReferences([
          `Revisar ${PRODUCTION_HOST}/cerraduras/ y tambien /taquillas-melamina-fenolico/.`,
          "Coordinar GA4/GTM y el soporte 24/7, y/o el equipo de contenido.",
        ]);
        assert.deepEqual(refs, [`${PRODUCTION_HOST}/cerraduras/`, "/taquillas-melamina-fenolico/"]);
      },
    },
    {
      name: "La puntuacion de cierre que la prosa pega a una URL no forma parte de la URL",
      fn: () => {
        const refs = extractPageReferences([`Ver (${STAGING_HOST}/digitalizacion-taquillas/), que ya existe.`]);
        assert.deepEqual(refs, [`${STAGING_HOST}/digitalizacion-taquillas/`]);
      },
    },

    // 2. RESOLUCION DETERMINISTA --------------------------------------------
    {
      name: "Target exacto de staging -> pageId: la URL de staging resuelve la pagina 1269 sin ambiguedad",
      fn: () => {
        const resolution = resolveRecommendationTargets([`Reescribir el title de ${STAGING_HOST}/taquillas-melamina-fenolico/.`], INVENTORY);
        assert.equal(resolution.status, "resolved");
        assert.equal(resolution.pages.length, 1);
        assert.equal(resolution.pages[0].wordpressPageId, 1269);
        assert.equal(resolution.references[0].crossEnvironment, false);
      },
    },
    {
      name: "Path de PRODUCCION -> pagina exacta de staging por slug, y queda marcado como crossEnvironment",
      fn: () => {
        const resolution = resolveRecommendationTargets([`La pagina ${PRODUCTION_HOST}/taquillas-melamina-fenolico/ tiene CTR 0%.`], INVENTORY);
        assert.equal(resolution.status, "resolved");
        assert.equal(resolution.pages[0].wordpressPageId, 1269);
        assert.equal(resolution.references[0].crossEnvironment, true);
        assert.match(resolution.references[0].reason, /slug exacto/i);
      },
    },
    {
      name: "Trailing slash y query/fragment no cambian la identidad de la pagina",
      fn: () => {
        for (const reference of [
          `${STAGING_HOST}/taquillas-melamina-fenolico`,
          `${STAGING_HOST}/taquillas-melamina-fenolico/`,
          `${STAGING_HOST}/taquillas-melamina-fenolico/?utm_source=brief`,
          `${STAGING_HOST}/taquillas-melamina-fenolico/#seccion`,
        ]) {
          const resolution = resolveRecommendationTargets([`Objetivo: ${reference} .`], INVENTORY);
          assert.equal(resolution.status, "resolved", `fallo con ${reference}`);
          assert.equal(resolution.pages[0].wordpressPageId, 1269, `fallo con ${reference}`);
        }
      },
    },
    {
      name: "Multi target: dos paginas citadas A PROPOSITO no son ambiguedad -- las dos se entregan, una por ChangePlan",
      fn: () => {
        const resolution = resolveRecommendationTargets(
          [`Consolidar el on-page de ${STAGING_HOST}/taquillas-melamina-fenolico/ y ${STAGING_HOST}/digitalizacion-taquillas/.`],
          INVENTORY
        );
        assert.equal(resolution.status, "multi_target");
        assert.deepEqual(resolution.pages.map((p) => p.wordpressPageId), [1269, 1867]);
        assert.match(resolution.reason, /No hay nada que elegir/i);
      },
    },
    {
      name: "Missing target: sin ninguna referencia de pagina -> no_target_reference (no se deduce por keyword ni por tema)",
      fn: () => {
        const resolution = resolveRecommendationTargets(["Reescribir metas en las paginas con CTR sistemicamente 0%."], INVENTORY);
        assert.equal(resolution.status, "no_target_reference");
        assert.equal(resolution.pages.length, 0);
        assert.ok(resolution.reason.length > 0);
      },
    },
    {
      name: "Cero candidatos: una URL que no existe en staging deja la recomendacion en unresolved_target, sin caer en la pagina mas parecida",
      fn: () => {
        const resolution = resolveRecommendationTargets([`Arreglar el enrutado de ${PRODUCTION_HOST}/cerraduras/.`], INVENTORY);
        assert.equal(resolution.status, "unresolved_target");
        assert.equal(resolution.pages.length, 0);
        assert.equal(resolution.references[0].status, "not_in_inventory");
      },
    },
    {
      name: "Dos paginas de staging con el MISMO slug: ambiguo, no se resuelve ninguna",
      fn: () => {
        const duplicated = inventory([PAGE_1269, page({ wordpressPageId: 9001, slug: "taquillas-melamina-fenolico", stagingUrl: `${STAGING_HOST}/es/taquillas-melamina-fenolico/` })]);
        const resolution = resolveRecommendationTargets([`Objetivo: ${PRODUCTION_HOST}/taquillas-melamina-fenolico/ .`], duplicated);
        assert.equal(resolution.status, "unresolved_target");
        assert.equal(resolution.references[0].status, "ambiguous");
      },
    },
    {
      name: "Pagina NO publicada: no entra en el inventario del prompt y una referencia a ella no resuelve",
      fn: () => {
        const withDraftPage = inventory([page({ wordpressPageId: 999, slug: "borrador-interno", status: "draft" })]);
        const resolution = resolveRecommendationTargets([`Objetivo: ${STAGING_HOST}/borrador-interno/ .`], withDraftPage);
        // Resuelve contra el inventario, pero el ChangePlan la rechaza
        // despues por status -- y ese rechazo tiene su propio motivo.
        assert.equal(resolution.status, "resolved");
        const resolved = buildChangePlanFromDraft({
          draft: draft({ targetPage: `${STAGING_HOST}/borrador-interno/`, operation: "update_post_title" }),
          inventory: withDraftPage,
        });
        assert.equal(resolved.resolution, "target_not_publishable");
      },
    },

    {
      name: "Inventario VACIO: el motivo dice que no se pudo LEER staging, no que la pagina no exista",
      fn: () => {
        const unreadable = inventory([], "Fallo de red leyendo el inventario de staging en staging.zentrylockers.com (fetch failed) tras 3 intentos con espera.");
        const resolution = resolveRecommendationTargets([`Mejorar el title de ${PRODUCTION_HOST}/taquillas-fenolicas/.`], unreadable);
        assert.equal(resolution.status, "unresolved_target");
        assert.match(resolution.reason, /inventario de staging de esta pasada esta VACIO/);
        assert.match(resolution.reason, /NO significa que las paginas citadas no existan/);
        assert.match(resolution.reason, /fetch failed/);
      },
    },

    // 3. ESTADOS DIFERENCIADOS DEL CHANGEPLAN --------------------------------
    {
      name: "unresolved_target y ambiguous_target NO se agrupan con unsupported_operation: cada uno trae su propio estado",
      fn: () => {
        const noPage = buildChangePlanFromDraft({ draft: draft({ targetPage: `${STAGING_HOST}/no-existe/` }), inventory: INVENTORY });
        assert.equal(noPage.status, "MANUAL");
        assert.equal(noPage.resolution, "unresolved_target");

        const unsupported = buildChangePlanFromDraft({ draft: draft({ operation: "update_redirect" }), inventory: INVENTORY });
        assert.equal(unsupported.resolution, "unsupported_operation");

        const disabled = buildChangePlanFromDraft({ draft: draft({ operation: "create_page" }), inventory: INVENTORY });
        assert.equal(disabled.resolution, "unsupported_operation");

        const badMetaKey = buildChangePlanFromDraft({
          draft: draft({ operation: "update_post_meta", metaKey: "_wp_page_template" }),
          inventory: INVENTORY,
        });
        assert.equal(badMetaKey.resolution, "unsupported_operation");
      },
    },
    {
      name: "missing_after: un newValue vacio no es un cambio, y se distingue de no saber la pagina",
      fn: () => {
        const resolved = buildChangePlanFromDraft({ draft: draft({ newValue: "   " }), inventory: INVENTORY });
        assert.equal(resolved.status, "MANUAL");
        assert.equal(resolved.resolution, "missing_after");
        assert.equal(resolved.page?.wordpressPageId, 1269);
      },
    },
    {
      name: "missing_before: sabemos la pagina pero no tenemos su post_content -> no se reescribe el cuerpo a ciegas",
      fn: () => {
        const withoutBody = inventory([page({ wordpressPageId: 1269, slug: "taquillas-melamina-fenolico", contentHtml: "" })]);
        const resolved = buildChangePlanFromDraft({
          draft: draft({ operation: "update_post_content", newValue: "<!-- wp:paragraph --><p>Nuevo.</p><!-- /wp:paragraph -->" }),
          inventory: withoutBody,
        });
        assert.equal(resolved.status, "MANUAL");
        assert.equal(resolved.resolution, "missing_before");
        assert.match(resolved.reason, /escribir a ciegas/i);
      },
    },
    {
      name: "no_change_needed: proponer el valor que ya esta no es un cambio, y tampoco es un fallo de resolucion",
      fn: () => {
        const resolved = buildChangePlanFromDraft({ draft: draft({ newValue: PAGE_1269.title }), inventory: INVENTORY });
        assert.equal(resolved.resolution, "no_change_needed");
      },
    },
    {
      name: "unknown_recommendation: un plan que no se puede remontar a una recomendacion aprobada se rechaza AQUI, con motivo, no en silencio",
      fn: () => {
        const resolved = buildChangePlanFromDraft({
          draft: draft({ recommendationId: "inventado#rec-99" }),
          inventory: INVENTORY,
          approvedRecommendationIds: [buildRecommendationId(RUN_ID, 1), buildRecommendationId(RUN_ID, 2)],
        });
        assert.equal(resolved.status, "MANUAL");
        assert.equal(resolved.resolution, "unknown_recommendation");
        assert.match(resolved.reason, /inventado#rec-99/);
      },
    },
    {
      name: "El recommendationId que el contexto entrega es EXACTAMENTE el que acepta el resolver (mismo formato, sin traduccion por medio)",
      fn: () => {
        const context = contextFor([recommendation({ rank: 3, title: "Reescribir el title de la pagina de melamina" })]);
        const declared = context.approvedRecommendations[0].recommendationId;
        const resolved = buildChangePlanFromDraft({
          draft: draft({ recommendationId: declared }),
          inventory: INVENTORY,
          approvedRecommendationIds: context.approvedRecommendations.map((r) => r.recommendationId),
        });
        assert.equal(resolved.status, "ACTIONABLE");
        assert.equal(resolved.resolution, "actionable");
      },
    },
    {
      name: "Title y excerpt validos producen ChangePlan ACTIONABLE anclado al hash LEIDO de la pagina",
      fn: () => {
        for (const operation of ["update_post_title", "update_post_excerpt"]) {
          const resolved = buildChangePlanFromDraft({ draft: draft({ operation, newValue: "Valor nuevo y distinto del actual" }), inventory: INVENTORY });
          assert.equal(resolved.status, "ACTIONABLE", `fallo con ${operation}`);
          assert.equal(resolved.resolution, "actionable");
          assert.equal(resolved.plan?.targetId, 1269);
          assert.equal(resolved.plan?.expectedBeforeHash.length, 64);
        }
      },
    },
    {
      name: "Meta de Yoast: el BEFORE sale del inventario leido, no del draft, y el plan es ACTIONABLE",
      fn: () => {
        const resolved = buildChangePlanFromDraft({
          draft: draft({ operation: "update_post_meta", metaKey: "_yoast_wpseo_metadesc", newValue: "Meta description nueva y concreta." }),
          inventory: INVENTORY,
        });
        assert.equal(resolved.status, "ACTIONABLE");
        assert.equal(resolved.beforeValue, "Meta actual de melamina.");
      },
    },

    // 4. BEFORE EN EL CONTEXTO ----------------------------------------------
    {
      name: "El brief del prompt lleva la meta Yoast ACTUAL: sin ella no se puede proponer un update_post_meta completo",
      fn: () => {
        const brief = summarizePageForPrompt(PAGE_1269);
        assert.equal(brief.metaTitle, "Taquillas de melamina fenolica | Zentry");
        assert.equal(brief.metaDescription, "Meta actual de melamina.");
        // Una pagina sin meta declara null, NUNCA un valor derivado del title.
        assert.equal(summarizePageForPrompt(PAGE_1867).metaTitle, null);
        assert.equal(summarizePageForPrompt(PAGE_1867).metaDescription, null);
      },
    },
    {
      name: "Un post_content vacio se marca contentAvailable=false: 'no se pudo leer' nunca puede parecer 'la pagina esta vacia'",
      fn: () => {
        const snapshot = buildTargetPageSnapshot(page({ wordpressPageId: 1, slug: "sin-cuerpo", contentHtml: "" }));
        assert.equal(snapshot.contentAvailable, false);
        assert.equal(snapshot.contentHtml, "");
        assert.match(snapshot.contentUnavailableReason, /NO asumas que esta vacia/);
      },
    },
    {
      name: "Un cuerpo que excede el presupuesto no se recorta a medias: se omite entero, diciendo por que",
      fn: () => {
        const huge = page({ wordpressPageId: 2, slug: "muy-larga", contentHtml: "x".repeat(TARGET_SNAPSHOT_CONTENT_BUDGET + 1) });
        const snapshot = buildTargetPageSnapshot(huge);
        assert.equal(snapshot.contentAvailable, false);
        assert.equal(snapshot.contentHtml, "");
        assert.match(snapshot.contentUnavailableReason, /excede el presupuesto/);
      },
    },

    // 5. CONTEXTO: LA PAGINA LLEGA RESUELTA ---------------------------------
    {
      name: "El contexto de web-engineer entrega la pagina objetivo YA resuelta y su BEFORE completo",
      fn: () => {
        const context = contextFor([
          recommendation({ rank: 1, title: `Reescribir el title de ${PRODUCTION_HOST}/taquillas-melamina-fenolico/` }),
        ]);
        const rec = context.approvedRecommendations[0];
        assert.equal(rec.recommendationId, `${RUN_ID}#rec-1`);
        assert.equal(rec.targetResolutionStatus, "resolved");
        assert.equal(rec.resolvedTargets.length, 1);
        assert.equal(rec.resolvedTargets[0].wordpressPageId, 1269);
        assert.equal(rec.resolvedTargets[0].crossEnvironment, true);
        assert.equal(context.targetPageSnapshots.length, 1);
        assert.equal(context.targetPageSnapshots[0].contentAvailable, true);
        assert.equal(context.targetPageSnapshots[0].contentHtml, CONTENT_1269);
      },
    },
    {
      name: "Una recomendacion sin pagina no recibe ninguna: resolvedTargets vacio y motivo explicito",
      fn: () => {
        const context = contextFor([recommendation({ rank: 1, title: "Reescribir metas en las paginas con CTR sistemicamente 0%" })]);
        assert.equal(context.approvedRecommendations[0].resolvedTargets.length, 0);
        assert.equal(context.approvedRecommendations[0].targetResolutionStatus, "no_target_reference");
        assert.equal(context.targetPageSnapshots.length, 0);
      },
    },
    {
      name: "Sin inventario real no se resuelve ningun target, aunque la recomendacion cite una URL perfecta",
      fn: () => {
        const context = contextFor(
          [recommendation({ rank: 1, title: `Reescribir el title de ${STAGING_HOST}/taquillas-melamina-fenolico/` })],
          inventory([], "El REST del core respondio HTTP 500.")
        );
        assert.equal(context.approvedRecommendations[0].targetResolutionStatus, "unresolved_target");
        assert.equal(context.targetPageSnapshots.length, 0);
      },
    },

    {
      name: "multi_target: el contexto entrega las DOS paginas (una entrada por pagina, no por cita) y el BEFORE de ambas",
      fn: () => {
        const context = contextFor([
          recommendation({
            rank: 1,
            title: `Consolidar el on-page de ${PRODUCTION_HOST}/taquillas-melamina-fenolico/ y ${PRODUCTION_HOST}/digitalizacion-taquillas/`,
            rationale: `Ver ${STAGING_HOST}/taquillas-melamina-fenolico/ y ${STAGING_HOST}/digitalizacion-taquillas/.`,
          }),
        ]);
        const rec = context.approvedRecommendations[0];
        assert.equal(rec.targetResolutionStatus, "multi_target");
        // Cuatro citas, dos paginas: una entrada por PAGINA.
        assert.deepEqual(rec.resolvedTargets.map((t) => t.wordpressPageId), [1269, 1867]);
        assert.deepEqual(context.targetPageSnapshots.map((s) => s.wordpressPageId), [1269, 1867]);
      },
    },
    {
      name: "Cada pagina de un multi_target admite su PROPIO ChangePlan, cada uno con un unico destino",
      fn: () => {
        const ids = [buildRecommendationId(RUN_ID, 1)];
        const plans = [
          buildChangePlanFromDraft({
            draft: draft({ targetPage: `${STAGING_HOST}/taquillas-melamina-fenolico/`, newValue: "Titulo nuevo de melamina" }),
            inventory: INVENTORY,
            approvedRecommendationIds: ids,
          }),
          buildChangePlanFromDraft({
            draft: draft({ targetPage: `${STAGING_HOST}/digitalizacion-taquillas/`, newValue: "Titulo nuevo de digitalizacion" }),
            inventory: INVENTORY,
            approvedRecommendationIds: ids,
          }),
        ];
        assert.deepEqual(plans.map((p) => p.status), ["ACTIONABLE", "ACTIONABLE"]);
        assert.deepEqual(plans.map((p) => p.plan?.targetId), [1269, 1867]);
      },
    },

    // 5b. META DE YOAST NO LEGIBLE ------------------------------------------
    {
      name: "Si NINGUNA pagina expone la meta Yoast, la lectura es lo que falla: update_post_meta cae en missing_before, no se escribe a ciegas",
      fn: () => {
        const withoutMeta = inventory([page({ wordpressPageId: 1269, slug: "taquillas-melamina-fenolico" })]);
        assert.equal(isYoastMetaReadable(withoutMeta), false);
        assert.equal(isYoastMetaReadable(INVENTORY), true);

        const resolved = buildChangePlanFromDraft({
          draft: draft({ operation: "update_post_meta", metaKey: "_yoast_wpseo_metadesc", newValue: "Meta nueva." }),
          inventory: withoutMeta,
        });
        assert.equal(resolved.status, "MANUAL");
        assert.equal(resolved.resolution, "missing_before");
        assert.match(resolved.reason, /a ciegas/i);

        // Y el title, que SI se lee, sigue siendo proponible sobre la misma pagina.
        const title = buildChangePlanFromDraft({ draft: draft({ newValue: "Titulo nuevo" }), inventory: withoutMeta });
        assert.equal(title.status, "ACTIONABLE");
      },
    },
    {
      name: "El contexto avisa por escrito de que la meta Yoast no se pudo leer, en vez de dejar un null que parece 'vacio'",
      fn: () => {
        const withoutMeta = inventory([page({ wordpressPageId: 1269, slug: "taquillas-melamina-fenolico" })]);
        const context = contextFor([recommendation({ rank: 1, title: `Reescribir metas de ${STAGING_HOST}/taquillas-melamina-fenolico/` })], withoutMeta);
        assert.match(context.yoastMetaUnavailableNotice, /NO se ha podido leer/);
        assert.match(context.yoastMetaUnavailableNotice, /NO quiere decir que esten vacias/);
        assert.equal(contextFor([recommendation({ rank: 1, title: "sin objetivo" })], INVENTORY).yoastMetaUnavailableNotice, "");
      },
    },

    // 5c. LECTURA DEL INVENTARIO: REINTENTOS ---------------------------------
    {
      name: "Un corte de red transitorio no cuesta la pasada entera: se reintenta con espera y la tercera lectura vale",
      fn: async () => {
        let calls = 0;
        const waited: number[] = [];
        const inventoryRead = await withFakeWordpressEnv(() => readStagingInventory({
          fetchImpl: (async () => {
            calls += 1;
            if (calls < 3) throw new Error("fetch failed");
            return new Response(JSON.stringify([{ id: 1269, status: "publish", slug: "taquillas-melamina-fenolico", link: `${STAGING_HOST}/taquillas-melamina-fenolico/`, title: { raw: "T" }, excerpt: { raw: "E" }, content: { raw: "C" }, meta: {} }]), { status: 200 });
          }) as unknown as typeof fetch,
          sleep: async (ms: number) => {
            waited.push(ms);
          },
          now: () => new Date("2026-08-16T16:13:09Z"),
        }));
        assert.equal(calls, 3);
        assert.deepEqual(waited, INVENTORY_RETRY_DELAYS_MS);
        assert.equal(inventoryRead.unavailableReason, "");
        assert.equal(inventoryRead.pages.length, 1);
      },
    },
    {
      name: "Un HTTP de error NO se reintenta: es una respuesta del servidor, no un corte",
      fn: async () => {
        let calls = 0;
        const inventoryRead = await withFakeWordpressEnv(() => readStagingInventory({
          fetchImpl: (async () => {
            calls += 1;
            return new Response("nope", { status: 401 });
          }) as unknown as typeof fetch,
          sleep: async () => {
            throw new Error("no deberia esperarse por un HTTP de error");
          },
          now: () => new Date("2026-08-16T16:13:09Z"),
        }));
        assert.equal(calls, 1);
        assert.match(inventoryRead.unavailableReason, /HTTP 401/);
        assert.equal(inventoryRead.pages.length, 0);
      },
    },

    // 6. TRAZABILIDAD SEO: relatedIds -> pagina -----------------------------
    {
      name: "Los relatedIds de una accion de SEO se resuelven a las paginas que declaran sus oportunidades y problemas tecnicos",
      fn: () => {
        const seo = {
          executiveSummary: "",
          findings: [],
          opportunities: [
            { id: "O3", keyword: "taquillas melamina", page: `${PRODUCTION_HOST}/taquillas-melamina-fenolico/`, kind: "low_ctr", priority: "high", recommendedAction: "", rationale: "", basis: "evidence", evidenceRefs: [] },
            { id: "O6", keyword: "digitalizacion", page: `${PRODUCTION_HOST}/digitalizacion-taquillas/`, kind: "low_ctr", priority: "high", recommendedAction: "", rationale: "", basis: "evidence", evidenceRefs: [] },
            { id: "O9", keyword: "sin pagina", kind: "content_gap", priority: "low", recommendedAction: "", rationale: "", basis: "inference", evidenceRefs: [] },
          ],
          technicalIssues: [{ id: "T2", page: `${PRODUCTION_HOST}/cerraduras/`, issue: "", severity: "high", basis: "evidence", evidenceRefs: [] }],
          contentGaps: [],
          internalLinkRecommendations: [],
          prioritizedActions: [{ rank: 3, title: "Reescribir metas", relatedIds: ["T2", "O3", "O6", "O9"], priority: "high", effort: "medium", impact: "high" }],
          evidence: [],
          unknowns: [],
        } as unknown as SeoSpecialistOutput;

        const index = indexSeoPagesById(seo);
        assert.deepEqual(resolveActionPages(seo.prioritizedActions[0].relatedIds, index), [
          `${PRODUCTION_HOST}/cerraduras/`,
          `${PRODUCTION_HOST}/taquillas-melamina-fenolico/`,
          `${PRODUCTION_HOST}/digitalizacion-taquillas/`,
        ]);
        // Un relatedId cuyo elemento no declara pagina no aporta nada, y
        // no se sustituye por una parecida.
        assert.deepEqual(resolveActionPages(["O9"], index), []);
      },
    },

    // 7. DIAGNOSTICO --------------------------------------------------------
    {
      name: "Toda recomendacion no accionable trae SIEMPRE un motivo, y los motivos no son todos el mismo",
      fn: () => {
        const context = contextFor(
          [
            recommendation({ rank: 1, title: `Reescribir el title de ${STAGING_HOST}/taquillas-melamina-fenolico/` }),
            recommendation({ rank: 2, title: "Reescribir metas en las paginas con CTR sistemicamente 0%" }),
            recommendation({ rank: 3, title: `Unificar ${STAGING_HOST}/taquillas-melamina-fenolico/ con ${STAGING_HOST}/digitalizacion-taquillas/` }),
          ],
          INVENTORY,
          [recommendation({ rank: 4, title: "Publicar la landing nueva en produccion", decision: "blocked", blockedBy: ["QA bloquea: sin revision visual."] })]
        );
        const diagnostics = buildWebEngineerDiagnostics({
          departmentRunId: RUN_ID,
          context,
          resolved: [
            buildChangePlanFromDraft({
              draft: draft({ recommendationId: `${RUN_ID}#rec-2`, targetPage: `${STAGING_HOST}/no-existe/` }),
              inventory: INVENTORY,
            }),
          ],
          rejectedDrafts: [],
          declaredCount: 1,
          attributeEvidenceRef: () => ["seo-specialist"],
          blocked: [{ recommendationId: `${RUN_ID}#rec-4`, rank: 4, blockedBy: ["QA bloquea: sin revision visual."] }],
        });

        assert.equal(diagnostics.recommendations.length, 4);
        for (const rec of diagnostics.recommendations) assert.ok(rec.reason.trim().length > 0, `sin motivo: ${rec.recommendationId}`);

        const byId = new Map(diagnostics.recommendations.map((r) => [r.recommendationId, r]));
        assert.equal(byId.get(`${RUN_ID}#rec-1`)?.changePlanStatus, "no_change_plan_declared");
        assert.equal(byId.get(`${RUN_ID}#rec-1`)?.pageIdResolved, 1269);
        assert.equal(byId.get(`${RUN_ID}#rec-2`)?.changePlanStatus, "unresolved_target");
        assert.equal(byId.get(`${RUN_ID}#rec-3`)?.targetResolution, "multi_target");
        assert.equal(byId.get(`${RUN_ID}#rec-3`)?.pageIdResolved, null);
        assert.equal(byId.get(`${RUN_ID}#rec-4`)?.changePlanStatus, "qa_blocked");
        // Y NO todos comparten el mismo estado, que era justo el problema.
        assert.ok(Object.keys(diagnostics.countsByStatus).length >= 3, JSON.stringify(diagnostics.countsByStatus));
      },
    },
    {
      name: "El diagnostico no lleva contenido: solo ids, estados, longitudes y motivos tecnicos",
      fn: () => {
        const context = contextFor([recommendation({ rank: 1, title: `Reescribir el title de ${STAGING_HOST}/taquillas-melamina-fenolico/` })]);
        const resolved = buildChangePlanFromDraft({ draft: draft({ newValue: "Un titulo nuevo secretisimo" }), inventory: INVENTORY });
        const diagnostics = buildWebEngineerDiagnostics({
          departmentRunId: RUN_ID,
          context,
          resolved: [resolved],
          rejectedDrafts: [],
          declaredCount: 1,
          attributeEvidenceRef: () => [],
        });
        const serialized = JSON.stringify(diagnostics);
        assert.ok(!serialized.includes("Un titulo nuevo secretisimo"), "el diagnostico no debe llevar el contenido propuesto");
        assert.ok(!serialized.includes(CONTENT_1269), "el diagnostico no debe llevar el contenido de la pagina");
        assert.equal(diagnostics.recommendations[0].afterLength, "Un titulo nuevo secretisimo".length);
        assert.equal(diagnostics.recommendations[0].changePlanStatus, "actionable");
      },
    },
  ];
}
