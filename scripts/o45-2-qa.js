require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");

function norm(r) { return r.replace(/-/g, "").trim(); }

let accessToken, customerId, loginCustomerId, developerToken, base;

async function init() {
  const client = new google.auth.OAuth2(process.env.GOOGLE_ADS_OAUTH_CLIENT_ID, process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN });
  const { token } = await client.getAccessToken();
  accessToken = token;
  customerId = norm(process.env.GOOGLE_ADS_CUSTOMER_ID);
  loginCustomerId = norm(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  base = `https://googleads.googleapis.com/v24/customers/${customerId}`;
}

async function search(query) {
  const r = await fetch(`${base}/googleAds:search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "developer-token": developerToken, "login-customer-id": loginCustomerId },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`search ${r.status}: ${text}`);
  return JSON.parse(text).results || [];
}

const NEW_CAMPAIGN_NAMES = [
  "SEM | Producto | Melamina y Fenólicas",
  "SEM | ES | Compra | Taquillas / Gimnasios",
  "SEM | Cerraduras inteligentes",
  "SEM | Sector | Colegios",
  "SEM | Sector | Empresas",
  "SEM | Marca | Zentry",
];
const LEGACY_CAMPAIGN_NAME = "Zentry Lockers - Search ES - Leads B2B";
const ALL_NAMES = [...NEW_CAMPAIGN_NAMES, LEGACY_CAMPAIGN_NAME];

const FORBIDDEN = [
  "gratis", "segunda mano", "empleo", "trabajo", "ikea", "leroy", "amazon", "wallapop",
  "particular", "manual", "abrir cerradura", "resetear cerradura", "barato", "baratas",
];

async function main() {
  await init();
  const report = { campaigns: [], allFinalUrls: new Set(), forbiddenHits: [], keywordIndexNewOnly: {}, keywordIndexAll: {} };

  for (const name of ALL_NAMES) {
    const isLegacy = name === LEGACY_CAMPAIGN_NAME;
    const campaigns = await search(`
      SELECT campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.campaign_budget
      FROM campaign WHERE campaign.name = '${name}'
    `);
    if (campaigns.length === 0) { console.log("NO ENCONTRADA:", name); continue; }
    const c = campaigns[0].campaign;
    const budgets = await search(`SELECT campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.resource_name = '${c.campaignBudget}'`);
    const dailyBudgetEUR = budgets[0]?.campaignBudget?.amountMicros ? Number(budgets[0].campaignBudget.amountMicros) / 1_000_000 : null;

    const camp = { name: c.name, status: c.status, dailyBudgetEUR, isLegacy, adGroups: [] };

    const adGroups = await search(`SELECT ad_group.id, ad_group.resource_name, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.campaign = '${c.resourceName}'`);
    for (const agRow of adGroups) {
      const ag = agRow.adGroup;
      const kws = await search(`SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative FROM ad_group_criterion WHERE ad_group_criterion.ad_group = '${ag.resourceName}' AND ad_group_criterion.type = 'KEYWORD'`);
      const kwList = kws.map((k) => ({ text: k.adGroupCriterion.keyword.text, matchType: k.adGroupCriterion.keyword.matchType, status: k.adGroupCriterion.status, negative: k.adGroupCriterion.negative === true }));

      for (const kw of kwList) {
        if (kw.negative || kw.status === "REMOVED") continue;
        const lower = kw.text.toLowerCase();
        for (const bad of FORBIDDEN) {
          if (lower.includes(bad)) report.forbiddenHits.push({ campaign: c.name, adGroup: ag.name, keyword: kw.text, matchType: kw.matchType, matchedTerm: bad });
        }
        const key = `${lower}|${kw.matchType}`;
        report.keywordIndexAll[key] = report.keywordIndexAll[key] || [];
        report.keywordIndexAll[key].push(c.name);
        if (!isLegacy) {
          report.keywordIndexNewOnly[key] = report.keywordIndexNewOnly[key] || [];
          report.keywordIndexNewOnly[key].push(c.name);
        }
      }

      const campNeg = await search(`SELECT campaign_criterion.keyword.text FROM campaign_criterion WHERE campaign_criterion.campaign = '${c.resourceName}' AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE`);

      const ads = await search(`SELECT ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.ad_group = '${ag.resourceName}'`);
      const adList = ads.map((a) => {
        const finalUrls = a.adGroupAd.ad.finalUrls || [];
        finalUrls.forEach((u) => report.allFinalUrls.add(u));
        return {
          id: a.adGroupAd.ad.id,
          status: a.adGroupAd.status,
          finalUrls,
          headlines: (a.adGroupAd.ad.responsiveSearchAd?.headlines || []).map((h) => h.text),
          descriptions: (a.adGroupAd.ad.responsiveSearchAd?.descriptions || []).map((d) => d.text),
        };
      });

      camp.adGroups.push({
        name: ag.name,
        status: ag.status,
        positiveKeywords: kwList.filter((k) => !k.negative && k.status !== "REMOVED"),
        adGroupNegativeCount: kwList.filter((k) => k.negative).length,
        campaignNegativeCount: campNeg.length,
        ads: adList,
      });
    }
    report.campaigns.push(camp);
  }

  const dupesNewOnly = Object.entries(report.keywordIndexNewOnly).filter(([, camps]) => new Set(camps).size > 1);
  const dupesAll = Object.entries(report.keywordIndexAll).filter(([, camps]) => new Set(camps).size > 1);

  const convActions = await search(`
    SELECT conversion_action.name, conversion_action.status, conversion_action.primary_for_goal, conversion_action.category, conversion_action.type
    FROM conversion_action WHERE conversion_action.status != 'REMOVED'
  `);
  report.conversionActions = convActions.map((r) => ({
    name: r.conversionAction.name,
    status: r.conversionAction.status,
    primaryForGoal: r.conversionAction.primaryForGoal,
    category: r.conversionAction.category,
    type: r.conversionAction.type,
  }));

  report.allFinalUrls = [...report.allFinalUrls];
  report.duplicateKeywordsAmongNewCampaigns = dupesNewOnly.map(([k, c]) => ({ keyword: k, campaigns: [...new Set(c)] }));
  report.duplicateKeywordsIncludingLegacy = dupesAll.map(([k, c]) => ({ keyword: k, campaigns: [...new Set(c)] }));

  fs.writeFileSync("/opt/zentry-ai-department/reports/o45-2-qa-report.json", JSON.stringify(report, null, 2));

  console.log("========== CAMPAÑAS ==========");
  for (const c of report.campaigns) {
    console.log(`\n[${c.isLegacy ? "LEGACY" : "NUEVA"}] ${c.name} | status=${c.status} | ${c.dailyBudgetEUR}€/día`);
    for (const ag of c.adGroups) {
      console.log(`  - Ad group "${ag.name}" [${ag.status}] | keywords positivas: ${ag.positiveKeywords.length} | negativas AG: ${ag.adGroupNegativeCount} | negativas campaña: ${ag.campaignNegativeCount}`);
      ag.positiveKeywords.forEach((k) => console.log(`      KW: "${k.text}" (${k.matchType}) [${k.status}]`));
      ag.ads.forEach((ad) => {
        console.log(`      AD [${ad.status}] finalUrl=${ad.finalUrls.join(",")}`);
        console.log(`        Headlines: ${ad.headlines.join(" | ")}`);
        console.log(`        Descriptions: ${ad.descriptions.join(" || ")}`);
      });
    }
  }

  console.log("\n========== FORBIDDEN KEYWORD HITS (positivas, no negativas) ==========");
  console.log(report.forbiddenHits.length === 0 ? "Ninguna." : JSON.stringify(report.forbiddenHits, null, 2));

  console.log("\n========== DUPLICADAS SOLO ENTRE CAMPAÑAS NUEVAS ==========");
  console.log(report.duplicateKeywordsAmongNewCampaigns.length === 0 ? "Ninguna." : JSON.stringify(report.duplicateKeywordsAmongNewCampaigns, null, 2));

  console.log("\n========== DUPLICADAS INCLUYENDO LEGACY ==========");
  report.duplicateKeywordsIncludingLegacy.forEach((d) => console.log(`- ${d.keyword} -> ${d.campaigns.join(", ")}`));

  console.log("\n========== FINAL URLS ==========");
  report.allFinalUrls.forEach((u) => console.log("-", u));

  console.log("\n========== CONVERSION ACTIONS (todas no removidas) ==========");
  report.conversionActions.forEach((c) => console.log(`- ${c.name} | primary=${c.primaryForGoal} | ${c.category} | ${c.type} | ${c.status}`));

  console.log("\nGuardado en reports/o45-2-qa-report.json");
}

main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
