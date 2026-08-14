require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/339", { headers: { Authorization: prod.auth } });
  const p = await r.json();
  console.log("price:", p.price, "| price_html snippet:", p.price_html.replace(/<[^>]+>/g, '').slice(0,60));
}
main().catch(e => console.error("ERR", e.message));
