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

const RELEVANT_CAMPAIGN_NAMES = [
  "SEM | Producto | Melamina y Fenólicas",
  "SEM | ES | Compra | Taquillas / Gimnasios",
  "SEM | Cerraduras inteligentes",
  "SEM | Sector | Colegios",
  "SEM | Sector | Empresas",
  "SEM | Marca | Zentry",
  "Zentry Lockers - Search ES - Leads B2B",
];

const FORBIDDEN = ["segunda mano", "gratis", "diy", "empleo", "barato", "baratas", "ikea", "particular", "particulares"];

async function main() {
  await init();
  const report = { generatedAt: new Date().toISOString(), campaigns: [], issues: [], allFinalUrls: new Set(), keywordIndex: {} };

  for (const name of RELEVANT_CAMPAIGN_NAMES) {
    const campaigns = await search(`
      SELECT campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.campaign_budget
      FROM campaign WHERE campaign.name = '${name}'
    `);
    if (campaigns.length === 0) { report.issues.push(`Campaña no encontrada: ${name}`); continue; }
    const c = campaigns[0].campaign;
    const budgets = await search(`SELECT campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.resource_name = '${c.campaignBudget}'`);
    const amountMicros = budgets[0]?.campaignBudget?.amountMicros;

    const camp = { name: c.name, status: c.status, dailyBudgetEUR: amountMicros ? Number(amountMicros) / 1_000_000 : null, adGroups: [] };
    if (c.status !== "PAUSED") report.issues.push(`CAMPAÑA NO PAUSADA: ${c.name} está en estado ${c.status}`);

    const adGroups = await search(`SELECT ad_group.id, ad_group.resource_name, ad_group.name, ad_group.status FROM ad_group WHERE ad_group.campaign = '${c.resourceName}'`);
    for (const agRow of adGroups) {
      const ag = agRow.adGroup;
      if (ag.status !== "PAUSED" && ag.status !== "REMOVED") report.issues.push(`AD GROUP NO PAUSADO: ${c.name} > ${ag.name} está en estado ${ag.status}`);

      const kws = await search(`SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion WHERE ad_group_criterion.ad_group = '${ag.resourceName}' AND ad_group_criterion.type = 'KEYWORD'`);
      const kwList = kws.map((k) => ({ text: k.adGroupCriterion.keyword.text, matchType: k.adGroupCriterion.keyword.matchType, status: k.adGroupCriterion.status }));
      for (const kw of kwList) {
        if (kw.status === "REMOVED") continue;
        const lower = kw.text.toLowerCase();
        for (const bad of FORBIDDEN) {
          if (lower.includes(bad)) report.issues.push(`KEYWORD PROHIBIDA: "${kw.text}" (${kw.matchType}) en ${c.name} > ${ag.name} contiene "${bad}"`);
        }
        const key = `${lower}|${kw.matchType}`;
        report.keywordIndex[key] = report.keywordIndex[key] || [];
        report.keywordIndex[key].push(`${c.name} > ${ag.name}`);
      }

      const ads = await search(`SELECT ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status FROM ad_group_ad WHERE ad_group_ad.ad_group = '${ag.resourceName}'`);
      const adList = ads.map((a) => {
        if (a.adGroupAd.status !== "PAUSED" && a.adGroupAd.status !== "REMOVED") report.issues.push(`AD NO PAUSADO: ${c.name} > ${ag.name} anuncio ${a.adGroupAd.ad.id} está en estado ${a.adGroupAd.status}`);
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

      camp.adGroups.push({ name: ag.name, status: ag.status, keywords: kwList, ads: adList });
    }
    report.campaigns.push(camp);
  }

  // Duplicate keyword detection across DIFFERENT campaigns (same text+matchType, active, in >1 campaign)
  const dupes = [];
  for (const [key, locations] of Object.entries(report.keywordIndex)) {
    const campaignsInvolved = new Set(locations.map((l) => l.split(" > ")[0]));
    if (campaignsInvolved.size > 1) dupes.push({ keyword: key, locations });
  }
  report.duplicateKeywordsAcrossCampaigns = dupes;

  // Conversion actions check
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
  const EXPECTED_PRIMARY = ["generate_lead_form_submit", "click_whatsapp", "click_phone"];
  for (const ca of report.conversionActions) {
    const isExpectedPrimary = EXPECTED_PRIMARY.some((e) => ca.name.toLowerCase().includes(e.replace(/_/g, " ")) || ca.name.toLowerCase().includes(e));
    if (ca.primaryForGoal === true && !isExpectedPrimary) {
      report.issues.push(`CONVERSIÓN PRIMARIA INESPERADA: "${ca.name}" (categoría ${ca.category}) está marcada primaryForGoal=true y no es una de las 3 esperadas`);
    }
  }

  report.allFinalUrls = [...report.allFinalUrls];
  fs.writeFileSync("/opt/zentry-ai-department/reports/o45-1-qa-report.json", JSON.stringify(report, null, 2));
  console.log("=== ISSUES FOUND:", report.issues.length, "===");
  report.issues.forEach((i) => console.log("- " + i));
  console.log("\n=== DUPLICATE KEYWORDS ACROSS CAMPAIGNS:", dupes.length, "===");
  dupes.forEach((d) => console.log("-", d.keyword, "->", d.locations.join(" | ")));
  console.log("\n=== FINAL URLS TO CHECK:", report.allFinalUrls.length, "===");
  report.allFinalUrls.forEach((u) => console.log("-", u));
  console.log("\n=== CONVERSION ACTIONS (primary) ===");
  report.conversionActions.filter((c) => c.primaryForGoal).forEach((c) => console.log("-", c.name, "|", c.category, "|", c.type));
  console.log("\nSaved full report to reports/o45-1-qa-report.json");
}

main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
