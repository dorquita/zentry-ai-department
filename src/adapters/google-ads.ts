import { google } from "googleapis";
import { logger } from "../core/logger";
import { recordCredentialFailure, recordCredentialSuccess } from "../core/credential-health";
import {
  loadActiveClientAdsConfig,
  resolveActiveClientId,
  resolveClientSecret,
  resolveClientServiceCredentials,
} from "../core/client-config";

/**
 * REAL adapter para Google Ads — SOLO LECTURA. Unicamente llama a
 * `googleAds:search` (GAQL de solo consulta) de la API REST de Google
 * Ads. No importa ni referencia ningun endpoint de mutacion (no hay
 * `mutate`, `campaigns:mutate`, `adGroupCriteria:mutate`, etc. en todo
 * este fichero) — es fisicamente imposible que este adaptador active una
 * campana, cambie un presupuesto, cree una keyword o publique un anuncio.
 *
 * Fase O11 — SEM Watcher pasa de placeholder a lectura real cuando estas
 * credenciales existen en `.env`; sin ellas, el agente (no este adaptador)
 * decide caer al placeholder documentado en `config/sem-campaign-state.json`.
 */

const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const DEFAULT_API_VERSION = "v24";

/**
 * Fase O16.2: el gate de "hay credenciales" ahora es client-aware (via
 * `resolveClientServiceCredentials`, que ya comprueba `<CLIENTID>_<var>`
 * con fallback legacy solo para "zentry") — sigue mirando SOLO
 * variables de entorno (nunca `clients/<id>/ads.json`, que no contiene
 * secretos), pero ya no asume que siempre es el cliente activo por
 * variables sin prefijo: acepta un `clientId` explicito para que un
 * futuro bucle multi-cliente pueda preguntar por cualquier cliente sin
 * mutar variables de entorno globales.
 */
export function hasGoogleAdsCredentials(clientId: string = resolveActiveClientId()): { ok: boolean; missing: string[] } {
  const status = resolveClientServiceCredentials(clientId, "google_ads");
  return { ok: status.complete, missing: status.missing };
}

/** Fase O16.1/O16.2: prefiere `clients/<id>/ads.json`, luego `<CLIENTID>_GOOGLE_ADS_CUSTOMER_ID`, luego `.env` legacy. */
function resolveCustomerId(): string {
  return loadActiveClientAdsConfig().customerId ?? resolveClientSecret(resolveActiveClientId(), "GOOGLE_ADS_CUSTOMER_ID");
}

/** Fase O16.1/O16.2: idem con `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. */
function resolveLoginCustomerId(): string {
  return (
    loadActiveClientAdsConfig().loginCustomerId ??
    resolveClientSecret(resolveActiveClientId(), "GOOGLE_ADS_LOGIN_CUSTOMER_ID")
  );
}

/** Quita guiones ("836-912-6564" -> "8369126564"): la API REST los exige sin formatear. */
function normalizeCustomerId(raw: string): string {
  return raw.replace(/-/g, "").trim();
}

/**
 * Igual que en search-console.ts: quita cualquier cosa con forma de
 * credencial de un mensaje de error de terceros antes de que llegue a un
 * log o a la consola. Defensa en profundidad ademas de la redaccion
 * generica de logger.ts.
 */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(
    /((?:access_token|refresh_token|client_secret|developer[_-]?token|api[_-]?key|private_key|authorization|bearer)\s*[:=]?\s*)["']?[A-Za-z0-9\-_./+=]{8,}["']?/gi,
    "$1[REDACTED]"
  );
  return stripped.length > 800 ? stripped.slice(0, 800) + "...[truncated]" : stripped;
}

/** Fase O16.1: prefiere `clients/<id>/ads.json`, luego `.env`, luego el default fijo. */
function resolveApiVersion(): string {
  const configured = loadActiveClientAdsConfig().apiVersion;
  if (configured) {
    return configured;
  }
  return (process.env.GOOGLE_ADS_API_VERSION ?? "").trim() || DEFAULT_API_VERSION;
}

async function getAccessToken(): Promise<string> {
  const activeClientId = resolveActiveClientId();
  const clientId = resolveClientSecret(activeClientId, "GOOGLE_ADS_OAUTH_CLIENT_ID");
  const clientSecret = resolveClientSecret(activeClientId, "GOOGLE_ADS_OAUTH_CLIENT_SECRET");
  const refreshToken = resolveClientSecret(activeClientId, "GOOGLE_ADS_OAUTH_REFRESH_TOKEN");
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("getAccessToken() no devolvio ningun token.");
    return token;
  } catch (err) {
    throw new Error(`No se pudo renovar el access token de Google Ads (scope ${ADS_SCOPE}): ${sanitizeError(err)}`);
  }
}

interface GaqlSearchResponse {
  results?: Record<string, any>[];
  nextPageToken?: string;
}

const MAX_PAGES = 5;

/**
 * Unico punto de llamada a la red de este adaptador. SIEMPRE
 * `googleAds:search` (GET semantico via GAQL, solo lectura). Nunca
 * `:searchStream` con side effects, nunca `:mutate`.
 */
async function searchGoogleAds(customerId: string, query: string): Promise<Record<string, any>[]> {
  const developerToken = resolveClientSecret(resolveActiveClientId(), "GOOGLE_ADS_DEVELOPER_TOKEN");
  const loginCustomerId = normalizeCustomerId(resolveLoginCustomerId());
  const targetCustomerId = normalizeCustomerId(customerId);
  const accessToken = await getAccessToken();
  const version = resolveApiVersion();

  // googleAds:search NO acepta pageSize en el body (la API responde
  // 400 PAGE_SIZE_NOT_SUPPORTED) -- el tamano de pagina es fijo (10000
  // filas), asi que solo se envia query/pageToken.
  const results: Record<string, any>[] = [];
  let pageToken: string | undefined;
  let page = 0;

  do {
    page += 1;
    const url = `https://googleads.googleapis.com/${version}/customers/${targetCustomerId}/googleAds:search`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "login-customer-id": loginCustomerId,
        },
        body: JSON.stringify({ query, pageToken }),
      });
    } catch (err) {
      throw new Error(`Fallo de red llamando a Google Ads (solo lectura): ${sanitizeError(err)}`);
    }

    if (!response.ok) {
      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }
      throw new Error(`Google Ads API respondio ${response.status}: ${sanitizeError(bodyText)}`);
    }

    const data = (await response.json()) as GaqlSearchResponse;
    results.push(...(data.results ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken && page < MAX_PAGES);

  return results;
}

export interface AdsCampaignSummary {
  id: string;
  name: string;
  status: string;
  channelType: string;
  dailyBudgetMicros: number | null;
}

export interface AdsAdGroupSummary {
  id: string;
  name: string;
  status: string;
  campaignId: string;
  campaignName: string;
}

export interface AdsKeywordSummary {
  criterionId: string;
  text: string;
  matchType: string;
  status: string;
  adGroupId: string;
  negative: boolean;
  level: "ad_group" | "campaign";
}

export interface AdsAdSummary {
  adId: string;
  status: string;
  adGroupId: string;
  headlines: string[];
  descriptions: string[];
}

export interface AdsConversionActionSummary {
  id: string;
  name: string;
  status: string;
  category: string;
  type: string;
  primaryForGoal: boolean;
}

export interface AdsCampaignMetrics {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  ctr: number;
}

export interface GoogleAdsSnapshot {
  customerId: string;
  loginCustomerId: string;
  metricsWindow: string;
  campaigns: AdsCampaignSummary[];
  adGroups: AdsAdGroupSummary[];
  positiveKeywords: AdsKeywordSummary[];
  negativeKeywords: AdsKeywordSummary[];
  ads: AdsAdSummary[];
  conversionActions: AdsConversionActionSummary[];
  metrics: AdsCampaignMetrics[];
}

function microsToEuros(micros: number | null | undefined): number | null {
  if (micros === null || micros === undefined) return null;
  return Math.round((micros / 1_000_000) * 100) / 100;
}

/**
 * Lee campanas, presupuestos, ad groups, keywords (positivas y negativas,
 * a nivel de ad group y de campana), anuncios RSA, acciones de conversion
 * y metricas basicas de los ultimos 30 dias. Solo lectura: ninguna
 * consulta GAQL de este fichero es una mutacion.
 */
export async function getGoogleAdsSnapshot(): Promise<GoogleAdsSnapshot> {
  const customerId = normalizeCustomerId(resolveCustomerId());
  const loginCustomerId = normalizeCustomerId(resolveLoginCustomerId());

  logger.info("Consultando Google Ads (solo lectura, googleAds:search)", {
    customerId,
    loginCustomerId,
    apiVersion: resolveApiVersion(),
  });

  try {
    const [campaignRows, adGroupRows, adGroupKeywordRows, campaignNegativeRows, adRows, conversionRows, metricRows] =
      await Promise.all([
        searchGoogleAds(
          customerId,
          `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign ORDER BY campaign.id`
        ),
        searchGoogleAds(
          customerId,
          `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, campaign.name FROM ad_group ORDER BY ad_group.id`
        ),
        searchGoogleAds(
          customerId,
          `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ad_group.id FROM keyword_view ORDER BY ad_group_criterion.criterion_id`
        ),
        searchGoogleAds(
          customerId,
          `SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.negative, campaign.id FROM campaign_criterion WHERE campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE`
        ),
        searchGoogleAds(
          customerId,
          `SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group.id FROM ad_group_ad WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`
        ),
        searchGoogleAds(
          customerId,
          `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.type, conversion_action.primary_for_goal FROM conversion_action ORDER BY conversion_action.id`
        ),
        searchGoogleAds(
          customerId,
          `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr FROM campaign WHERE segments.date DURING LAST_30_DAYS`
        ),
      ]);

    const campaigns: AdsCampaignSummary[] = campaignRows.map((r) => ({
      id: String(r.campaign?.id ?? ""),
      name: String(r.campaign?.name ?? ""),
      status: String(r.campaign?.status ?? ""),
      channelType: String(r.campaign?.advertisingChannelType ?? ""),
      dailyBudgetMicros: r.campaignBudget?.amountMicros != null ? Number(r.campaignBudget.amountMicros) : null,
    }));

    const adGroups: AdsAdGroupSummary[] = adGroupRows.map((r) => ({
      id: String(r.adGroup?.id ?? ""),
      name: String(r.adGroup?.name ?? ""),
      status: String(r.adGroup?.status ?? ""),
      campaignId: String(r.campaign?.id ?? ""),
      campaignName: String(r.campaign?.name ?? ""),
    }));

    const adGroupKeywords: AdsKeywordSummary[] = adGroupKeywordRows.map((r) => ({
      criterionId: String(r.adGroupCriterion?.criterionId ?? ""),
      text: String(r.adGroupCriterion?.keyword?.text ?? ""),
      matchType: String(r.adGroupCriterion?.keyword?.matchType ?? ""),
      status: String(r.adGroupCriterion?.status ?? ""),
      adGroupId: String(r.adGroup?.id ?? ""),
      negative: Boolean(r.adGroupCriterion?.negative),
      level: "ad_group",
    }));

    const campaignNegativeKeywords: AdsKeywordSummary[] = campaignNegativeRows.map((r) => ({
      criterionId: String(r.campaignCriterion?.criterionId ?? ""),
      text: String(r.campaignCriterion?.keyword?.text ?? ""),
      matchType: String(r.campaignCriterion?.keyword?.matchType ?? ""),
      status: "ENABLED",
      adGroupId: String(r.campaign?.id ?? ""),
      negative: true,
      level: "campaign",
    }));

    const positiveKeywords = adGroupKeywords.filter((k) => !k.negative);
    const negativeKeywords = [...adGroupKeywords.filter((k) => k.negative), ...campaignNegativeKeywords];

    const ads: AdsAdSummary[] = adRows.map((r) => ({
      adId: String(r.adGroupAd?.ad?.id ?? ""),
      status: String(r.adGroupAd?.status ?? ""),
      adGroupId: String(r.adGroup?.id ?? ""),
      headlines: (r.adGroupAd?.ad?.responsiveSearchAd?.headlines ?? []).map((h: any) => String(h.text ?? "")),
      descriptions: (r.adGroupAd?.ad?.responsiveSearchAd?.descriptions ?? []).map((d: any) => String(d.text ?? "")),
    }));

    const conversionActions: AdsConversionActionSummary[] = conversionRows.map((r) => ({
      id: String(r.conversionAction?.id ?? ""),
      name: String(r.conversionAction?.name ?? ""),
      status: String(r.conversionAction?.status ?? ""),
      category: String(r.conversionAction?.category ?? ""),
      type: String(r.conversionAction?.type ?? ""),
      primaryForGoal: Boolean(r.conversionAction?.primaryForGoal),
    }));

    const metrics: AdsCampaignMetrics[] = metricRows.map((r) => ({
      campaignId: String(r.campaign?.id ?? ""),
      campaignName: String(r.campaign?.name ?? ""),
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      costMicros: Number(r.metrics?.costMicros ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      ctr: Number(r.metrics?.ctr ?? 0),
    }));

    logger.info("Google Ads: lectura completada", {
      campaigns: campaigns.length,
      adGroups: adGroups.length,
      positiveKeywords: positiveKeywords.length,
      negativeKeywords: negativeKeywords.length,
      ads: ads.length,
      conversionActions: conversionActions.length,
    });

    recordCredentialSuccess("google_ads");
    return {
      customerId,
      loginCustomerId,
      metricsWindow: "LAST_30_DAYS",
      campaigns,
      adGroups,
      positiveKeywords,
      negativeKeywords,
      ads,
      conversionActions,
      metrics,
    };
  } catch (err) {
    const safeMessage = sanitizeError(err);
    logger.error("Fallo la lectura de Google Ads", { error: safeMessage });
    recordCredentialFailure("google_ads", safeMessage);
    throw new Error(`Lectura de Google Ads fallo: ${safeMessage}`);
  }
}

export interface KeywordIdea {
  text: string;
  avgMonthlySearches: number | null;
  competition: string;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
}

const SPAIN_GEO_TARGET_CONSTANT = "geoTargetConstants/2724";
const SPANISH_LANGUAGE_CONSTANT = "languageConstants/1003";

/**
 * Fase O32.4 -- KeywordPlanIdeaService.generateKeywordIdeas: da volumen
 * mensual medio y rango de puja orientativo para una lista de keywords
 * semilla. A diferencia de `googleAds:search`, esto NO consulta datos ya
 * existentes en la cuenta -- es una llamada de "ideas" standalone que NO
 * crea ningun KeywordPlan ni ningun otro recurso persistente en la
 * cuenta (esa es la diferencia frente al flujo de "forecast" basado en
 * KeywordPlan, que si requiere crear recursos via mutate y por eso NO se
 * usa aqui). Sigue siendo solo lectura: no activa nada, no gasta nada,
 * no modifica la cuenta.
 */
export async function generateKeywordIdeas(seedKeywords: string[]): Promise<KeywordIdea[]> {
  const customerId = normalizeCustomerId(resolveCustomerId());
  const developerToken = resolveClientSecret(resolveActiveClientId(), "GOOGLE_ADS_DEVELOPER_TOKEN");
  const loginCustomerId = normalizeCustomerId(resolveLoginCustomerId());
  const accessToken = await getAccessToken();
  const version = resolveApiVersion();

  const url = `https://googleads.googleapis.com/${version}/customers/${customerId}:generateKeywordIdeas`;
  const body = {
    keywordSeed: { keywords: seedKeywords },
    geoTargetConstants: [SPAIN_GEO_TARGET_CONSTANT],
    language: SPANISH_LANGUAGE_CONSTANT,
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Fallo de red llamando a generateKeywordIdeas (solo lectura): ${sanitizeError(err)}`);
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new Error(`Google Ads generateKeywordIdeas respondio ${response.status}: ${sanitizeError(bodyText)}`);
  }

  const data = (await response.json()) as { results?: Record<string, any>[] };
  return (data.results ?? []).map((r) => ({
    text: String(r.text ?? ""),
    avgMonthlySearches: r.keywordIdeaMetrics?.avgMonthlySearches != null ? Number(r.keywordIdeaMetrics.avgMonthlySearches) : null,
    competition: String(r.keywordIdeaMetrics?.competition ?? "UNSPECIFIED"),
    lowTopOfPageBidMicros: r.keywordIdeaMetrics?.lowTopOfPageBidMicros != null ? Number(r.keywordIdeaMetrics.lowTopOfPageBidMicros) : null,
    highTopOfPageBidMicros: r.keywordIdeaMetrics?.highTopOfPageBidMicros != null ? Number(r.keywordIdeaMetrics.highTopOfPageBidMicros) : null,
  }));
}

export { microsToEuros };
