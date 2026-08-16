/**
 * Agrega los diagnosticos por invocacion (`claude-runtime-health.json`)
 * de una pasada en un unico artifact de metricas de fiabilidad del
 * runtime comun.
 *
 * Uso:
 *   npm run claude-runtime:metrics-for-ci -- <health-dir> <output-json> [step-summary-title]
 *
 * Busca recursivamente cualquier fichero `*claude-runtime-health.json`
 * bajo <health-dir>. Fail-soft por diseno: si no encuentra ninguno, o
 * alguno esta corrupto, escribe las metricas con lo que haya y sale 0
 * -- no medir la fiabilidad nunca puede ser el motivo de que una pasada
 * se caiga. La autoridad sobre si un empleado fallo es el runtime, no
 * este agregador.
 */
import * as fs from "fs";
import * as path from "path";
import { ClaudeRuntimeHealthRecord } from "../src/core/claude-runtime-health";
import { aggregateClaudeRuntimeMetrics, formatMetricsSummary } from "../src/core/claude-runtime-metrics";

function findHealthFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findHealthFiles(full));
    } else if (entry.isFile() && entry.name.endsWith("claude-runtime-health.json")) {
      found.push(full);
    }
  }
  return found.sort();
}

function main(): void {
  const [healthDir, outputPath, title] = process.argv.slice(2);
  if (!healthDir || !outputPath) {
    throw new Error("Uso: claude-runtime-metrics-for-ci <health-dir> <output-json> [step-summary-title]");
  }

  const files = findHealthFiles(path.resolve(healthDir));
  const records: ClaudeRuntimeHealthRecord[] = [];
  const unreadable: string[] = [];

  for (const file of files) {
    try {
      records.push(JSON.parse(fs.readFileSync(file, "utf-8")) as ClaudeRuntimeHealthRecord);
    } catch {
      unreadable.push(file);
    }
  }

  const metrics = aggregateClaudeRuntimeMetrics(records);
  const payload = {
    generatedFrom: files.length,
    unreadable,
    employees: records.map((record) => ({
      employee: record.employee,
      attemptCount: record.attemptCount,
      retried: record.retried,
      recovered: record.recovered,
      outputSource: record.outputSource,
      validationStatus: record.validationStatus,
      failureKind: record.failureKind,
      costUsd: record.totalCostUsd,
    })),
    metrics,
  };

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(payload, null, 2), "utf-8");

  console.log(`[runtime] Metricas de fiabilidad (${files.length} invocacion/es): ${formatMetricsSummary(metrics)}`);
  if (unreadable.length > 0) {
    console.log(`[runtime] Diagnosticos ilegibles (ignorados): ${unreadable.join(", ")}`);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const rate = metrics.successRate === null ? "n/a" : `${Math.round(metrics.successRate * 10000) / 100}%`;
    const lines = [
      `### ${title ?? "Fiabilidad del Claude employee runtime"}`,
      "",
      "| Metrica | Valor |",
      "| --- | --- |",
      `| Invocaciones del runtime | ${metrics.runtimeInvocations} |`,
      `| Exito al primer intento | ${metrics.successesFirstAttempt} |`,
      `| Recuperadas por reintento | ${metrics.recoveredByRetry} |`,
      `| Fallos deterministas (fail-closed, sin reintento) | ${metrics.deterministicFailures} |`,
      `| Fallos transitorios no recuperados | ${metrics.transientFailures} |`,
      `| **Success rate** | **${rate}** |`,
      `| Intentos totales de Claude | ${metrics.totalAttempts} |`,
      `| Reintentos ejecutados | ${metrics.retriesExecuted} |`,
      `| Reintentos evitados por clasificacion | ${metrics.retriesAvoidedByClassification} |`,
      `| Coste estimado 1er intento (USD) | ${metrics.cost.firstAttemptUsd ?? "n/a"} |`,
      `| Coste estimado reintentos (USD) | ${metrics.cost.retryUsd ?? "n/a"} |`,
      `| Coste estimado total (USD) | ${metrics.cost.totalUsd ?? "n/a"} |`,
      "",
      "> Coste ESTIMADO a tarifa de lista, no una factura: con autenticacion por suscripcion no se corresponde con ningun cargo.",
      "",
    ];
    if (Object.keys(metrics.failureKindBreakdown).length > 0) {
      lines.push("Clases de fallo observadas: " + Object.entries(metrics.failureKindBreakdown).map(([kind, count]) => `\`${kind}\`×${count}`).join(", "), "");
    }
    fs.appendFileSync(summaryPath, lines.join("\n"), "utf-8");
  }
}

try {
  main();
} catch (err) {
  console.error(`[runtime] No se pudieron agregar las metricas de fiabilidad: ${err instanceof Error ? err.message : String(err)}`);
}
