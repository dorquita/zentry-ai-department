/**
 * Wrapper de CLI, pensado para .github/workflows/ux-ui-landing-architect-v2.yml:
 * se ejecuta SOLO cuando claude-code-action termino con subtype "success"
 * pero sin `structured_output` (ver src/core/execution-file-result-extractor.ts
 * para el detalle completo, verificado contra el codigo real del commit
 * fijado en el workflow, y docs/ux-ui-landing-architect-v2-experiment.md
 * para el run real donde se observo esto).
 *
 * Lee el execution_file que expone claude-code-action, intenta recuperar
 * deterministicamente el resultado de Claude con
 * recoverV2OutputFromExecutionFile() (TOOL puro, testeado por separado) --
 * validando el JSON recuperado contra el MISMO
 * config/landing-architect-v2-output.schema.json que exige --json-schema
 * en el camino normal (paridad de contrato caso A / caso B, ver el
 * comentario de recoverV2OutputFromExecutionFile()) -- y si tiene exito
 * escribe el texto EXACTO recuperado (sin reinterpretar) en
 * $GITHUB_OUTPUT para que el step siguiente lo escriba tal cual en
 * expectedV2OutputPath -- exactamente el mismo patron que ya usa
 * structured_output en el camino normal.
 *
 * Fail-closed: si no hay nada recuperable, termina con codigo != 0 y un
 * mensaje explicito (nunca escribe un output vacio o inventado).
 *
 * Uso: ts-node scripts/recover-v2-output-from-execution-file-for-ci.ts <ruta-al-execution_file>
 */
import * as fs from "fs";
import * as path from "path";
import { recoverV2OutputFromExecutionFile } from "../src/core/execution-file-result-extractor";
import { JsonSchemaLite } from "../src/core/json-schema-lite";

function main(): void {
  const executionFilePath = process.argv[2];
  if (!executionFilePath) {
    throw new Error("Uso: ts-node scripts/recover-v2-output-from-execution-file-for-ci.ts <ruta-al-execution_file>");
  }
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }

  const schemaPath = path.join(__dirname, "..", "config", "landing-architect-v2-output.schema.json");
  const outputSchema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as JsonSchemaLite;

  const raw = fs.readFileSync(executionFilePath, "utf-8");
  const recovered = recoverV2OutputFromExecutionFile(raw, outputSchema);

  const delimiter = `RECOVERED_EOF_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(outputPath, `recoveredText<<${delimiter}\n${recovered.rawResultText}\n${delimiter}\n`, "utf-8");

  console.log(`recover-v2-output-from-execution-file-for-ci: resultado recuperado y validado (hero.headline="${recovered.output.hero.headline}").`);
}

main();
