require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const compare = JSON.parse(require("fs").readFileSync("/opt/zentry-ai-department/reports/o36-catalog-compare.json", "utf8"));
  const catDiffs = compare.diffs.filter(d => d.diffs.some(f => f.includes("categories differ")));
  console.log("products with category diffs:", catDiffs.length);

  const staging = JSON.parse(require("fs").readFileSync("/opt/zentry-ai-department/reports/o36-catalog-staging-full.json", "utf8"));
  const stagingById = new Map(staging.map(p => [p.id, p]));

  const catsR = await fetch(prod.base + "/wp-json/wc/v3/products/categories?per_page=100", { headers: { Authorization: prod.auth } });
  const cats = await catsR.json();
  const catIdBySlug = {};
  cats.forEach(c => catIdBySlug[c.slug] = c.id);
  console.log("taquillas-fenolicas id:", catIdBySlug["taquillas-fenolicas"], "| taquillas id:", catIdBySlug["taquillas"], "| taquillas-metalicas id:", catIdBySlug["taquillas-metalicas"]);

  const updates = catDiffs.map(d => {
    const sp = stagingById.get(d.id);
    const categoryIds = sp.categories.map(slug => catIdBySlug[slug]).filter(Boolean);
    return { id: d.id, categories: categoryIds.map(id => ({ id })) };
  });

  console.log("\nSample update payload:", JSON.stringify(updates[0]));

  // batch update via wc/v3/products/batch
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/batch", {
    method: "POST",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ update: updates }),
  });
  const j = await r.json();
  console.log("\nSTATUS", r.status);
  if (j.update) {
    console.log("updated count:", j.update.length);
    j.update.forEach(u => console.log(" -", u.id, u.name, "-> categories:", (u.categories||[]).map(c=>c.slug).join(",")));
  } else {
    console.log(JSON.stringify(j).slice(0, 1000));
  }
}
main().catch(e => console.error("ERR", e.message));
