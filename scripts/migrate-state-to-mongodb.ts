/**
 * Fase O56 — herramienta de migracion del historico a MongoDB.
 *
 *   npm run state:migrate-mongodb -- --dry-run
 *   npm run state:migrate-mongodb -- --apply
 *   npm run state:migrate-mongodb -- --apply --data-dir /ruta/al/checkout/data
 *
 * GARANTIAS (ver `src/persistence/migration.ts` para el detalle):
 *   - idempotente: ejecutarla dos veces deja el mismo estado;
 *   - `--dry-run` no escribe absolutamente nada;
 *   - no borra nada en MongoDB (no hay drop ni delete en el codigo);
 *   - no modifica los `.jsonl` originales (se abren en solo lectura);
 *   - aborta si encuentra una colision semantica ambigua;
 *   - el informe es saneado: ni URI, ni credenciales, ni rutas absolutas.
 *
 * `--data-dir` importa mas de lo que parece: el estado VIVO no esta en el
 * `data/` de `main`, sino en el de la rama `department-state`, que va por
 * delante. Para migrar el historico bueno hay que apuntar ahi.
 */
import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { isMongoConfigured, sanitizeMongoText } from "../src/persistence/mongo-config";
import {
  MigrationMode,
  migrateStateToMongo,
  renderMigrationReport,
  renderRepairReport,
  repairEventTimestamps,
} from "../src/persistence/migration";
import { openPersistenceSession } from "../src/persistence/runtime";
import { DepartmentStateRepository } from "../src/persistence/repositories";
import { InMemoryStateDatabase } from "../src/persistence/in-memory-collection";

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

/** Id determinista por dia y modo: relanzar la migracion no crea bitacoras infinitas. */
function buildMigrationRunId(mode: MigrationMode, now: Date): string {
  return `migrate-${mode}-${now.toISOString().slice(0, 19).replace(/[:]/g, "")}Z`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const dryRun = args["dry-run"] === "true";
  const apply = args.apply === "true";
  if (dryRun === apply) {
    throw new Error(
      "Elige exactamente uno: --dry-run (no escribe nada) o --apply (escribe en MongoDB)."
    );
  }
  const mode: MigrationMode = apply ? "apply" : "dry-run";

  const dataDir =
    args["data-dir"] && args["data-dir"] !== "true"
      ? path.resolve(args["data-dir"])
      : resolveActiveClientPaths().dataDir;

  if (!fs.existsSync(dataDir)) {
    throw new Error(`La carpeta de datos no existe: ${path.basename(dataDir)}/`);
  }

  // `--apply` habla con MongoDB de verdad y falla cerrado si no puede.
  //
  // `--dry-run` NO escribe nada por definicion, asi que no exige
  // credenciales: se puede ensayar la migracion, ver los recuentos y
  // descubrir las colisiones en local, antes de tener ningun cluster.
  // Cuando SI hay credenciales, el dry-run las usa, porque asi el
  // recuento refleja lo que ya esta migrado.
  let repository: DepartmentStateRepository;
  let target: string;
  if (mode === "apply" || isMongoConfigured()) {
    const session = await openPersistenceSession({ mode: "mongo" });
    if (!session.repository) {
      throw new Error("No hay repositorio de MongoDB disponible. No se migra nada.");
    }
    repository = session.repository;
    target = session.target;
  } else {
    repository = new DepartmentStateRepository(new InMemoryStateDatabase());
    target = "ninguno (dry-run local sin MONGODB_URI: solo se cuenta y se buscan colisiones)";
  }

  console.log(`[migrate] destino: ${target}`);
  console.log(`[migrate] origen: carpeta ${path.basename(dataDir)}/`);
  console.log(`[migrate] modo: ${mode}`);
  console.log("");

  const now = new Date();
  const migrationRunId = buildMigrationRunId(mode, now);

  try {
    const report = await migrateStateToMongo(
      {
        dataDir,
        mode,
        migrationRunId,
        now: now.toISOString(),
        strictParseErrors: args["allow-parse-errors"] !== "true",
        // Una migracion que no dice nada durante minutos es
        // indistinguible de una colgada. Se ha confundido ya una vez.
        onProgress: (message) => console.log(`[migrate] ${message}`),
      },
      repository
    );

    console.log(renderMigrationReport(report));
    console.log("");

    // Fase O57 — reparacion de los eventos que se migraron sin fecha por
    // un descriptor mal declarado. Solo rellena huecos: no borra ni pisa
    // ninguna fecha buena, y repetirla no cambia nada.
    if (mode === "apply" && !report.aborted) {
      const repair = await repairEventTimestamps(dataDir, repository);
      if (repair.repaired > 0 || repair.unrepairable.length > 0) {
        console.log(renderRepairReport(repair));
        console.log("");
      }
      console.log(
        `REPAIR_JSON=${JSON.stringify({
          repaired: repair.repaired,
          alreadyCorrect: repair.alreadyCorrect,
          unrepairable: repair.unrepairable.length,
        })}`
      );
    }

    // Bitacora de la ejecucion. No es estado del departamento; sirve para
    // demostrar que dos ejecuciones producen el mismo resultado.
    if (mode === "apply" && !report.aborted) {
      await repository.migrations.record(report.migrationRunId, {
        mode: report.mode,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        totals: report.totals,
      });
    }

    console.log(
      `MIGRATION_JSON=${JSON.stringify({
        migrationRunId: report.migrationRunId,
        mode: report.mode,
        aborted: report.aborted,
        ...report.totals,
      })}`
    );

    if (report.aborted) {
      console.error(`[migrate] ABORTADA: ${report.abortReason}`);
      process.exit(1);
    }
  } finally {
    await repository.close();
  }
}

main().catch((err) => {
  console.error(sanitizeMongoText(err));
  process.exit(1);
});
