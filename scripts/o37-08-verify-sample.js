require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/603", { headers: { Authorization: prod.auth } });
  const p = await r.json();
  console.log("price:", p.price, "| regular_price:", p.regular_price);
  console.log("attributes:", JSON.stringify(p.attributes.map(a => ({name:a.name, options:a.options})), null, 2));
}
main().catch(e => console.error("ERR", e.message));
