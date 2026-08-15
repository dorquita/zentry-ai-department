/**
 * SESION DE APROBACION MANUAL -- ver docs/manual-approval-flow.md.
 *
 * Es la segunda mitad del flujo diario. Por la mañana, GitHub Actions
 * manda el Daily Brief con las propuestas NUMERADAS y no escribe nada en
 * ningun sistema. Mas tarde, una persona dice en Claude Code algo como
 * "aprueba 1, 2 y 4; rechaza 3 porque el copy no me gusta; deja 5
 * pendiente", Claude traduce eso a un fichero de instrucciones, y este
 * script lo valida y lo ejecuta.
 *
 * Reparto de responsabilidades, deliberado:
 *
 *   - CLAUDE interpreta el lenguaje natural -> `--decisions <fichero>`.
 *   - ESTE SCRIPT valida contra el Daily Brief real, comprueba que nada
 *     ha cambiado desde entonces, ejecuta solo lo aprobado y registra
 *     todo. Nada de esto depende de que el modelo "se acuerde".
 *
 * Por defecto es DRY-RUN: enseña como ha interpretado la decision y no
 * toca nada. Hace falta `--execute` para que escriba.
 *
 * Uso:
 *   npm run approvals:session -- --departmentRunId <id> --decisions decisions.json
 *   npm run approvals:session -- --departmentRunId <id> --decisions decisions.json --execute
 *
 * Formato de `decisions.json` (lo escribe Claude a partir del prompt):
 *   [
 *     { "number": 1, "action": "approve" },
 *     { "number": 3, "action": "reject", "reason": "el copy es generico" },
 *     { "number": 4, "action": "approve", "overrides": { "title": "..." } },
 *     { "number": 5, "action": "defer" }
 *   ]
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { getWordpressPage, isWordpressDraftsEnabled, updateStagingPublishedPageContent } from "../src/adapters/wordpress";
import { resolveWordpressBackend, resolveWordpressEnv } from "../src/adapters/wordpress-backend";
import { recordingTransitionPort } from "../src/approvals/executor-bridge";
import { HumanInstruction, ResolvedDecision, resolveHumanDecisions } from "../src/approvals/manual/decision";
import { appendHumanDecision, buildDecisionId, listHumanFeedbackFor } from "../src/approvals/manual/decision-store";
import { buildNumberedProposals, NumberedProposal } from "../src/approvals/manual/proposal";
import { DEPARTMENT_CHANGE_CONTRACT_VERSION, DepartmentChangeRequest } from "../src/department/apply/change-types";
import { checkStagingApplyGuards, StagingApplyGuards } from "../src/department/apply/guards";
import { applyChangeToStaging } from "../src/department/apply/staging-executor";
import { readApplySummary } from "../src/department/apply/store";
import { DepartmentApplyItem, DepartmentApplySummary } from "../src/department/apply/types";
import { computeVersionHash, matchesApprovedVersion } from "../src/department/apply/version";
import { resolveDepartmentRunPaths, toRepoRelative } from "../src/department/run-store";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
    }
  }
  return args;
}

function isEnabled(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

function resolveStagingGuards(): StagingApplyGuards {
  return {
    stagingApplyEnabled: isEnabled("DEPARTMENT_STAGING_APPLY_ENABLED"),
    wordpressWritesEnabled: isWordpressDraftsEnabled(),
    wordpressBackend: resolveWordpressBackend(),
    wordpressEnv: resolveWordpressEnv(),
  };
}

export interface ExecutionOutcome {
  number: number;
  id: string;
  title: string;
  action: string;
  target: string;
  /** Que se hizo de verdad. `not_executed` cuando la decision no era ejecutable. */
  status: string;
  detail: string;
  stagingUrl: string;
  before: { field: string; value: string }[];
  after: { field: string; value: string }[];
  validationStatus: string;
  rollbackStatus: string;
  rejectionReason: string;
}

/** Construye el cambio en memoria a partir del elemento planificado del Daily Brief. */
function buildChange(item: DepartmentApplyItem, decision: ResolvedDecision, feedback: string[], now: Date): DepartmentChangeRequest {
  const version = feedback.length + 1;
  return {
    contractVersion: DEPARTMENT_CHANGE_CONTRACT_VERSION,
    changeId: `${item.departmentRunId}#change-${item.recommendationRank}-v${version}`,
    departmentRunId: item.departmentRunId,
    recommendationId: item.recommendationId,
    recommendationRank: item.recommendationRank,
    version,
    supersedesChangeId: null,
    title: item.title,
    why: item.proposedChange,
    sourceAgents: [...item.sourceAgents],
    impact: item.impact,
    confidence: item.confidence,
    effort: item.effort,
    qaStatus: item.qaStatus,
    capabilityId: item.applyCapability.id,
    capabilityReason: item.applyCapability.reason,
    status: "proposed",
    staging: null,
    telegram: null,
    humanDecision: {
      decision: "approved",
      decidedBy: decision.proposal.id,
      decidedAt: now.toISOString(),
      rejectionReason: "",
      channel: "manual_prompt",
    },
    production: null,
    inheritedFeedback: feedback,
    auditTrail: [
      {
        at: now.toISOString(),
        event: "approved_by_human_prompt",
        detail: `Propuesta #${decision.proposal.number} del Daily Brief de ${item.departmentRunId}, aprobada por prompt para aplicar en ${decision.target}.`,
      },
    ],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Comprueba que la pagina sigue siendo la que se describio en el Daily
 * Brief. Fail-closed: si no hay ancla registrada y no se pasa
 * `--allow-unverified`, NO se ejecuta.
 */
async function checkNotStale(
  item: DepartmentApplyItem,
  allowUnverified: boolean
): Promise<{ ok: boolean; reason: string; currentHash: string | null }> {
  const target = item.applyCapability.target;
  if (!target) return { ok: false, reason: "La propuesta no tiene destino resuelto.", currentHash: null };

  let currentHash: string | null = null;
  try {
    const page = await getWordpressPage(target.wordpressPageId);
    currentHash = computeVersionHash({ status: page.status, title: page.title, metaDescription: page.excerpt, contentHtml: page.contentHtml });
  } catch (err) {
    return { ok: false, reason: `No se pudo releer la pagina ${target.wordpressPageId} para comprobar que no ha cambiado: ${err instanceof Error ? err.message : String(err)}. Fail-closed.`, currentHash: null };
  }

  const anchor = item.traceability.stagingVersionHash;
  if (!anchor) {
    if (!allowUnverified) {
      return {
        ok: false,
        reason:
          "Esta pasada no registro la version de la pagina cuando genero el Daily Brief, asi que NO se puede comprobar si ha cambiado desde entonces. Fail-closed: se ejecuta solo con --allow-unverified explicito.",
        currentHash,
      };
    }
    return { ok: true, reason: "Sin ancla de version: se ejecuta porque se ha pedido --allow-unverified. La deriva desde el Daily Brief NO se ha podido verificar.", currentHash };
  }

  const match = matchesApprovedVersion(anchor, currentHash);
  return { ok: match.matches, reason: match.reason, currentHash };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const departmentRunId = args.departmentRunId;
  if (!departmentRunId || departmentRunId === "true") throw new Error("Falta --departmentRunId <id>.");
  const decisionsPath = args.decisions;
  if (!decisionsPath || decisionsPath === "true") throw new Error("Falta --decisions <fichero.json>.");
  const execute = args.execute === "true";
  const allowUnverified = args["allow-unverified"] === "true";
  const decidedBy = args["decided-by"] && args["decided-by"] !== "true" ? args["decided-by"] : "pau";

  const summary: DepartmentApplySummary | undefined = readApplySummary(departmentRunId);
  if (!summary) throw new Error(`No existe apply-summary.json para la pasada "${departmentRunId}". ¿Es el departmentRunId del Daily Brief que estas mirando?`);

  const proposals = buildNumberedProposals(summary);
  const instructions = JSON.parse(fs.readFileSync(decisionsPath, "utf-8")) as HumanInstruction[];
  if (!Array.isArray(instructions)) throw new Error("El fichero de decisiones debe ser un array de instrucciones.");

  const resolved = resolveHumanDecisions({ proposals, instructions });

  console.log(`\nDaily Brief de la pasada ${departmentRunId} -- ${proposals.length} propuesta(s).\n`);
  console.log("ASI HE INTERPRETADO TU DECISION:");
  for (const line of resolved.interpretation) console.log(`  ${line}`);
  console.log("");

  if (!resolved.ok) {
    console.error("NO SE EJECUTA NADA. La instruccion tiene problemas:");
    for (const error of resolved.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  if (!execute) {
    console.log("(DRY-RUN: no se ha tocado nada. Repite con --execute para aplicar lo aprobado.)");
    return;
  }

  const guards = resolveStagingGuards();
  const guardCheck = checkStagingApplyGuards(guards);
  console.log(`Interruptores de staging: ${guardCheck.reason}\n`);

  const outcomes: ExecutionOutcome[] = [];
  const now = new Date();

  for (const decision of resolved.decisions) {
    const item = summary.items.find((i) => i.recommendationId === decision.proposal.recommendationId);
    const base: ExecutionOutcome = {
      number: decision.proposal.number,
      id: decision.proposal.id,
      title: decision.proposal.title,
      action: decision.action,
      target: decision.target,
      status: "not_executed",
      detail: "",
      stagingUrl: decision.proposal.stagingUrl,
      before: [],
      after: [],
      validationStatus: "not_run",
      rollbackStatus: "not_needed",
      rejectionReason: decision.reason,
    };

    // Rechazos y pendientes: se registran, no se ejecuta nada.
    if (decision.action !== "approve") {
      base.status = decision.action === "reject" ? "rejected" : "deferred";
      base.detail = decision.action === "reject" ? `Rechazada por ${decidedBy}. Motivo guardado literal.` : "Dejada pendiente por decision explicita.";
    } else if (!decision.executable) {
      base.detail = decision.blockedReason;
    } else if (!guardCheck.allowed) {
      base.detail = `No se ejecuta: ${guardCheck.reason}`;
    } else if (!item || !item.applyCapability.target) {
      base.detail = "Incoherencia interna: la propuesta ya no tiene destino resuelto. Fail-closed.";
    } else {
      const stale = await checkNotStale(item, allowUnverified);
      if (!stale.ok) {
        base.status = "approval_stale";
        base.detail = stale.reason;
      } else {
        const capability = item.applyCapability.target;
        const feedback = listHumanFeedbackFor(item.recommendationId).map((f) => `v${f.version} (${f.rejectedAt}): ${f.rejectionReason}`);
        const change = buildChange(item, decision, feedback, now);
        const { port, recorded } = recordingTransitionPort(() => new Date());
        const result = await applyChangeToStaging(
          change,
          {
            wordpressPageId: capability.wordpressPageId,
            // Las modificaciones que pidio la persona ganan sobre lo que
            // propuso el sistema: eso es justo lo que significa "cambia
            // el title por X antes de aplicarla".
            newTitle: decision.overrides.title ?? capability.newTitle,
            newMetaDescription: decision.overrides.metaDescription ?? capability.newMetaDescription,
          },
          {
            getPage: async (pageId) => {
              const page = await getWordpressPage(pageId);
              return { id: page.id, status: page.status, title: page.title, contentHtml: page.contentHtml, excerpt: page.excerpt, link: page.link, slug: page.slug };
            },
            updatePublishedPage: async (input) => {
              await updateStagingPublishedPageContent({ pageId: input.pageId, title: input.title, contentHtml: input.contentHtml, excerpt: input.excerpt });
            },
          },
          guards,
          port
        );
        // El rastro de transiciones se conserva en el informe de la
        // sesion y en el registro de decisiones: con el carril serverless
        // apagado no hay datastore remoto al que volcarlo.
        void recorded;

        base.status = result.change.status;
        base.detail = result.change.auditTrail[result.change.auditTrail.length - 1]?.detail ?? "";
        base.stagingUrl = result.change.staging?.url || base.stagingUrl;
        base.validationStatus = result.change.staging?.validationStatus ?? "not_run";
        base.rollbackStatus = result.change.staging?.rollbackStatus ?? "not_needed";
        base.before = (result.change.staging?.changedFields ?? []).filter((f) => f.changed).map((f) => ({ field: f.field, value: f.before }));
        base.after = (result.change.staging?.changedFields ?? []).filter((f) => f.changed).map((f) => ({ field: f.field, value: f.after }));
      }
    }

    appendHumanDecision({
      decisionId: buildDecisionId(departmentRunId, decision.proposal.recommendationId, now.toISOString()),
      departmentRunId,
      proposalNumber: decision.proposal.number,
      recommendationId: decision.proposal.recommendationId,
      changeId: decision.proposal.changeId,
      recommendationTitle: decision.proposal.title,
      action: decision.action,
      rejectionReason: decision.action === "reject" ? decision.reason : "",
      overrides: decision.overrides,
      target: decision.target,
      decidedBy,
      decidedAt: now.toISOString(),
      executionStatus: base.status === "not_executed" ? null : base.status,
      executionDetail: base.detail,
    });

    outcomes.push(base);
    console.log(`  #${base.number} ${base.title} -> ${base.status}${base.detail ? ` (${base.detail.slice(0, 160)})` : ""}`);
  }

  const reportPath = path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "approval-session.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        departmentRunId,
        decidedBy,
        decidedAt: now.toISOString(),
        outcomes,
        pending: resolved.untouched.map((p: NumberedProposal) => ({ number: p.number, id: p.id, title: p.title })),
        interpretation: resolved.interpretation,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`\nSesion registrada en ${toRepoRelative(reportPath)}.`);

  const critical = outcomes.filter((o) => o.rollbackStatus === "rollback_failed");
  if (critical.length > 0) {
    console.error(`CRITICO: ${critical.length} cambio(s) con rollback fallido. Requiere intervencion humana inmediata.`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
