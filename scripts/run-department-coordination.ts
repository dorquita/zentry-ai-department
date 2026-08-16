/**
 * Runner de la PASADA COORDINADA del departamento -- ver
 * docs/department-coordination.md.
 *
 * Este script NUNCA llama a WordPress, staging, produccion, Google Ads,
 * GA4/GTM, Search Console, n8n, email ni a ningun otro sistema externo,
 * y nunca commitea nada. Solo lee registros ya persistidos + las salidas
 * de los empleados de ESTA misma pasada, y escribe ficheros locales bajo
 * `reports/department/<departmentRunId>/`.
 *
 * Tampoco invoca a Claude por si mismo: igual que todos los runners de
 * empleado de este repositorio, prepara prompts y valida respuestas --
 * la invocacion real la hace el runtime comun
 * (.github/actions/claude-employee-runtime), que este script NO modifica.
 *
 * Fases (`--phase`):
 *
 *   init                     Crea el run + manifiesto. Registra SEM como not_available.
 *   record-stage             Registra una etapa de especialista ya ejecutada por su propio runner.
 *   prepare-growth           Construye el contexto de Growth CON las salidas reales de los especialistas.
 *   complete-growth          Valida/audita la salida de Growth y la registra.
 *   prepare-qa               Construye el bundle que revisara qa-reviewer.
 *   complete-qa              Registra la revision de QA y resuelve QUE se promueve (puerta fail-closed).
 *   prepare-web-engineer     Construye el contexto SOLO con lo que sobrevivio Growth + QA.
 *   complete-web-engineer    Valida/audita la especificacion tecnica y la registra.
 *   brief                    Ensambla el Daily Brief (JSON + Markdown + resumen para Step Summary).
 *   gate                     Veredicto final del run (degradacion tolerada vs. fallo real).
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { extractJsonFromModelResponse } from "../src/core/claude-employee-runtime";
import { assertSubagentIsToolless } from "../src/core/subagent-tool-guard";
import { auditGrowthDirectorV2Output, validateGrowthDirectorV2Output } from "../src/employees/growth-director-v2/domain";
import { GrowthDirectorV2Output } from "../src/employees/growth-director-v2/types";
import { QaReviewerOutput, validateQaReviewerOutput } from "../src/employees/qa-reviewer/output";
import { auditWebEngineerOutputForUnconfirmedCapabilities, validateWebEngineerOutput } from "../src/employees/web-engineer/validator";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import { loadPreviousHumanFeedback } from "../src/approvals/manual/decision-store";
import { emptyStagingInventory, StagingInventory, summarizeInventoryForPrompt } from "../src/department/staging-inventory";
import { buildChangePlanFromDraft, parseChangePlanDrafts } from "../src/department/web-engineer-changeplan";
import { readApplySummary } from "../src/department/apply/store";
import { buildDepartmentDailyBrief, DepartmentDailyBrief, PreviousRunSnapshot, renderDepartmentDailyBriefMarkdown, renderDepartmentStepSummary } from "../src/department/daily-brief";
import { summarizeDepartmentRunCost } from "../src/department/employee-runs";
import { buildDepartmentGrowthContext, buildDepartmentGrowthPrompt, DepartmentGrowthContext } from "../src/department/growth-input";
import { buildDepartmentQaInputBundle } from "../src/department/qa-input";
import { DepartmentPromotionResult, resolvePromotion } from "../src/department/promotion";
import {
  DEPARTMENT_RUNNER_PHASES,
  DepartmentRunnerPhase,
  DepartmentRunnerResultSummary,
  EMPTY_DEPARTMENT_RUNNER_RESULT,
} from "../src/department/runner-result";
import {
  findPreviousDepartmentRunBriefPath,
  findStageRecord,
  fromRepoRelative,
  initDepartmentRun,
  readDepartmentEmployeeRuns,
  readManifest,
  readStageOutput,
  recordStage,
  resolveDepartmentRunPaths,
  resolveStageFilePaths,
  toRepoRelative,
  writeDepartmentJson,
  writeStageContext,
  writeStagePrompt,
} from "../src/department/run-store";
import { attributeEvidenceRefToEmployees, loadSpecialistInputs } from "../src/department/specialist-inputs";
import { buildWebEngineerDiagnostics, renderWebEngineerDiagnosticsLines } from "../src/department/web-engineer-diagnostics";
import { buildRecommendationId } from "../src/department/apply/types";
import {
  buildDepartmentCoordinationRunId,
  DepartmentRunManifest,
  DepartmentStageName,
  DepartmentStageStatus,
  isDepartmentStageName,
  isDepartmentStageStatus,
} from "../src/department/types";
import { buildDepartmentWebEngineerContext, buildDepartmentWebEngineerPrompt, DepartmentWebEngineerContext, toWebEngineerAuditContext } from "../src/department/web-engineer-input";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

function printResult(result: DepartmentRunnerResultSummary): void {
  console.log("RUNNER_RESULT_JSON=" + JSON.stringify(result));
}

function baseResult(phase: DepartmentRunnerPhase, departmentRunId: string, status: string, reason: string): DepartmentRunnerResultSummary {
  const paths = resolveDepartmentRunPaths(departmentRunId);
  return {
    ...EMPTY_DEPARTMENT_RUNNER_RESULT,
    phase,
    departmentRunId,
    status,
    reason,
    runDir: toRepoRelative(paths.runDir),
    manifestPath: toRepoRelative(paths.manifestPath),
  };
}

function requireDepartmentRunId(args: Record<string, string>): string {
  const id = args.departmentRunId;
  if (!id || id === "true") {
    throw new Error("Falta --departmentRunId <id> (el id impreso por la fase init).");
  }
  return id;
}

function readModelOutput(filePath: string): unknown {
  const rawText = fs.readFileSync(path.resolve(filePath), "utf-8");
  // Tolerante a fences de markdown alrededor del JSON, mismo criterio
  // que todos los runners de empleado -- ver extractJsonFromModelResponse.
  return extractJsonFromModelResponse(rawText);
}

/** Mueve una salida invalida a `output-raw-invalid.json` para inspeccion humana y deja la ruta canonica VACIA (nunca se registra como salida buena). */
function quarantineInvalidOutput(departmentRunId: string, stage: DepartmentStageName, content: string): string {
  const { stageDir, outputPath } = resolveStageFilePaths(departmentRunId, stage);
  fs.mkdirSync(stageDir, { recursive: true });
  const quarantinePath = path.join(stageDir, "output-raw-invalid.json");
  fs.writeFileSync(quarantinePath, content, "utf-8");
  if (fs.existsSync(outputPath)) fs.rmSync(outputPath);
  return quarantinePath;
}

function readStageOutputTyped<T>(manifest: DepartmentRunManifest, stage: DepartmentStageName, validate: (raw: unknown) => T): T | undefined {
  const raw = readStageOutput(manifest, stage);
  if (raw === undefined) return undefined;
  try {
    return validate(raw);
  } catch {
    // Una salida registrada como `executed` que ya no valida es un
    // estado imposible salvo manipulacion externa del run -- se trata
    // como ausente (fail-closed), nunca como parcialmente utilizable.
    return undefined;
  }
}

function stageStatusOf(manifest: DepartmentRunManifest, stage: DepartmentStageName): { status: DepartmentStageStatus; reason: string; auditWarningCount: number } {
  const record = findStageRecord(manifest, stage);
  return {
    status: record?.status ?? "not_available",
    reason: record?.reason ?? "La etapa no llego a registrarse en el manifiesto de esta pasada.",
    auditWarningCount: record?.auditWarningCount ?? 0,
  };
}

/**
 * Anexa al motivo registrado lo que el runtime comun reporto de esa
 * invocacion (`claude-outcome` / `output-source`, los dos unicos outputs
 * que expone la composite action). Sin esto, un fallo dentro del runtime
 * solo era diagnosticable leyendo miles de lineas de log; con esto queda
 * en el manifiesto y, por tanto, en el Daily Brief y en el artifact.
 */
function withRuntimeNote(reason: string, args: Record<string, string>): string {
  const note = args["runtime-note"];
  if (!note || note === "true") return reason;
  return `${reason} [runtime: ${note}]`;
}

function loadPromotion(departmentRunId: string): DepartmentPromotionResult | undefined {
  const { promotionPath } = resolveDepartmentRunPaths(departmentRunId);
  if (!fs.existsSync(promotionPath)) return undefined;
  return JSON.parse(fs.readFileSync(promotionPath, "utf-8")) as DepartmentPromotionResult;
}

// --- Fases ----------------------------------------------------------------

function phaseInit(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = args.departmentRunId && args.departmentRunId !== "true" ? args.departmentRunId : buildDepartmentCoordinationRunId();
  initDepartmentRun(departmentRunId);
  // SEM queda registrado desde el minuto cero como pendiente: siempre
  // visible en el informe, nunca capaz de bloquear la pasada.
  recordStage({
    departmentRunId,
    stage: "sem-specialist",
    status: "not_available",
    reason: "sem-specialist queda explicitamente FUERA de esta fase (pendiente). No se ejecuta, no se intenta arreglar, y su ausencia nunca bloquea la pasada del departamento.",
  });
  console.log(`Pasada coordinada del departamento iniciada: ${departmentRunId}`);
  return baseResult("init", departmentRunId, "initialized", "Manifiesto creado. SEM registrado como not_available (pendiente).");
}

function phaseRecordStage(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const stage = args.stage;
  if (!isDepartmentStageName(stage)) {
    throw new Error(`--stage "${String(stage)}" no es una etapa conocida del departamento.`);
  }
  const status = args.status;
  if (!isDepartmentStageStatus(status)) {
    throw new Error(`--status "${String(status)}" no es un estado valido (executed/blocked/invalid_output/not_available/failed).`);
  }
  const reason = args.reason && args.reason !== "true" ? args.reason : `Etapa registrada con status ${status} por el workflow de coordinacion.`;
  const auditWarnings = args["audit-warnings"] && args["audit-warnings"] !== "true" ? Number(args["audit-warnings"]) : null;

  const record = recordStage({
    departmentRunId,
    stage,
    status,
    reason,
    sourceOutputPath: status === "executed" && args.output && args.output !== "true" ? args.output : undefined,
    sourceArtifactPath: args.artifact && args.artifact !== "true" ? args.artifact : undefined,
    sourceRunId: args["source-run-id"] && args["source-run-id"] !== "true" ? args["source-run-id"] : null,
    auditWarningCount: auditWarnings !== null && Number.isFinite(auditWarnings) ? auditWarnings : null,
  });

  console.log(`Etapa registrada: ${stage} -> ${status} (${reason})`);
  return {
    ...baseResult("record-stage", departmentRunId, status, reason),
    expectedOutputPath: record.outputPath ?? "",
    auditWarningCount: record.auditWarningCount ?? 0,
  };
}

function phasePrepareGrowth(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  assertSubagentIsToolless("growth-director-v2");
  const manifest = readManifest(departmentRunId);
  const specialists = loadSpecialistInputs(manifest);
  const context = buildDepartmentGrowthContext(departmentRunId, specialists, args.eventBusRunId && args.eventBusRunId !== "true" ? args.eventBusRunId : undefined);
  const prompt = buildDepartmentGrowthPrompt(context, loadPreviousHumanFeedback());

  writeStageContext(departmentRunId, "growth-director-v2", context);
  const promptPath = writeStagePrompt(departmentRunId, "growth-director-v2", prompt);
  const { outputPath } = resolveStageFilePaths(departmentRunId, "growth-director-v2");

  console.log(`growth-director-v2: contexto preparado con ${specialists.executedCount} especialista(s) con salida real y ${context.evidenceCatalog.length} entrada(s) de evidencia.`);
  return {
    ...baseResult("prepare-growth", departmentRunId, "prepared", `Contexto de Growth listo con ${specialists.executedCount} de 3 especialistas ejecutados en esta pasada.`),
    promptFilePath: toRepoRelative(promptPath),
    expectedOutputPath: toRepoRelative(outputPath),
    claudeRequired: true,
  };
}

function phaseCompleteGrowth(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const manifest = readManifest(departmentRunId);
  const { contextPath, outputPath } = resolveStageFilePaths(departmentRunId, "growth-director-v2");
  const outputArg = args.output && args.output !== "true" ? args.output : outputPath;

  if (!fs.existsSync(outputArg)) {
    const reason = withRuntimeNote(`growth-director-v2 no dejo ninguna salida en ${toRepoRelative(outputPath)} -- la invocacion de Claude no produjo un fichero utilizable.`, args);
    recordStage({ departmentRunId, stage: "growth-director-v2", status: "failed", reason });
    console.error(reason);
    process.exitCode = 1;
    return baseResult("complete-growth", departmentRunId, "failed", reason);
  }

  const rawText = fs.readFileSync(path.resolve(outputArg), "utf-8");
  let output: GrowthDirectorV2Output;
  try {
    output = validateGrowthDirectorV2Output(readModelOutput(outputArg));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const quarantinePath = quarantineInvalidOutput(departmentRunId, "growth-director-v2", rawText);
    const reason = withRuntimeNote(`Salida de growth-director-v2 invalida (fail-closed, no se reinterpreta): ${error}. Copia cruda en ${toRepoRelative(quarantinePath)}.`, args);
    recordStage({ departmentRunId, stage: "growth-director-v2", status: "invalid_output", reason });
    console.error(reason);
    process.exitCode = 1;
    return baseResult("complete-growth", departmentRunId, "invalid_output", reason);
  }

  const context = JSON.parse(fs.readFileSync(contextPath, "utf-8")) as DepartmentGrowthContext;
  const auditWarnings = auditGrowthDirectorV2Output(context, output);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  writeDepartmentJson(resolveStageFilePaths(departmentRunId, "growth-director-v2").artifactPath, {
    generatedAt: new Date().toISOString(),
    departmentRunId,
    employee: "growth-director-v2",
    auditWarnings,
    output,
    note: "Sintesis de solo lectura sobre las salidas reales de los especialistas de esta misma pasada. No se aplica nada.",
  });

  recordStage({
    departmentRunId,
    stage: "growth-director-v2",
    status: "executed",
    reason: `Sintesis valida sobre ${loadSpecialistInputs(manifest).executedCount} especialista(s) ejecutado(s). ${output.recommendedPriorities.length} prioridad(es) propuesta(s), ${auditWarnings.length} aviso(s) de auditoria de dominio.`,
    auditWarningCount: auditWarnings.length,
  });

  console.log(`growth-director-v2: salida valida. Prioridades: ${output.recommendedPriorities.length}. Avisos de auditoria: ${auditWarnings.length}.`);
  for (const warning of auditWarnings) console.log(`  [audit] ${warning}`);
  return {
    ...baseResult("complete-growth", departmentRunId, "executed", "Sintesis de Growth validada y registrada."),
    expectedOutputPath: toRepoRelative(outputPath),
    auditWarningCount: auditWarnings.length,
    priorityCount: output.recommendedPriorities.length,
  };
}

function phasePrepareQa(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  assertSubagentIsToolless("qa-reviewer");
  const manifest = readManifest(departmentRunId);
  const specialists = loadSpecialistInputs(manifest);
  const growthStage = stageStatusOf(manifest, "growth-director-v2");
  const growthOutput = readStageOutputTyped(manifest, "growth-director-v2", validateGrowthDirectorV2Output);
  const paths = resolveDepartmentRunPaths(departmentRunId);

  const bundle = buildDepartmentQaInputBundle(
    manifest,
    specialists,
    { status: growthStage.status, reason: growthStage.reason, output: growthOutput, auditWarnings: [] }
  );

  const hasSomethingToReview = specialists.executedCount > 0 || growthOutput !== undefined;
  if (!hasSomethingToReview) {
    const reason = "No hay nada que revisar en esta pasada: ningun especialista produjo salida utilizable y growth-director-v2 tampoco. No se invoca a QA (no se gasta inferencia para revisar el vacio).";
    recordStage({ departmentRunId, stage: "qa-reviewer", status: "not_available", reason });
    console.log(reason);
    return baseResult("prepare-qa", departmentRunId, "not_available", reason);
  }

  writeDepartmentJson(paths.qaInputPath, bundle);
  console.log(`qa-reviewer: bundle de revision escrito en ${toRepoRelative(paths.qaInputPath)}.`);
  return {
    ...baseResult("prepare-qa", departmentRunId, "prepared", `Bundle de QA listo (${specialists.executedCount} especialista(s) + growth=${growthStage.status}).`),
    qaInputPath: toRepoRelative(paths.qaInputPath),
    claudeRequired: true,
  };
}

interface QaReviewArtifactShape {
  reviewedArtifact?: { artifactPath?: string };
  result?: { status?: string; output?: unknown; error?: string };
}

function phaseCompleteQa(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const manifest = readManifest(departmentRunId);
  const paths = resolveDepartmentRunPaths(departmentRunId);
  const reviewArg = args["qa-review"];

  let qaOutput: QaReviewerOutput | undefined;
  let qaStatus: DepartmentStageStatus = "failed";
  let reason = "";

  if (!reviewArg || reviewArg === "true" || !fs.existsSync(reviewArg)) {
    reason = `qa-reviewer no dejo ningun artifact de revision utilizable (--qa-review "${String(reviewArg)}"). Fail-closed: la pasada continua, pero sin QA no se promueve nada.`;
  } else {
    const review = JSON.parse(fs.readFileSync(path.resolve(reviewArg), "utf-8")) as QaReviewArtifactShape;
    const reviewedPath = review.reviewedArtifact?.artifactPath ?? "";
    const expectedPath = toRepoRelative(paths.qaInputPath);
    if (reviewedPath !== expectedPath) {
      // Misma regla fail-closed que `assertReviewedArtifactMatches()` del
      // propio empleado, aplicada aqui a nivel de pasada: una revision
      // que no es de NUESTRO bundle no vale para NUESTRA puerta.
      reason = `La revision de QA apunta a "${reviewedPath}" pero esta pasada entrego "${expectedPath}". Fail-closed: no se acepta una revision de otro artifact.`;
      qaStatus = "invalid_output";
    } else if (review.result?.status === "executed") {
      try {
        qaOutput = validateQaReviewerOutput(review.result.output);
        qaStatus = "executed";
        reason = `Revision valida: reviewStatus=${qaOutput.reviewStatus}, ${qaOutput.findings.length} hallazgo(s), ${qaOutput.safetyConcerns.length} problema(s) de seguridad.`;
      } catch (err) {
        qaStatus = "invalid_output";
        reason = `La revision de QA no cumple el contrato QaReviewerOutput: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      qaStatus = review.result?.status === "invalid_output" ? "invalid_output" : "failed";
      reason = `qa-reviewer termino con status "${String(review.result?.status)}"${review.result?.error ? `: ${review.result.error}` : ""}.`;
    }
  }

  recordStage({
    departmentRunId,
    stage: "qa-reviewer",
    status: qaStatus,
    reason: qaStatus === "executed" ? reason : withRuntimeNote(reason, args),
    sourceOutputPath: qaStatus === "executed" && args["qa-output"] && args["qa-output"] !== "true" && fs.existsSync(args["qa-output"]) ? args["qa-output"] : undefined,
    sourceArtifactPath: reviewArg && reviewArg !== "true" && fs.existsSync(reviewArg) ? reviewArg : undefined,
  });

  const updated = readManifest(departmentRunId);
  const growthStage = stageStatusOf(updated, "growth-director-v2");
  const promotion = resolvePromotion({
    departmentRunId,
    growth: { status: growthStage.status, output: readStageOutputTyped(updated, "growth-director-v2", validateGrowthDirectorV2Output) },
    qa: { status: qaStatus, output: qaOutput },
  });
  writeDepartmentJson(paths.promotionPath, promotion);

  console.log(`qa-reviewer: status=${qaStatus}. Estado QA de departamento: ${promotion.departmentQaStatus}. Promovidas: ${promotion.promoted.length}. Bloqueadas: ${promotion.blocked.length}.`);
  if (promotion.globalBlockReason) console.log(`  [gate] ${promotion.globalBlockReason}`);

  return {
    ...baseResult("complete-qa", departmentRunId, qaStatus, reason),
    qaInputPath: toRepoRelative(paths.qaInputPath),
    promotionPath: toRepoRelative(paths.promotionPath),
    promotedCount: promotion.promoted.length,
    blockedCount: promotion.blocked.length,
    departmentQaStatus: promotion.departmentQaStatus,
  };
}

/** Lee el inventario que dejo `scripts/read-staging-inventory.ts`. Ausente = vacio con su motivo. */
function loadStagingInventoryFile(departmentRunId: string): StagingInventory {
  const filePath = path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "staging-inventory.json");
  if (!fs.existsSync(filePath)) {
    return emptyStagingInventory(
      "Esta pasada no incluyo el paso de lectura de staging (scripts/read-staging-inventory.ts). Sin inventario no se resuelve ningun pageId.",
      new Date().toISOString()
    );
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as StagingInventory;
  } catch (err) {
    return emptyStagingInventory(`El inventario de staging de esta pasada no es JSON utilizable (${err instanceof Error ? err.message : String(err)}).`, new Date().toISOString());
  }
}

function phasePrepareWebEngineer(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  assertSubagentIsToolless("web-engineer");
  const manifest = readManifest(departmentRunId);
  const promotion = loadPromotion(departmentRunId);
  const paths = resolveDepartmentRunPaths(departmentRunId);
  // La lectura de staging la hace scripts/read-staging-inventory.ts, que
  // es quien cablea el adaptador (mismo patron que el resto de sistemas
  // externos de este repo). Esta fase SOLO lee el fichero ya escrito:
  // la pasada coordinada no alcanza ningun sistema externo.
  const stagingInventory = loadStagingInventoryFile(departmentRunId);
  console.log(
    stagingInventory.pages.length > 0
      ? `Inventario REAL de staging leido: ${stagingInventory.pages.length} pagina(s) publicadas. Cero escrituras.`
      : `Inventario de staging NO disponible (${stagingInventory.unavailableReason}). web-engineer no podra declarar ningun changePlan y todo quedara como implementacion manual, que es el resultado correcto.`
  );

  if (!promotion) {
    const reason = "No existe promotion.json en esta pasada (la fase de QA no llego a resolver la puerta). Fail-closed: web-engineer no recibe nada.";
    recordStage({ departmentRunId, stage: "web-engineer", status: "blocked", reason });
    console.log(reason);
    return baseResult("prepare-web-engineer", departmentRunId, "blocked", reason);
  }

  if (promotion.promoted.length === 0) {
    const blockedByQa = promotion.blocked.length > 0 || promotion.globalBlockReason !== null;
    const status: DepartmentStageStatus = blockedByQa ? "blocked" : "not_available";
    const reason = blockedByQa
      ? `Ninguna recomendacion sobrevivio la puerta de QA (${promotion.blocked.length} bloqueada(s), estado QA ${promotion.departmentQaStatus}). ${promotion.globalBlockReason ?? ""}`.trim()
      : "growth-director-v2 no propuso ninguna prioridad en esta pasada -- no hay nada que especificar.";
    recordStage({ departmentRunId, stage: "web-engineer", status, reason });
    console.log(reason);
    return {
      ...baseResult("prepare-web-engineer", departmentRunId, status, reason),
      promotionPath: toRepoRelative(paths.promotionPath),
      promotedCount: 0,
      blockedCount: promotion.blocked.length,
      departmentQaStatus: promotion.departmentQaStatus,
    };
  }

  const specialists = loadSpecialistInputs(manifest);
  const growthOutput = readStageOutputTyped(manifest, "growth-director-v2", validateGrowthDirectorV2Output);
  const context = buildDepartmentWebEngineerContext({
    departmentRunId,
    promotion,
    growthSummary: growthOutput?.growthSummary ?? "",
    evidenceCatalog: [...specialists.evidenceCatalog, ...(growthOutput?.evidence ?? [])],
    specialistInputs: specialists.inputs,
    // Inventario REAL de staging, SOLO LECTURA. Es lo que permite que
    // web-engineer cite una pagina en vez de adivinarla. Cero
    // escrituras: este lector no tiene ninguna funcion que escriba.
    stagingInventory: summarizeInventoryForPrompt(stagingInventory),
    stagingInventoryUnavailableReason: stagingInventory.unavailableReason,
    // El inventario COMPLETO no va al prompt entero: se usa aqui para
    // resolver de forma determinista la pagina objetivo de cada
    // recomendacion y para adjuntar el BEFORE real SOLO de esas paginas.
    fullStagingInventory: stagingInventory,
  });
  const resolvedTargetCount = context.approvedRecommendations.filter((rec) => rec.targetResolutionStatus === "resolved").length;
  console.log(
    `Resolucion determinista de paginas objetivo: ${resolvedTargetCount}/${context.approvedRecommendations.length} recomendacion(es) con pagina resuelta; ${context.targetPageSnapshots.length} snapshot(s) BEFORE adjunto(s).`
  );
  for (const rec of context.approvedRecommendations) {
    console.log(`  [${rec.targetResolutionStatus}] ${rec.recommendationId} -> ${rec.resolvedTargets.map((t) => t.wordpressPageId).join(", ") || "-"} :: ${rec.targetResolutionReason}`);
  }
  const prompt = buildDepartmentWebEngineerPrompt(context, loadPreviousHumanFeedback());
  writeStageContext(departmentRunId, "web-engineer", context);
  const promptPath = writeStagePrompt(departmentRunId, "web-engineer", prompt);
  const { outputPath } = resolveStageFilePaths(departmentRunId, "web-engineer");

  console.log(`web-engineer: contexto preparado con ${promotion.promoted.length} recomendacion(es) aprobada(s) y ${promotion.blocked.length} bloqueada(s) (solo informativas).`);
  return {
    ...baseResult("prepare-web-engineer", departmentRunId, "prepared", `${promotion.promoted.length} recomendacion(es) aprobada(s) por Growth + QA.`),
    promptFilePath: toRepoRelative(promptPath),
    expectedOutputPath: toRepoRelative(outputPath),
    promotionPath: toRepoRelative(paths.promotionPath),
    promotedCount: promotion.promoted.length,
    blockedCount: promotion.blocked.length,
    departmentQaStatus: promotion.departmentQaStatus,
    claudeRequired: true,
  };
}

function phaseCompleteWebEngineer(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const { outputPath, contextPath, artifactPath } = resolveStageFilePaths(departmentRunId, "web-engineer");
  const outputArg = args.output && args.output !== "true" ? args.output : outputPath;

  if (!fs.existsSync(outputArg)) {
    const reason = withRuntimeNote(`web-engineer no dejo ninguna salida en ${toRepoRelative(outputPath)} -- la invocacion de Claude no produjo un fichero utilizable.`, args);
    recordStage({ departmentRunId, stage: "web-engineer", status: "failed", reason });
    console.error(reason);
    process.exitCode = 1;
    return baseResult("complete-web-engineer", departmentRunId, "failed", reason);
  }

  const rawText = fs.readFileSync(path.resolve(outputArg), "utf-8");
  let output: WebEngineerOutput;
  try {
    output = validateWebEngineerOutput(readModelOutput(outputArg));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const quarantinePath = quarantineInvalidOutput(departmentRunId, "web-engineer", rawText);
    const reason = withRuntimeNote(`Salida de web-engineer invalida (fail-closed, incluida la regla approvalRequired=true): ${error}. Copia cruda en ${toRepoRelative(quarantinePath)}.`, args);
    recordStage({ departmentRunId, stage: "web-engineer", status: "invalid_output", reason });
    console.error(reason);
    process.exitCode = 1;
    return baseResult("complete-web-engineer", departmentRunId, "invalid_output", reason);
  }

  const context = JSON.parse(fs.readFileSync(contextPath, "utf-8")) as DepartmentWebEngineerContext;
  const auditWarnings = auditWebEngineerOutputForUnconfirmedCapabilities(toWebEngineerAuditContext(context), output);

  // De INTENCION declarada a PLAN EJECUTABLE: el pageId, el BEFORE y el
  // ancla de version salen del inventario REAL, nunca del modelo.
  const inventoryPath = path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "staging-inventory.json");
  const stagingInventory: StagingInventory = fs.existsSync(inventoryPath)
    ? (JSON.parse(fs.readFileSync(inventoryPath, "utf-8")) as StagingInventory)
    : emptyStagingInventory("No se guardo inventario de staging en esta pasada.", new Date().toISOString());
  const { drafts, rejected } = parseChangePlanDrafts((output as { changePlans?: unknown }).changePlans);
  const approvedRecommendationIds = context.approvedRecommendations.map((rec) => rec.recommendationId);
  const resolvedPlans = drafts.map((draft) => buildChangePlanFromDraft({ draft, inventory: stagingInventory, approvedRecommendationIds }));
  const actionable = resolvedPlans.filter((r) => r.status === "ACTIONABLE");
  writeDepartmentJson(path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "change-plans.json"), {
    departmentRunId,
    generatedAt: new Date().toISOString(),
    draftsDeclared: drafts.length,
    draftsRejected: rejected,
    resolved: resolvedPlans,
  });
  console.log(
    `ChangePlans: ${drafts.length} declarado(s) por web-engineer, ${actionable.length} resuelto(s) como EJECUTABLE contra el inventario real, ${resolvedPlans.length - actionable.length} sin resolver (quedan manuales).`
  );

  // DIAGNOSTICO: una fila por recomendacion, con el motivo EXACTO. Es lo
  // que evita que "0 ChangePlans" vuelva a ser un numero sin explicacion.
  const promotionForDiagnostics = loadPromotion(departmentRunId);
  const diagnostics = buildWebEngineerDiagnostics({
    departmentRunId,
    context,
    resolved: resolvedPlans,
    rejectedDrafts: rejected,
    declaredCount: drafts.length,
    attributeEvidenceRef: attributeEvidenceRefToEmployees,
    blocked: (promotionForDiagnostics?.blocked ?? []).map((rec) => ({
      recommendationId: buildRecommendationId(departmentRunId, rec.rank),
      rank: rec.rank,
      blockedBy: rec.blockedBy,
    })),
  });
  writeDepartmentJson(path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "web-engineer-diagnostics.json"), diagnostics);
  for (const line of renderWebEngineerDiagnosticsLines(diagnostics)) console.log(line);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  writeDepartmentJson(artifactPath, {
    generatedAt: new Date().toISOString(),
    departmentRunId,
    employee: "web-engineer",
    auditWarnings,
    output,
    note: "Especificacion tecnica de solo propuesta (approvalRequired=true). No se ha implementado nada en ningun sistema.",
  });

  recordStage({
    departmentRunId,
    stage: "web-engineer",
    status: "executed",
    reason: `Especificacion tecnica valida: ${output.proposedChanges.length} cambio(s) propuesto(s), ${auditWarnings.length} aviso(s) de auditoria de capacidades no confirmadas.`,
    auditWarningCount: auditWarnings.length,
  });

  console.log(`web-engineer: salida valida. Cambios propuestos: ${output.proposedChanges.length}. Avisos: ${auditWarnings.length}.`);
  for (const warning of auditWarnings) console.log(`  [audit] ${warning}`);
  return {
    ...baseResult("complete-web-engineer", departmentRunId, "executed", "Especificacion tecnica validada y registrada."),
    expectedOutputPath: toRepoRelative(outputPath),
    auditWarningCount: auditWarnings.length,
  };
}

function loadPreviousRunSnapshot(departmentRunId: string): PreviousRunSnapshot | null {
  const previousBriefPath = findPreviousDepartmentRunBriefPath(departmentRunId);
  if (!previousBriefPath) return null;
  try {
    const previous = JSON.parse(fs.readFileSync(previousBriefPath, "utf-8")) as DepartmentDailyBrief;
    return {
      departmentRunId: previous.departmentRunId,
      priorityCount: previous.topPriorities.length,
      departmentQaStatus: previous.departmentQaStatus,
      executedStages: previous.stageStatuses.filter((s) => s.status === "executed").length,
    };
  } catch {
    return null;
  }
}

function phaseBrief(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const manifest = readManifest(departmentRunId);
  const paths = resolveDepartmentRunPaths(departmentRunId);
  const specialists = loadSpecialistInputs(manifest);

  const growthStage = stageStatusOf(manifest, "growth-director-v2");
  const qaStage = stageStatusOf(manifest, "qa-reviewer");
  const webStage = stageStatusOf(manifest, "web-engineer");

  const growthOutput = readStageOutputTyped(manifest, "growth-director-v2", validateGrowthDirectorV2Output);
  const webOutput = readStageOutputTyped(manifest, "web-engineer", validateWebEngineerOutput);

  let qaOutput: QaReviewerOutput | undefined;
  const qaRecord = findStageRecord(manifest, "qa-reviewer");
  if (qaStage.status === "executed" && qaRecord?.artifactPath) {
    try {
      const review = JSON.parse(fs.readFileSync(fromRepoRelative(qaRecord.artifactPath), "utf-8")) as QaReviewArtifactShape;
      qaOutput = validateQaReviewerOutput(review.result?.output);
    } catch {
      qaOutput = undefined;
    }
  }

  const promotion =
    loadPromotion(departmentRunId) ??
    resolvePromotion({ departmentRunId, growth: { status: growthStage.status, output: growthOutput }, qa: { status: qaStage.status, output: qaOutput } });

  const growthAuditWarnings = readGrowthAuditWarnings(departmentRunId);
  const webAuditWarnings = readWebEngineerAuditWarnings(departmentRunId);

  // APPLY y COSTE son ADITIVOS: si la pasada no los produjo, el brief lo
  // dice explicitamente en vez de omitirlo o inventarlo.
  let applySummary = null;
  try {
    applySummary = readApplySummary(departmentRunId) ?? null;
  } catch (err) {
    console.error(`[department] No se pudo leer el contrato de apply de esta pasada (${err instanceof Error ? err.message : String(err)}). El brief se genera sin la seccion de APPLY.`);
  }
  const cost = summarizeDepartmentRunCost(readDepartmentEmployeeRuns(departmentRunId));

  const brief = buildDepartmentDailyBrief({
    manifest,
    specialists,
    growth: { status: growthStage.status, reason: growthStage.reason, output: growthOutput, auditWarnings: growthAuditWarnings },
    qa: { status: qaStage.status, reason: qaStage.reason, output: qaOutput },
    webEngineer: { status: webStage.status, reason: webStage.reason, output: webOutput, auditWarnings: webAuditWarnings },
    promotion,
    previousRun: loadPreviousRunSnapshot(departmentRunId),
    apply: applySummary,
    cost: cost.runs.length > 0 ? cost : null,
  });

  writeDepartmentJson(paths.briefJsonPath, brief);
  fs.writeFileSync(paths.briefMdPath, renderDepartmentDailyBriefMarkdown(brief), "utf-8");
  fs.writeFileSync(paths.stepSummaryPath, renderDepartmentStepSummary(brief), "utf-8");

  console.log(`Daily Brief generado: ${toRepoRelative(paths.briefMdPath)}`);
  console.log(`Prioridades: ${brief.topPriorities.length}. Decisiones pendientes: ${brief.approvalsNeeded.length}. QA: ${brief.departmentQaStatus}.`);

  return {
    ...baseResult("brief", departmentRunId, "ok", `Daily Brief con ${brief.topPriorities.length} prioridad(es) y ${brief.approvalsNeeded.length} decision(es) pendiente(s).`),
    briefJsonPath: toRepoRelative(paths.briefJsonPath),
    briefMdPath: toRepoRelative(paths.briefMdPath),
    stepSummaryPath: toRepoRelative(paths.stepSummaryPath),
    promotionPath: fs.existsSync(paths.promotionPath) ? toRepoRelative(paths.promotionPath) : "",
    promotedCount: promotion.promoted.length,
    blockedCount: promotion.blocked.length,
    departmentQaStatus: promotion.departmentQaStatus,
    priorityCount: brief.topPriorities.length,
  };
}

function readArtifactAuditWarnings(departmentRunId: string, stage: DepartmentStageName): string[] {
  const { artifactPath } = resolveStageFilePaths(departmentRunId, stage);
  if (!fs.existsSync(artifactPath)) return [];
  try {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8")) as { auditWarnings?: unknown };
    return Array.isArray(artifact.auditWarnings) ? artifact.auditWarnings.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
}

function readGrowthAuditWarnings(departmentRunId: string): string[] {
  return readArtifactAuditWarnings(departmentRunId, "growth-director-v2");
}

function readWebEngineerAuditWarnings(departmentRunId: string): string[] {
  return readArtifactAuditWarnings(departmentRunId, "web-engineer");
}

/**
 * Veredicto final de la pasada. Distingue DEGRADACION (tolerada) de
 * FALLO REAL (no tolerado):
 *
 * - `not_available` / `blocked` en cualquier etapa: degradacion legitima
 *   y explicita -- la pasada sigue siendo valida.
 * - `invalid_output` / `failed` en CUALQUIER etapa: fallo real. La
 *   pasada se marca en rojo para que nadie lea el brief como si todo
 *   hubiera ido bien; el brief se genera igualmente (ya se genero antes
 *   de esta fase) con el estado real de cada etapa.
 *
 * Un especialista degradado NO tumba el departamento (sigue siendo
 * `not_available`), pero un especialista que devuelve basura SI se
 * reporta como fallo -- no es lo mismo "no habia datos" que "el
 * contrato se rompio".
 */
function phaseGate(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const manifest = readManifest(departmentRunId);
  const paths = resolveDepartmentRunPaths(departmentRunId);
  const broken = manifest.stages.filter((s) => s.status === "invalid_output" || s.status === "failed");
  const degraded = manifest.stages.filter((s) => s.status === "not_available" || s.status === "blocked");

  if (!fs.existsSync(paths.briefJsonPath)) {
    const reason = "La pasada no llego a generar el Daily Brief -- fallo real de la coordinacion.";
    console.error(reason);
    process.exitCode = 1;
    return baseResult("gate", departmentRunId, "failed", reason);
  }

  if (broken.length > 0) {
    const reason = `Etapas con fallo real: ${broken.map((s) => `${s.stage}=${s.status}`).join(", ")}. El Daily Brief se ha generado igualmente con el estado real de cada etapa, pero la pasada se marca en rojo.`;
    console.error(reason);
    process.exitCode = 1;
    return baseResult("gate", departmentRunId, "degraded", reason);
  }

  const reason =
    degraded.length > 0
      ? `Pasada completa. Degradaciones explicitas (toleradas, no son fallos): ${degraded.map((s) => `${s.stage}=${s.status}`).join(", ")}.`
      : "Pasada completa sin degradaciones.";
  console.log(reason);
  return baseResult("gate", departmentRunId, "ok", reason);
}

// `prepare-web-engineer` es async: LEE el inventario real de staging
// antes de construir el contexto. Las demas siguen siendo sincronas y el
// dispatcher las envuelve por igual.
const PHASES: Record<DepartmentRunnerPhase, (args: Record<string, string>) => DepartmentRunnerResultSummary | Promise<DepartmentRunnerResultSummary>> = {
  init: phaseInit,
  "record-stage": phaseRecordStage,
  "prepare-growth": phasePrepareGrowth,
  "complete-growth": phaseCompleteGrowth,
  "prepare-qa": phasePrepareQa,
  "complete-qa": phaseCompleteQa,
  "prepare-web-engineer": phasePrepareWebEngineer,
  "complete-web-engineer": phaseCompleteWebEngineer,
  brief: phaseBrief,
  gate: phaseGate,
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const phase = args.phase as DepartmentRunnerPhase | undefined;
  if (!phase || !(DEPARTMENT_RUNNER_PHASES as string[]).includes(phase)) {
    throw new Error(`--phase invalido o ausente. Fases validas: ${DEPARTMENT_RUNNER_PHASES.join(", ")}.`);
  }
  printResult(await PHASES[phase](args));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
