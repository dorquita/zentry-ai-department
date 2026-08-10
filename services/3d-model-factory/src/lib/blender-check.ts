// 3D Model Factory -- comprobacion de si Blender esta disponible en esta
// maquina. Fase O24.1 NUNCA instala Blender por su cuenta (ver
// docs/blender-setup.md) -- esta funcion solo detecta si ya esta, para que
// el pipeline pueda marcar honestamente las etapas de generacion como
// "blocked" en vez de fingir que puede ejecutarlas.

import { execFileSync } from "child_process";

export interface BlenderAvailability {
	available: boolean;
	version?: string;
	binaryChecked: string;
}

export function checkBlenderAvailable(binary = "blender"): BlenderAvailability {
	try {
		const output = execFileSync(binary, ["--version"], { encoding: "utf-8", timeout: 5000 });
		const firstLine = output.split("\n")[0]?.trim();
		return { available: true, version: firstLine, binaryChecked: binary };
	} catch {
		return { available: false, binaryChecked: binary };
	}
}
