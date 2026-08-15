/**
 * Wrapper de CLI, pensado para .github/workflows/seo-specialist.yml: lee
 * un fichero de log (la salida completa de `npm run seo-specialist:run`),
 * extrae y valida la ultima linea `RUNNER_RESULT_JSON=...` (ver
 * extractAndParseSeoSpecialistRunnerResult() en
 * src/employees/seo-specialist/domain.ts, TOOL puro y testeado por
 * separado) y escribe cada campo como un output de GitHub Actions en
 * $GITHUB_OUTPUT.
 *
 * Mismo patron exacto que scripts/parse-runner-result-for-ci.ts (el
 * wrapper generico del primer empleado, ux-ui-landing-architect-v2) --
 * fichero separado, sin modificar el original, porque el contrato de
 * RUNNER_RESULT_JSON de cada empleado es propio (ver
 * docs/claude-employee-runtime.md).
 *
 * Fail-closed: si no hay GITHUB_OUTPUT, o el log no contiene una linea
 * RUNNER_RESULT_JSON valida, termina con codigo de salida distinto de 0 y
 * un mensaje de error explicito -- nunca escribe outputs parciales o
 * inventados.
 *
 * Uso: ts-node scripts/parse-seo-specialist-runner-result-for-ci.ts <ruta-al-log>
 */
import * as fs from "fs";
import { extractAndParseSeoSpecialistRunnerResult } from "../src/employees/seo-specialist/domain";

function writeGithubOutput(entries: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    // Delimitador con sufijo aleatorio: mismo motivo defensivo que
    // scripts/parse-runner-result-for-ci.ts -- un valor de texto libre
    // (p.ej. una ruta) podria en teoria coincidir con un delimitador
    // fijo y romper el parseo de GITHUB_OUTPUT.
    const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`;
    lines.push(`${key}<<${delimiter}`, value, delimiter);
  }
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf-8");
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Uso: ts-node scripts/parse-seo-specialist-runner-result-for-ci.ts <ruta-al-log>");
  }
  const log = fs.readFileSync(logPath, "utf-8");
  const result = extractAndParseSeoSpecialistRunnerResult(log);

  writeGithubOutput({
    runId: result.runId,
    status: result.status,
    promptFilePath: result.promptFilePath,
    expectedOutputPath: result.expectedOutputPath,
    artifactJsonPath: result.artifactJsonPath,
    artifactMdPath: result.artifactMdPath,
    findingCount: result.findingCount === null ? "null" : String(result.findingCount),
    opportunityCount: result.opportunityCount === null ? "null" : String(result.opportunityCount),
    warningCount: result.warningCount === null ? "null" : String(result.warningCount),
  });

  console.log(`parse-seo-specialist-runner-result-for-ci: status=${result.status} runId=${result.runId}`);
}

main();
