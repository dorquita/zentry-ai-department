/**
 * Fase O56 — escritura de la pasada en MongoDB (fase 1: shadow write).
 *
 *   npm run state:sync-mongodb -- --departmentRunId <id> --status succeeded
 *   npm run state:sync-mongodb -- --decisions-only
 *
 * QUE HACE Y POR QUE ASI:
 *
 * En la fase de transicion el estado sigue viviendo en `data/*.jsonl` y en
 * la rama `department-state`, pero al terminar de producir, la pasada
 * vuelca TODO lo autoritativo tambien a MongoDB. Reutiliza el motor de
 * migracion en vez de tener su propio camino de escritura: eso garantiza
 * que "sincronizar la pasada de hoy" y "migrar el historico" no pueden
 * divergir, y que ambos son idempotentes por construccion.
 *
 * `--decisions-only` existe para el workflow de aprobacion, que es el
 * agujero mas grave del sistema actual: escribe la decision humana en un
 * runner efimero, no restaura ni persiste la rama de estado, y la decision
 * se pierde SIEMPRE. Con esto la decision queda escrita en MongoDB en el
 * mismo job en que se toma, antes de que el runner muera.
 *
 * MODO DE FALLO: en modo `shadow` un problema de MongoDB se reporta pero
 * no tumba la pasada (la fuente de verdad todavia es el fichero). En modo
 * `mongo` falla cerrado. Nunca se finge exito.
 */
import * as path from "path";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { HUMAN_DECISIONS_FILE } from "../src/persistence/entity-registry";
import { sanitizeMongoText } from "../src/persistence/mongo-config";
import {
  migrateHumanDecisions,
  migrateStateToMongo,
  renderMigrationReport,
} from "../src/persistence/migration";
import {
  buildObservability,
  failsClosed,
  openPersistenceSession,
  renderObservability,
} from "../src/persistence/runtime";
import { DepartmentRunStatus } from "../src/persistence/repositories";

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

function resolveStatus(raw: string | undefined): DepartmentRunStatus {
  if (raw === "succeeded" || raw === "failed" || raw === "running") return raw;
  return "succeeded";
}

/** "dept-..." es la pasada coordinada; "growth-department-..." es la v1. */
function resolveRunKind(departmentRunId: string): string {
  if (departmentRunId.startsWith("growth-department-")) return "growth-v1";
  if (departmentRunId.startsWith("dept-")) return "coordinated";
  return "otro";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const decisionsOnly = args["decisions-only"] === "true";

  const session = await openPersistenceSession();

  if (session.mode === "legacy") {
    console.log("[sync] modo legacy: MongoDB no interviene en esta pasada. Nada que sincronizar.");
    console.log(renderObservability(buildObservability(session)));
    return;
  }

  if (!session.repository) {
    // En modo shadow esto NO es fatal: el estado sigue en fichero.
    console.error(`[sync] MongoDB no disponible: ${session.unavailableReason}`);
    console.log(renderObservability(buildObservability(session)));
    if (failsClosed(session.mode)) process.exit(1);
    return;
  }

  const repository = session.repository;
  const dataDir =
    args["data-dir"] && args["data-dir"] !== "true"
      ? path.resolve(args["data-dir"])
      : resolveActiveClientPaths().dataDir;

  console.log(`[sync] destino: ${session.target}`);
  console.log(`[sync] modo: ${session.mode}`);

  try {
    if (decisionsOnly) {
      const result = await migrateHumanDecisions(
        path.join(dataDir, HUMAN_DECISIONS_FILE),
        repository,
        "apply"
      );
      console.log(
        `[sync] decisiones humanas: ${result.distinctDecisionKeys} distintas, ${result.inserted} nuevas, ` +
          `${result.duplicatesPrevented} ya estaban, ${result.failed} fallidas.`
      );
      console.log(
        `DECISIONS_SYNC_JSON=${JSON.stringify({
          distinct: result.distinctDecisionKeys,
          inserted: result.inserted,
          duplicatesPrevented: result.duplicatesPrevented,
          failed: result.failed,
        })}`
      );
      console.log("");
      console.log(renderObservability(buildObservability(session, repository.writeStats())));
      if (result.failed > 0 && failsClosed(session.mode)) process.exit(1);
      return;
    }

    const departmentRunId = args.departmentRunId;
    if (!departmentRunId || departmentRunId === "true") {
      throw new Error("--departmentRunId es obligatorio salvo con --decisions-only.");
    }

    const startedAt = new Date().toISOString();
    const runKind = resolveRunKind(departmentRunId);

    // Idempotente: si la pasada ya existe (rerun del job), no se duplica
    // ni se pisa su hora de inicio original.
    const opened = await repository.runs.startRun({ departmentRunId, runKind, startedAt });
    console.log(`[sync] pasada ${departmentRunId}: ${opened.result}.`);

    const report = await migrateStateToMongo(
      {
        dataDir,
        mode: "apply",
        migrationRunId: `sync-${departmentRunId}`,
        now: startedAt,
        // Una linea corrupta de hace meses no puede impedir que la pasada
        // de hoy persista su estado: se reporta y se sigue.
        strictParseErrors: false,
      },
      repository
    );

    console.log(renderMigrationReport(report));

    const existing = await repository.runs.getRun(departmentRunId);
    await repository.runs.finishRun({
      departmentRunId,
      runKind,
      startedAt: existing?.startedAt ?? startedAt,
      finishedAt: new Date().toISOString(),
      status: resolveStatus(args.status),
      observability: { ...buildObservability(session, repository.writeStats()) },
    });

    console.log("");
    console.log(renderObservability(buildObservability(session, repository.writeStats())));

    if (report.aborted) {
      console.error(`[sync] ${report.abortReason}`);
      if (failsClosed(session.mode)) process.exit(1);
    }
  } finally {
    await repository.close();
  }
}

main().catch((err) => {
  console.error(sanitizeMongoText(err));
  process.exit(1);
});
