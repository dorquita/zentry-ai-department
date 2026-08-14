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

async function mutate(resource, operations) {
  const url = `${base}/${resource}:mutate`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "developer-token": developerToken, "login-customer-id": loginCustomerId },
    body: JSON.stringify({ operations, partialFailure: false }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${resource}:mutate ${r.status}: ${text}`);
  return JSON.parse(text);
}

const CAMPAIGN_RN = "customers/8369126564/campaigns/23726061328";
const BUDGET_RN = "customers/8369126564/campaignBudgets/15486710065";
const AD_GROUP_RN = "customers/8369126564/adGroups/201838491344";
const OLD_AD_RN = "customers/8369126564/adGroupAds/201838491344~803754613588";

const NEW_HEADLINES = [
  "Taquillas para Gimnasios",
  "Cerraduras Inteligentes",
  "Acceso por App, PIN o RFID",
  "Precio Público Online",
  "Resistentes al Uso Diario",
  "Para Centros Deportivos",
  "Compra Online",
  "Solicita tu Presupuesto",
  "Melamina, Metal o Fenólico",
  "Envío a Toda España",
];
const NEW_DESCRIPTIONS = [
  "Taquillas para gimnasios y centros deportivos, con precio público online.",
  "Cerraduras inteligentes con PIN, RFID o app. Sin llaves físicas que perder.",
  "Elige material, medidas y tipo de cerradura. Presupuesto sin compromiso.",
  "¿Dudas sobre qué modelo elegir? Escríbenos por WhatsApp, respuesta rápida.",
];
const NEW_FINAL_URL = "https://zentrylockers.com/taquillas-para-gimnasios/";
const NEW_DAILY_BUDGET_MICROS = 10_000_000; // 10€/día = 300€/mes, escenario A del informe O45.0

async function main() {
  await init();
  const log = [];

  console.log("1) Renombrando campaña...");
  await mutate("campaigns", [{
    update: { resourceName: CAMPAIGN_RN, name: "SEM | ES | Compra | Taquillas / Gimnasios" },
    updateMask: "name",
  }]);
  log.push("Campaña renombrada a 'SEM | ES | Compra | Taquillas / Gimnasios'");
  console.log("OK");

  console.log("2) Actualizando presupuesto a 10€/día (300€/mes, escenario A)...");
  await mutate("campaignBudgets", [{
    update: { resourceName: BUDGET_RN, amountMicros: NEW_DAILY_BUDGET_MICROS },
    updateMask: "amount_micros",
  }]);
  log.push("Presupuesto actualizado: 5€/día -> 10€/día (150€/mes -> 300€/mes)");
  console.log("OK");

  console.log("3) Pausando ad group Test1 (estaba ENABLED, campaña ya estaba PAUSED)...");
  await mutate("adGroups", [{
    update: { resourceName: AD_GROUP_RN, status: "PAUSED" },
    updateMask: "status",
  }]);
  log.push("Ad group Test1 pasado de ENABLED a PAUSED (defensa en profundidad, la campaña ya estaba pausada)");
  console.log("OK");

  console.log("4) Creando nuevo RSA (sin Barcelona/demo gratuita, con landing /taquillas-para-gimnasios/)...");
  const createRes = await mutate("adGroupAds", [{
    create: {
      adGroup: AD_GROUP_RN,
      status: "PAUSED",
      ad: {
        finalUrls: [NEW_FINAL_URL],
        responsiveSearchAd: {
          headlines: NEW_HEADLINES.map((text) => ({ text })),
          descriptions: NEW_DESCRIPTIONS.map((text) => ({ text })),
        },
      },
    },
  }]);
  const newAdRN = createRes.results[0].resourceName;
  log.push(`Nuevo RSA creado (PAUSED): ${newAdRN}, final URL: ${NEW_FINAL_URL}`);
  console.log("OK:", newAdRN);

  console.log("5) Eliminando el RSA antiguo (Barcelona / demo gratuita / home como landing)...");
  await mutate("adGroupAds", [{ remove: OLD_AD_RN }]);
  log.push(`RSA antiguo eliminado: ${OLD_AD_RN} (mencionaba Barcelona y demo gratuita, apuntaba a home)`);
  console.log("OK");

  fs.writeFileSync("/opt/zentry-ai-department/reports/o45-1-edit-test1-result.json", JSON.stringify({ ok: true, log, newAdResourceName: newAdRN }, null, 2));
  console.log("\nSaved to reports/o45-1-edit-test1-result.json");
}

main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
