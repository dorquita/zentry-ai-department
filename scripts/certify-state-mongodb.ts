/**
 * Fase O57 — CERTIFICACION INDEPENDIENTE del estado en MongoDB.
 *
 *   npm run state:certify-mongodb -- --runs dept-A,dept-B,dept-C
 *   npm run state:certify-mongodb -- --runs dept-A,dept-B,dept-C --expected-decisions 7
 *
 * Este script NO participa en ninguna pasada. Se ejecuta desde un job
 * distinto, en un runner limpio, sin ningun `data/` restaurado y sin
 * ningun fichero del departamento a la vista: TODO lo que afirma sale de
 * consultar Atlas. Es la unica forma de que la verificacion no sea "el
 * sistema diciendo que el sistema esta bien".
 *
 * Comprueba, y falla cerrado ante cualquier fallo:
 *
 *   1. las pasadas indicadas EXISTEN en `department_runs`;
 *   2. estan en el orden cronologico esperado;
 *   3. cada una esta terminada (`finishedAt` != null);
 *   4. las decisiones humanas siguen siendo las esperadas;
 *   5. no hay duplicados en ninguna coleccion (por su clave unica);
 *   6. la pasada mas reciente CONSERVA lo de las anteriores (continuidad);
 *   7. `violations: 0` en las invariantes ESTRUCTURALES (ver mas abajo:
 *      un job independiente no tiene la foto ANTES, asi que la invariante
 *      de "no ha encogido" la comprueba cada pasada con `--before`).
 *
 * El informe es saneado: ni URI, ni credenciales, ni rutas absolutas.
 */
import { sanitizeMongoText } from "../src/persistence/mongo-config";
import { openPersistenceSession } from "../src/persistence/runtime";
import { DepartmentStateRepository } from "../src/persistence/repositories";
import { readPreviousHumanFeedbackFrom } from "../src/approvals/manual/state-decision-reader";
import { ENTITY_REGISTRY } from "../src/persistence/entity-registry";

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

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const runIds = (args.runs ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== "true");
  if (runIds.length === 0) {
    throw new Error("--runs es obligatorio: lista de departmentRunId separados por comas.");
  }
  const expectedDecisions =
    args["expected-decisions"] && args["expected-decisions"] !== "true"
      ? Number(args["expected-decisions"])
      : null;

  // Modo `mongo` explicito: este script existe para hablar con Atlas. Si
  // no puede, falla cerrado en vez de afirmar que todo esta bien sin
  // haber comprobado nada.
  const session = await openPersistenceSession({ mode: "mongo" });
  if (!session.repository) {
    throw new Error("No hay repositorio de MongoDB disponible. No se certifica nada.");
  }
  const repository: DepartmentStateRepository = session.repository;
  console.log(`[certify] destino: ${session.target}`);
  console.log(`[certify] pasadas a certificar: ${runIds.length}`);
  console.log("");

  const checks: Check[] = [];

  try {
    // --- 1 y 3. Las pasadas existen y estan terminadas.
    for (const runId of runIds) {
      const run = await repository.runs.getRun(runId);
      checks.push(
        check(
          `pasada ${runId} existe en department_runs`,
          run !== null,
          run ? `status=${run.status}` : "NO ENCONTRADA"
        )
      );
      if (run) {
        checks.push(
          check(
            `pasada ${runId} esta terminada`,
            run.finishedAt !== null && run.finishedAt !== undefined,
            run.finishedAt ? `finishedAt=${run.finishedAt}` : "finishedAt=null (sigue abierta)"
          )
        );
      }
    }

    // --- 2. Orden cronologico. Los ids llevan fecha ISO de ancho fijo,
    // asi que el orden lexicografico ES el cronologico.
    const sorted = [...runIds].sort();
    checks.push(
      check(
        "las pasadas estan en el orden esperado",
        JSON.stringify(sorted) === JSON.stringify(runIds),
        `orden recibido: ${runIds.join(" < ")}`
      )
    );

    // Y ademas: `findPreviousRun` devuelve una pasada ANTERIOR de verdad.
    //
    // La primera version de esta comprobacion exigia que la anterior de
    // cada pasada fuera exactamente la que yo habia listado, y fallo. No
    // fallo MongoDB: fallo la expectativa. Entre dos de las pasadas
    // listadas habia OTRA pasada real que tambien escribio su estado, y
    // MongoDB devolvio esa -- que es la respuesta correcta.
    //
    // Lo que hay que verificar es la propiedad que usa la continuidad del
    // brief: que existe una anterior y que es estrictamente anterior. Que
    // sea justo la que yo esperaba es una expectativa mia, no un
    // invariante del sistema.
    for (let i = 1; i < runIds.length; i++) {
      const previous = await repository.runs.findPreviousRun(runIds[i]);
      const found = previous?.departmentRunId ?? "";
      const exact = found === runIds[i - 1];
      checks.push(
        check(
          `${runIds[i]} tiene una pasada anterior, y es anterior de verdad`,
          found.length > 0 && found < runIds[i],
          exact
            ? `MongoDB devuelve ${found} (la esperada)`
            : `MongoDB devuelve ${found}: otra pasada real intercalada, anterior a ${runIds[i]}`
        )
      );
    }

    // --- 4. Decisiones humanas: cuantas hay y cuantas LLEGAN al lector.
    const decisions = await repository.decisions.listAll();
    const feedback = await readPreviousHumanFeedbackFrom(repository);
    const byAction: Record<string, number> = {};
    for (const decision of decisions) byAction[decision.action] = (byAction[decision.action] ?? 0) + 1;

    if (expectedDecisions !== null) {
      checks.push(
        check(
          `hay ${expectedDecisions} decisiones humanas`,
          decisions.length === expectedDecisions,
          `${decisions.length} en human_decisions (${JSON.stringify(byAction)})`
        )
      );
    }
    checks.push(
      check(
        "todas las decisiones humanas llegan al lector de los agentes",
        feedback.length === decisions.length,
        `${feedback.length} de ${decisions.length} entran en el contexto de los empleados`
      )
    );
    checks.push(
      check(
        "ninguna decision humana ha perdido su motivo literal",
        decisions
          .filter((d) => d.action === "reject")
          .every((d) => typeof d.rejectionReason === "string"),
        `${decisions.filter((d) => d.action === "reject").length} rechazo(s) revisado(s)`
      )
    );

    // --- 5. Duplicados. Cada coleccion tiene una clave unica declarada;
    // que el indice exista no demuestra que los datos la respeten, asi
    // que se cuenta de verdad.
    const duplicates: string[] = [];
    const structuralProblems: string[] = [];

    const seenDecisions = new Set<string>();
    for (const decision of decisions) {
      if (seenDecisions.has(decision.decisionKey)) duplicates.push(`human_decisions:${decision.decisionKey}`);
      seenDecisions.add(decision.decisionKey);
    }

    const allRuns = await repository.runs.listRuns();
    const seenRuns = new Set<string>();
    for (const run of allRuns) {
      if (seenRuns.has(run.departmentRunId)) duplicates.push(`department_runs:${run.departmentRunId}`);
      seenRuns.add(run.departmentRunId);
    }

    // Entidades y eventos: por kind, para no traerse las 5 colecciones
    // enteras de una vez. Una consulta por kind, no una por documento.
    let entityTotal = 0;
    let eventTotal = 0;
    for (const descriptor of ENTITY_REGISTRY) {
      if (descriptor.stateClass === "A") {
        const found = await repository.entities.listByKind(descriptor.kind);
        entityTotal += found.length;
        const seen = new Set<string>();
        for (const entity of found) {
          if (seen.has(entity.entityId)) duplicates.push(`${descriptor.kind}:${entity.entityId}`);
          seen.add(entity.entityId);
          if (!entity.entityId?.trim()) structuralProblems.push(`${descriptor.kind}: entidad sin entityId`);
          if (!entity.recordUpdatedAt?.trim()) {
            structuralProblems.push(`${descriptor.kind}:${entity.entityId}: sin recordUpdatedAt`);
          }
        }
      } else if (descriptor.stateClass === "B") {
        const found = await repository.events.listByKind(descriptor.kind);
        eventTotal += found.length;
        const seen = new Set<string>();
        for (const event of found) {
          if (seen.has(event.eventId)) duplicates.push(`${descriptor.kind}:${event.eventId}`);
          seen.add(event.eventId);
          if (!event.eventId?.trim()) structuralProblems.push(`${descriptor.kind}: evento sin eventId`);
          if (!event.occurredAt?.trim()) {
            structuralProblems.push(`${descriptor.kind}:${event.eventId}: sin occurredAt`);
          }
        }
      }
    }

    checks.push(
      check(
        "no hay duplicados en ninguna coleccion",
        duplicates.length === 0,
        duplicates.length === 0
          ? `${entityTotal} entidades y ${eventTotal} eventos revisados uno a uno`
          : `${duplicates.length} duplicado(s): ${duplicates.slice(0, 5).join(", ")}`
      )
    );

    // --- 6. Continuidad: la ULTIMA pasada ve lo de las anteriores.
    //
    // No basta con que las tres esten registradas: lo que importa es que
    // desde la ultima se pueda RECUPERAR lo anterior. Eso es exactamente
    // lo que hacen los dos lectores criticos.
    const last = runIds[runIds.length - 1];
    const previousOfLast = await repository.runs.findPreviousRun(last);
    const decisionsBeforeLast = decisions.filter((d) => d.departmentRunId < last);
    checks.push(
      check(
        `desde ${last} se recupera el resumen de la pasada anterior`,
        previousOfLast !== null && previousOfLast.briefSummary !== undefined && previousOfLast.briefSummary !== null,
        previousOfLast?.briefSummary
          ? `briefSummary de ${previousOfLast.departmentRunId}: ${JSON.stringify(previousOfLast.briefSummary)}`
          : `sin briefSummary en ${previousOfLast?.departmentRunId ?? "(ninguna)"}`
      )
    );
    checks.push(
      check(
        `desde ${last} se ven las decisiones humanas anteriores`,
        decisionsBeforeLast.length > 0,
        `${decisionsBeforeLast.length} decision(es) tomadas antes de esta pasada siguen accesibles`
      )
    );

    // --- 7. Invariantes del estado autoritativo.
    //
    // Un job independiente no tiene la foto ANTES de la pasada, asi que
    // aqui NO se puede comprobar "no ha encogido" -- eso lo hace
    // `state:verify-mongodb` dentro de cada pasada, con su `--before`.
    // Comparar una foto consigo misma daria `violations: 0` siempre y
    // seria una tautologia disfrazada de comprobacion.
    //
    // Lo que SI se puede verificar sin foto previa son las invariantes
    // ESTRUCTURALES: que ningun documento incumple el contrato con el que
    // se escribio. Un documento sin identidad o sin fecha es un documento
    // que no se puede recuperar despues, que es exactamente el fallo que
    // esta fase existe para eliminar.
    const violations: string[] = [];

    for (const decision of decisions) {
      const missing: string[] = [];
      if (!decision.recommendationId?.trim()) missing.push("recommendationId");
      if (!decision.decidedAt?.trim()) missing.push("decidedAt");
      if (!decision.departmentRunId?.trim()) missing.push("departmentRunId");
      if (!decision.decisionKey?.trim()) missing.push("decisionKey");
      if (typeof decision.action !== "string" || decision.action.length === 0) missing.push("action");
      if (missing.length > 0) {
        violations.push(`human_decision ${decision.decisionId}: falta ${missing.join(", ")}`);
      }
    }

    for (const run of allRuns) {
      if (!run.departmentRunId?.trim()) violations.push("department_run sin departmentRunId");
      if (!run.startedAt?.trim()) violations.push(`department_run ${run.departmentRunId}: sin startedAt`);
    }

    for (const problem of structuralProblems) violations.push(problem);

    checks.push(
      check(
        "violations: 0 (invariantes estructurales)",
        violations.length === 0,
        violations.length === 0
          ? `${decisions.length} decisiones, ${allRuns.length} pasadas, ${entityTotal} entidades y ${eventTotal} eventos cumplen su contrato`
          : violations.slice(0, 5).join("; ")
      )
    );

    // --- Informe.
    console.log("## Certificacion independiente del estado en MongoDB");
    console.log("");
    console.log("| comprobacion | resultado | detalle |");
    console.log("| --- | --- | --- |");
    for (const item of checks) {
      console.log(`| ${item.name} | ${item.ok ? "OK" : "FALLA"} | ${sanitizeMongoText(item.detail)} |`);
    }
    console.log("");

    const failed = checks.filter((item) => !item.ok);
    console.log(
      `CERTIFY_JSON=${JSON.stringify({
        checks: checks.length,
        failed: failed.length,
        runs: runIds.length,
        humanDecisions: decisions.length,
        feedbackEntries: feedback.length,
        entities: entityTotal,
        events: eventTotal,
        duplicates: duplicates.length,
        violations: violations.length,
        ok: failed.length === 0,
      })}`
    );

    if (failed.length > 0) {
      console.error(`[certify] ${failed.length} comprobacion(es) han fallado. NO se certifica.`);
      process.exit(1);
    }
    console.log("[certify] Todas las comprobaciones pasan contra Atlas.");
  } finally {
    await repository.close();
  }
}

main().catch((err) => {
  console.error(sanitizeMongoText(err));
  process.exit(1);
});
