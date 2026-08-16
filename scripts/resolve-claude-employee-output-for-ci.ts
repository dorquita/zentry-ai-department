/**
 * Wrapper de CLI GENERICO (sin conocimiento de ningun dominio de
 * negocio), pensado para `.github/actions/claude-employee-runtime/action.yml`
 * -- ver docs/claude-employee-runtime.md.
 *
 * Dado lo que devolvio `claude-code-action` (structured_output, que
 * puede venir vacio) y, opcionalmente, la ruta de su `execution_file`,
 * resuelve el caso A/B/C con `resolveClaudeEmployeeOutput()`
 * (src/core/claude-employee-runtime.ts, TOOL puro, testeado por
 * separado) y escribe el texto EXACTO recuperado (sin reinterpretar)
 * directamente en el fichero de salida esperado por el empleado --
 * nunca via shell/printf, siempre con fs.writeFileSync, para no
 * interpolar contenido generado por el modelo en ningun comando.
 *
 * Fail-closed: si no hay nada recuperable, o el JSON no cumple el
 * schema, termina con codigo != 0 y un mensaje explicito, y NO escribe
 * el fichero de salida (nunca un fichero vacio o parcial).
 *
 * Uso:
 *   ts-node scripts/resolve-claude-employee-output-for-ci.ts \
 *     <output-schema-path> <expected-output-path> [execution-file-path]
 *
 * Env:
 *   CLAUDE_STRUCTURED_OUTPUT -- opcional, el output structured_output de claude-code-action
 */
import * as fs from "fs";
import * as path from "path";
import { buildClaudeEmployeeOutputDiagnostics, describeClaudeEmployeeFailureKind, resolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { JsonSchemaLite } from "../src/core/json-schema-lite";

/**
 * Imprime el diagnostico estructural de ESTA invocacion (ver
 * buildClaudeEmployeeOutputDiagnostics en
 * src/core/claude-employee-runtime.ts) y lo guarda junto a la salida
 * esperada, tanto si la resolucion fue bien como si fallo. Sin este
 * bloque, un fallo del runtime solo dejaba rastro como
 * "runtime=failure / claude=failure", que no distingue "Claude no
 * respondio" de "Claude respondio pero el JSON no cumple el schema".
 *
 * No imprime ni el prompt ni la respuesta del modelo: solo metadatos
 * (tamanos, hashes truncados, tipos de mensaje, longitudes, errores de
 * parseo/schema).
 */
function reportDiagnostics(params: { structuredOutput: string | undefined; executionFileContent: string | undefined; outputSchema: JsonSchemaLite; executionFilePath: string | undefined; expectedOutputPath: string }): void {
  const diagnostics = buildClaudeEmployeeOutputDiagnostics({
    structuredOutput: params.structuredOutput,
    executionFileContent: params.executionFileContent,
    outputSchema: params.outputSchema,
  });

  console.log("===== DIAGNOSTICO DEL RUNTIME COMUN (sin contenido: solo tamanos, hashes y presencia de campos) =====");
  console.log(`clasificacion: ${diagnostics.failureKind} -- ${describeClaudeEmployeeFailureKind(diagnostics.failureKind)}`);
  console.log(`execution_file (ruta publicada por la Action): ${params.executionFilePath || "(ninguna)"}`);
  console.log("CLAUDE_EMPLOYEE_RUNTIME_DIAGNOSTICS=" + JSON.stringify(diagnostics));

  try {
    const diagnosticsPath = path.join(path.dirname(params.expectedOutputPath), "runtime-diagnostics.json");
    fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf-8");
    console.log(`diagnostico guardado en ${diagnosticsPath}.`);
  } catch (err) {
    // Fail-soft a proposito: no poder guardar el diagnostico nunca puede
    // convertirse en el motivo de que una pasada falle.
    console.log(`aviso: no se pudo guardar el fichero de diagnostico (${err instanceof Error ? err.message : String(err)}).`);
  }
}

function main(): void {
  const outputSchemaPath = process.argv[2];
  const expectedOutputPath = process.argv[3];
  const executionFilePath = process.argv[4];

  if (!outputSchemaPath || !expectedOutputPath) {
    throw new Error("Uso: ts-node scripts/resolve-claude-employee-output-for-ci.ts <output-schema-path> <expected-output-path> [execution-file-path]");
  }

  const outputSchema = JSON.parse(fs.readFileSync(outputSchemaPath, "utf-8")) as JsonSchemaLite;
  const structuredOutput = process.env.CLAUDE_STRUCTURED_OUTPUT;
  const executionFileContent = executionFilePath && fs.existsSync(executionFilePath) ? fs.readFileSync(executionFilePath, "utf-8") : undefined;

  reportDiagnostics({ structuredOutput, executionFileContent, outputSchema, executionFilePath, expectedOutputPath });

  const resolved = resolveClaudeEmployeeOutput({ structuredOutput, executionFileContent, outputSchema });

  fs.writeFileSync(expectedOutputPath, resolved.rawText, "utf-8");

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `source=${resolved.source}\n`, "utf-8");
  }

  console.log(`resolve-claude-employee-output-for-ci: salida resuelta desde "${resolved.source}" y escrita en ${expectedOutputPath}.`);
}

main();
