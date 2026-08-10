// 3D Model Factory -- tipos TypeScript que reflejan src/schemas/*.schema.json.
// Modulo independiente (Fase O24.1): no importa nada de ../../src del resto
// del proyecto WordPress-especifico a proposito -- esta factory debe poder
// copiarse a otro repo/departamento sin arrastrar dependencias de Zentry.

export type InferenceTolerance = "low" | "medium" | "high";
export type IntegrationTarget = "configurator" | "product_page" | "standalone_embed" | "wordpress_media" | null;
export type OutputFormat = "glb" | "gltf";

export interface KnownDimensions {
	length_mm: number | null;
	width_mm: number | null;
	height_mm: number | null;
	depth_mm: number | null;
}

export interface RequestVariant {
	type: string;
	options: string[];
}

/** Corresponde a src/schemas/request.schema.json */
export interface ModelRequest {
	client_id: string;
	project_id: string;
	product_slug: string;
	product_name: string;
	target_website?: string | null;
	integration_target?: IntegrationTarget;
	output_format?: OutputFormat;
	input_folder: string;
	known_dimensions?: Partial<KnownDimensions>;
	known_materials?: string[];
	variants?: RequestVariant[];
	notes?: string;
	inference_tolerance?: InferenceTolerance;
}

export type SourceFileType = "photo" | "pdf" | "notes" | "measurements" | "other";

export interface SourceFileEntry {
	file: string;
	type: SourceFileType;
	sizeBytes?: number;
}

export type FactSource = "verified" | "inferred" | "assumed" | "pending";
export type RiskLevel = "low" | "medium" | "high";

export interface VerifiedFact {
	fact: string;
	source: string;
}

export interface InferredFact {
	fact: string;
	reasoning: string;
	confidenceRange?: string;
}

export interface Assumption {
	assumption: string;
	risk: RiskLevel;
}

export interface ManifestDimensions extends KnownDimensions {
	source: FactSource;
}

export interface ManifestMaterial {
	name: string;
	appliesToComponents: string[];
	configurable: boolean;
	source: FactSource;
}

export interface ManifestComponent {
	name: string;
	configurable?: boolean;
	visibleByDefault?: boolean;
	notes?: string;
}

export type ModelingStrategy = "blender_parametric" | "image_to_3d_external" | "hybrid" | "manual_designer" | "not_yet_determined";

export interface OutputFiles {
	glb: string | null;
	sourceScript: string | null;
	report: string | null;
	previews: string[];
}

export type QaStatus =
	| "not_started"
	| "pending_generation"
	| "pending_visual_qa"
	| "pending_human_approval"
	| "approved_staging"
	| "rejected";

/** Corresponde a src/schemas/manifest.schema.json */
export interface ModelManifest {
	productName: string;
	slug: string;
	clientId: string;
	projectId?: string;
	generatedAt?: string;
	requestPath?: string;

	sourceFiles?: SourceFileEntry[];

	verifiedFacts?: VerifiedFact[];
	inferredFacts?: InferredFact[];
	assumptions?: Assumption[];
	pendingValidation?: string[];

	dimensions?: ManifestDimensions;
	materials?: ManifestMaterial[];
	components?: ManifestComponent[];
	variants?: RequestVariant[];

	modelingStrategy: ModelingStrategy;

	outputFiles?: OutputFiles;
	fileSize?: number | null;
	polygonCount?: number | null;

	confidence: "low" | "medium" | "high";
	qaStatus: QaStatus;
	nextActions?: string[];
}

/** Los 12 agentes/etapas del pipeline, en orden de ejecucion. Ver docs/agents.md. */
export const PIPELINE_STAGES = [
	"intake",
	"product_understanding",
	"research",
	"geometry_planner",
	"inference",
	"blender_generation",
	"material",
	"glb_export",
	"optimization",
	"visual_qa",
	"web_integration",
	"human_approval_gate",
] as const;

export type PipelineStageName = (typeof PIPELINE_STAGES)[number];

export type StageStatus = "done" | "skipped" | "pending_input" | "blocked" | "not_applicable";

export interface StageResult {
	stage: PipelineStageName;
	status: StageStatus;
	summary: string;
	details?: Record<string, unknown>;
}
