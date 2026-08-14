require("dotenv").config();
const { google } = require("googleapis");

function normalizeCustomerId(raw) {
  return raw.replace(/-/g, "").trim();
}

async function getAccessToken() {
  const client = new google.auth.OAuth2(process.env.GOOGLE_ADS_OAUTH_CLIENT_ID, process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN });
  const { token } = await client.getAccessToken();
  return token;
}

async function searchGoogleAds(customerId, loginCustomerId, developerToken, accessToken, query) {
  const url = `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`;
  const results = [];
  let pageToken;
  do {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
      },
      body: JSON.stringify({ query, pageToken }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Google Ads API ${r.status}: ${text.slice(0, 800)}`);
    }
    const data = await r.json();
    results.push(...(data.results || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

async function generateKeywordIdeas(customerId, loginCustomerId, developerToken, accessToken, seedKeywords) {
  const url = `https://googleads.googleapis.com/v24/customers/${customerId}:generateKeywordIdeas`;
  const body = {
    language: "languageConstants/1003", // Spanish
    geoTargetConstants: ["geoTargetConstants/2724"], // Spain
    includeAdultKeywords: false,
    keywordSeed: { keywords: seedKeywords },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": loginCustomerId,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    return { error: `${r.status}: ${text.slice(0, 1000)}` };
  }
  return JSON.parse(text);
}

async function main() {
  const customerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = await getAccessToken();
  console.log("access token obtained:", !!accessToken);

  const q = (query) => searchGoogleAds(customerId, loginCustomerId, developerToken, accessToken, query);

  console.log("\n=== 1. CAMPAIGNS (full detail) ===");
  try {
    const campaigns = await q(`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
      campaign.bidding_strategy_type, campaign_budget.amount_micros, campaign_budget.delivery_method
      FROM campaign`);
    campaigns.forEach((c) => {
      console.log(JSON.stringify(c.campaign), "| budget/day EUR:", c.campaignBudget ? c.campaignBudget.amountMicros / 1e6 : "N/A");
    });
  } catch (e) { console.log("campaign query failed:", e.message); }

  console.log("\n=== 2. CAMPAIGN CRITERIA (location/language) ===");
  try {
    const crit = await q(`SELECT campaign.id, campaign.name, campaign_criterion.type, campaign_criterion.negative,
      campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant,
      campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
      FROM campaign_criterion`);
    crit.forEach((c) => console.log(JSON.stringify(c.campaignCriterion)));
  } catch (e) {
    console.log("campaign_criterion query failed:", e.message);
  }

  console.log("\n=== 3. AD GROUPS ===");
  try {
    const adGroups = await q(`SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, campaign.name FROM ad_group`);
    adGroups.forEach((a) => console.log(a.adGroup.id, "|", a.adGroup.name, "| status:", a.adGroup.status, "| campaign:", a.campaign.name));
  } catch (e) { console.log("ad_group query failed:", e.message); }

  console.log("\n=== 4. POSITIVE KEYWORDS (ad_group_criterion) ===");
  try {
    const kws = await q(`SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
      ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, ad_group.name, campaign.name
      FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = false`);
    kws.forEach((k) => console.log(JSON.stringify(k.adGroupCriterion), "| adGroup:", k.adGroup.name, "| campaign:", k.campaign.name));
  } catch (e) { console.log("positive keywords query failed:", e.message); }

  console.log("\n=== 5. NEGATIVE KEYWORDS (ad_group level) ===");
  try {
    const negAdGroup = await q(`SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
      ad_group.name, campaign.name
      FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = true`);
    negAdGroup.forEach((k) => console.log(k.adGroupCriterion.keyword.text, "|", k.adGroupCriterion.keyword.matchType, "| adGroup:", k.adGroup.name));
    console.log("total ad-group-level negatives:", negAdGroup.length);
  } catch (e) { console.log("ad-group negatives query failed:", e.message); }

  console.log("\n=== 6. NEGATIVE KEYWORDS (campaign level) ===");
  try {
    const negCampaign = await q(`SELECT campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign.name
      FROM campaign_criterion WHERE campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = true`);
    negCampaign.forEach((k) => console.log(k.campaignCriterion.keyword.text, "|", k.campaignCriterion.keyword.matchType, "| campaign:", k.campaign.name));
    console.log("total campaign-level negatives:", negCampaign.length);
  } catch (e) {
    console.log("campaign-level negatives query failed:", e.message);
  }

  console.log("\n=== 7. RSA ADS (headlines/descriptions) ===");
  try {
    const ads = await q(`SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, ad_group.name, campaign.name
      FROM ad_group_ad`);
    ads.forEach((a) => {
      console.log("\n--- Ad", a.adGroupAd.ad.id, "| status:", a.adGroupAd.status, "| adGroup:", a.adGroup.name, "| campaign:", a.campaign.name, "---");
      console.log("final_urls:", a.adGroupAd.ad.finalUrls);
      const rsa = a.adGroupAd.ad.responsiveSearchAd;
      if (rsa) {
        console.log("headlines:", (rsa.headlines || []).map((h) => h.text));
        console.log("descriptions:", (rsa.descriptions || []).map((d) => d.text));
      }
    });
  } catch (e) { console.log("ad_group_ad query failed:", e.message); }

  console.log("\n=== 8. HISTORICAL METRICS (campaign, LAST_90_DAYS) ===");
  try {
    const metrics = await q(`SELECT campaign.name, segments.date, metrics.clicks, metrics.impressions, metrics.cost_micros,
      metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM campaign WHERE segments.date DURING LAST_90_DAYS`);
    console.log("rows:", metrics.length);
    // aggregate by campaign
    const agg = {};
    metrics.forEach((m) => {
      const name = m.campaign.name;
      agg[name] = agg[name] || { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
      agg[name].clicks += Number(m.metrics.clicks || 0);
      agg[name].impressions += Number(m.metrics.impressions || 0);
      agg[name].cost += Number(m.metrics.costMicros || 0) / 1e6;
      agg[name].conversions += Number(m.metrics.conversions || 0);
    });
    console.log("aggregated 90d by campaign:", JSON.stringify(agg, null, 2));
  } catch (e) {
    console.log("LAST_90_DAYS campaign metrics query failed:", e.message);
    try {
      const metrics30 = await q(`SELECT campaign.name, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
        FROM campaign WHERE segments.date DURING LAST_30_DAYS`);
      console.log("LAST_30_DAYS rows:", metrics30.length, JSON.stringify(metrics30));
    } catch (e2) {
      console.log("LAST_30_DAYS also failed:", e2.message);
    }
  }

  console.log("\n=== 9. HISTORICAL METRICS ALL-TIME (no date filter, campaign resource lifetime not directly queryable; trying wide explicit range) ===");
  try {
    const wide = await q(`SELECT campaign.name, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
      FROM campaign WHERE segments.date BETWEEN '2025-01-01' AND '2026-08-14'`);
    const agg2 = {};
    wide.forEach((m) => {
      const name = m.campaign.name;
      agg2[name] = agg2[name] || { clicks: 0, impressions: 0, cost: 0, conversions: 0, days: 0 };
      agg2[name].clicks += Number(m.metrics.clicks || 0);
      agg2[name].impressions += Number(m.metrics.impressions || 0);
      agg2[name].cost += Number(m.metrics.costMicros || 0) / 1e6;
      agg2[name].conversions += Number(m.metrics.conversions || 0);
      agg2[name].days += 1;
    });
    console.log("aggregated 2025-01-01..2026-08-14 by campaign:", JSON.stringify(agg2, null, 2));
  } catch (e) {
    console.log("wide range query failed:", e.message);
  }

  console.log("\n=== 10. KEYWORD PLANNER (generateKeywordIdeas) ===");
  const seeds = ["taquillas metalicas precio", "taquillas para gimnasio", "taquillas vestuario empresa", "cerraduras electronicas taquillas", "taquillas colegio", "presupuesto taquillas", "taquillas segunda mano", "digitalizacion taquillas"];
  const ideas = await generateKeywordIdeas(customerId, loginCustomerId, developerToken, accessToken, seeds);
  if (ideas.error) {
    console.log("Keyword Planner FAILED:", ideas.error);
  } else {
    const results = ideas.results || [];
    console.log("Keyword Planner results:", results.length);
    results.forEach((r) => {
      const m = r.keywordIdeaMetrics || {};
      console.log(r.text, "| avg monthly searches:", m.avgMonthlySearches, "| competition:", m.competition, "| low bid micros:", m.lowTopOfPageBidMicros, "| high bid micros:", m.highTopOfPageBidMicros);
    });
  }
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
