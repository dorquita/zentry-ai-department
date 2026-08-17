import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { validateExecutePhpChangePlan } from "../src/core/execute-php-operations";
import {
  assessAfterValue,
  buildChangePlanId,
  CHANGE_PLAN_EXECUTION_STATUSES,
  CHANGE_PLAN_STATUS_LABEL,
  EXECUTABLE_CHANGE_PLAN_CONTRACT_VERSION,
  evaluateChangePlanFreshness,
  ExecutableChangePlan,
} from "../src/department/executable-change-plan";
import {
  countDistinctReferences,
  metaValueObserved,
  postTypeOf,
  resolveExecutionTarget,
  StagingInventory,
  StagingPageSnapshot,
  versionHashOfPage,
} from "../src/department/staging-inventory";
import {
  buildChangePlanFromDraft,
  ResolvedChangePlan,
  toProposalStatus,
  WebEngineerChangePlanDraft,
} from "../src/department/web-engineer-changeplan";

/**
 * DE RECOMENDACION APROBADA A `ExecutableChangePlan`.
 *
 * Esta suite cubre el tramo que iba de "el departamento propone" a "el
 * sistema sabe exactamente que escribiria": resolucion determinista del
 * destino, BEFORE leido, AFTER concreto, preconditions, validacion,
 * rollback y estado.
 *
 * Dos bloques a proposito:
 *
 *   - SINTETICO: inventario de prueba, para poder forzar los casos que
 *     no existen en el sitio real (dos paginas con el mismo slug, una
 *     pagina que cambia entre la propuesta y la ejecucion).
 *   - REAL: `test/fixtures/staging-inventory-dept-2026-08-16T185140Z.json`,
 *     subconjunto COPIADO TAL CUAL del inventario que leyo la pasada
 *     `dept-2026-08-16T185140Z` (44 paginas publicadas de
 *     staging.zentrylockers.com, leidas por REST el 2026-08-16T19:11:32Z;
 *     aqui van las 5 que citan las recomendaciones probadas). No se ha
 *     retocado ningun valor: los `meta: {}` vacios son los que devolvio
 *     el sitio de verdad, y por eso el caso de Yoast sale
 *     BEFORE_UNAVAILABLE en vez de fingir un BEFORE vacio.
 *
 * NINGUN test de esta suite escribe en ningun sitio: todo el modulo bajo
 * prueba es puro y el fixture se lee en modo lectura.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

const RUN_ID = "dept-2026-08-16T185140Z";
const STAGING_HOST = "https://staging.zentrylockers.com";
const PRODUCTION_HOST = "https://zentrylockers.com";

// --- Inventario sintetico ------------------------------------------------

function page(overrides: Partial<StagingPageSnapshot> & { wordpressPageId: number; slug: string }): StagingPageSnapshot {
  return {
    stagingUrl: `${STAGING_HOST}/${overrides.slug}/`,
    status: "publish",
    title: `Titulo de ${overrides.slug}`,
    excerpt: "",
    contentHtml: "<!-- wp:paragraph --><p>Contenido actual.</p><!-- /wp:paragraph -->",
    meta: {},
    postType: "page",
    metaObservedKeys: [],
    ...overrides,
  };
}

function inventory(pages: StagingPageSnapshot[], capturedAt = "2026-08-16T19:11:32.958Z"): StagingInventory {
  return { contractVersion: "staging-inventory/v1", capturedAt, pages, unavailableReason: "" };
}

/** Inventario sintetico con DOS paginas que comparten slug: el caso ambiguo. */
function ambiguousInventory(): StagingInventory {
  return inventory([
    page({ wordpressPageId: 501, slug: "taquillas-vestuario" }),
    // Misma slug, otra URL (subsitio/carpeta distinta): existe de verdad
    // en instalaciones con paginas anidadas.
    page({ wordpressPageId: 502, slug: "taquillas-vestuario", stagingUrl: `${STAGING_HOST}/sectores/taquillas-vestuario/` }),
  ]);
}

function draftOf(overrides: Partial<WebEngineerChangePlanDraft> = {}): WebEngineerChangePlanDraft {
  return {
    recommendationId: `${RUN_ID}#rec-1`,
    targetPage: `${STAGING_HOST}/taquillas-para-hospitales/`,
    operation: "update_post_title",
    newValue: "Taquillas para hospitales | Zentry Lockers",
    rationale: "Quick win de la recomendacion aprobada.",
    ...overrides,
  };
}

// --- Inventario REAL de la pasada ---------------------------------------

function realInventory(): StagingInventory {
  const fixturePath = path.join(__dirname, "fixtures", `staging-inventory-${RUN_ID}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as StagingInventory;
}

function realPage(id: number): StagingPageSnapshot {
  const found = realInventory().pages.find((p) => p.wordpressPageId === id);
  if (!found) throw new Error(`Fixture real roto: falta la pagina ${id}.`);
  return found;
}

function buildReal(overrides: Partial<WebEngineerChangePlanDraft>): ResolvedChangePlan {
  return buildChangePlanFromDraft({ draft: draftOf(overrides), inventory: realInventory() });
}

/** Extrae el sobre ejecutable de un resultado que DEBE estar READY_TO_EXECUTE. */
function readyPlan(result: ResolvedChangePlan): ExecutableChangePlan {
  assert.equal(result.executionStatus, "READY_TO_EXECUTE", `deberia estar READY_TO_EXECUTE y esta en ${result.executionStatus}: ${result.reason}`);
  assert.equal(result.status, "ACTIONABLE", "READY_TO_EXECUTE y ACTIONABLE son el mismo estado con dos vocabularios");
  assert.notEqual(result.executablePlan, null, "un plan READY_TO_EXECUTE tiene que traer su sobre ejecutable");
  return result.executablePlan as ExecutableChangePlan;
}

export function runExecutableChangePlanTests(): TestCase[] {
  return [
    // --- A. URL exacta -> page_id unico -------------------------------------
    {
      name: "A. URL exacta de staging -> UN page_id real -> READY_TO_EXECUTE (caso real: /taquillas-para-hospitales/, page 1821)",
      fn: () => {
        const result = buildReal({ targetPage: `${STAGING_HOST}/taquillas-para-hospitales/` });
        const plan = readyPlan(result);

        assert.equal(plan.target.pageId, 1821);
        assert.equal(plan.target.url, `${STAGING_HOST}/taquillas-para-hospitales/`);
        assert.equal(plan.target.postType, "page");
        assert.equal(plan.target.environment, "staging");
        assert.equal(plan.environment, "staging");
        assert.match(plan.target.resolvedBy, /URL exacta de staging/);
        assert.equal(plan.contractVersion, EXECUTABLE_CHANGE_PLAN_CONTRACT_VERSION);
        assert.equal(plan.status, "READY_TO_EXECUTE");
        assert.equal(plan.recommendationId, `${RUN_ID}#rec-1`);
        assert.equal(plan.changePlanId, buildChangePlanId(`${RUN_ID}#rec-1`, "update_post_title", 1821));
        // El plan de bajo nivel sigue siendo el que consume el executor.
        assert.equal(validateExecutePhpChangePlan(plan.executePhpPlan).ok, true);
        assert.equal(plan.executePhpPlan.targetId, 1821);
      },
    },

    // --- A2. URL de PRODUCCION -> misma ruta en staging ----------------------
    {
      name: "A2. Una recomendacion escrita sobre la URL de PRODUCCION resuelve por ruta exacta contra la pagina de staging (caso real: las recomendaciones citan zentrylockers.com, el inventario es staging.zentrylockers.com)",
      fn: () => {
        const resolution = resolveExecutionTarget(`${PRODUCTION_HOST}/taquillas-para-colegios/`, realInventory());

        assert.equal(resolution.outcome, "RESOLVED");
        assert.equal(resolution.method, "exact_path");
        assert.equal(resolution.page?.wordpressPageId, 127);
        assert.match(resolution.reason, /ruta exacta/);
        assert.match(resolution.reason, /apunta a otro entorno/);
      },
    },

    // --- B. page_id explicito existente -------------------------------------
    {
      name: "B. page_id explicito y existente -> PASS; un page_id que no esta en el inventario NO se acepta",
      fn: () => {
        const ok = resolveExecutionTarget("page_id=1821", realInventory());
        assert.equal(ok.outcome, "RESOLVED");
        assert.equal(ok.method, "explicit_page_id");
        assert.equal(ok.page?.wordpressPageId, 1821);

        const plan = readyPlan(buildReal({ targetPage: "page_id=1821" }));
        assert.equal(plan.target.pageId, 1821);

        // Un id inventado no existe por muy bien formado que este.
        const invented = resolveExecutionTarget("page_id=999999", realInventory());
        assert.equal(invented.outcome, "UNRESOLVED_TARGET");
        assert.equal(invented.page, null);
        assert.match(invented.reason, /no existe en el inventario real de staging/);

        const failClosed = buildReal({ targetPage: "page_id=999999" });
        assert.equal(failClosed.executionStatus, "UNRESOLVED_TARGET");
        assert.equal(failClosed.executablePlan, null);
        assert.equal(failClosed.plan, null);
      },
    },

    // --- C. Slug ambiguo -> FAIL CLOSED --------------------------------------
    {
      name: "C. Slug que casa con DOS paginas -> AMBIGUOUS_TARGET, sin plan y sin elegir la primera",
      fn: () => {
        const resolution = resolveExecutionTarget("taquillas-vestuario", ambiguousInventory());

        assert.equal(resolution.outcome, "AMBIGUOUS_TARGET");
        assert.equal(resolution.page, null, "ambiguo NUNCA devuelve una pagina: elegir seria adivinar");
        assert.deepEqual(resolution.candidateIds, [501, 502], "los candidatos se reportan para que un humano decida");
        assert.match(resolution.reason, /casa con 2 paginas/);

        const result = buildChangePlanFromDraft({
          draft: draftOf({ targetPage: "taquillas-vestuario" }),
          inventory: ambiguousInventory(),
        });
        assert.equal(result.executionStatus, "AMBIGUOUS_TARGET");
        assert.equal(result.status, "MANUAL");
        assert.equal(result.executablePlan, null);
        assert.equal(result.plan, null);
        assert.equal(result.page, null);
      },
    },

    // --- C2. Varias paginas en la MISMA referencia ---------------------------
    {
      name: "C2. `affectedPages` no es `executionTarget`: una referencia que enumera varias paginas es AMBIGUOUS_TARGET, no un cambio con 7 destinos",
      fn: () => {
        const many = [
          `${PRODUCTION_HOST}/taquillas-para-colegios/`,
          `${PRODUCTION_HOST}/taquillas-para-hospitales/`,
          `${PRODUCTION_HOST}/taquillas-melamina/`,
        ].join(", ");

        assert.equal(countDistinctReferences(many), 3);
        assert.equal(countDistinctReferences(`${STAGING_HOST}/taquillas-para-colegios/`), 1);
        assert.equal(countDistinctReferences("taquillas-para-colegios"), 1);
        assert.equal(countDistinctReferences("taquillas-para-colegios, taquillas-para-hospitales"), 2);

        const resolution = resolveExecutionTarget(many, realInventory());
        assert.equal(resolution.outcome, "AMBIGUOUS_TARGET");
        assert.match(resolution.reason, /menciona 3 destinos distintos/);
        assert.match(resolution.reason, /un plan por destino/);

        const result = buildReal({ targetPage: many });
        assert.equal(result.executionStatus, "AMBIGUOUS_TARGET");
        assert.equal(result.executablePlan, null);

        // Y el reparto correcto SI funciona: un plan por destino, cada uno
        // con su pageId real.
        const perTarget = [
          { targetPage: `${PRODUCTION_HOST}/taquillas-para-colegios/`, expectedId: 127 },
          { targetPage: `${PRODUCTION_HOST}/taquillas-para-hospitales/`, expectedId: 1821 },
          { targetPage: `${PRODUCTION_HOST}/taquillas-melamina/`, expectedId: 470 },
        ].map((entry, index) =>
          readyPlan(
            buildReal({
              recommendationId: `${RUN_ID}#rec-4`,
              targetPage: entry.targetPage,
              newValue: `Taquillas ${index + 1} | Zentry Lockers`,
            })
          )
        );
        assert.deepEqual(
          perTarget.map((p) => p.target.pageId),
          [127, 1821, 470]
        );
        assert.equal(new Set(perTarget.map((p) => p.changePlanId)).size, 3, "un changePlanId distinto por destino");
      },
    },

    // --- D. URL inexistente -> FAIL CLOSED -----------------------------------
    {
      name: "D. URL que no existe en staging -> UNRESOLVED_TARGET (caso real: /cerraduras/, en papelera desde O22)",
      fn: () => {
        const result = buildReal({ targetPage: `${PRODUCTION_HOST}/cerraduras/` });

        assert.equal(result.executionStatus, "UNRESOLVED_TARGET");
        assert.equal(result.status, "MANUAL");
        assert.equal(result.executablePlan, null, "fail-closed: sin destino no hay plan");
        assert.equal(result.plan, null);
        assert.equal(result.page, null);
        assert.match(result.reason, /no casa con ninguna pagina del inventario real de staging/);
        assert.match(result.reason, /No se adivina el destino de una escritura/);
        // Y no ha caido en la pagina "parecida" (cerraduras-inteligentes-taquillas).
        assert.ok(!result.reason.includes("1865"), "no puede sugerir una pagina parecida como destino");
      },
    },

    // --- E. BEFORE leido de verdad -------------------------------------------
    {
      name: "E. El BEFORE sale de la lectura real, no del modelo: title, excerpt y contenido coinciden con el inventario de la pasada",
      fn: () => {
        const real1821 = realPage(1821);

        const titlePlan = readyPlan(buildReal({ operation: "update_post_title", newValue: "Taquillas para hospitales | Zentry Lockers" }));
        assert.equal(titlePlan.before.post_title, real1821.title);
        assert.equal(titlePlan.before.post_title, "Taquillas para hospitales");

        const excerptPlan = readyPlan(
          buildReal({
            targetPage: `${PRODUCTION_HOST}/taquillas-para-colegios/`,
            operation: "update_post_excerpt",
            newValue: "Taquillas para colegios resistentes y seguras. Pide presupuesto sin compromiso.",
          })
        );
        assert.equal(excerptPlan.before.post_excerpt, realPage(127).excerpt, "el excerpt real de la 127 es cadena vacia, y eso es un BEFORE leido, no inventado");

        const contentPlan = readyPlan(
          buildReal({
            operation: "update_post_content",
            newValue: "<!-- wp:paragraph --><p>Cuerpo nuevo propuesto para la pagina de hospitales.</p><!-- /wp:paragraph -->",
          })
        );
        assert.equal(contentPlan.before.post_content, real1821.contentHtml);
        assert.ok(contentPlan.before.post_content.length > 1000, "el BEFORE de contenido es el HTML real completo, no un resumen");

        // El ancla de version tambien sale de la pagina leida.
        const anchor = titlePlan.preconditions.find((p) => p.kind === "version_hash_matches");
        assert.equal(anchor?.expected, versionHashOfPage(real1821));
        assert.equal(titlePlan.executePhpPlan.expectedBeforeHash, versionHashOfPage(real1821));
      },
    },

    // --- E2. BEFORE que NO se pudo leer --------------------------------------
    {
      name: "E2. Yoast: el inventario real NO observo `_yoast_wpseo_title`, asi que el plan es BEFORE_UNAVAILABLE en vez de fingir un BEFORE vacio",
      fn: () => {
        const real = realPage(1821);
        assert.deepEqual(real.meta, {}, "la lectura real de la pasada devolvio meta vacio para todas las paginas");
        assert.equal(metaValueObserved(real, "_yoast_wpseo_title"), false);

        const result = buildReal({
          operation: "update_post_meta",
          metaKey: "_yoast_wpseo_title",
          newValue: "Taquillas para hospitales | Zentry Lockers",
        });

        assert.equal(result.executionStatus, "BEFORE_UNAVAILABLE");
        assert.equal(result.executablePlan, null, "sin BEFORE real no hay rollback fiable, asi que no hay plan");
        assert.equal(result.page?.wordpressPageId, 1821, "el destino SI se resolvio: lo que falta es el estado actual del campo");
        assert.match(result.reason, /show_in_rest/);
        assert.match(result.reason, /rollback/);

        // Con una lectura que SI observo la clave, el mismo draft es ejecutable.
        const observed = inventory([
          page({
            wordpressPageId: 1821,
            slug: "taquillas-para-hospitales",
            meta: { _yoast_wpseo_title: "Taquillas hospitales" },
            metaObservedKeys: ["_yoast_wpseo_title"],
          }),
        ]);
        const withMeta = buildChangePlanFromDraft({
          draft: draftOf({ operation: "update_post_meta", metaKey: "_yoast_wpseo_title", newValue: "Taquillas para hospitales | Zentry Lockers" }),
          inventory: observed,
        });
        const plan = readyPlan(withMeta);
        assert.equal(plan.before._yoast_wpseo_title, "Taquillas hospitales");
        assert.equal(plan.rollback.targetExistedBefore, true);
      },
    },

    // --- F. AFTER concreto -> READY_TO_EXECUTE -------------------------------
    {
      name: "F. AFTER concreto -> READY_TO_EXECUTE con before/after/preconditions/validation/rollback completos",
      fn: () => {
        const after = "Taquillas para hospitales | Zentry Lockers";
        const plan = readyPlan(buildReal({ operation: "update_post_title", newValue: after }));

        assert.deepEqual(plan.after, { post_title: after });
        assert.deepEqual(plan.before, { post_title: "Taquillas para hospitales" });
        assert.equal(plan.operation, "update_post_title");

        // Preconditions: las 4, y todas con un valor esperado real.
        assert.deepEqual(
          plan.preconditions.map((p) => p.kind),
          ["page_exists", "page_status_is", "version_hash_matches", "field_equals"]
        );
        assert.equal(plan.preconditions.find((p) => p.kind === "page_status_is")?.expected, "publish");
        assert.equal(plan.preconditions.find((p) => p.kind === "field_equals")?.expected, "Taquillas para hospitales");
        for (const precondition of plan.preconditions) {
          assert.ok(precondition.description.trim().length > 0, `precondition ${precondition.kind} sin explicacion`);
        }

        // Validacion: se relee el campo, nada fuera del scope cambia, y el status se queda igual.
        assert.deepEqual(
          plan.validation.map((v) => v.kind),
          ["field_equals", "out_of_scope_unchanged", "page_status_unchanged"]
        );
        assert.equal(plan.validation.find((v) => v.kind === "field_equals")?.expected, after);
        assert.equal(plan.validation.find((v) => v.kind === "page_status_unchanged")?.expected, "publish");

        assert.equal(plan.observedAt, realInventory().capturedAt, "el plan dice de cuando es el estado que leyo");
      },
    },

    // --- G. AFTER insuficiente -> NEEDS_ENGINEERING_DETAIL -------------------
    {
      name: "G. Un AFTER que describe QUE hacer en vez de COMO queda -> NEEDS_ENGINEERING_DETAIL, nunca ejecutable",
      fn: () => {
        const vagos = [
          "Optimizar el meta title para la keyword objetivo",
          "Mejorar el titulo con la marca al final",
          "Reescribir el title para subir el CTR",
          "TBD",
          "Taquillas para hospitales | <PENDIENTE>",
        ];
        for (const vago of vagos) {
          const result = buildReal({ operation: "update_post_title", newValue: vago });
          assert.equal(result.executionStatus, "NEEDS_ENGINEERING_DETAIL", `"${vago}" no puede considerarse ejecutable`);
          assert.equal(result.status, "MANUAL");
          assert.equal(result.executablePlan, null);
          assert.ok(result.reason.trim().length > 0);
        }

        // Vacio y "identico al actual" tambien son falta de detalle, no un cambio.
        const vacio = buildReal({ operation: "update_post_title", newValue: "   " });
        assert.equal(vacio.executionStatus, "NEEDS_ENGINEERING_DETAIL");

        const igual = buildReal({ operation: "update_post_title", newValue: realPage(1821).title });
        assert.equal(igual.executionStatus, "NEEDS_ENGINEERING_DETAIL");
        assert.match(igual.reason, /identico al actual/);

        // Y un valor concreto de verdad SI pasa.
        assert.equal(assessAfterValue("update_post_title", "Taquillas para hospitales | Zentry Lockers", "Taquillas para hospitales").concrete, true);
        // El cuerpo de una pagina puede empezar por un verbo o traer HTML:
        // el filtro de "instruccion" solo aplica a campos cortos.
        assert.equal(
          assessAfterValue("update_post_content", "<!-- wp:paragraph --><p>Mejora la gestion de vestuarios.</p><!-- /wp:paragraph -->", "otro").concrete,
          true
        );
      },
    },

    // --- H. Operacion no soportada -> UNSUPPORTED_OPERATION -------------------
    {
      name: "H. Operacion fuera del catalogo, deshabilitada o con metaKey fuera de la allowlist -> UNSUPPORTED_OPERATION",
      fn: () => {
        const desconocida = buildReal({ operation: "delete_all_posts" });
        assert.equal(desconocida.executionStatus, "UNSUPPORTED_OPERATION");
        assert.equal(desconocida.executablePlan, null);

        for (const operation of ["create_page", "update_redirect", "update_term_assignment"]) {
          const result = buildReal({ operation, newValue: "Cualquier cosa concreta" });
          assert.equal(result.executionStatus, "UNSUPPORTED_OPERATION", operation);
          assert.match(result.reason, /no esta habilitada en esta fase/, operation);
        }

        const metaProhibida = buildReal({ operation: "update_post_meta", metaKey: "_wp_page_template", newValue: "plantilla-ancha.php" });
        assert.equal(metaProhibida.executionStatus, "UNSUPPORTED_OPERATION");
        assert.match(metaProhibida.reason, /allowlist/);
      },
    },

    // --- I. BEFORE cambia -> STALE -------------------------------------------
    {
      name: "I. Si staging cambia despues de construir el plan, las preconditions dejan de cumplirse y el plan es STALE",
      fn: () => {
        const plan = readyPlan(buildReal({ operation: "update_post_title", newValue: "Taquillas para hospitales | Zentry Lockers" }));
        const actual = realPage(1821);

        const fresh = evaluateChangePlanFreshness(plan, actual);
        assert.equal(fresh.fresh, true);
        assert.equal(fresh.status, "READY_TO_EXECUTE");
        assert.deepEqual(fresh.failedPreconditions, []);

        // Alguien edita el titulo entre la propuesta y la ejecucion.
        const editada: StagingPageSnapshot = { ...actual, title: "Taquillas para hospitales y clinicas" };
        const stale = evaluateChangePlanFreshness(plan, editada);
        assert.equal(stale.fresh, false);
        assert.equal(stale.status, "STALE");
        assert.equal(stale.failedPreconditions.length, 2, "cambian a la vez el hash de version y el valor del campo");
        assert.deepEqual(
          stale.failedPreconditions.map((p) => p.kind).sort(),
          ["field_equals", "version_hash_matches"]
        );
        assert.match(stale.reason, /Staging cambio despues de construir el plan/);

        // Un cambio en OTRO campo tambien invalida el ancla de version: el
        // AFTER se penso sobre otro estado de la pagina.
        const otroCampo: StagingPageSnapshot = { ...actual, contentHtml: `${actual.contentHtml}\n<!-- wp:paragraph --><p>Parrafo nuevo.</p><!-- /wp:paragraph -->` };
        const staleOtro = evaluateChangePlanFreshness(plan, otroCampo);
        assert.equal(staleOtro.status, "STALE");
        assert.deepEqual(
          staleOtro.failedPreconditions.map((p) => p.kind),
          ["version_hash_matches"]
        );

        // Y si la pagina ya no existe, tampoco se ejecuta.
        const desaparecida = evaluateChangePlanFreshness(plan, null);
        assert.equal(desaparecida.status, "STALE");
        assert.match(desaparecida.reason, /ya no existe en staging/);

        assert.equal(toProposalStatus("STALE"), "STALE");
      },
    },

    // --- J. El rollback reproduce el BEFORE ----------------------------------
    {
      name: "J. El rollback reproduce EXACTAMENTE el BEFORE leido, para las tres operaciones de campo y para meta",
      fn: () => {
        const casos: { operation: string; newValue: string; field: string; expectedBefore: string; metaKey?: string }[] = [
          { operation: "update_post_title", newValue: "Taquillas para hospitales | Zentry Lockers", field: "post_title", expectedBefore: realPage(1821).title },
          {
            operation: "update_post_excerpt",
            newValue: "Taquillas para hospitales con cierre seguro. Pide presupuesto.",
            field: "post_excerpt",
            expectedBefore: realPage(1821).excerpt,
          },
          {
            operation: "update_post_content",
            newValue: "<!-- wp:paragraph --><p>Cuerpo nuevo.</p><!-- /wp:paragraph -->",
            field: "post_content",
            expectedBefore: realPage(1821).contentHtml,
          },
        ];

        for (const caso of casos) {
          const plan = readyPlan(buildReal({ operation: caso.operation, newValue: caso.newValue }));
          assert.deepEqual(plan.rollback.values, { [caso.field]: caso.expectedBefore }, caso.operation);
          assert.deepEqual(plan.rollback.values, plan.before, `${caso.operation}: rollback y BEFORE tienen que ser el MISMO dato`);
          assert.equal(plan.rollback.operation, caso.operation);
          assert.equal(plan.rollback.strategy, caso.operation === "update_post_meta" ? "restore_post_meta" : "restore_post_field");
          assert.equal(plan.rollback.targetExistedBefore, true);
          assert.notDeepEqual(plan.rollback.values, plan.after, "revertir al AFTER no seria revertir");
        }

        // Meta que NO existia antes: revertir es BORRAR la clave, no
        // escribir cadena vacia.
        const sinClave = inventory([
          page({ wordpressPageId: 1821, slug: "taquillas-para-hospitales", meta: {}, metaObservedKeys: ["_yoast_wpseo_metadesc"] }),
        ]);
        const plan = readyPlan(
          buildChangePlanFromDraft({
            draft: draftOf({ operation: "update_post_meta", metaKey: "_yoast_wpseo_metadesc", newValue: "Taquillas para hospitales con cierre seguro." }),
            inventory: sinClave,
          })
        );
        assert.equal(plan.rollback.targetExistedBefore, false);
        assert.deepEqual(plan.rollback.values, { _yoast_wpseo_metadesc: "" });
        assert.match(plan.rollback.description, /BORRARLA/);
      },
    },

    // --- Taxonomia -----------------------------------------------------------
    {
      name: "La causa de NO ser ejecutable es un DATO, no una frase: cada estado tiene etiqueta y se proyecta al vocabulario grueso sin ambiguedad",
      fn: () => {
        for (const status of CHANGE_PLAN_EXECUTION_STATUSES) {
          assert.ok(CHANGE_PLAN_STATUS_LABEL[status]?.trim().length > 0, `falta etiqueta para ${status}`);
        }
        assert.equal(toProposalStatus("READY_TO_EXECUTE"), "ACTIONABLE");
        assert.equal(toProposalStatus("BLOCKED_BY_QA"), "BLOCKED");
        assert.equal(toProposalStatus("STALE"), "STALE");
        for (const status of ["UNRESOLVED_TARGET", "AMBIGUOUS_TARGET", "NEEDS_ENGINEERING_DETAIL", "UNSUPPORTED_OPERATION", "BEFORE_UNAVAILABLE", "TARGET_NOT_EXECUTABLE", "INVALID_PLAN"] as const) {
          assert.equal(toProposalStatus(status), "MANUAL", status);
        }
      },
    },

    // --- Inventario no leido -------------------------------------------------
    {
      name: "Sin inventario real no se resuelve nada: UNRESOLVED_TARGET citando por que el inventario esta vacio",
      fn: () => {
        const vacio: StagingInventory = {
          contractVersion: "staging-inventory/v1",
          capturedAt: "2026-08-16T19:11:32.958Z",
          pages: [],
          unavailableReason: "el REST de staging respondio HTTP 503",
        };
        const result = buildChangePlanFromDraft({ draft: draftOf(), inventory: vacio });

        assert.equal(result.executionStatus, "UNRESOLVED_TARGET");
        assert.equal(result.executablePlan, null);
        assert.match(result.reason, /HTTP 503/);
      },
    },

    // --- REGRESION de la causa raiz -----------------------------------------
    {
      name: "REGRESION: el contrato de web-engineer PIDE changePlans[] con destino unico y valor final -- que no lo pidiera era la causa raiz de que todo acabara en manual",
      fn: () => {
        const agentPath = path.join(__dirname, "..", ".claude", "agents", "web-engineer.md");
        const agent = fs.readFileSync(agentPath, "utf-8");

        assert.ok(agent.includes("changePlans"), "el contrato del agente debe documentar changePlans[]");
        assert.match(agent, /UN plan = UN destino/i, "debe exigir un destino unico por plan");
        assert.match(agent, /VALOR FINAL, no una instruccion/i, "debe exigir el valor final, no la intencion");
        assert.match(agent, /NUNCA pongas un `pageId`/i, "debe prohibir que el modelo aporte ids");

        // La contradiccion que impedia `update_post_content`: el contrato
        // prohibia generar bloques de Gutenberg, que es justo lo que esa
        // operacion necesita como valor final.
        assert.match(agent, /Excepcion explicita y unica/i, "debe permitir el valor final aunque sea contenido Gutenberg");

        // Y el JSON Schema que se le pasa por --json-schema dice lo mismo.
        const schemaPath = path.join(__dirname, "..", "config", "web-engineer-output.schema.json");
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as {
          properties: { changePlans: { description: string; items: { properties: Record<string, { description?: string; enum?: string[] }> } } };
        };
        const changePlans = schema.properties.changePlans;
        assert.match(changePlans.description, /UNA sola pagina/);
        assert.match(changePlans.items.properties.targetPage.description ?? "", /nunca una lista/i);
        assert.match(changePlans.items.properties.newValue.description ?? "", /Valor FINAL/i);
        assert.deepEqual(changePlans.items.properties.operation.enum, [
          "update_post_content",
          "update_post_title",
          "update_post_excerpt",
          "update_post_meta",
        ]);
      },
    },

    // --- Esta fase NO ejecuta ------------------------------------------------
    {
      name: "Esta fase termina ANTES del executor: ni el sobre ejecutable ni el script de inspeccion alcanzan WordPress",
      fn: () => {
        const sources = [
          path.join(__dirname, "..", "src", "department", "executable-change-plan.ts"),
          path.join(__dirname, "..", "scripts", "demo-executable-change-plans.ts"),
        ];
        // En el CODIGO: nada de red ni de comandos.
        const forbiddenInCode = ["fetch(", "child_process", "execSync", "spawnSync"];
        // En los IMPORTS: ningun executor ni adaptador. Se mira solo la
        // linea de import a proposito -- citar un modulo en un comentario
        // para explicar de donde sale una regla es legitimo; importarlo no.
        const forbiddenImports = ["execute-php-executor", "staging-executor", "production-executor", "adapters/", "novamira"];

        for (const source of sources) {
          const content = fs.readFileSync(source, "utf-8");
          for (const needle of forbiddenInCode) {
            assert.ok(!content.includes(needle), `${path.basename(source)} contiene "${needle}": esta fase no puede alcanzar ningun sistema externo.`);
          }
          const importLines = content.split("\n").filter((line) => /^\s*import\s/.test(line) || /require\(/.test(line));
          for (const needle of forbiddenImports) {
            assert.ok(
              !importLines.some((line) => line.includes(needle)),
              `${path.basename(source)} importa "${needle}": esta fase termina justo ANTES del executor.`
            );
          }
        }

        // Y construir un plan READY_TO_EXECUTE no lo ejecuta: es un objeto
        // JSON plano, sin ninguna funcion que escriba.
        const plan = readyPlan(buildReal({}));
        const roundTripped = JSON.parse(JSON.stringify(plan)) as ExecutableChangePlan;
        assert.deepEqual(roundTripped, plan, "el plan debe ser JSON plano: persistible tal cual (fichero, PostgreSQL o nada) sin rediseñarlo");
        assert.equal(typeof (plan as unknown as Record<string, unknown>).execute, "undefined");
      },
    },

    // --- El fixture es dato real --------------------------------------------
    {
      name: "El fixture de staging es una copia REAL de la pasada dept-2026-08-16T185140Z (ids, slugs y URLs del sitio, no inventados)",
      fn: () => {
        const real = realInventory();
        assert.equal(real.contractVersion, "staging-inventory/v1");
        assert.equal(real.capturedAt, "2026-08-16T19:11:32.958Z");
        assert.equal(real.unavailableReason, "");
        assert.equal(real.pages.length, 5);

        for (const p of real.pages) {
          assert.equal(p.status, "publish");
          assert.ok(p.stagingUrl.startsWith(`${STAGING_HOST}/`), `URL de staging real esperada y llego "${p.stagingUrl}"`);
          assert.ok(p.stagingUrl.includes(p.slug), "la URL real contiene el slug real");
          assert.ok(p.contentHtml.length > 0, "el contenido real esta completo, no recortado");
          assert.equal(postTypeOf(p), "page", "el inventario de la pasada es anterior a postType: postTypeOf() lo resuelve a page");
        }
        assert.deepEqual(
          real.pages.map((p) => p.wordpressPageId).sort((a, b) => a - b),
          [124, 127, 470, 1821, 1865]
        );
      },
    },
  ];
}
