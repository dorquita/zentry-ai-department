import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { attributeEvidenceRefToEmployees, loadSpecialistInputs, StageOutputReader } from "../src/department/specialist-inputs";
import { buildDepartmentGrowthPrompt, DepartmentGrowthContext, GROWTH_COORDINATION_RULES } from "../src/department/growth-input";
import { buildDepartmentQaInputBundle } from "../src/department/qa-input";
import { DEPARTMENT_RUN_CONTRACT_VERSION, DEPARTMENT_STAGE_PHASE, DepartmentRunManifest, DepartmentStageName, DepartmentStageRecord, DepartmentStageStatus } from "../src/department/types";

export interface TestCase {
  name: string;
  fn: () => void;
}

const DEPARTMENT_RUN_ID = "dept-2026-08-15T120000Z";

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
    recordedAt: "2026-08-15T12:00:00.000Z",
  };
}

function manifest(stages: DepartmentStageRecord[]): DepartmentRunManifest {
  return {
    contractVersion: DEPARTMENT_RUN_CONTRACT_VERSION,
    departmentRunId: DEPARTMENT_RUN_ID,
    startedAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:00:00.000Z",
    note: "nota",
    stages,
  };
}

function fixture(fileName: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", fileName), "utf-8")) as unknown;
}

function contentOutputFixture(): unknown {
  const brief = fixture("content-strategist-brief-example.json") as { result: { output: unknown } };
  return brief.result.output;
}

/** Lector inyectado: devuelve la salida real de fixture para las etapas indicadas, `undefined` para el resto. */
function readerFor(outputs: Partial<Record<DepartmentStageName, unknown>>): StageOutputReader {
  return (_m, stageName) => outputs[stageName];
}

export function runDepartmentSpecialistInputsTests(): TestCase[] {
  return [
    {
      name: "Happy path: las 3 salidas reales de los especialistas se cargan, se validan con SU PROPIO validador y generan evidencia dept-*",
      fn: () => {
        const loaded = loadSpecialistInputs(
          manifest([stage("seo-specialist", "executed"), stage("content-strategist", "executed"), stage("analytics-specialist", "executed"), stage("sem-specialist", "not_available")]),
          readerFor({
            "seo-specialist": fixture("seo-specialist-output-example.json"),
            "content-strategist": contentOutputFixture(),
            "analytics-specialist": fixture("analytics-specialist-output-example.json"),
          })
        );

        assert.equal(loaded.executedCount, 3);
        assert.ok(loaded.seo && loaded.content && loaded.analytics);
        const refs = loaded.evidenceCatalog.map((e) => e.ref);
        assert.ok(refs.includes("dept-seo-summary"));
        assert.ok(refs.includes("dept-content-summary"));
        assert.ok(refs.includes("dept-analytics-summary"));
        // SEM SIEMPRE presente y siempre como no disponible.
        assert.ok(refs.includes("dept-sem-unavailable"));
        assert.equal(loaded.inputs.find((i) => i.employee === "sem-specialist")?.status, "not_available");
      },
    },
    {
      name: "Especialista no disponible: NO se inventa salida -- se emite una nota explicita y una entrada de evidencia dept-*-unavailable",
      fn: () => {
        const loaded = loadSpecialistInputs(
          manifest([stage("seo-specialist", "executed"), stage("content-strategist", "not_available", "No hay change packs de contenido elegibles."), stage("analytics-specialist", "failed", "El step murio.")]),
          readerFor({ "seo-specialist": fixture("seo-specialist-output-example.json") })
        );

        assert.equal(loaded.executedCount, 1);
        assert.equal(loaded.content, undefined);
        assert.equal(loaded.analytics, undefined);

        const content = loaded.inputs.find((i) => i.employee === "content-strategist");
        assert.equal(content?.status, "not_available");
        assert.equal(content?.output, undefined, "una etapa no ejecutada NUNCA lleva output");
        assert.ok(content?.note.includes("No hay change packs de contenido elegibles."));
        assert.ok(content?.note.includes("NO hay ningun dato"));

        const analytics = loaded.inputs.find((i) => i.employee === "analytics-specialist");
        assert.equal(analytics?.status, "failed");
        assert.equal(analytics?.output, undefined);

        const refs = loaded.evidenceCatalog.map((e) => e.ref);
        assert.ok(refs.includes("dept-content-unavailable"));
        assert.ok(refs.includes("dept-analytics-unavailable"));
        assert.ok(!refs.includes("dept-content-summary"));
        assert.ok(!refs.includes("dept-analytics-summary"));
      },
    },
    {
      name: "Fail-closed de forma: una etapa marcada executed cuya salida no pasa su validador se degrada a invalid_output, no se embebe a medias",
      fn: () => {
        const loaded = loadSpecialistInputs(
          manifest([stage("seo-specialist", "executed")]),
          readerFor({ "seo-specialist": { executiveSummary: "solo esto, faltan campos obligatorios" } })
        );

        const seo = loaded.inputs.find((i) => i.employee === "seo-specialist");
        assert.equal(seo?.status, "invalid_output");
        assert.equal(seo?.output, undefined);
        assert.equal(loaded.seo, undefined);
        assert.equal(loaded.executedCount, 0);
        assert.ok(loaded.evidenceCatalog.some((e) => e.ref === "dept-seo-unavailable"));
      },
    },
    {
      name: "Etapa marcada executed pero sin fichero de salida legible: se degrada, nunca se asume contenido",
      fn: () => {
        const loaded = loadSpecialistInputs(manifest([stage("analytics-specialist", "executed")]), readerFor({}));
        const analytics = loaded.inputs.find((i) => i.employee === "analytics-specialist");
        assert.equal(analytics?.status, "invalid_output");
        assert.equal(loaded.analytics, undefined);
      },
    },
    {
      name: "SEM aparece SIEMPRE como not_available/pendiente, incluso si el manifiesto no lo registro, y nunca bloquea",
      fn: () => {
        const loaded = loadSpecialistInputs(manifest([]), readerFor({}));
        const sem = loaded.inputs.find((i) => i.employee === "sem-specialist");
        assert.ok(sem, "sem-specialist debe estar siempre presente en los inputs");
        assert.equal(sem?.status, "not_available");
        assert.ok(sem?.note.includes("FUERA de esta fase"));
        assert.ok(sem?.note.includes("NUNCA bloquea"));
      },
    },
    {
      name: "Trazabilidad inversa: cada evidenceRef dept-* se atribuye al empleado correcto; una ref no dept-* nunca se atribuye a un especialista",
      fn: () => {
        assert.deepEqual(attributeEvidenceRefToEmployees("dept-seo-action-1"), ["seo-specialist"]);
        assert.deepEqual(attributeEvidenceRefToEmployees("dept-content-summary"), ["content-strategist"]);
        assert.deepEqual(attributeEvidenceRefToEmployees("dept-analytics-tracking-issue-2"), ["analytics-specialist"]);
        assert.deepEqual(attributeEvidenceRefToEmployees("dept-sem-unavailable"), ["sem-specialist"]);
        assert.deepEqual(attributeEvidenceRefToEmployees("actions-live"), ["growth-director-v2 (contexto determinista del departamento)"]);
      },
    },
    {
      name: "El prompt de Growth embebe las reglas de coordinacion, el contexto con specialistInputs y las instrucciones reales del agente",
      fn: () => {
        const context = {
          contextKind: "department_coordination_v1",
          departmentCoordinationRunId: DEPARTMENT_RUN_ID,
          departmentRunId: null,
          hasDepartmentRunData: false,
          generatedAt: "2026-08-15T12:00:00.000Z",
          agentActivity: [],
          warnings: [],
          actionsSummary: { totalActions: 0, liveActionCount: 0, byStatus: {}, byPriority: {}, topOpenActions: [] },
          workOrdersSummary: { total: 0, readyForReviewCount: 0, byCategory: {}, byBrand: {} },
          changePacksSummary: { total: 0, readyForReviewCount: 0, byType: {} },
          approvalRequestsSummary: { pendingCount: 0, byRiskLevel: {}, topPending: [] },
          jobsSummary: { totalJobSnapshots: 0, latestRunId: null, latestRunJobCount: 0 },
          knownDependencies: [],
          evidenceCatalog: [{ ref: "dept-seo-summary", description: "salida real de seo-specialist" }],
          specialistInputs: [{ employee: "seo-specialist" as const, status: "executed" as const, note: "salida real", sourceRunId: null, output: { executiveSummary: "marcador-unico-de-test" } }],
        } satisfies DepartmentGrowthContext;

        const prompt = buildDepartmentGrowthPrompt(context);

        assert.ok(prompt.includes(DEPARTMENT_RUN_ID));
        assert.ok(prompt.includes("growth-director-v2"), "debe incluir las instrucciones del agente real");
        assert.ok(prompt.includes("marcador-unico-de-test"), "debe embeber la salida real del especialista");
        for (const rule of GROWTH_COORDINATION_RULES) {
          assert.ok(prompt.includes(rule), `falta la regla de coordinacion: ${rule.slice(0, 60)}`);
        }
      },
    },
    {
      name: "El bundle de QA lleva el mismo departmentRunId, la version de contrato, y NO incluye output de un especialista ausente",
      fn: () => {
        const loaded = loadSpecialistInputs(
          manifest([stage("seo-specialist", "executed"), stage("content-strategist", "not_available", "Sin trabajo elegible.")]),
          readerFor({ "seo-specialist": fixture("seo-specialist-output-example.json") })
        );
        const bundle = buildDepartmentQaInputBundle(manifest([]), loaded, { status: "not_available", reason: "Growth no corrio." });

        assert.equal(bundle.departmentRunId, DEPARTMENT_RUN_ID);
        assert.equal(bundle.contractVersion, DEPARTMENT_RUN_CONTRACT_VERSION);
        assert.equal(bundle.semStatus.status, "not_available");
        assert.ok(bundle.growth.note.includes("no produjo sintesis utilizable"));
        assert.equal(bundle.growth.output, undefined);

        const seoEntry = bundle.specialistOutputs.find((s) => s.employee === "seo-specialist");
        const contentEntry = bundle.specialistOutputs.find((s) => s.employee === "content-strategist");
        assert.ok(seoEntry && "output" in seoEntry && seoEntry.output !== undefined);
        assert.ok(contentEntry && contentEntry.output === undefined, "un especialista ausente nunca aporta output al bundle de QA");
        assert.ok(bundle.reviewInstructionsForQa.some((r) => r.includes("titulo EXACTO")));
      },
    },
  ];
}
