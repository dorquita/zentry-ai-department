/**
 * O46 -- SEGUNDO EMAIL: el acta de la decision de Pau sobre el Daily
 * Brief `dept-2026-08-15T175321Z`.
 *
 * Es el mismo informe que envia `scripts/run-approval-session.ts` al
 * final de una sesion normal, con el MISMO renderer
 * (`src/department/execution-report.ts`) y el MISMO resolutor de
 * configuracion de correo. Lo unico que cambia es de donde salen los
 * datos: de los ficheros de la sesion ya registrada
 * (`reports/approval-sessions/<departmentRunId>/`) en vez del contrato de
 * apply de la pasada, que en esa pasada concreta usa una version de
 * contrato que el codigo de hoy ya no lee (ver el README de ese
 * directorio y el encabezado de o46-record-daily-brief-decisions.ts).
 *
 * No inventa NADA:
 *
 *  - Las escrituras se leen de `session-result.json`. Son 0 y 0, y se
 *    imprimen igualmente: "0 escrituras en produccion" es informacion.
 *  - El coste sale del snapshot REAL de los `claude-execution.json` de la
 *    pasada que genero el Daily Brief.
 *  - El motivo del rechazo viaja literal, sin resumir.
 *
 * Fail-closed con la configuracion: si falta cualquier variable SMTP no
 * envia nada e imprime los NOMBRES (nunca los valores) de lo que falta.
 * Con `--dry-run` construye el correo, lo guarda y no abre ninguna
 * conexion.
 *
 * Uso:
 *   npx ts-node scripts/o46-send-decision-report-email.ts \
 *     --sessionDir reports/approval-sessions/dept-2026-08-15T175321Z [--dry-run]
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { ResolvedDecision } from "../src/approvals/manual/decision";
import { NumberedProposal } from "../src/approvals/manual/proposal";
import { resolveActiveClientConfig } from "../src/core/client-config";
import { sendReportEmail } from "../src/core/mailer";
import { containsSecretValue, REQUIRED_SMTP_VARS, resolveDailyBriefEmailConfig } from "../src/department/email-config";
import { DepartmentEmployeeRun, summarizeDepartmentRunCost } from "../src/department/employee-runs";
import { buildExecutionReportEmail, ExecutedWork, ExecutionNewRecommendation, ExecutionReportInput } from "../src/department/execution-report";

const PROJECT_ROOT = path.join(__dirname, "..");
const SENSITIVE_VARS = [...REQUIRED_SMTP_VARS, "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "WORDPRESS_APP_PASSWORD", "TELEGRAM_BOT_TOKEN"];

interface SessionOutcome {
  number: number;
  action: string;
  target: string;
  status: string;
  detail: string;
  rejectionReason: string;
  blockedReason: string;
}

interface SessionResult {
  departmentRunId: string;
  decidedBy: string;
  decidedAt: string;
  writes: { staging: number; production: number };
  outcomes: SessionOutcome[];
  pending: { number: number }[];
}

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

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) throw new Error(`No existe ${path.relative(PROJECT_ROOT, filePath)}. Fail-closed: sin ese fichero no hay nada real que contar.`);
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

/**
 * Reconstruye la `ResolvedDecision` de una salida ya registrada. No
 * vuelve a decidir nada: solo re-emparejar el numero con su propuesta
 * para que el renderer pueda imprimir numero + id real juntos.
 */
function toResolvedDecision(outcome: SessionOutcome, proposal: NumberedProposal): ResolvedDecision {
  return {
    proposal,
    action: outcome.action as ResolvedDecision["action"],
    target: outcome.target as ResolvedDecision["target"],
    reason: outcome.rejectionReason,
    overrides: {},
    executable: false,
    blockedReason: outcome.blockedReason,
  };
}

/**
 * Que trabajo necesitaria la propuesta 7 para poder volver a
 * presentarse. Va en "NUEVAS RECOMENDACIONES" a proposito: el renderer
 * dice ahi, literalmente, que no se ha ejecutado nada de esto y que
 * aparecera numerado en el proximo Daily Brief -- que es exactamente lo
 * que Pau pidio que pasara con la 7.
 */
function readNewRecommendations(sessionDir: string): ExecutionNewRecommendation[] {
  const filePath = path.join(sessionDir, "new-recommendations.json");
  return readJson<ExecutionNewRecommendation[]>(filePath);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sessionDirArg = args.sessionDir;
  if (!sessionDirArg || sessionDirArg === "true") throw new Error("Falta --sessionDir <directorio de la sesion>.");
  const sessionDir = path.resolve(sessionDirArg);
  const dryRun = args["dry-run"] === "true";

  const session = readJson<SessionResult>(path.join(sessionDir, "session-result.json"));
  const proposals = readJson<NumberedProposal[]>(path.join(sessionDir, "proposals.json"));
  const runs = readJson<DepartmentEmployeeRun[]>(path.join(sessionDir, "employee-runs.snapshot.json"));

  const byNumber = new Map(proposals.map((proposal) => [proposal.number, proposal]));
  const decisionFor = (outcome: SessionOutcome): ResolvedDecision => {
    const proposal = byNumber.get(outcome.number);
    if (!proposal) throw new Error(`La sesion menciona la propuesta #${outcome.number}, que no existe en proposals.json. Fail-closed.`);
    return toResolvedDecision(outcome, proposal);
  };

  // Aprobadas: se cuentan como trabajo con resultado `not_executed` y el
  // motivo real delante. Ninguna escribio en ningun sitio, y el informe
  // lo dice en vez de omitirlas.
  const executed: ExecutedWork[] = session.outcomes
    .filter((outcome) => outcome.action === "approve")
    .map((outcome) => ({
      decision: decisionFor(outcome),
      action: outcome.detail,
      environment: "none" as const,
      changes: [],
      validation: "",
      outcome: "not_executed" as const,
      outcomeDetail: outcome.blockedReason || outcome.detail,
      url: "",
      rollback: null,
    }));

  const input: ExecutionReportInput = {
    generatedAt: session.decidedAt,
    runIds: {
      departmentRunId: session.departmentRunId,
      executionRunId: `approval-session-${session.decidedAt}`,
      briefRunUrl: args.briefRunUrl && args.briefRunUrl !== "true" ? args.briefRunUrl : "",
      executionRunUrl: process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? ""}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : "",
    },
    executed,
    pending: session.pending.map((p) => byNumber.get(p.number)).filter((p): p is NumberedProposal => Boolean(p)),
    rejected: session.outcomes.filter((outcome) => outcome.action === "reject").map(decisionFor),
    newRecommendations: readNewRecommendations(sessionDir),
    writes: session.writes,
    cost: runs.length > 0 ? summarizeDepartmentRunCost(runs) : null,
  };

  const email = buildExecutionReportEmail(input);

  const leak = containsSecretValue(`${email.subject}\n${email.text}\n${email.html}`, process.env, SENSITIVE_VARS);
  if (leak) {
    throw new Error(`Abortado antes de enviar: el correo construido contiene el valor de la variable sensible ${leak}. No se envia ni se guarda nada.`);
  }

  const emailPath = path.join(sessionDir, "decision-report-email.json");
  fs.writeFileSync(emailPath, JSON.stringify({ subject: email.subject, text: email.text, html: email.html }, null, 2), "utf-8");
  console.log(`Email construido y guardado en ${path.relative(PROJECT_ROOT, emailPath)}.`);

  const config = resolveDailyBriefEmailConfig({
    env: process.env,
    fallbackRecipientVar: resolveActiveClientConfig().notificationSettings.reportEmailToEnvVar,
  });
  if (!config.configured) {
    console.error(config.reason);
    console.log(`EMAIL_RESULT_JSON=${JSON.stringify({ status: "skipped_missing_config", sent: false, missing: config.missing, subject: email.subject })}`);
    return;
  }

  if (dryRun) {
    console.log(`Dry-run: NO se envia nada. Destinatario que se habria usado: resuelto desde ${config.recipientVar}.`);
    console.log(`EMAIL_RESULT_JSON=${JSON.stringify({ status: "dry_run", sent: false, recipientVar: config.recipientVar, subject: email.subject })}`);
    return;
  }

  await sendReportEmail({ subject: email.subject, text: email.text, html: email.html }, { to: config.to, label: "Informe de decision del departamento" });
  console.log(`EMAIL_RESULT_JSON=${JSON.stringify({ status: "sent", sent: true, recipientVar: config.recipientVar, subject: email.subject })}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
