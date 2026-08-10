// 3D Model Factory -- logica de las 12 etapas del pipeline (ver
// docs/agents.md para la descripcion completa de cada una). Cada funcion
// aqui es deliberadamente honesta sobre lo que SI puede hacer sola
// (deterministico: leer ficheros, resolver materiales, generar notas de
// integracion) y lo que requiere juicio humano/IA todavia no automatizado
// en esta fase (product_understanding, research, geometry_planner,
// inference, blender_generation): en vez de fingir un resultado, marca la
// etapa como pending_input/blocked y explica exactamente que falta.

import * as fs from "fs";
import * as path from "path";
import { fileExists, ensureDir, writeFileWithBackup } from "./fs-utils";
import { runIntake, IntakeResult } from "./intake";
import { resolveMaterials, MaterialResolution } from "./materials";
import { buildIntegrationNotes } from "./integration";
import { checkBlenderAvailable, BlenderAvailability } from "./blender-check";
import { ModelRequest, StageResult, PipelineStageName } from "../types";

export interface PipelineContext {
	request: ModelRequest;
	outputFolder: string;
	intake?: IntakeResult;
	blender?: BlenderAvailability;
	materialResolutions?: MaterialResolution[];
	integrationNotes?: string[];
}

/**
 * IMPORTANTE: la mera EXISTENCIA de un fichero de plantilla no significa
 * que se haya rellenado -- un stub recien creado por writeStub() sigue
 * teniendo sus campos a null/[] hasta que alguien (humano o IA con el
 * input real delante) lo edite. Confundir "existe" con "esta completo"
 * rompe la promesa central del sistema (nunca presentar algo sin
 * confirmar como si estuviera confirmado) -- encontrado y corregido
 * durante el propio QA de O24.1, antes de dar la fase por cerrada.
 * Cada stage define su propio criterio de "relleno de verdad" via
 * `isFilled`, no una comprobacion generica de existencia.
 */
function readStubIfFilled<T extends Record<string, unknown>>(outputFolder: string, filename: string, isFilled: (data: T) => boolean): T | null {
	const stubPath = path.join(outputFolder, "stages", filename);
	if (!fileExists(stubPath)) {
		return null;
	}
	try {
		const raw = fs.readFileSync(stubPath, "utf-8");
		const data = JSON.parse(raw) as T;
		return isFilled(data) ? data : null;
	} catch {
		return null;
	}
}

function writeStub(outputFolder: string, filename: string, content: string): string {
	const stubPath = path.join(outputFolder, "stages", filename);
	ensureDir(path.dirname(stubPath));
	// Solo crea el stub si TODAVIA no existe -- si ya existe (aunque no este
	// "filled in" segun isFilled, ej. alguien lo dejo a medias), no lo pisa
	// con la plantilla vacia de nuevo perdiendo el progreso parcial.
	if (!fileExists(stubPath)) {
		writeFileWithBackup(stubPath, content);
	}
	return stubPath;
}

export function runIntakeStage(ctx: PipelineContext): StageResult {
	const intake = runIntake(ctx.request.input_folder);
	ctx.intake = intake;

	if (!intake.folderExists) {
		return {
			stage: "intake",
			status: "pending_input",
			summary: `La carpeta de input "${ctx.request.input_folder}" no existe todavia. Creala y anade al menos 1 foto para poder avanzar.`,
		};
	}
	if (intake.files.length === 0) {
		return {
			stage: "intake",
			status: "pending_input",
			summary: `La carpeta de input existe pero esta vacia. Faltan: al menos 1 foto (idealmente frontal/lateral/perspectiva), medidas si se conocen, notas opcionales.`,
			details: { counts: intake.counts },
		};
	}
	return {
		stage: "intake",
		status: "done",
		summary: `${intake.files.length} ficheros encontrados (${intake.counts.photo} fotos, ${intake.counts.pdf} PDFs, ${intake.counts.notes} notas, ${intake.counts.measurements} de medidas, ${intake.counts.other} otros).`,
		details: { counts: intake.counts, files: intake.files },
	};
}

export function runProductUnderstandingStage(ctx: PipelineContext): StageResult {
	const filename = "product-understanding.json";
	const filled = readStubIfFilled<{ productType: unknown; visibleComponents: unknown[] }>(
		ctx.outputFolder,
		filename,
		(data) => Boolean(data.productType) || (Array.isArray(data.visibleComponents) && data.visibleComponents.length > 0)
	);
	if (filled) {
		return { stage: "product_understanding", status: "done", summary: `Analisis de producto completado (${filename} rellenado -- productType: "${filled.productType}").` };
	}
	if (fileExists(path.join(ctx.outputFolder, "stages", filename))) {
		return {
			stage: "product_understanding",
			status: "pending_input",
			summary: `Plantilla ${filename} existe pero todavia no esta rellenada (productType sigue a null). Completarla antes de continuar.`,
		};
	}
	if (!ctx.intake || ctx.intake.files.length === 0) {
		return {
			stage: "product_understanding",
			status: "blocked",
			summary: `No se puede analizar el producto sin ningun input (0 ficheros). Vuelve a ejecutar tras anadir al menos 1 foto.`,
		};
	}
	const stubPath = writeStub(
		ctx.outputFolder,
		filename,
		JSON.stringify(
			{
				_instructions:
					"Rellenar a mano (o con ayuda de IA con vision) a partir de las fotos/notas de " + ctx.request.input_folder + ". No inventar datos -- usar null si no se sabe.",
				productType: null,
				visibleComponents: [],
				visualNotesPerPhoto: [],
			},
			null,
			2
		)
	);
	return {
		stage: "product_understanding",
		status: "pending_input",
		summary: `Requiere analisis visual/de contenido (humano o IA con vision) que esta fase no automatiza todavia. Plantilla creada en ${stubPath} -- rellenar y volver a ejecutar.`,
	};
}

export function runResearchStage(ctx: PipelineContext, understanding: StageResult): StageResult {
	if (understanding.status !== "done") {
		return {
			stage: "research",
			status: "blocked",
			summary: `Depende de product_understanding, que todavia no esta "done".`,
		};
	}
	const filename = "research-notes.md";
	if (fileExists(path.join(ctx.outputFolder, "stages", filename))) {
		return { stage: "research", status: "done", summary: `Notas de investigacion ya presentes (${filename}).` };
	}
	return {
		stage: "research",
		status: "skipped",
		summary: `Sin research-notes.md -- se asume que no hizo falta buscar informacion externa (todos los datos necesarios ya estaban en el input). Si no es el caso, crea ese fichero documentando fuentes consultadas.`,
	};
}

export function runGeometryPlannerStage(ctx: PipelineContext, understanding: StageResult): StageResult {
	if (understanding.status !== "done") {
		return { stage: "geometry_planner", status: "blocked", summary: `Depende de product_understanding.` };
	}
	const filename = "geometry-plan.json";
	const filled = readStubIfFilled<{ components: unknown[] }>(ctx.outputFolder, filename, (data) => Array.isArray(data.components) && data.components.length > 0);
	if (filled) {
		return { stage: "geometry_planner", status: "done", summary: `Plan de piezas/componentes definido (${filled.components.length} componentes en ${filename}).` };
	}
	if (fileExists(path.join(ctx.outputFolder, "stages", filename))) {
		return {
			stage: "geometry_planner",
			status: "pending_input",
			summary: `Plantilla ${filename} existe pero todavia no tiene componentes definidos (array vacio). Completarla antes de continuar.`,
		};
	}
	const stubPath = writeStub(
		ctx.outputFolder,
		filename,
		JSON.stringify(
			{
				_instructions: "Definir componentes/piezas del modelo a partir de product-understanding.json. Marcar cuales son configurables.",
				components: [],
			},
			null,
			2
		)
	);
	return {
		stage: "geometry_planner",
		status: "pending_input",
		summary: `Plantilla de plan de piezas creada en ${stubPath} -- rellenar componentes y volver a ejecutar.`,
	};
}

export function runInferenceStage(ctx: PipelineContext, geometryPlanner: StageResult): StageResult {
	if (geometryPlanner.status !== "done") {
		return { stage: "inference", status: "blocked", summary: `Depende de geometry_planner.` };
	}
	const filename = "inference-manifest.json";
	const filled = readStubIfFilled<{ verifiedFacts: unknown[]; inferredFacts: unknown[]; assumptions: unknown[]; pendingValidation: unknown[] }>(
		ctx.outputFolder,
		filename,
		(data) =>
			(Array.isArray(data.verifiedFacts) && data.verifiedFacts.length > 0) ||
			(Array.isArray(data.inferredFacts) && data.inferredFacts.length > 0) ||
			(Array.isArray(data.assumptions) && data.assumptions.length > 0) ||
			(Array.isArray(data.pendingValidation) && data.pendingValidation.length > 0)
	);
	if (filled) {
		return { stage: "inference", status: "done", summary: `Inferencias documentadas en ${filename}.` };
	}
	if (fileExists(path.join(ctx.outputFolder, "stages", filename))) {
		return {
			stage: "inference",
			status: "pending_input",
			summary: `Plantilla ${filename} existe pero todavia no documenta nada (todas las listas vacias). Completarla antes de continuar.`,
		};
	}
	const stubPath = writeStub(
		ctx.outputFolder,
		filename,
		JSON.stringify(
			{
				_instructions: "Documentar verifiedFacts / inferredFacts / assumptions / pendingValidation. Ver docs/inference-policy.md.",
				verifiedFacts: [],
				inferredFacts: [],
				assumptions: [],
				pendingValidation: [],
			},
			null,
			2
		)
	);
	return {
		stage: "inference",
		status: "pending_input",
		summary: `Plantilla creada en ${stubPath} -- documentar verificado/inferido/supuesto/pendiente antes de generar geometria.`,
	};
}

export function runMaterialStage(ctx: PipelineContext): StageResult {
	const known = ctx.request.known_materials ?? [];
	if (known.length === 0) {
		return {
			stage: "material",
			status: "pending_input",
			summary: `El request no trae known_materials. Añade al menos uno (ej. "pino", "metal") o confirma que se decidira mas adelante.`,
		};
	}
	const resolutions = resolveMaterials(known);
	ctx.materialResolutions = resolutions;
	const unresolved = resolutions.filter((r) => r.resolved === null);
	return {
		stage: "material",
		status: "done",
		summary: `${resolutions.length - unresolved.length}/${resolutions.length} materiales resueltos contra presets conocidos.${
			unresolved.length > 0 ? ` Sin preset: ${unresolved.map((u) => u.requested).join(", ")} (se usaran valores neutros por defecto, marcados como supuestos).` : ""
		}`,
		details: { resolutions },
	};
}

export function runBlenderGenerationStage(ctx: PipelineContext, inference: StageResult): StageResult {
	const blender = checkBlenderAvailable();
	ctx.blender = blender;
	if (!blender.available) {
		return {
			stage: "blender_generation",
			status: "blocked",
			summary: `Blender no esta instalado en esta maquina. Ver docs/blender-setup.md para la propuesta de instalacion (requiere aprobacion antes de ejecutarla).`,
		};
	}
	if (inference.status !== "done") {
		return { stage: "blender_generation", status: "blocked", summary: `Blender esta disponible (${blender.version}), pero depende de inference, que todavia no esta "done".` };
	}
	return {
		stage: "blender_generation",
		status: "pending_input",
		summary: `Blender disponible (${blender.version}) y datos de inferencia listos -- generacion real del script/geometria pendiente de implementar (fuera de alcance de O24.1, ver docs/pipeline.md).`,
	};
}

export function runGlbExportStage(blenderGeneration: StageResult): StageResult {
	if (blenderGeneration.status !== "done") {
		return { stage: "glb_export", status: "blocked", summary: `Depende de blender_generation.` };
	}
	return { stage: "glb_export", status: "pending_input", summary: `Exportacion real pendiente de implementar.` };
}

export function runOptimizationStage(glbExport: StageResult): StageResult {
	if (glbExport.status !== "done") {
		return { stage: "optimization", status: "blocked", summary: `Depende de glb_export.` };
	}
	return { stage: "optimization", status: "pending_input", summary: `Optimizacion real pendiente de implementar.` };
}

export function runVisualQaStage(glbExport: StageResult): StageResult {
	if (glbExport.status !== "done") {
		return { stage: "visual_qa", status: "blocked", summary: `Necesita un .glb real para generar capturas -- depende de glb_export.` };
	}
	return { stage: "visual_qa", status: "pending_input", summary: `Generacion de previews pendiente de implementar.` };
}

export function runWebIntegrationStage(ctx: PipelineContext): StageResult {
	const notes = buildIntegrationNotes(ctx.request.integration_target ?? null, ctx.request.target_website, ctx.request.product_slug);
	ctx.integrationNotes = notes;
	return {
		stage: "web_integration",
		status: "done",
		summary: `Notas de integracion generadas para integration_target="${ctx.request.integration_target ?? "(sin especificar)"}".`,
		details: { notes },
	};
}

export function runHumanApprovalGateStage(): StageResult {
	return {
		stage: "human_approval_gate",
		status: "pending_input",
		summary: `Ningun modelo pasa a "approved_staging" sin que un humano lo confirme explicitamente. Nunca se auto-aprueba en esta fase.`,
	};
}
