/**
 * Lee el inventario REAL de staging y lo deja en el directorio de la
 * pasada, para que `prepare-web-engineer` pueda resolver `pageId` sin
 * adivinarlo.
 *
 * Vive aqui, y no dentro de la capa de departamento, a proposito: el
 * mismo criterio que el resto de sistemas externos de este repo -- la
 * pasada coordinada (`run-department-coordination.ts`) es
 * READ/ANALYZE/PROPOSE y no importa ningun adaptador. Solo el runner del
 * workflow cablea WordPress. Un test de invariante lo verifica.
 *
 * SOLO LECTURA. Este script no puede escribir en WordPress: importa un
 * adaptador que no tiene ninguna funcion de escritura.
 *
 * Nunca falla la pasada: si no hay configuracion o la lectura falla,
 * escribe un inventario VACIO con el motivo. Todas las propuestas
 * quedaran como implementacion manual, que es el resultado correcto.
 */
import * as dotenv from "dotenv";
dotenv.config();

import { readStagingInventory } from "../src/adapters/staging-inventory-reader";
import { resolveDepartmentRunPaths, toRepoRelative, writeDepartmentJson } from "../src/department/run-store";
import * as path from "path";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const index = args.indexOf("--departmentRunId");
  const departmentRunId = index >= 0 ? args[index + 1] : "";
  if (!departmentRunId || departmentRunId.startsWith("--")) throw new Error("Falta --departmentRunId <id>.");

  const inventory = await readStagingInventory();
  const filePath = path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "staging-inventory.json");
  writeDepartmentJson(filePath, inventory);

  console.log(
    inventory.pages.length > 0
      ? `Inventario REAL de staging: ${inventory.pages.length} pagina(s) publicadas leidas. Cero escrituras.`
      : `Inventario de staging NO disponible: ${inventory.unavailableReason}. Se escribe vacio y las propuestas quedaran manuales.`
  );
  console.log(`INVENTORY_RESULT_JSON=${JSON.stringify({ departmentRunId, pages: inventory.pages.length, unavailableReason: inventory.unavailableReason, path: toRepoRelative(filePath), stagingWrites: 0, productionWrites: 0 })}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
