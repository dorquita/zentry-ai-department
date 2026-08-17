/**
 * Fase O56 — el guard de estado basado en invariantes de MongoDB.
 *
 *   npm run state:snapshot-mongodb -- --out <fichero>
 *     Fotografia el estado autoritativo ANTES de la pasada.
 *
 *   npm run state:verify-mongodb -- --before <fichero> [--departmentRunId <id>] [--require-finished]
 *     Vuelve a fotografiar DESPUES y comprueba que no se ha perdido nada.
 *
 *   npm run state:verify-mongodb -- --mode equivalence [--data-dir <dir>]
 *     Fase 2 de la transicion: comprueba que MongoDB contiene todo lo que
 *     contiene el estado legacy en fichero. Compara SEMANTICA (ids,
 *     cardinalidad, decisiones), nunca bytes.
 *
 * A DIFERENCIA DEL GUARD ANTIGUO, este no mira el tamaño de ningun
 * fichero. Que un informe de `reports/` encoja le es indiferente: lo que
 * comprueba es que ninguna entidad, ningun evento y sobre todo NINGUNA
 * DECISION HUMANA haya desaparecido.
 *
 * Fail-closed: sale con codigo != 0 ante cualquier violacion.
 */
import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "../src/core/client-paths";
import { sanitizeMongoText } from "../src/persistence/mongo-config";
import {
  MongoStateSnapshot,
  captureMongoStateSnapshot,
  detectInvariantViolations,
  renderInvariantReport,
  verifyRunInvariants,
} from "../src/persistence/state-invariants";
import { renderEquivalenceReport, verifyLegacyEquivalence } from "../src/persistence/migration";
import { openPersistenceSession } from "../src/persistence/runtime";
import { DepartmentStateRepository } from "../src/persistence/repositories";

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

async function openRepository(): Promise<DepartmentStateRepository> {
  // Modo "mongo" a proposito: este script EXISTE para hablar con MongoDB.
  // Si no puede, falla cerrado en vez de decir "todo bien" sin haber
  // comprobado nada, que es el peor resultado posible en un guard.
  const session = await openPersistenceSession({ mode: "mongo" });
  if (!session.repository) {
    throw new Error("No hay repositorio de MongoDB disponible. El guard no puede verificar nada.");
  }
  console.log(`[state] destino: ${session.target}`);
  return session.repository;
}

async function runSnapshot(outPath: string, repository: DepartmentStateRepository): Promise<void> {
  const snapshot = await captureMongoStateSnapshot(repository, new Date().toISOString());
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(
    `[state] foto escrita: ${snapshot.runs} pasada(s), ${snapshot.humanDecisions} decision(es) humana(s), ` +
      `${Object.values(snapshot.entitiesByKind).reduce((a, b) => a + b, 0)} entidad(es), ` +
      `${Object.values(snapshot.eventsByKind).reduce((a, b) => a + b, 0)} evento(s).`
  );
}

async function runVerify(
  args: Record<string, string>,
  repository: DepartmentStateRepository
): Promise<number> {
  const beforePath = args.before;
  let before: MongoStateSnapshot | null = null;
  if (beforePath && beforePath !== "true") {
    if (!fs.existsSync(path.resolve(beforePath))) {
      throw new Error(
        `No existe la foto previa "${beforePath}". Sin ella no se puede demostrar que no se ha perdido nada: fail-closed.`
      );
    }
    before = JSON.parse(fs.readFileSync(path.resolve(beforePath), "utf-8")) as MongoStateSnapshot;
  }

  const after = await captureMongoStateSnapshot(repository, new Date().toISOString());
  const violations = before ? detectInvariantViolations(before, after) : [];

  const runId = args.departmentRunId;
  if (runId && runId !== "true") {
    violations.push(
      ...(await verifyRunInvariants(repository, runId, {
        requireFinished: args["require-finished"] === "true",
      }))
    );
  }

  console.log(renderInvariantReport(before, after, violations));
  console.log("");
  console.log(
    `MONGO_STATE_VERIFY_JSON=${JSON.stringify({
      ok: violations.length === 0,
      violations: violations.length,
      runs: after.runs,
      humanDecisions: after.humanDecisions,
    })}`
  );

  if (violations.length > 0) {
    console.error(
      `Se han detectado ${violations.length} violacion(es) de invariante en el estado autoritativo.`
    );
    return 1;
  }
  return 0;
}

async function runEquivalence(
  args: Record<string, string>,
  repository: DepartmentStateRepository
): Promise<number> {
  const dataDir =
    args["data-dir"] && args["data-dir"] !== "true"
      ? path.resolve(args["data-dir"])
      : resolveActiveClientPaths().dataDir;

  const report = await verifyLegacyEquivalence(dataDir, repository, new Date().toISOString());
  console.log(renderEquivalenceReport(report));
  console.log("");
  console.log(
    `MONGO_EQUIVALENCE_JSON=${JSON.stringify({
      equivalent: report.equivalent,
      divergences: report.findings.length,
      decisionsLegacy: report.decisionsLegacy,
      decisionsMongo: report.decisionsMongo,
    })}`
  );
  return report.equivalent ? 0 : 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repository = await openRepository();

  try {
    if (args.mode === "snapshot") {
      const out = args.out;
      if (!out || out === "true") {
        throw new Error("--mode snapshot requiere --out <fichero>.");
      }
      await runSnapshot(out, repository);
      return;
    }

    if (args.mode === "equivalence") {
      process.exitCode = await runEquivalence(args, repository);
      return;
    }

    process.exitCode = await runVerify(args, repository);
  } finally {
    await repository.close();
  }
}

main().catch((err) => {
  console.error(sanitizeMongoText(err));
  process.exit(1);
});
