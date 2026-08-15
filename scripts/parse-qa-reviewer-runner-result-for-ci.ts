/**
 * Wrapper de CLI, pensado para .github/workflows/qa-reviewer.yml: lee un
 * fichero de log (la salida completa de `npm run qa-reviewer:run`),
 * extrae y valida la ultima linea `RUNNER_RESULT_JSON=...` y escribe cada
 * campo como un output de GitHub Actions en $GITHUB_OUTPUT.
 *
 * Copia EXACTA del patron de scripts/parse-runner-result-for-ci.ts
 * (sin modificar ese fichero -- ver docs/claude-employee-runtime.md,
 * "Puntos de conflicto"), adaptada a la forma propia de
 * QaReviewerRunnerResultSummary (src/employees/qa-reviewer/review.ts) en
 * vez de RunnerResultSummary (landing-architect).
 *
 * Fail-closed: si no hay GITHUB_OUTPUT, o el log no contiene una linea
 * RUNNER_RESULT_JSON valida, termina con codigo de salida distinto de 0 y
 * un mensaje de error explicito -- nunca escribe outputs parciales o
 * inventados.
 *
 * Uso: ts-node scripts/parse-qa-reviewer-runner-result-for-ci.ts <ruta-al-log>
 */
import * as fs from "fs";
import { extractLastRunnerResultJsonLine } from "../src/core/runner-result-parser";
import { parseQaReviewerRunnerResultJson } from "../src/employees/qa-reviewer/review";

function writeGithubOutput(entries: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    // Delimitador con sufijo aleatorio: valores como `summary`/`rationale`
    // son texto libre generado por Claude y podrian, en teoria, contener
    // una subcadena que coincida con un delimitador fijo -- un
    // delimitador impredecible por escritura evita que eso rompa el
    // parseo de GITHUB_OUTPUT.
    const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`;
    lines.push(`${key}<<${delimiter}`, value, delimiter);
  }
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf-8");
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Uso: ts-node scripts/parse-qa-reviewer-runner-result-for-ci.ts <ruta-al-log>");
  }
  const log = fs.readFileSync(logPath, "utf-8");
  const jsonText = extractLastRunnerResultJsonLine(log);
  if (jsonText === undefined) {
    throw new Error('No se encontro ninguna linea "RUNNER_RESULT_JSON=" en el log proporcionado.');
  }
  const result = parseQaReviewerRunnerResultJson(jsonText);

  writeGithubOutput({
    artifactId: result.artifactId,
    artifactType: result.artifactType,
    sourceEmployee: result.sourceEmployee,
    artifactPath: result.artifactPath,
    qaStatus: result.qaStatus,
    promptFilePath: result.promptFilePath,
    expectedOutputPath: result.expectedOutputPath,
    reviewJsonPath: result.reviewJsonPath,
    reviewMdPath: result.reviewMdPath,
    findingsCount: result.findingsCount === null ? "null" : String(result.findingsCount),
  });

  console.log(`parse-qa-reviewer-runner-result-for-ci: qaStatus=${result.qaStatus} artifactId=${result.artifactId}`);
}

main();
