/**
 * Wrapper de CLI, pensado para .github/workflows/growth-director-v2.yml:
 * lee un fichero de log (la salida completa de `npm run
 * growth-director-v2:run`), extrae y valida la ultima linea
 * `RUNNER_RESULT_JSON=...` (ver
 * src/employees/growth-director-v2/runner-result-parser.ts, TOOL puro y
 * testeado por separado) y escribe cada campo como un output de GitHub
 * Actions en $GITHUB_OUTPUT.
 *
 * Copia EXACTA del patron de scripts/parse-runner-result-for-ci.ts
 * (el wrapper generico de ux-ui-landing-architect-v2) -- ese fichero no
 * se modifica, este es su equivalente propio para growth-director-v2.
 *
 * Fail-closed: si no hay GITHUB_OUTPUT, o el log no contiene una linea
 * RUNNER_RESULT_JSON valida, termina con codigo de salida distinto de 0
 * y un mensaje de error explicito -- nunca escribe outputs parciales o
 * inventados.
 *
 * Uso: ts-node scripts/parse-growth-director-v2-runner-result-for-ci.ts <ruta-al-log>
 */
import * as fs from "fs";
import { extractAndParseRunnerResult } from "../src/employees/growth-director-v2/runner-result-parser";

function writeGithubOutput(entries: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    // Delimitador con sufijo aleatorio: mismo motivo que el wrapper
    // generico -- evita que un valor de texto libre (p.ej. el prompt de
    // un growthSummary) rompa el parseo de GITHUB_OUTPUT.
    const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`;
    lines.push(`${key}<<${delimiter}`, value, delimiter);
  }
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf-8");
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Uso: ts-node scripts/parse-growth-director-v2-runner-result-for-ci.ts <ruta-al-log>");
  }
  const log = fs.readFileSync(logPath, "utf-8");
  const result = extractAndParseRunnerResult(log);

  writeGithubOutput({
    departmentRunId: result.departmentRunId,
    status: result.status,
    promptFilePath: result.promptFilePath,
    expectedOutputPath: result.expectedOutputPath,
    artifactJsonPath: result.artifactJsonPath,
    artifactMdPath: result.artifactMdPath,
    auditWarningCount: result.auditWarningCount === null ? "null" : String(result.auditWarningCount),
  });

  console.log(`parse-growth-director-v2-runner-result-for-ci: status=${result.status} departmentRunId=${result.departmentRunId}`);
}

main();
