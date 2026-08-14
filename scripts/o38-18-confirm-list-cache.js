require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r1 = await fetch(prod.base + "/wp-json/wc/v3/products/489/variations?per_page=100", { headers: { Authorization: prod.auth } });
  const list = await r1.json();
  const v = list.find(x => x.id === 2275);
  console.log("via LIST endpoint - id 2275 regular_price:", v.regular_price);

  const r2 = await fetch(prod.base + "/wp-json/wc/v3/products/489/variations/2275", { headers: { Authorization: prod.auth } });
  const single = await r2.json();
  console.log("via SINGLE endpoint - id 2275 regular_price:", single.regular_price);
}
main().catch(e => console.error("ERR", e.message));
