// 3D Model Factory -- Agente 7 (Material Agent). Libreria de presets de
// materiales habituales en mobiliario/taquillas/cerraduras -- valores
// razonables de partida (color base + roughness/metalness estilo
// PBR, compatibles con Three.js MeshStandardMaterial y con el shader
// "Principled BSDF" de Blender) para que un producto nuevo tenga un punto
// de partida documentado en vez de un material generico sin criterio.
//
// Estos valores son SIEMPRE "assumed" salvo que el cliente aporte una
// muestra real de color/acabado -- documentar asi en el manifest, nunca
// como "verified".

export interface MaterialPreset {
	id: string;
	label: string;
	category: "madera" | "metal" | "plastico" | "textil" | "otro";
	baseColorHex: string;
	roughness: number;
	metalness: number;
	aliases: string[];
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
	{ id: "pino", label: "Pino", category: "madera", baseColorHex: "#c9a06a", roughness: 0.75, metalness: 0, aliases: ["pine"] },
	{ id: "fenolico", label: "Fenólico", category: "madera", baseColorHex: "#3d3d3d", roughness: 0.55, metalness: 0, aliases: ["phenolic", "fenólico"] },
	{ id: "melamina", label: "Melamina", category: "madera", baseColorHex: "#e8e2d5", roughness: 0.4, metalness: 0, aliases: ["melamine"] },
	{ id: "roble", label: "Roble", category: "madera", baseColorHex: "#b6884f", roughness: 0.7, metalness: 0, aliases: ["oak"] },
	{ id: "metal", label: "Metal pintado", category: "metal", baseColorHex: "#6b7178", roughness: 0.35, metalness: 0.75, aliases: ["metal-pintado", "steel", "acero"] },
	{ id: "acero-inoxidable", label: "Acero inoxidable", category: "metal", baseColorHex: "#c8cdd0", roughness: 0.25, metalness: 0.9, aliases: ["stainless", "inox"] },
	{ id: "plastico", label: "Plástico técnico", category: "plastico", baseColorHex: "#2b2b2b", roughness: 0.5, metalness: 0, aliases: ["plastic", "abs", "resina"] },
];

export interface MaterialResolution {
	requested: string;
	resolved: MaterialPreset | null;
}

/** Coincidencia case-insensitive por id o alias. No inventa un preset para un material desconocido -- lo deja `resolved: null` para que el pipeline lo marque como pendiente. */
export function resolveMaterial(name: string): MaterialResolution {
	const normalized = name.trim().toLowerCase();
	const match = MATERIAL_PRESETS.find((preset) => preset.id === normalized || preset.aliases.includes(normalized));
	return { requested: name, resolved: match ?? null };
}

export function resolveMaterials(names: string[]): MaterialResolution[] {
	return names.map(resolveMaterial);
}
