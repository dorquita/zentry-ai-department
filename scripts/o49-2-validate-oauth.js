require("dotenv").config();
const { google } = require("googleapis");

function sanitize(err) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(
    /((?:access_token|refresh_token|client_secret|developer[_-]?token|api[_-]?key|private_key|authorization|bearer)\s*[:=]?\s*)["']?[A-Za-z0-9\-_.\/+=]{8,}["']?/gi,
    "$1[REDACTED]"
  ).slice(0, 400);
}

async function getToken(clientId, clientSecret, refreshToken) {
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("getAccessToken() no devolvio ningun token.");
  return token;
}

const results = [];

async function testGSC() {
  try {
    const token = await getToken(process.env.GSC_OAUTH_CLIENT_ID, process.env.GSC_OAUTH_CLIENT_SECRET, process.env.GSC_OAUTH_REFRESH_TOKEN);
    const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    const json = JSON.parse(text);
    results.push({ service: "Search Console", ok: true, detail: `${(json.siteEntry || []).length} sitio(s) accesibles` });
  } catch (e) {
    results.push({ service: "Search Console", ok: false, detail: sanitize(e) });
  }
}

async function testGA4() {
  try {
    const token = await getToken(process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID, process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET, process.env.GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN);
    const propertyId = process.env.GA4_PROPERTY_ID;
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "yesterday", endDate: "today" }],
        metrics: [{ name: "sessions" }],
      }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    results.push({ service: "GA4", ok: true, detail: `runReport OK sobre property ${propertyId}` });
  } catch (e) {
    results.push({ service: "GA4", ok: false, detail: sanitize(e) });
  }
}

async function testGTM() {
  try {
    const token = await getToken(process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID, process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET, process.env.GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN);
    const containerId = process.env.GTM_CONTAINER_ID;
    const r = await fetch(`https://www.googleapis.com/tagmanager/v2/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    const json = JSON.parse(text);
    results.push({ service: "GTM", ok: true, detail: `${(json.account || []).length} cuenta(s) GTM accesibles (containerId configurado: ${containerId ? "si" : "no"})` });
  } catch (e) {
    results.push({ service: "GTM", ok: false, detail: sanitize(e) });
  }
}

async function testGoogleAds() {
  try {
    const token = await getToken(process.env.GOOGLE_ADS_OAUTH_CLIENT_ID, process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET, process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN);
    const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/-/g, "");
    const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
    const r = await fetch(`https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "SELECT customer.id FROM customer LIMIT 1" }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    results.push({ service: "Google Ads", ok: true, detail: `googleAds:search OK sobre customer ${customerId}` });
  } catch (e) {
    results.push({ service: "Google Ads", ok: false, detail: sanitize(e) });
  }
}

async function main() {
  await testGSC();
  await testGA4();
  await testGTM();
  await testGoogleAds();
  console.log("========== VALIDACION OAUTH (O49.2) ==========");
  for (const r of results) {
    console.log(`${r.ok ? "OK  " : "FAIL"} | ${r.service.padEnd(16)} | ${r.detail}`);
  }
  const anyInvalidGrant = results.some((r) => !r.ok && /invalid_grant/i.test(r.detail));
  console.log("\n¿Sigue habiendo invalid_grant en algun servicio?", anyInvalidGrant ? "SI" : "NO");
}
main();
