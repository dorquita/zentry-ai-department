/**
 * Wrapper de CI del runtime comun: guarda las METRICAS de UNA invocacion
 * de Claude en una ruta propia de esa invocacion.
 *
 * Uso (desde .github/actions/claude-employee-runtime/action.yml):
 *
 *   npm run claude-employee:record-execution-for-ci -- \
 *     <agentName> <recordPath> [executionFilePath] [outputSource] [claudeOutcome]
 *
 * Nunca falla: si no hay execution_file, o no es parseable, escribe el
 * registro igualmente con las metricas a `null` y una nota explicando por
 * que. Perder el diagnostico de coste no puede tumbar la pasada de un
 * empleado ni la del departamento.
 *
 * NO copia la conversacion: solo empleado/modelo/duracion/coste/turnos/
 * origen de salida/resultado.
 */
import * as fs from "fs";
import * as path from "path";
import { buildClaudeEmployeeExecutionRecord } from "../src/core/claude-employee-execution-record";

function readIfExists(filePath: string | undefined): string | undefined {
  if (!filePath || filePath.trim().length === 0) return undefined;
  const resolved = path.resolve(filePath.trim());
  if (!fs.existsSync(resolved)) return undefined;
  try {
    return fs.readFileSync(resolved, "utf-8");
  } catch {
    return undefined;
  }
}

function main(): void {
  const [agentName, recordPath, executionFilePath, outputSource, claudeOutcome] = process.argv.slice(2);
  if (!agentName || !recordPath) {
    throw new Error("Uso: record-claude-employee-execution-for-ci <agentName> <recordPath> [executionFilePath] [outputSource] [claudeOutcome]");
  }

  const record = buildClaudeEmployeeExecutionRecord({
    employee: agentName,
    executionFileContent: readIfExists(executionFilePath),
    outputSource,
    claudeOutcome,
  });

  const resolved = path.resolve(recordPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(record, null, 2), "utf-8");

  console.log(
    `[runtime] Registro de ejecucion de ${record.employee}: modelo=${record.model ?? "(desconocido)"}, coste=${record.costUsd ?? "(no reportado)"}, turnos=${record.numTurns ?? "(no reportado)"}, duracion_ms=${record.durationMs ?? "(no reportada)"}, origen=${record.outputSource}, resultado=${record.outcome}.${record.note ? ` ${record.note}` : ""}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    // Fail-soft DELIBERADO y acotado a este wrapper: es puro
    // diagnostico. Se reporta en el log y se sale con 0 para no tumbar
    // el step del runtime por no haber podido medir el coste.
    console.error(`[runtime] No se pudo escribir el registro de ejecucion: ${err instanceof Error ? err.message : String(err)}`);
  }
}
