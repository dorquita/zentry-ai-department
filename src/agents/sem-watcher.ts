import * as fs from "fs";
import * as path from "path";
import { readAllEvents } from "../core/department-events";
import { emitEvent } from "../core/department-events";
import { buildDepartmentRunId } from "../core/department-run-id";
import { logger } from "../core/logger";
import { DepartmentEvent } from "../core/types";
import {
  hasGoogleAdsCredentials,
  getGoogleAdsSnapshot,
  microsToEuros,
  GoogleAdsSnapshot,
} from "../adapters/google-ads";
import { resolveActiveClientPaths } from "../core/client-paths";

/**
 * SEM Watcher Agent — READ + PROPOSE only. NUNCA modifica Google Ads: no
 * activa campanas, no cambia presupuesto, no crea keywords ni anuncios,
 * no toca conversiones. Fase O11: si hay credenciales de Google Ads en
 * `.env`, lee la cuenta REAL (solo lectura, ver
 * `src/adapters/google-ads.ts`); si no las hay, o si la lectura falla por
 * cualquier motivo, cae de forma segura al placeholder documentado en
 * `config/sem-campaign-state.json` — nunca lanza una excepcion que
 * interrumpa el pase diario.
 */

const CONFIG_DIR = path.join(__dirname, "..", "..", "config");
const REPORTS_DIR = path.join(resolveActiveClientPaths().reportsDir, "sem");
const AGENT_NAME = "sem-watcher";

interface SemCampaignState {
  campaign: {
    name: string;
    type: string;
    status: string;
    statusReason: string;
    adGroups: number;
    positiveKeywords: number;
    negativeKeywords: number;
    responsiveSearchAds: number;
  };
}

interface CampaignStateView {
  name: string;
  type: string;
  status: string;
  statusReason: string;
  adGroups: number;
  positiveKeywords: number;
  negativeKeywords: number;
  responsiveSearchAds: number;
}

function loadCampaignState(): SemCampaignState {
  const raw = fs.readFileSync(path.join(CONFIG_DIR, "sem-campaign-state.json"), "utf-8");
  return JSON.parse(raw) as SemCampaignState;
}

interface SemKeywordCandidate {
  term: string;
  source: "seo-target-keywords" | "competitor-intelligence";
  priority: string;
}

function getSemCandidatesFromCompetitorIntel(): SemKeywordCandidate[] {
  const events: DepartmentEvent[] = readAllEvents().filter(
    (e) =>
      e.agent === "competitor-intelligence" &&
      e.type === "competitor_keyword_detected" &&
      (e.payload as Record<string, unknown>).suggestedForSem === true
  );
  return events.map((e) => ({
    term: String((e.payload as Record<string, unknown>).term ?? ""),
    source: "competitor-intelligence",
    priority: e.priority,
  }));
}

/**
 * Construye la vista de "estado de campana" a partir de una lectura real
 * de Google Ads. Toma la primera campana devuelta (hoy solo hay una
 * campana real en la cuenta) — si algun dia hay varias, esta funcion es
 * el unico sitio a tocar para decidir cual mostrar como principal.
 */
/**
 * Elige la campana "principal" a mostrar. La cuenta puede tener campanas
 * REMOVED/historicas (p.ej. una Performance Max eliminada) mezcladas con
 * la campana real que interesa -- nunca se debe mostrar una REMOVED si
 * hay alguna activa/pausada disponible. Preferencia: 1) coincide con el
 * nombre documentado en config/sem-campaign-state.json (la campana que el
 * cliente conoce), 2) si no hay coincidencia, la primera no-REMOVED,
 * 3) si todas estan REMOVED, la primera de todas (mejor mostrar algo real
 * que nada).
 */
function selectPrimaryCampaign(campaigns: GoogleAdsSnapshot["campaigns"]): GoogleAdsSnapshot["campaigns"][number] | null {
  if (campaigns.length === 0) return null;
  const active = campaigns.filter((c) => c.status !== "REMOVED");
  const pool = active.length > 0 ? active : campaigns;

  let configuredName: string | null = null;
  try {
    configuredName = loadCampaignState().campaign.name;
  } catch {
    configuredName = null;
  }
  if (configuredName) {
    const match = pool.find((c) => c.name === configuredName);
    if (match) return match;
  }
  return pool[0];
}

function campaignStateFromSnapshot(snapshot: GoogleAdsSnapshot): CampaignStateView | null {
  const campaign = selectPrimaryCampaign(snapshot.campaigns);
  if (!campaign) return null;
  const budgetEur = microsToEuros(campaign.dailyBudgetMicros);
  return {
    name: campaign.name,
    type: campaign.channelType,
    status: campaign.status,
    statusReason:
      campaign.status === "PAUSED"
        ? `Lectura real de Google Ads (solo lectura). Presupuesto diario configurado: ${budgetEur !== null ? budgetEur + " EUR" : "desconocido"}. Sigue en PAUSED — este agente nunca la activa.`
        : `Lectura real de Google Ads (solo lectura). Presupuesto diario configurado: ${budgetEur !== null ? budgetEur + " EUR" : "desconocido"}.`,
    adGroups: snapshot.adGroups.filter((ag) => ag.campaignId === campaign.id).length,
    positiveKeywords: snapshot.positiveKeywords.length,
    negativeKeywords: snapshot.negativeKeywords.length,
    responsiveSearchAds: snapshot.ads.length,
  };
}

export interface SemCampaignSummaryItem {
  name: string;
  status: string;
  dailyBudgetEUR: number | null;
  adGroups: number;
  positiveKeywords: number;
}

/**
 * Fase O45.1/O49.6 -- desde que hay 7 campanas SEM reales en la cuenta
 * (6 nuevas + 1 legacy), el informe ejecutivo necesita una vista agregada
 * de TODAS las campanas relevantes, no solo de la "principal" que elige
 * `selectPrimaryCampaign` para el informe tecnico. Pura lectura/
 * agregacion sobre el snapshot ya obtenido -- nunca decide ni modifica
 * nada en Google Ads.
 */
export interface SemDepartmentSummary {
  totalCampaigns: number;
  activeCampaignCount: number;
  pausedCampaignCount: number;
  allPaused: boolean;
  totalDailyBudgetIfActivatedEUR: number;
  totalMonthlyBudgetIfActivatedEUR: number;
  campaigns: SemCampaignSummaryItem[];
  totalPositiveKeywords: number;
  totalNegativeKeywords: number;
  realSpendEUR: number;
  primaryConversionActionNames: string[];
  unexpectedPrimaryConversionActionNames: string[];
  duplicateKeywordWarnings: string[];
}

const EXPECTED_PRIMARY_CONVERSION_SUBSTRINGS = ["generate_lead_form_submit", "click_whatsapp", "click_phone"];

function buildSemDepartmentSummary(snapshot: GoogleAdsSnapshot): SemDepartmentSummary {
  const relevantCampaigns = snapshot.campaigns.filter((c) => c.status !== "REMOVED");

  const campaigns: SemCampaignSummaryItem[] = relevantCampaigns.map((c) => {
    const agIds = new Set(snapshot.adGroups.filter((ag) => ag.campaignId === c.id).map((ag) => ag.id));
    return {
      name: c.name,
      status: c.status,
      dailyBudgetEUR: microsToEuros(c.dailyBudgetMicros),
      adGroups: agIds.size,
      positiveKeywords: snapshot.positiveKeywords.filter((k) => agIds.has(k.adGroupId)).length,
    };
  });

  const activeCampaignCount = campaigns.filter((c) => c.status === "ENABLED").length;
  const pausedCampaignCount = campaigns.filter((c) => c.status === "PAUSED").length;
  const allPaused = activeCampaignCount === 0;
  const totalDailyBudgetIfActivatedEUR = Math.round(campaigns.reduce((sum, c) => sum + (c.dailyBudgetEUR ?? 0), 0) * 100) / 100;
  const totalMonthlyBudgetIfActivatedEUR = Math.round(totalDailyBudgetIfActivatedEUR * 30 * 100) / 100;

  const relevantCampaignIds = new Set(relevantCampaigns.map((c) => c.id));
  const realSpendMicros = snapshot.metrics
    .filter((m) => relevantCampaignIds.has(m.campaignId))
    .reduce((sum, m) => sum + m.costMicros, 0);
  const realSpendEUR = Math.round((realSpendMicros / 1_000_000) * 100) / 100;

  const primaryConversionActionNames = snapshot.conversionActions.filter((ca) => ca.primaryForGoal).map((ca) => ca.name);
  const unexpectedPrimaryConversionActionNames = primaryConversionActionNames.filter(
    (name) => !EXPECTED_PRIMARY_CONVERSION_SUBSTRINGS.some((expected) => name.toLowerCase().includes(expected))
  );

  // Deteccion de keywords positivas (mismo texto+matchType) activas
  // desde mas de una campana relevante a la vez -- p.ej. la legacy
  // duplicando ad groups con campanas nuevas dedicadas.
  const adGroupToCampaign = new Map(snapshot.adGroups.map((ag) => [ag.id, { campaignId: ag.campaignId, campaignName: ag.campaignName }]));
  const kwIndex = new Map<string, Set<string>>();
  for (const kw of snapshot.positiveKeywords) {
    if (kw.status === "REMOVED") continue;
    const ag = adGroupToCampaign.get(kw.adGroupId);
    if (!ag || !relevantCampaignIds.has(ag.campaignId)) continue;
    const key = `${kw.text.toLowerCase()}|${kw.matchType}`;
    if (!kwIndex.has(key)) kwIndex.set(key, new Set());
    kwIndex.get(key)!.add(ag.campaignName);
  }
  const duplicateKeywordWarnings: string[] = [];
  for (const [key, campaignNames] of kwIndex.entries()) {
    if (campaignNames.size > 1) {
      const [text] = key.split("|");
      duplicateKeywordWarnings.push(`"${text}" se dirige desde ${campaignNames.size} campanas distintas: ${[...campaignNames].join(", ")}`);
    }
  }

  return {
    totalCampaigns: campaigns.length,
    activeCampaignCount,
    pausedCampaignCount,
    allPaused,
    totalDailyBudgetIfActivatedEUR,
    totalMonthlyBudgetIfActivatedEUR,
    campaigns,
    totalPositiveKeywords: snapshot.positiveKeywords.length,
    totalNegativeKeywords: snapshot.negativeKeywords.length,
    realSpendEUR,
    primaryConversionActionNames,
    unexpectedPrimaryConversionActionNames,
    duplicateKeywordWarnings,
  };
}

export interface SemWatcherRunResult {
  departmentRunId: string;
  connected: boolean;
  campaignState: CampaignStateView;
  semCandidates: SemKeywordCandidate[];
  warnings: string[];
  reportPath: string;
  adsSnapshot?: GoogleAdsSnapshot;
  departmentSummary?: SemDepartmentSummary;
}

function formatEur(micros: number): string {
  return (micros / 1_000_000).toFixed(2) + " EUR";
}

function buildReportMarkdown(result: SemWatcherRunResult, generatedAt: string): string {
  const executionDate = generatedAt.slice(0, 10);
  const c = result.campaignState;
  const lines: string[] = [];

  lines.push(`# SEM Watcher — ${executionDate}`);
  lines.push("");
  lines.push(`- **departmentRunId:** \`${result.departmentRunId}\``);
  lines.push(`- **Generado:** ${generatedAt}`);
  lines.push(`- **Conectado a Google Ads real:** ${result.connected ? "si" : "no"}`);
  lines.push("");

  lines.push("## Resumen ejecutivo");
  lines.push("");
  if (!result.connected) {
    lines.push(
      `No hay credenciales de Google Ads configuradas en este proyecto, o la lectura real fallo (ver Warnings mas abajo). Este informe se basa en el estado documentado en \`config/sem-campaign-state.json\` y en candidatas SEM detectadas por otros agentes — no en una lectura real de la cuenta.`
    );
  } else {
    lines.push(
      `Conectado a Google Ads (customer ${result.adsSnapshot?.customerId ?? "?"}, via login-customer-id ${result.adsSnapshot?.loginCustomerId ?? "?"}). Lectura real, solo lectura (\`googleAds:search\`), sin ninguna llamada de mutacion.`
    );
  }
  lines.push("");

  lines.push("## Estado de la campana");
  lines.push("");
  lines.push(`- **Nombre:** ${c.name}`);
  lines.push(`- **Tipo:** ${c.type}`);
  lines.push(`- **Estado:** ${c.status}`);
  lines.push(`- **Motivo/nota:** ${c.statusReason}`);
  lines.push(`- **Ad groups:** ${c.adGroups}`);
  lines.push(`- **Keywords positivas:** ${c.positiveKeywords}`);
  lines.push(`- **Keywords negativas:** ${c.negativeKeywords}`);
  lines.push(`- **Anuncios (RSA):** ${c.responsiveSearchAds}`);
  lines.push("");
  lines.push(
    "**Recordatorio:** este agente NO activa la campana, NO cambia presupuesto, NO crea keywords, NO crea anuncios y NO toca conversiones bajo ninguna circunstancia — ni con credenciales reales conectadas."
  );
  lines.push("");

  if (result.departmentSummary) {
    const d = result.departmentSummary;
    lines.push("## Departamento SEM — todas las campanas (Fase O45.1/O49.6)");
    lines.push("");
    lines.push(`- **Campanas activas/pausadas (no REMOVED):** ${d.totalCampaigns}`);
    lines.push(`- **Activas (ENABLED):** ${d.activeCampaignCount} · **Pausadas:** ${d.pausedCampaignCount}`);
    lines.push(`- **Gasto real (ventana ${result.adsSnapshot?.metricsWindow ?? "?"}):** ${d.realSpendEUR.toFixed(2)} EUR`);
    lines.push(`- **Presupuesto diario total si se activaran todas:** ${d.totalDailyBudgetIfActivatedEUR.toFixed(2)} EUR (~${d.totalMonthlyBudgetIfActivatedEUR.toFixed(2)} EUR/mes)`);
    lines.push(`- **Keywords positivas (total cuenta):** ${d.totalPositiveKeywords} · **Negativas:** ${d.totalNegativeKeywords}`);
    lines.push("");
    lines.push("| Campana | Estado | Presupuesto/dia | Ad groups | Keywords |");
    lines.push("|---|---|---|---|---|");
    for (const c of d.campaigns) {
      lines.push(`| ${c.name} | ${c.status} | ${c.dailyBudgetEUR !== null ? c.dailyBudgetEUR.toFixed(2) + " EUR" : "?"} | ${c.adGroups} | ${c.positiveKeywords} |`);
    }
    lines.push("");
    lines.push(`**Conversiones primarias activas:** ${d.primaryConversionActionNames.length === 0 ? "ninguna" : d.primaryConversionActionNames.join(", ")}.`);
    if (d.unexpectedPrimaryConversionActionNames.length > 0) {
      lines.push(`**ALERTA -- conversion primaria inesperada:** ${d.unexpectedPrimaryConversionActionNames.join(", ")}.`);
    }
    lines.push("");
    if (d.duplicateKeywordWarnings.length > 0) {
      lines.push(`**Keywords duplicadas entre campanas (${d.duplicateKeywordWarnings.length}):**`);
      for (const w of d.duplicateKeywordWarnings) lines.push(`- ${w}`);
      lines.push("");
    }
  }

  if (result.connected && result.adsSnapshot) {
    const snap = result.adsSnapshot;

    lines.push("## Ad groups (lectura real)");
    lines.push("");
    if (snap.adGroups.length === 0) {
      lines.push("Sin ad groups.");
    } else {
      lines.push("| Ad group | Estado | Campana |");
      lines.push("|---|---|---|");
      for (const ag of snap.adGroups.slice(0, 20)) {
        lines.push(`| ${ag.name} | ${ag.status} | ${ag.campaignName} |`);
      }
    }
    lines.push("");

    lines.push("## Keywords positivas (primeras 20)");
    lines.push("");
    if (snap.positiveKeywords.length === 0) {
      lines.push("Sin keywords positivas.");
    } else {
      lines.push("| Keyword | Match type | Estado |");
      lines.push("|---|---|---|");
      for (const kw of snap.positiveKeywords.slice(0, 20)) {
        lines.push(`| ${kw.text} | ${kw.matchType} | ${kw.status} |`);
      }
    }
    lines.push("");

    lines.push(`## Keywords negativas — ${snap.negativeKeywords.length} total`);
    lines.push("");
    lines.push(
      `${snap.negativeKeywords.filter((k) => k.level === "ad_group").length} a nivel de ad group, ${snap.negativeKeywords.filter((k) => k.level === "campaign").length} a nivel de campana.`
    );
    lines.push("");

    lines.push("## Anuncios (Responsive Search Ads)");
    lines.push("");
    if (snap.ads.length === 0) {
      lines.push("Sin anuncios RSA.");
    } else {
      for (const ad of snap.ads.slice(0, 10)) {
        lines.push(`- **Ad ${ad.adId}** (${ad.status}) — ${ad.headlines.length} titulares, ${ad.descriptions.length} descripciones.`);
      }
    }
    lines.push("");

    lines.push("## Acciones de conversion");
    lines.push("");
    if (snap.conversionActions.length === 0) {
      lines.push("Sin acciones de conversion configuradas.");
    } else {
      lines.push("| Nombre | Categoria | Tipo | Estado |");
      lines.push("|---|---|---|---|");
      for (const ca of snap.conversionActions.slice(0, 20)) {
        lines.push(`| ${ca.name} | ${ca.category} | ${ca.type} | ${ca.status} |`);
      }
    }
    lines.push("");

    lines.push(`## Metricas basicas (${snap.metricsWindow})`);
    lines.push("");
    if (snap.metrics.length === 0 || snap.metrics.every((m) => m.impressions === 0 && m.clicks === 0)) {
      lines.push("Sin actividad medida en el periodo (esperable: la campana esta PAUSED).");
    } else {
      lines.push("| Campana | Impresiones | Clics | Coste | Conversiones | CTR |");
      lines.push("|---|---|---|---|---|---|");
      for (const m of snap.metrics) {
        lines.push(
          `| ${m.campaignName} | ${m.impressions} | ${m.clicks} | ${formatEur(m.costMicros)} | ${m.conversions} | ${(m.ctr * 100).toFixed(2)}% |`
        );
      }
    }
    lines.push("");
  }

  lines.push("## Candidatas SEM detectadas");
  lines.push("");
  if (result.semCandidates.length === 0) {
    lines.push("No hay candidatas nuevas detectadas en esta ejecucion.");
  } else {
    lines.push("| Termino | Origen | Prioridad |");
    lines.push("|---|---|---|");
    for (const cand of result.semCandidates) {
      lines.push(`| ${cand.term} | ${cand.source} | ${cand.priority} |`);
    }
  }
  lines.push("");

  lines.push("## Checklist de revision final antes de activar (propuesta, no ejecutada)");
  lines.push("");
  lines.push("- [ ] Confirmar presupuesto diario/mensual aprobado por el cliente.");
  lines.push("- [ ] Revisar las keywords positivas actuales contra las nuevas candidatas de este informe.");
  lines.push("- [ ] Revisar las negativas para evitar solapamiento con las nuevas candidatas.");
  lines.push("- [ ] Revisar los RSA (textos, CTAs) contra la clasificacion Zentry/Tukandado/mixta.");
  lines.push("- [ ] Confirmar que el tracking de conversion (GA4) esta validado antes de gastar presupuesto — ver informe de Analytics Watcher.");
  lines.push("- [ ] Decidir fecha de activacion explicitamente con el cliente (no activar por defecto).");
  lines.push("");

  if (result.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Confirmacion de seguridad");
  lines.push("");
  lines.push("- No se ha modificado ninguna campana, presupuesto, keyword, anuncio ni conversion de Google Ads.");
  lines.push("- La campana sigue en PAUSED (verificado en cada lectura), sin cambios.");
  lines.push(
    result.connected
      ? "- Este agente leyo Google Ads en modo solo lectura (googleAds:search) y propone; no existe ninguna llamada de mutacion en este proyecto."
      : "- Este agente solo leyo documentacion/config local y propone."
  );
  lines.push("");

  return lines.join("\n");
}

function writeReport(result: SemWatcherRunResult, generatedAt: string): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const executionDate = generatedAt.slice(0, 10);
  const filePath = path.join(REPORTS_DIR, `sem-${executionDate}.md`);
  fs.writeFileSync(filePath, buildReportMarkdown(result, generatedAt), "utf-8");
  return filePath;
}

export async function runSemWatcher(departmentRunId?: string): Promise<SemWatcherRunResult> {
  const deptRunId = departmentRunId ?? buildDepartmentRunId();
  logger.info("SEM Watcher Agent iniciado", { departmentRunId: deptRunId });
  emitEvent({ departmentRunId: deptRunId, agent: AGENT_NAME, type: "agent_started", summary: "SEM Watcher Agent iniciado" });

  const warnings: string[] = [];
  const { ok: credsPresent, missing } = hasGoogleAdsCredentials();

  let connected = false;
  let campaignState: CampaignStateView | null = null;
  let adsSnapshot: GoogleAdsSnapshot | undefined;

  if (!credsPresent) {
    const warning = `Sin credenciales de Google Ads (${missing.join(", ")}). Se salta la lectura real y se generan recomendaciones solo con documentacion/config local.`;
    warnings.push(warning);
    emitEvent({
      departmentRunId: deptRunId,
      agent: AGENT_NAME,
      type: "warning_detected",
      priority: "medium",
      summary: warning,
      payload: { missingEnvVars: missing },
    });
    logger.info(warning);
  } else {
    try {
      adsSnapshot = await getGoogleAdsSnapshot();
      campaignState = campaignStateFromSnapshot(adsSnapshot);
      if (!campaignState) {
        warnings.push("Google Ads conectado pero no se encontro ninguna campana en la cuenta. Se usa el estado documentado como respaldo.");
      } else {
        connected = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warning = `Hay credenciales de Google Ads pero la lectura real fallo: ${message}. Se usa el estado documentado como respaldo.`;
      warnings.push(warning);
      emitEvent({
        departmentRunId: deptRunId,
        agent: AGENT_NAME,
        type: "warning_detected",
        priority: "medium",
        summary: warning,
        payload: { credentialsMissing: false, readFailed: true },
      });
      logger.error(warning);
    }
  }

  if (!campaignState) {
    campaignState = loadCampaignState().campaign;
  }

  const semCandidates = getSemCandidatesFromCompetitorIntel();
  const departmentSummary = adsSnapshot ? buildSemDepartmentSummary(adsSnapshot) : undefined;

  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "recommendation_created",
    priority: "medium",
    summary: `Revision final de la campana SEM antes de activacion (${campaignState.status})`,
    payload: {
      kind: "sem_review",
      keyword: "revision de campana SEM (Google Ads)",
      recommendation: `Campana "${campaignState.name}" en estado ${campaignState.status}. Candidatas SEM detectadas hasta hoy: ${semCandidates.length}. Revisar checklist de revision final antes de activar (ver informe completo).`,
    },
  });

  const generatedAt = new Date().toISOString();
  const result: SemWatcherRunResult = {
    departmentRunId: deptRunId,
    connected,
    campaignState,
    semCandidates,
    warnings,
    reportPath: "",
    adsSnapshot,
    departmentSummary,
  };
  result.reportPath = writeReport(result, generatedAt);

  emitEvent({
    departmentRunId: deptRunId,
    agent: AGENT_NAME,
    type: "agent_finished",
    summary: `SEM Watcher Agent finalizado. Conectado=${connected}. Candidatas SEM: ${semCandidates.length}.`,
    // Fase O49 -- payload ampliado para que el informe ejecutivo (ver
    // growth-director.ts) pueda mostrar un bloque "Departamento SEM" real
    // en vez de solo si esta conectado o no: nombre/estado/tamaño de la
    // campana y presupuesto diario configurado (nunca gasto real si no
    // hay metricas -- la campana sigue PAUSED).
    payload: {
      connected,
      campaignName: campaignState.name,
      campaignStatus: campaignState.status,
      adGroups: campaignState.adGroups,
      positiveKeywords: campaignState.positiveKeywords,
      negativeKeywords: campaignState.negativeKeywords,
      responsiveSearchAds: campaignState.responsiveSearchAds,
      semCandidateCount: semCandidates.length,
      metricsWindow: adsSnapshot?.metricsWindow,
      metrics: adsSnapshot?.metrics ?? [],
      reportPath: result.reportPath,
      departmentSummary,
    },
  });
  logger.info("SEM Watcher Agent finalizado", { connected, reportPath: result.reportPath });

  return result;
}
