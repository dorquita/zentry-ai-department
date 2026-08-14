require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function fetchAllVariations(env, productId) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(env.base + "/wp-json/wc/v3/products/" + productId + "/variations?per_page=100&page=" + page, { headers: { Authorization: env.auth } });
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

function comboKey(v) {
  return v.attributes.map((a) => (a.name + "=" + a.option).toLowerCase()).sort().join("|");
}

async function main() {
  const stagingProducts = JSON.parse(require("fs").readFileSync("/opt/zentry-ai-department/reports/o36-catalog-staging-full.json", "utf8"));
  const variableIds = stagingProducts.filter((p) => p.type === "variable").map((p) => p.id);

  let totalCombos = 0,
    matching = 0,
    mismatched = [],
    missingInProd = [],
    extraInProd = [];

  for (const pid of variableIds) {
    const [sv, pv] = await Promise.all([fetchAllVariations(staging, pid), fetchAllVariations(prod, pid)]);
    const svByCombo = new Map(sv.map((v) => [comboKey(v), v]));
    const pvByCombo = new Map(pv.map((v) => [comboKey(v), v]));

    for (const [combo, s] of svByCombo) {
      totalCombos++;
      const p = pvByCombo.get(combo);
      if (!p) {
        missingInProd.push({ productId: pid, combo });
        continue;
      }
      if (s.regular_price === p.regular_price && s.sale_price === p.sale_price && s.price === p.price) {
        matching++;
      } else {
        mismatched.push({ productId: pid, combo, staging: { regular: s.regular_price, sale: s.sale_price, price: s.price }, prod: { regular: p.regular_price, sale: p.sale_price, price: p.price } });
      }
    }
    for (const combo of pvByCombo.keys()) {
      if (!svByCombo.has(combo)) extraInProd.push({ productId: pid, combo });
    }
  }

  console.log("=== VARIATION-LEVEL COMPARISON ===");
  console.log("total staging combos:", totalCombos);
  console.log("matching exactly:", matching);
  console.log("mismatched price:", mismatched.length);
  console.log("missing in production:", missingInProd.length);
  console.log("extra in production (not in staging):", extraInProd.length);

  if (mismatched.length) {
    console.log("\nmismatches:");
    mismatched.slice(0, 20).forEach((m) => console.log(" -", m.productId, m.combo, "| staging:", JSON.stringify(m.staging), "| prod:", JSON.stringify(m.prod)));
  }
  if (extraInProd.length) {
    console.log("\nextra in production:");
    extraInProd.slice(0, 20).forEach((m) => console.log(" -", m.productId, m.combo));
  }
  if (missingInProd.length) {
    console.log("\nmissing in production:");
    missingInProd.slice(0, 20).forEach((m) => console.log(" -", m.productId, m.combo));
  }
}
main().catch((e) => console.error("ERR", e.message));
