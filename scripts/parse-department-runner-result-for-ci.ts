/**
 * Wrapper de CLI para .github/workflows/zentry-ai-department-daily.yml --
 * mismo patron EXACTO que scripts/parse-runner-result-for-ci.ts y sus
 * equivalentes por empleado (sin modificar ninguno de ellos): lee un
 * fichero de log (la salida completa de una fase de
 * `npm run department:run`), extrae y valida la ultima linea
 * `RUNNER_RESULT_JSON=...` (ver src/department/runner-result.ts, TOOL
 * puro) y escribe cada campo como output de GitHub Actions en
 * $GITHUB_OUTPUT.
 *
 * Fail-closed: si no hay GITHUB_OUTPUT, o el log no contiene una linea
 * RUNNER_RESULT_JSON valida, termina con codigo distinto de 0 y un
 * mensaje explicito -- nunca escribe outputs parciales o inventados.
 *
 * Uso: ts-node scripts/parse-department-runner-result-for-ci.ts <ruta-al-log>
 */
import * as fs from "fs";
import { DEPARTMENT_RUNNER_RESULT_FIELDS, extractAndParseDepartmentRunnerResult } from "../src/department/runner-result";

function writeGithubOutput(entries: Record<string, string>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    // Delimitador con sufijo aleatorio -- mismo motivo que en los demas
    // parsers: evita que un valor de texto libre (p.ej. `reason`) rompa
    // el parseo de GITHUB_OUTPUT.
    const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`;
    lines.push(`${key}<<${delimiter}`, value, delimiter);
  }
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf-8");
}

function main(): void {
  const logPath = process.argv[2];
  if (!logPath) {
    throw new Error("Uso: ts-node scripts/parse-department-runner-result-for-ci.ts <ruta-al-log>");
  }
  const result = extractAndParseDepartmentRunnerResult(fs.readFileSync(logPath, "utf-8"));

  // Se recorre el contrato ENTERO, no una lista escrita a mano.
  //
  // La lista a mano fue exactamente el fallo: cuando el contrato crecio
  // con `correctionRequired`, la lista no crecio, y el bucle de
  // correccion del workflow -- que depende de ese output -- quedo muerto
  // en silencio. El departamento decidia pedir la correccion y nadie se
  // enteraba.
  const entries: Record<string, string> = {};
  for (const field of DEPARTMENT_RUNNER_RESULT_FIELDS) {
    entries[field] = String(result[field]);
  }
  writeGithubOutput(entries);

  console.log(`parse-department-runner-result-for-ci: phase=${result.phase} status=${result.status} departmentRunId=${result.departmentRunId} claudeRequired=${String(result.claudeRequired)}`);
}

main();
