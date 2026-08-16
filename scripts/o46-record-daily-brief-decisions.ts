/**
 * O46 -- REGISTRO de la decision humana sobre un Daily Brief cuyo
 * `apply-summary.json` ya no se puede leer con el contrato vigente.
 *
 * Por que existe, en una frase: `scripts/run-approval-session.ts` es y
 * sigue siendo el camino normal, pero solo sabe leer
 * `apply-summary.json` con la version de contrato de HOY
 * (`department-apply/v2`) y falla-cerrado con cualquier otra --
 * deliberadamente. El Daily Brief de `dept-2026-08-15T175321Z` se genero
 * con `department-apply/v1`, asi que la decision de Pau sobre esas 7
 * propuestas no se puede registrar por ahi sin relajar ese guard, cosa
 * que NO se hace.
 *
 * Este script cubre exactamente ese hueco y nada mas:
 *
 *   - Lee las propuestas YA RESUELTAS a su id real desde un fichero
 *     (`--proposals`), en vez de derivarlas del contrato de apply. Ese
 *     fichero es un snapshot auditable del Daily Brief real, con su
 *     procedencia documentada al lado (ver el README del directorio de
 *     la sesion).
 *   - Valida la decision con el MISMO validador determinista de siempre
 *     (`resolveHumanDecisions`, src/approvals/manual/decision.ts). No se
 *     duplica ni se reimplementa ninguna regla: el silencio no es
 *     aprobacion, un numero inexistente invalida la instruccion entera,
 *     un rechazo sin motivo no se acepta.
 *   - Registra la decision en el MISMO log append-only de siempre
 *     (`appendHumanDecision`, data/department-human-decisions.jsonl), que
 *     es lo que alimenta `previousHumanFeedback` en las pasadas
 *     siguientes.
 *
 * Lo que este script NO hace, nunca, bajo ninguna bandera:
 *
 *   - NO escribe en WordPress, staging, produccion, Google Ads, GA4/GTM,
 *     Search Console, n8n ni email. Cero escrituras externas.
 *   - NO ejecuta ninguna propuesta. Si alguna propuesta del fichero
 *     viniese marcada como `actionable: true`, ABORTA sin registrar
 *     nada y remite a `npm run approvals:session`, que es el unico
 *     camino que sabe hacer snapshot -> escribir -> validar -> rollback.
 *     Registrar una aprobacion "ejecutable" sin ejecutarla dejaria el
 *     sistema diciendo que algo se aprobo y se hizo cuando no se hizo.
 *
 * DRY-RUN por defecto, igual que la sesion de aprobacion normal: enseña
 * como ha interpretado la decision y no toca el registro hasta que se le
 * pasa `--execute`.
 *
 * Uso:
 *   npx ts-node scripts/o46-record-daily-brief-decisions.ts \
 *     --departmentRunId dept-2026-08-15T175321Z \
 *     --proposals reports/approval-sessions/dept-2026-08-15T175321Z/proposals.json \
 *     --decisions reports/approval-sessions/dept-2026-08-15T175321Z/decisions.json \
 *     [--decided-by pau] [--execute]
 */
import * as fs from "fs";
import * as path from "path";
import { HumanInstruction, resolveHumanDecisions } from "../src/approvals/manual/decision";
import { appendHumanDecision, buildDecisionId, getHumanDecisionsFilePath, readHumanDecisions } from "../src/approvals/manual/decision-store";
import { NumberedProposal } from "../src/approvals/manual/proposal";

const PROJECT_ROOT = path.join(__dirname, "..");

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

function requireArg(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value || value === "true") throw new Error(`Falta --${name} <valor>.`);
  return value;
}

/**
 * Comprueba que el fichero de propuestas es lo que dice ser. Fail-closed:
 * un fichero de otra pasada, o con numeracion no consecutiva, no se usa.
 */
function loadProposals(filePath: string, departmentRunId: string): NumberedProposal[] {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as NumberedProposal[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${filePath}: se esperaba un array no vacio de propuestas numeradas.`);
  }
  const proposals = [...raw].sort((a, b) => a.number - b.number);
  proposals.forEach((proposal, index) => {
    if (proposal.number !== index + 1) {
      throw new Error(
        `${filePath}: la numeracion no es 1..N consecutiva (se esperaba #${index + 1} y hay #${proposal.number}). Fail-closed: si la numeracion no es la del email, ningun numero significa lo que la persona cree.`
      );
    }
    if (proposal.departmentRunId !== departmentRunId) {
      throw new Error(
        `${filePath}: la propuesta #${proposal.number} pertenece a la pasada "${proposal.departmentRunId}" y se pidio registrar "${departmentRunId}". Fail-closed -- no se mezclan dos Daily Briefs.`
      );
    }
    if (!proposal.recommendationId) {
      throw new Error(`${filePath}: la propuesta #${proposal.number} no trae recommendationId. Sin id real no se registra ninguna decision.`);
    }
  });
  return proposals;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const departmentRunId = requireArg(args, "departmentRunId");
  const proposalsPath = path.resolve(requireArg(args, "proposals"));
  const decisionsPath = path.resolve(requireArg(args, "decisions"));
  const decidedBy = args["decided-by"] && args["decided-by"] !== "true" ? args["decided-by"] : "pau";
  const execute = args.execute === "true";

  const proposals = loadProposals(proposalsPath, departmentRunId);
  const instructions = JSON.parse(fs.readFileSync(decisionsPath, "utf-8")) as HumanInstruction[];
  if (!Array.isArray(instructions)) throw new Error("El fichero de decisiones debe ser un array de instrucciones.");

  const resolved = resolveHumanDecisions({ proposals, instructions });

  console.log(`\nDaily Brief de la pasada ${departmentRunId} -- ${proposals.length} propuesta(s).\n`);
  console.log("ASI HE INTERPRETADO TU DECISION:");
  for (const line of resolved.interpretation) console.log(`  ${line}`);
  console.log("");

  if (!resolved.ok) {
    console.error("NO SE REGISTRA NADA. La instruccion tiene problemas:");
    for (const error of resolved.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  // Este script registra; no ejecuta. Si algo fuese ejecutable, callarselo
  // seria peor que abortar.
  const executables = resolved.decisions.filter((decision) => decision.executable);
  if (executables.length > 0) {
    console.error(
      `NO SE REGISTRA NADA: ${executables.length} propuesta(s) aprobada(s) SI son ejecutables (#${executables.map((d) => d.proposal.number).join(", #")}).`
    );
    console.error("Este script solo registra decisiones -- no escribe en ningun sistema externo, asi que no puede ser el que las apruebe.");
    console.error(`Usa el camino normal: npm run approvals:session -- --departmentRunId ${departmentRunId} --decisions <fichero> --execute`);
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const outcomes = resolved.decisions.map((decision) => ({
    number: decision.proposal.number,
    id: decision.proposal.id,
    recommendationId: decision.proposal.recommendationId,
    changeId: decision.proposal.changeId,
    title: decision.proposal.title,
    action: decision.action,
    target: decision.target,
    // Ninguna decision de este script llega a escribir: o es un rechazo,
    // o es una aprobacion sin executor. Se dice, no se disfraza.
    status: decision.action === "reject" ? "rejected" : decision.action === "defer" ? "deferred" : "not_executed",
    detail:
      decision.action === "reject"
        ? `Rechazada por ${decidedBy}. Motivo guardado literal.`
        : decision.action === "defer"
          ? "Dejada pendiente por decision explicita."
          : `Aprobada por ${decidedBy} para aplicar en ${decision.target}. NO ejecutada: ${decision.blockedReason}`,
    rejectionReason: decision.action === "reject" ? decision.reason : "",
    blockedReason: decision.blockedReason,
  }));

  if (!execute) {
    for (const outcome of outcomes) console.log(`  #${outcome.number} ${outcome.title} -> ${outcome.status} (${outcome.detail.slice(0, 160)})`);
    console.log("\n(DRY-RUN: no se ha registrado nada. Repite con --execute para escribir en el log de decisiones.)");
    console.log("Escrituras externas de este script: 0 en staging, 0 en produccion, siempre.");
    return;
  }

  const decisionsFile = getHumanDecisionsFilePath();
  const before = readHumanDecisions(decisionsFile).length;
  for (const decision of resolved.decisions) {
    const outcome = outcomes.find((o) => o.number === decision.proposal.number);
    appendHumanDecision(
      {
        decisionId: buildDecisionId(departmentRunId, decision.proposal.recommendationId, now.toISOString()),
        departmentRunId,
        proposalNumber: decision.proposal.number,
        recommendationId: decision.proposal.recommendationId,
        changeId: decision.proposal.changeId,
        recommendationTitle: decision.proposal.title,
        action: decision.action,
        rejectionReason: decision.action === "reject" ? decision.reason : "",
        overrides: decision.overrides,
        target: decision.target,
        decidedBy,
        decidedAt: now.toISOString(),
        // `null` = no se ejecuto. Es la verdad: nada de esto escribio en
        // ningun sistema.
        executionStatus: null,
        executionDetail: outcome?.detail ?? "",
      },
      decisionsFile
    );
    console.log(`  #${decision.proposal.number} ${decision.proposal.title} -> ${outcome?.status} REGISTRADA`);
  }
  const after = readHumanDecisions(decisionsFile).length;
  console.log(`\n${after - before} decision(es) anadidas a ${path.relative(PROJECT_ROOT, decisionsFile)}.`);

  const resultPath = path.join(path.dirname(proposalsPath), "session-result.json");
  fs.writeFileSync(
    resultPath,
    JSON.stringify(
      {
        departmentRunId,
        decidedBy,
        decidedAt: now.toISOString(),
        recordedOnly: true,
        writes: { staging: 0, production: 0, external: 0 },
        outcomes,
        pending: resolved.untouched.map((p) => ({ number: p.number, id: p.id, title: p.title })),
        interpretation: resolved.interpretation,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`Sesion registrada en ${path.relative(PROJECT_ROOT, resultPath)}.`);
  console.log("Escrituras en staging: 0. Escrituras en produccion: 0.");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
