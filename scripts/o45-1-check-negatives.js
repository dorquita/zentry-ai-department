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
  const r = await fetch(`${base}/googleAds:search`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "developer-token": developerToken, "login-customer-id": loginCustomerId }, body: JSON.stringify({ query }) });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  return JSON.parse(text).results || [];
}
async function main() {
  await init();
  const rows = await search("SELECT ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.negative FROM ad_group_criterion WHERE ad_group_criterion.ad_group IN ('customers/8369126564/adGroups/199571950995','customers/8369126564/adGroups/199571951035','customers/8369126564/adGroups/199571951195') AND ad_group_criterion.type = 'KEYWORD'");
  rows.forEach(r => console.log(r.adGroup.name, '|', r.adGroupCriterion.keyword.text, '|', r.adGroupCriterion.keyword.matchType, '| negative:', r.adGroupCriterion.negative));
}
main().catch(e=>{console.error(e.message);process.exit(1);});
