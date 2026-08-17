/**
 * Fase O57 — proyecta el estado autoritativo de MongoDB a `data/*.jsonl`.
 *
 *   npm run state:hydrate-mongodb
 *   npm run state:hydrate-mongodb -- --data-dir /ruta/al/data
 *
 * Se ejecuta AL PRINCIPIO de la pasada, en lugar de restaurar la rama
 * `department-state`. A partir de ese momento todo lo que lee el
 * departamento sale de MongoDB.
 *
 * FALLA CERRADO. Requiere modo `mongo` y credenciales. Si MongoDB no
 * responde, este script termina con codigo 1 y la pasada NO arranca. No
 * hay camino alternativo que rellene `data/` con otra cosa: correr sobre
 * un estado de procedencia desconocida es peor que no correr.
 */
import * as path from "path";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { sanitizeMongoText } from "../src/persistence/mongo-config";
import { hydrateStateFromMongo, renderHydrationReport } from "../src/persistence/hydration";
import { openPersistenceSession, resolvePersistenceMode } from "../src/persistence/runtime";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const mode = resolvePersistenceMode();
  if (mode !== "mongo") {
    // No se hidrata en shadow ni en legacy: en esos modos la fuente
    // sigue siendo el fichero, y sobrescribirlo desde MongoDB seria
    // exactamente la doble autoridad que hay que evitar.
    throw new Error(
      `La hidratacion solo tiene sentido cuando MongoDB es la fuente de verdad. ` +
        `Modo actual: "${mode}". No se ha tocado ningun fichero.`
    );
  }

  const dataDir =
    args["data-dir"] && args["data-dir"] !== "true"
      ? path.resolve(args["data-dir"])
      : resolveActiveClientPaths().dataDir;

  const session = await openPersistenceSession({ mode: "mongo" });
  if (!session.repository) {
    throw new Error("MongoDB es la fuente de verdad y no hay repositorio. No se hidrata nada.");
  }

  console.log(`[hydrate] origen: ${session.target}`);
  console.log(`[hydrate] destino: carpeta ${path.basename(dataDir)}/`);
  console.log("");

  try {
    const report = await hydrateStateFromMongo(session.repository, dataDir, new Date().toISOString());
    console.log(renderHydrationReport(report));
    console.log("");
    console.log(
      `HYDRATION_JSON=${JSON.stringify({
        filesWritten: report.totals.filesWritten,
        documentsProjected: report.totals.documentsProjected,
        humanDecisions: report.humanDecisions,
      })}`
    );
  } finally {
    await session.repository.close();
  }
}

main().catch((err) => {
  console.error(sanitizeMongoText(err));
  process.exit(1);
});
