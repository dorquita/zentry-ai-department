import * as fs from "fs";
import * as path from "path";
import { emitEvent } from "../core/department-events";
import { buildDepartmentRunId } from "../core/department-run-id";
import { logger } from "../core/logger";
import { hasGa4Credentials, getGa4Snapshot, Ga4Snapshot } from "../adapters/ga4";
import { hasGtmCredentials, getGtmSnapshot, GtmSnapshot } from "../adapters/gtm";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * Analytics Watcher Agent — READ + PROPOSE only. NUNCA modifica GA4 ni
 * GTM (no crea key events, no publica contenedores, no toca tags/
 * triggers/variables). Fase O11: si hay credenciales en `.env`, lee GA4
 * y GTM REALES por separado (ver `src/adapters/ga4.ts` y
 * `src/adapters/gtm.ts`); si faltan, o si la lectura de cualquiera de
 * los dos falla, cae de forma segura al placeholder documentado en
 * `config/analytics-key-events.json` para ese sistema — nunca lanza una
 * excepcion que interrumpa el pase diario, y un fallo en GA4 no bloquea
 * la lectura de GTM (ni viceversa).
 */

const CONFIG_DIR = path.join(__dirname, "..", "..", "config");
const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "analytics");
const AGENT_NAME = "analytics-watcher";

interface KeyEvent {
  name: string;
  description: string;
  validation: string;
}

function loadKeyEvents(): KeyEvent[] {
  const raw = fs.readFileSync(path.join(CONFIG_DIR, "analytics-key-events.json"), "utf-8");
  return (JSON.parse(raw) as { keyEvents: KeyEvent[] }).keyEvents;
}

export interface AnalyticsWatcherRunResult {
  departmentRunId: string;
  ga4Connected: boolean;
  gtmConnected: boolean;
  keyEvents: KeyEvent[];
  warnings: string[];
  reportPath: string;
  ga4Snapshot?: Ga4Snapshot;
  gtmSnapshot?: GtmSnapshot;
}

function buildReportMarkdown(result: AnalyticsWatcherRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Analytics Watcher — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **GA4 conectado:** ${result.ga4Connected ? "si" : "no"}`);
  lines.push(`- **GTM conectado:** ${result.gtmConnected ? "si" : "no"}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  if (!result.ga4Connected && !result.gtmConnected) {
    lines.push(
      "No hay credenciales de GA4 ni GTM configuradas en este proyecto (o la lectura real fallo, ver Warnings). Este informe documenta los eventos clave esperados y propone validaciones manuales — no es una lectura real de GA4/GTM."
    );
  } else {
    lines.push(
      `GA4: ${result.ga4Connected ? "lectura real completada" : "sin lectura real (ver warnings)"}. GTM: ${result.gtmConnected ? "lectura real completada" : "sin lectura real (ver warnings)"}. Solo lectura en ambos casos — ninguna llamada de escritura existe en estos adaptadores.`
    );
  }
  lines.push("");

  if (result.ga4Connected && result.ga4Snapshot) {
    const s = result.ga4Snapshot;
    lines.push(`## GA4 — Trafico por canal (${s.startDate} a ${s.endDate})`);
    lines.push("");
    if (s.channelTraffic.length === 0) {
      lines.push("Sin trafico en el periodo.");
    } else {
      lines.push("| Canal | Sesiones | Usuarios activos | Conversiones |");
      lines.push("|---|---|---|---|");
      for (const row of s.channelTraffic) {
        lines.push(`| ${row.channel} | ${row.sessions} | ${row.activeUsers} | ${row.conversions} |`);
      }
    }
    lines.push("");

    lines.push("## GA4 — Landing pages principales");
    lines.push("");
    if (s.topLandingPages.length === 0) {
      lines.push("Sin datos de landing pages en el periodo.");
    } else {
      lines.push("| Landing page | Sesiones | Conversiones | Bounce rate |");
      lines.push("|---|---|---|---|");
      for (const row of s.topLandingPages.slice(0, 15)) {
        lines.push(`| ${row.landingPage} | ${row.sessions} | ${row.conversions} | ${(row.bounceRate * 100).toFixed(1)}% |`);
      }
    }
    lines.push("");

    lines.push("## GA4 — Eventos clave (comparado contra lo esperado)");
    lines.push("");
    lines.push("| Evento | Se disparo en el periodo | Ocurrencias | Conversiones |");
    lines.push("|---|---|---|---|");
    for (const ev of result.keyEvents) {
      const observed = s.events.find((e) => e.eventName === ev.name);
      lines.push(`| \`${ev.name}\` | ${observed ? "si" : "NO"} | ${observed?.eventCount ?? 0} | ${observed?.conversions ?? 0} |`);
    }
    lines.push("");

    lines.push("## GA4 — Fuentes / medios principales");
    lines.push("");
    if (s.sourceMedium.length === 0) {
      lines.push("Sin datos de fuente/medio en el periodo.");
    } else {
      lines.push("| Fuente | Medio | Sesiones | Conversiones |");
      lines.push("|---|---|---|---|");
      for (const row of s.sourceMedium.slice(0, 15)) {
        lines.push(`| ${row.source} | ${row.medium} | ${row.sessions} | ${row.conversions} |`);
      }
    }
    lines.push("");
  } else {
    lines.push("## Eventos clave que deberian existir en GA4 (documentado, no verificado en vivo)");
    lines.push("");
    lines.push("| Evento | Descripcion | Validacion propuesta |");
    lines.push("|---|---|---|");
    for (const ev of result.keyEvents) {
      lines.push(`| \`${ev.name}\` | ${ev.description} | ${ev.validation} |`);
    }
    lines.push("");
  }

  if (result.gtmConnected && result.gtmSnapshot) {
    const g = result.gtmSnapshot;
    lines.push("## GTM — Estado del contenedor");
    lines.push("");
    lines.push(`- **Contenedor:** ${g.containerName} (${g.containerPublicId}, id interno ${g.containerId})`);
    lines.push(`- **Workspace:** ${g.workspaceName} (id ${g.workspaceId})`);
    lines.push(`- **Version live:** ${g.liveVersionName ?? "(no encontrada / sin version publicada)"} ${g.liveVersionId ? `(id ${g.liveVersionId})` : ""}`);
    lines.push(`- **Tags:** ${g.tagCount} — **Triggers:** ${g.triggerCount} — **Variables:** ${g.variableCount}`);
    lines.push("");
    lines.push("### Tags (hasta 30)");
    lines.push("");
    if (g.tags.length === 0) {
      lines.push("Sin tags.");
    } else {
      lines.push("| Tag | Tipo | Pausado |");
      lines.push("|---|---|---|");
      for (const t of g.tags) lines.push(`| ${t.name} | ${t.type} | ${t.paused ? "si" : "no"} |`);
    }
    lines.push("");
    lines.push("### Triggers (hasta 30)");
    lines.push("");
    if (g.triggers.length === 0) {
      lines.push("Sin triggers.");
    } else {
      lines.push("| Trigger | Tipo |");
      lines.push("|---|---|");
      for (const t of g.triggers) lines.push(`| ${t.name} | ${t.type} |`);
    }
    lines.push("");
    lines.push("### Variables (hasta 30)");
    lines.push("");
    if (g.variables.length === 0) {
      lines.push("Sin variables.");
    } else {
      lines.push("| Variable | Tipo |");
      lines.push("|---|---|");
      for (const v of g.variables) lines.push(`| ${v.name} | ${v.type} |`);
    }
    lines.push("");
    lines.push("**Recordatorio:** este agente NUNCA publica una version de contenedor ni modifica ningun tag/trigger/variable.");
    lines.push("");
  }

  lines.push("## Validaciones de tracking propuestas");
  lines.push("");
  lines.push("- [ ] Confirmar en GA4 (DebugView o Realtime) que cada evento clave de la tabla anterior se dispara correctamente.");
  lines.push("- [ ] Confirmar que los eventos distinguen Zentry de Tukandado si ambas marcas comparten el mismo GA4/GTM.");
  lines.push("- [ ] Confirmar que `generate_lead_form_submit` esta marcado como evento de conversion (key event) en GA4.");
  lines.push("- [ ] Si existe la campana de Google Ads (ver informe de SEM Watcher), confirmar el enlace GA4 <-> Google Ads antes de activarla.");
  lines.push("");

  if (result.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado GA4 ni GTM.");
  lines.push("- No se ha publicado ninguna version de contenedor GTM.");
  lines.push(
    result.ga4Connected || result.gtmConnected
      ? "- Este agente leyo GA4/GTM en modo solo lectura y propone; no existe ninguna llamada de escritura en estos adaptadores."
      : "- Este agente solo leyo documentacion/config local y propone validaciones manuales."
  );
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: AnalyticsWatcherRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `analytics-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runAnalyticsWatcher(departmentRunId?: string): Promise<AnalyticsWatcherRunResult> {
  const deptRunId = departmentRunId ?? buildDepartmentRunId();
  logger.info("Analytics Watcher Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "Analytics Watcher Agent iniciado" });

  const warnings: string[] = [];
  const ga4Creds = hasGa4Credentials();
  const gtmCreds = hasGtmCredentials();

  let ga4Connected = false;
  let gtmConnected = false;
  let ga4Snapshot: Ga4Snapshot | undefined;
  let gtmSnapshot: GtmSnapshot | undefined;

  if (!ga4Creds.ok) {
    const warning = `Sin credenciales de GA4 (${ga4Creds.missing.join(", ")}). Se salta la lectura real de GA4.`;
    warnings.push(warning);
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "warning_detected",
      priority: "medium",
      summary: warning,
      payload: { missingEnvVars: ga4Creds.missing, system: "ga4" },
    });
    logger.info(warning);
  } else {
    try {
      ga4Snapshot = await getGa4Snapshot();
      ga4Connected = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warning = `Hay credenciales de GA4 pero la lectura real fallo: ${message}.`;
      warnings.push(warning);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "warning_detected",
        priority: "medium",
        summary: warning,
        payload: { system: "ga4", credentialsMissing: false, readFailed: true },
      });
      logger.error(warning);
    }
  }

  if (!gtmCreds.ok) {
    const warning = `Sin credenciales de GTM (${gtmCreds.missing.join(", ")}). Se salta la lectura real de GTM.`;
    warnings.push(warning);
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "warning_detected",
      priority: "medium",
      summary: warning,
      payload: { missingEnvVars: gtmCreds.missing, system: "gtm" },
    });
    logger.info(warning);
  } else {
    try {
      gtmSnapshot = await getGtmSnapshot();
      gtmConnected = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warning = `Hay credenciales de GTM pero la lectura real fallo: ${message}.`;
      warnings.push(warning);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "warning_detected",
        priority: "medium",
        summary: warning,
        payload: { system: "gtm", credentialsMissing: false, readFailed: true },
      });
      logger.error(warning);
    }
  }

  const keyEvents = loadKeyEvents();

  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "recommendation_created",
    priority: "medium",
    summary: "Validar eventos clave de tracking en GA4",
    payload: {
      kind: "analytics_validation",
      keyword: "validacion de tracking GA4",
      recommendation: `Validar manualmente en GA4 (DebugView/Realtime) que los ${keyEvents.length} eventos clave (${keyEvents.map((e) => e.name).join(", ")}) se disparan correctamente.`,
    },
  });

  const generatedAt = new Date().toISOString();
  const result: AnalyticsWatcherRunResult = {
    departmentRunId: deptRunId,
    ga4Connected,
    gtmConnected,
    keyEvents,
    warnings,
    reportPath: "",
    ga4Snapshot,
    gtmSnapshot,
  };
  result.reportPath = writeReport(result, generatedAt);

  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `Analytics Watcher Agent finalizado. GA4=${ga4Connected} GTM=${gtmConnected}.`,
    payload: { ga4Connected, gtmConnected, reportPath: result.reportPath },
  });
  logger.info("Analytics Watcher Agent finalizado", { ga4: ga4Connected, gtm: gtmConnected, reportPath: result.reportPath });

  return result;
}
