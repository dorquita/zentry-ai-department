require("dotenv").config();
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

async function dumpCampaign(name) {
  const campaigns = await search(`
    SELECT campaign.id, campaign.resource_name, campaign.name, campaign.status, campaign.campaign_budget
    FROM campaign
    WHERE campaign.name = '${name}'
  `);
  console.log(`\n########## CAMPAIGN: ${name} ##########`);
  console.log(JSON.stringify(campaigns, null, 2));
  if (campaigns.length === 0) return;
  const campaignRN = campaigns[0].campaign.resourceName;
  const campaignId = campaigns[0].campaign.id;

  const budgets = await search(`
    SELECT campaign_budget.id, campaign_budget.amount_micros, campaign_budget.resource_name
    FROM campaign_budget WHERE campaign_budget.resource_name = '${campaigns[0].campaign.campaignBudget}'
  `);
  console.log("--- BUDGET ---");
  console.log(JSON.stringify(budgets, null, 2));

  const adGroups = await search(`
    SELECT ad_group.id, ad_group.resource_name, ad_group.name, ad_group.status, ad_group.cpc_bid_micros
    FROM ad_group WHERE ad_group.campaign = '${campaignRN}'
  `);
  console.log("--- AD GROUPS ---");
  console.log(JSON.stringify(adGroups, null, 2));

  for (const ag of adGroups) {
    const agRN = ag.adGroup.resourceName;
    const keywords = await search(`
      SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status
      FROM ad_group_criterion WHERE ad_group_criterion.ad_group = '${agRN}' AND ad_group_criterion.type = 'KEYWORD'
    `);
    console.log(`--- KEYWORDS for ${ag.adGroup.name} ---`);
    console.log(JSON.stringify(keywords, null, 2));

    const ads = await search(`
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.resource_name, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status
      FROM ad_group_ad WHERE ad_group_ad.ad_group = '${agRN}'
    `);
    console.log(`--- ADS for ${ag.adGroup.name} ---`);
    console.log(JSON.stringify(ads, null, 2));
  }
}

async function main() {
  await init();
  await dumpCampaign("SEM | ES | Compra | Taquillas");
  await dumpCampaign("Zentry Lockers - Search ES - Leads B2B");
}

main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
