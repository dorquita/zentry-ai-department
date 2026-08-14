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

  const byProduct = {};
  for (const pid of variableIds) {
    const [sv, pv] = await Promise.all([fetchAllVariations(staging, pid), fetchAllVariations(prod, pid)]);
    const svByCombo = new Map(sv.map((v) => [comboKey(v), v]));
    const pvByCombo = new Map(pv.map((v) => [comboKey(v), v]));
    const toFix = [];
    for (const [combo, s] of svByCombo) {
      const p = pvByCombo.get(combo);
      if (p && (s.regular_price !== p.regular_price || s.sale_price !== p.sale_price || s.price !== p.price)) {
        toFix.push({ id: p.id, regular_price: s.regular_price, sale_price: s.sale_price || "", price: s.price });
      }
    }
    if (toFix.length) byProduct[pid] = toFix;
  }

  const products = Object.keys(byProduct);
  console.log("products with mismatches to fix:", products.length);
  let totalFixed = 0;
  for (const pid of products) {
    const r = await fetch(prod.base + "/wp-json/wc/v3/products/" + pid + "/variations/batch", {
      method: "POST",
      headers: { Authorization: prod.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ update: byProduct[pid] }),
    });
    const j = await r.json();
    if (j.update) {
      totalFixed += j.update.length;
      const errs = j.update.filter((u) => u.error);
      console.log(pid, "- fixed", j.update.length, errs.length ? "ERRORS: " + JSON.stringify(errs) : "");
    } else {
      console.log(pid, "- ERROR", JSON.stringify(j).slice(0, 300));
    }
  }
  console.log("\ntotal fixed:", totalFixed);
}
main().catch((e) => console.error("ERR", e.message, e.stack));
