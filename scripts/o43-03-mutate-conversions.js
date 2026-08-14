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

// Classification (from O43 backup, reports/o43-ads-conversions-backup-*.json).
// Validate-only run (see o43-validate-out.txt) showed:
//  - WEBPAGE_CODELESS (7560422559) and LEAD_FORM_SUBMIT (7560422598) types: MUTATE_NOT_ALLOWED entirely via API -> excluded, need manual UI action.
//  - WEBPAGE type (7560709627, 7560824781): primaryForGoal IS mutable.
//  - GOOGLE_ANALYTICS_4_CUSTOM type (the 3 promote targets): primaryForGoal IS mutable, but includeInConversionsMetric is IMMUTABLE (Ads manages it automatically for GA4-synced actions) -> dropped from the update.
const DEMOTE_TO_SECONDARY = [
  { id: "7560709627", name: "Envío de formulario para clientes potenciales (1)" },
  { id: "7560824781", name: "Solicitud de presupuesto" },
];
const CANNOT_MUTATE_VIA_API = [
  { id: "7560422559", name: "Envío de formulario para clientes potenciales", reason: "type WEBPAGE_CODELESS, MUTATE_NOT_ALLOWED" },
  { id: "7560422598", name: "Formulario de contacto - Enviar", reason: "type LEAD_FORM_SUBMIT, MUTATE_NOT_ALLOWED" },
];
const PROMOTE_TO_PRIMARY = [
  { id: "7704254293", name: "generate_lead_form_submit" },
  { id: "7704254296", name: "click_whatsapp" },
  { id: "7704254299", name: "click_phone" },
];
// click_request_quote (7704254302) stays as-is (already primaryForGoal=false) -- no operation needed, confirmed secondary by default.

async function mutateConversionActions(customerId, loginCustomerId, developerToken, accessToken, operations, validateOnly) {
  const url = `https://googleads.googleapis.com/v24/customers/${customerId}/conversionActions:mutate`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": loginCustomerId,
    },
    body: JSON.stringify({ operations, validateOnly, partialFailure: false }),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Google Ads API ${r.status}: ${text}`);
  }
  return JSON.parse(text);
}

function buildOperations(customerId) {
  const ops = [];
  for (const item of DEMOTE_TO_SECONDARY) {
    ops.push({
      update: {
        resourceName: `customers/${customerId}/conversionActions/${item.id}`,
        primaryForGoal: false,
      },
      updateMask: "primaryForGoal",
    });
  }
  for (const item of PROMOTE_TO_PRIMARY) {
    ops.push({
      update: {
        resourceName: `customers/${customerId}/conversionActions/${item.id}`,
        primaryForGoal: true,
      },
      updateMask: "primaryForGoal",
    });
  }
  return ops;
}

async function main() {
  const mode = process.argv[2]; // "validate" or "apply"
  if (mode !== "validate" && mode !== "apply") {
    console.log("Usage: node o43-03-mutate-conversions.js validate|apply");
    return;
  }

  const customerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = await getAccessToken();

  const operations = buildOperations(customerId);
  console.log("Total operations:", operations.length);
  console.log("Demote to secondary:", DEMOTE_TO_SECONDARY.map((x) => x.name).join(" | "));
  console.log("Promote to primary:", PROMOTE_TO_PRIMARY.map((x) => x.name).join(" | "));
  console.log("Mode:", mode, "(validateOnly:", mode === "validate", ")");

  const result = await mutateConversionActions(customerId, loginCustomerId, developerToken, accessToken, operations, mode === "validate");
  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  if (mode === "apply") {
    fs.writeFileSync(`/opt/zentry-ai-department/reports/o43-mutate-result-${Date.now()}.json`, JSON.stringify({ operations, result }, null, 2));
  }
}
main().catch((e) => console.error("FATAL", e.message));
