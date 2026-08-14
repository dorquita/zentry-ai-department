require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/339/variations?per_page=100", { headers: { Authorization: prod.auth } });
  const vars = await r.json();
  console.log("total variations:", vars.length);
  vars.sort((a,b) => parseFloat(a.regular_price||0) - parseFloat(b.regular_price||0));
  vars.forEach(v => console.log(v.id, "|", v.attributes.map(a=>a.option).join("/"), "| regular_price:", v.regular_price, "| price:", v.price, "| status:", v.status, "| purchasable:", v.purchasable));
}
main().catch(e => console.error("ERR", e.message));
