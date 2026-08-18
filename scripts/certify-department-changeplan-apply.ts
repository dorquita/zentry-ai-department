/**
 * CERTIFICACION DEL CAMINO recomendacion -> ChangePlan -> apply en STAGING.
 *
 * PARA QUE EXISTE. La pasada diaria puede concluir, legitimamente, que
 * hoy no hay ningun cambio suficientemente util o seguro que hacer. Ese
 * es un resultado correcto y no se fuerza. Pero entonces esa pasada no
 * demuestra que el sistema SEPA ejecutar un ChangePlan cuando si lo hay,
 * y eso es justo lo que hay que poder afirmar.
 *
 * Este script cierra ese hueco con un ChangePlan CONTROLADO y REVERSIBLE,
 * sin tocar ni una sola recomendacion real.
 *
 * LO QUE LO HACE UNA CERTIFICACION Y NO UNA DEMO. No reimplementa nada
 * del camino que dice certificar: monta el estado minimo de una pasada
 * (promocion + salida de web-engineer) y a partir de ahi invoca las
 * FASES REALES, las mismas que corren en la pasada diaria:
 *
 *     complete-web-engineer  -> resuelve el ChangePlan contra el
 *                               inventario REAL (pageId, BEFORE, hash)
 *     apply --phase plan     -> construye el contrato de apply
 *     apply --phase stage    -> ejecuta: snapshot -> apply -> read-back
 *                               -> validacion de scope -> rollback si falla
 *
 * Si alguna de esas fases estuviera rota, este script falla. Ese es el
 * punto: un atajo que escribiera directamente en WordPress demostraria
 * que WordPress acepta escrituras, no que el departamento sepa llegar
 * hasta ahi.
 *
 * REVERSIBILIDAD. El cambio se aplica y despues se REVIERTE con un
 * segundo ChangePlan que restaura el valor original leido, por el mismo
 * camino. Al final se relee la pagina y se comprueba que el valor
 * coincide EXACTAMENTE con el de partida. Sin esa comprobacion final,
 * "reversible" seria una intencion, no un hecho.
 *
 * QUE TOCA: el `excerpt` (extracto) de UNA pagina de staging ya
 * publicada. Se elige a proposito el campo menos visible que sigue
 * siendo un campo real: no altera el cuerpo de la pagina, no cambia su
 * title, y su BEFORE se lee entero antes de escribir.
 *
 * PRODUCCION: inalcanzable. Este script no recibe ninguna credencial de
 * produccion, el entorno se fija a staging, y las tres capas de guard
 * (politica de ejecucion, adaptador y store) lo rechazan por separado.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { readStagingInventory, readStagingPage } from "../src/adapters/staging-inventory-reader";
import { StagingInventory, StagingPageSnapshot } from "../src/department/staging-inventory";
import { DepartmentPromotionResult } from "../src/department/promotion";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import { resolveDepartmentRunPaths, resolveStageFilePaths, toRepoRelative } from "../src/department/run-store";
import { buildDepartmentWebEngineerContext } from "../src/department/web-engineer-input";
import { summarizeInventoryForPrompt } from "../src/department/staging-inventory";

const CERTIFICATION_MARKER = "[certificacion apply departamento]";

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

function run(script: string, args: string[]): string {
  const output = execFileSync("npx", ["ts-node", script, ...args], {
    encoding: "utf-8",
    env: { ...process.env, WORDPRESS_ENV: "staging" },
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(output);
  return output;
}

/**
 * Elige la pagina objetivo. Criterio deliberadamente estrecho: publicada,
 * con URL real registrada, y con un `excerpt` NO VACIO -- porque
 * restaurar un valor que existia es comprobable, y "restaurar el vacio"
 * es indistinguible de no haber restaurado nada.
 */
function chooseTarget(inventory: StagingInventory, requestedId: number | null): StagingPageSnapshot {
  const candidates = inventory.pages.filter(
    (page) => page.status === "publish" && page.stagingUrl.trim().length > 0 && page.excerpt.trim().length > 0
  );
  if (requestedId !== null) {
    const requested = candidates.find((page) => page.wordpressPageId === requestedId);
    if (!requested) {
      throw new Error(
        `La pagina ${requestedId} no sirve como destino de certificacion: tiene que estar publicada, tener URL de staging y un excerpt no vacio. Candidatas validas: ${candidates.map((p) => p.wordpressPageId).join(", ") || "ninguna"}.`
      );
    }
    return requested;
  }
  if (candidates.length === 0) {
    throw new Error("Ninguna pagina del inventario sirve como destino de certificacion (publicada + URL + excerpt no vacio).");
  }
  // La de id mas bajo: determinista, para que dos ejecuciones de esta
  // certificacion toquen la misma pagina y sean comparables.
  return candidates.sort((a, b) => a.wordpressPageId - b.wordpressPageId)[0];
}

function buildPromotion(departmentRunId: string, title: string, rationale: string): DepartmentPromotionResult {
  return {
    departmentRunId,
    departmentQaStatus: "PASS",
    qaReviewStatus: "pass",
    globalBlockReason: null,
    promoted: [
      {
        rank: 1,
        title,
        rationale,
        impact: "low",
        confidence: "high",
        effort: "low",
        dependsOn: [],
        evidenceRefs: [],
        decision: "promoted",
        blockedBy: [],
        qaWarnings: [],
      },
    ],
    blocked: [],
    unattributedBlockingSignals: [],
    qaSummary: {
      criticalFindings: 0,
      warningFindings: 0,
      safetyConcerns: 0,
      contradictions: 0,
      unsupportedClaims: 0,
      requiredCorrections: 0,
    },
  };
}

function buildWebEngineerOutput(page: StagingPageSnapshot, recommendationId: string, newExcerpt: string, purpose: string): WebEngineerOutput {
  return {
    implementationSummary: `${purpose} sobre el extracto de la pagina de staging ${page.wordpressPageId}. ${CERTIFICATION_MARKER}`,
    targetPages: [page.stagingUrl],
    targetComponents: ["excerpt"],
    proposedChanges: [
      {
        description: `${purpose} el extracto de ${page.stagingUrl}.`,
        rationale: "Certificacion del camino de apply. No es una recomendacion de negocio.",
        targetPageOrComponent: page.stagingUrl,
      },
    ],
    filesOrSystemsAffected: ["WordPress staging (excerpt)"],
    acceptanceCriteria: ["El extracto releido coincide exactamente con el valor propuesto."],
    validationPlan: ["Releer la pagina por REST y comparar el extracto."],
    rollbackPlan: ["Restaurar el extracto original leido antes del cambio."],
    dependencies: [],
    risks: [],
    approvalRequired: true,
    unknowns: [],
    changePlans: [
      {
        recommendationId,
        targetPage: page.stagingUrl,
        operation: "update_post_excerpt",
        newValue: newExcerpt,
        rationale: `${purpose} el extracto. ${CERTIFICATION_MARKER}`,
      },
    ],
  } as WebEngineerOutput;
}

/** Monta el estado minimo de una pasada y lanza las fases REALES. */
async function applyControlledPlan(input: {
  departmentRunId: string;
  page: StagingPageSnapshot;
  inventory: StagingInventory;
  newExcerpt: string;
  purpose: string;
}): Promise<void> {
  const paths = resolveDepartmentRunPaths(input.departmentRunId);
  fs.mkdirSync(paths.runDir, { recursive: true });

  // Manifiesto minimo: el que crea la fase `init` real.
  run("scripts/run-department-coordination.ts", ["--phase", "init", "--departmentRunId", input.departmentRunId]);

  const title = `Certificacion del camino de apply ${CERTIFICATION_MARKER}`;
  const promotion = buildPromotion(input.departmentRunId, title, "Certificacion tecnica del camino de apply.");
  fs.writeFileSync(paths.promotionPath, JSON.stringify(promotion, null, 2), "utf-8");

  // El inventario REAL: es de donde la fase `complete-web-engineer` saca
  // el pageId, el BEFORE y el ancla de version. No se falsea.
  fs.writeFileSync(path.join(paths.runDir, "staging-inventory.json"), JSON.stringify(input.inventory, null, 2), "utf-8");

  const stage = resolveStageFilePaths(input.departmentRunId, "web-engineer");
  fs.mkdirSync(stage.stageDir, { recursive: true });
  // El contexto lo construye el MISMO builder que usa la pasada real.
  // Escribirlo a mano fue el primer intento y fallo por un campo que
  // faltaba -- y con razon: un contexto inventado a mano certifica que el
  // script sabe escribir JSON, no que la fase sepa consumir lo que la
  // pasada le entrega.
  const context = buildDepartmentWebEngineerContext({
    departmentRunId: input.departmentRunId,
    promotion,
    growthSummary: "Certificacion tecnica del camino de apply. No hay sintesis de Growth real en esta ejecucion.",
    evidenceCatalog: [],
    specialistInputs: [],
    stagingInventory: summarizeInventoryForPrompt(input.inventory),
    stagingInventoryUnavailableReason: input.inventory.unavailableReason,
    fullStagingInventory: input.inventory,
  });
  fs.writeFileSync(stage.contextPath, JSON.stringify(context, null, 2), "utf-8");
  fs.writeFileSync(
    stage.outputPath,
    JSON.stringify(buildWebEngineerOutput(input.page, `${input.departmentRunId}#rec-1`, input.newExcerpt, input.purpose), null, 2),
    "utf-8"
  );

  // FASES REALES a partir de aqui.
  run("scripts/run-department-coordination.ts", ["--phase", "complete-web-engineer", "--departmentRunId", input.departmentRunId]);
  run("scripts/run-department-apply.ts", ["--phase", "plan", "--departmentRunId", input.departmentRunId]);
  run("scripts/run-department-apply.ts", ["--phase", "stage", "--departmentRunId", input.departmentRunId]);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const requestedId = args.postId && args.postId !== "true" ? Number(args.postId) : null;

  console.log("Leyendo el inventario REAL de staging (solo lectura)...");
  const inventory = await readStagingInventory();
  if (inventory.unavailableReason) {
    throw new Error(`No se pudo leer el inventario de staging: ${inventory.unavailableReason}. Sin inventario no hay BEFORE, y sin BEFORE no se escribe.`);
  }

  const page = chooseTarget(inventory, requestedId);
  const originalExcerpt = page.excerpt;
  console.log(`Destino: post ${page.wordpressPageId} (${page.stagingUrl})`);
  console.log(`[1-before] excerpt = ${JSON.stringify(originalExcerpt)}`);

  const stamp = new Date().toISOString();
  const modifiedExcerpt = `${originalExcerpt} ${CERTIFICATION_MARKER} ${stamp}`;

  // --- APLICAR -------------------------------------------------------
  const applyRunId = `cert-apply-${stamp.replace(/[:.]/g, "").slice(0, 15)}Z`;
  console.log(`\n=== APPLY (departmentRunId ${applyRunId}) ===`);
  await applyControlledPlan({ departmentRunId: applyRunId, page, inventory, newExcerpt: modifiedExcerpt, purpose: "Modificar" });

  const afterApply = await readStagingPage(page.wordpressPageId);
  console.log(`[2-after] excerpt = ${JSON.stringify(afterApply.excerpt)}`);
  const applied = afterApply.excerpt.trim() === modifiedExcerpt.trim();
  console.log(`[2-after] el cambio se aplico de verdad: ${applied}`);

  // --- REVERTIR ------------------------------------------------------
  // Por el MISMO camino. Revertir "a mano" con una llamada directa
  // certificaria menos: probaria que sabemos escribir, no que el camino
  // que acabamos de usar tambien sabe deshacer.
  console.log(`\n=== REVERT ===`);
  const inventoryAfter = await readStagingInventory();
  const pageAfter = inventoryAfter.pages.find((p) => p.wordpressPageId === page.wordpressPageId);
  if (!pageAfter) throw new Error(`La pagina ${page.wordpressPageId} ha desaparecido del inventario entre el apply y el revert.`);

  const revertRunId = `cert-revert-${stamp.replace(/[:.]/g, "").slice(0, 15)}Z`;
  await applyControlledPlan({
    departmentRunId: revertRunId,
    page: pageAfter,
    inventory: inventoryAfter,
    newExcerpt: originalExcerpt,
    purpose: "Restaurar",
  });

  // --- COMPROBACION FINAL --------------------------------------------
  const final = await readStagingPage(page.wordpressPageId);
  const identicalToStart = final.excerpt.trim() === originalExcerpt.trim();
  console.log(`\n[3-final] excerpt = ${JSON.stringify(final.excerpt)}`);
  console.log(`[3-final] identicalToStart = ${identicalToStart}`);

  const result = {
    postId: page.wordpressPageId,
    stagingUrl: page.stagingUrl,
    applyRunId,
    revertRunId,
    appliedThroughDepartmentPath: applied,
    identicalToStart,
    productionWrites: 0,
  };
  const reportDir = path.join(process.cwd(), "reports", "department-apply-certification");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${applyRunId}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ ...result, beforeExcerpt: originalExcerpt, modifiedExcerpt, finalExcerpt: final.excerpt }, null, 2),
    "utf-8"
  );
  console.log(`\nInforme en ${toRepoRelative(reportPath)}.`);
  console.log("CERTIFICATION_RESULT_JSON=" + JSON.stringify(result));

  // Fail-closed: si el cambio no se aplico, o si staging no volvio a su
  // estado original, esto NO es una certificacion superada.
  if (!applied) {
    console.error("FALLO: el ChangePlan no llego a modificar la pagina por el camino del departamento.");
    process.exitCode = 1;
  }
  if (!identicalToStart) {
    console.error("CRITICO: staging NO ha vuelto a su estado inicial. Requiere intervencion humana inmediata.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
