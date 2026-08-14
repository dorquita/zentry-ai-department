require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/489/variations?per_page=100", { headers: { Authorization: prod.auth } });
  const vars = await r.json();
  console.log("total variations for 489:", vars.length);
  vars.forEach(v => console.log(v.id, "|", v.attributes.map(a=>a.name+"="+a.option).join(", "), "| regular_price:", v.regular_price));
}
main().catch(e => console.error("ERR", e.message));
