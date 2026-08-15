import * as assert from "node:assert/strict";
import { buildGrowthDirectorV2Context, SIBLING_CLAUDE_EMPLOYEES } from "../src/employees/growth-director-v2/context";

export interface TestCase {
  name: string;
  fn: () => void;
}

/**
 * Tests contra datos LOCALES REALES del repositorio (data/*.jsonl), como
 * hace el resto del proyecto (ver docs/claude-employee-runtime.md, "no
 * llama a ningun sistema externo"). No mockea `fs` ni los registros --
 * exactamente lo que ejecuta `scripts/run-growth-director-v2.ts` en
 * local o en CI. Esto es deliberado: el caso mas importante a probar
 * (siblings ausentes -- ver mision, "no inventes informacion para
 * llenar huecos") es precisamente el estado REAL de este checkout antes
 * de que los demas 6 worktrees mergeen sus propios PRs.
 */
export function runGrowthDirectorV2ContextTests(): TestCase[] {
  return [
    {
      name: "buildGrowthDirectorV2Context() no lanza contra los datos reales del repositorio",
      fn: () => {
        assert.doesNotThrow(() => buildGrowthDirectorV2Context());
      },
    },
    {
      name: "el contexto tiene generatedAt como ISO string y departmentRunId consistente con hasDepartmentRunData",
      fn: () => {
        const context = buildGrowthDirectorV2Context();
        assert.match(context.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        if (context.hasDepartmentRunData) {
          assert.notEqual(context.departmentRunId, null);
        } else {
          assert.deepEqual(context.agentActivity, []);
          assert.deepEqual(context.warnings, []);
        }
      },
    },
    {
      name: "knownDependencies incluye exactamente los 6 empleados hermanos + sem-watcher + analytics-watcher (V1), sin duplicados",
      fn: () => {
        const context = buildGrowthDirectorV2Context();
        assert.equal(context.knownDependencies.length, SIBLING_CLAUDE_EMPLOYEES.length + 2);
        const names = context.knownDependencies.map((d) => d.name);
        for (const sibling of SIBLING_CLAUDE_EMPLOYEES) {
          assert.ok(names.includes(sibling), `falta ${sibling} en knownDependencies`);
        }
        assert.equal(new Set(names).size, names.length, "no deberia haber nombres de dependencia duplicados");
      },
    },
    {
      name: "REGRESION anti-fabricacion: en este checkout (worktree aislado, PR sin mergear todavia) los 6 empleados hermanos NO tienen definicion de agente -- deben aparecer como missing, nunca como available",
      fn: () => {
        const context = buildGrowthDirectorV2Context();
        for (const sibling of SIBLING_CLAUDE_EMPLOYEES) {
          const dep = context.knownDependencies.find((d) => d.name === sibling);
          assert.ok(dep, `falta la entrada de dependencia para ${sibling}`);
          assert.equal(dep!.status, "missing", `${sibling} deberia estar "missing" en este worktree (todavia no existe .claude/agents/${sibling}.md)`);
          assert.ok(dep!.note.length > 0);
        }
      },
    },
    {
      name: "growth-director-v2 (el propio empleado) NUNCA aparece en su propia lista de dependencias -- SIBLING_CLAUDE_EMPLOYEES no se incluye a si mismo",
      fn: () => {
        assert.ok(!(SIBLING_CLAUDE_EMPLOYEES as readonly string[]).includes("growth-director-v2"));
      },
    },
    {
      name: "evidenceCatalog no tiene refs duplicados y siempre incluye department-run/actions-live/workorders-ready/changepacks-ready/approvals-pending/jobs-latest-run",
      fn: () => {
        const context = buildGrowthDirectorV2Context();
        const refs = context.evidenceCatalog.map((e) => e.ref);
        assert.equal(new Set(refs).size, refs.length, `evidenceCatalog no deberia tener refs duplicados: ${JSON.stringify(refs)}`);
        for (const expected of ["department-run", "actions-live", "workorders-ready", "changepacks-ready", "approvals-pending", "jobs-latest-run"]) {
          assert.ok(refs.includes(expected), `falta el ref "${expected}" en evidenceCatalog`);
        }
        // Una entrada dependency-<slug> por cada knownDependencies, ademas de las 6 fijas de arriba.
        const dependencyRefs = refs.filter((r) => r.startsWith("dependency-"));
        assert.equal(dependencyRefs.length, context.knownDependencies.length);
      },
    },
    {
      // REGRESION (code review): readCurrentApprovalRequests() devuelve
      // orden de fichero (insercion), no de riesgo -- sin ordenar antes
      // de truncar a 8, una solicitud de riesgo alto que aparezca
      // despues de la octava en data/approval-requests.jsonl se perderia
      // en silencio de topPending, aunque el campo se llame "top".
      name: "approvalRequestsSummary.topPending esta ordenado por riesgo descendente (critical > high > medium > low_medium > none)",
      fn: () => {
        const context = buildGrowthDirectorV2Context();
        const RISK_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low_medium: 2, none: 1 };
        const ranks = context.approvalRequestsSummary.topPending.map((p) => RISK_RANK[p.riskLevel] ?? -1);
        for (const r of ranks) assert.notEqual(r, -1, "riskLevel desconocido fuera de la escala esperada");
        for (let i = 1; i < ranks.length; i++) {
          assert.ok(ranks[i - 1] >= ranks[i], `topPending no esta ordenado por riesgo descendente: ${JSON.stringify(context.approvalRequestsSummary.topPending)}`);
        }
      },
    },
    {
      name: "actionsSummary/workOrdersSummary/changePacksSummary/approvalRequestsSummary/jobsSummary son numeros no negativos y coherentes entre si",
      fn: () => {
        const context = buildGrowthDirectorV2Context();
        assert.ok(context.actionsSummary.totalActions >= 0);
        assert.ok(context.actionsSummary.liveActionCount >= 0);
        assert.ok(context.actionsSummary.liveActionCount <= context.actionsSummary.totalActions);
        assert.ok(context.actionsSummary.topOpenActions.length <= 8);
        assert.ok(context.workOrdersSummary.readyForReviewCount <= context.workOrdersSummary.total);
        assert.ok(context.changePacksSummary.readyForReviewCount <= context.changePacksSummary.total);
        assert.ok(context.approvalRequestsSummary.pendingCount >= 0);
        assert.ok(context.jobsSummary.latestRunJobCount <= context.jobsSummary.totalJobSnapshots);
      },
    },
    {
      name: "un --departmentRunId explicito que no coincide con ningun evento real produce hasDepartmentRunData=false y agentActivity/warnings vacios (nunca inventa actividad para un run inexistente)",
      fn: () => {
        const context = buildGrowthDirectorV2Context("this-department-run-id-does-not-exist-anywhere");
        assert.equal(context.departmentRunId, "this-department-run-id-does-not-exist-anywhere");
        assert.equal(context.hasDepartmentRunData, false);
        assert.deepEqual(context.agentActivity, []);
        assert.deepEqual(context.warnings, []);
        // Los resumenes de backlog NO estan acotados por departmentRunId (reflejan el estado actual global), asi que siguen poblados igual.
        assert.ok(context.actionsSummary.totalActions >= 0);
      },
    },
    {
      name: "buildGrowthDirectorV2Context() es idempotente en cuanto a conteos entre dos llamadas seguidas (sin escritura de por medio)",
      fn: () => {
        const a = buildGrowthDirectorV2Context();
        const b = buildGrowthDirectorV2Context();
        assert.equal(a.departmentRunId, b.departmentRunId);
        assert.equal(a.actionsSummary.totalActions, b.actionsSummary.totalActions);
        assert.equal(a.knownDependencies.length, b.knownDependencies.length);
      },
    },
  ];
}
