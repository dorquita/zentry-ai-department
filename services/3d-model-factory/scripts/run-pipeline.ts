// 3D Model Factory -- orquestador del pipeline de 12 etapas (Fase O24.1).
// En esta fase NUNCA genera un .glb real (Blender no esta instalado, ver
// docs/blender-setup.md) -- su trabajo es recorrer las 12 etapas con
// honestidad: ejecutar las deterministicas de verdad (intake, material,
// web_integration) y dejar constancia clara y accionable de las que
// requieren juicio humano/IA o Blender, sin fingir un resultado.
//
// Uso:
//   npx ts-node --project services/3d-model-factory/tsconfig.json services/3d-model-factory/scripts/run-pipeline.ts --request <ruta/a/request.json>
//
// Siempre se comporta como dry-run en O24.1 (no hay ninguna escritura real
// a WordPress/staging/produccion posible desde este script -- ni falta que
// hace, es 100% filesystem local/VPS).

import * as fs from "fs";
import * as path from "path";
import { ModelRequest, ModelManifest, StageResult, PipelineStageName } from "../src/types";
import { validateRequest } from "./validate-request";
import { ensureDir, writeJsonWithBackup, writeFileWithBackup } from "../src/lib/fs-utils";
import {
	PipelineContext,
	runIntakeStage,
	runProductUnderstandingStage,
	runResearchStage,
	runGeometryPlannerStage,
	runInferenceStage,
	runMaterialStage,
	runBlenderGenerationStage,
	runGlbExportStage,
	runOptimizationStage,
	runVisualQaStage,
	runWebIntegrationStage,
	runHumanApprovalGateStage,
} from "../src/lib/pipeline-stages";

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

function repoRootRelative(p: string): string {
	// Los scripts de este repo se ejecutan siempre desde la raiz del repo
	// (mismo patron que el resto de scripts/*.ts) -- las rutas del request
	// (input_folder, etc.) son relativas a esa raiz, nunca a este fichero.
	return path.resolve(process.cwd(), p);
}

function deriveQaStatus(stages: StageResult[]): ModelManifest["qaStatus"] {
	const byStage = Object.fromEntries(stages.map((s) => [s.stage, s])) as Record<PipelineStageName, StageResult>;
	if (byStage.human_approval_gate?.status === "done") return "approved_staging";
	if (byStage.visual_qa?.status === "done") return "pending_human_approval";
	if (byStage.glb_export?.status === "done") return "pending_visual_qa";
	if (byStage.intake?.status === "done") return "pending_generation";
	return "not_started";
}

function deriveConfidence(stages: StageResult[]): ModelManifest["confidence"] {
	const doneCount = stages.filter((s) => s.status === "done").length;
	if (doneCount >= 9) return "high";
	if (doneCount >= 5) return "medium";
	return "low";
}

function collectNextActions(stages: StageResult[]): string[] {
	return stages.filter((s) => s.status === "pending_input" || s.status === "blocked").map((s) => `[${s.stage}] ${s.summary}`);
}

function buildDryRunReportMarkdown(request: ModelRequest, stages: StageResult[], manifestPreview: ModelManifest): string {
	const lines: string[] = [];
	lines.push(`# Informe de pipeline -- ${request.product_name} (${request.product_slug})`);
	lines.push("");
	lines.push(`Cliente: \`${request.client_id}\` · Proyecto: \`${request.project_id}\` · Generado: ${new Date().toISOString()}`);
	lines.push("");
	lines.push(`**qaStatus actual:** ${manifestPreview.qaStatus} · **confidence:** ${manifestPreview.confidence}`);
	lines.push("");
	lines.push(`## Etapas`);
	lines.push("");
	lines.push(`| # | Etapa | Estado | Resumen |`);
	lines.push(`|---|---|---|---|`);
	stages.forEach((s, i) => {
		lines.push(`| ${i + 1} | ${s.stage} | ${s.status} | ${s.summary.replace(/\|/g, "\\|")} |`);
	});
	lines.push("");
	lines.push(`## Siguientes acciones`);
	lines.push("");
	if (manifestPreview.nextActions && manifestPreview.nextActions.length > 0) {
		for (const action of manifestPreview.nextActions) {
			lines.push(`- ${action}`);
		}
	} else {
		lines.push(`Ninguna -- todas las etapas completadas.`);
	}
	lines.push("");
	return lines.join("\n");
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	if (!args.request) {
		console.error("Uso: --request <ruta/a/request.json> [--dry-run]");
		process.exit(1);
	}

	const requestPath = repoRootRelative(args.request);
	const raw = fs.readFileSync(requestPath, "utf-8");
	const request = JSON.parse(raw) as ModelRequest;

	const errors = validateRequest(request);
	if (errors.length > 0) {
		console.error(`Request invalido (${requestPath}):`);
		errors.forEach((e) => console.error(`  - ${e}`));
		process.exit(1);
	}

	const outputFolder = repoRootRelative(`clients/${request.client_id}/outputs/3d-models/${request.product_slug}`);
	ensureDir(outputFolder);

	const ctx: PipelineContext = { request: { ...request, input_folder: repoRootRelative(request.input_folder) }, outputFolder };

	console.log(`=== 3D Model Factory -- pipeline (dry-run) ===`);
	console.log(`Producto: ${request.product_name} (${request.client_id}/${request.product_slug})`);
	console.log(`Input: ${ctx.request.input_folder}`);
	console.log(`Output: ${outputFolder}`);
	console.log("");

	const stages: StageResult[] = [];
	const intake = runIntakeStage(ctx);
	stages.push(intake);
	const understanding = runProductUnderstandingStage(ctx);
	stages.push(understanding);
	stages.push(runResearchStage(ctx, understanding));
	const geometryPlanner = runGeometryPlannerStage(ctx, understanding);
	stages.push(geometryPlanner);
	const inference = runInferenceStage(ctx, geometryPlanner);
	stages.push(inference);
	stages.push(runMaterialStage(ctx));
	const blenderGeneration = runBlenderGenerationStage(ctx, inference);
	stages.push(blenderGeneration);
	const glbExport = runGlbExportStage(blenderGeneration);
	stages.push(glbExport);
	stages.push(runOptimizationStage(glbExport));
	stages.push(runVisualQaStage(glbExport));
	stages.push(runWebIntegrationStage(ctx));
	stages.push(runHumanApprovalGateStage());

	for (const s of stages) {
		const marker = s.status === "done" ? "OK" : s.status === "blocked" ? "BLOCKED" : s.status === "skipped" ? "SKIP" : "PENDING";
		console.log(`  [${marker}] ${s.stage}: ${s.summary}`);
	}

	const manifest: ModelManifest = {
		productName: request.product_name,
		slug: request.product_slug,
		clientId: request.client_id,
		projectId: request.project_id,
		generatedAt: new Date().toISOString(),
		requestPath: path.relative(process.cwd(), requestPath),
		sourceFiles: ctx.intake?.files ?? [],
		verifiedFacts: [],
		inferredFacts: [],
		assumptions: [],
		pendingValidation: collectNextActions(stages),
		dimensions: {
			length_mm: request.known_dimensions?.length_mm ?? null,
			width_mm: request.known_dimensions?.width_mm ?? null,
			height_mm: request.known_dimensions?.height_mm ?? null,
			depth_mm: request.known_dimensions?.depth_mm ?? null,
			source: "pending",
		},
		materials: (ctx.materialResolutions ?? []).map((r) => ({
			name: r.requested,
			appliesToComponents: [],
			configurable: true,
			source: r.resolved ? "assumed" : "pending",
		})),
		components: [],
		variants: request.variants ?? [],
		modelingStrategy: ctx.blender?.available ? "blender_parametric" : "not_yet_determined",
		outputFiles: { glb: null, sourceScript: null, report: `clients/${request.client_id}/outputs/3d-models/${request.product_slug}/${request.product_slug}-report.md`, previews: [] },
		fileSize: null,
		polygonCount: null,
		confidence: deriveConfidence(stages),
		qaStatus: deriveQaStatus(stages),
		nextActions: collectNextActions(stages),
	};

	const manifestPath = path.join(outputFolder, "manifest.json");
	const manifestResult = writeJsonWithBackup(manifestPath, manifest);

	const reportPath = path.join(outputFolder, `${request.product_slug}-report.md`);
	const reportMarkdown = buildDryRunReportMarkdown(request, stages, manifest);
	const reportResult = writeFileWithBackup(reportPath, reportMarkdown);

	console.log("");
	console.log(`Manifest: ${manifestPath}${manifestResult.backedUp ? ` (backup previo: ${manifestResult.backupPath})` : ""}`);
	console.log(`Informe:  ${reportPath}${reportResult.backedUp ? ` (backup previo: ${reportResult.backupPath})` : ""}`);
	console.log(`qaStatus: ${manifest.qaStatus} · confidence: ${manifest.confidence}`);
}

if (require.main === module) {
	main();
}
