require("dotenv").config();
const fs = require("fs");
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
  return v.attributes
    .map((a) => (a.name + "=" + a.option).toLowerCase().replace(/\s+/g, ""))
    .sort()
    .join("|");
}

async function main() {
  const dupeReport = JSON.parse(fs.readFileSync("/opt/zentry-ai-department/reports/o38-duplicate-combo-groups.json", "utf8"));
  const productIds = dupeReport.map((p) => p.productId);

  const result = [];
  for (const pid of productIds) {
    const [sv, pv] = await Promise.all([fetchAllVariations(staging, pid), fetchAllVariations(prod, pid)]);
    const stagingByCombo = new Map(sv.map((v) => [comboKey(v), v]));

    const productEntry = dupeReport.find((p) => p.productId === pid);
    const groups = [];
    for (const dupe of productEntry.dupes) {
      // recompute combo key using normalized (space-insensitive) matching against the actual prod variation objects
      const sample = pv.find((v) => dupe.variations.some((dv) => dv.id === v.id));
      if (!sample) {
        groups.push({ combo: dupe.combo, variations: dupe.variations, stagingMatch: "NOT_FOUND_IN_PROD_LIVE" });
        continue;
      }
      const key = comboKey(sample);
      const stagingVar = stagingByCombo.get(key);
      const enriched = dupe.variations.map((dv) => {
        const liveVar = pv.find((v) => v.id === dv.id);
        return {
          id: dv.id,
          regular_price: dv.regular_price,
          live_price: liveVar ? liveVar.price : null,
          matches_staging_regular: stagingVar ? stagingVar.regular_price === dv.regular_price : null,
        };
      });
      groups.push({
        combo: dupe.combo,
        staging_regular_price: stagingVar ? stagingVar.regular_price : "NO_STAGING_MATCH",
        staging_sale_price: stagingVar ? stagingVar.sale_price : null,
        variations: enriched,
      });
    }
    result.push({ productId: pid, groups });
  }

  fs.writeFileSync("/opt/zentry-ai-department/reports/o39-duplicate-resolution-proposal.json", JSON.stringify(result, null, 2));

  // summary
  let totalGroups = 0, resolvable = 0, ambiguous = 0;
  const toDelete = [];
  const needsReview = [];
  for (const p of result) {
    for (const g of p.groups) {
      totalGroups++;
      const matches = g.variations.filter((v) => v.matches_staging_regular === true);
      const nonMatches = g.variations.filter((v) => v.matches_staging_regular === false);
      if (matches.length === 1 && nonMatches.length >= 1 && (matches.length + nonMatches.length) === g.variations.length) {
        resolvable++;
        nonMatches.forEach((v) => toDelete.push({ productId: p.productId, combo: g.combo, id: v.id, regular_price: v.regular_price, reason: "does_not_match_staging_regular_price" }));
      } else {
        ambiguous++;
        needsReview.push({ productId: p.productId, combo: g.combo, staging_regular_price: g.staging_regular_price, variations: g.variations });
      }
    }
  }
  console.log("total duplicate groups:", totalGroups);
  console.log("cleanly resolvable (exactly 1 matches staging):", resolvable);
  console.log("ambiguous / needs manual review:", ambiguous);
  console.log("total variation IDs proposed for deletion:", toDelete.length);
  fs.writeFileSync("/opt/zentry-ai-department/reports/o39-to-delete-proposal.json", JSON.stringify(toDelete, null, 2));
  fs.writeFileSync("/opt/zentry-ai-department/reports/o39-needs-review.json", JSON.stringify(needsReview, null, 2));
  console.log("\n=== AMBIGUOUS GROUPS (first 10) ===");
  needsReview.slice(0, 10).forEach((n) => console.log(JSON.stringify(n)));
}
main().catch((e) => console.error("ERR", e.message, e.stack));
