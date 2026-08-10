// 3D Model Factory -- valida un request.json contra las reglas minimas de
// src/schemas/request.schema.json. Validacion manual (sin libreria nueva
// tipo ajv -- no se ha anadido ninguna dependencia nueva en O24.1) pero
// cubre los campos obligatorios y los enums declarados.
//
// Uso:
//   npx ts-node services/3d-model-factory/scripts/validate-request.ts --request <ruta/a/request.json>

import * as fs from "fs";
import { ModelRequest } from "../src/types";

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

const REQUIRED_FIELDS: Array<keyof ModelRequest> = ["client_id", "project_id", "product_slug", "product_name", "input_folder"];
const VALID_OUTPUT_FORMATS = ["glb", "gltf"];
const VALID_INTEGRATION_TARGETS = ["configurator", "product_page", "standalone_embed", "wordpress_media", null, undefined];
const VALID_TOLERANCES = ["low", "medium", "high", undefined];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateRequest(request: Partial<ModelRequest>): string[] {
	const errors: string[] = [];

	for (const field of REQUIRED_FIELDS) {
		if (!request[field]) {
			errors.push(`Falta el campo obligatorio "${field}".`);
		}
	}
	if (request.product_slug && !SLUG_PATTERN.test(request.product_slug)) {
		errors.push(`product_slug "${request.product_slug}" no es kebab-case valido (ej. "banco-vestuario-pino").`);
	}
	if (request.output_format && !VALID_OUTPUT_FORMATS.includes(request.output_format)) {
		errors.push(`output_format "${request.output_format}" invalido -- debe ser uno de: ${VALID_OUTPUT_FORMATS.join(", ")}.`);
	}
	if (!VALID_INTEGRATION_TARGETS.includes(request.integration_target as never)) {
		errors.push(`integration_target "${request.integration_target}" invalido.`);
	}
	if (!VALID_TOLERANCES.includes(request.inference_tolerance as never)) {
		errors.push(`inference_tolerance "${request.inference_tolerance}" invalido -- debe ser low/medium/high.`);
	}

	return errors;
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	if (!args.request) {
		console.error("Uso: --request <ruta/a/request.json>");
		process.exit(1);
	}
	const raw = fs.readFileSync(args.request, "utf-8");
	const request = JSON.parse(raw) as Partial<ModelRequest>;
	const errors = validateRequest(request);

	if (errors.length === 0) {
		console.log(`OK -- ${args.request} es un request valido.`);
		return;
	}
	console.error(`${errors.length} error(es) en ${args.request}:`);
	for (const err of errors) {
		console.error(`  - ${err}`);
	}
	process.exit(1);
}

if (require.main === module) {
	main();
}
