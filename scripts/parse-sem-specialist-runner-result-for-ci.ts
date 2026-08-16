/**
 * Wrapper de CLI, pensado para .github/workflows/sem-specialist.yml: lee
 * un fichero de log (la salida completa de `npm run sem-specialist:run`),
 * extrae y valida la ultima linea `RUNNER_RESULT_JSON=...` (ver
 * src/employees/sem-specialist/sem-specialist-runner-result-parser.ts,
 * TOOL puro y testeado por separado) y escribe cada campo como un output
 * de GitHub Actions en $GITHUB_OUTPUT.
 *
 * Mismo patron EXACTO que scripts/parse-runner-result-for-ci.ts (el
 * wrapper original de ux-ui-landing-architect-v2), copiado a este fichero
 * nuevo porque los campos de RUNNER_RESULT_JSON son distintos por diseno
 * (cada empleado define su propio contrato) -- el original NO se ha
 * modificado.
 *
 * Fail-closed: si no hay GITHUB_OUTPUT, o el log no contiene una linea
 * RUNNER_RESULT_JSON valida, termina con codigo de salida distinto de 0 y
 * un mensaje de error explicito -- nunca escribe outputs parciales o
 * inventados.
 *
 * Uso: ts-node scripts/parse-sem-specialist-runner-result-for-ci.ts <ruta-al-log>
 */
import * as fs from "fs";
import { extractAndParseSemRunnerResult } from "../src/employees/sem-specialist/sem-specialist-runner-result-parser";

function writeGithubOutput(entries: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    // Delimitador con sufijo aleatorio: mismo motivo que el wrapper
    // original -- evita que un valor de texto libre coincida por
    // casualidad con un delimitador fijo.
    const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`;
    lines.push(`${key}<<${delimiter}`, value, delimiter);
  }
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf-8");
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Uso: ts-node scripts/parse-sem-specialist-runner-result-for-ci.ts <ruta-al-log>");
  }
  const log = fs.readFileSync(logPath, "utf-8");
  const result = extractAndParseSemRunnerResult(log);

  writeGithubOutput({
    status: result.status,
    sourceEventId: result.sourceEventId,
    sourceDepartmentRunId: result.sourceDepartmentRunId,
    promptFilePath: result.promptFilePath,
    expectedOutputPath: result.expectedOutputPath,
    artifactJsonPath: result.artifactJsonPath,
    artifactMdPath: result.artifactMdPath,
    unsupportedClaimCount: result.unsupportedClaimCount === null ? "null" : String(result.unsupportedClaimCount),
    uncitedClaimCount: result.uncitedClaimCount === null || result.uncitedClaimCount === undefined ? "null" : String(result.uncitedClaimCount),
    unsupportedClaims: Array.isArray(result.unsupportedClaims) ? result.unsupportedClaims.join(" || ") : "",
  });

  console.log(`parse-sem-specialist-runner-result-for-ci: status=${result.status} sourceEventId=${result.sourceEventId || "(none)"}`);
}

main();
