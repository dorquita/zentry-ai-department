/**
 * Ejecucion diaria del SEO Watcher Agent + email resumen. SOLO LECTURA de
 * Search Console, SOLO genera jobs/informe/log, SOLO envia un email de
 * resumen. No toca WordPress, Google Ads, GA4, GTM, n8n ni qdrant. No
 * ejecuta ningun cambio SEO real.
 *
 * Uso: npm run seo:daily
 * Pensado para ser invocado por el timer de systemd
 * (infrastructure/systemd/zentry-seo-watcher.timer), pero es identico
 * ejecutarlo a mano.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { runSeoWatcher, SeoWatcherRunResult } from "../src/agents/seo-watcher";
import { ActionItem, buildActionPlan, writeDirectorReport } from "../src/agents/seo-director";
import { resolveDataSource } from "../src/adapters";
import { sendReportEmail, EmailContent } from "../src/core/mailer";
import { logger } from "../src/core/logger";
import { SeoJob } from "../src/core/types";

const REPORTS_DIR = path.join(__dirname, "..", "reports", "seo");

/**
 * El informe diario por email debe basarse SIEMPRE en datos reales de
 * Search Console, nunca en el mock. Falla claro y pronto si no lo esta.
 */
function assertRealDataSource(): void {
  const dataSource = resolveDataSource();
  if (dataSource !== "search_console") {
    throw new Error(
      `El informe diario por email requiere SEO_DATA_SOURCE=search_console (valor actual: "${dataSource}"). Ajusta .env antes de ejecutar npm run seo:daily.`
    );
  }
}

/**
 * Verificacion independiente (no se fia solo del reportPath que devuelve
 * runSeoWatcher): escanea reports/seo/ y detecta el fichero .md mas
 * reciente. Es el que se referencia en el email.
 */
function findLatestReportPath(): string {
  if (!fs.existsSync(REPORTS_DIR)) {
    throw new Error(`No existe ${REPORTS_DIR}. El SEO Watcher deberia haberlo creado.`);
  }
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      name: f,
      mtimeMs: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error(`No se encontro ningun informe (.md) en ${REPORTS_DIR} tras ejecutar el SEO Watcher.`);
  }
  return path.join(REPORTS_DIR, files[0].name);
}

function priorityRank(priority: string): number {
  return priority === "high" ? 3 : priority === "medium" ? 2 : 1;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDirectorSection(items: ActionItem[], directorReportPath: string): string {
  const top3 = items.slice(0, 3);
  if (top3.length === 0) {
    return "Que haria ahora (SEO Director): sin acciones prioritarias esta vez.";
  }
  const cards = top3.map((item, i) =>
    [
      `${i + 1}. [${item.priority}] "${item.keyword}" — ${item.page}`,
      `   Accion: ${item.action}`,
      `   Esfuerzo: ${item.effort} | Impacto: ${item.impact} | WordPress: ${
        item.requiresWordPress ? "si" : "no"
      } | Contenido nuevo: ${item.requiresNewContent ? "si" : "no"}`,
    ].join("\n")
  );
  return [
    "Que haria ahora (SEO Director) — top 3:",
    "",
    cards.join("\n\n"),
    "",
    `Plan completo: ${directorReportPath}`,
  ].join("\n");
}

function buildEmailContent(
  result: SeoWatcherRunResult,
  latestReportPath: string,
  directorItems: ActionItem[],
  directorReportPath: string
): EmailContent {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const highCount = result.jobs.filter((j) => j.opportunity.priority === "high").length;
  const mediumCount = result.jobs.filter((j) => j.opportunity.priority === "medium").length;
  const lowCount = result.jobs.filter((j) => j.opportunity.priority === "low").length;

  const subject = `SEO Watcher — ${dateLabel}: ${result.jobs.length} oportunidad(es) (${highCount} prioridad alta)`;

  const top5: SeoJob[] = [...result.jobs]
    .sort((a, b) => {
      const rankDiff = priorityRank(b.opportunity.priority) - priorityRank(a.opportunity.priority);
      if (rankDiff !== 0) return rankDiff;
      return b.opportunity.evidence.impressions - a.opportunity.evidence.impressions;
    })
    .slice(0, 5);

  const topLines =
    top5.length > 0
      ? top5.map((job, i) => `${i + 1}. [${job.opportunity.priority}] ${job.title}`).join("\n")
      : "(ninguna oportunidad detectada en esta ejecucion)";

  const textLines = [
    "Resumen diario del SEO Watcher Agent — Zentry/Tukandado",
    "",
    `runId: ${result.runId}`,
    `Filas de Search Console leidas: ${result.rowsRead}`,
    `Oportunidades detectadas: ${result.jobs.length} (${highCount} alta, ${mediumCount} media, ${lowCount} baja)`,
    "",
    "Top oportunidades:",
    topLines,
    "",
    `Informe completo (en el servidor): ${latestReportPath}`,
    `Tareas propuestas (jsonl): data/jobs.jsonl`,
    "",
    buildDirectorSection(directorItems, directorReportPath),
    "",
    "Este agente solo lee Google Search Console y propone tareas. No ha",
    "modificado WordPress, Google Ads, GA4, GTM ni n8n. Ninguna tarea se",
    "ejecuta sola: todas requieren revision y aprobacion humana.",
  ];
  const text = textLines.join("\n");
  const html = `<pre style="font-family: monospace; white-space: pre-wrap; font-size: 13px;">${escapeHtml(
    text
  )}</pre>`;

  return { subject, text, html };
}

async function main(): Promise<void> {
  assertRealDataSource();

  logger.info("Informe diario SEO Watcher: inicio");

  const result = await runSeoWatcher();
  const latestReportPath = findLatestReportPath();

  if (latestReportPath !== result.reportPath) {
    logger.warn("El informe mas reciente detectado no coincide con el reportPath devuelto por el agente", {
      latestReportPath,
      resultReportPath: result.reportPath,
    });
  }

  // SEO Director: agrupa las oportunidades de ESTA misma ejecucion (en
  // memoria, sin releer jobs.jsonl) en un plan de accion priorizado.
  const directorItems = buildActionPlan(result.jobs);
  const directorReportPath = writeDirectorReport({
    generatedAt: new Date().toISOString(),
    sourceRunId: result.runId,
    sourceReportPath: latestReportPath,
    items: directorItems,
  });

  const emailContent = buildEmailContent(result, latestReportPath, directorItems, directorReportPath);
  await sendReportEmail(emailContent);

  logger.info("Informe diario SEO Watcher: email enviado correctamente", {
    runId: result.runId,
    jobsCreados: result.jobs.length,
    filasLeidas: result.rowsRead,
    informe: latestReportPath,
    planDirector: directorReportPath,
  });

  console.log(
    `Informe diario enviado. runId=${result.runId} oportunidades=${result.jobs.length} filas=${result.rowsRead}`
  );
  console.log(`Informe SEO Watcher: ${latestReportPath}`);
  console.log(`Plan SEO Director: ${directorReportPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Informe diario SEO Watcher fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
