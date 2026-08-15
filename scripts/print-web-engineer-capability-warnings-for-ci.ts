/**
 * Wrapper de CLI, pensado para .github/workflows/web-engineer.yml: lee el
 * spec.json ya escrito por el paso 2 del runner
 * (scripts/run-web-engineer.ts), extrae los avisos de capacidad tecnica
 * no confirmada REALES con extractCapabilityAuditWarnings()
 * (src/employees/web-engineer/spec-artifact-reader.ts, TOOL puro y
 * testeado por separado) y los anade tal cual a $GITHUB_STEP_SUMMARY --
 * nunca se los resume ni reinterpreta Claude. Copia deliberada del
 * patron de scripts/print-fabrication-warnings-for-ci.ts (fichero
 * compartido, sin modificar).
 *
 * Si no hay avisos (array vacio), no escribe nada y termina en 0 sin
 * romper el workflow.
 *
 * Uso: ts-node scripts/print-web-engineer-capability-warnings-for-ci.ts <spec.json>
 */
import * as fs from "fs";
import { extractCapabilityAuditWarnings } from "../src/employees/web-engineer/spec-artifact-reader";

function main(): void {
  const specJsonPath = process.argv[2];
  if (!specJsonPath) {
    throw new Error("Uso: ts-node scripts/print-web-engineer-capability-warnings-for-ci.ts <ruta-a-spec.json>");
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    throw new Error("GITHUB_STEP_SUMMARY no esta definido -- este script solo esta pensado para ejecutarse dentro de un step de GitHub Actions.");
  }

  const raw = JSON.parse(fs.readFileSync(specJsonPath, "utf-8"));
  const warnings = extractCapabilityAuditWarnings(raw);

  if (warnings.length === 0) {
    console.log("print-web-engineer-capability-warnings-for-ci: 0 capabilityAuditWarnings, no se escribe nada en el Step Summary.");
    return;
  }

  const lines: string[] = ["", `> ⚠️ **${warnings.length} aviso(s) de capacidad tecnica no confirmada** (leidos tal cual de spec.json, sin reinterpretar):`, ">"];
  for (const warning of warnings) {
    lines.push(`> - ${warning}`);
  }
  lines.push("");

  fs.appendFileSync(summaryPath, lines.join("\n") + "\n", "utf-8");
  console.log(`print-web-engineer-capability-warnings-for-ci: ${warnings.length} warning(s) escritos en el Step Summary.`);
}

main();
