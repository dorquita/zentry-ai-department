/**
 * Preflight GENERICO del Claude Employee Runtime (ver
 * .github/actions/claude-employee-runtime/action.yml y
 * docs/claude-employee-runtime.md): antes de invocar a Claude para
 * CUALQUIER empleado, verifica deterministicamente que su JSON Schema de
 * salida solo usa keywords que src/core/json-schema-lite.ts sabe
 * validar -- reutiliza assertJsonSchemaLiteSupported(), no duplica su
 * logica. Evita gastar inferencia con un schema que este runtime no
 * podria validar con la misma paridad en caso A (--json-schema) que en
 * caso B (fallback via execution_file).
 *
 * Uso: ts-node scripts/assert-json-schema-lite-compatible-for-ci.ts <schema-path>
 */
import * as fs from "fs";
import { assertJsonSchemaLiteSupported } from "../src/core/json-schema-lite";

function main(): void {
  const schemaPath = process.argv[2];
  if (!schemaPath) {
    console.error("Uso: ts-node scripts/assert-json-schema-lite-compatible-for-ci.ts <schema-path>");
    process.exit(1);
  }

  const raw = fs.readFileSync(schemaPath, "utf-8");
  const schema = JSON.parse(raw) as unknown;

  try {
    assertJsonSchemaLiteSupported(schema);
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`OK: "${schemaPath}" solo usa keywords de JSON Schema soportadas por src/core/json-schema-lite.ts -- paridad garantizada entre caso A y caso B.`);
}

main();
