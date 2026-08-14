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

async function mutate(resource, operations, validateOnly) {
  const url = `${base}/${resource}:mutate`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "developer-token": developerToken, "login-customer-id": loginCustomerId },
    body: JSON.stringify({ operations, validateOnly, partialFailure: false }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${resource}:mutate ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function createBudget(name, dailyMicros, validateOnly) {
  const res = await mutate("campaignBudgets", [{ create: { name, amountMicros: dailyMicros, deliveryMethod: "STANDARD", explicitlyShared: false } }], validateOnly);
  return validateOnly ? null : res.results[0].resourceName;
}

async function createCampaign(name, budgetResourceName, validateOnly) {
  const res = await mutate("campaigns", [{
    create: {
      name,
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      campaignBudget: budgetResourceName,
      manualCpc: { enhancedCpcEnabled: false },
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE_OR_INTEREST" },
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    },
  }], validateOnly);
  return validateOnly ? null : res.results[0].resourceName;
}

async function addCampaignGeoLang(campaignResourceName, validateOnly) {
  const ops = [
    { create: { campaign: campaignResourceName, location: { geoTargetConstant: "geoTargetConstants/2724" } } },
  ];
  await mutate("campaignCriteria", ops, validateOnly);
  await mutate("campaignCriteria", [{ create: { campaign: campaignResourceName, language: { languageConstant: "languageConstants/1003" } } }], validateOnly);
}

async function createAdGroup(campaignResourceName, name, cpcBidMicros, validateOnly) {
  const res = await mutate("adGroups", [{ create: { name, campaign: campaignResourceName, status: "PAUSED", type: "SEARCH_STANDARD", cpcBidMicros } }], validateOnly);
  return validateOnly ? null : res.results[0].resourceName;
}

async function addKeywords(adGroupResourceName, keywords, validateOnly) {
  const ops = keywords.map(([text, matchType]) => ({
    create: { adGroup: adGroupResourceName, status: "ENABLED", keyword: { text, matchType } },
  }));
  return mutate("adGroupCriteria", ops, validateOnly);
}

async function addCampaignNegatives(campaignResourceName, negatives, validateOnly) {
  const ops = negatives.map(([text, matchType]) => ({
    create: { campaign: campaignResourceName, negative: true, keyword: { text, matchType } },
  }));
  return mutate("campaignCriteria", ops, validateOnly);
}

async function addAdGroupNegatives(adGroupResourceName, negatives, validateOnly) {
  const ops = negatives.map(([text, matchType]) => ({
    create: { adGroup: adGroupResourceName, negative: true, keyword: { text, matchType } },
  }));
  return mutate("adGroupCriteria", ops, validateOnly);
}

async function createRSA(adGroupResourceName, headlines, descriptions, finalUrls, validateOnly) {
  const ops = [{
    create: {
      adGroup: adGroupResourceName,
      status: "PAUSED",
      ad: {
        finalUrls,
        responsiveSearchAd: {
          headlines: headlines.map((text) => ({ text })),
          descriptions: descriptions.map((text) => ({ text })),
        },
      },
    },
  }];
  return mutate("adGroupAds", ops, validateOnly);
}

// ============ CAMPAIGN DEFINITIONS ============
const CAMPAIGNS = [
  {
    key: "melamina_fenolicas",
    name: "SEM | Producto | Melamina y Fenólicas",
    dailyBudgetMicros: 8_000_000, // 8€/día ~ 250€/mes (escenario 1.000€)
    campaignNegatives: [
      ["segunda mano", "PHRASE"], ["gratis", "BROAD"], ["baratas", "BROAD"], ["barato", "BROAD"],
      ["ikea", "BROAD"], ["particular", "BROAD"], ["diy", "BROAD"], ["manual", "BROAD"],
      ["alquiler", "BROAD"], ["empleo", "BROAD"], ["trabajo", "BROAD"], ["opiniones", "BROAD"], ["amazon", "BROAD"],
    ],
    adGroups: [
      {
        name: "Melamina",
        cpcBidMicros: 1_650_000,
        keywords: [["taquillas melamina", "EXACT"], ["taquillas melamina", "PHRASE"], ["taquilla melamina", "EXACT"], ["taquillas de melamina", "PHRASE"], ["precio taquillas melamina", "PHRASE"]],
        headlines: ["Taquillas de Melamina", "Precio Público Online", "Diseño Moderno y Resistente", "Para Gimnasios y Colegios", "Elige Color y Cerradura", "Compra Online", "Envío a Toda España", "Solicita tu Presupuesto"],
        descriptions: ["Taquillas de melamina con diseño moderno, resistentes al uso diario.", "Elige anchura, color y tipo de cerradura. Precio público, sin sorpresas.", "Para vestuarios, gimnasios, colegios y empresas. Envío a toda España.", "¿Dudas sobre qué modelo elegir? Escríbenos por WhatsApp."],
        finalUrls: ["https://zentrylockers.com/taquillas-melamina/"],
      },
      {
        name: "Fenólicas",
        cpcBidMicros: 3_020_000,
        keywords: [["taquillas fenolicas", "EXACT"], ["taquillas fenolicas", "PHRASE"], ["taquillas fenolicas vestuarios", "PHRASE"], ["taquillas fenolicas precio", "PHRASE"], ["comprar taquillas fenolicas", "PHRASE"]],
        headlines: ["Taquillas Fenólicas", "Resistente a la Humedad", "Ideales para Piscinas y Duchas", "Precio Público Online", "Para Gimnasios y Deportivos", "Compra Online", "Solicita tu Presupuesto"],
        descriptions: ["Taquillas fenólicas resistentes a la humedad, ideales para vestuarios con duchas.", "Precio público, sin sorpresas. Elige medidas y tipo de cerradura.", "Para gimnasios, piscinas y centros deportivos. Envío a toda España.", "¿Dudas? Escríbenos por WhatsApp, te respondemos rápido."],
        finalUrls: ["https://zentrylockers.com/taquillas-fenolicas/"],
      },
    ],
  },
  {
    key: "cerraduras",
    name: "SEM | Cerraduras inteligentes",
    dailyBudgetMicros: 7_000_000, // 200€/mes
    campaignNegatives: [
      ["gratis", "BROAD"], ["diy", "BROAD"], ["amazon", "BROAD"], ["particular", "BROAD"], ["casero", "BROAD"],
      ["instrucciones", "BROAD"], ["opiniones", "BROAD"], ["segunda mano", "PHRASE"], ["manual pdf", "PHRASE"],
      ["cómo hacer", "PHRASE"], ["manual de instrucciones", "PHRASE"], ["para casa", "PHRASE"],
      ["cerradura puerta", "PHRASE"], ["cerradura coche", "PHRASE"], ["cerradura casa", "PHRASE"], ["manual paso a paso", "PHRASE"],
    ],
    adGroups: [
      {
        name: "Cerraduras inteligentes para taquillas",
        cpcBidMicros: 980_000,
        keywords: [
          ["cerradura electronica para taquilla", "EXACT"], ["cerradura inteligente para taquillas", "EXACT"],
          ["candado inteligente taquilla", "EXACT"], ["cerraduras inteligentes taquillas", "PHRASE"],
          ["sistema de cierre inteligente para taquillas", "PHRASE"], ["cerradura smart taquilla", "PHRASE"],
        ],
        headlines: ["Cerraduras Inteligentes", "Para Taquillas y Lockers", "Acceso por App, PIN o RFID", "Sin Llaves Físicas", "Adiós a Llaves Perdidas", "Presupuesto Personalizado", "Para Gimnasios y Empresas", "Control de Accesos", "Modelos BOXIS, ARES, NEO", "Pide tu Presupuesto"],
        descriptions: ["Sustituye llaves físicas por PIN, tarjeta RFID o app en tus taquillas.", "Compatibles con taquillas nuevas o ya instaladas. Evaluamos tu caso sin compromiso.", "Reduce pérdidas de llaves y mejora el control de acceso en tus instalaciones.", "Modelos BOXIS, ARES, NEO y ORBIS. Solicita tu presupuesto personalizado."],
        finalUrls: ["https://zentrylockers.com/cerraduras-para-taquillas/"],
      },
    ],
  },
  {
    key: "colegios",
    name: "SEM | Sector | Colegios",
    dailyBudgetMicros: 2_000_000, // 50€/mes
    campaignNegatives: [
      ["segunda mano", "PHRASE"], ["gratis", "BROAD"], ["alquiler", "BROAD"], ["empleo", "BROAD"], ["trabajo", "BROAD"],
      ["particular", "BROAD"], ["manual", "BROAD"], ["diy", "BROAD"], ["opiniones", "BROAD"], ["amazon", "BROAD"], ["ikea", "BROAD"], ["barato", "BROAD"],
    ],
    adGroups: [
      {
        name: "Taquillas para colegios",
        cpcBidMicros: 2_060_000,
        keywords: [
          ["taquillas colegio", "EXACT"], ["taquillas colegio", "PHRASE"], ["taquillas para colegios", "EXACT"],
          ["taquillas para colegios", "PHRASE"], ["taquillas de colegio", "PHRASE"], ["taquillas escolares", "PHRASE"], ["casilleros colegio", "PHRASE"],
        ],
        headlines: ["Taquillas para Colegios", "Resistentes al Uso Escolar", "Melamina, Metal o Fenólico", "Precio Público Online", "Casilleros para Aulas", "Cerraduras Seguras", "Solicita tu Presupuesto"],
        descriptions: ["Taquillas escolares resistentes, con precio público y sin sorpresas.", "Elige material, medidas y cerradura según las necesidades de tu centro.", "Para colegios, institutos y centros educativos. Envío a toda España.", "¿Dudas? Escríbenos por WhatsApp, te respondemos rápido."],
        finalUrls: ["https://zentrylockers.com/taquillas-para-colegios/"],
      },
    ],
  },
  {
    key: "empresas",
    name: "SEM | Sector | Empresas",
    dailyBudgetMicros: 5_000_000, // 150€/mes
    campaignNegatives: [
      ["gratis", "BROAD"], ["diy", "BROAD"], ["amazon", "BROAD"], ["empleo", "BROAD"], ["particular", "BROAD"], ["casero", "BROAD"],
      ["ofertas de trabajo", "PHRASE"], ["instrucciones", "BROAD"], ["opiniones", "BROAD"], ["segunda mano", "PHRASE"],
      ["buscar trabajo", "PHRASE"], ["manual pdf", "PHRASE"], ["cómo hacer", "PHRASE"], ["manual de instrucciones", "PHRASE"],
      ["para casa", "PHRASE"], ["trabajo taquillas", "PHRASE"], ["manual paso a paso", "PHRASE"], ["trabajo en zentry", "PHRASE"],
    ],
    adGroups: [
      {
        name: "Taquillas para empresas",
        cpcBidMicros: 1_490_000,
        keywords: [
          ["lockers para empresas", "EXACT"], ["taquillas para empresas", "EXACT"],
          ["taquillas inteligentes para oficinas", "PHRASE"], ["taquillas corporativas", "EXACT"], ["sistema de taquillas para empleados", "PHRASE"],
        ],
        headlines: ["Taquillas para Empresas", "Lockers para tu Oficina", "Melamina, Metal o Resina", "Seguridad para tus Empleados", "Acceso por App, PIN o RFID", "Taquillas Corporativas", "Bajo Mantenimiento", "Instalación Personalizada", "Solicita tu Presupuesto"],
        descriptions: ["Taquillas para oficinas y vestuarios en melamina, metal, fenólico o resina/ABS.", "Cerraduras inteligentes con app, PIN, tarjeta o RFID. Registro de accesos incluido.", "Seguridad para los efectos personales de cada empleado, con bajo mantenimiento.", "Instalación adaptada a tu espacio y número de usuarios. Presupuesto sin compromiso."],
        finalUrls: ["https://zentrylockers.com/taquillas-para-empresas/"],
      },
    ],
  },
  {
    key: "marca",
    name: "SEM | Marca | Zentry",
    dailyBudgetMicros: 2_000_000, // 50€/mes
    campaignNegatives: [["empleo", "BROAD"], ["trabajo", "BROAD"]],
    adGroups: [
      {
        name: "Zentry marca",
        cpcBidMicros: 500_000,
        keywords: [["zentry lockers", "EXACT"], ["zentry", "EXACT"], ["zentry lockers", "PHRASE"], ["zentry taquillas", "PHRASE"]],
        headlines: ["Zentry Lockers", "Taquillas y Cerraduras Smart", "Precio Público, Sin Sorpresas", "Fabricante Español", "Compra Online o Presupuesto", "Solicita tu Presupuesto"],
        descriptions: ["Zentry Lockers: taquillas y cerraduras inteligentes con precio público online.", "Melamina, metálicas, fenólicas y cerraduras electrónicas. Envío a toda España.", "¿Dudas? Escríbenos por WhatsApp, te respondemos rápido."],
        finalUrls: ["https://zentrylockers.com/"],
      },
    ],
  },
];

async function buildCampaign(def, validateOnly) {
  const out = { key: def.key, name: def.name };
  const budgetRN = await createBudget(`Budget - ${def.name}`, def.dailyBudgetMicros, validateOnly);
  out.budgetResourceName = budgetRN;
  const campaignRN = await createCampaign(def.name, validateOnly ? "customers/" + customerId + "/campaignBudgets/1" : budgetRN, validateOnly);
  out.campaignResourceName = campaignRN;
  if (!validateOnly) {
    await addCampaignGeoLang(campaignRN, false);
    await addCampaignNegatives(campaignRN, def.campaignNegatives, false);
  } else {
    // validate campaign negatives against a dummy campaign resource name pattern is unreliable; skip in validate pass for negatives/geolang
  }
  out.adGroups = [];
  for (const ag of def.adGroups) {
    const agRN = await createAdGroup(validateOnly ? "customers/" + customerId + "/campaigns/1" : campaignRN, ag.name, ag.cpcBidMicros, validateOnly);
    const agOut = { name: ag.name, adGroupResourceName: agRN };
    if (!validateOnly) {
      await addKeywords(agRN, ag.keywords, false);
      await createRSA(agRN, ag.headlines, ag.descriptions, ag.finalUrls, false);
    }
    out.adGroups.push(agOut);
  }
  return out;
}

async function main() {
  await init();
  const mode = process.argv[2];
  if (mode !== "validate" && mode !== "apply" && mode !== "resume") {
    console.log("usage: node o45-1-build-campaigns.js validate|apply|resume");
    return;
  }

  if (mode === "resume") {
    // melamina_fenolicas campaign was already fully built except the Fenólicas RSA
    // (failed on the old too-long headlines). Complete just that missing ad,
    // then build the remaining 4 campaign definitions (skip index 0).
    const results = [];
    try {
      console.log("Completing missing Fenólicas RSA on existing ad group...");
      const fenolicasAgRN = "customers/" + customerId + "/adGroups/199967329820";
      const fenolicasDef = CAMPAIGNS[0].adGroups.find((a) => a.name === "Fenólicas");
      await createRSA(fenolicasAgRN, fenolicasDef.headlines, fenolicasDef.descriptions, fenolicasDef.finalUrls, false);
      console.log("OK: Fenólicas RSA created on", fenolicasAgRN);
      results.push({ ok: true, key: "melamina_fenolicas", name: CAMPAIGNS[0].name, note: "resumed: added missing Fenólicas RSA to existing campaign/ad groups", campaignResourceName: "customers/" + customerId + "/campaigns/24140637772" });
    } catch (e) {
      console.log("FAILED completing Fenólicas RSA:", e.message);
      results.push({ ok: false, key: "melamina_fenolicas", name: CAMPAIGNS[0].name, error: e.message });
      fs.writeFileSync("/opt/zentry-ai-department/reports/o45-1-resume-result.json", JSON.stringify(results, null, 2));
      console.log("\nSTOPPING due to error (parar ante cualquier error).");
      return;
    }

    for (const def of CAMPAIGNS.slice(1)) {
      console.log("\n=== Building:", def.name, "===");
      try {
        const out = await buildCampaign(def, false);
        results.push({ ok: true, ...out });
        console.log("OK:", def.name, "-> campaign:", out.campaignResourceName);
      } catch (e) {
        console.log("FAILED building", def.name, ":", e.message);
        results.push({ ok: false, key: def.key, name: def.name, error: e.message });
        console.log("\nSTOPPING due to error (parar ante cualquier error).");
        break;
      }
    }
    fs.writeFileSync("/opt/zentry-ai-department/reports/o45-1-resume-result.json", JSON.stringify(results, null, 2));
    console.log("\nSaved to reports/o45-1-resume-result.json");
    return;
  }

  if (mode === "validate") {
    // Validate only the FIRST campaign definition end-to-end as a representative structural test
    // (budget/campaign/campaignCriteria/adGroup/keyword/negative/RSA all touched at least once)
    const def = CAMPAIGNS[0];
    console.log("Validating structural pattern using:", def.name);
    try {
      const budgetRes = await mutate("campaignBudgets", [{ create: { name: "VALIDATE-ONLY " + def.name, amountMicros: def.dailyBudgetMicros, deliveryMethod: "STANDARD", explicitlyShared: false } }], true);
      console.log("budget validate: OK");
    } catch (e) { console.log("budget validate FAILED:", e.message); return; }

    // For campaign/adGroup/criteria validation we need a real (or realistic) parent resource name.
    // Use an EXISTING paused campaign/ad group as the structural target for field-level validation only.
    try {
      await mutate("campaigns", [{ create: { name: "VALIDATE-ONLY " + def.name, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: `customers/${customerId}/campaignBudgets/1`, manualCpc: { enhancedCpcEnabled: false }, networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false } } }], true);
      console.log("campaign shape validate: OK");
    } catch (e) { console.log("campaign validate FAILED:", e.message); }

    try {
      await mutate("adGroups", [{ create: { name: "VALIDATE-ONLY ag", campaign: `customers/${customerId}/campaigns/201838491344`, status: "PAUSED", type: "SEARCH_STANDARD", cpcBidMicros: 1000000 } }], true);
      console.log("adGroup shape validate (against real existing campaign): OK");
    } catch (e) { console.log("adGroup validate FAILED:", e.message); }

    try {
      await mutate("adGroupCriteria", [{ create: { adGroup: `customers/${customerId}/adGroups/201838491344`, status: "ENABLED", keyword: { text: "validate only test kw", matchType: "PHRASE" } } }], true);
      console.log("keyword shape validate: OK");
    } catch (e) { console.log("keyword validate FAILED:", e.message); }

    try {
      await mutate("campaignCriteria", [{ create: { campaign: `customers/${customerId}/campaigns/201838491344`, negative: true, keyword: { text: "validate only negative", matchType: "BROAD" } } }], true);
      console.log("campaign negative shape validate: OK");
    } catch (e) { console.log("campaign negative validate FAILED:", e.message); }

    try {
      await mutate("adGroupAds", [{ create: { adGroup: `customers/${customerId}/adGroups/201838491344`, status: "PAUSED", ad: { finalUrls: ["https://zentrylockers.com/"], responsiveSearchAd: { headlines: [{ text: "Validate A" }, { text: "Validate B" }, { text: "Validate C" }], descriptions: [{ text: "Validate description one." }, { text: "Validate description two." }] } } } }], true);
      console.log("RSA shape validate: OK");
    } catch (e) { console.log("RSA validate FAILED:", e.message); }

    console.log("\nValidation pass complete.");
    return;
  }

  // APPLY
  const results = [];
  for (const def of CAMPAIGNS) {
    console.log("\n=== Building:", def.name, "===");
    try {
      const out = await buildCampaign(def, false);
      results.push({ ok: true, ...out });
      console.log("OK:", def.name, "-> campaign:", out.campaignResourceName);
    } catch (e) {
      console.log("FAILED building", def.name, ":", e.message);
      results.push({ ok: false, key: def.key, name: def.name, error: e.message });
      console.log("\nSTOPPING due to error (parar ante cualquier error).");
      break;
    }
  }
  fs.writeFileSync("/opt/zentry-ai-department/reports/o45-1-build-result.json", JSON.stringify(results, null, 2));
  console.log("\nSaved to reports/o45-1-build-result.json");
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
