// 3D Model Factory -- Agente 1 (3D Intake Agent). Localiza los ficheros de
// un producto en su carpeta de input y construye un inventario tipado.
// 100% deterministico -- no interpreta el CONTENIDO de las fotos/PDFs
// (eso es el Agente 2, Product Understanding, que requiere juicio/vision y
// se documenta como etapa pendiente cuando no hay quien la ejecute todavia).

import * as fs from "fs";
import { listFiles, DirEntryInfo } from "./fs-utils";
import { SourceFileEntry, SourceFileType } from "../types";

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"]);
const MEASUREMENT_NAME_HINTS = ["medida", "measurement", "dimension", "size"];

function classifyFile(entry: DirEntryInfo): SourceFileType {
	if (PHOTO_EXTENSIONS.has(entry.extension)) {
		return "photo";
	}
	if (entry.extension === ".pdf") {
		return "pdf";
	}
	const lowerName = entry.name.toLowerCase();
	if (MEASUREMENT_NAME_HINTS.some((hint) => lowerName.includes(hint))) {
		return "measurements";
	}
	if (entry.extension === ".md" || entry.extension === ".txt") {
		return "notes";
	}
	return "other";
}

export interface IntakeResult {
	inputFolder: string;
	folderExists: boolean;
	files: SourceFileEntry[];
	counts: Record<SourceFileType, number>;
	hasAtLeastOnePhoto: boolean;
}

export function runIntake(inputFolder: string): IntakeResult {
	const entries = listFiles(inputFolder);
	const files: SourceFileEntry[] = entries.map((entry) => ({
		file: entry.name,
		type: classifyFile(entry),
		sizeBytes: entry.sizeBytes,
	}));

	const counts: Record<SourceFileType, number> = { photo: 0, pdf: 0, notes: 0, measurements: 0, other: 0 };
	for (const f of files) {
		counts[f.type]++;
	}

	return {
		inputFolder,
		folderExists: entries.length > 0 || fs.existsSync(inputFolder),
		files,
		counts,
		hasAtLeastOnePhoto: counts.photo > 0,
	};
}
