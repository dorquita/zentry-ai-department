import * as assert from "node:assert/strict";
import {
  buildExecutiveReportData,
  buildFallbackExecutiveReportMarkdown,
  buildPageClusters,
  ExecutiveReportInput,
  isLowQualityKeywordFragment,
  isUnvalidatedGeoFragment,
  MAX_DECISIONS,
  MAX_FINDINGS,
  MAX_LATER,
  MAX_NOW,
  normalizeKeywordForGrouping,
  renderExecutiveReportMarkdown,
  validateExecutiveReportCoherence,
} from "../src/core/executive-report";
import { ApprovalRequest, BacklogAction } from "../src/core/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

const TODAY = "2026-08-03";
const YESTERDAY = "2026-08-02T09:00:00.000Z";

function makeAction(overrides: Partial<BacklogAction> = {}): BacklogAction {
  return {
    actionId: nextId("action"),
    canonicalKey: nextId("key"),
    title: 'SEO: "taquillas de prueba" (https://zentrylockers.com/taquillas-prueba/)',
    description: "Descripcion de prueba.",
    sourceAgents: ["seo-director"],
    department: "web-growth",
    brandIntent: "zentry_locker_core",
    targetBrand: "zentry",
    keyword: "taquillas de prueba",
    page: "https://zentrylockers.com/taquillas-prueba/",
    actionType: "seo:quick_win",
    priority: "medium",
    status: "auto_approved_for_planning",
    requiresApproval: false,
    autonomyLevel: "AUTO_PLAN",
    riskLevel: "low_medium",
    autonomyReason: "test",
    recommendation: "Optimizar la pagina.",
    // Por defecto: accion ya existente de un dia anterior, recurrente
    // (seenCount>1) — es el caso mas comun del backlog real. Los tests
    // que necesiten "nuevo de hoy" lo overridean explicitamente.
    firstSeenAt: YESTERDAY,
    lastSeenAt: `${TODAY}T09:00:00.000Z`,
    seenCount: 4,
    runIds: ["growth-department-2026-08-02T090000Z", `growth-department-${TODAY}T090000Z`],
    relatedJobIds: [],
    createdAt: YESTERDAY,
    updatedAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

function makeNewTodayAction(overrides: Partial<BacklogAction> = {}): BacklogAction {
  const now = `${TODAY}T09:00:00.000Z`;
  return makeAction({
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 1,
    createdAt: now,
    runIds: [`growth-department-${TODAY}T090000Z`],
    ...overrides,
  });
}

function makeApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  const now = "2026-08-03T09:00:00.000Z";
  return {
    approvalRequestId: nextId("approval"),
    relatedType: "action",
    relatedId: nextId("related"),
    title: "Solicitud de prueba",
    summary: "Resumen de prueba",
    riskLevel: "high",
    requestedAction: "Revisar",
    options: ["approved", "rejected", "snoozed"],
    status: "pending",
    channel: "telegram",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExecutiveReportInput> = {}): ExecutiveReportInput {
  return {
    dateLabel: TODAY,
    actionableActions: [
      makeAction({
        page: "https://zentrylockers.com/cerraduras-inteligentes-taquillas/",
        keyword: "cerraduras inteligentes para taquillas",
        priority: "high",
        actionType: "seo:quick_win",
        evidence: { currentPosition: 24.8, targetPosition: 10, totalImpressions: 120 },
      }),
      makeAction({
        page: "https://zentrylockers.com/taquillas-melamina/",
        keyword: "taquillas melamina",
        priority: "medium",
        actionType: "content:title_meta_improvement",
      }),
      makeAction({
        page: "https://zentrylockers.com/taquillas-melamina/",
        keyword: "taquillas de melamina",
        priority: "medium",
        actionType: "content:internal_link",
      }),
    ],
    workOrders: [],
    waitingApprovalActions: [],
    pendingApprovalRequests: [],
    competitorGapCount: 3,
    croReviewCount: 2,
    changePackCount: 0,
    localPreviewCount: 0,
    wordpressDraftCount: 0,
    wordpressDraftsEnabled: false,
    semConnected: false,
    analyticsGa4Connected: false,
    analyticsGtmConnected: false,
    warnings: [],
    ...overrides,
  };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CREDENTIAL_VAR_NAMES = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "SMTP_PASS",
  "SMTP_USER",
  "GSC_OAUTH_CLIENT_SECRET",
  "GSC_OAUTH_REFRESH_TOKEN",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GA4_OAUTH_REFRESH_TOKEN",
  "GTM_OAUTH_REFRESH_TOKEN",
  "WORDPRESS_APP_PASSWORD",
  "N8N_API_KEY",
];

function titles(list: Array<{ title?: string; action?: string }>): string[] {
  return list.map((x) => (x.title ?? x.action ?? "").toLowerCase());
}

function hasDuplicates(list: string[]): boolean {
  return new Set(list).size !== list.length;
}

export function runExecutiveReportTests(): TestCase[] {
  return [
    // --- Agrupacion / normalizacion basica ---
    {
      name: "normalizeKeywordForGrouping agrupa singular y plural",
      fn: () => {
        assert.equal(normalizeKeywordForGrouping("hoteles"), normalizeKeywordForGrouping("hotel"));
        assert.equal(normalizeKeywordForGrouping("colegios"), normalizeKeywordForGrouping("colegio"));
        assert.equal(normalizeKeywordForGrouping("taquillas de melamina"), normalizeKeywordForGrouping("taquillas melamina"));
      },
    },
    {
      name: "normalizeKeywordForGrouping distingue temas realmente distintos",
      fn: () => {
        assert.notEqual(normalizeKeywordForGrouping("taquillas melamina"), normalizeKeywordForGrouping("cerraduras inteligentes"));
      },
    },
    {
      name: "isLowQualityKeywordFragment detecta fragmentos incompletos (inicio y final)",
      fn: () => {
        assert.equal(isLowQualityKeywordFragment("cerradura para"), true);
        assert.equal(isLowQualityKeywordFragment("comprar taquillas para"), true);
        assert.equal(isLowQualityKeywordFragment("taquillas"), true);
        assert.equal(isLowQualityKeywordFragment("para vestuarios"), true, "una preposicion colgando al PRINCIPIO tambien es un fragmento");
      },
    },
    {
      name: "isLowQualityKeywordFragment deja pasar keywords completas",
      fn: () => {
        assert.equal(isLowQualityKeywordFragment("taquillas de melamina"), false);
        assert.equal(isLowQualityKeywordFragment("cerraduras inteligentes para taquillas"), false);
        assert.equal(isLowQualityKeywordFragment("la mejor taquilla para gimnasios"), false, "un articulo inicial es una frase valida en espanol, no un fragmento");
      },
    },
    {
      name: "isUnvalidatedGeoFragment excluye nicho geografico con demanda minima",
      fn: () => {
        const lowDemand = makeAction({ keyword: "taquillas fenolicas en palencia", evidence: { totalImpressions: 3 } });
        const noEvidence = makeAction({ keyword: "taquillas fenolicas en palencia" });
        assert.equal(isUnvalidatedGeoFragment(lowDemand), true);
        assert.equal(isUnvalidatedGeoFragment(noEvidence), true);
      },
    },
    {
      name: "isUnvalidatedGeoFragment no excluye si hay demanda real validada",
      fn: () => {
        const validated = makeAction({ keyword: "taquillas fenolicas en palencia", evidence: { totalImpressions: 40 } });
        assert.equal(isUnvalidatedGeoFragment(validated), false);
      },
    },
    {
      name: "buildPageClusters fusiona acciones de la misma pagina con keywords variantes",
      fn: () => {
        const page = "https://zentrylockers.com/taquillas-melamina/";
        const actions = [
          makeAction({ page, keyword: "taquillas melamina", actionType: "seo:future_opportunity+low_ctr" }),
          makeAction({ page, keyword: "taquillas de melamina", actionType: "content:title_meta_improvement" }),
          makeAction({ page, keyword: "taquillas de melamina", actionType: "content:internal_link" }),
        ];
        const clusters = buildPageClusters(actions, TODAY);
        assert.equal(clusters.length, 1);
        assert.equal(clusters[0].actions.length, 3);
      },
    },
    {
      name: "buildPageClusters no fusiona paginas distintas",
      fn: () => {
        const actions = [
          makeAction({ page: "https://zentrylockers.com/a/", keyword: "taquillas a" }),
          makeAction({ page: "https://zentrylockers.com/b/", keyword: "taquillas b" }),
        ];
        const clusters = buildPageClusters(actions, TODAY);
        assert.equal(clusters.length, 2);
      },
    },
    {
      name: "buildPageClusters agrupa por keyword normalizada cuando no hay pagina",
      fn: () => {
        const actions = [
          makeAction({ page: undefined, keyword: "hotel", actionType: "competitor:keyword_gap_seo" }),
          makeAction({ page: undefined, keyword: "hoteles", actionType: "competitor:keyword_gap_seo" }),
        ];
        const clusters = buildPageClusters(actions, TODAY);
        assert.equal(clusters.length, 1);
      },
    },
    {
      name: 'buildPageClusters fusiona el mismo tema aunque una accion tenga pagina y otra no, con marcas distintas ("cerraduras inteligentes para centros deportivos")',
      fn: () => {
        const actions = [
          makeAction({
            page: "https://zentrylockers.com/cerraduras/",
            keyword: "cerraduras inteligentes para centros deportivos",
            targetBrand: "both",
            actionType: "seo:future_opportunity",
            priority: "high",
            evidence: { currentPosition: 43, totalImpressions: 26 },
          }),
          makeAction({
            page: undefined,
            keyword: "cerraduras inteligentes para centros deportivos",
            targetBrand: "tukandado",
            actionType: "content:new_landing",
            priority: "high",
          }),
        ];
        const clusters = buildPageClusters(actions, TODAY);
        assert.equal(clusters.length, 1, "debe fusionarse en un unico cluster, no aparecer duplicado");
        assert.equal(clusters[0].actions.length, 2);
      },
    },

    // --- Atribucion de marca ---
    {
      name: 'una posicion real de Search Console se atribuye SOLO a Zentry, nunca a "Zentry y Tukandado aparece"',
      fn: () => {
        const actions = [
          makeAction({
            page: "https://zentrylockers.com/cerraduras/",
            keyword: "cerraduras inteligentes para centros deportivos",
            targetBrand: "both",
            actionType: "seo:quick_win",
            priority: "high",
            evidence: { currentPosition: 25, totalImpressions: 40 },
          }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.equal(/zentry y tukandado aparece/i.test(markdown), false);
        assert.ok(markdown.includes("Zentry aparece actualmente"), "debe atribuir la posicion real a Zentry explicitamente");
        assert.ok(markdown.includes("tambien podria beneficiar a Tukandado"), "puede mencionar a Tukandado como beneficiario secundario, aparte");
      },
    },

    // --- Deduplicacion de conclusiones/acciones ---
    {
      name: '"taquillas melamina" y "taquillas de melamina" no generan conclusiones separadas',
      fn: () => {
        const data = buildExecutiveReportData(baseInput());
        const findingTitles = titles(data.findings);
        assert.equal(hasDuplicates(findingTitles), false);
        const melaminaFindings = findingTitles.filter((t) => t.includes("melamina"));
        assert.equal(melaminaFindings.length, 1, "debe haber una unica conclusion para el tema melamina");
      },
    },
    {
      name: '"cerraduras inteligentes para centros deportivos" no aparece dos veces en conclusiones ni en acciones',
      fn: () => {
        const actions = [
          makeAction({
            page: "https://zentrylockers.com/cerraduras/",
            keyword: "cerraduras inteligentes para centros deportivos",
            targetBrand: "both",
            actionType: "seo:future_opportunity",
            priority: "high",
            evidence: { currentPosition: 43, totalImpressions: 26 },
          }),
          makeAction({
            page: undefined,
            keyword: "cerraduras inteligentes para centros deportivos",
            targetBrand: "tukandado",
            actionType: "content:new_landing",
            priority: "high",
          }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        assert.equal(hasDuplicates(titles(data.findings)), false);
        assert.equal(hasDuplicates(titles([...data.recommendedNow, ...data.recommendedLater])), false);
      },
    },
    {
      name: 'Fase O12.3: dos paginas REALMENTE distintas con el mismo texto de keyword ("taquillas melamina") no colisionan ni se fusionan ni se pierden',
      fn: () => {
        const actions = [
          makeAction({
            page: "https://zentrylockers.com/taquillas-melamina/",
            keyword: "taquillas melamina",
            priority: "high",
            actionType: "seo:quick_win",
            evidence: { currentPosition: 12, totalImpressions: 80 },
          }),
          makeAction({
            page: "https://zentrylockers.com/taquillas-melamina-fenolico/",
            keyword: "taquillas melamina",
            priority: "high",
            actionType: "seo:future_opportunity",
            evidence: { currentPosition: 30, totalImpressions: 40 },
          }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));

        // Paginas reales distintas -> deben seguir siendo DOS
        // recomendaciones separadas, nunca fusionadas en una ni
        // descartada ninguna de las dos.
        const melaminaActions = data.recommendedNow.filter((a) => a.action.toLowerCase().includes("melamina"));
        assert.equal(melaminaActions.length, 2, "deben mantenerse las dos recomendaciones (paginas distintas)");

        // Pero el texto renderizado ya no puede colisionar byte a byte.
        assert.equal(hasDuplicates(titles(data.findings)), false);
        assert.equal(hasDuplicates(titles([...data.recommendedNow, ...data.recommendedLater])), false);

        // Y el informe entero debe seguir pasando la revision de coherencia
        // (antes de este fix, este mismo escenario hacia caer al fallback).
        assert.deepEqual(validateExecutiveReportCoherence(data), []);
      },
    },
    {
      name: "Fase O12.3: si dos agentes distintos detectan la MISMA pagina, siguen fusionados en una sola recomendacion (no rompe nada)",
      fn: () => {
        const actions = [
          makeAction({
            page: "https://zentrylockers.com/taquillas-melamina/",
            keyword: "taquillas melamina",
            priority: "high",
            sourceAgents: ["seo-director"],
            actionType: "seo:quick_win",
            evidence: { currentPosition: 12, totalImpressions: 80 },
          }),
          makeAction({
            page: "https://zentrylockers.com/taquillas-melamina/",
            keyword: "taquillas melamina",
            priority: "high",
            sourceAgents: ["content-planner"],
            actionType: "content:title_meta_improvement",
          }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        const melaminaActions = data.recommendedNow.filter((a) => a.action.toLowerCase().includes("melamina"));
        assert.equal(melaminaActions.length, 1, "misma pagina real -> una unica recomendacion consolidada");
        assert.deepEqual(validateExecutiveReportCoherence(data), []);
      },
    },

    // --- Verbos crear vs mejorar ---
    {
      name: 'una oportunidad sin pagina asociada dice "crear una nueva pagina", nunca "mejorar una pagina nueva"',
      fn: () => {
        const actions = [
          makeAction({ page: undefined, keyword: "taquillas inteligentes gimnasios", actionType: "content:new_landing", priority: "high" }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.equal(/pagina nueva/i.test(markdown), false);
        assert.ok(/crear una nueva pagina/i.test(markdown));
      },
    },

    // --- Honestidad sobre el origen del dato ---
    {
      name: "una oportunidad basada solo en competidores no se presenta como demanda validada",
      fn: () => {
        const actions = [
          makeAction({
            page: undefined,
            keyword: "taquillas inteligentes",
            actionType: "competitor:keyword_gap_seo",
            priority: "high",
            evidence: undefined,
          }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.equal(/volumen de busqueda real/i.test(markdown), false);
        assert.ok(/pendiente de validar/i.test(markdown));
      },
    },

    // --- Trabajo nuevo vs backlog anterior ---
    {
      name: "las acciones de dias anteriores no se contabilizan como trabajo nuevo realizado hoy",
      fn: () => {
        const data = buildExecutiveReportData(baseInput()); // baseInput usa makeAction (recurrente) por defecto
        assert.equal(data.newOpportunityCount, 0);
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.ok(markdown.includes("No se detectaron oportunidades nuevas hoy"));
      },
    },
    {
      name: "una oportunidad detectada por primera vez hoy si cuenta como nueva",
      fn: () => {
        const actions = [makeNewTodayAction({ keyword: "taquillas ultra nuevas", page: "https://zentrylockers.com/nueva/" })];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        assert.equal(data.newOpportunityCount, 1);
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.ok(markdown.includes("1 oportunidad(es) nueva(s) hoy"));
      },
    },

    // --- Decisiones pendientes coherentes con las acciones recomendadas ---
    {
      name: "si hay acciones prioritarias recomendadas, el informe NO puede decir que no hay decisiones pendientes",
      fn: () => {
        const actions = [
          makeAction({ page: "https://zentrylockers.com/x/", keyword: "producto estrella x", priority: "high", evidence: { currentPosition: 15, totalImpressions: 50 } }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        assert.ok(data.pendingDecisions.length > 0);
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.equal(markdown.includes("No hay decisiones pendientes hoy."), false);
      },
    },
    {
      name: "si no hay nada que decidir, el proximo paso no pide revisar ni aprobar acciones",
      fn: () => {
        const data = buildExecutiveReportData(baseInput({ actionableActions: [] }));
        assert.equal(data.pendingDecisions.length, 0);
        assert.equal(/revisar|aprobar/i.test(data.nextStep), false);
      },
    },
    {
      name: "las cifras de decisiones pendientes coinciden entre el dato y el proximo paso",
      fn: () => {
        const actions = [1, 2, 3, 4, 5].map((i) =>
          makeAction({ page: `https://zentrylockers.com/top-${i}/`, keyword: `tema prioritario ${i}`, priority: "high", evidence: { currentPosition: 20, totalImpressions: 30 } })
        );
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        assert.equal(data.recommendedNow.length, MAX_NOW);
        assert.equal(data.pendingDecisions.length, MAX_NOW);
        assert.ok(data.nextStep.includes(String(data.pendingDecisions.length)));
      },
    },

    // --- Coherencia numerica: nunca mas "ahora" que prioridades reales ---
    {
      name: "no se muestran mas acciones 'para hacer ahora' que prioridades altas reales",
      fn: () => {
        const actions = [
          makeAction({ page: "https://zentrylockers.com/h1/", keyword: "tema alto uno", priority: "high", evidence: { currentPosition: 20, totalImpressions: 30 } }),
          makeAction({ page: "https://zentrylockers.com/h2/", keyword: "tema alto dos", priority: "high", evidence: { currentPosition: 22, totalImpressions: 20 } }),
          makeAction({ page: "https://zentrylockers.com/m1/", keyword: "tema medio uno", priority: "medium" }),
          makeAction({ page: "https://zentrylockers.com/m2/", keyword: "tema medio dos", priority: "medium" }),
        ];
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        assert.equal(data.recommendedNow.length, 2, "solo hay 2 clusters de prioridad alta: no se debe rellenar con medias hasta el maximo");
      },
    },

    // --- Caps del informe ---
    {
      name: `el informe ejecutivo respeta los maximos: ${MAX_FINDINGS} conclusiones, ${MAX_NOW} acciones ahora, ${MAX_LATER} despues, ${MAX_DECISIONS} decisiones`,
      fn: () => {
        const actions: BacklogAction[] = [];
        for (let i = 0; i < 30; i++) {
          actions.push(
            makeAction({
              page: `https://zentrylockers.com/pagina-${i}/`,
              keyword: `tema de prueba numero ${i}`,
              priority: i < 12 ? "high" : "medium",
            })
          );
        }
        const data = buildExecutiveReportData(baseInput({ actionableActions: actions }));
        assert.ok(data.recommendedNow.length <= MAX_NOW);
        assert.ok(data.recommendedLater.length <= MAX_LATER);
        assert.ok(data.findings.length <= MAX_FINDINGS);
        assert.ok(data.pendingDecisions.length <= MAX_DECISIONS);
        assert.equal(data.preparedForReviewCount, 30, "el contador deduplicado debe reflejar el total real de clusters, no el cap de la lista mostrada");
      },
    },

    // --- Seguridad de contenido (siguen aplicando) ---
    {
      name: "el informe ejecutivo no contiene UUID, comandos npm, rutas /opt/ ni nombres de credenciales",
      fn: () => {
        const data = buildExecutiveReportData(baseInput());
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.equal(UUID_RE.test(markdown), false, "no deberia contener UUIDs");
        assert.equal(markdown.includes("npm run"), false, "no deberia contener comandos npm");
        assert.equal(markdown.includes("/opt/"), false, "no deberia contener rutas de servidor");
        for (const varName of CREDENTIAL_VAR_NAMES) {
          assert.equal(markdown.includes(varName), false, `no deberia mencionar ${varName}`);
        }
      },
    },
    {
      name: "el informe ejecutivo indica claramente que no se ha modificado produccion",
      fn: () => {
        const data = buildExecutiveReportData(baseInput());
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.ok(markdown.includes("Cambios publicados hoy: Ninguno."));
        assert.ok(markdown.includes("Campanas modificadas: Ninguna."));
        assert.ok(markdown.includes("No se ha publicado ningun cambio"));
        assert.equal(/Se ha publicado/.test(markdown), false, "no deberia afirmar en ningun sitio que se ha publicado algo");
      },
    },
    {
      name: "los bloqueos explican en lenguaje sencillo que Ads/GA4/GTM no estan conectados, sin nombrar variables",
      fn: () => {
        const data = buildExecutiveReportData(baseInput({ semConnected: false, analyticsGa4Connected: false, analyticsGtmConnected: false }));
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.ok(markdown.toLowerCase().includes("google ads"));
        for (const varName of CREDENTIAL_VAR_NAMES) {
          assert.equal(markdown.includes(varName), false);
        }
      },
    },
    {
      name: "un warning tecnico con nombres de variables se sanea antes de mostrarse",
      fn: () => {
        const data = buildExecutiveReportData(
          baseInput({ warnings: ["[sem-watcher] Fallo puntual usando GOOGLE_ADS_DEVELOPER_TOKEN y GOOGLE_ADS_CLIENT_SECRET al conectar."] })
        );
        const markdown = renderExecutiveReportMarkdown(data, "2026-08-03T10:00:00.000Z");
        assert.equal(markdown.includes("GOOGLE_ADS_DEVELOPER_TOKEN"), false);
        assert.equal(markdown.includes("GOOGLE_ADS_CLIENT_SECRET"), false);
      },
    },
    {
      name: "el fallback seguro es breve y no contiene datos internos sin filtrar",
      fn: () => {
        const markdown = buildFallbackExecutiveReportMarkdown("2026-08-03");
        assert.ok(markdown.length < 1500, "el fallback debe ser breve, no un volcado de datos");
        assert.equal(UUID_RE.test(markdown), false);
        assert.ok(markdown.includes("Cambios publicados hoy: Ninguno."));
      },
    },

    // --- Revision final de coherencia (Growth Director) ---
    {
      name: "validateExecutiveReportCoherence no encuentra problemas en un informe bien formado",
      fn: () => {
        const data = buildExecutiveReportData(baseInput());
        const problems = validateExecutiveReportCoherence(data);
        assert.deepEqual(problems, []);
      },
    },
    {
      name: "validateExecutiveReportCoherence detecta conclusiones duplicadas",
      fn: () => {
        const data = buildExecutiveReportData(baseInput());
        const broken = { ...data, findings: [data.findings[0], data.findings[0]] };
        const problems = validateExecutiveReportCoherence(broken);
        assert.ok(problems.some((p) => p.includes("duplicad")));
      },
    },
    {
      name: "validateExecutiveReportCoherence detecta que hay acciones 'ahora' pero cero decisiones pendientes",
      fn: () => {
        const data = buildExecutiveReportData(baseInput());
        const broken = { ...data, recommendedNow: [{ action: "X", reason: "Y", expectedImpact: "Z", effort: "Medio", needsApproval: "Si" }], pendingDecisions: [] };
        const problems = validateExecutiveReportCoherence(broken);
        assert.ok(problems.some((p) => p.includes("inconsistente")));
      },
    },
  ];
}
