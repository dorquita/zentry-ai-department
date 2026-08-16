import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { loadSpecialistInputs, StageOutputReader } from "../src/department/specialist-inputs";
import { buildDepartmentGrowthPrompt, DepartmentGrowthContext, GROWTH_COORDINATION_RULES } from "../src/department/growth-input";
import { buildDepartmentQaInputBundle } from "../src/department/qa-input";
import { buildSemSpecialistContext } from "../src/employees/sem-specialist/sem-specialist-context";
import { SemSpecialistOutput } from "../src/employees/sem-specialist/sem-specialist-output";
import { assertSnapshotUsable, classifySnapshotFreshness } from "../src/core/snapshot-freshness";
import { DepartmentEvent } from "../src/core/types";
import {
  DEPARTMENT_RUN_CONTRACT_VERSION,
  DEPARTMENT_STAGE_PHASE,
  DepartmentRunManifest,
  DepartmentStageName,
  DepartmentStageRecord,
  DepartmentStageStatus,
} from "../src/department/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * CADENA COMPLETA SEM: Google Ads LIVE -> sem-watcher -> contexto del
 * especialista -> salida del especialista -> Growth Director.
 *
 * POR QUE EXISTE ESTE FICHERO. El departamento leia Google Ads en vivo
 * cada dia y aun asi NADA de Google Ads llegaba nunca a Growth ni al
 * Daily Brief. Habia dos roturas independientes, ninguna visible desde
 * los tests que ya existian (que cubrian el adaptador y el watcher, pero
 * no la cadena entera):
 *
 *  1. `.github/workflows/sem-specialist.yml` NO ejecutaba el watcher:
 *     saltaba directo a leer el ULTIMO evento sem-watcher COMMITEADO en
 *     data/department-events.jsonl. Como ese job es `contents: read`, el
 *     evento era siempre el de la ultima pasada que si lo commiteo -- un
 *     snapshot stale y anterior a la Fase O51 (sin search terms, sin CPC,
 *     sin valor de conversion, sin fechas de ventana).
 *  2. `sem-specialist` estaba cableado a `not_available` en la fase init
 *     de scripts/run-department-coordination.ts y quedaba FUERA del bucle
 *     de especialistas de src/department/specialist-inputs.ts, asi que su
 *     salida no podia llegar a Growth aunque existiera.
 *
 * Estos tests fijan las dos mitades, mas los invariantes de seguridad que
 * no pueden relajarse al conectar la cadena (READ-ONLY y fail-closed).
 */

const ROOT = path.join(__dirname, "..");
const DEPARTMENT_RUN_ID = "dept-2026-08-16T090000Z";

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/** Igual que en google-ads-live-migration.test.ts: la prosa que documenta "aqui no se muta nada" no puede hacer fallar al test que comprueba justo eso. */
function readCodeWithoutComments(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function stage(name: DepartmentStageName, status: DepartmentStageStatus, reason = "motivo"): DepartmentStageRecord {
  return {
    stage: name,
    phase: DEPARTMENT_STAGE_PHASE[name],
    status,
    reason,
    outputPath: status === "executed" ? `reports/department/${DEPARTMENT_RUN_ID}/stages/${name}/output.json` : null,
    artifactPath: null,
    sourceRunId: null,
    auditWarningCount: null,
    recordedAt: "2026-08-16T09:00:00.000Z",
  };
}

function manifest(stages: DepartmentStageRecord[]): DepartmentRunManifest {
  return {
    contractVersion: DEPARTMENT_RUN_CONTRACT_VERSION,
    departmentRunId: DEPARTMENT_RUN_ID,
    startedAt: "2026-08-16T09:00:00.000Z",
    updatedAt: "2026-08-16T09:00:00.000Z",
    note: "nota",
    stages,
  };
}

function readerFor(outputs: Partial<Record<DepartmentStageName, unknown>>): StageOutputReader {
  return (_m, stageName) => outputs[stageName];
}

/** Salida realista de sem-specialist sobre la cuenta de Zentry (7 campanas pausadas, sin actividad medida). */
function semOutput(overrides: Partial<SemSpecialistOutput> = {}): SemSpecialistOutput {
  return {
    summary: "Las campanas de la cuenta estan pausadas y no hay actividad medida en la ventana.",
    campaignFindings: [
      {
        title: "Cuenta completa en pausa",
        description: "Ninguna campana esta activa, asi que no hay entrega ni datos de rendimiento.",
        evidenceRefs: ["sem-active-campaigns"],
        severity: "high",
      },
    ],
    searchTermOpportunities: [],
    negativeKeywordRecommendations: [
      {
        title: "Solapamiento entre la campana legacy y las nuevas",
        description: "La misma keyword se dirige desde dos campanas distintas.",
        evidenceRefs: ["sem-duplicate-keyword-warning-0"],
        severity: "medium",
      },
    ],
    budgetObservations: [],
    biddingObservations: [],
    adLandingAlignment: [],
    conversionRiskFindings: [],
    prioritizedExperiments: [
      {
        title: "Consolidar la campana legacy antes de activar",
        hypothesis: "Eliminar el solapamiento evita competir contra uno mismo al activar.",
        expectedImpact: "Menos canibalizacion entre campanas.",
        evidenceRefs: ["sem-duplicate-keyword-warning-0"],
        priority: "high",
      },
    ],
    evidence: [
      { id: "sem-active-campaigns", contextField: "departmentSummary.activeCampaignCount", value: "0" },
      {
        id: "sem-duplicate-keyword-warning-0",
        contextField: "departmentSummary.duplicateKeywordWarnings[0]",
        value: '"lockers para empresas" se dirige desde 2 campanas distintas',
      },
    ],
    unknowns: ["Sin clics en la ventana: no existe CPC real que evaluar."],
    ...overrides,
  };
}

/** Evento `agent_finished` de sem-watcher con la forma REAL que emite src/agents/sem-watcher.ts. */
function semWatcherEvent(overrides: { departmentRunId?: string; adsGeneratedAt?: string } = {}): DepartmentEvent {
  return {
    eventId: "evt-sem-live",
    departmentRunId: overrides.departmentRunId ?? DEPARTMENT_RUN_ID,
    agent: "sem-watcher",
    department: "web-growth",
    type: "agent_finished",
    priority: "low",
    summary: "SEM Watcher Agent finalizado.",
    createdAt: "2026-08-16T09:01:00.000Z",
    payload: {
      connected: true,
      campaignName: "SEM | Marca | Zentry",
      campaignStatus: "PAUSED",
      adGroups: 1,
      positiveKeywords: 4,
      negativeKeywords: 115,
      responsiveSearchAds: 11,
      semCandidateCount: 70,
      metricsWindow: "LAST_30_DAYS",
      metricsStartDate: "2026-07-17",
      metricsEndDate: "2026-08-15",
      adsGeneratedAt: overrides.adsGeneratedAt ?? "2026-08-16T09:00:30.000Z",
      metrics: [
        {
          campaignId: "24130076364",
          campaignName: "SEM | Marca | Zentry",
          impressions: 1200,
          clicks: 48,
          costMicros: 21_600_000,
          conversions: 3,
          conversionsValue: 450,
          ctr: 0.04,
          averageCpcMicros: 450_000,
        },
      ],
      searchTerms: [
        { searchTerm: "taquillas zentry", campaignName: "SEM | Marca | Zentry", impressions: 300, clicks: 20, costMicros: 9_000_000, conversions: 2 },
      ],
      searchTermCount: 1,
      departmentSummary: null,
    },
  } as DepartmentEvent;
}

export function runSemLiveToGrowthTests(): TestCase[] {
  return [
    // === 1. El workflow del especialista lee Google Ads EN VIVO ===========
    {
      name: "sem-specialist.yml ejecuta el watcher de Google Ads EN VIVO antes de razonar (era el bug: leia un evento commiteado de dias atras)",
      fn: () => {
        const workflow = readSource(".github/workflows/sem-specialist.yml");
        assert.ok(workflow.includes("npm run sem:watch"), "el workflow debe leer Google Ads en esta misma ejecucion");
        assert.ok(workflow.includes("--require-live"), "la lectura de Ads debe ser fail-closed (--require-live)");
        for (const secretName of [
          "GOOGLE_ADS_DEVELOPER_TOKEN",
          "GOOGLE_ADS_OAUTH_CLIENT_ID",
          "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
          "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
        ]) {
          assert.ok(workflow.includes(`${secretName}: \${{ secrets.${secretName} }}`), `falta el secret ${secretName} en el step de lectura live`);
        }
      },
    },
    {
      name: "sem-specialist.yml propaga DEPARTMENT_RUN_ID al paso 1: sin eso el snapshot de esta misma ejecucion se clasificaria como stale",
      fn: () => {
        const workflow = readSource(".github/workflows/sem-specialist.yml");
        assert.ok(workflow.includes("departmentRunId=sem-specialist-"), "el workflow debe generar un departmentRunId propio para la ejecucion");
        assert.ok(workflow.includes("--departmentRunId \"$DEPARTMENT_RUN_ID\""), "el watcher debe etiquetar su lectura con ese departmentRunId");
        assert.ok(
          workflow.includes("DEPARTMENT_RUN_ID: ${{ steps.runid.outputs.departmentRunId }}"),
          "el paso 1 del runner debe recibir el MISMO departmentRunId para poder marcar live_this_run"
        );
        assert.ok(workflow.includes("REQUIRE_LIVE_SOURCES:"), "el paso 1 debe poder exigir lectura live (fail-closed)");
      },
    },

    // === 2. El especialista SEM corre dentro de la pasada coordinada ======
    {
      name: "La pasada diaria ejecuta sem-specialist con el departmentRunId de la pasada y registra su etapa real",
      fn: () => {
        const workflow = readSource(".github/workflows/zentry-ai-department-daily.yml");
        assert.ok(workflow.includes("agent-name: sem-specialist"), "sem-specialist debe ser un empleado mas de la pasada");
        assert.ok(workflow.includes("npm run sem-specialist:run"), "la pasada debe ejecutar el runner de SEM");
        assert.ok(workflow.includes("--stage sem-specialist --status"), "la etapa SEM debe registrarse con su estado REAL, no cableado");
        // El watcher live de la fase 0.5 y el especialista deben compartir
        // el MISMO departmentRunId: es lo unico que hace que el contexto
        // salga como live_this_run en vez de stale.
        const semBlock = workflow.slice(workflow.indexOf("--- SEM / GOOGLE ADS ---"), workflow.indexOf("FASE 2 -- GROWTH DIRECTOR"));
        assert.ok(semBlock.length > 0, "el bloque [SEM] debe existir antes de la fase de Growth");
        assert.ok(
          semBlock.includes("DEPARTMENT_RUN_ID: ${{ steps.run.outputs.departmentRunId }}"),
          "el especialista SEM debe recibir el departmentRunId de la pasada (el mismo con el que leyo el watcher)"
        );
        assert.ok(semBlock.includes("REQUIRE_LIVE_SOURCES:"), "la etapa SEM debe ser fail-closed cuando la lectura live si salio");
      },
    },
    {
      name: "REGRESION: la fase init ya NO cablea sem-specialist a 'fuera de esta fase' (era la razon de que Ads nunca llegara a Growth)",
      fn: () => {
        const coordination = readSource("scripts/run-department-coordination.ts");
        assert.ok(
          !coordination.includes("queda explicitamente FUERA de esta fase"),
          "sem-specialist ya no puede declararse fuera de fase: es un especialista mas"
        );
        const specialistInputs = readSource("src/department/specialist-inputs.ts");
        assert.ok(
          specialistInputs.includes('{ employee: "sem-specialist", validate: validateSemSpecialistOutput'),
          "sem-specialist debe estar en el bucle LOAD_PLAN, con su propio validador"
        );
      },
    },

    // === 3. La salida SEM llega de verdad a Growth ========================
    {
      name: "CADENA: una salida REAL de sem-specialist se valida y se convierte en evidencia dept-sem-* citable por Growth",
      fn: () => {
        const loaded = loadSpecialistInputs(
          manifest([stage("sem-specialist", "executed")]),
          readerFor({ "sem-specialist": semOutput() })
        );
        const sem = loaded.inputs.find((i) => i.employee === "sem-specialist");
        assert.equal(sem?.status, "executed");
        assert.ok(loaded.sem, "la salida de SEM debe quedar disponible ya tipada");
        assert.equal(loaded.executedCount, 1);

        const refs = loaded.evidenceCatalog.map((e) => e.ref);
        assert.ok(refs.includes("dept-sem-summary"), "Growth debe poder citar el resumen de SEM");
        assert.ok(refs.some((r) => r.startsWith("dept-sem-finding-")), "cada hallazgo SEM debe ser citable");
        assert.ok(refs.some((r) => r.startsWith("dept-sem-experiment-")), "cada experimento SEM debe ser citable");
        assert.ok(refs.includes("dept-sem-unknowns"), "las incognitas de SEM deben ser citables: son lo que impide leer un hueco como 'todo bien'");
        assert.ok(
          !refs.includes("dept-sem-unavailable"),
          "con salida real no puede emitirse ademas la entrada de 'no disponible': seria una contradiccion en el mismo catalogo"
        );
      },
    },
    {
      name: "CADENA: el prompt de Growth embebe la salida SEM de ESTA pasada (no un resumen, no un report viejo)",
      fn: () => {
        const output = semOutput();
        const loaded = loadSpecialistInputs(manifest([stage("sem-specialist", "executed")]), readerFor({ "sem-specialist": output }));
        const context = {
          contextKind: "department_coordination_v1",
          departmentCoordinationRunId: DEPARTMENT_RUN_ID,
          specialistInputs: loaded.inputs,
          evidenceCatalog: loaded.evidenceCatalog,
        } as unknown as DepartmentGrowthContext;
        const prompt = buildDepartmentGrowthPrompt(context);

        assert.ok(prompt.includes(output.summary), "el resumen literal de SEM debe viajar al prompt de Growth");
        assert.ok(prompt.includes("Consolidar la campana legacy antes de activar"), "los experimentos SEM deben llegar a Growth");
        assert.ok(prompt.includes("dept-sem-summary"), "Growth debe ver las refs con las que puede citar a SEM");
      },
    },
    {
      name: "REGRESION: las reglas de Growth ya NO dicen que SEM esta fuera de fase (decirlo hacia que ignorara datos reales de Ads)",
      fn: () => {
        const semRules = GROWTH_COORDINATION_RULES.filter((r) => r.includes("sem-specialist"));
        assert.ok(semRules.length > 0, "debe seguir habiendo reglas explicitas sobre SEM");
        for (const rule of semRules) {
          assert.ok(!/FUERA de esta fase/i.test(rule), `una regla de Growth sigue declarando SEM fuera de fase: ${rule}`);
        }
        assert.ok(
          semRules.some((r) => r.includes("`status` es `executed`")),
          "debe haber una regla que haga depender el trato de SEM de su status REAL, no de una decision fija"
        );
      },
    },
    {
      name: "FAIL-CLOSED: una salida SEM que no cumple su contrato se degrada a invalid_output y NO llega a Growth a medias",
      fn: () => {
        const loaded = loadSpecialistInputs(
          manifest([stage("sem-specialist", "executed")]),
          readerFor({ "sem-specialist": { summary: "solo esto", campaignFindings: "no-es-array" } })
        );
        const sem = loaded.inputs.find((i) => i.employee === "sem-specialist");
        assert.equal(sem?.status, "invalid_output");
        assert.equal(loaded.sem, undefined);
        assert.equal(loaded.executedCount, 0);
        assert.ok(loaded.evidenceCatalog.some((e) => e.ref === "dept-sem-unavailable"));
      },
    },
    {
      name: "El bundle de QA lleva la salida SEM real y su estado real (antes se filtraba fuera y se forzaba a not_available)",
      fn: () => {
        const m = manifest([stage("sem-specialist", "executed")]);
        const loaded = loadSpecialistInputs(m, readerFor({ "sem-specialist": semOutput() }));
        const bundle = buildDepartmentQaInputBundle(m, loaded, { status: "not_available", reason: "sin growth en este test" });
        const semEntry = bundle.specialistOutputs.find((o) => o.employee === "sem-specialist");
        assert.ok(semEntry, "SEM ya no puede filtrarse fuera del bundle de QA");
        assert.equal(semEntry?.status, "executed");
        assert.ok(semEntry?.output, "QA debe poder revisar la salida SEM real");
        assert.equal(bundle.semStatus.status, "executed", "semStatus refleja el estado real, ya no un literal fijo");
      },
    },

    // === 4. Procedencia: el run id no se pierde entre capas ===============
    {
      name: "PROCEDENCIA: un snapshot leido en ESTA pasada llega al contexto como live_this_run, con su ventana de fechas intacta",
      fn: () => {
        const context = buildSemSpecialistContext([semWatcherEvent()], {
          now: "2026-08-16T09:05:00.000Z",
          currentDepartmentRunId: DEPARTMENT_RUN_ID,
        });
        assert.ok(context, "el contexto debe construirse a partir del evento del watcher");
        assert.equal(context!.freshness.status, "live_this_run");
        assert.equal(context!.freshness.producedInThisRun, true);
        assert.equal(context!.sourceDepartmentRunId, DEPARTMENT_RUN_ID, "el departmentRunId no puede perderse entre el watcher y el especialista");
        assert.equal(context!.sourceGeneratedAt, "2026-08-16T09:00:30.000Z", "debe usarse el instante REAL de la llamada a la API, no el de escritura del evento");
        assert.equal(context!.metricsStartDate, "2026-07-17");
        assert.equal(context!.metricsEndDate, "2026-08-15");
      },
    },
    {
      name: "PROCEDENCIA: el mismo snapshot bajo OTRO departmentRunId ya no es live_this_run (el run id se compara de verdad, no se asume)",
      fn: () => {
        const context = buildSemSpecialistContext([semWatcherEvent({ departmentRunId: "otra-pasada-anterior" })], {
          now: "2026-08-16T09:05:00.000Z",
          currentDepartmentRunId: DEPARTMENT_RUN_ID,
        });
        assert.equal(context!.freshness.producedInThisRun, false);
        assert.notEqual(context!.freshness.status, "live_this_run");
      },
    },
    {
      name: "FAIL-CLOSED: con REQUIRE_LIVE_SOURCES, un snapshot que no es de esta pasada aborta la etapa en vez de razonar sobre historico",
      fn: () => {
        const stale = classifySnapshotFreshness({
          sourceGeneratedAt: "2026-08-14T11:13:30.859Z",
          now: "2026-08-16T09:05:00.000Z",
          currentDepartmentRunId: DEPARTMENT_RUN_ID,
          snapshotDepartmentRunId: "growth-department-2026-08-14T111247Z",
        });
        assert.equal(stale.status, "stale");
        assert.throws(
          () => assertSnapshotUsable("sem-watcher (Google Ads)", stale, { requireLive: true }),
          /REQUIRE_LIVE_SOURCES/,
          "un snapshot stale debe hacer fallar la etapa, no colarse como estado actual"
        );
        // Sin la politica activa sigue siendo utilizable, pero ETIQUETADO.
        assert.doesNotThrow(() => assertSnapshotUsable("sem-watcher (Google Ads)", stale, { requireLive: false }));
        assert.ok(stale.humanSummary.includes("DATOS ANTIGUOS"), "el prompt debe decir siempre que los datos son viejos");
      },
    },

    // === 5. Conversion de unidades y metricas reales ======================
    {
      name: "UNIDADES: costMicros y averageCpcMicros llegan al contexto convertidos a EUR, y el valor de conversion se conserva",
      fn: () => {
        const context = buildSemSpecialistContext([semWatcherEvent()], {
          now: "2026-08-16T09:05:00.000Z",
          currentDepartmentRunId: DEPARTMENT_RUN_ID,
        })!;
        const metric = context.metrics[0];
        assert.equal(metric.costEUR, 21.6, "21.600.000 micros son 21,60 EUR");
        assert.equal(metric.averageCpcEUR, 0.45, "450.000 micros son 0,45 EUR");
        assert.equal(metric.conversions, 3);
        assert.equal(metric.conversionsValue, 450);
        assert.equal(context.searchTerms[0].costEUR, 9, "el coste de un search term tambien va en EUR, no en micros");
        assert.equal(context.searchTerms[0].searchTerm, "taquillas zentry");
      },
    },

    // === 6. READ-ONLY: ninguna capa SEM puede escribir en Google Ads ======
    {
      name: "READ-ONLY: ninguna capa de la cadena SEM (contexto, salida, runner) puede llamar a Google Ads, ni directa ni indirectamente",
      fn: () => {
        for (const rel of [
          "src/employees/sem-specialist/sem-specialist-context.ts",
          "src/employees/sem-specialist/sem-specialist-output.ts",
          "scripts/run-sem-specialist.ts",
          "src/department/specialist-inputs.ts",
        ]) {
          const code = readCodeWithoutComments(rel);
          assert.ok(!/adapters\/google-ads/.test(code), `${rel} no puede importar el adaptador de Google Ads`);
          assert.ok(!/:mutate|googleAds:mutate|\bmutate\(/.test(code), `${rel} no puede contener ninguna llamada de mutacion`);
        }
      },
    },
    {
      name: "READ-ONLY: el subagente sem-specialist sigue sin herramientas y con la prohibicion explicita de modificar Google Ads",
      fn: () => {
        const agent = readSource(".claude/agents/sem-specialist.md");
        assert.ok(/^tools: \[\]$/m.test(agent), "sem-specialist debe seguir sin ninguna herramienta");
        assert.ok(agent.includes("No propongas ni describas ninguna accion que MODIFIQUE Google Ads"), "la prohibicion de mutar debe seguir en el prompt");
        // El allowlist es la segunda capa de defensa, independiente del
        // frontmatter: sem-specialist debe seguir declarado ahi y sin
        // ninguna herramienta concedida.
        const allowlistRaw = readSource("config/subagent-tool-allowlist.json");
        assert.ok(allowlistRaw.includes('"sem-specialist"'), "sem-specialist debe seguir declarado en el allowlist de subagentes");
      },
    },
    {
      name: "READ-ONLY: los dos workflows que ejecutan SEM declaran contents: read (no pueden commitear ni escribir en el repo)",
      fn: () => {
        const semWorkflow = readSource(".github/workflows/sem-specialist.yml");
        assert.ok(/permissions:\s*\n\s*contents: read/.test(semWorkflow), "sem-specialist.yml debe ser contents: read");
        assert.ok(!/contents: write/.test(semWorkflow), "sem-specialist.yml no puede pedir escritura");
      },
    },

    // === 7. El prompt del especialista describe los datos que recibe =====
    {
      name: "El prompt de sem-specialist documenta search terms, CPC null-vs-0 y la taxonomia de ausencia de dato",
      fn: () => {
        const agent = readSource(".claude/agents/sem-specialist.md");
        assert.ok(agent.includes("`searchTerms`"), "el prompt debe describir los terminos de busqueda reales que ahora recibe");
        assert.ok(agent.includes("Como distinguir ausencia de dato"), "el prompt debe distinguir 0 / null / no disponible / insuficiente / error");
        assert.ok(agent.includes("`freshness`"), "el prompt debe explicar la procedencia del snapshot");
        assert.ok(
          !agent.includes("este snapshot de sem-watcher\n  nunca trae un campo real de CPC"),
          "el prompt ya no puede afirmar que el CPC nunca esta disponible: lo esta cuando hay clics"
        );
      },
    },
  ];
}
