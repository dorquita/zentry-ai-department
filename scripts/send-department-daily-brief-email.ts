/**
 * Envio REAL del Daily Brief del departamento por email.
 *
 * Lo unico que hace este script es LEER lo que la pasada ya produjo
 * (`department-daily-brief.json`, `apply-summary.json`, los registros de
 * coste de cada empleado), construir un correo pensado para un director
 * (texto plano + HTML) y enviarlo por SMTP con el mailer que ya existe en
 * el proyecto.
 *
 * Fail-closed y sin sorpresas:
 *
 * - Si falta cualquier variable de configuracion, NO se envia nada y se
 *   imprimen los NOMBRES exactos de las variables que faltan (jamas sus
 *   valores).
 * - Con `--dry-run` construye el correo y lo guarda en el run, pero no
 *   abre ninguna conexion SMTP.
 * - El correo construido se guarda siempre en el directorio de la pasada
 *   (`daily-brief-email.json`) para poder auditarlo despues.
 * - Antes de imprimir nada por consola se verifica que el texto no
 *   contiene el valor de ninguna variable sensible.
 *
 * No modifica el Daily Brief, no vuelve a llamar a ningun empleado y no
 * escribe en ningun sistema que no sea el propio correo.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientConfig } from "../src/core/client-config";
import { sendReportEmail } from "../src/core/mailer";
import { readApplySummary } from "../src/department/apply/store";
import { DepartmentApplySummary } from "../src/department/apply/types";
import { buildDailyBriefEmail } from "../src/department/brief-email";
import { containsSecretValue, REQUIRED_SMTP_VARS, resolveDailyBriefEmailConfig } from "../src/department/email-config";
import { DepartmentDailyBrief } from "../src/department/daily-brief";
import { summarizeDepartmentRunCost } from "../src/department/employee-runs";
import { readDepartmentEmployeeRuns, resolveDepartmentRunPaths, toRepoRelative } from "../src/department/run-store";

const SENSITIVE_VARS = [...REQUIRED_SMTP_VARS, "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "WORDPRESS_APP_PASSWORD", "TELEGRAM_BOT_TOKEN"];

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
    }
  }
  return args;
}

function printResult(result: Record<string, unknown>): void {
  console.log("EMAIL_RESULT_JSON=" + JSON.stringify(result));
}

function loadApplySummary(departmentRunId: string): DepartmentApplySummary | null {
  try {
    return readApplySummary(departmentRunId) ?? null;
  } catch (err) {
    console.error(`Aviso: no se pudo leer el contrato de apply de esta pasada (${err instanceof Error ? err.message : String(err)}). El email se envia sin la seccion de APPLY.`);
    return null;
  }
}

/**
 * Motivo por el que el inventario de staging vino vacio, si vino vacio.
 * Va a SALUD DEL DEPARTAMENTO: sin inventario ninguna propuesta puede ser
 * ACTIONABLE, y ese es un fallo tecnico que hay que ver, no una lista de
 * propuestas MANUAL sin causa aparente.
 */
function loadStagingInventoryUnavailableReason(departmentRunId: string): string {
  const filePath = path.join(resolveDepartmentRunPaths(departmentRunId).runDir, "staging-inventory.json");
  if (!fs.existsSync(filePath)) {
    return "Esta pasada no incluyo el paso de lectura de staging (scripts/read-staging-inventory.ts): no hay inventario con el que resolver ningun pageId.";
  }
  try {
    const inventory = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { unavailableReason?: string; pages?: unknown[] };
    if (Array.isArray(inventory.pages) && inventory.pages.length > 0) return "";
    return String(inventory.unavailableReason ?? "").trim() || "El inventario de staging de esta pasada vino vacio y sin motivo declarado.";
  } catch (err) {
    return `El inventario de staging de esta pasada no es JSON utilizable (${err instanceof Error ? err.message : String(err)}).`;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const departmentRunId = args.departmentRunId;
  if (!departmentRunId || departmentRunId === "true") {
    throw new Error("Falta --departmentRunId <id>.");
  }
  const dryRun = args["dry-run"] === "true";

  const paths = resolveDepartmentRunPaths(departmentRunId);
  if (!fs.existsSync(paths.briefJsonPath)) {
    throw new Error(`No existe el Daily Brief de la pasada "${departmentRunId}" (${toRepoRelative(paths.briefJsonPath)}). No hay nada que enviar.`);
  }
  const brief = JSON.parse(fs.readFileSync(paths.briefJsonPath, "utf-8")) as DepartmentDailyBrief;

  const cost = summarizeDepartmentRunCost(readDepartmentEmployeeRuns(departmentRunId));
  const email = buildDailyBriefEmail({
    brief,
    apply: loadApplySummary(departmentRunId),
    cost,
    runUrl: args.runUrl && args.runUrl !== "true" ? args.runUrl : "",
    stagingInventoryUnavailableReason: loadStagingInventoryUnavailableReason(departmentRunId),
  });

  const config = resolveDailyBriefEmailConfig({
    env: process.env,
    fallbackRecipientVar: resolveActiveClientConfig().notificationSettings.reportEmailToEnvVar,
  });

  // Defensa en profundidad: el correo se guarda y (en dry-run) se puede
  // volcar, asi que se comprueba que no arrastra el valor de ninguna
  // variable sensible antes de escribirlo en ningun sitio.
  const leak = containsSecretValue(`${email.subject}\n${email.text}\n${email.html}`, process.env, SENSITIVE_VARS);
  if (leak) {
    throw new Error(`Abortado antes de enviar: el correo construido contiene el valor de la variable sensible ${leak}. Esto nunca debe ocurrir -- no se envia ni se guarda nada.`);
  }

  fs.mkdirSync(paths.runDir, { recursive: true });
  fs.writeFileSync(
    paths.emailPath,
    JSON.stringify({ departmentRunId, subject: email.subject, text: email.text, html: email.html, builtAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
  console.log(`Email del Daily Brief construido y guardado en ${toRepoRelative(paths.emailPath)}.`);

  if (!config.configured) {
    console.error(config.reason);
    printResult({ departmentRunId, status: "skipped_missing_config", sent: false, missing: config.missing, subject: email.subject, emailPath: toRepoRelative(paths.emailPath) });
    return;
  }

  if (dryRun) {
    console.log(`Dry-run: NO se envia nada. Destinatario que se habria usado: resuelto desde ${config.recipientVar}.`);
    printResult({ departmentRunId, status: "dry_run", sent: false, recipientVar: config.recipientVar, subject: email.subject, emailPath: toRepoRelative(paths.emailPath) });
    return;
  }

  await sendReportEmail({ subject: email.subject, text: email.text, html: email.html }, { to: config.to, label: "Daily Brief del departamento" });
  console.log(`Daily Brief enviado por email (destinatario resuelto desde ${config.recipientVar}).`);
  printResult({
    departmentRunId,
    status: "sent",
    sent: true,
    recipientVar: config.recipientVar,
    to: config.to,
    subject: email.subject,
    emailPath: toRepoRelative(paths.emailPath),
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
