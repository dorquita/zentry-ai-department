// scripts/o24-write-final-manifest-banco-vestuario-pino.ts -- Fase O24.2.
// Escribe a mano el manifest.json/informe FINAL para banco-vestuario-pino
// una vez generado el .glb real -- las etapas 6-10 (generacion/export/
// optimizacion/QA visual) todavia no estan implementadas dentro de
// run-pipeline.ts (eso sigue siendo O24.1), asi que este script one-off
// documenta el resultado real de la ejecucion manual de Blender de esta
// fase, reutilizando el mismo helper de escritura-con-backup que usa el
// pipeline para no romper la garantia de "nunca sobrescribir sin backup".
import * as path from "path";
import { writeJsonWithBackup, writeFileWithBackup } from "../services/3d-model-factory/src/lib/fs-utils";
import { ModelManifest } from "../services/3d-model-factory/src/types";

const outputFolder = path.resolve(__dirname, "../clients/zentry/outputs/3d-models/banco-vestuario-pino");

const manifest: ModelManifest = {
	productName: "Banco de vestuario de pino simple",
	slug: "banco-vestuario-pino",
	clientId: "zentry",
	projectId: "zentry-lockers",
	generatedAt: new Date().toISOString(),
	requestPath: "clients/zentry/input/o24-products/banco-vestuario-pino/request.json",

	sourceFiles: [
		{ file: "NEEDED-INPUTS.md", type: "notes" },
		{ file: "producto-woocommerce-staging.md", type: "notes" },
		{ file: "referencia-visual-o21-NO-VERIFICADA.webp", type: "photo" },
		{ file: "request.json", type: "other" },
	],

	verifiedFacts: [
		{ fact: "Material del asiento: madera de pino de Suecia, cepillada.", source: "producto-woocommerce-staging.md (WooCommerce staging, producto id 1988)" },
		{ fact: "Grosor de cada listón del asiento: 25mm.", source: "producto-woocommerce-staging.md" },
		{ fact: "Patas de tubo de acero de sección CUADRADA 30x30x1.5mm, soldadas, pintura epoxi 60 micras.", source: "producto-woocommerce-staging.md" },
		{ fact: "El modelo simple lleva un refuerzo/listón metálico de unión entre patas (no lleva zapatero).", source: "producto-woocommerce-staging.md" },
		{ fact: "Longitudes reales disponibles: 1000mm, 1500mm, 2000mm.", source: "producto-woocommerce-staging.md + atributo WooCommerce 'Longitud'" },
		{ fact: "Tacos antideslizantes y herrajes de acero inoxidable (NO modelados como geometría separada en este MVP).", source: "producto-woocommerce-staging.md" },
	],
	inferredFacts: [
		{
			fact: "Altura del asiento sobre el suelo: 450mm (usada en el modelo).",
			reasoning: "No confirmado en ninguna fuente real. Mismo valor que el prototipo JS de O23 (SEAT_HEIGHT), dentro del rango ergonómico estándar de bancos de vestuario.",
			confidenceRange: "420-460mm",
		},
		{
			fact: "Profundidad del asiento: 300mm (usada en el modelo).",
			reasoning: "No confirmado en ninguna fuente real. Mismo valor que el prototipo JS de O23 (SEAT_DEPTH), compatible visualmente con la imagen de referencia no verificada.",
			confidenceRange: "280-320mm",
		},
		{
			fact: "El asiento tiene 4 listones de madera (usado en el modelo).",
			reasoning: "Contado visualmente en referencia-visual-o21-NO-VERIFICADA.webp (imagen IA de marketing de O21, no una foto real).",
			confidenceRange: "3-5 listones",
		},
	],
	assumptions: [
		{ assumption: "Las patas se modelan con sección CUADRADA (30x30mm, fuente verificada) -- la imagen de referencia no verificada muestra patas de sección redonda, discrepancia no resuelta.", risk: "low" },
		{ assumption: "El refuerzo metálico se modela como una barra horizontal a 80mm de altura, corriendo a lo largo de la longitud entre las dos patas -- ninguna foto confirma su posición/forma real.", risk: "medium" },
		{ assumption: "Las patas están insertadas 80mm hacia dentro desde cada extremo del asiento.", risk: "low" },
		{ assumption: "Gap de 6mm entre listones del asiento (no medido, valor de diseño razonable).", risk: "low" },
		{ assumption: "Tono de madera/color de pintura metálica aproximados (presets de src/lib/materials.ts), no calibrados contra una muestra real.", risk: "low" },
	],
	pendingValidation: [
		"Confirmar con una foto real si las patas son de sección cuadrada (texto oficial) o redonda (imagen IA de marketing) -- discrepancia real detectada, no resuelta.",
		"Confirmar altura y profundidad reales del banco.",
		"Confirmar posición/forma exacta del refuerzo metálico entre patas.",
		"Confirmar número real de listones del asiento.",
		"Aprobación humana explícita (Agente 12) -- todavía no concedida.",
	],

	dimensions: { length_mm: 1500, width_mm: 300, height_mm: 450, depth_mm: 300, source: "inferred" },
	materials: [
		{ name: "pino", appliesToComponents: ["asiento_liston_1", "asiento_liston_2", "asiento_liston_3", "asiento_liston_4"], configurable: true, source: "verified" },
		{ name: "acero (preset 'metal' -- metal pintado)", appliesToComponents: ["pata_izquierda", "pata_derecha", "refuerzo_metalico"], configurable: true, source: "verified" },
	],
	components: [
		{ name: "asiento", configurable: true, visibleByDefault: true, notes: "Empty padre -- escalar en X escala la longitud completa del conjunto de listones." },
		{ name: "asiento_liston_1", configurable: false, visibleByDefault: true },
		{ name: "asiento_liston_2", configurable: false, visibleByDefault: true },
		{ name: "asiento_liston_3", configurable: false, visibleByDefault: true },
		{ name: "asiento_liston_4", configurable: false, visibleByDefault: true },
		{ name: "pata_izquierda", configurable: false, visibleByDefault: true },
		{ name: "pata_derecha", configurable: false, visibleByDefault: true },
		{ name: "refuerzo_metalico", configurable: false, visibleByDefault: true, notes: "Pieza verificada por texto, posición geométrica inferida -- ver assumptions." },
	],
	variants: [
		{ type: "material", options: ["pino", "fenolico", "melamina"] },
		{ type: "longitud", options: ["1000", "1500", "2000"] },
		{ type: "configuracion", options: ["simple", "perchero", "zapatero"] },
	],

	modelingStrategy: "blender_parametric",

	outputFiles: {
		glb: "clients/zentry/outputs/3d-models/banco-vestuario-pino/banco-vestuario-pino.glb",
		sourceScript: "clients/zentry/outputs/3d-models/banco-vestuario-pino/source/blender-generate.py",
		report: "clients/zentry/outputs/3d-models/banco-vestuario-pino/banco-vestuario-pino-report.md",
		previews: [
			"clients/zentry/outputs/3d-models/banco-vestuario-pino/previews/front.png",
			"clients/zentry/outputs/3d-models/banco-vestuario-pino/previews/side.png",
			"clients/zentry/outputs/3d-models/banco-vestuario-pino/previews/perspective.png",
		],
	},
	fileSize: 11380,
	polygonCount: 84,

	confidence: "medium",
	qaStatus: "pending_human_approval",
	nextActions: [
		"Revisar visualmente previews/*.png contra la imagen de referencia y confirmar que el resultado es aceptable.",
		"Decidir cómo resolver la discrepancia sección cuadrada vs redonda de las patas (idealmente con una foto real).",
		"Confirmar altura/profundidad reales si el cliente puede medir un banco físico.",
		"Aprobación humana explícita antes de considerar este modelo listo para cualquier uso posterior (conexión con O23, subida a WordPress) -- ninguna de las dos cosas se ha hecho todavía.",
	],
};

const manifestResult = writeJsonWithBackup(path.join(outputFolder, "manifest.json"), manifest);
console.log("manifest.json escrito.", manifestResult.backedUp ? `Backup previo: ${manifestResult.backupPath}` : "(no había versión previa)");

const reportLines: string[] = [];
reportLines.push(`# Informe — ${manifest.productName} (${manifest.slug})`);
reportLines.push("");
reportLines.push(`Cliente: \`${manifest.clientId}\` · Proyecto: \`${manifest.projectId}\` · Generado: ${manifest.generatedAt}`);
reportLines.push("");
reportLines.push(`**qaStatus:** ${manifest.qaStatus} · **confidence:** ${manifest.confidence} · **modelingStrategy:** ${manifest.modelingStrategy}`);
reportLines.push("");
reportLines.push(`## Verificado`);
reportLines.push("");
for (const f of manifest.verifiedFacts ?? []) reportLines.push(`- ${f.fact} _(fuente: ${f.source})_`);
reportLines.push("");
reportLines.push(`## Inferido`);
reportLines.push("");
for (const f of manifest.inferredFacts ?? []) reportLines.push(`- ${f.fact} _(${f.reasoning}${f.confidenceRange ? `, rango: ${f.confidenceRange}` : ""})_`);
reportLines.push("");
reportLines.push(`## Supuestos`);
reportLines.push("");
for (const a of manifest.assumptions ?? []) reportLines.push(`- ${a.assumption} _(riesgo: ${a.risk})_`);
reportLines.push("");
reportLines.push(`## Pendiente de validar`);
reportLines.push("");
for (const p of manifest.pendingValidation ?? []) reportLines.push(`- ${p}`);
reportLines.push("");
reportLines.push(`## Componentes del modelo`);
reportLines.push("");
for (const c of manifest.components ?? []) reportLines.push(`- \`${c.name}\`${c.notes ? ` — ${c.notes}` : ""}`);
reportLines.push("");
reportLines.push(`## Archivos de salida`);
reportLines.push("");
reportLines.push(`- GLB: \`${manifest.outputFiles?.glb}\` (${manifest.fileSize} bytes, ${manifest.polygonCount} caras)`);
reportLines.push(`- Script fuente: \`${manifest.outputFiles?.sourceScript}\``);
for (const p of manifest.outputFiles?.previews ?? []) reportLines.push(`- Preview: \`${p}\``);
reportLines.push("");
reportLines.push(`## Siguientes acciones`);
reportLines.push("");
for (const n of manifest.nextActions ?? []) reportLines.push(`- ${n}`);
reportLines.push("");

const reportResult = writeFileWithBackup(path.join(outputFolder, "banco-vestuario-pino-report.md"), reportLines.join("\n"));
console.log("report.md escrito.", reportResult.backedUp ? `Backup previo: ${reportResult.backupPath}` : "(no había versión previa)");
