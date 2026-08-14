require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  // sanity: any orders referencing product 1286? (best-effort check via orders search - WC doesn't filter orders by product directly in v3 without line item search, so just confirm product has no reviews/rating count as a light proxy, and confirm current state)
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/1286", { headers: { Authorization: prod.auth } });
  const p = await r.json();
  console.log("id:", p.id, "| status:", p.status, "| total_sales:", p.total_sales, "| rating_count:", p.rating_count);
}
main().catch(e => console.error("ERR", e.message));
