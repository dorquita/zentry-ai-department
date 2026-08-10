// 3D Model Factory -- utilidades de filesystem propias, sin dependencias del
// resto del proyecto. Regla dura del encargo: "no sobrescribir outputs sin
// backup" y "no borrar archivos existentes" -- se aplican aqui una sola vez,
// en un unico sitio, para que ningun script del pipeline pueda saltarselas
// por error.

import * as fs from "fs";
import * as path from "path";

export function ensureDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

export function fileExists(filePath: string): boolean {
	return fs.existsSync(filePath);
}

/**
 * Escribe un fichero. Si YA existe, primero copia el contenido actual a
 * <fichero>.backup-<timestamp> en el mismo directorio -- nunca sobrescribe
 * sin dejar rastro de lo que habia antes. Nunca borra el original antes de
 * confirmar que el backup se escribio bien.
 */
export function writeFileWithBackup(filePath: string, content: string): { backedUp: boolean; backupPath?: string } {
	ensureDir(path.dirname(filePath));
	let backedUp = false;
	let backupPath: string | undefined;

	if (fileExists(filePath)) {
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		backupPath = `${filePath}.backup-${ts}`;
		fs.copyFileSync(filePath, backupPath);
		backedUp = true;
	}

	fs.writeFileSync(filePath, content, "utf-8");
	return { backedUp, backupPath };
}

export function readJson<T>(filePath: string): T {
	const raw = fs.readFileSync(filePath, "utf-8");
	return JSON.parse(raw) as T;
}

export function writeJsonWithBackup(filePath: string, data: unknown): { backedUp: boolean; backupPath?: string } {
	return writeFileWithBackup(filePath, JSON.stringify(data, null, 2) + "\n");
}

export interface DirEntryInfo {
	name: string;
	fullPath: string;
	sizeBytes: number;
	extension: string;
}

/** Lista solo ficheros (no subdirectorios) de un directorio, o [] si no existe -- nunca lanza si la carpeta de input todavia no se ha creado. */
export function listFiles(dirPath: string): DirEntryInfo[] {
	if (!fileExists(dirPath)) {
		return [];
	}
	return fs
		.readdirSync(dirPath, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => {
			const fullPath = path.join(dirPath, entry.name);
			const stat = fs.statSync(fullPath);
			return {
				name: entry.name,
				fullPath,
				sizeBytes: stat.size,
				extension: path.extname(entry.name).toLowerCase(),
			};
		});
}
