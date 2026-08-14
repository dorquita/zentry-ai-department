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

  const duplicateGroups = [];
  const wrongPriceVariations = [];

  for (const pid of variableIds) {
    const pv = await fetchAllVariations(prod, pid);
    const groups = {};
    pv.forEach((v) => {
      const k = comboKey(v);
      (groups[k] = groups[k] || []).push(v);
    });
    const dupes = Object.entries(groups).filter(([k, arr]) => arr.length > 1);
    if (dupes.length) {
      duplicateGroups.push({ productId: pid, dupes: dupes.map(([k, arr]) => ({ combo: k, variations: arr.map((v) => ({ id: v.id, regular_price: v.regular_price })) })) });
    }
  }

  console.log("products with duplicate combos in production:", duplicateGroups.length);
  let totalDupeVariations = 0;
  duplicateGroups.forEach((g) => {
    g.dupes.forEach((d) => {
      totalDupeVariations += d.variations.length;
      console.log(g.productId, "|", d.combo, "|", d.variations.map((v) => v.id + ":" + v.regular_price).join(", "));
    });
  });
  console.log("total variations involved in duplicate combos:", totalDupeVariations);

  require("fs").writeFileSync("/opt/zentry-ai-department/reports/o38-duplicate-combo-groups.json", JSON.stringify(duplicateGroups, null, 2));
}
main().catch((e) => console.error("ERR", e.message));
