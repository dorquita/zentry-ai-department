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
import { resolveClaudeEmployeeOutput } from "../src/core/claude-employee-runtime";
import { JsonSchemaLite } from "../src/core/json-schema-lite";

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

  const resolved = resolveClaudeEmployeeOutput({ structuredOutput, executionFileContent, outputSchema });

  fs.writeFileSync(expectedOutputPath, resolved.rawText, "utf-8");

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `source=${resolved.source}\n`, "utf-8");
  }

  console.log(`resolve-claude-employee-output-for-ci: salida resuelta desde "${resolved.source}" y escrita en ${expectedOutputPath}.`);
}

main();
