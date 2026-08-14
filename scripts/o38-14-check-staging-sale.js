require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

async function main() {
  const r = await fetch(staging.base + "/wp-json/wc/v3/products/339/variations?per_page=100", { headers: { Authorization: staging.auth } });
  const vars = await r.json();
  vars.sort((a,b) => parseFloat(a.regular_price||0) - parseFloat(b.regular_price||0));
  vars.forEach(v => console.log(v.id, "|", v.attributes.map(a=>a.option).join("/"), "| regular_price:", v.regular_price, "| sale_price:", v.sale_price, "| price:", v.price, "| on_sale:", v.on_sale));
}
main().catch(e => console.error("ERR", e.message));
