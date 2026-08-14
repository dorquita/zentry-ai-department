/**
 * Wrapper de CLI, pensado para .github/workflows/ux-ui-landing-architect-v2.yml:
 * lee el comparison.json ya escrito por el paso 2 del runner
 * (scripts/run-landing-architect-comparison.ts, sin modificar), extrae
 * los avisos de fabricacion REALES con
 * extractFabricationWarnings() (src/core/comparison-artifact-reader.ts,
 * TOOL puro y testeado por separado) y los anade tal cual a
 * $GITHUB_STEP_SUMMARY -- nunca se los resume ni reinterpreta Claude.
 *
 * Si no hay avisos (array vacio), no escribe nada y termina en 0 sin
 * romper el workflow -- ver el test "no escribe nada si no hay warnings"
 * en test/comparison-artifact-reader.test.ts.
 *
 * Uso: ts-node scripts/print-fabrication-warnings-for-ci.ts <comparison.json>
 */
import * as fs from "fs";
import { extractFabricationWarnings } from "../src/core/comparison-artifact-reader";

function main(): void {
  const comparisonJsonPath = process.argv[2];
  if (!comparisonJsonPath) {
    throw new Error("Uso: ts-node scripts/print-fabrication-warnings-for-ci.ts <ruta-a-comparison.json>");
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    throw new Error("GITHUB_STEP_SUMMARY no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }

  const raw = JSON.parse(fs.readFileSync(comparisonJsonPath, "utf-8"));
  const warnings = extractFabricationWarnings(raw);

  if (warnings.length === 0) {
    console.log("print-fabrication-warnings-for-ci: 0 fabricationWarnings, no se escribe nada en el Step Summary.");
    return;
  }

  const lines: string[] = ["", `> ⚠️ **${warnings.length} aviso(s) de posible fabricacion de datos** (leidos tal cual de comparison.json, sin reinterpretar):`, ">"];
  for (const warning of warnings) {
    lines.push(`> - ${warning}`);
  }
  lines.push("");

  fs.appendFileSync(summaryPath, lines.join("\n") + "\n", "utf-8");
  console.log(`print-fabrication-warnings-for-ci: ${warnings.length} warning(s) escritos en el Step Summary.`);
}

main();
