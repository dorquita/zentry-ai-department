require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/603", { headers: { Authorization: prod.auth } });
  const p = await r.json();
  console.log("price:", JSON.stringify(p.price), "| regular_price:", JSON.stringify(p.regular_price));
  console.log("price_html:", p.price_html);
}
main().catch(e => console.error("ERR", e.message));
