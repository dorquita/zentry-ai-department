/**
 * Wrapper de CLI, pensado para .github/workflows/analytics-specialist.yml
 * -- mismo patron EXACTO que scripts/parse-runner-result-for-ci.ts (sin
 * modificar ese fichero, ver docs/claude-employee-runtime.md): lee un
 * fichero de log (la salida completa de `npm run analytics-specialist:run`),
 * extrae y valida la ultima linea `RUNNER_RESULT_JSON=...` (ver
 * src/employees/analytics-specialist/runner-result.ts, TOOL puro) y
 * escribe cada campo como un output de GitHub Actions en $GITHUB_OUTPUT.
 *
 * Fail-closed: si no hay GITHUB_OUTPUT, o el log no contiene una linea
 * RUNNER_RESULT_JSON valida, termina con codigo de salida distinto de 0 y
 * un mensaje de error explicito -- nunca escribe outputs parciales o
 * inventados.
 *
 * Uso: ts-node scripts/parse-analytics-specialist-runner-result-for-ci.ts <ruta-al-log>
 */
import * as fs from "fs";
import { extractAndParseAnalyticsSpecialistRunnerResult } from "../src/employees/analytics-specialist/runner-result";

function writeGithubOutput(entries: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    // Delimitador con sufijo aleatorio -- mismo motivo que
    // scripts/parse-runner-result-for-ci.ts: evita que un valor de texto
    // libre rompa el parseo de GITHUB_OUTPUT.
    const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`;
    lines.push(`${key}<<${delimiter}`, value, delimiter);
  }
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf-8");
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Uso: ts-node scripts/parse-analytics-specialist-runner-result-for-ci.ts <ruta-al-log>");
  }
  const log = fs.readFileSync(logPath, "utf-8");
  const result = extractAndParseAnalyticsSpecialistRunnerResult(log);

  writeGithubOutput({
    status: result.status,
    departmentRunId: result.departmentRunId ?? "",
    reason: result.reason ?? "",
    promptFilePath: result.promptFilePath ?? "",
    expectedOutputPath: result.expectedOutputPath ?? "",
    artifactJsonPath: result.artifactJsonPath ?? "",
    artifactMdPath: result.artifactMdPath ?? "",
    auditWarningCount: result.auditWarningCount === null ? "null" : String(result.auditWarningCount),
  });

  console.log(`parse-analytics-specialist-runner-result-for-ci: status=${result.status} departmentRunId=${result.departmentRunId ?? "(none)"}`);
}

main();
