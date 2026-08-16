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
import { readDepartmentEmployeeRuns, resolveDepartmentRunPaths, toRepoRelative } from "../src/department/run-store";
import { summarizeDepartmentRunCost } from "../src/department/employee-runs";
import { buildExecutionReportEmail, ExecutedWork, ExecutionReportInput } from "../src/department/execution-report";
import { containsSecretValue, REQUIRED_SMTP_VARS, resolveDailyBriefEmailConfig } from "../src/department/email-config";
import { resolveActiveClientConfig } from "../src/core/client-config";
import { sendReportEmail } from "../src/core/mailer";
import { ResolveDecisionsResult } from "../src/approvals/manual/decision";
import { appendExecutePhpAudit } from "../src/core/execute-php-audit";
import { buildPhpForPlan } from "../src/core/execute-php-builder";
import { callNovamiraExecutePhp, openSession } from "../src/adapters/novamira-mcp-client";
import { readStagingPage } from "../src/adapters/staging-inventory-reader";
import { applyChangePlanWithPhp, ExecutePhpContext, PhpTargetState } from "../src/department/apply/execute-php-executor";

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

    // --- CAMINO NUEVO: la propuesta trae un ChangePlan ejecutable ya
    //     resuelto contra el inventario real. No se interpreta prosa.
    if (decision.action === "approve" && item?.executableChangePlan) {
      const outcome = await executeChangePlan(item, decision, departmentRunId, decidedBy);
      appendHumanDecision({
        decisionId: buildDecisionId(departmentRunId, decision.proposal.recommendationId, now.toISOString()),
        departmentRunId,
        proposalNumber: decision.proposal.number,
        recommendationId: decision.proposal.recommendationId,
        changeId: decision.proposal.changeId,
        recommendationTitle: decision.proposal.title,
        action: decision.action,
        rejectionReason: "",
        overrides: decision.overrides,
        target: decision.target,
        decidedBy,
        decidedAt: now.toISOString(),
        executionStatus: outcome.status,
        executionDetail: outcome.detail,
      });
      outcomes.push(outcome);
      console.log(`  #${outcome.number} ${outcome.title} -> ${outcome.status}${outcome.detail ? ` (${outcome.detail.slice(0, 160)})` : ""}`);
      continue;
    }

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

  // --- Segundo email: el acta de lo que REALMENTE paso ---
  await sendExecutionReport(departmentRunId, resolved, outcomes, now, args);

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

/**
 * Ejecuta un ChangePlan ya resuelto. Toda la maquinaria de seguridad es
 * la que ya estaba: snapshot, ancla de version (STALE), guard con PHP
 * determinista, read-back por REST (via distinta a la escritura),
 * validacion de scope, rollback verificado y audit trail.
 *
 * `native_ability` todavia NO tiene executor cableado: se dice y no se
 * ejecuta, en vez de fingir que si. Hoy no bloquea nada real -- el sitio
 * no tiene ni un bloque `novamira/*`, asi que todo enruta al fallback.
 */
async function executeChangePlan(
  item: DepartmentApplyItem,
  decision: ResolvedDecision,
  departmentRunId: string,
  decidedBy: string
): Promise<ExecutionOutcome> {
  const executable = item.executableChangePlan as NonNullable<DepartmentApplyItem["executableChangePlan"]>;
  const base: ExecutionOutcome = {
    number: decision.proposal.number,
    id: decision.proposal.id,
    title: decision.proposal.title,
    action: decision.action,
    target: decision.target,
    status: "not_executed",
    detail: "",
    stagingUrl: executable.stagingUrl,
    before: [{ field: executable.operation, value: executable.beforeValue }],
    after: [{ field: executable.operation, value: executable.afterValue }],
    validationStatus: "not_run",
    rollbackStatus: "not_needed",
    rejectionReason: "",
  };

  if (decision.target === "production") {
    return { ...base, detail: "PRODUCCION no se toca en esta fase. La aprobacion queda registrada, pero no se escribe nada." };
  }
  // Una modificacion pedida al aprobar ("cambia el title por X") NO se
  // puede colar en un plan ya construido: el payload del plan es el que
  // se valido contra el contrato y contra el que se comparara el AFTER.
  // Aplicar el plan ignorando la modificacion escribiria algo que la
  // persona no aprobo, asi que no se ejecuta y se dice por que.
  const overrideFields = Object.keys(decision.overrides).filter((field) => typeof (decision.overrides as Record<string, unknown>)[field] === "string");
  if (overrideFields.length > 0) {
    return {
      ...base,
      detail: `La aprobacion pide modificar ${overrideFields.join(", ")}, pero esta propuesta lleva un ChangePlan ya construido y anclado a la version leida de la pagina. No se ejecuta con el valor viejo: pide el cambio como propuesta nueva para que se construya (y se valide) el plan correcto.`,
    };
  }
  if (executable.capability.executionPath === "native_ability") {
    return {
      ...base,
      detail: `El camino elegido es "native_ability" (${executable.capability.nativeAbility}) y ese executor todavia NO esta cableado en esta fase. No se ejecuta nada: se dice en vez de fingir que se aplico.`,
    };
  }

  const context: ExecutePhpContext = {
    departmentRunId,
    recommendationId: item.recommendationId,
    changeId: decision.proposal.changeId ?? `${departmentRunId}#change-${item.recommendationRank}`,
    qaStatus: item.qaStatus,
    capabilitySelection: executable.capability,
    flags: {
      executePhpFallbackEnabled: isEnabled("NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED"),
      novamiraStagingWritesEnabled: isEnabled("NOVAMIRA_STAGING_WRITES_ENABLED"),
      wordpressEnv: resolveWordpressEnv(),
    },
  };

  const session = await openSession();
  const outcome = await applyChangePlanWithPhp(executable.plan, context, {
    getState: async (postId: number): Promise<PhpTargetState> => {
      const page = await readStagingPage(postId);
      return {
        id: page.wordpressPageId,
        status: page.status,
        title: page.title,
        contentHtml: page.contentHtml,
        excerpt: page.excerpt,
        link: page.stagingUrl,
        slug: page.slug,
        meta: page.meta,
      };
    },
    runPhp: async (php: string) =>
      callNovamiraExecutePhp(
        {
          actor: "web_engineer_apply",
          abilityName: "novamira/execute-php",
          environment: "staging",
          phase: php === buildPhpForPlan(executable.plan) ? "apply" : "rollback",
          qaStatus: context.qaStatus,
          departmentRunId: context.departmentRunId,
          recommendationId: context.recommendationId,
          changeId: context.changeId,
          plan: executable.plan,
          php,
          capabilitySelection: executable.capability,
          flags: context.flags,
          snapshotPreviousValue: executable.beforeValue,
          snapshotPreviousExisted: true,
        },
        session
      ),
  });

  for (const record of outcome.audit) appendExecutePhpAudit(record);

  return {
    ...base,
    status: outcome.status,
    detail: `${outcome.detail} (decidido por ${decidedBy})`,
    validationStatus: outcome.validation,
    rollbackStatus: outcome.rollback,
    after: outcome.afterValue !== null ? [{ field: executable.operation, value: outcome.afterValue }] : base.after,
  };
}

/** Traduce el estado real del executor al vocabulario del informe. Fail-closed: lo desconocido es `failed`, nunca `applied`. */
function mapOutcome(status: string): ExecutedWork["outcome"] {
  if (status === "staging_applied" || status === "production_applied" || status === "applied") return "applied";
  if (status === "staging_rolled_back" || status === "production_rolled_back" || status === "rolled_back") return "rolled_back";
  if (status === "staging_validation_failed" || status === "production_validation_failed" || status === "validation_failed") return "validation_failed";
  if (status === "not_executed" || status === "approval_stale" || status === "stale" || status === "deferred" || status === "rejected") return "not_executed";
  return "failed";
}

/**
 * Envia el informe de ejecucion. Nunca puede tapar lo que paso: si el
 * correo falla, se dice y el run acaba en rojo, pero el resultado real
 * de la ejecucion no cambia.
 */
async function sendExecutionReport(
  departmentRunId: string,
  resolved: ResolveDecisionsResult,
  outcomes: ExecutionOutcome[],
  now: Date,
  args: Record<string, string>
): Promise<void> {
  const executed: ExecutedWork[] = outcomes
    .filter((o) => o.action === "approve")
    .map((o) => {
      const decision = resolved.decisions.find((d) => d.proposal.number === o.number);
      return {
        decision: decision as ExecutedWork["decision"],
        action: o.detail || `Aplicar en ${o.target}`,
        environment: o.target === "production" ? ("production" as const) : ("staging" as const),
        changes: o.before.map((b, i) => ({ field: b.field, before: b.value, after: o.after[i]?.value ?? "" })),
        validation: o.validationStatus,
        // El informe tiene su propio vocabulario; se traduce aqui en vez
        // de dejar pasar un estado que el renderer no sabria etiquetar.
        // `approval_stale` no llego a escribir nada -> `not_executed`,
        // y el motivo real viaja en `outcomeDetail`.
        outcome: mapOutcome(o.status),
        outcomeDetail: o.detail,
        url: o.stagingUrl,
        rollback:
          o.rollbackStatus === "not_needed"
            ? null
            : {
                performed: o.rollbackStatus === "rolled_back",
                reason: `La validacion posterior no paso (${o.validationStatus}).`,
                status: o.rollbackStatus === "rolled_back" ? ("rolled_back" as const) : ("rollback_failed" as const),
                detail: o.detail,
              },
      };
    });

  const runs = readDepartmentEmployeeRuns(departmentRunId);
  const input: ExecutionReportInput = {
    generatedAt: now.toISOString(),
    runIds: {
      departmentRunId,
      executionRunId: `approval-session-${now.toISOString()}`,
      briefRunUrl: args.briefRunUrl && args.briefRunUrl !== "true" ? args.briefRunUrl : "",
      executionRunUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? ""}/actions/runs/${process.env.GITHUB_RUN_ID}` : "",
    },
    executed,
    pending: resolved.untouched,
    rejected: resolved.decisions.filter((d) => d.action === "reject"),
    newRecommendations: [],
    writes: {
      staging: outcomes.filter((o) => o.target === "staging" && (o.status === "staging_applied" || o.status === "applied" || o.rollbackStatus !== "not_needed")).length,
      production: outcomes.filter((o) => o.target === "production" && o.status === "production_applied").length,
    },
    cost: runs.length > 0 ? summarizeDepartmentRunCost(runs) : null,
  };

  const email = buildExecutionReportEmail(input);
  const config = resolveDailyBriefEmailConfig({
    env: process.env,
    fallbackRecipientVar: resolveActiveClientConfig().notificationSettings.reportEmailToEnvVar,
  });
  if (!config.configured) {
    console.log(`\nInforme de ejecucion NO enviado: falta configuracion de correo (${config.missing.join(", ")}). El resultado real esta arriba y en el JSON de la sesion.`);
    return;
  }

  const leak = containsSecretValue(`${email.subject}\n${email.text}\n${email.html}`, process.env, [...REQUIRED_SMTP_VARS]);
  if (leak) {
    console.error(`\nInforme de ejecucion NO enviado: el correo contendria el valor de ${leak}. Fail-closed.`);
    process.exitCode = 1;
    return;
  }

  try {
    await sendReportEmail({ subject: email.subject, text: email.text, html: email.html }, { to: config.to, label: "Informe de ejecucion del departamento" });
    console.log(`\nInforme de ejecucion enviado a ${config.to}.`);
  } catch (err) {
    console.error(`\nInforme de ejecucion NO enviado (${err instanceof Error ? err.message : String(err)}). Lo que paso de verdad esta arriba y en el JSON de la sesion.`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
