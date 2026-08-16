import * as assert from "node:assert/strict";
import { buildPhpForPlan, PHP_RESULT_MARKER } from "../src/core/execute-php-builder";
import { EXECUTE_PHP_ACTOR, ExecutePhpRequest, isExecutePhpAllowed } from "../src/core/execute-php-guard";
import {
  ALLOWED_POST_META_KEYS,
  CapabilitySelection,
  EXECUTE_PHP_CONTRACT_VERSION,
  EXECUTE_PHP_OPERATIONS,
  ExecutePhpChangePlan,
  selectExecutionPath,
  validateExecutePhpChangePlan,
} from "../src/core/execute-php-operations";
import {
  applyChangePlanWithPhp,
  ExecutePhpContext,
  ExecutePhpDeps,
  PhpTargetState,
} from "../src/department/apply/execute-php-executor";
import {
  buildChangePlanFromDraft,
  parseChangePlanDrafts,
  ResolvedChangePlan,
  WebEngineerChangePlanDraft,
} from "../src/department/web-engineer-changeplan";
import {
  emptyStagingInventory,
  resolveStagingPage,
  StagingInventory,
  StagingPageSnapshot,
  summarizeInventoryForPrompt,
  versionHashOfPage,
} from "../src/department/staging-inventory";

export interface TestCase {
  name: string;
  /**
   * El runner (`scripts/run-tests.ts`) hace `await testCase.fn()`. Aqui
   * hay tests que ejercitan el executor (`async`), y sin esto sus fallos
   * pasarian en silencio.
   */
  fn: () => void | Promise<void>;
}

// --- Fixtures ------------------------------------------------------------

const RUN_ID = "dept-2026-08-16";

/** Cuerpo REAL de la 1867: bloques nativos (`core/heading` + `core/paragraph`). */
const PAGE_1867_CONTENT = [
  "<!-- wp:heading --><h2>Problemas habituales</h2><!-- /wp:heading -->",
  "<!-- wp:paragraph --><p>Las taquillas de vestuario acumulan llaves perdidas y candados forzados.</p><!-- /wp:paragraph -->",
].join("\n");

/** Cuerpo REAL de la 2077: SOLO bloques dinamicos `novamira/*`. */
const PAGE_2077_CONTENT =
  '<!-- wp:novamira/hero {"titulo":"Configurador de bancos"} /--><!-- wp:novamira/configurador {"familia":"bancos"} /-->';

const PAGE_999_CONTENT = "<!-- wp:paragraph --><p>Borrador sin terminar.</p><!-- /wp:paragraph -->";

/** Propuesta con un H2 nativo: el caso que la ability nativa RECHAZA. */
const NEW_CORE_HEADING_CONTENT = [
  "<!-- wp:heading --><h2>Problemas habituales en vestuarios de gimnasio</h2><!-- /wp:heading -->",
  "<!-- wp:paragraph --><p>Las taquillas de vestuario acumulan llaves perdidas y candados forzados.</p><!-- /wp:paragraph -->",
].join("\n");

/** Propuesta compuesta solo por bloques `novamira/*`: la nativa SI la soporta. */
const NEW_NOVAMIRA_ONLY_CONTENT =
  '<!-- wp:novamira/hero {"titulo":"Configurador de bancos de vestuario"} /--><!-- wp:novamira/configurador {"familia":"bancos"} /-->';

const STAGING_HOST = "https://staging.zentrylockers.com";

function inventory(): StagingInventory {
  return {
    contractVersion: "staging-inventory/v1",
    capturedAt: "2026-08-16T08:00:00.000Z",
    unavailableReason: "",
    pages: [
      {
        wordpressPageId: 1867,
        slug: "digitalizacion-taquillas",
        stagingUrl: `${STAGING_HOST}/digitalizacion-taquillas/`,
        status: "publish",
        title: "Digitalizacion de taquillas",
        excerpt: "Como pasar de la llave al control digital en vestuarios.",
        contentHtml: PAGE_1867_CONTENT,
        meta: {
          _yoast_wpseo_title: "Digitalizacion de taquillas | Zentry",
          _yoast_wpseo_metadesc: "Control digital de taquillas de vestuario para gimnasios y empresas.",
        },
      },
      {
        wordpressPageId: 2077,
        slug: "configurador-bancos",
        stagingUrl: `${STAGING_HOST}/configurador-bancos/`,
        status: "publish",
        title: "Configurador de bancos de vestuario",
        excerpt: "Configura el banco de vestuario que necesitas.",
        contentHtml: PAGE_2077_CONTENT,
        meta: { _yoast_wpseo_title: "Configurador de bancos | Zentry" },
      },
      {
        wordpressPageId: 999,
        slug: "borrador-x",
        stagingUrl: `${STAGING_HOST}/borrador-x/`,
        status: "draft",
        title: "Borrador X",
        excerpt: "Pendiente de redactar.",
        contentHtml: PAGE_999_CONTENT,
        meta: {},
      },
    ],
  };
}

function pageOf(id: number): StagingPageSnapshot {
  const page = inventory().pages.find((candidate) => candidate.wordpressPageId === id);
  if (!page) throw new Error(`Fixture roto: la pagina ${id} no esta en el inventario de prueba.`);
  return page;
}

function draft(overrides: Partial<WebEngineerChangePlanDraft> = {}): WebEngineerChangePlanDraft {
  return {
    recommendationId: `${RUN_ID}#rec-1`,
    targetPage: `${STAGING_HOST}/digitalizacion-taquillas/`,
    operation: "update_post_content",
    newValue: NEW_CORE_HEADING_CONTENT,
    rationale: "Growth pidio concretar el H2 para la intencion de busqueda de vestuarios de gimnasio.",
    ...overrides,
  };
}

function build(overrides: Partial<WebEngineerChangePlanDraft> = {}, inv: StagingInventory = inventory()): ResolvedChangePlan {
  return buildChangePlanFromDraft({ draft: draft(overrides), inventory: inv });
}

/** Extrae el plan de un resultado que DEBE ser ACTIONABLE, comprobandolo primero. */
function actionablePlan(result: ResolvedChangePlan): ExecutePhpChangePlan {
  assert.equal(result.status, "ACTIONABLE", `deberia ser ACTIONABLE y es ${result.status}: ${result.reason}`);
  assert.notEqual(result.plan, null, "un resultado ACTIONABLE tiene que traer un plan ejecutable");
  return result.plan as ExecutePhpChangePlan;
}

function actionableCapability(result: ResolvedChangePlan): CapabilitySelection {
  assert.notEqual(result.capability, null, "un resultado ACTIONABLE tiene que traer su seleccion de capacidad");
  return result.capability as CapabilitySelection;
}

/** El mismo estado, visto como lo lee el executor de WordPress. */
function stateOfPage(page: StagingPageSnapshot, overrides: Partial<PhpTargetState> = {}): PhpTargetState {
  return {
    id: page.wordpressPageId,
    status: page.status,
    title: page.title,
    contentHtml: page.contentHtml,
    excerpt: page.excerpt,
    link: page.stagingUrl,
    slug: page.slug,
    meta: { ...page.meta },
    ...overrides,
  };
}

interface FakeWorld {
  deps: ExecutePhpDeps;
  /** PHP recibido por `runPhp`, en orden. Su longitud es "cuantas escrituras se intentaron". */
  phpCalls: string[];
  counters: { reads: number };
}

/** Doble de WordPress: `states` se consume en orden y el ultimo se repite. */
function fakeWorld(states: PhpTargetState[]): FakeWorld {
  const phpCalls: string[] = [];
  const counters = { reads: 0 };
  const deps: ExecutePhpDeps = {
    getState: async () => {
      const state = states[Math.min(counters.reads, states.length - 1)];
      counters.reads += 1;
      return state;
    },
    runPhp: async (php: string) => {
      phpCalls.push(php);
      const payload = Buffer.from(JSON.stringify({ ok: true }), "utf8").toString("base64");
      return `${PHP_RESULT_MARKER}${payload}${PHP_RESULT_MARKER}`;
    },
    now: () => new Date("2026-08-16T09:00:00.000Z"),
  };
  return { deps, phpCalls, counters };
}

function contextFor(capability: CapabilitySelection): ExecutePhpContext {
  return {
    departmentRunId: RUN_ID,
    recommendationId: `${RUN_ID}#rec-1`,
    changeId: `${RUN_ID}#change-1`,
    qaStatus: "PASS",
    capabilitySelection: capability,
    flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "staging" },
  };
}

/** Peticion COMPLETA al guard a partir de un plan ya ACTIONABLE. */
function requestFor(plan: ExecutePhpChangePlan, capability: CapabilitySelection, overrides: Partial<ExecutePhpRequest> = {}): ExecutePhpRequest {
  return {
    actor: EXECUTE_PHP_ACTOR,
    abilityName: "novamira/execute-php",
    environment: "staging",
    phase: "apply",
    qaStatus: "PASS",
    departmentRunId: RUN_ID,
    recommendationId: `${RUN_ID}#rec-1`,
    changeId: `${RUN_ID}#change-1`,
    plan,
    php: buildPhpForPlan(plan),
    capabilitySelection: capability,
    flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "staging" },
    ...overrides,
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key] as string;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key] as string;
    }
  }
}

export function runWebEngineerChangePlanTests(): TestCase[] {
  return [
    // --- 1. El pageId sale del inventario REAL ---------------------------
    {
      name: "Web Engineer resuelve un pageId REAL: la URL exacta de staging da la pagina 1867 y el plan apunta a ese id",
      fn: () => {
        const resolution = resolveStagingPage(`${STAGING_HOST}/digitalizacion-taquillas/`, inventory());
        assert.notEqual(resolution.page, null, "la URL exacta tiene que resolver");
        assert.equal((resolution.page as StagingPageSnapshot).wordpressPageId, 1867);
        assert.match(resolution.reason, /Resuelta por URL exacta de staging \(page 1867\)/);

        const result = build();
        const plan = actionablePlan(result);
        assert.equal(result.page?.wordpressPageId, 1867, "la pagina resuelta es la 1867");
        assert.equal(plan.targetId, 1867, "el targetId sale del inventario, no del draft");
        assert.equal(result.beforeValue, PAGE_1867_CONTENT, "el BEFORE es el contenido REAL leido");
        assert.equal(result.afterValue, NEW_CORE_HEADING_CONTENT);
        assert.match(result.reason, /post 1867/);
      },
    },

    // --- 2. Slug exacto y page_id ----------------------------------------
    {
      name: "Resolucion por slug exacto y por page_id=1867: las dos llegan a la misma pagina 1867",
      fn: () => {
        const bySlug = resolveStagingPage("digitalizacion-taquillas", inventory());
        assert.equal(bySlug.page?.wordpressPageId, 1867);
        assert.match(bySlug.reason, /Resuelta por slug exacto "digitalizacion-taquillas" \(page 1867\)/);

        const byId = resolveStagingPage("page_id=1867", inventory());
        assert.equal(byId.page?.wordpressPageId, 1867);
        assert.match(byId.reason, /Resuelta por id explicito \(1867\)/);

        // Y el constructor llega al mismo plan por los dos caminos.
        const slugPlan = actionablePlan(build({ targetPage: "digitalizacion-taquillas" }));
        const idPlan = actionablePlan(build({ targetPage: "page_id=1867" }));
        assert.equal(slugPlan.targetId, 1867);
        assert.equal(idPlan.targetId, 1867);
        assert.equal(slugPlan.expectedBeforeHash, idPlan.expectedBeforeHash);

        // Un id que NO esta en el inventario no se resuelve (no se adivina).
        const missing = resolveStagingPage("page_id=4242", inventory());
        assert.equal(missing.page, null);
        assert.match(missing.reason, /El id 4242 no existe en el inventario real de staging/);
      },
    },

    // --- 3. ChangePlan valido y anclado a la version LEIDA ----------------
    {
      name: "ChangePlan valido: ACTIONABLE, valida contra el contrato y el expectedBeforeHash se calcula de la pagina leida (nunca del draft)",
      fn: () => {
        const page = pageOf(1867);
        const result = build();
        const plan = actionablePlan(result);

        assert.equal(plan.contractVersion, EXECUTE_PHP_CONTRACT_VERSION);
        assert.equal(plan.operation, "update_post_content");
        assert.deepEqual(plan.scopeFields, ["post_content"]);
        assert.deepEqual(plan.payload, { value: NEW_CORE_HEADING_CONTENT });
        const validation = validateExecutePhpChangePlan(plan);
        assert.equal(validation.ok, true, validation.reason);
        assert.equal(validation.reason, "");
        assert.equal(plan.expectedBeforeHash, versionHashOfPage(page), "el ancla de version es la de la pagina REAL");
        assert.match(plan.expectedBeforeHash, /^[0-9a-f]{64}$/);

        // El draft NO tiene campo de hash, y si alguien se lo inventa, se
        // IGNORA: el ancla se lee, no se declara.
        const fake = "f".repeat(64);
        const forged = buildChangePlanFromDraft({
          draft: { ...draft(), expectedBeforeHash: fake, targetId: 999 } as unknown as WebEngineerChangePlanDraft,
          inventory: inventory(),
        });
        const forgedPlan = actionablePlan(forged);
        assert.notEqual(forgedPlan.expectedBeforeHash, fake, "el hash declarado por el draft no puede acabar en el plan");
        assert.equal(forgedPlan.expectedBeforeHash, versionHashOfPage(page));
        assert.equal(forgedPlan.targetId, 1867, "tampoco un targetId declarado por el draft");
      },
    },

    // --- 4. Pagina no resoluble ------------------------------------------
    {
      name: "Una URL que no existe en el inventario deja la propuesta en MANUAL y NO cae en ninguna pagina parecida",
      fn: () => {
        const result = build({ targetPage: `${STAGING_HOST}/no-existe/` });

        assert.equal(result.status, "MANUAL");
        assert.equal(result.plan, null, "MANUAL nunca trae plan");
        assert.equal(result.capability, null);
        assert.equal(result.page, null, "no se puede haber caido en NINGUNA pagina del inventario");
        assert.match(result.reason, /No se pudo resolver la pagina objetivo/);
        assert.match(result.reason, /no casa con ninguna pagina del inventario real de staging \(3 paginas leidas\)/);
        assert.match(result.reason, /No se adivina el destino de una escritura/);
        // Y no ha "casi" resuelto a la 1867 ni a la 2077.
        assert.ok(!result.reason.includes("1867"), "el motivo no puede sugerir la 1867 como destino");
        assert.ok(!result.reason.includes("2077"), "el motivo no puede sugerir la 2077 como destino");
      },
    },

    // --- 5. Inventario vacio ---------------------------------------------
    {
      name: "Inventario vacio: sin evidencia leida no se resuelve ningun pageId y la propuesta queda MANUAL",
      fn: () => {
        const empty = emptyStagingInventory("la REST de staging devolvio 503", "2026-08-16T08:00:00.000Z");
        const result = build({}, empty);

        assert.equal(result.status, "MANUAL");
        assert.equal(result.plan, null);
        assert.equal(result.page, null);
        assert.match(result.reason, /El inventario de staging esta vacio/);
        assert.match(result.reason, /la REST de staging devolvio 503/, "el motivo debe citar por que esta vacio");
        assert.match(result.reason, /Sin inventario real no se resuelve ningun pageId/);

        // Incluso citando un id literal: sin inventario no hay nada contra
        // lo que comprobarlo.
        const withLiteralId = build({ targetPage: "page_id=1867" }, empty);
        assert.equal(withLiteralId.status, "MANUAL");
        assert.equal(withLiteralId.page, null);
        assert.match(withLiteralId.reason, /El inventario de staging esta vacio/);
      },
    },

    // --- 6. Pagina en borrador -------------------------------------------
    {
      name: "Una pagina en draft (999) no se toca: MANUAL citando que su status no es publish",
      fn: () => {
        const result = build({ targetPage: "borrador-x", newValue: NEW_CORE_HEADING_CONTENT });

        assert.equal(result.status, "MANUAL");
        assert.equal(result.plan, null);
        assert.equal(result.capability, null);
        assert.equal(result.page?.wordpressPageId, 999, "la pagina SI se resolvio: el problema es su status");
        assert.match(result.reason, /La pagina 999 tiene status "draft" y no "publish"/);
        assert.match(result.reason, /solo actua sobre paginas de staging publicadas/);
      },
    },

    // --- 7. Camino NATIVO --------------------------------------------------
    {
      name: "Contenido solo de bloques novamira/* sobre la 2077: ACTIONABLE por la ability nativa (native_ability)",
      fn: () => {
        const result = build({ targetPage: "configurador-bancos", newValue: NEW_NOVAMIRA_ONLY_CONTENT });
        const plan = actionablePlan(result);
        const capability = actionableCapability(result);

        assert.equal(plan.targetId, 2077);
        assert.equal(capability.executionPath, "native_ability");
        assert.equal(capability.nativeAbility, "novamira/gutenberg-write-content");
        assert.equal(capability.nativeAbilityUnsuitableReason, "", "si la nativa sirve no hay nada que justificar");
        assert.match(capability.reason, /PHP no se usa por comodidad/);
        assert.match(result.reason, /Camino: native_ability/);
        // La eleccion se deriva del plan, no de quien llama.
        assert.deepEqual(capability, selectExecutionPath({ plan }));
      },
    },

    // --- 8. Nativa incompatible -> fallback de PHP -------------------------
    {
      name: "Contenido con bloques core/* sobre la 1867: la nativa no sirve y el camino es execute_php_fallback citando core/heading",
      fn: () => {
        const result = build();
        const plan = actionablePlan(result);
        const capability = actionableCapability(result);

        assert.equal(plan.targetId, 1867);
        assert.equal(capability.executionPath, "execute_php_fallback");
        assert.equal(capability.nativeAbility, "novamira/gutenberg-write-content");
        assert.match(capability.nativeAbilityUnsuitableReason, /core\/heading/, "el motivo cita el bloque concreto que la nativa rechaza");
        assert.match(capability.nativeAbilityUnsuitableReason, /core\/paragraph/);
        assert.match(capability.nativeAbilityUnsuitableReason, /dynamic-only/);
        assert.match(capability.reason, /NO soporta este cambio/);
        assert.match(result.reason, /Camino: execute_php_fallback/);
      },
    },

    // --- 9. core/heading ----------------------------------------------------
    {
      name: "Un H2 core/heading en la 1867 se enruta a execute_php_fallback",
      fn: () => {
        const onlyHeading = '<!-- wp:heading {"level":2} --><h2>Problemas habituales en vestuarios industriales</h2><!-- /wp:heading -->';
        const result = build({ newValue: onlyHeading });
        const capability = actionableCapability(result);

        assert.equal(actionablePlan(result).targetId, 1867);
        assert.equal(capability.executionPath, "execute_php_fallback");
        assert.match(capability.nativeAbilityUnsuitableReason, /core\/heading/);
        assert.ok(
          !capability.nativeAbilityUnsuitableReason.includes("core/paragraph"),
          "solo se cita el bloque que realmente aparece en el contenido propuesto"
        );
      },
    },

    // --- 10. core/paragraph -------------------------------------------------
    {
      name: "Un core/paragraph en la 1867 tambien se enruta a execute_php_fallback",
      fn: () => {
        const onlyParagraph = "<!-- wp:paragraph --><p>Las llaves perdidas cuestan tiempo de recepcion cada semana.</p><!-- /wp:paragraph -->";
        const result = build({ newValue: onlyParagraph });
        const capability = actionableCapability(result);

        assert.equal(capability.executionPath, "execute_php_fallback");
        assert.match(capability.nativeAbilityUnsuitableReason, /core\/paragraph/);
        assert.match(capability.nativeAbilityUnsuitableReason, /novamira\/\* dynamic-only/);
      },
    },

    // --- 11. Metadatos de Yoast ---------------------------------------------
    {
      name: "update_post_meta con una clave de Yoast es ACTIONABLE; una clave fuera de la allowlist queda MANUAL",
      fn: () => {
        const nuevaMeta = "Taquillas digitales para vestuarios: control de accesos sin llaves.";
        const ok = build({ operation: "update_post_meta", metaKey: "_yoast_wpseo_metadesc", newValue: nuevaMeta });
        const plan = actionablePlan(ok);
        const capability = actionableCapability(ok);

        assert.equal(plan.operation, "update_post_meta");
        assert.equal(plan.targetId, 1867);
        assert.deepEqual(plan.payload, { metaKey: "_yoast_wpseo_metadesc", value: nuevaMeta });
        assert.deepEqual(plan.scopeFields, ["post_meta"]);
        assert.equal(ok.beforeValue, pageOf(1867).meta._yoast_wpseo_metadesc, "el BEFORE es el valor real de la clave");
        // No hay ability nativa para meta: el fallback es el unico camino.
        assert.equal(capability.executionPath, "execute_php_fallback");
        assert.equal(capability.nativeAbility, null);
        assert.match(capability.reason, /No existe ninguna ability nativa/);

        const rejected = build({ operation: "update_post_meta", metaKey: "_wp_page_template", newValue: "plantilla-ancha.php" });
        assert.equal(rejected.status, "MANUAL");
        assert.equal(rejected.plan, null);
        assert.match(rejected.reason, /metaKey "_wp_page_template" no esta en la allowlist/);
        for (const key of ALLOWED_POST_META_KEYS) {
          assert.ok(rejected.reason.includes(key), `el motivo debe enumerar la allowlist completa (falta ${key})`);
        }
        assert.match(rejected.reason, /puerta para escribir en cualquier metadato del sitio/);
      },
    },

    // --- 12. Sin cambio real -------------------------------------------------
    {
      name: "Un valor identico al actual no es un cambio: MANUAL con 'no hay ningun cambio que aplicar'",
      fn: () => {
        const same = build({ newValue: PAGE_1867_CONTENT });
        assert.equal(same.status, "MANUAL");
        assert.equal(same.plan, null);
        assert.equal(same.page?.wordpressPageId, 1867);
        assert.match(same.reason, /identico al actual: no hay ningun cambio que aplicar/);

        // Tambien en meta: mismo valor, misma respuesta.
        const sameMeta = build({
          operation: "update_post_meta",
          metaKey: "_yoast_wpseo_title",
          newValue: pageOf(1867).meta._yoast_wpseo_title as string,
        });
        assert.equal(sameMeta.status, "MANUAL");
        assert.match(sameMeta.reason, /no hay ningun cambio que aplicar/);
      },
    },

    // --- 13. Operaciones fuera del catalogo o deshabilitadas ------------------
    {
      name: "Operacion desconocida y operacion deshabilitada (create_page) quedan MANUAL, cada una con su motivo",
      fn: () => {
        const unknown = build({ operation: "delete_all_posts" });
        assert.equal(unknown.status, "MANUAL");
        assert.equal(unknown.plan, null);
        assert.equal(unknown.page, null, "ni siquiera se resuelve la pagina: la operacion no existe");
        assert.match(unknown.reason, /Operacion "delete_all_posts" desconocida/);
        for (const operation of Object.keys(EXECUTE_PHP_OPERATIONS)) {
          assert.ok(unknown.reason.includes(operation), `el motivo debe enumerar el catalogo (falta ${operation})`);
        }

        const disabled = build({ operation: "create_page", newValue: "Pagina nueva de la familia bancos" });
        assert.equal(disabled.status, "MANUAL");
        assert.equal(disabled.plan, null);
        assert.match(disabled.reason, /La operacion "create_page" no esta habilitada en esta fase/);
        assert.match(disabled.reason, /APARTE en esta fase/, "debe decir exactamente que falta para habilitarla");
        assert.match(disabled.reason, /el rollback de una creacion es borrar la pagina/);

        // Las otras dos deshabilitadas del catalogo, igual.
        for (const operation of ["update_redirect", "update_term_assignment"]) {
          const result = build({ operation, newValue: "cualquier cosa" });
          assert.equal(result.status, "MANUAL", operation);
          assert.match(result.reason, new RegExp(`La operacion "${operation}" no esta habilitada`), operation);
        }
      },
    },

    // --- 14. Forma de los drafts ---------------------------------------------
    {
      name: "parseChangePlanDrafts descarta lo que no es un array, las claves desconocidas y los campos ausentes, y deja pasar el draft bien formado",
      fn: () => {
        const notArray = parseChangePlanDrafts({ recommendationId: "rec-1" });
        assert.deepEqual(notArray.drafts, []);
        assert.equal(notArray.rejected.length, 1);
        assert.match(notArray.rejected[0], /`changePlans` no es un array/);

        // Nulo/ausente no es un error: simplemente no hay propuestas.
        assert.deepEqual(parseChangePlanDrafts(undefined), { drafts: [], rejected: [] });
        assert.deepEqual(parseChangePlanDrafts(null), { drafts: [], rejected: [] });

        const good = {
          recommendationId: `${RUN_ID}#rec-1`,
          targetPage: `${STAGING_HOST}/digitalizacion-taquillas/`,
          operation: "update_post_content",
          newValue: NEW_CORE_HEADING_CONTENT,
          rationale: "Concretar el H2 para la intencion de busqueda.",
        };
        const parsed = parseChangePlanDrafts([
          good,
          { ...good, wordpressPageId: 1867 },
          { ...good, rationale: "   " },
          { ...good, newValue: 42 },
          "esto no es un objeto",
          { ...good, metaKey: 7 },
        ]);

        assert.equal(parsed.drafts.length, 1, "el draft bien formado sigue pasando pese a los vecinos malos");
        assert.deepEqual(parsed.drafts[0], good);
        assert.equal(parsed.rejected.length, 5, "un motivo por entrada rechazada");
        assert.match(parsed.rejected[0], /changePlans\[1\] trae la clave desconocida "wordpressPageId"/);
        assert.match(parsed.rejected[1], /changePlans\[2\] no trae "rationale" como texto no vacio/);
        assert.match(parsed.rejected[2], /changePlans\[3\] no trae "newValue" como texto no vacio/);
        assert.match(parsed.rejected[3], /changePlans\[4\] no es un objeto/);
        assert.match(parsed.rejected[4], /changePlans\[5\]\.metaKey no es texto/);

        // Y el draft bien formado, construido contra el inventario, es ejecutable.
        const result = buildChangePlanFromDraft({ draft: parsed.drafts[0], inventory: inventory() });
        assert.equal(actionablePlan(result).targetId, 1867);
      },
    },

    // --- 15. ACTIONABLE significa que el guard dice que SI ---------------------
    {
      name: "ACTIONABLE significa REALMENTE ejecutable: el plan de la 1867 pasa el guard de execute-php con allowed true",
      fn: () => {
        const result = build();
        const plan = actionablePlan(result);
        const capability = actionableCapability(result);

        const php = buildPhpForPlan(plan);
        const decision = isExecutePhpAllowed(requestFor(plan, capability, { php }));

        assert.equal(decision.allowed, true, `un ACTIONABLE que el guard rechaza no es ACTIONABLE: ${decision.reason}`);
        assert.equal(decision.failedCheck, null);
        assert.match(decision.reason, /Permitido: actor web_engineer_apply/);
        assert.match(decision.reason, /STAGING/);
        assert.match(decision.reason, /update_post_content/);
        assert.match(decision.reason, /post 1867/);

        // El plan de meta (test 11) tambien tiene que pasarlo.
        const metaResult = build({
          operation: "update_post_meta",
          metaKey: "_yoast_wpseo_metadesc",
          newValue: "Taquillas digitales para vestuarios: control de accesos sin llaves.",
        });
        const metaPlan = actionablePlan(metaResult);
        const metaDecision = isExecutePhpAllowed(requestFor(metaPlan, actionableCapability(metaResult)));
        assert.equal(metaDecision.allowed, true, metaDecision.reason);
        assert.equal(metaDecision.failedCheck, null);
      },
    },

    // --- 16. STALE -------------------------------------------------------------
    {
      name: "Si la pagina cambio desde la propuesta el plan es STALE y no se ejecuta ni un solo PHP",
      fn: async () => {
        const page = pageOf(1867);
        const result = build();
        const plan = actionablePlan(result);
        const capability = actionableCapability(result);

        // La 1867 se edito a mano en wp-admin: otro contenido, otro hash.
        const drifted = stateOfPage(page, { contentHtml: `${PAGE_1867_CONTENT}\n<!-- wp:paragraph --><p>Parrafo añadido a mano.</p><!-- /wp:paragraph -->` });
        const world = fakeWorld([drifted]);
        const outcome = await applyChangePlanWithPhp(plan, contextFor(capability), world.deps);

        assert.equal(outcome.status, "stale", outcome.detail);
        assert.equal(world.phpCalls.length, 0, "no se puede haber ejecutado ni un solo PHP");
        assert.equal(outcome.stagingWritePerformed, false);
        assert.equal(outcome.productionWritePerformed, false);
        assert.equal(outcome.validation, "not_run");
        assert.equal(outcome.rollback, "not_needed");
        assert.match(outcome.detail, /STALE/);
        assert.match(outcome.detail, new RegExp(plan.expectedBeforeHash.slice(0, 12)));
        assert.match(outcome.detail, /no se ejecuta nada/);
        assert.equal(outcome.audit.length, 1);
        assert.equal(outcome.audit[0].outcome, "blocked_by_guard");
      },
    },

    // --- 17. Validacion fallida -> rollback verificado --------------------------
    {
      name: "Si al releer el contenido sigue siendo el de antes, la validacion falla y el rollback se verifica contra el snapshot",
      fn: async () => {
        const page = pageOf(1867);
        const result = build();
        const plan = actionablePlan(result);
        const capability = actionableCapability(result);

        // Todas las lecturas devuelven el estado original: la escritura no
        // tuvo efecto real.
        const world = fakeWorld([stateOfPage(page)]);
        const outcome = await applyChangePlanWithPhp(plan, contextFor(capability), world.deps);

        assert.equal(outcome.status, "rolled_back", outcome.detail);
        assert.equal(outcome.validation, "failed");
        assert.equal(outcome.rollback, "rolled_back");
        assert.equal(outcome.stagingWritePerformed, true);
        assert.equal(outcome.productionWritePerformed, false);
        assert.equal(world.phpCalls.length, 2, "escritura + rollback");
        assert.equal(world.counters.reads, 3, "snapshot + validacion + verificacion del rollback");
        assert.match(outcome.detail, /el valor releido del scope no coincide con lo pedido/);
        assert.match(outcome.detail, /Rollback VERIFICADO/);
        assert.equal(outcome.afterValue, PAGE_1867_CONTENT, "la relectura del rollback es exactamente el snapshot");
        assert.equal(outcome.beforeValue, PAGE_1867_CONTENT);
        assert.equal(outcome.beforeHash, versionHashOfPage(page));
        assert.equal(outcome.afterHash, outcome.beforeHash, "la version releida vuelve a ser la de partida");
        assert.equal(outcome.audit[outcome.audit.length - 1].outcome, "rolled_back");
      },
    },

    // --- 18. Produccion ---------------------------------------------------------
    {
      name: "Produccion bloqueada aunque el plan sea ACTIONABLE y todo lo demas sea perfecto",
      fn: () => {
        const result = build();
        const plan = actionablePlan(result);
        const capability = actionableCapability(result);

        const decision = isExecutePhpAllowed(
          requestFor(plan, capability, {
            environment: "production",
            flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "production" },
          })
        );
        assert.equal(decision.allowed, false);
        assert.equal(decision.failedCheck, "production");
        assert.match(decision.reason, /BLOQUEADO: produccion/);
        assert.match(decision.reason, /bajo ninguna combinacion de flags ni aprobaciones/);

        // Y con el entorno declarado staging pero WORDPRESS_ENV=production,
        // sigue siendo produccion.
        const byFlag = isExecutePhpAllowed(
          requestFor(plan, capability, {
            flags: { executePhpFallbackEnabled: true, novamiraStagingWritesEnabled: true, wordpressEnv: "production" },
          })
        );
        assert.equal(byFlag.allowed, false);
        assert.equal(byFlag.failedCheck, "production");
      },
    },

    // --- 19. El resumen del prompt no lleva secretos ------------------------------
    {
      name: "El resumen del inventario para el prompt no lleva credenciales: ni claves password/token/secret ni el valor de ninguna variable de entorno",
      fn: () => {
        const fakePassword = "wp-staging-pa55-falsa-para-el-test";
        withEnv({ WP_API_PASSWORD: fakePassword }, () => {
          const summary = summarizeInventoryForPrompt(inventory());
          const serialized = JSON.stringify(summary);
          const lower = serialized.toLowerCase();

          for (const forbidden of ["password", "token", "secret"]) {
            assert.equal(lower.includes(forbidden), false, `el resumen no puede contener "${forbidden}"`);
          }
          assert.equal(serialized.includes(fakePassword), false, "el resumen no puede arrastrar el valor de WP_API_PASSWORD");
          // El bloque `meta` CRUDO de la pagina no sale nunca: podria
          // traer metadatos de cualquier plugin. Lo unico que se expone
          // son los DOS valores de la allowlist de Yoast, y como campos
          // propios y nombrados -- son el BEFORE de `update_post_meta`,
          // y sin ellos no se puede proponer un valor nuevo completo.
          assert.equal(serialized.includes('"meta":'), false, "el resumen no expone el bloque de metadatos crudos de la pagina");
          assert.deepEqual(
            [...new Set(summary.flatMap((brief) => Object.keys(brief).filter((key) => key.toLowerCase().startsWith("meta"))))],
            ["metaTitle", "metaDescription"]
          );

          // Y solo va lo que el prompt necesita: paginas PUBLICADAS.
          assert.deepEqual(
            summary.map((brief) => brief.wordpressPageId),
            [1867, 2077],
            "la 999 esta en draft y no entra en el prompt"
          );
          assert.deepEqual(summary[0].blockTypes, ["core/heading", "core/paragraph"]);
          assert.deepEqual(summary[0].h2Headings, ["Problemas habituales"]);
          assert.equal(summary[0].versionHash, versionHashOfPage(pageOf(1867)));
        });
      },
    },
  ];
}
