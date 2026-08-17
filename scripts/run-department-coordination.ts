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
import { loadPreviousHumanFeedbackFromState } from "../src/approvals/manual/state-decision-reader";
import {
  loadPreviousRunSummaryFromState,
  recordRunBriefSummary,
} from "../src/persistence/run-continuity";
import { resolvePersistenceMode } from "../src/persistence/runtime";
import { emptyStagingInventory, StagingInventory, summarizeInventoryForPrompt } from "../src/department/staging-inventory";
import { buildChangePlanFromDraft, parseChangePlanDrafts, ResolvedChangePlan } from "../src/department/web-engineer-changeplan";
import { readApplySummary } from "../src/department/apply/store";
import { buildDepartmentDailyBrief, DepartmentDailyBrief, PreviousRunSnapshot, renderDepartmentDailyBriefMarkdown, renderDepartmentStepSummary } from "../src/department/daily-brief";
import { summarizeDepartmentRunCost } from "../src/department/employee-runs";
import { buildDepartmentGrowthContext, buildDepartmentGrowthPrompt, DepartmentGrowthContext } from "../src/department/growth-input";
import { buildDepartmentQaInputBundle } from "../src/department/qa-input";
import { buildPlanQaInputBundle } from "../src/department/plan-qa-input";
import {
  appendQaLoopRound,
  decideQaLoop,
  emptyQaLoopRecord,
  QaLoopRecord,
  renderQaLoopSummary,
  reviewIsBlocking,
} from "../src/department/qa-correction";
import { buildWebEngineerCorrectionContext, buildWebEngineerCorrectionPrompt } from "../src/department/web-engineer-correction-input";
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
  resolvePlanQaInputPath,
  resolveQaLoopPath,
  resolveStageDir,
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
  DepartmentQaStatus,
  DepartmentStageName,
  DepartmentStageStatus,
  isDepartmentStageName,
  isDepartmentStageStatus,
} from "../src/department/types";

/** Vocabulario de QA del departamento, para validar lo que vuelve de MongoDB. */
const DEPARTMENT_QA_STATUSES: DepartmentQaStatus[] = ["PASS", "PASS_WITH_WARNINGS", "BLOCKED", "NOT_AVAILABLE"];
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

async function phasePrepareGrowth(args: Record<string, string>): Promise<DepartmentRunnerResultSummary> {
  const departmentRunId = requireDepartmentRunId(args);
  assertSubagentIsToolless("growth-director-v2");
  const manifest = readManifest(departmentRunId);
  const specialists = loadSpecialistInputs(manifest);
  const context = buildDepartmentGrowthContext(departmentRunId, specialists, args.eventBusRunId && args.eventBusRunId !== "true" ? args.eventBusRunId : undefined);
  const prompt = buildDepartmentGrowthPrompt(context, await loadPreviousHumanFeedbackFromState());

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

async function phasePrepareWebEngineer(args: Record<string, string>): Promise<DepartmentRunnerResultSummary> {
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
  // El feedback humano previo se lee del estado AUTORITATIVO (MongoDB),
  // no de los ficheros: esa es la unica fuente de verdad desde O56.
  const prompt = buildDepartmentWebEngineerPrompt(context, await loadPreviousHumanFeedbackFromState());
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
  // `--round` es la ronda del bucle de correccion de QA. 0 (por defecto)
  // es la propuesta original y conserva EXACTAMENTE las rutas de siempre.
  const round = parseRound(args);
  const { outputPath, contextPath, artifactPath } = resolveStageFilePaths(departmentRunId, "web-engineer", round);
  // El contexto de la ronda 0 es el que tiene el inventario, las
  // recomendaciones y el BEFORE. Las rondas de correccion lo reciben
  // dentro de su propio contexto, en `original`, asi que la auditoria de
  // capacidades se hace siempre contra el mismo sitio.
  const baseContextPath = resolveStageFilePaths(departmentRunId, "web-engineer", 0).contextPath;
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

  const context = JSON.parse(fs.readFileSync(baseContextPath, "utf-8")) as DepartmentWebEngineerContext;
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
  // `change-plans.json` es la ruta CANONICA que lee la capa de apply, y
  // siempre contiene la ULTIMA version producida. La foto de cada ronda
  // se conserva aparte para poder demostrar que la re-QA reviso el output
  // nuevo. Que la canonica lleve una version todavia no aceptada no es un
  // riesgo: quien decide si algo se ejecuta es el veredicto del bucle
  // (`qa-loop.json`), y un NEEDS_HUMAN_REVIEW bloquea todos los elementos.
  const changePlansPayload = {
    departmentRunId,
    round,
    generatedAt: new Date().toISOString(),
    draftsDeclared: drafts.length,
    draftsRejected: rejected,
    resolved: resolvedPlans,
  };
  writeDepartmentJson(path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "change-plans.json"), changePlansPayload);
  if (round > 0) {
    writeDepartmentJson(path.join(resolveStageDir(departmentRunId, "web-engineer", round), "change-plans.json"), changePlansPayload);
  }
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

  // `recordStage` SUSTITUYE el registro por nombre de etapa, asi que una
  // ronda de correccion pisaria el registro de la original y el
  // manifiesto perderia el historial. La ronda queda registrada en
  // `qa-loop.json`, que si acumula; el manifiesto guarda el estado
  // ACTUAL de la etapa, que es lo que representa.
  recordStage({
    departmentRunId,
    stage: "web-engineer",
    status: "executed",
    reason:
      round === 0
        ? `Especificacion tecnica valida: ${output.proposedChanges.length} cambio(s) propuesto(s), ${auditWarnings.length} aviso(s) de auditoria de capacidades no confirmadas.`
        : `Correccion (ronda ${round}) valida: ${output.proposedChanges.length} cambio(s) propuesto(s), ${auditWarnings.length} aviso(s). La version original y las rondas anteriores se conservan en stages/web-engineer/rounds/.`,
    auditWarningCount: auditWarnings.length,
  });

  console.log(`web-engineer (ronda ${round}): salida valida. Cambios propuestos: ${output.proposedChanges.length}. Avisos: ${auditWarnings.length}.`);
  for (const warning of auditWarnings) console.log(`  [audit] ${warning}`);
  return {
    ...baseResult("complete-web-engineer", departmentRunId, "executed", "Especificacion tecnica validada y registrada."),
    expectedOutputPath: toRepoRelative(outputPath),
    auditWarningCount: auditWarnings.length,
  };
}

// --- BUCLE QA -> CORRECCION -> RE-QA ---------------------------------------
//
// Lo que este bloque anade al circuito:
//
//     recomendacion -> ChangePlan -> QA DEL PLAN -> PASS -> apply staging
//                                        |
//                                       FAIL
//                                        |
//                            requiredCorrections[] dirigidas
//                                        |
//                              web-engineer corrige
//                                        |
//                                    re-QA (output NUEVO)
//
// Antes no existia NINGUNA revision del output de web-engineer: lo unico
// que de verdad se escribia en staging era justo lo unico que nadie
// revisaba. Y un FAIL de la QA que si existia (la de Growth) terminaba la
// pasada sin que nadie corrigiera nada.

/** Lee `--round`. Fail-closed: un valor que no sea un entero >= 0 es un error, nunca un 0 silencioso. */
function parseRound(args: Record<string, string>): number {
  const raw = args.round;
  if (raw === undefined || raw === "true") return 0;
  const round = Number(raw);
  if (!Number.isInteger(round) || round < 0) {
    throw new Error(`--round debe ser un entero >= 0; recibido "${raw}".`);
  }
  return round;
}

function readQaLoopRecord(departmentRunId: string): QaLoopRecord {
  const filePath = resolveQaLoopPath(departmentRunId);
  if (!fs.existsSync(filePath)) return emptyQaLoopRecord(departmentRunId, "web-engineer");
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as QaLoopRecord;
}

function readChangePlansForRound(departmentRunId: string, round: number): ResolvedChangePlan[] {
  const runDir = resolveDepartmentRunPaths(departmentRunId).runDir;
  const roundPath = path.join(resolveStageDir(departmentRunId, "web-engineer", round), "change-plans.json");
  const filePath = round > 0 && fs.existsSync(roundPath) ? roundPath : path.join(runDir, "change-plans.json");
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { resolved?: ResolvedChangePlan[] };
  return raw.resolved ?? [];
}

/**
 * Prepara el bundle que qa-reviewer revisara: la especificacion tecnica y
 * los ChangePlans de la ronda indicada. NO invoca a Claude -- igual que
 * el resto de fases, deja el prompt listo y el runtime comun lo ejecuta.
 */
function phasePreparePlanQa(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const round = parseRound(args);
  const manifest = readManifest(departmentRunId);
  const webOutput = readStageOutputTypedFromRound(departmentRunId, round);

  if (!webOutput) {
    const reason = `No hay salida valida de web-engineer para la ronda ${round}: no hay nada que revisar. La QA del plan se salta y el bucle no arranca.`;
    console.log(reason);
    return { ...baseResult("prepare-plan-qa", departmentRunId, "not_available", reason), claudeRequired: false };
  }

  const promotion = loadPromotion(departmentRunId);
  const approvedRecommendations = (promotion?.promoted ?? []).map((rec) => ({
    recommendationId: buildRecommendationId(departmentRunId, rec.rank),
    rank: rec.rank,
    title: rec.title,
    rationale: rec.rationale,
  }));

  const loop = readQaLoopRecord(departmentRunId);
  const previousCorrections = round === 0 ? [] : (loop.rounds[loop.rounds.length - 1]?.corrections ?? []);

  const bundle = buildPlanQaInputBundle({
    departmentRunId,
    round,
    approvedRecommendations,
    webEngineerOutput: webOutput,
    changePlans: readChangePlansForRound(departmentRunId, round),
    previousCorrections,
  });

  const bundlePath = resolvePlanQaInputPath(departmentRunId, round);
  writeDepartmentJson(bundlePath, bundle);

  console.log(
    `QA del plan (ronda ${round}): bundle preparado con ${bundle.changePlans.length} ChangePlan(s) y ${approvedRecommendations.length} recomendacion(es) aprobada(s). ${previousCorrections.length} correccion(es) de la ronda anterior a comprobar.`
  );
  return {
    ...baseResult("prepare-plan-qa", departmentRunId, "prepared", `Bundle de QA del plan listo para la ronda ${round}.`),
    qaInputPath: toRepoRelative(bundlePath),
    claudeRequired: true,
  };
}

/** Lee la salida de web-engineer de una ronda concreta. `undefined` si no existe o no valida. */
function readStageOutputTypedFromRound(departmentRunId: string, round: number): WebEngineerOutput | undefined {
  const { outputPath } = resolveStageFilePaths(departmentRunId, "web-engineer", round);
  if (!fs.existsSync(outputPath)) return undefined;
  try {
    return validateWebEngineerOutput(JSON.parse(fs.readFileSync(outputPath, "utf-8")));
  } catch {
    return undefined;
  }
}

/**
 * Registra la revision del plan y DECIDE que pasa despues: aceptar, pedir
 * correccion, o parar en NEEDS_HUMAN_REVIEW. Es la unica fase que puede
 * cerrar el bucle.
 */
function phaseCompletePlanQa(args: Record<string, string>): DepartmentRunnerResultSummary {
  const departmentRunId = requireDepartmentRunId(args);
  const round = parseRound(args);
  const outputArg = args.output && args.output !== "true" ? args.output : "";

  let loop = readQaLoopRecord(departmentRunId);

  if (!outputArg || !fs.existsSync(outputArg)) {
    // Sin revision no se puede afirmar que el plan sea bueno. Fail-closed:
    // el bucle termina pidiendo revision humana, NUNCA aceptando por
    // defecto -- que seria exactamente maquillar la ausencia de QA.
    const reason = withRuntimeNote(
      `qa-reviewer no dejo ninguna revision del plan para la ronda ${round}. Sin revision no se puede afirmar que el plan sea seguro: el bucle termina en NEEDS_HUMAN_REVIEW.`,
      args
    );
    loop = { ...loop, finalStatus: "NEEDS_HUMAN_REVIEW", finalReason: reason };
    writeDepartmentJson(resolveQaLoopPath(departmentRunId), loop);
    console.error(reason);
    return { ...baseResult("complete-plan-qa", departmentRunId, "NEEDS_HUMAN_REVIEW", reason), qaLoopStatus: "NEEDS_HUMAN_REVIEW" };
  }

  let review: QaReviewerOutput;
  try {
    review = validateQaReviewerOutput(readModelOutput(outputArg));
  } catch (err) {
    const reason = withRuntimeNote(
      `Revision del plan invalida en la ronda ${round}: ${err instanceof Error ? err.message : String(err)}. Fail-closed: NEEDS_HUMAN_REVIEW.`,
      args
    );
    loop = { ...loop, finalStatus: "NEEDS_HUMAN_REVIEW", finalReason: reason };
    writeDepartmentJson(resolveQaLoopPath(departmentRunId), loop);
    console.error(reason);
    return { ...baseResult("complete-plan-qa", departmentRunId, "NEEDS_HUMAN_REVIEW", reason), qaLoopStatus: "NEEDS_HUMAN_REVIEW" };
  }

  const decision = decideQaLoop({ review, round });
  const { outputPath: reviewedPath } = resolveStageFilePaths(departmentRunId, "web-engineer", round);

  loop = appendQaLoopRound(loop, {
    revision: round,
    qaAttempt: round + 1,
    employee: "web-engineer",
    reviewStatus: review.reviewStatus,
    blocking: reviewIsBlocking(review),
    action: decision.action,
    corrections: decision.corrections,
    reason: decision.reason,
    reviewedOutputPath: toRepoRelative(reviewedPath),
    reviewOutputPath: toRepoRelative(path.resolve(outputArg)),
    at: new Date().toISOString(),
  });
  writeDepartmentJson(resolveQaLoopPath(departmentRunId), loop);
  for (const line of renderQaLoopSummary(loop)) console.log(line);

  if (decision.action === "request_correction") {
    for (const correction of decision.corrections) {
      console.log(`  [correccion] ${correction.field || "(campo no concretado)"}: ${correction.problem}`);
    }
  }

  return {
    ...baseResult("complete-plan-qa", departmentRunId, loop.finalStatus, decision.reason),
    qaLoopStatus: loop.finalStatus,
    correctionRequired: decision.action === "request_correction",
    nextRound: decision.nextRound ?? 0,
  };
}

/**
 * Construye el encargo de correccion: la propuesta anterior integra, el
 * veredicto de QA y las correcciones accionables. No se vuelve a ejecutar
 * el departamento entero para corregir una recomendacion.
 */
async function phasePrepareWebEngineerCorrection(args: Record<string, string>): Promise<DepartmentRunnerResultSummary> {
  const departmentRunId = requireDepartmentRunId(args);
  const round = parseRound(args);
  if (round < 1) throw new Error("Una correccion es siempre la ronda 1 o posterior: --round 0 es la propuesta original.");

  const loop = readQaLoopRecord(departmentRunId);
  const lastRound = loop.rounds[loop.rounds.length - 1];
  if (!lastRound || lastRound.action !== "request_correction") {
    const reason = `El bucle de QA no ha pedido ninguna correccion (estado: ${loop.finalStatus}). No se prepara nada.`;
    console.log(reason);
    return { ...baseResult("prepare-web-engineer-correction", departmentRunId, "not_available", reason), claudeRequired: false };
  }

  const previousRound = round - 1;
  const previousOutput = readStageOutputTypedFromRound(departmentRunId, previousRound);
  if (!previousOutput) {
    const reason = `No se encuentra la propuesta de la ronda ${previousRound}. Sin la propuesta anterior, "corregir" seria "proponer de cero": no se pide.`;
    console.error(reason);
    return { ...baseResult("prepare-web-engineer-correction", departmentRunId, "not_available", reason), claudeRequired: false };
  }

  const original = JSON.parse(
    fs.readFileSync(resolveStageFilePaths(departmentRunId, "web-engineer", 0).contextPath, "utf-8")
  ) as DepartmentWebEngineerContext;

  const context = buildWebEngineerCorrectionContext({
    departmentRunId,
    round,
    maxRounds: loop.maxRounds,
    original,
    previousOutput,
    previousChangePlans: buildPlanQaInputBundle({
      departmentRunId,
      round: previousRound,
      approvedRecommendations: [],
      webEngineerOutput: previousOutput,
      changePlans: readChangePlansForRound(departmentRunId, previousRound),
    }).changePlans,
    qaVerdict: {
      reviewStatus: lastRound.reviewStatus,
      summary: lastRound.reason,
      safetyConcerns: [],
      unsupportedClaims: [],
    },
    corrections: lastRound.corrections,
  });

  const prompt = buildWebEngineerCorrectionPrompt(context, await loadPreviousHumanFeedbackFromState());
  const paths = resolveStageFilePaths(departmentRunId, "web-engineer", round);
  fs.mkdirSync(paths.stageDir, { recursive: true });
  writeDepartmentJson(paths.contextPath, context);
  fs.writeFileSync(paths.promptPath, prompt, "utf-8");

  console.log(
    `Correccion dirigida (ronda ${round} de ${loop.maxRounds}): ${lastRound.corrections.length} correccion(es) para web-engineer, con su propuesta anterior integra y el BEFORE real de cada plan.`
  );
  return {
    ...baseResult("prepare-web-engineer-correction", departmentRunId, "prepared", `Encargo de correccion listo (ronda ${round}).`),
    promptFilePath: toRepoRelative(paths.promptPath),
    expectedOutputPath: toRepoRelative(paths.outputPath),
    claudeRequired: true,
  };
}

/**
 * Fase O57 — la pasada anterior, desde MongoDB cuando es la fuente de
 * verdad y desde `reports/` cuando no lo es.
 *
 * NO es un fallback silencioso: `loadPreviousRunSummaryFromState`
 * devuelve `null` SOLO cuando el modo no es `mongo`. En modo `mongo`, si
 * MongoDB no responde, lanza y la pasada se para; y si responde pero no
 * hay pasada anterior, eso es un arranque en frio legitimo que el brief
 * ya sabe contar.
 */
async function loadPreviousRunSnapshotFromState(
  departmentRunId: string
): Promise<PreviousRunSnapshot | null> {
  if (resolvePersistenceMode() === "mongo") {
    const summary = await loadPreviousRunSummaryFromState(departmentRunId);
    if (!summary) return null;
    // La capa de persistencia guarda el estado de QA como texto a
    // proposito: no tiene por que conocer el vocabulario del
    // departamento. La traduccion al tipo del dominio se hace aqui, y un
    // valor que no reconozcamos se lee como NOT_AVAILABLE en vez de
    // colarse como si fuera un PASS.
    const qaStatus = DEPARTMENT_QA_STATUSES.includes(summary.departmentQaStatus as DepartmentQaStatus)
      ? (summary.departmentQaStatus as DepartmentQaStatus)
      : "NOT_AVAILABLE";
    return { ...summary, departmentQaStatus: qaStatus };
  }
  return loadPreviousRunSnapshot(departmentRunId);
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

async function phaseBrief(args: Record<string, string>): Promise<DepartmentRunnerResultSummary> {
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
    previousRun: await loadPreviousRunSnapshotFromState(departmentRunId),
    apply: applySummary,
    cost: cost.runs.length > 0 ? cost : null,
  });

  writeDepartmentJson(paths.briefJsonPath, brief);
  fs.writeFileSync(paths.briefMdPath, renderDepartmentDailyBriefMarkdown(brief), "utf-8");
  fs.writeFileSync(paths.stepSummaryPath, renderDepartmentStepSummary(brief), "utf-8");

  // El resumen que leera la pasada de MANANA. Con esto la continuidad
  // del brief deja de necesitar que se restaure `reports/` desde la rama
  // de estado: en modo `mongo` vive en `department_runs`.
  const summaryRecorded = await recordRunBriefSummary(
    {
      departmentRunId,
      priorityCount: brief.topPriorities.length,
      departmentQaStatus: brief.departmentQaStatus,
      executedStages: brief.stageStatuses.filter((s) => s.status === "executed").length,
    },
    new Date().toISOString()
  );
  if (summaryRecorded) {
    console.log("Resumen de la pasada guardado en MongoDB para la continuidad de la siguiente.");
  }

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
  "prepare-plan-qa": phasePreparePlanQa,
  "complete-plan-qa": phaseCompletePlanQa,
  "prepare-web-engineer-correction": phasePrepareWebEngineerCorrection,
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
