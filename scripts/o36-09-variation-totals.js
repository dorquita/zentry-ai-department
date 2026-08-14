require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function totalVariations(env, ids) {
  let total = 0;
  let missingIds = [];
  for (const id of ids) {
    const r = await fetch(env.base + "/wp-json/wc/v3/products/" + id + "/variations?per_page=1", { headers: { Authorization: env.auth } });
    const count = r.headers.get("x-wp-total");
    total += parseInt(count || "0", 10);
  }
  return total;
}

async function main() {
  const raw = require("fs").readFileSync("/opt/zentry-ai-department/reports/o36-catalog-staging-full.json", "utf8");
  const staging_products = JSON.parse(raw);
  const variableIds = staging_products.filter((p) => p.type === "variable").map((p) => p.id);
  console.log("variable product count:", variableIds.length);

  const stagingTotal = await totalVariations(staging, variableIds);
  console.log("staging total variations:", stagingTotal);
  const prodTotal = await totalVariations(prod, variableIds);
  console.log("production total variations:", prodTotal);
}
main().catch((e) => console.error("ERR", e.message));
