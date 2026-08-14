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

  const staleReport = [];
  for (const pid of variableIds) {
    const [stagingVars, prodVars] = await Promise.all([fetchAllVariations(staging, pid), fetchAllVariations(prod, pid)]);
    const stagingCombos = new Set(stagingVars.map(comboKey));
    const stale = prodVars.filter((v) => !stagingCombos.has(comboKey(v)));
    if (stale.length) {
      staleReport.push({ productId: pid, stale: stale.map(v => ({ id: v.id, combo: v.attributes.map(a=>a.option).join("/"), price: v.price })) });
    }
  }
  require("fs").writeFileSync("/opt/zentry-ai-department/reports/o37-stale-variations.json", JSON.stringify(staleReport, null, 2));
  const totalStale = staleReport.reduce((s, r) => s + r.stale.length, 0);
  console.log("products with stale variations:", staleReport.length, "| total stale variations:", totalStale);
  staleReport.slice(0, 5).forEach(r => {
    console.log("product", r.productId, ":");
    r.stale.forEach(s => console.log("  - id", s.id, s.combo, "price:", s.price));
  });
}
main().catch(e => console.error("ERR", e.message));
