require("dotenv").config();
const fs = require("fs");
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
    throw new Error(`Google Ads API ${r.status}: ${text.slice(0, 1000)}`);
  }
  const data = await r.json();
  return data.results || [];
}

async function main() {
  const customerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = await getAccessToken();

  const query = `SELECT
    conversion_action.id,
    conversion_action.name,
    conversion_action.status,
    conversion_action.category,
    conversion_action.type,
    conversion_action.primary_for_goal,
    conversion_action.include_in_conversions_metric,
    conversion_action.counting_type,
    conversion_action.click_through_lookback_window_days,
    conversion_action.view_through_lookback_window_days,
    conversion_action.value_settings.default_value,
    conversion_action.value_settings.default_currency_code,
    conversion_action.value_settings.always_use_default_value,
    conversion_action.attribution_model_settings.attribution_model,
    conversion_action.attribution_model_settings.data_driven_model_status,
    conversion_action.owner_customer,
    conversion_action.app_id,
    conversion_action.firebase_settings.property_id,
    conversion_action.google_analytics_4_settings.property_id,
    conversion_action.google_analytics_4_settings.event_name
    FROM conversion_action
    ORDER BY conversion_action.id`;

  const results = await searchGoogleAds(customerId, loginCustomerId, developerToken, accessToken, query);

  const backup = {
    takenAt: new Date().toISOString(),
    source: "O43 pre-change backup",
    customerId,
    conversionActions: results,
  };

  const filename = `/opt/zentry-ai-department/reports/o43-ads-conversions-backup-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(backup, null, 2));
  console.log("Backed up", results.length, "conversion actions to", filename);
  console.log("\n=== SUMMARY ===");
  results.forEach((r) => {
    const c = r.conversionAction;
    console.log(
      c.id, "|", c.name,
      "| status:", c.status,
      "| category:", c.category,
      "| type:", c.type,
      "| primary:", c.primaryForGoal,
      "| includeInMetric:", c.includeInConversionsMetric,
      "| counting:", c.countingType,
      "| ga4_event:", c.googleAnalytics4Settings ? c.googleAnalytics4Settings.eventName : null
    );
  });
}
main().catch((e) => console.error("FATAL", e.message));
