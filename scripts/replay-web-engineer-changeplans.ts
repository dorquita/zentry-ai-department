/**
 * REPLAY de la fase `web-engineer -> ChangePlan` sobre un contexto
 * CONGELADO de una pasada real.
 *
 * Por que existe: diagnosticar por que una pasada produjo "0
 * ChangePlans" costaba una pasada coordinada entera (seis invocaciones
 * de Claude, ~18 minutos, coste real) por cada hipotesis. Este script
 * reejecuta SOLO el tramo determinista -- resolucion de pagina objetivo,
 * construccion del ChangePlan contra el inventario, diagnostico por
 * recomendacion -- a partir de ficheros ya guardados.
 *
 * NO invoca a Claude. NO lee ni escribe en WordPress, staging ni
 * produccion. NO toca la red. Solo lee los dos ficheros que se le pasan
 * e imprime la matriz de diagnostico.
 *
 * Uso:
 *
 *   npm run department:replay-web-engineer -- \
 *     --context test/fixtures/dept-2026-08-16T134942Z-web-engineer-context.json \
 *     [--output test/fixtures/dept-2026-08-16T134942Z-web-engineer-output.json] \
 *     [--json]
 *
 * Sin `--output` se asume el caso historico: el modelo no declaro ningun
 * `changePlans[]`.
 *
 * LIMITACION DELIBERADA, y hay que tenerla presente al leer el
 * resultado: un contexto congelado trae el inventario como
 * `StagingPageBrief` (sin `post_content`). El inventario reconstruido
 * aqui lleva `contentHtml: ""`, asi que `update_post_content` cae en
 * `missing_before` y el `expectedBeforeHash` calculado NO es el de la
 * pagina real. Esto es un banco de diagnostico, no una via para producir
 * un plan ejecutable de verdad -- eso solo sale de la pasada real, con
 * el inventario completo leido por REST.
 */
import * as fs from "fs";
import * as path from "path";
import { WebEngineerOutput } from "../src/employees/web-engineer/types";
import {
  StagingInventory,
  StagingPageBrief,
  StagingPageSnapshot,
  STAGING_INVENTORY_CONTRACT_VERSION,
  buildTargetPageSnapshots,
} from "../src/department/staging-inventory";
import { attributeEvidenceRefToEmployees } from "../src/department/specialist-inputs";
import { buildChangePlanFromDraft, parseChangePlanDrafts } from "../src/department/web-engineer-changeplan";
import { buildWebEngineerDiagnostics, renderWebEngineerDiagnosticsLines } from "../src/department/web-engineer-diagnostics";
import { DepartmentWebEngineerContext, resolveRecommendationTargetFields } from "../src/department/web-engineer-input";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

/**
 * Reconstruye un `StagingInventory` a partir de los briefs del contexto
 * congelado. `contentHtml` va vacio A PROPOSITO: es lo unico honesto
 * cuando el cuerpo no se guardo, y hace que el resolver lo trate como
 * "BEFORE ausente" en vez de como "pagina vacia".
 */
export function inventoryFromBriefs(briefs: StagingPageBrief[], capturedAt: string): StagingInventory {
  const pages: StagingPageSnapshot[] = briefs.map((brief) => ({
    wordpressPageId: brief.wordpressPageId,
    slug: brief.slug,
    stagingUrl: brief.stagingUrl,
    status: brief.status,
    title: brief.title,
    excerpt: brief.excerpt,
    contentHtml: "",
    meta: {
      ...(brief.metaTitle !== null && brief.metaTitle !== undefined ? { _yoast_wpseo_title: brief.metaTitle } : {}),
      ...(brief.metaDescription !== null && brief.metaDescription !== undefined ? { _yoast_wpseo_metadesc: brief.metaDescription } : {}),
    },
  }));
  return {
    contractVersion: STAGING_INVENTORY_CONTRACT_VERSION,
    capturedAt,
    pages,
    unavailableReason:
      pages.length > 0
        ? ""
        : "El contexto congelado no traia inventario de staging: nada que resolver (que es exactamente lo que ocurrio en la pasada original).",
  };
}

/**
 * Aplica al contexto congelado los campos que el contrato NUEVO añade
 * (`recommendationId`, `resolvedTargets`, `targetPageSnapshots`) usando
 * la MISMA funcion que la pasada real. Asi el replay mide el fix, no una
 * reimplementacion del fix.
 */
export function upgradeFrozenContext(context: DepartmentWebEngineerContext, inventory: StagingInventory): DepartmentWebEngineerContext {
  const targetPages = new Map<number, StagingPageSnapshot>();
  const approvedRecommendations = context.approvedRecommendations.map((rec) => {
    const targets = resolveRecommendationTargetFields({
      departmentRunId: context.departmentRunId,
      rank: rec.rank,
      title: rec.title,
      rationale: rec.rationale,
      evidenceDescriptions: (rec.evidence ?? []).map((e) => e.description),
      inventory,
    });
    for (const page of targets.pages) targetPages.set(page.wordpressPageId, page);
    return {
      ...rec,
      recommendationId: targets.recommendationId,
      resolvedTargets: targets.resolvedTargets,
      targetResolutionStatus: targets.targetResolutionStatus,
      targetResolutionReason: targets.targetResolutionReason,
    };
  });
  return {
    ...context,
    approvedRecommendations,
    targetPageSnapshots: buildTargetPageSnapshots([...targetPages.values()]),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const contextPath = args.context;
  if (!contextPath) {
    console.error("Falta --context <ruta al DepartmentWebEngineerContext congelado>.");
    process.exitCode = 1;
    return;
  }
  const resolvedContextPath = path.resolve(contextPath);
  const frozen = JSON.parse(fs.readFileSync(resolvedContextPath, "utf-8")) as DepartmentWebEngineerContext;

  const output: WebEngineerOutput | undefined = args.output
    ? (JSON.parse(fs.readFileSync(path.resolve(args.output), "utf-8")) as WebEngineerOutput)
    : undefined;

  const inventory = inventoryFromBriefs(frozen.stagingInventory ?? [], "(inventario reconstruido desde briefs congelados)");
  const context = upgradeFrozenContext(frozen, inventory);

  const { drafts, rejected } = parseChangePlanDrafts(output ? (output as { changePlans?: unknown }).changePlans : undefined);
  const approvedRecommendationIds = context.approvedRecommendations.map((rec) => rec.recommendationId);
  const resolved = drafts.map((draft) => buildChangePlanFromDraft({ draft, inventory, approvedRecommendationIds }));

  const diagnostics = buildWebEngineerDiagnostics({
    departmentRunId: context.departmentRunId,
    context,
    resolved,
    rejectedDrafts: rejected,
    declaredCount: drafts.length,
    attributeEvidenceRef: attributeEvidenceRefToEmployees,
  });

  if (args.json === "true") {
    console.log(JSON.stringify(diagnostics, null, 2));
    return;
  }

  console.log(`REPLAY de ${context.departmentRunId} (contexto congelado: ${contextPath}).`);
  console.log(`Salida de web-engineer: ${args.output ?? "(ninguna -- se asume el caso historico: sin changePlans declarados)"}.`);
  console.log("AVISO: inventario reconstruido sin post_content. update_post_content saldra como missing_before y el hash calculado NO es el real.");
  console.log("");
  for (const line of renderWebEngineerDiagnosticsLines(diagnostics)) console.log(line);
  console.log("");
  console.log(`Recuento por estado: ${JSON.stringify(diagnostics.countsByStatus)}`);
}

main();
