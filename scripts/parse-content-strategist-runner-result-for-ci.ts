/**
 * Wrapper de CLI, pensado para .github/workflows/content-strategist.yml:
 * lee un fichero de log (la salida completa de `npm run
 * content-strategist:run`), extrae y valida la ultima linea
 * `RUNNER_RESULT_JSON=...` (ver
 * src/employees/content-strategist/runner-result.ts, TOOL puro y
 * testeado por separado) y escribe cada campo como un output de GitHub
 * Actions en $GITHUB_OUTPUT.
 *
 * Copia deliberada del patron de scripts/parse-runner-result-for-ci.ts
 * (el wrapper de ux-ui-landing-architect-v2) -- sin modificar el
 * original, ver docs/claude-employee-runtime.md.
 *
 * Fail-closed: si no hay GITHUB_OUTPUT, o el log no contiene una linea
 * RUNNER_RESULT_JSON valida, termina con codigo de salida distinto de 0
 * y un mensaje de error explicito -- nunca escribe outputs parciales o
 * inventados.
 *
 * Uso: ts-node scripts/parse-content-strategist-runner-result-for-ci.ts <ruta-al-log>
 */
import * as fs from "fs";
import { extractAndParseRunnerResult } from "../src/employees/content-strategist/runner-result";

function writeGithubOutput(entries: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    // Delimitador con sufijo aleatorio: valores como `keyword` son texto
    // libre del negocio (change pack) y podrian, en teoria, contener una
    // subcadena que coincida con un delimitador fijo -- un delimitador
    // impredecible por escritura evita que eso rompa el parseo de
    // GITHUB_OUTPUT, aunque el propio valor no sea contenido de confianza
    // externa (viene de nuestros change packs, no de un PR/issue).
    const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`;
    lines.push(`${key}<<${delimiter}`, value, delimiter);
  }
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf-8");
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Uso: ts-node scripts/parse-content-strategist-runner-result-for-ci.ts <ruta-al-log>");
  }
  const log = fs.readFileSync(logPath, "utf-8");
  const result = extractAndParseRunnerResult(log);

  writeGithubOutput({
    status: result.status,
    changePackId: result.changePackId,
    keyword: result.keyword,
    promptFilePath: result.promptFilePath,
    expectedOutputPath: result.expectedOutputPath,
    artifactJsonPath: result.artifactJsonPath,
    artifactMdPath: result.artifactMdPath,
    auditWarningCount: result.auditWarningCount === null ? "null" : String(result.auditWarningCount),
  });

  console.log(`parse-content-strategist-runner-result-for-ci: status=${result.status} changePackId=${result.changePackId || "(ninguno)"}`);
}

main();
