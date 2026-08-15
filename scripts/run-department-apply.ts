/**
 * APPLY del departamento -- ver docs/department-apply.md.
 *
 * Este script es la UNICA pieza de la pasada coordinada que puede
 * escribir en un sistema real, y lo hace bajo una cadena completa de
 * condiciones que nunca se relajan:
 *
 *   Growth -> QA -> Web Engineer -> APROBACION HUMANA EXPLICITA ->
 *   capacidad soportada por un executor determinista -> interruptores de
 *   entorno -> snapshot -> apply -> validacion -> rollback si falla.
 *
 * Fases:
 *
 *   plan    Construye el contrato de apply de la pasada (un elemento por
 *           recomendacion) resolviendo capacidad y aprobacion. NO escribe
 *           en ningun sistema externo. Opcionalmente (solo con
 *           DEPARTMENT_APPLY_APPROVAL_REQUESTS_ENABLED=true) crea las
 *           solicitudes de aprobacion en el registro EXISTENTE del
 *           proyecto.
 *   apply   Ejecuta UNICAMENTE los elementos que ya estan en estado
 *           "approved" (es decir: con aprobacion humana explicita
 *           registrada y vigente) y cuya capacidad esta soportada.
 *
 * Claude NO participa en ninguna de las dos fases: aqui no se invoca
 * ningun modelo. La especificacion que produjo web-engineer se lee ya
 * validada del run, y este script solo ejecuta acciones permitidas por el
 * registro de capacidades.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import { getWordpressPage, isWordpressDraftsEnabled, updateWordpressDraftPage } from "../src/adapters/wordpress";
import { resolveWordpressBackend, resolveWordpressEnv } from "../src/adapters/wordpress-backend";
import { readCurrentApprovalRequests, upsertApprovalRequest } from "../src/core/approval-requests";
import { readCurrentStagingExecutions } from "../src/core/staging-executions";
import { validateWebEngineerOutput } from "../src/employees/web-engineer/validator";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import { DEPARTMENT_APPLY_RELATED_TYPE } from "../src/department/apply/approval";
import { OwnedStagingPage } from "../src/department/apply/capability";
import { ApplyEnvironmentGuards, checkApplyEnvironmentGuards, executeApplyItem } from "../src/department/apply/executor";
import { buildApplyPlan } from "../src/department/apply/plan";
import { readApplySummary, updateApplySummaryItems, writeApplySummary } from "../src/department/apply/store";
import { DepartmentApplyItem, DepartmentApplySummary } from "../src/department/apply/types";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { findStageRecord, readManifest, readStageOutput, resolveDepartmentRunPaths, toRepoRelative } from "../src/department/run-store";

type Phase = "plan" | "apply";

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

function requireDepartmentRunId(args: Record<string, string>): string {
  const id = args.departmentRunId;
  if (!id || id === "true") throw new Error("Falta --departmentRunId <id>.");
  return id;
}

function isEnabled(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

/**
 * Catalogo de paginas de staging que ESTE sistema creo y sigue
 * controlando: solo ejecuciones `applied_to_staging` con pageId numerico.
 * Ninguna otra pagina del sitio es un destino valido de apply.
 */
export function loadOwnedStagingPages(): OwnedStagingPage[] {
  const byPageId = new Map<number, OwnedStagingPage>();
  for (const execution of readCurrentStagingExecutions()) {
    if (execution.status !== "applied_to_staging") continue;
    if (typeof execution.wordpressPageId !== "number") continue;
    byPageId.set(execution.wordpressPageId, {
      wordpressPageId: execution.wordpressPageId,
      stagingUrl: execution.wordpressDraftUrl ?? "",
    });
  }
  return [...byPageId.values()];
}

function loadPromotion(departmentRunId: string): DepartmentPromotionResult {
  const { promotionPath } = resolveDepartmentRunPaths(departmentRunId);
  if (!fs.existsSync(promotionPath)) {
    throw new Error(`No existe promotion.json en la pasada "${departmentRunId}": la puerta de QA no llego a resolverse. Fail-closed: no hay nada que planificar para apply.`);
  }
  return JSON.parse(fs.readFileSync(promotionPath, "utf-8")) as DepartmentPromotionResult;
}

function loadWebEngineer(departmentRunId: string): { status: string; output?: WebEngineerOutput } {
  const manifest = readManifest(departmentRunId);
  const record = findStageRecord(manifest, "web-engineer");
  const status = record?.status ?? "not_available";
  if (status !== "executed") return { status };
  const raw = readStageOutput(manifest, "web-engineer");
  if (raw === undefined) return { status: "invalid_output" };
  try {
    return { status, output: validateWebEngineerOutput(raw) };
  } catch {
    return { status: "invalid_output" };
  }
}

function summarize(summary: DepartmentApplySummary): string {
  return Object.entries(summary.counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
}

function phasePlan(args: Record<string, string>): void {
  const departmentRunId = requireDepartmentRunId(args);
  const promotion = loadPromotion(departmentRunId);
  const webEngineer = loadWebEngineer(departmentRunId);
  const ownedStagingPages = loadOwnedStagingPages();

  let summary = buildApplyPlan({
    departmentRunId,
    promotion,
    webEngineer,
    ownedStagingPages,
    approvalRequests: readCurrentApprovalRequests(),
  });

  // Creacion de solicitudes de aprobacion: OPCIONAL y apagada por
  // defecto. El registro de aprobaciones (data/approval-requests.jsonl)
  // es persistente solo donde vive el proyecto de verdad; crear
  // solicitudes en un checkout efimero (un runner de CI) generaria
  // peticiones que nadie podria responder porque desaparecen con el
  // runner. Con el interruptor apagado, los elementos se quedan en
  // `awaiting_approval` diciendo exactamente eso.
  const canCreateRequests = isEnabled("DEPARTMENT_APPLY_APPROVAL_REQUESTS_ENABLED");
  if (canCreateRequests) {
    const current = readCurrentApprovalRequests();
    const items = summary.items.map((item) => {
      if (item.applyStatus !== "awaiting_approval" || item.humanApproval.approvalRequestId) return item;
      const { request } = upsertApprovalRequest(
        {
          relatedType: DEPARTMENT_APPLY_RELATED_TYPE as "department_apply_item",
          relatedId: item.applyItemId,
          title: `Apply del departamento: ${item.title}`,
          summary: `Pasada ${departmentRunId}, recomendacion #${item.recommendationRank}. Capacidad: ${String(item.applyCapability.id)}. ${item.applyCapability.reason} Esto actualizaria title/meta de un BORRADOR de staging existente (nunca publica, nunca produccion), con snapshot previo y rollback automatico si la validacion falla.`,
          riskLevel: "medium",
          requestedAction: "Aprobar el apply reversible en staging de este elemento del Daily Brief.",
          options: ["approved", "rejected", "snoozed"],
          channel: "telegram",
        },
        current
      );
      return {
        ...item,
        humanApproval: { ...item.humanApproval, approvalRequestId: request.approvalRequestId },
        auditTrail: [
          ...item.auditTrail,
          { at: new Date().toISOString(), event: "approval_requested", detail: `Solicitud de aprobacion humana creada en el registro del proyecto (approvalRequestId=${request.approvalRequestId}). Sin respuesta, no se ejecuta nada.` },
        ],
      };
    });
    summary = { ...summary, items };
  }

  summary = updateApplySummaryItems(summary, summary.items, {
    externalWritesPerformed: false,
    applyNotAttemptedReason: canCreateRequests
      ? "Fase de planificacion: no se ha aplicado nada. Las solicitudes de aprobacion estan creadas y esperan respuesta humana."
      : "Fase de planificacion: no se ha aplicado nada. DEPARTMENT_APPLY_APPROVAL_REQUESTS_ENABLED no esta activo, asi que tampoco se han creado solicitudes de aprobacion en este entorno (el registro de aprobaciones vive donde el proyecto es persistente).",
  });

  const filePath = writeApplySummary(summary);
  console.log(`Contrato de apply escrito en ${toRepoRelative(filePath)}: ${summarize(summary) || "sin elementos"}.`);
  console.log(`Paginas de staging propias disponibles como destino: ${ownedStagingPages.length}.`);
  for (const item of summary.items) {
    console.log(`  - [${item.applyStatus}] #${item.recommendationRank} ${item.title} -- aprobacion humana: ${item.humanApproval.status}`);
  }
}

async function phaseApply(args: Record<string, string>): Promise<void> {
  const departmentRunId = requireDepartmentRunId(args);
  const summary = readApplySummary(departmentRunId);
  if (!summary) {
    throw new Error(`No existe apply-summary.json en la pasada "${departmentRunId}". Ejecuta antes "--phase plan".`);
  }

  const guards: ApplyEnvironmentGuards = {
    departmentApplyEnabled: isEnabled("DEPARTMENT_APPLY_ENABLED"),
    wordpressDraftsEnabled: isWordpressDraftsEnabled(),
    wordpressBackend: resolveWordpressBackend(),
    wordpressEnv: resolveWordpressEnv(),
  };
  const guardCheck = checkApplyEnvironmentGuards(guards);
  console.log(`Interruptores de apply: ${guardCheck.reason}`);

  const approved = summary.items.filter((item) => item.applyStatus === "approved");
  if (approved.length === 0) {
    const updated = updateApplySummaryItems(summary, summary.items, {
      externalWritesPerformed: false,
      applyNotAttemptedReason: "Ningun elemento tiene aprobacion humana explicita y vigente en este momento: no se ha intentado ninguna escritura.",
    });
    writeApplySummary(updated);
    console.log("Ningun elemento aprobado. No se ha escrito nada en ningun sistema.");
    return;
  }

  const results: DepartmentApplyItem[] = [];
  let externalWritesPerformed = false;
  for (const item of summary.items) {
    if (item.applyStatus !== "approved") {
      results.push(item);
      continue;
    }
    const executed = await executeApplyItem(
      item,
      {
        getPage: async (pageId) => {
          const page = await getWordpressPage(pageId);
          return { id: page.id, status: page.status, title: page.title, contentHtml: page.contentHtml, excerpt: page.excerpt };
        },
        updateDraft: async (input) => {
          await updateWordpressDraftPage({ pageId: input.pageId, title: input.title, contentHtml: input.contentHtml, excerpt: input.excerpt });
        },
      },
      guards
    );
    if (["applied", "validation_failed", "rolled_back"].includes(executed.applyStatus) || executed.rollbackStatus !== "not_needed") {
      externalWritesPerformed = true;
    }
    results.push(executed);
    console.log(`  - ${executed.applyItemId}: ${executed.applyStatus} (validacion=${executed.validationStatus}, rollback=${executed.rollbackStatus})`);
  }

  const updated = updateApplySummaryItems(summary, results, {
    externalWritesPerformed,
    applyNotAttemptedReason: guardCheck.allowed ? "" : guardCheck.reason,
  });
  writeApplySummary(updated);
  console.log(`Apply terminado: ${summarize(updated)}.`);

  const critical = results.filter((item) => item.rollbackStatus === "rollback_failed");
  if (critical.length > 0) {
    console.error(`CRITICO: ${critical.length} elemento(s) con rollback fallido. Requiere intervencion humana inmediata.`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const phase = args.phase as Phase | undefined;
  if (phase === "plan") {
    phasePlan(args);
    return;
  }
  if (phase === "apply") {
    await phaseApply(args);
    return;
  }
  throw new Error('--phase invalido o ausente. Fases validas: "plan", "apply".');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
