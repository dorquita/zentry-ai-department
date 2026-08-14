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
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": loginCustomerId,
    },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Google Ads API ${r.status}: ${text.slice(0, 500)}`);
  }
  const data = await r.json();
  return data.results || [];
}

async function main() {
  const customerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = await getAccessToken();
  console.log("access token obtained:", !!accessToken);

  const campaigns = await searchGoogleAds(
    customerId, loginCustomerId, developerToken, accessToken,
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign"
  );
  console.log("\n=== CAMPAIGNS ===");
  campaigns.forEach((c) => console.log(c.campaign.id, "|", c.campaign.name, "| status:", c.campaign.status, "| channel:", c.campaign.advertisingChannelType, "| budget/day EUR:", c.campaignBudget ? (c.campaignBudget.amountMicros / 1e6) : "N/A"));

  const conversions = await searchGoogleAds(
    customerId, loginCustomerId, developerToken, accessToken,
    "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.type, conversion_action.primary_for_goal FROM conversion_action"
  );
  console.log("\n=== CONVERSION ACTIONS ===");
  if (conversions.length === 0) console.log("(ninguna accion de conversion configurada)");
  conversions.forEach((c) => console.log(c.conversionAction.id, "|", c.conversionAction.name, "| status:", c.conversionAction.status, "| category:", c.conversionAction.category, "| type:", c.conversionAction.type, "| primary:", c.conversionAction.primaryForGoal));

  const links = await searchGoogleAds(
    customerId, loginCustomerId, developerToken, accessToken,
    "SELECT customer.id, customer.descriptive_name FROM customer"
  ).catch((e) => { console.log("customer query failed:", e.message); return []; });
  console.log("\n=== ACCOUNT ===");
  links.forEach((c) => console.log(c.customer.id, "|", c.customer.descriptiveName));
}
main().catch((e) => console.error("FATAL", e.message));
