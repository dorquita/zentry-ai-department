import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildDailyBriefEmail } from "../src/department/brief-email";
import { DepartmentDailyBrief } from "../src/department/daily-brief";
import {
  DEPARTMENT_HUMAN_DECISION_CONTRACT_VERSION,
  DepartmentHumanDecisionItem,
  DepartmentHumanDecisionRecord,
  parseDepartmentHumanDecisionRecord,
  readLatestDepartmentHumanDecisionRecord,
  selectApprovedWork,
  selectNotApprovedWork,
  summarizeHumanDecision,
} from "../src/department/human-decisions";

export interface TestCase {
  name: string;
  fn: () => void;
}

const SOURCE_RUN = "dept-2026-08-15T175321Z";

function item(rank: number, overrides: Partial<DepartmentHumanDecisionItem> = {}): DepartmentHumanDecisionItem {
  return {
    recommendationId: `${SOURCE_RUN}#rec-${rank}`,
    applyItemId: `${SOURCE_RUN}#apply-${rank}`,
    rank,
    proposal: `Propuesta numero ${rank}`,
    decision: "approved",
    actionTaken: "Ninguna escritura.",
    affectedResources: [],
    before: "Sin cambios.",
    after: "Sin cambios.",
    validation: "No ejecutada.",
    outcome: "requires_manual_implementation",
    outcomeDetail: "No existe executor determinista para este cambio.",
    snapshotId: null,
    rollback: "No aplica.",
    stagingWrites: 0,
    productionWrites: 0,
    ...overrides,
  };
}

function record(overrides: Partial<DepartmentHumanDecisionRecord> = {}): DepartmentHumanDecisionRecord {
  return {
    contractVersion: DEPARTMENT_HUMAN_DECISION_CONTRACT_VERSION,
    decidedAt: "2026-08-15T21:05:00.000Z",
    decidedBy: "Pau",
    sourceDepartmentRunId: SOURCE_RUN,
    sourceBriefGeneratedAt: "2026-08-15T18:08:56.805Z",
    scopeNote: "Aprobacion limitada a las propuestas 1-6. La 7 queda NO aprobada.",
    items: [item(1), item(7, { decision: "not_approved", outcome: "not_executed", actionTaken: "Ninguna." })],
    ...overrides,
  };
}

function briefWith(decisions: DepartmentHumanDecisionRecord | null): DepartmentDailyBrief {
  const section = { employee: "x", status: "executed" as const, headline: "h", bullets: ["b"] };
  return {
    contractVersion: "department-run/v1",
    departmentRunId: "dept-2026-08-16T090000Z",
    generatedAt: "2026-08-16T09:00:00.000Z",
    executiveSummary: { discovered: ["d"], needsAttention: ["a"], changed: ["c"] },
    topPriorities: [],
    sections: { seo: section, content: section, analytics: section, growth: section, qa: section, webEngineering: section },
    blockedOrUnknown: [],
    approvalsNeeded: [],
    stageStatuses: [],
    departmentQaStatus: "PASS",
    externalWrites: "none",
    apply: null,
    humanDecisions: decisions,
    cost: null,
    note: "nota",
  };
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "human-decisions-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runDepartmentHumanDecisionsTests(): TestCase[] {
  return [
    // --- Contrato ---
    {
      name: "Un registro completo se parsea y conserva los identificadores reales de la pasada aprobada",
      fn: () => {
        const parsed = parseDepartmentHumanDecisionRecord(JSON.parse(JSON.stringify(record())));
        assert.equal(parsed.sourceDepartmentRunId, SOURCE_RUN);
        assert.equal(parsed.items[0].recommendationId, `${SOURCE_RUN}#rec-1`);
        assert.equal(parsed.items[1].applyItemId, `${SOURCE_RUN}#apply-7`);
      },
    },
    {
      name: "FAIL-CLOSED: un contrato de version distinta se rechaza en vez de leerse a medias",
      fn: () => {
        assert.throws(
          () => parseDepartmentHumanDecisionRecord({ ...record(), contractVersion: "department-human-decision/v2" }),
          /contrato no soportado/
        );
      },
    },
    {
      name: "FAIL-CLOSED: falta un campo obligatorio (before) -> lanza, no se rellena con vacio",
      fn: () => {
        const broken = record();
        delete (broken.items[0] as Partial<DepartmentHumanDecisionItem>).before;
        assert.throws(() => parseDepartmentHumanDecisionRecord(broken), /"before"/);
      },
    },
    {
      name: "FAIL-CLOSED: un outcome fuera del enum se rechaza (no hay estados a medias)",
      fn: () => {
        const broken = record();
        (broken.items[0] as unknown as Record<string, unknown>).outcome = "casi_aplicado";
        assert.throws(() => parseDepartmentHumanDecisionRecord(broken), /"outcome"/);
      },
    },
    {
      name: "FAIL-CLOSED: los conteos de escrituras deben ser enteros >= 0, nunca estimaciones",
      fn: () => {
        const broken = record();
        (broken.items[0] as unknown as Record<string, unknown>).stagingWrites = 1.5;
        assert.throws(() => parseDepartmentHumanDecisionRecord(broken), /"stagingWrites"/);
      },
    },
    {
      name: "GUARDA CENTRAL: una propuesta NO aprobada que declare escrituras en produccion es una contradiccion y se rechaza",
      fn: () => {
        const broken = record({
          items: [item(7, { decision: "not_approved", outcome: "not_executed", productionWrites: 1 })],
        });
        assert.throws(() => parseDepartmentHumanDecisionRecord(broken), /contradiccion/);
      },
    },
    {
      name: "FAIL-CLOSED: un registro sin items se rechaza (un informe no publica una decision vacia)",
      fn: () => {
        assert.throws(() => parseDepartmentHumanDecisionRecord({ ...record(), items: [] }), /"items"/);
      },
    },

    // --- Proyecciones ---
    {
      name: "Aprobadas y no aprobadas se separan y se ordenan por su rank en el brief original",
      fn: () => {
        const parsed = record({ items: [item(6), item(1), item(7, { decision: "not_approved", outcome: "not_executed" })] });
        assert.deepEqual(selectApprovedWork(parsed).map((i) => i.rank), [1, 6]);
        assert.deepEqual(selectNotApprovedWork(parsed).map((i) => i.rank), [7]);
      },
    },
    {
      name: "El resumen cuenta resultados reales y suma las escrituras de TODOS los elementos",
      fn: () => {
        const totals = summarizeHumanDecision(
          record({
            items: [
              item(1, { outcome: "applied", stagingWrites: 1 }),
              item(2, { outcome: "requires_manual_implementation" }),
              item(3, { outcome: "rolled_back", stagingWrites: 2 }),
              item(7, { decision: "not_approved", outcome: "not_executed" }),
            ],
          })
        );
        assert.equal(totals.approved, 3);
        assert.equal(totals.notApproved, 1);
        assert.equal(totals.applied, 1);
        assert.equal(totals.rolledBack, 1);
        assert.equal(totals.requiresManualImplementation, 1);
        assert.equal(totals.stagingWrites, 3);
        assert.equal(totals.productionWrites, 0);
      },
    },

    // --- Lector ---
    {
      name: "El lector devuelve el registro MAS RECIENTE y nunca uno de la pasada que se esta generando",
      fn: () => {
        withTempDir((dir) => {
          fs.writeFileSync(path.join(dir, "viejo.json"), JSON.stringify(record({ decidedAt: "2026-08-10T10:00:00.000Z", sourceDepartmentRunId: "dept-viejo" })));
          fs.writeFileSync(path.join(dir, "nuevo.json"), JSON.stringify(record({ decidedAt: "2026-08-15T21:05:00.000Z", sourceDepartmentRunId: "dept-nuevo" })));
          fs.writeFileSync(path.join(dir, "actual.json"), JSON.stringify(record({ decidedAt: "2026-08-16T09:00:00.000Z", sourceDepartmentRunId: "dept-actual" })));

          const latest = readLatestDepartmentHumanDecisionRecord({ currentDepartmentRunId: "dept-actual", dir });
          assert.ok(latest);
          assert.equal(latest.sourceDepartmentRunId, "dept-nuevo", "un informe no se reporta a si mismo como trabajo previo");
        });
      },
    },
    {
      name: "Sin directorio de decisiones, el lector devuelve null (no inventa un historial)",
      fn: () => {
        assert.equal(readLatestDepartmentHumanDecisionRecord({ currentDepartmentRunId: "x", dir: "/no/existe/jamas" }), null);
      },
    },
    {
      name: "Un fichero corrupto hace ruido en vez de colarse silenciosamente",
      fn: () => {
        withTempDir((dir) => {
          fs.writeFileSync(path.join(dir, "roto.json"), JSON.stringify({ contractVersion: DEPARTMENT_HUMAN_DECISION_CONTRACT_VERSION }));
          assert.throws(() => readLatestDepartmentHumanDecisionRecord({ currentDepartmentRunId: "x", dir }));
        });
      },
    },

    // --- Render del email ---
    {
      name: "El email publica cada propuesta aprobada con propuesta original, accion, before, after, validation y resultado",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: briefWith(record()), apply: null, cost: null, runUrl: "" });
        for (const fragment of ["2. TRABAJOS COMPLETADOS DESDE EL ULTIMO INFORME", "Propuesta 1: Propuesta numero 1", "Accion realizada:", "Before:", "After:", "Validation:", "RESULTADO FINAL: REQUIERE IMPLEMENTACION MANUAL"]) {
          assert.ok(email.text.includes(fragment), `falta en el texto: ${fragment}`);
        }
        assert.ok(email.html.includes("Trabajos completados desde el ultimo informe"));
        assert.ok(email.html.includes("REQUIERE IMPLEMENTACION MANUAL"));
      },
    },
    {
      name: "La propuesta NO aprobada aparece en su propia seccion y NUNCA entre los trabajos completados",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: briefWith(record()), apply: null, cost: null, runUrl: "" });
        const completedIndex = email.text.indexOf("2. TRABAJOS COMPLETADOS DESDE EL ULTIMO INFORME");
        const notExecutedIndex = email.text.indexOf("3. NO EJECUTADO POR DECISION HUMANA");
        const rank7Index = email.text.indexOf("Propuesta 7: Propuesta numero 7");
        assert.ok(completedIndex < notExecutedIndex, "las dos secciones van en orden");
        assert.ok(rank7Index > notExecutedIndex, "la propuesta excluida solo puede aparecer bajo NO EJECUTADO POR DECISION HUMANA");
        assert.ok(email.text.includes("quedaron EXPRESAMENTE fuera por decision humana"));
      },
    },
    {
      name: "Sin decision registrada, el email lo dice explicitamente en vez de omitir la seccion o inventar avances",
      fn: () => {
        const email = buildDailyBriefEmail({ brief: briefWith(null), apply: null, cost: null, runUrl: "" });
        assert.ok(email.text.includes("2. TRABAJOS COMPLETADOS DESDE EL ULTIMO INFORME"));
        assert.ok(email.text.includes("No hay ninguna decision humana registrada sobre una pasada anterior"));
        assert.ok(email.html.includes("no se ha inventado ninguno"));
      },
    },

    // --- El registro REAL que vive en el repositorio ---
    {
      name: "El registro real de dept-2026-08-15T175321Z es valido y respeta la decision humana: 6 aprobadas, la 7 NO, y CERO escrituras en produccion",
      fn: () => {
        const file = path.join(__dirname, "..", "data", "department-human-decisions", `${SOURCE_RUN}.json`);
        const parsed = parseDepartmentHumanDecisionRecord(JSON.parse(fs.readFileSync(file, "utf-8")), path.basename(file));
        const totals = summarizeHumanDecision(parsed);

        assert.equal(parsed.sourceDepartmentRunId, SOURCE_RUN);
        assert.equal(parsed.items.length, 7);
        assert.equal(totals.approved, 6);
        assert.equal(totals.notApproved, 1);
        assert.deepEqual(selectApprovedWork(parsed).map((i) => i.rank), [1, 2, 3, 4, 5, 6]);
        assert.deepEqual(selectNotApprovedWork(parsed).map((i) => i.rank), [7], "la 7 es la unica excluida");
        assert.equal(totals.productionWrites, 0, "ninguna escritura en produccion derivada de esta decision");
        assert.equal(totals.stagingWrites, 0);
        assert.equal(selectNotApprovedWork(parsed)[0].outcome, "not_executed");
      },
    },
  ];
}
